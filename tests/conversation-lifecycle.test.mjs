import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
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
async function read(p,h,id='11111111'){const {tools}=await p.before.get('agent.session_open')({request:{purpose:'interactive',agentId:'example-agent',tools:[],env:{}}},ctx(h));return tools.find(t=>t.name==='tapd_entity').execute({kind:'story',id},{...ctx(h),agent:{id:'example-agent'}});}
function mockTapd(t){clearTapdCache();t.mock.method(globalThis,'fetch',async source=>{const u=new URL(source);return Response.json({status:1,data:u.pathname==='/stories'&&u.searchParams.has('id')?[{Story:{id:u.searchParams.get('id'),name:'示例需求',status:'open',description:'不应持久化的正文'}}]:[]});});}

test('registered tools collect offline results and conversation RPC restores, deduplicates and removes without replay resurrection',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'tapd-conversation-'));const prior=process.env.PASEO_HOME;process.env.PASEO_HOME=directory;mockTapd(t);const h=host();let p=plugin();
 try{
  assert.equal((await read(p,h)).isError,undefined);
  const list=()=>p.rpcs.get('tapd.conversations')({},ctx(h));
  assert.equal((await list()).conversations[0].entities.length,1);
  await read(p,h);assert.equal((await list()).conversations[0].entities.length,1);
  const entity=(await list()).conversations[0].entities[0];
  await p.rpcs.get('tapd.conversation.remove')({agentId:'example-agent',entity},ctx(h));
  assert.equal((await list()).conversations[0].entities.length,0);assert.equal(h.rows.get('example-agent').length,2);
  p.close();p=plugin();h.rows.clear();
  assert.equal((await list()).conversations[0].entities.length,0);
  assert.equal(h.rows.get('example-agent').length,2,'restore presentation without re-running a TAPD tool');
  await p.rpcs.get('tapd.conversation.focus')({agentId:'example-agent',entity},ctx(h));
  assert.equal((await list()).conversations[0].entities.length,1);
 }finally{p.close();if(prior===undefined)delete process.env.PASEO_HOME;else process.env.PASEO_HOME=prior;await rm(directory,{recursive:true,force:true});}
});

test('conversation ordering, host/agent isolation and archive retain data; only successful exact absence clears it',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'tapd-conversation-'));const prior=process.env.PASEO_HOME;process.env.PASEO_HOME=directory;mockTapd(t);const h=host();const p=plugin();
 try{
  await read(p,h,'11111111');await read(p,h,'22222222');
  let data=await p.rpcs.get('tapd.conversations')({},ctx(h));
  assert.deepEqual(data.conversations[0].entities.map(x=>x.id),['22222222','11111111']);
  const entity=data.conversations[0].entities[1];
  await p.rpcs.get('tapd.conversation.focus')({agentId:'example-agent',entity},ctx(h));
  assert.equal((await p.rpcs.get('tapd.conversations')({},ctx(h))).conversations[0].entities[0].id,'11111111');
  await p.events.get('agent.closed')({agent:{id:'example-agent'}},ctx(h));
  h.agents.get('example-agent').archivedAt='2026-01-01';
  await p.events.get('agent.archived')({agent:{id:'example-agent'}},ctx(h));
  assert.equal((await p.rpcs.get('tapd.conversations')({},ctx(h))).conversations[0].entities.length,2);
  const other=host('example-other-host');assert.deepEqual((await p.rpcs.get('tapd.conversations')({},ctx(other))).conversations,[]);
  await assert.rejects(p.rpcs.get('tapd.conversation.focus')({agentId:'example-other-agent',entity},ctx(h)),/不可用/);
  const failed={paseo:{agents:{...h.paseo.agents,ref:id=>({...h.paseo.agents.ref(id),refresh:async()=>{throw new Error('temporary');}})}}};
  await assert.rejects(p.rpcs.get('tapd.conversations')({},ctx(failed)));
  assert.equal((await p.rpcs.get('tapd.conversations')({},ctx(h))).conversations[0].entities.length,2);
  await h.remove('example-agent');
  assert.deepEqual((await p.rpcs.get('tapd.conversations')({},ctx(h))).conversations,[]);
 }finally{p.close();if(prior===undefined)delete process.env.PASEO_HOME;else process.env.PASEO_HOME=prior;await rm(directory,{recursive:true,force:true});}
});

test('a new Node process restores card records and removal progress, ignores interrupted temporary save and never repeats TAPD calls',async()=>{
 const {execFileSync}=await import('node:child_process');const directory=await mkdtemp(join(tmpdir(),'tapd-conversation-process-'));
 try{
  const env={...process.env,PASEO_HOME:directory};
  const run=stage=>JSON.parse(execFileSync(process.execPath,[new URL('./fixtures/conversation-worker.mjs',import.meta.url).pathname,stage],{env,stdio:['ignore','pipe','pipe'],timeout:15000}).toString().trim().split('\n').at(-1));
  const first=run('seed');assert.equal(first.references,0);assert.equal(first.cards,1);assert.ok(first.reads>0);
  const second=run('restore');assert.deepEqual(second,{stage:'restore',reads:0,references:0,cards:1});
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('storage failure keeps completed tool success and exposes only a recoverable presentation warning',async t=>{
 const {writeFile}=await import('node:fs/promises');const directory=await mkdtemp(join(tmpdir(),'tapd-conversation-fault-'));const prior=process.env.PASEO_HOME;const blocked=join(directory,'blocked');await writeFile(blocked,'fixture');process.env.PASEO_HOME=blocked;mockTapd(t);const h=host();const p=plugin();
 try{const result=await read(p,h);assert.equal(result.isError,undefined);assert.equal(result.structuredContent.title,'示例需求');assert.ok(result.structuredContent.presentationWarning);assert.equal(h.rows.size,0);assert.equal(JSON.stringify(result).includes(blocked),false);}
 finally{p.close();if(prior===undefined)delete process.env.PASEO_HOME;else process.env.PASEO_HOME=prior;await rm(directory,{recursive:true,force:true});}
});

test('a failed timeline append retries only stored presentation, and forged focus metadata cannot overwrite known summaries',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'tapd-conversation-'));const prior=process.env.PASEO_HOME;process.env.PASEO_HOME=directory;mockTapd(t);const h=host();const p=plugin();
 const ref=h.paseo.agents.ref;let attempts=0;h.paseo.agents.ref=id=>{const value=ref(id);const append=value.timeline.append;value.timeline.append=async row=>{if(++attempts===1)throw new Error('private failure');return append(row);};return value;};
 try{
  const result=await read(p,h);assert.equal(result.isError,undefined);assert.ok(result.structuredContent.presentationWarning);
  const data=await p.rpcs.get('tapd.conversations')({},ctx(h));assert.equal(h.rows.get('example-agent').length,1);assert.equal(attempts,2);
  const entity=data.conversations[0].entities[0];
  await p.rpcs.get('tapd.conversation.focus')({agentId:'example-agent',entity:{...entity,title:'forged title'}},ctx(h));
  assert.equal((await p.rpcs.get('tapd.conversations')({},ctx(h))).conversations[0].entities[0].title,'示例需求');
  await assert.rejects(p.rpcs.get('tapd.conversation.focus')({agentId:'example-agent',entity:{...entity,id:'99999999'}},ctx(h)),/不可用/);
 }finally{p.close();if(prior===undefined)delete process.env.PASEO_HOME;else process.env.PASEO_HOME=prior;await rm(directory,{recursive:true,force:true});}
});

test('corrupt durable input is rejected before presentation instead of accepting cross-owner or unvalidated records',async t=>{
 const {mkdir,writeFile}=await import('node:fs/promises');const directory=await mkdtemp(join(tmpdir(),'tapd-conversation-corrupt-'));const prior=process.env.PASEO_HOME;process.env.PASEO_HOME=directory;mockTapd(t);
 await mkdir(join(directory,'plugin-data/tapd-workbench'),{recursive:true});await writeFile(join(directory,'plugin-data/tapd-workbench/conversations.json'),JSON.stringify({version:1,records:[{hostId:'example-host',agentId:'example-agent',entities:[{id:'not-an-item'}]}]}));
 const h=host(),p=plugin();try{await assert.rejects(p.rpcs.get('tapd.conversations')({},ctx(h)),/本机记录暂不可用/);assert.equal(h.rows.size,0);}
 finally{p.close();if(prior===undefined)delete process.env.PASEO_HOME;else process.env.PASEO_HOME=prior;await rm(directory,{recursive:true,force:true});}
});


test('batch search cards retain every returned summary without collecting until selection and recover stored pages',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'tapd-batch-'));const prior=process.env.PASEO_HOME;process.env.PASEO_HOME=directory;clearTapdCache();let reads=0;
 t.mock.method(globalThis,'fetch',async source=>{reads++;const u=new URL(source);return Response.json({status:1,data:u.pathname==='/stories'?Array.from({length:5},(_,i)=>({Story:{id:String(11111111+i),name:'示例需求 '+i,status:'open'}})):u.pathname==='/tasks'?Array.from({length:3},(_,i)=>({Task:{id:String(22222222+i),name:'示例任务 '+i,status:'open'}})):[]});});
 const h=host();let p=plugin();
 try{
  const {tools}=await p.before.get('agent.session_open')({request:{purpose:'interactive',tools:[],env:{}}},ctx(h));
  const result=await tools.find(x=>x.name==='tapd_search').execute({query:'示例'},{...ctx(h),agent:{id:'example-agent'}});
  assert.equal(result.isError,undefined);assert.equal(result.structuredContent.items.length,8);
  const card=h.rows.get('example-agent')?.[0];assert.equal(card?.kind,'tapd-batch-result');assert.equal(card.data.items.length,5);assert.equal(card.data.returned,8);assert.equal(card.data.truncated,true);assert.equal(card.data.total,null);
  assert.equal((await p.rpcs.get('tapd.conversations')({},ctx(h))).conversations[0].entities.length,0);
  const beforeReads=reads;const input={agentId:'example-agent',batchId:card.data.batchId,siteUrl:card.data.siteUrl,apiEndpoint:card.data.apiEndpoint,offset:5};
  const page=await p.rpcs.get('tapd.conversation.batch_page')(input,ctx(h));assert.equal(page.items.length,3);assert.equal(page.nextOffset,null);
  const entity={siteUrl:card.data.siteUrl,apiEndpoint:card.data.apiEndpoint,...page.items[2]};
  await p.rpcs.get('tapd.conversation.focus')({agentId:'example-agent',entity},ctx(h));
  assert.equal((await p.rpcs.get('tapd.conversations')({},ctx(h))).conversations[0].entities[0].id,'22222224');
  p.close();p=plugin();h.rows.clear();await p.rpcs.get('tapd.conversations')({},ctx(h));
  assert.equal(h.rows.get('example-agent')[0].kind,'tapd-batch-result');assert.deepEqual(await p.rpcs.get('tapd.conversation.batch_page')(input,ctx(h)),page);assert.equal(reads,beforeReads);
  await assert.rejects(p.rpcs.get('tapd.conversation.batch_page')({...input,agentId:'example-other-agent'},ctx(h)),/不可用/);
 }finally{p.close();if(prior===undefined)delete process.env.PASEO_HOME;else process.env.PASEO_HOME=prior;await rm(directory,{recursive:true,force:true});}
});

test('large board keeps all returned rows behind byte-bounded timeline preview and guarded stored pages',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'tapd-batch-large-'));const prior=process.env.PASEO_HOME;process.env.PASEO_HOME=directory;clearTapdCache();let reads=0;
 t.mock.method(globalThis,'fetch',async source=>{reads++;const u=new URL(source);if(u.pathname==='/bugs')throw new Error('private API failure');return Response.json({status:1,data:u.pathname==='/stories/count'?{count:1000}:u.pathname==='/stories'?Array.from({length:200},(_,i)=>({Story:{id:String(11111111+i),name:'示'.repeat(500),status:'open',description:'不可持久化正文'}})):[]});});
 const h=host();let p=plugin();
 try{
  const {tools}=await p.before.get('agent.session_open')({request:{purpose:'interactive',tools:[],env:{}}},ctx(h));
  const result=await tools.find(x=>x.name==='tapd_board').execute({filters:{ownerMode:'all',statusScope:'all'}},{...ctx(h),agent:{id:'example-agent'}});
  assert.equal(result.isError,undefined);assert.ok(Buffer.byteLength(JSON.stringify(result.structuredContent),'utf8')>64000);
  const card=h.rows.get('example-agent')?.[0];assert.equal(card?.kind,'tapd-batch-result');assert.ok(Buffer.byteLength(JSON.stringify(card.data),'utf8')<64000);assert.equal(card.data.returned,200);assert.equal(card.data.total,1000);assert.equal(card.data.partial,true);assert.equal(card.data.truncated,true);
  const input={agentId:'example-agent',batchId:card.data.batchId,siteUrl:card.data.siteUrl,apiEndpoint:card.data.apiEndpoint};let offset=5;const ids=card.data.items.map(x=>x.id);const beforeReads=reads;
  while(offset!==null){const page=await p.rpcs.get('tapd.conversation.batch_page')({...input,offset},ctx(h));ids.push(...page.items.map(x=>x.id));offset=page.nextOffset;}
  assert.equal(ids.length,200);assert.equal(ids.at(-1),'11111310');assert.equal(reads,beforeReads);
  assert.equal((await p.rpcs.get('tapd.conversations')({},ctx(h))).conversations[0].entities.length,0);
  await assert.rejects(p.rpcs.get('tapd.conversation.batch_page')({...input,siteUrl:'https://other.example.com',offset:5},ctx(h)),/不可用/);
  await assert.rejects(p.rpcs.get('tapd.conversation.batch_page')({...input,offset:-1},ctx(h)),/不可用/);
  const entity={siteUrl:card.data.siteUrl,apiEndpoint:card.data.apiEndpoint,...card.data.items[0]};await p.rpcs.get('tapd.conversation.focus')({agentId:'example-agent',entity},ctx(h));await p.rpcs.get('tapd.conversation.focus')({agentId:'example-agent',entity},ctx(h));assert.equal((await p.rpcs.get('tapd.conversations')({},ctx(h))).conversations[0].entities.length,1);
  p.close();p=plugin();h.rows.clear();await p.rpcs.get('tapd.conversations')({},ctx(h));assert.equal(h.rows.get('example-agent')[0].data.partial,true);assert.equal((await p.rpcs.get('tapd.conversation.batch_page')({...input,offset:195},ctx(h))).items.at(-1).id,'11111310');assert.equal(reads,beforeReads);
  const {readFile}=await import('node:fs/promises');const persisted=await readFile(join(directory,'plugin-data/tapd-workbench/conversations.json'),'utf8');assert.equal(persisted.includes('不可持久化正文'),false);assert.equal(persisted.includes('private API failure'),false);assert.equal(persisted.includes(values.token),false);
 }finally{p.close();if(prior===undefined)delete process.env.PASEO_HOME;else process.env.PASEO_HOME=prior;await rm(directory,{recursive:true,force:true});}
});

test('empty successful search and failed empty search produce visibly different batch metadata',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'tapd-batch-empty-'));const prior=process.env.PASEO_HOME;process.env.PASEO_HOME=directory;clearTapdCache();let failed=false;
 t.mock.method(globalThis,'fetch',async source=>{const u=new URL(source);if(failed&&['/stories','/tasks','/bugs'].includes(u.pathname))throw new Error('private failure');return Response.json({status:1,data:[]});});
 const h=host(),p=plugin();
 try{
  const {tools}=await p.before.get('agent.session_open')({request:{purpose:'interactive',tools:[],env:{}}},ctx(h));const search=tools.find(x=>x.name==='tapd_search');
  await search.execute({query:'empty'},{...ctx(h),agent:{id:'example-agent'}});assert.equal(h.rows.get('example-agent')[0].data.partial,false);assert.equal(h.rows.get('example-agent')[0].data.returned,0);
  failed=true;clearTapdCache();await search.execute({query:'failed'},{...ctx(h),agent:{id:'example-agent'}});const card=h.rows.get('example-agent')[1];assert.equal(card.data.partial,true);assert.equal(card.data.returned,0);assert.ok(card.data.warnings.length);assert.equal(JSON.stringify(card).includes('private failure'),false);
 }finally{p.close();if(prior===undefined)delete process.env.PASEO_HOME;else process.env.PASEO_HOME=prior;await rm(directory,{recursive:true,force:true});}
});
