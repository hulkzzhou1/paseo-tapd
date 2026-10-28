import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/.test(s))return n(s+'.ts',c);throw e;}}});
const { default: contribute } = await import('../index.server.ts');
const { tapdSettingsSchema } = await import('../shared/contracts.ts');
const { clearTapdCache } = await import('../server/tapd.ts');
const target={kind:'story',id:'11111111',workspaceId:'12345678',confirmed:true};
async function setup(t,overrides={}) {
 const home=await mkdtemp(join(tmpdir(),'tapd-board-'));const prior=process.env.PASEO_HOME;process.env.PASEO_HOME=home;
 for(const key of ['TAPD_TOKEN','TAPD_API_ENDPOINT','TAPD_SITE_URL','TAPD_WORKSPACE_IDS'])delete process.env[key];
 const values=tapdSettingsSchema.parse({token:'example-secret',apiEndpoint:'https://api.example.com',siteUrl:'https://example.com',workspaceIds:'12345678',...overrides});
 const agents=new Map(['example-agent','example-other'].map(id=>[id,{id,title:id,workspaceId:'example-workspace',archivedAt:null}]));const sends=[];const creates=[];
 const ref=id=>({id,workspaceId:agents.get(id)?.workspaceId,current:()=>agents.get(id),refresh:async()=>agents.has(id)?{agent:agents.get(id)}:null,get archivedAt(){return agents.get(id)?.archivedAt;},send:async prompt=>sends.push(prompt)});
 const paseo={agents:{ref,list:async()=>({entries:[...agents.values()].map(agent=>({agent}))})},projects:{list:async()=>({projects:[{projectKind:'git',projectRootPath:'/example/repo',projectDisplayName:'Example'}]})},providers:{snapshot:async()=>({entries:[{provider:'example',models:[{id:'model'}]}]})},workspaces:{create:async()=>{creates.push('workspace');return {id:'example-workspace',agents:{create:async()=>ref('example-other')}};}}};
 const api={status:null,workflow:{done:"已完成"},actualProject:null,workflowType:'12345678',offline:false,requests:[],categoryById:{},workflowByCategory:{}};
 const context={paseo,agent:{id:'example-agent'},signal:new AbortController().signal};const rpcs=new Map();let before;let writes=0;
 clearTapdCache();t.mock.method(globalThis,'fetch',async(source,init)=>{if(api.offline)throw Error('offline');api.requests.push(new URL(source));if(init.method==='POST'){writes++;const next=new URLSearchParams(init.body).get('status');if(next)api.status=next;}const u=new URL(source);let data=[];
 if(u.pathname==='/stories')data=[{Story:{id:u.searchParams.get('id'),name:'Example task',...((api.categoryById[u.searchParams.get('id')]??api.workflowType)?{workitem_type_id:api.categoryById[u.searchParams.get('id')]??api.workflowType}:{}),...(api.actualProject?{workspace_id:api.actualProject}:{}),status:api.status??(u.searchParams.get('id')==='22222222'?'done':'open')}}];
 if(u.pathname.endsWith('/get_fields_info'))data={status:{options:{open:'待处理',done:'已完成',custom:'已完成'}}};
 if(u.pathname==='/workflows/last_steps')data=api.workflowByCategory[u.searchParams.get('workitem_type_id')]??api.workflow;
 return Response.json({status:1,data});});
 const start=()=>contribute({registerSettings:()=>({read:async()=>({status:'ready',values}),subscribe:()=>()=>{}}),handle:(r,f)=>rpcs.set(r.name,f),before:(_n,f)=>before=f,on:()=>{}});let close=start();
 t.after(async()=>{close();if(prior===undefined)delete process.env.PASEO_HOME;else process.env.PASEO_HOME=prior;await rm(home,{recursive:true,force:true});});
 const tools=(await before({request:{purpose:'interactive',agentId:context.agent.id,tools:[],env:{}}},context)).tools;
 return {home,values,api,context,agents,sends,creates,rpcs,writes:()=>writes,call:async(name,input,agentId=context.agent.id)=>{const tool=tools.find(t=>t.name===name);assert.ok(tool,`registered ${name}`);return tool.execute(input,{...context,agent:{id:agentId}});},rpc:(name,input)=>rpcs.get(name)(input,context),restart:()=>{close();close=start();}};
}
test('explicit self acceptance produces one persistent board shared by tools and RPC without TAPD writes',async t=>{
 const s=await setup(t);
 assert.deepEqual((await s.call('tapd_task_board',{})).structuredContent.items,[]);
 await s.call('tapd_entity',{kind:'story',id:'11111111'});
 assert.deepEqual((await s.call('tapd_task_board',{})).structuredContent.items,[],'reading does not accept responsibility');
 const accepted=await s.call('tapd_take_task',target);assert.equal(accepted.structuredContent.ok,true);
 assert.equal((await s.call('tapd_take_task',target)).structuredContent.changed,false);
 const board=(await s.call('tapd_task_board',{})).structuredContent;assert.equal(board.items.length,1);assert.equal(board.items[0].classification,'unfinished');assert.equal(board.items[0].entity.title,'Example task');
 const rpc=await s.rpc('tapd.task-board',{agentId:'example-agent'});assert.deepEqual(rpc.items.map(({fetchedAt,...item})=>item),board.items.map(({fetchedAt,...item})=>item));
 assert.deepEqual((await s.call('tapd_task_board',{agentId:'example-other'})).structuredContent.items,[]);
 assert.equal((await s.call('tapd_take_task',{...target,agentId:'example-other'})).isError,true);
 s.restart();assert.equal((await s.rpc('tapd.task-board',{agentId:'example-agent'})).items.length,1);
 assert.equal(s.writes(),0);assert.equal(s.sends.length,0);
});
test('competing Agents have one atomic winner; direct user assignment and dispatch cannot bypass ownership',async t=>{
 const s=await setup(t);
 const results=await Promise.all(['example-agent','example-other'].map(id=>s.call('tapd_take_task',target,id)));
 assert.equal(results.filter(result=>result.structuredContent?.ok).length,1);
 const conflict=results.find(result=>result.isError);assert.equal(conflict.structuredContent.conflict,true);assert.equal(conflict.structuredContent.owners.length,1);
 const owner=results.find(result=>result.structuredContent?.ok).structuredContent.link.agentId;
 assert.equal((await s.call('tapd_bind_agent',target,owner==='example-agent'?'example-other':'example-agent')).structuredContent.conflict,true);
 await assert.rejects(s.rpc('tapd.task.claim',{...target,agentId:owner==='example-agent'?'example-other':'example-agent'}),/负责人/);
 const dispatched=await s.call('tapd_dispatch_agent',{...target,repoPath:'/example/repo',provider:'example/model',branchName:'tapd/example',prompt:'Approved work'});
 assert.equal(dispatched.structuredContent.conflict,true);assert.deepEqual(s.creates,[]);
 const completed=await s.rpc('tapd.task.claim',{...target,id:'22222222',agentId:'example-other'});assert.equal(completed.ok,true);
 const board=(await s.call('tapd_task_board',{agentId:'example-other'})).structuredContent;
 assert.equal(board.items.find(item=>item.entity.id==='22222222').classification,'completed');assert.equal(s.writes(),0);
});
test('historical links stay outside formal tasks and block automatic self acceptance',async t=>{
 const old={key:'story-11111111',kind:'story',id:'11111111',workspaceId:'example-workspace',agentId:'example-agent',agentTitle:'Legacy',workspaceTitle:'',createdAt:''};
 const s=await setup(t,{links:[old]});
 assert.deepEqual((await s.call('tapd_task_board',{})).structuredContent.items,[]);
 const rejected=await s.call('tapd_take_task',target);assert.equal(rejected.structuredContent.conflict,true);
 assert.equal(rejected.structuredContent.owners[0].confirmed,false);
 const file=join(s.home,'plugin-data/tapd-workbench/agent-links.json');await mkdir(join(s.home,'plugin-data/tapd-workbench'),{recursive:true});
 await writeFile(file,JSON.stringify([{...old,tapdWorkspaceId:'12345678',apiEndpoint:'https://api.example.com'}]));
 assert.deepEqual((await s.call('tapd_task_board',{})).structuredContent.items,[]);
 assert.equal((await s.call('tapd_take_task',target)).structuredContent.conflict,true);
});

test('custom translated completion labels never decide status; unknown workflow and failed summaries retain responsibility',async t=>{
 const s=await setup(t);assert.equal((await s.call('tapd_take_task',target)).structuredContent.ok,true);
 s.api.status='custom';
 let board=(await s.call('tapd_task_board',{})).structuredContent;assert.equal(board.items[0].entity.statusLabel,'已完成');assert.equal(board.items[0].classification,'unfinished','actual terminal metadata takes precedence over translated label');
 s.api.workflowType='example-category';
 board=(await s.call('tapd_task_board',{})).structuredContent;assert.equal(board.items[0].classification,'unknown','category-specific workflow cannot reuse project-wide terminal guesses');
 s.api.workflowType='12345678';
 s.api.workflow=[];
 board=(await s.call('tapd_task_board',{})).structuredContent;assert.equal(board.items[0].classification,'unknown');assert.equal(board.partial,true);assert.ok(board.items[0].warning);
 s.api.actualProject='87654321';
 board=(await s.call('tapd_task_board',{})).structuredContent;assert.equal(board.items.length,1);assert.equal(board.items[0].classification,'unknown');assert.equal(board.items[0].entity.title,'Example task');assert.equal(board.items[0].stale,true);
 assert.equal((await s.call('tapd_take_task',{...target,workspaceId:'87654321'})).isError,true);
 assert.equal((await s.call('tapd_task_board',{agentId:'missing-agent'})).isError,true);
 assert.equal(s.writes(),0);
});

test('fresh board reads preserve last successful summary as stale/unknown when the next read fails',async t=>{
 const s=await setup(t);await s.call('tapd_take_task',target);
 const first=(await s.call('tapd_task_board',{})).structuredContent;assert.equal(first.items[0].stale,false);assert.ok(first.items[0].fetchedAt);
 s.api.offline=true;
 const failed=(await s.call('tapd_task_board',{})).structuredContent;assert.equal(failed.items[0].entity.title,'Example task');assert.equal(failed.items[0].fetchedAt,first.items[0].fetchedAt);assert.equal(failed.items[0].stale,true);assert.equal(failed.items[0].classification,'unknown');assert.equal(failed.partial,true);
 s.api.offline=false;s.api.status='done';
 const fresh=(await s.call('tapd_task_board',{})).structuredContent;assert.equal(fresh.items[0].classification,'completed');assert.equal(fresh.items[0].stale,false);
});

test('actual requirement category isolates terminal workflows and requests whole-item statuses',async t=>{
 const s=await setup(t);s.api.status='custom';s.api.categoryById={'11111111':'11112222','22222222':'33334444'};s.api.workflowByCategory={'11112222':{custom:'已完成'},'33334444':{done:'已完成'}};
 await s.call('tapd_take_task',target);await s.call('tapd_take_task',{...target,id:'22222222'});
 const board=(await s.call('tapd_task_board',{})).structuredContent;
 assert.equal(board.items.find(item=>item.entity.id==='11111111').classification,'completed');assert.equal(board.items.find(item=>item.entity.id==='22222222').classification,'unfinished');
 for(const request of s.api.requests.filter(url=>url.pathname==='/workflows/last_steps')){assert.equal(request.searchParams.get('type'),'status');assert.equal(request.searchParams.get('workspace_id'),'12345678');assert.ok(['11112222','33334444'].includes(request.searchParams.get('workitem_type_id')));}
 s.api.workflowType=null;delete s.api.categoryById['11111111'];
 const unknown=(await s.call('tapd_task_board',{})).structuredContent;assert.equal(unknown.items.find(item=>item.entity.id==='11111111').classification,'unknown','missing category cannot use all-workflow terminal union');
});

test('an accepted status tool write immediately invalidates boards even if card presentation fails',async t=>{
 const s=await setup(t);await s.call('tapd_take_task',target);
 const before=await s.rpc('tapd.agent-links',{});
 const changed=await s.call('tapd_update_status',{...target,status:'done'});assert.equal(changed.structuredContent.ok,true);
 const after=await s.rpc('tapd.agent-links',{});assert.equal(after.boardRevision,before.boardRevision+1);
 const board=(await s.call('tapd_task_board',{})).structuredContent;assert.equal(board.items[0].classification,'completed');assert.equal(board.items[0].entity.status,'done');assert.equal(board.items[0].stale,false);assert.equal(s.writes(),1);
});
