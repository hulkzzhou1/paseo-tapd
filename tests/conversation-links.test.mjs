import assert from 'node:assert/strict';
import {test} from 'node:test';
import {registerHooks} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/.test(s))return n(s+'.ts',c);throw e;}}});
const {default:contribute}=await import('../index.server.ts');
const {tapdSettingsSchema}=await import('../shared/contracts.ts');
const settings=tapdSettingsSchema.parse({token:'example-secret',workspaceIds:'12345678',siteUrl:'https://example.com',apiEndpoint:'https://api.example.com'});
for(const key of ['TAPD_TOKEN','TAPD_WORKSPACE_IDS','TAPD_API_ENDPOINT','TAPD_SITE_URL'])delete process.env[key];
const link=id=>`https://example.com/tapd_fe/12345678/story/detail/${id}`;
function host(){
 const messages=[],listeners=new Set();let directoryListener;let offset=0;const agents=new Map([['example-agent',{id:'example-agent',workspaceId:'example-workspace',archivedAt:null}]]);
 const ref=id=>({address:{serverId:'example-host',agentId:id},get workspaceId(){return agents.get(id)?.workspaceId??null;},get activeTurn(){return agents.get(id)?.activeTurn??null;},refresh:async()=>agents.has(id)?{agent:agents.get(id)}:null,
 timeline:{subscribe(fn){listeners.add(fn);return Object.assign(()=>listeners.delete(fn),{ready:Promise.resolve(),release:async()=>{listeners.delete(fn);}});},append:async()=>{},
 refetch:async({cursor,direction}={})=>{const end=direction==='before'?cursor.seq-1-offset:messages.length;const start=Math.max(0,end-2);return {entries:messages.slice(start,end).map((item,i)=>({item,seqStart:offset+start+i+1,seqEnd:offset+start+i+1})),epoch:'example-epoch',hasOlder:start>0,hasNewer:false,startCursor:{epoch:'example-epoch',seq:offset+start+1},endCursor:{epoch:'example-epoch',seq:offset+end}};}}});
 return {messages,listeners,agents,reindex:value=>{offset=value;},emit:event=>{for(const fn of listeners)fn({agentId:'example-agent',event});},directory:()=>directoryListener,paseo:{agents:{ref,list:async()=>({entries:[...agents.values()].map(agent=>({agent})),pageInfo:{hasMore:false},subscription:{ready:Promise.resolve(),subscribe:x=>{directoryListener=x;},release:async()=>{}}})}}};
}
function plugin(){const rpcs=new Map(),events=new Map(),before=new Map();const close=contribute({registerSettings:()=>({read:async()=>({status:'ready',values:settings}),subscribe:()=>()=>{}}),handle:(r,f)=>rpcs.set(r.name,f),on:(n,f)=>events.set(n,f),before:(n,f)=>before.set(n,f)});return {rpcs,events,before,close};}
const ctx=h=>({paseo:h.paseo,signal:new AbortController().signal});
async function fixture(t,run){const dir=await mkdtemp(join(tmpdir(),'tapd-links-'));const prior=process.env.PASEO_HOME;process.env.PASEO_HOME=dir;let requests=0;let onFetch=()=>{throw new Error('Link scanning must not request TAPD');};t.mock.method(globalThis,'fetch',async source=>{requests++;return onFetch(source);});const h=host();let p=plugin();const api={h,get p(){return p;},list:()=>p.rpcs.get('tapd.conversations')({},ctx(h)),restart(){p.close();p=plugin();},requests:()=>requests,allowRead(){onFetch=source=>{const u=new URL(source);return Response.json({status:1,data:u.pathname==='/stories'&&u.searchParams.has('id')?[{Story:{id:u.searchParams.get('id'),name:'已有摘要',status:'open'}}]:[]});};}};try{await run(api);}finally{p.close();if(prior===undefined)delete process.env.PASEO_HOME;else process.env.PASEO_HOME=prior;await rm(dir,{recursive:true,force:true});}}
const ids=result=>result.conversations.flatMap(x=>x.entities.map(y=>y.id));
test('ordinary configured user and assistant URLs collect from complete paged history without TAPD reads',async t=>fixture(t,async({h,list,requests})=>{
 h.messages.push({type:'user_message',messageId:'example-user-1',text:`[需求](${link('11111111')})`},
 {type:'tool_call',text:link('99999999')},{type:'reasoning',text:link('88888888')},
 {type:'assistant_message',messageId:'example-assistant-1',text:`${link('22222222')} https://other.example.com/tapd_fe/12345678/story/detail/33333333 https://example.com/tapd_fe/87654321/story/detail/44444444`},
 {type:'user_message',messageId:'example-user-2',text:'11111111 https://example.com/unrelated/55555555'});
 assert.deepEqual(ids(await list()),['22222222','11111111']);assert.equal(requests(),0);assert.equal(h.messages[0].text,`[需求](${link('11111111')})`);
}));
test('live streaming, replay and restart preserve removal, while a new explicit message recollects',async t=>fixture(t,async(api)=>{
 const {h,p,list,restart,requests}=api;
 await list();
 h.agents.get('example-agent').activeTurn={id:'example-turn'};
 h.messages.push({type:'assistant_message',messageId:'example-stream',text:link('1111').slice(0,-2)});h.emit({type:'timeline',item:h.messages[0]});
 assert.deepEqual(ids(await list()),[],'an unterminated streamed numeric URL is not a complete reference');
 h.messages[0].text=link('11111111');h.emit({type:'timeline',item:h.messages[0]});
 await p.events.get('agent.turn_ended')({agent:{id:'example-agent'},outcome:'completed',timeline:[]},ctx(h));
 assert.deepEqual(ids(await list()),['11111111']);
 const entity=(await list()).conversations[0].entities[0];
 await p.rpcs.get('tapd.conversation.remove')({agentId:'example-agent',entity},ctx(h));
 h.messages[0].text+='更多文字';h.emit({type:'timeline',item:h.messages[0]});
 h.emit({type:'subscription_restored'});
 await p.events.get('agent.turn_ended')({agent:{id:'example-agent'},outcome:'completed',timeline:[]},ctx(h));
 assert.deepEqual(ids(await list()),[]);
 restart();assert.deepEqual(ids(await list()),[]);
 h.messages.push({type:'user_message',clientMessageId:'example-new-mention',text:link('11111111')});h.emit({type:'timeline',item:h.messages[1]});
 // Reconnect must catch history missed while disconnected and not assume a fixed tail window.
 for(let i=0;i<5;i++)h.messages.push({type:'user_message',messageId:`example-padding-${i}`,text:'普通消息'});
 h.messages.splice(2,0,{type:'assistant_message',messageId:'example-missed-mention',text:link('22222222')});h.emit({type:'subscription_restored'});
 await api.p.events.get('agent.turn_ended')({agent:{id:'example-agent'},outcome:'completed',timeline:[]},ctx(h));
 assert.deepEqual(ids(await list()),['22222222','11111111']);assert.equal(requests(),0);
}));
test('archive and provider closure release live message observation without deleting collected references',async t=>fixture(t,async({h,p,list})=>{
 h.messages.push({type:'user_message',messageId:'example-life',text:link('11111111')});assert.deepEqual(ids(await list()),['11111111']);assert.equal(h.listeners.size,1);
 h.agents.get('example-agent').status='closed';await p.events.get('agent.closed')({agent:{id:'example-agent'}},ctx(h));
 assert.equal(h.listeners.size,0);assert.deepEqual(ids(await list()),['11111111']);
 h.agents.get('example-agent').archivedAt='2026-01-01';await p.events.get('agent.archived')({agent:{id:'example-agent'}},ctx(h));assert.equal(h.listeners.size,0);
}));

test('a new ordinary mention reuses a removed tool summary without requesting TAPD again',async t=>fixture(t,async({h,p,list,allowRead,requests})=>{
 allowRead();const {tools}=await p.before.get('agent.session_open')({request:{purpose:'interactive',agentId:'example-agent',tools:[],env:{}}},ctx(h));
 const result=await tools.find(x=>x.name==='tapd_entity').execute({kind:'story',id:'11111111'},{...ctx(h),agent:{id:'example-agent'}});assert.equal(result.isError,undefined);
 const entity=(await list()).conversations[0].entities[0];await p.rpcs.get('tapd.conversation.remove')({agentId:'example-agent',entity},ctx(h));const count=requests();
 h.messages.push({type:'user_message',messageId:'example-after-tool',text:link('11111111')});h.emit({type:'timeline',item:h.messages[0]});
 const refreshed=await list();assert.equal(refreshed.conversations[0].entities[0].title,'已有摘要');assert.equal(refreshed.conversations[0].entities[0].status,'open');assert.equal(requests(),count);
}));
test('a failed live subscription recovers through the next public RPC and catches missed history',async t=>fixture(t,async({h,list,requests})=>{
 await list();h.emit({type:'error',error:'example temporary disconnect'});assert.equal(h.listeners.size,0);
 h.messages.push({type:'user_message',messageId:'example-after-disconnect',text:link('33333333')});
 assert.deepEqual(ids(await list()),['33333333']);assert.equal(h.listeners.size,1);assert.equal(requests(),0);
}));

test('replacement can change sequence positions without resurrecting removed anonymous messages; a new identical mention still collects',async t=>fixture(t,async({h,p,list})=>{
 h.messages.push({type:'assistant_message',text:link('11111111')});assert.deepEqual(ids(await list()),['11111111']);
 const entity=(await list()).conversations[0].entities[0];await p.rpcs.get('tapd.conversation.remove')({agentId:'example-agent',entity},ctx(h));
 h.reindex(100);h.messages.unshift({type:'reasoning',text:'替换后的内部记录'});h.emit({type:'replacement',epoch:'example-replacement'});
 assert.deepEqual(ids(await list()),[]);
 h.messages.push({type:'user_message',text:'新的讨论'},{type:'assistant_message',text:link('11111111')});h.emit({type:'timeline',item:h.messages.at(-1)});
 assert.deepEqual(ids(await list()),['11111111']);
}));
