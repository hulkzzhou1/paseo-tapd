import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); } catch (e) {
    if(e.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier)) return next(`${specifier}.ts`,context);
    throw e;
  }
}});
const { createAssignmentTools } = await import('../server/agent-assignment.ts');
const { createAgentLinks } = await import('../server/agent-links.ts');
const { tapdSettingsSchema } = await import('../shared/contracts.ts');
const { clearTapdCache } = await import('../server/tapd.ts');
for(const key of ['TAPD_TOKEN','TAPD_API_ENDPOINT','TAPD_SITE_URL','TAPD_WORKSPACE_IDS']) delete process.env[key];
const values = tapdSettingsSchema.parse({ token:'example-secret', apiEndpoint:'https://api.example.com', workspaceIds:'12345678' });
const target = {kind:'story',id:'11111111',workspaceId:'12345678',confirmed:true};
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(),'tapd-assign-'));
  const prior = process.env.PASEO_HOME; process.env.PASEO_HOME = dir;
  t.after(async()=>{ if(prior === undefined) delete process.env.PASEO_HOME; else process.env.PASEO_HOME=prior; await rm(dir,{recursive:true,force:true}); });
  clearTapdCache();
  t.mock.method(globalThis,'fetch',async(input,init)=>{
    assert.notEqual(init.method,'POST','assignment must not mutate TAPD');
    const url=new URL(input);
    return Response.json({status:1,data:url.pathname==='/stories'?[{Story:{id:target.id,name:'Example',status:'open'}}]:[]});
  });
  const calls=[];
  const agent={id:'example-agent',workspaceId:'example-workspace',archivedAt:null,current:()=>({title:'Example'}),refresh:async()=>{},send:async text=>{calls.push(['send',text]);}};
  const workspace={id:'example-workspace',name:'Example',agents:{create:async input=>{calls.push(['createAgent',input]);return agent;}}};
  const context={agent:{id:agent.id},signal:new AbortController().signal,paseo:{
    agents:{ref:()=>agent,list:async()=>({entries:[{agent:{id:agent.id,title:'Example'}}]})},
    projects:{list:async()=>({projects:[{projectKind:'git',projectRootPath:'/example/repo',projectDisplayName:'Example'}]})},
    providers:{snapshot:async()=>({entries:[{provider:'example',models:[{id:'model',label:'Example'}]}]})},
    workspaces:{create:async input=>{calls.push(['createWorkspace',input]);return workspace;}}
  }};
  const links=createAgentLinks();
  const tools=createAssignmentTools(async()=>values,links);
  const call=(name,input)=>tools.find(t=>t.name===name).execute(input,context);
  return {dir,links,call,calls,context,agent,workspace};
}
test('binding requires authorization and actual project, persists idempotently and removes after restart',async t=>{
  const s=await setup(t);
  assert.equal((await s.call('tapd_bind_agent',{...target,confirmed:false})).isError,true);
  assert.equal((await s.call('tapd_bind_agent',{...target,workspaceId:'87654321'})).isError,true);
  assert.deepEqual(await s.links.list(),[]);
  assert.equal((await s.call('tapd_bind_agent',target)).structuredContent.ok,true);
  await s.call('tapd_bind_agent',target);
  const restarted=createAgentLinks(); const [link]=await restarted.list();
  assert.equal((await restarted.list()).length,1);
  assert.equal(link.agentId,s.agent.id); assert.equal(link.tapdWorkspaceId,target.workspaceId);
  assert.equal(link.workspaceId,'example-workspace'); assert.equal(s.calls.length,0,'binding is silent');
  await restarted.remove(link); assert.deepEqual(await restarted.list(),[]);
});
const dispatch={...target,repoPath:'/example/repo',provider:'example/model',branchName:'tapd/example',prompt:'Implement the approved example task'};
test('dispatch validates destinations, binds before sending, exposes partial creation without retry',async t=>{
  const s=await setup(t);
  assert.equal((await s.call('tapd_dispatch_agent',{...dispatch,repoPath:'/unapproved'})).isError,true);
  assert.equal((await s.call('tapd_dispatch_agent',{...dispatch,provider:'example/absent'})).isError,true);
  assert.equal((await s.call('tapd_dispatch_agent',{...dispatch,confirmed:false})).isError,true);
  assert.equal((await s.call('tapd_dispatch_agent',{...dispatch,prompt:values.token})).isError,true);
  assert.equal(s.calls.length,0);
  s.agent.send=async()=>{ throw Error('example-secret'); };
  const result=(await s.call('tapd_dispatch_agent',dispatch)).structuredContent;
  assert.equal(result.ok,false);assert.equal(result.phase,'prompt');assert.equal(result.bound,true);assert.equal(result.promptSent,'unknown');
  assert.equal(result.agentId,'example-agent');assert.equal(s.calls.length,2);assert.equal((await s.links.list()).length,1,'responsibility survives uncertain prompt send');
  assert.ok(!JSON.stringify(result).includes(values.token));
});
test('dispatch success starts exactly once; cancellation after workspace creation retains its ID',async t=>{
  const s=await setup(t);
  assert.equal((await s.call('tapd_dispatch_agent',dispatch)).structuredContent.promptSent,true);
  assert.deepEqual(s.calls.map(c=>c[0]),['createWorkspace','createAgent','send']);
  await s.links.remove((await s.links.list())[0]);
  const abort=new AbortController(); s.context.signal=abort.signal;
  s.context.paseo.workspaces.create=async()=>{abort.abort();return s.workspace;};
  const result=(await s.call('tapd_dispatch_agent',dispatch)).structuredContent;
  assert.equal(result.phase,'agent'); assert.equal(result.workspaceId,'example-workspace');assert.equal(result.agentId,undefined);
});
test('invalid storage is not overwritten and conflicting bindings are rejected before dispatch resources',async t=>{
  const s=await setup(t);
  await Promise.all([s.call('tapd_bind_agent',target),s.call('tapd_bind_agent',{...target,id:'22222222'})]);
  // Mock returns only the real entity ID, so exercise store concurrency with validated records.
  const [link]=await s.links.list();
  const attempts=await Promise.allSettled([s.links.put({...link,agentId:'example-second'}),s.links.put({...link,agentId:'example-third'})]);
  assert.equal(attempts.filter(result=>result.status==='rejected').length,2);
  assert.equal((await s.links.list()).length,1);
  await writeFile(join(s.dir,'plugin-data/tapd-workbench/agent-links.json'),'broken');
  await assert.rejects(s.links.put(link));
  const result=(await s.call('tapd_dispatch_agent',dispatch)).structuredContent;
  assert.equal(result.phase,'reservation');assert.equal(result.agentId,undefined);assert.equal(result.bound,false);assert.equal(result.promptSent,false);
  assert.ok(!s.calls.some(call=>call[0]==='send'));
});

test('owner handover requires target acceptance and expected revision; release is caller scoped',async t=>{
  const s=await setup(t);
  const second={...s.agent,id:'example-second',current:()=>({title:'Second'})};
  const third={...s.agent,id:'example-third',current:()=>({title:'Third'})};
  s.context.paseo.agents.ref=id=>[s.agent,second,third].find(a=>a.id===id)??{refresh:async()=>{},current:()=>null};
  const owned=(await s.call('tapd_take_task',target)).structuredContent.link;
  const change={...target,expectedOwnerAgentId:owned.agentId,expectedRevision:owned.responsibility.revision,reason:'Approved handover',targetAgentId:second.id};
  const offer=(await s.call('tapd_delegate_task',change)).structuredContent;
  assert.equal(offer.changed,false,'proposal never transfers or starts execution');
  assert.equal((await s.call('tapd_accept_task',{...target,offerId:offer.offer.offerId,reason:'Accept approved handover'})).isError,true,'original owner cannot accept as target');
  s.context.agent.id=third.id;
  assert.equal((await s.call('tapd_accept_task',{...target,offerId:offer.offer.offerId,reason:'Accept approved handover'})).isError,true,'another Agent cannot adopt target rights');
  assert.equal((await s.call('tapd_leave_task',{...target,expectedRevision:owned.responsibility.revision,reason:'Not mine'})).isError,true);
  s.context.agent.id=second.id;
  const accepted=await s.call('tapd_accept_task',{...target,offerId:offer.offer.offerId,reason:'Accept approved handover'});
  assert.equal(accepted.structuredContent.link.agentId,second.id);
  assert.equal((await s.call('tapd_accept_task',{...target,offerId:offer.offer.offerId,reason:'Repeat'})).structuredContent.changed,false);
  assert.equal((await s.call('tapd_task_board',{})).structuredContent.items.length,1);
  const revision=accepted.structuredContent.link.responsibility.revision;
  assert.equal((await s.call('tapd_leave_task',{...target,expectedRevision:'stale',reason:'Exit'})).isError,true);
  const left=await s.call('tapd_leave_task',{...target,expectedRevision:revision,reason:'Scope finished'});
  assert.equal(left.structuredContent.changed,true);
  assert.equal((await s.call('tapd_task_board',{})).structuredContent.items.length,0);
  assert.equal((await s.call('tapd_leave_task',{...target,expectedRevision:revision,reason:'Scope finished'})).structuredContent.changed,false);
  const history=(await s.call('tapd_task_history',target)).structuredContent.history;
  assert.deepEqual(history.map(event=>event.action),['claim','offer','transfer','release']);
  assert.equal(history.at(-1).actorAgentId,second.id);assert.equal(history.at(-1).reason,'Scope finished');assert.ok(history.every(event=>event.at));
  assert.equal(s.calls.length,0,'all relationship operations are silent');
});

test('delegation acceptance is atomic across competitors, survives restart, and rejects deleted or archived targets',async t=>{
 const s=await setup(t);
 const peers=new Map([s.agent.id,'example-second','example-third'].map(id=>[id,{...s.agent,id}]));
 s.context.paseo.agents.ref=id=>peers.get(id)??{id,refresh:async()=>{},current:()=>null};
 const proposal=(await s.call('tapd_delegate_task',{...target,targetAgentId:'example-second',reason:'Delegate approved scope'})).structuredContent;
 const another=(await s.call('tapd_delegate_task',{...target,targetAgentId:'example-third',reason:'Alternative approved scope'})).structuredContent;
 s.context.agent.id='example-second';
 peers.get('example-second').archivedAt='2026-01-01';
 assert.equal((await s.call('tapd_accept_task',{...target,offerId:proposal.offer.offerId,reason:'Accept'})).isError,true);
 peers.delete('example-second');
 assert.equal((await s.call('tapd_accept_task',{...target,offerId:proposal.offer.offerId,reason:'Accept'})).isError,true);
 peers.set('example-second',{...s.agent,id:'example-second'});
 const tools=createAssignmentTools(async()=>values,createAgentLinks());
 const accept=tools.find(tool=>tool.name==='tapd_accept_task');
 const results=await Promise.all([
  accept.execute({...target,offerId:proposal.offer.offerId,reason:'Take ownership'}, {...s.context,agent:{id:'example-second'}}),
  accept.execute({...target,offerId:another.offer.offerId,reason:'Take ownership'}, {...s.context,agent:{id:'example-third'}}),
 ]);
 assert.equal(results.filter(result=>result.structuredContent?.ok).length,1);
 assert.equal(results.filter(result=>result.structuredContent?.conflict).length,1);
 assert.equal((await s.links.list()).length,1);
 const owner=(await s.links.list())[0];
 assert.equal((await s.call('tapd_leave_task',{...target,expectedRevision:owner.responsibility.revision,reason:values.token})).isError,true,'credentials must not enter operation records');
 assert.ok(!JSON.stringify((await s.call('tapd_task_history',target)).structuredContent).includes(values.token));
 assert.equal(s.calls.length,0);
});

test('dispatch keeps created resources but never sends to a target lost before prompt',async t=>{
 const s=await setup(t);
 s.context.paseo.agents.ref=()=>({...s.agent,current:()=>null});
 const result=(await s.call('tapd_dispatch_agent',dispatch)).structuredContent;
 assert.equal(result.ok,false);assert.equal(result.phase,'binding-check');assert.equal(result.promptSent,false);
 assert.equal(result.workspaceId,'example-workspace');assert.equal(result.agentId,'example-agent');assert.equal(result.bound,true);
 assert.deepEqual(s.calls.map(call=>call[0]),['createWorkspace','createAgent']);
 assert.equal((await s.links.list()).length,1,'unverified lifecycle change cannot silently release responsibility');
});

test('local history and own release remain available when TAPD reads fail',async t=>{
 const s=await setup(t);
 const owned=(await s.call('tapd_take_task',target)).structuredContent.link;
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('offline');});
 const history=await s.call('tapd_task_history',target);
 assert.equal(history.structuredContent.history.length,1);
 const result=await s.call('tapd_leave_task',{...target,expectedRevision:owned.responsibility.revision,reason:'Stop local responsibility'});
 assert.equal(result.structuredContent.changed,true);
});
