import assert from 'node:assert/strict';
import {test} from 'node:test';
import {registerHooks} from 'node:module';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/.test(s))return n(s+'.ts',c);throw e;}}});
const {default:contribute}=await import('../index.server.ts');
const {tapdSettingsSchema}=await import('../shared/contracts.ts');
const {clearTapdCache}=await import('../server/tapd.ts');
const target={kind:'story',id:'11111111',workspaceId:'12345678',confirmed:true};
async function setup(t){
 const home=await mkdtemp(join(tmpdir(),'tapd-owner-lifecycle-')),prior=process.env.PASEO_HOME;process.env.PASEO_HOME=home;
 for(const key of ['TAPD_TOKEN','TAPD_API_ENDPOINT','TAPD_SITE_URL','TAPD_WORKSPACE_IDS'])delete process.env[key];
 const values=tapdSettingsSchema.parse({token:'example-secret',apiEndpoint:'https://api.example.com',siteUrl:'https://example.com',workspaceIds:'12345678'});
 const agents=new Map(['example-agent','example-other'].map(id=>[id,{id,title:id,workspaceId:'example-workspace',archivedAt:null,status:'idle'}]));
 let directory;let fault=false;let truncated=false;let writes=0;
 const ref=id=>({id,address:{serverId:'example-host',agentId:id},get workspaceId(){return agents.get(id)?.workspaceId;},get archivedAt(){return agents.get(id)?.archivedAt;},current:()=>agents.get(id),refresh:async()=>{if(fault)throw new Error('permission denied');return agents.has(id)?{agent:agents.get(id)}:null;},timeline:{refetch:async()=>({entries:[],hasOlder:false})}});
 const paseo={agents:{ref,list:async()=>({entries:truncated?[]:[...agents.values()].map(agent=>({agent})),pageInfo:{hasMore:truncated},subscription:{ready:Promise.resolve(),subscribe:listener=>{directory=listener;},release:async()=>{}}})}};
 const context={paseo,agent:{id:'example-agent'},signal:new AbortController().signal};const rpcs=new Map(),events=new Map();let before;
 const start=()=>contribute({registerSettings:()=>({read:async()=>({status:'ready',values}),subscribe:()=>()=>{}}),handle:(r,f)=>rpcs.set(r.name,f),before:(_n,f)=>before=f,on:(name,fn)=>events.set(name,fn)});let close=start();
 t.after(async()=>{close();if(prior===undefined)delete process.env.PASEO_HOME;else process.env.PASEO_HOME=prior;await rm(home,{recursive:true,force:true});});
 clearTapdCache();t.mock.method(globalThis,'fetch',async(source,init)=>{if(init?.method==='POST')writes++;const u=new URL(source);return Response.json({status:1,data:u.pathname==='/stories'?[{Story:{id:u.searchParams.get('id'),workspace_id:target.workspaceId,name:'Example',status:'open'}}]:u.pathname==='/workflows/last_steps'?{done:'Done'}:u.pathname.endsWith('/get_fields_info')?{status:{options:{open:'Open',done:'Done'}}}:[]});});
 return {home,values,agents,paseo,context,events,rpc:(name,input={})=>rpcs.get(name)(input,context),call:async(name,input={},agentId='example-agent')=>{const tools=(await before({request:{purpose:'interactive',agentId,tools:[],env:{}}},context)).tools;return tools.find(tool=>tool.name===name).execute(input,{...context,agent:{id:agentId}});},restart(){close();close=start();},fault(value){fault=value;},truncated(value){truncated=value;},writes:()=>writes,async remove(id){agents.delete(id);directory?.update({type:'agent_update',payload:{kind:'remove',agentId:id}});await new Promise(setImmediate);}};
}
test('ownership-only boards survive close/archive/restart, while authoritative deletion clears only that Agent',async t=>{
 const s=await setup(t);
 await s.rpc('tapd.task.claim',{...target,agentId:'example-agent'});
 await s.rpc('tapd.task.claim',{...target,id:'22222222',agentId:'example-other'});
 await s.events.get('agent.closed')({agent:{id:'example-agent'}},s.context);
 s.agents.get('example-agent').archivedAt='2026-01-01';
 await s.events.get('agent.archived')({agent:{id:'example-agent'}},s.context);
 s.restart();
 assert.equal((await s.rpc('tapd.task-board',{agentId:'example-agent'})).items.length,1);
 assert.equal((await s.call('tapd_take_task',target,'example-other')).structuredContent.conflict,true,'archive retains reservation');
 s.agents.delete('example-agent');
 const effective=await s.rpc('tapd.agent-links');
 assert.deepEqual(effective.links.map(link=>link.agentId),['example-other']);
 assert.deepEqual((await s.call('tapd_task_history',target,'example-other')).structuredContent.history,[]);
 assert.equal((await s.call('tapd_take_task',target,'example-other')).structuredContent.ok,true,'reconciled deleted ownership is available again');
 assert.equal((await s.rpc('tapd.task-board',{agentId:'example-other'})).items.length,2);
 assert.equal(s.writes(),0);
});

test('failed refreshes and incomplete directories retain ownership; deletion removes only matching migration candidates',async t=>{
 const s=await setup(t);
 await s.rpc('tapd.task.claim',{...target,agentId:'example-agent'});
 s.truncated(true);s.fault(true);
 assert.equal((await s.rpc('tapd.agent-links')).links.length,1,'permission error and missing directory rows are not deletion');
 s.fault(false);s.truncated(false);
 const legacy=id=>({key:'story-33333333',kind:'story',id:'33333333',workspaceId:'example-workspace',agentId:id,agentTitle:'Example',workspaceTitle:'',createdAt:''});
 s.values.links=[legacy('example-agent'),legacy('example-other')];
 const group=(await s.rpc('tapd.task.migration',{agentId:'example-other'})).groups[0];assert.equal(group.candidates.length,2);
 await s.remove('example-agent');
 assert.equal((await s.rpc('tapd.agent-links')).links.some(link=>link.agentId==='example-agent'),false);
 const remaining=(await s.rpc('tapd.task.migration',{agentId:'example-other'})).groups[0];assert.deepEqual(remaining.candidates.map(link=>link.agentId),['example-other']);
 assert.equal((await s.rpc('tapd.task.migration.confirm',{...target,id:'33333333',agentId:'example-other',expectedRevision:remaining.revision})).changed,true);
 s.values.links.push({...legacy('example-agent'),id:'44444444',key:'story-44444444',agentTitle:'Replayed old source'});
 s.restart();
 assert.equal((await s.rpc('tapd.agent-links')).pendingAgents.some(link=>link.agentId==='example-agent'),false);
 assert.deepEqual((await s.rpc('tapd.task.migration',{agentId:'example-other'})).groups,[]);
 assert.equal((await s.call('tapd_take_task',{...target,id:'44444444'},'example-other')).structuredContent.ok,true,'deleted unimported legacy source cannot reserve the item');
 assert.equal(s.writes(),0);
});

test('deleting original owner preserves surviving transfer history and corrupt storage is never replaced',async t=>{
 const s=await setup(t);
 const first=await s.rpc('tapd.task.claim',{...target,agentId:'example-agent'});
 await s.rpc('tapd.task.transfer',{...target,targetAgentId:'example-other',expectedOwnerAgentId:'example-agent',expectedRevision:first.link.responsibility.revision,reason:'Approved reassignment'});
 await s.remove('example-agent');
 assert.equal((await s.rpc('tapd.task-board',{agentId:'example-other'})).items.length,1);
 const history=(await s.call('tapd_task_history',target,'example-other')).structuredContent.history;
 assert.deepEqual(history.map(event=>event.action),['transfer']);assert.equal(history[0].reason,'Approved reassignment');
 const file=join(s.home,'plugin-data/tapd-workbench/agent-links.json'),valid=await readFile(file,'utf8');
 await writeFile(file,'invalid-storage');s.agents.delete('example-other');
 await assert.rejects(s.rpc('tapd.agent-links'),/原数据已保留/);
 assert.equal(await readFile(file,'utf8'),'invalid-storage');
 await writeFile(file,valid);
 assert.deepEqual((await s.rpc('tapd.agent-links')).links,[],'repair retries authoritative cleanup');
 assert.equal(s.writes(),0);
});

test('deleted-Agent tombstones reject stale claims and transfers inside the serialized commit boundary',async t=>{
 const s=await setup(t),stale={...s.agents.get('example-agent')};
 await s.rpc('tapd.task.claim',{...target,agentId:'example-agent'});
 const other=await s.rpc('tapd.task.claim',{...target,id:'22222222',agentId:'example-other'});
 await s.remove('example-agent');await s.rpc('tapd.agent-links');
 s.agents.set('example-agent',stale); // A delayed public SDK snapshot cannot undo authoritative deletion.
 await assert.rejects(s.rpc('tapd.task.claim',{...target,agentId:'example-agent'}),/已删除/);
 await assert.rejects(s.rpc('tapd.task.transfer',{...target,id:'22222222',targetAgentId:'example-agent',expectedOwnerAgentId:'example-other',expectedRevision:other.link.responsibility.revision,reason:'Stale request'}),/已删除/);
 assert.deepEqual((await s.rpc('tapd.agent-links')).links.map(link=>link.agentId),['example-other']);
});

test('a failed cleanup write preserves responsibility and retries after storage repair',async t=>{
 const {chmod}=await import('node:fs/promises');
 const s=await setup(t);
 await s.rpc('tapd.task.claim',{...target,agentId:'example-agent'});
 const dir=join(s.home,'plugin-data/tapd-workbench'),file=join(dir,'agent-links.json'),original=await readFile(file,'utf8');
 await chmod(dir,0o500);
 try {
  s.agents.delete('example-agent');
  await assert.rejects(s.rpc('tapd.agent-links'),/原数据已保留/);
  assert.equal(await readFile(file,'utf8'),original);
 } finally {await chmod(dir,0o700);}
 assert.deepEqual((await s.rpc('tapd.agent-links')).links,[]);
});

test('a created hook before Agent publication cannot tombstone a new unassigned conversation',async t=>{
 const s=await setup(t);
 await s.events.get('agent.created')({agent:{id:'example-new'}},s.context);
 s.agents.set('example-new',{id:'example-new',title:'Example',workspaceId:'example-workspace',archivedAt:null});
 assert.equal((await s.rpc('tapd.task.claim',{...target,agentId:'example-new'})).ok,true);
 await s.remove('example-not-yet-bound');
 s.agents.set('example-not-yet-bound',{id:'example-not-yet-bound',title:'Stale',workspaceId:'example-workspace',archivedAt:null});
 await assert.rejects(s.rpc('tapd.task.claim',{...target,id:'22222222',agentId:'example-not-yet-bound'}),/已删除/,'actual removal event blocks a queued first claim too');
});
