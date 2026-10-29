import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
registerHooks({ resolve(s,c,n) { try { return n(s,c); } catch(e) { if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/.test(s))return n(s+'.ts',c);throw e; } } });
const {default:contribute}=await import('../index.server.ts');
const {tapdSettingsSchema}=await import('../shared/contracts.ts');
const {clearTapdCache}=await import('../server/tapd.ts');
const values=tapdSettingsSchema.parse({token:'example-secret',workspaceIds:'12345678',siteUrl:'https://example.com',apiEndpoint:'https://api.example.com'});
for(const key of ['TAPD_TOKEN','TAPD_WORKSPACE_IDS','TAPD_API_ENDPOINT','TAPD_SITE_URL'])delete process.env[key];
function host(serverId='example-host') {
  const rows=new Map(), agents=new Map([['example-agent',{id:'example-agent',workspaceId:'example-workspace',archivedAt:null}]]);let listener;
  const ref=id=>({address:{serverId,agentId:id},get workspaceId(){return agents.get(id)?.workspaceId??null;},refresh:async()=>agents.has(id)?{agent:agents.get(id)}:null,
    timeline:{append:async row=>{const list=rows.get(id)??[];list.push({...row,pluginId:"tapd-workbench"});rows.set(id,list);return {epoch:'example-epoch',seq:list.length};},
      refetch:async()=>({entries:(rows.get(id)??[]).map((item,i)=>({item,seqStart:i+1,seqEnd:i+1})),hasOlder:false,hasNewer:false,epoch:'example-epoch'}),}});
  return {rows,agents,remove:async id=>{agents.delete(id);listener?.update({type:'agent_update',payload:{kind:'remove',agentId:id}});},
    paseo:{agents:{ref,list:async()=>({entries:[...agents.values()].map(agent=>({agent})),pageInfo:{hasMore:false},subscription:{ready:Promise.resolve(),subscribe:x=>{listener=x;return()=>{};},release:async()=>{}}})}}};
}
function plugin(){const rpcs=new Map(),before=new Map(),events=new Map();const close=contribute({registerSettings:()=>({read:async()=>({status:'ready',values}),subscribe:()=>()=>{}}),handle:(rpc,fn)=>rpcs.set(rpc.name,fn),before:(name,fn)=>before.set(name,fn),on:(name,fn)=>events.set(name,fn)});return {rpcs,before,events,close};}
const ctx=h=>({paseo:h.paseo,signal:new AbortController().signal});
async function call(p,h,name,input,signal=new AbortController().signal){const {tools}=await p.before.get('agent.session_open')({request:{purpose:'interactive',agentId:'example-agent',tools:[],env:{}}},ctx(h));return tools.find(t=>t.name===name).execute(input,{paseo:h.paseo,signal,agent:{id:'example-agent'}});}
function mockTapd(t,afterRequest=()=>{}){clearTapdCache();const requests=[];let fieldValue="原值",status="open";t.mock.method(globalThis,'fetch',async (source,init)=>{const u=new URL(source),body=new URLSearchParams(init.body);requests.push({u,init,body});afterRequest({u,init,body});
 let data=[];
 if(init.method==='POST'){if(body.has('status'))status=body.get('status');if(body.has('custom_field_one'))fieldValue=body.get('custom_field_one');data={Story:{id:'22222222'}};}
 else if(u.pathname==='/stories'&&u.searchParams.has('id'))data=[{Story:{id:u.searchParams.get('id'),workspace_id:u.searchParams.get('workspace_id'),name:'示例需求',status,description:'不应持久化的正文',custom_field_one:fieldValue}}];
 else if(u.pathname.endsWith('get_fields_info'))data={status:{options:{open:'待处理',done:'已完成'}},custom_field_one:{label:'方案',html_type:'rich_edit',readonly:0}};
 else if(u.pathname==='/users/info')data={User:{nick:'example-member'}};
 return Response.json({status:1,data});});return requests;}
async function fixture(t,run){const directory=await mkdtemp(join(tmpdir(),'tapd-conversation-writes-')),prior=process.env.PASEO_HOME;process.env.PASEO_HOME=directory;const h=host();let p=plugin();
 try{await run({h,get p(){return p;},directory,reload(){p.close();p=plugin();}});}finally{p.close();if(prior===undefined)delete process.env.PASEO_HOME;else process.env.PASEO_HOME=prior;await rm(directory,{recursive:true,force:true});}}

test('direct creation, comment and status results do not create local records or timeline cards',async t=>{
 const requests=mockTapd(t);await fixture(t,async({p,h,directory})=>{
 const create=await call(p,h,'tapd_create',{kind:'story',workspaceId:'12345678',title:'示例需求',confirmed:true});
 assert.equal(create.structuredContent.id,'22222222');
 const target={kind:'story',id:'11111111',workspaceId:'12345678',confirmed:true};
 const status=await call(p,h,'tapd_update_status',{...target,status:'done'});assert.equal(status.structuredContent.ok,true);
 const comment=await call(p,h,'tapd_add_comment',{...target,text:'示例评论'});assert.equal(comment.structuredContent.ok,true);
 assert.equal(h.rows.size,0);assert.equal(requests.filter(x=>x.init.method==='POST').length,3);
 assert.deepEqual(await readdir(directory),[]);
 });
});

test('accepted writes remain successful after cancellation without host presentation or replay',async t=>{
 const controller=new AbortController();const requests=mockTapd(t,({init})=>{if(init.method==='POST')controller.abort();});
 await fixture(t,async f=>{
 f.h.paseo=new Proxy({},{get(){throw Error('Host state must not be accessed');}});
 const result=await call(f.p,f.h,'tapd_add_comment',{kind:'story',id:'11111111',workspaceId:'12345678',text:'示例评论',confirmed:true},controller.signal);
 assert.equal(result.isError,undefined);assert.equal(result.structuredContent.ok,true);
 f.reload();assert.equal(requests.filter(x=>x.init.method==='POST').length,1);assert.equal(f.h.rows.size,0);
 });
});

test('failed, ambiguous, pre-write cancelled and unchanged operations do not retry writes',async t=>{
 const requests=mockTapd(t);await fixture(t,async({p,h})=>{
 const target={kind:'story',id:'11111111',workspaceId:'12345678',confirmed:true};const cancel=new AbortController();cancel.abort();
 assert.equal((await call(p,h,'tapd_add_comment',{...target,text:'示例评论'},cancel.signal)).isError,true);
 assert.equal((await call(p,h,'tapd_update_status',{...target,status:'open'})).structuredContent.unchanged,true);
 for(const mode of ['failed','ambiguous']){
 t.mock.method(globalThis,'fetch',async(source,init)=>{const u=new URL(source);requests.push({u,init});if(init.method==='POST'){if(mode==='ambiguous')throw new Error('response lost');return Response.json({status:0,info:'private failure'});}return Response.json({status:1,data:[]});});
 const result=await call(p,h,'tapd_create',{kind:'story',workspaceId:'12345678',title:'示例需求',confirmed:true});assert.equal(result.isError,true);
 }
 assert.equal(h.rows.size,0);assert.equal(requests.filter(x=>x.init.method==='POST').length,2);
 });
});

test('redaction cannot erase a confirmed write outcome',async t=>{
 const requests=mockTapd(t);const original=values.token;values.token='ok';
 try{await fixture(t,async({p,h})=>{
 const result=await call(p,h,'tapd_add_comment',{kind:'story',id:'11111111',workspaceId:'12345678',text:'示例评论',confirmed:true});
 assert.equal(result.isError,undefined);assert.equal(result.structuredContent.ok,true);assert.equal(requests.filter(x=>x.init.method==='POST').length,1);assert.equal(h.rows.size,0);
 });}finally{values.token=original;}
});

test('accepted status writes with failed verification retain the unverified outcome without replay',async t=>{
 let posted=false,posts=0,verificationReads=0;
 t.mock.method(globalThis,'fetch',async(source,init)=>{const u=new URL(source);if(init.method==='POST'){posted=true;posts++;return Response.json({status:1,data:{Story:{id:'11111111'}}});}if(posted&&u.pathname==='/stories'){verificationReads++;throw Error('offline');}return Response.json({status:1,data:u.pathname==='/stories'?[{Story:{id:'11111111',workspace_id:'12345678',status:'open',name:'Example'}}]:u.pathname.endsWith('get_fields_info')?{status:{options:{open:'Open',done:'Done'}}}:[]});});
 await fixture(t,async({p,h})=>{const result=await call(p,h,'tapd_update_status',{kind:'story',id:'11111111',workspaceId:'12345678',status:'done',confirmed:true});assert.equal(result.isError,undefined);assert.equal(result.structuredContent.writeState,'accepted');assert.equal(result.structuredContent.outcome,'unverified');assert.equal(h.rows.size,0);assert.equal(posts,1);assert.ok(verificationReads>0);});
});
