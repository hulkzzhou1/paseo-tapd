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
  s.agent.send=async()=>{ assert.equal((await s.links.list()).length,1); throw Error('example-secret'); };
  const result=(await s.call('tapd_dispatch_agent',dispatch)).structuredContent;
  assert.equal(result.ok,false);assert.equal(result.phase,'prompt');assert.equal(result.bound,true);assert.equal(result.promptSent,'unknown');
  assert.equal(result.agentId,'example-agent');assert.equal(s.calls.length,2);
  assert.ok(!JSON.stringify(result).includes(values.token));
});
test('dispatch success starts exactly once; cancellation after workspace creation retains its ID',async t=>{
  const s=await setup(t);
  assert.equal((await s.call('tapd_dispatch_agent',dispatch)).structuredContent.promptSent,true);
  assert.deepEqual(s.calls.map(c=>c[0]),['createWorkspace','createAgent','send']);
  const abort=new AbortController(); s.context.signal=abort.signal;
  s.context.paseo.workspaces.create=async()=>{abort.abort();return s.workspace;};
  const result=(await s.call('tapd_dispatch_agent',dispatch)).structuredContent;
  assert.equal(result.phase,'agent'); assert.equal(result.workspaceId,'example-workspace');assert.equal(result.agentId,undefined);
});
test('invalid stored data is not overwritten and concurrent bindings survive',async t=>{
  const s=await setup(t);
  await Promise.all([s.call('tapd_bind_agent',target),s.call('tapd_bind_agent',{...target,id:'22222222'})]);
  // Mock returns only the real entity ID, so exercise store concurrency with validated records.
  const [link]=await s.links.list();
  await Promise.all([s.links.put({...link,agentId:'example-second'}),s.links.put({...link,agentId:'example-third'})]);
  assert.equal((await s.links.list()).length,3);
  await writeFile(join(s.dir,'plugin-data/tapd-workbench/agent-links.json'),'broken');
  await assert.rejects(s.links.put(link));
  const result=(await s.call('tapd_dispatch_agent',dispatch)).structuredContent;
  assert.equal(result.phase,'binding');assert.equal(result.agentId,'example-agent');assert.equal(result.bound,false);assert.equal(result.promptSent,false);
  assert.ok(!s.calls.some(call=>call[0]==='send'));
});
