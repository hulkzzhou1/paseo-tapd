import assert from 'node:assert/strict';
import {test} from 'node:test';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/.test(s))return n(s+'.ts',c);throw e;}}});
const{createTapdTools}=await import('../server/agent-tools.ts');
const{createAssignmentTools}=await import('../server/agent-assignment.ts');
const{createHandlers}=await import('../server/handlers.ts');
const{tapdSettingsSchema}=await import('../shared/contracts.ts');
const{conversationEntitySchema}=await import('../shared/conversation.ts');
const{clearTapdCache}=await import('../server/tapd.ts');
for(const key of ['TAPD_TOKEN','TAPD_API_ENDPOINT','TAPD_SITE_URL','TAPD_WORKSPACE_IDS'])delete process.env[key];
const values=tapdSettingsSchema.parse({token:'example-secret',workspaceIds:'12345678',apiEndpoint:'https://api.example.com',siteUrl:'https://example.com'});
const target={kind:'story',id:'11111111',workspaceId:'12345678'};
function fixture(t){
 clearTapdCache();const state={value:'',kind:'story',requests:[]};
 t.mock.method(globalThis,'fetch',async(input,init)=>{
  const url=new URL(input),body=new URLSearchParams(init.body);state.requests.push({url,method:init.method,body});assert.equal(url.origin,values.apiEndpoint);
  assert.notEqual(url.pathname,'/label','display must not issue extra label-definition requests');
  let data=[];
  if(['/stories','/tasks','/bugs'].includes(url.pathname)&&url.searchParams.has('id'))data=[{[url.pathname==='/tasks'?'Task':url.pathname==='/bugs'?'Bug':'Story']:{id:target.id,workspace_id:target.workspaceId,name:'Example',title:'Example',status:'open',workitem_type_id:'77777777',label:state.value}}];
  if(init.method==='POST'){state.value=body.get('label');data={Story:{id:target.id}};}
  if(url.pathname.endsWith('/get_fields_info'))data={status:{options:{open:'进行中',done:'已完成'}}};
  if(url.pathname==='/workflows/last_steps')data={done:'已完成'};
  return Response.json({status:1,data});
 });
 const link={key:'story-11111111',kind:'story',id:target.id,tapdWorkspaceId:target.workspaceId,apiEndpoint:values.apiEndpoint,siteUrl:values.siteUrl,agentId:'example-agent',agentTitle:'Example Agent',workspaceId:'example-workspace',workspaceTitle:'Example',createdAt:'2026-01-01',responsibility:{confirmedAt:'2026-01-01',actorAgentId:'example-agent',revision:'one'}};
 const currentLinks=()=>[{...link,kind:state.kind,key:state.kind+'-'+target.id}];
 const links={list:async()=>currentLinks(),state:async()=>({version:1,links:currentLinks(),suppressed:[],history:[],offers:[],imports:[],legacyArchive:[],deletedAgents:[]}),stateTransaction:async()=>assert.fail('label display must not write ownership state')};
 const tools=[...createTapdTools(async()=>values),...createAssignmentTools(async()=>values,links)];
 const rows=[];
 const context={signal:new AbortController().signal,agent:{id:'example-agent'},paseo:{agents:{ref:()=>({workspaceId:'example-workspace',refresh:async()=>{},current:()=>({id:'example-agent'}),timeline:{append:async row=>rows.push(row)}})}}};
 return{state,rows,handlers:createHandlers(async()=>values),call:(name,input={})=>tools.find(x=>x.name===name).execute(input,context)};
}
test('existing board summary and detail reads expose real labels without extra label requests or classification changes',async t=>{
 const{state,call,handlers}=fixture(t);
 const long='x'.repeat(200);
 for(const kind of ['story','task','bug'])for(const[value,expected]of [['',[]],['one',['one']],['one|two|three',['one','two','three']],['done|matt:completed',['done','matt:completed']],[long,[long]],[null,null],[undefined,null],['invalid||value',null],[values.token,null]]){
  state.kind=kind;state.value=value;
  const board=(await call('tapd_task_board')).structuredContent;
  assert.deepEqual(board.items[0].entity.labels,expected);assert.equal(board.items[0].classification,'unfinished');
  const detail=await handlers.entity({...target,kind,fresh:true});assert.deepEqual(detail.labels,expected);
 }
 assert.ok(state.requests.filter(x=>x.url.pathname==='/stories'&&x.url.searchParams.get('fields')?.includes('status,owner')).every(x=>x.url.searchParams.get('fields').split(',').includes('label')));
 assert.equal(state.requests.some(x=>x.method==='POST'),false);
});
test('after approved label mutation the next summary/detail read and new card show current data, old payload stays absent',async t=>{
 const{state,rows,call,handlers}=fixture(t);state.value='human';
 const changed=await call('tapd_update_labels',{...target,expectedValue:'human',add:['review:ready'],confirmed:true});assert.equal(changed.structuredContent.outcome,'verified');
 const board=(await call('tapd_task_board')).structuredContent;assert.deepEqual(board.items[0].entity.labels,['human','review:ready']);
 const detail=await call('tapd_entity',{kind:target.kind,id:target.id});assert.deepEqual(detail.structuredContent.labels,['human','review:ready']);assert.deepEqual(rows.at(-1).data.entity.labels,['human','review:ready']);
 const original=conversationEntitySchema.parse({siteUrl:values.siteUrl,apiEndpoint:values.apiEndpoint,...target});assert.equal(Object.hasOwn(original,'labels'),false,'old records must not gain an invented empty label set');
 assert.deepEqual((await handlers.entity({...target,fresh:true})).labels,['human','review:ready']);assert.equal(state.requests.filter(x=>x.method==='POST').length,1);
});
