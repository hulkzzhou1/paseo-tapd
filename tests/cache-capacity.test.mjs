import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const run=promisify(execFile);

test('one thousand zero-lifetime summary HTTP payloads become collectible after public RPC reads',async()=>{
  const {stdout}=await run(process.execPath,['--expose-gc',fileURLToPath(new URL('./fixtures/cache-retention.mjs',import.meta.url))]);
  const report=JSON.parse(stdout.trim().split('\n').at(-1));
  assert.equal(report.observed,1000);assert.ok(report.retained<=2);
});

test('retained positive-lifetime responses have finite capacity and expired payloads are collectible',async()=>{
  const {stdout}=await run(process.execPath,['--expose-gc',fileURLToPath(new URL('./fixtures/cache-retention.mjs',import.meta.url)),'positive']);
  const report=JSON.parse(stdout.trim().split('\n').at(-1));
  assert.equal(report.observed,1000);assert.ok(report.retained<=500);assert.ok(report.expiredRetained<=2);
});

const { registerHooks }=await import('node:module');
const { mkdtemp,rm }=await import('node:fs/promises');
const { tmpdir }=await import('node:os');
const { join }=await import('node:path');
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/.test(s))return n(s+'.ts',c);throw e;}}});
const {default:contribute}=await import('../index.server.ts');
const {tapdSettingsSchema}=await import('../shared/contracts.ts');
const {clearTapdCache}=await import('../server/tapd.ts');
async function fixture(t){
  clearTapdCache();const prior={...process.env},home=await mkdtemp(join(tmpdir(),'tapd-capacity-'));process.env.PASEO_HOME=home;
  for(const key of ['TAPD_TOKEN','TAPD_API_ENDPOINT','TAPD_SITE_URL','TAPD_WORKSPACE_IDS'])delete process.env[key];
  let now=Date.now();t.mock.method(Date,'now',()=>now);
  const values=tapdSettingsSchema.parse({token:'example-token',workspaceIds:'12345678',apiEndpoint:'https://api.example.com',siteUrl:'https://example.com'}),requests=[],rows=[];
  t.mock.method(globalThis,'fetch',async(source,init)=>{
    assert.notEqual(init.method,'POST');const u=new URL(source);assert.equal(u.origin,'https://api.example.com');requests.push(u);let data=[];
    if(u.pathname==='/tasks'&&u.searchParams.has('id'))data=[{Task:{id:u.searchParams.get('id'),workspace_id:'12345678',name:`Task ${u.searchParams.get('id')}`,status:'open'}}];
    else if(u.pathname==='/stories'&&!u.searchParams.has('id'))data=[{Story:{id:'22222222',name:`Result ${u.searchParams.get('name')??''}`,status:'open'}}];
    else if(u.pathname.endsWith('/count'))data={count:u.pathname==='/stories/count'?1:0};
    else if(u.pathname.endsWith('/get_fields_info'))data={status:{options:{open:'Open',done:'Done'}}};
    else if(u.pathname==='/workflows/last_steps')data={done:'Done'};
    else if(u.pathname==='/users/info')data={nick:'example-user'};
    return Response.json({status:1,data});
  });
  const agent={id:'example-agent',title:'Example Agent',workspaceId:'example-workspace',archivedAt:null};
  const ref=id=>({id,address:{serverId:'example-host',agentId:id},workspaceId:agent.workspaceId,current:()=>id===agent.id?agent:null,refresh:async()=>id===agent.id?{agent}:null,timeline:{append:async row=>{rows.push({...row,pluginId:'tapd-workbench'});return{epoch:'example',seq:rows.length};},refetch:async()=>({entries:rows.map((item,i)=>({item,seqStart:i+1,seqEnd:i+1})),epoch:'example',hasOlder:false,hasNewer:false})}});
  const context={agent,signal:new AbortController().signal,paseo:{agents:{ref,list:async()=>({entries:[{agent}],pageInfo:{hasMore:false},subscription:{ready:Promise.resolve(),subscribe:()=>()=>{},release:async()=>{}}})}}},rpcs=new Map();let before;
  const close=contribute({registerSettings:()=>({read:async()=>({status:'ready',values}),subscribe:()=>()=>{}}),handle:(schema,handler)=>rpcs.set(schema.name,{schema,handler}),before:(_,fn)=>before=fn,on:()=>{}});
  t.after(async()=>{close();for(const key of ['PASEO_HOME','TAPD_TOKEN','TAPD_API_ENDPOINT','TAPD_SITE_URL','TAPD_WORKSPACE_IDS']){if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];}clearTapdCache();await rm(home,{recursive:true,force:true});});
  return{requests,rows,advance:ms=>now+=ms,rpc:async(name,input={})=>{const{schema,handler}=rpcs.get(name);return schema.output.parse(await handler(schema.input.parse(input),context));},async tool(name,input){const{tools}=await before({request:{purpose:'interactive',agentId:agent.id,tools:[],env:{}}},context);return tools.find(tool=>tool.name===name).execute(input,context);}};
}

test('response capacity eviction and expiry cause scoped HTTP rereads rather than empty results',async t=>{
  const s=await fixture(t),input={kind:'task',id:'10000000',fresh:false};
  assert.equal((await s.rpc('tapd.entity',input)).title,'Task 10000000');
  const count=()=>s.requests.filter(u=>u.pathname==='/tasks'&&u.searchParams.get('id')===input.id).length;
  await s.rpc('tapd.entity',input);assert.equal(count(),1);
  for(let i=1;i<=1000;i++)await s.rpc('tapd.entity',{...input,id:String(10000000+i)});
  assert.equal((await s.rpc('tapd.entity',input)).title,'Task 10000000');assert.equal(count(),2);
  s.advance(20_001);
  assert.equal((await s.rpc('tapd.entity',input)).title,'Task 10000000');assert.equal(count(),3);
});

test('one thousand workbench queries stay bounded without erasing responsibility, recent viewing or cards',async t=>{
  const s=await fixture(t),target={kind:'task',id:'11111111',workspaceId:'12345678'};
  await s.rpc('tapd.task.claim',{...target,agentId:'example-agent',confirmed:true});
  assert.notEqual((await s.tool('tapd_entity',target)).isError,true);
  const before=await s.rpc('tapd.conversations'),owner=(await s.rpc('tapd.task-board',{agentId:'example-agent'})).items[0].link;
  const board=keyword=>s.rpc('tapd.board',{filters:{ownerMode:'all',statusScope:'all',keyword}});
  assert.equal((await board('query-0')).columns.story.items[0].title,'Result query-0');
  const count=()=>s.requests.filter(u=>u.pathname==='/stories'&&u.searchParams.get('name')==='query-0').length;
  await board('query-0');assert.equal(count(),1);
  for(let i=1;i<=1000;i++)await board(`query-${i}`);
  assert.equal((await board('query-0')).columns.story.items[0].title,'Result query-0');assert.equal(count(),2);
  assert.deepEqual((await s.rpc('tapd.task-board',{agentId:'example-agent'})).items[0].link,owner);
  assert.deepEqual((await s.rpc('tapd.conversations')).conversations,before.conversations);assert.equal(s.rows.length,1);
  s.advance(31*60_000);
  const expired=await board('query-0');assert.equal(expired.stale,false);assert.equal(expired.columns.story.items[0].title,'Result query-0');assert.equal(count(),3);
});
