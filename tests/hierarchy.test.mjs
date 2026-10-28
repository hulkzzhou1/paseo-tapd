import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
registerHooks({resolve(s,c,next){try{return next(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/.test(s))return next(s+'.ts',c);throw e;}}});
const {createTapdTools}=await import('../server/agent-tools.ts');
const {tapdSettingsSchema}=await import('../shared/contracts.ts');
const {clearTapdCache}=await import('../server/tapd.ts');
for(const key of ['TAPD_TOKEN','TAPD_API_ENDPOINT','TAPD_SITE_URL','TAPD_WORKSPACE_IDS'])delete process.env[key];
const values=tapdSettingsSchema.parse({token:'example-secret',workspaceIds:'12345678',apiEndpoint:'https://api.example.com',siteUrl:'https://example.com'});
const project='12345678',parent='11111111',parentType='22222222',childType='33333333';
function fixture(t){
 clearTapdCache();
 const state={requests:[],types:[{id:parentType,workspace_id:project,name:'父类别',status:'3',children_ids:'',parent_ids:''},{id:childType,workspace_id:project,name:'子类别',status:'3',children_ids:'|',parent_ids:parentType}]};
 t.mock.method(globalThis,'fetch',async(input,init)=>{
  const url=new URL(input),body=new URLSearchParams(init.body);state.requests.push({url,body,method:init.method});
  if(url.pathname==='/workitem_types'&&state.typeFailure)throw Error('private example-secret');
  if(url.pathname==='/workitem_types')return Response.json({status:1,data:state.types.map(WorkitemType=>({WorkitemType}))});
  if(url.pathname.endsWith('get_fields_info'))return Response.json({status:1,data:state.fields??{[url.pathname.startsWith('/bugs')?'title':'name']:{required:1,readonly:0,html_type:'text'}}});
  if(init.method==='POST'){if(state.writeFailure)throw Error('private example-secret');state.created={id:'44444444',workspace_id:project,parent_id:body.get('parent_id'),workitem_type_id:body.get('workitem_type_id'),name:body.get('name'),story_id:body.get('story_id')};if(state.wrongParent)state.created.parent_id='99999999';return Response.json({status:1,data:{[url.pathname==='/tasks'?'Task':url.pathname==='/bugs'?'Bug':'Story']:state.created}});}
  if(url.pathname==='/stories/count')return Response.json({status:1,data:state.count===undefined?{}:{count:state.count}});
  if(url.pathname==='/stories'&&url.searchParams.has('parent_id')){if(url.searchParams.get('page')==='2'&&state.secondPageFailure)throw Error('private example-secret');return Response.json({status:1,data:(state.childPages?.[url.searchParams.get('page')]??state.children??[]).map(Story=>({Story}))});}
  if(url.pathname==='/stories'&&url.searchParams.get('id')===parent)return Response.json({status:1,data:[{Story:{id:parent,workspace_id:project,workitem_type_id:parentType,name:'父需求'}}]});
  if(['/tasks','/bugs'].includes(url.pathname)&&url.searchParams.has('id')&&state.created)return Response.json({status:1,data:[{[url.pathname==='/tasks'?'Task':'Bug']:state.created}]});
  if(url.pathname==='/stories'&&state.created)return Response.json({status:1,data:[{Story:state.created}]});
  return Response.json({status:1,data:[]});
 });
 const tools=createTapdTools(async()=>values);
 return {state,call:(name,input)=>tools.find(x=>x.name===name).execute(input,{signal:new AbortController().signal})};
}
test('approved real child story creation validates both category directions and verifies the actual parent',async t=>{
 const {call,state}=fixture(t);
 const result=await call('tapd_create',{kind:'story',workspaceId:project,title:'独立交付',parentStoryId:parent,workitemTypeId:childType,confirmed:true});
 assert.equal(result.isError,undefined);assert.equal(result.structuredContent.outcome,'verified');
 const writes=state.requests.filter(x=>x.method==='POST');assert.equal(writes.length,1);
 assert.equal(writes[0].body.get('parent_id'),parent);assert.equal(writes[0].body.get('workitem_type_id'),childType);
 assert.equal(writes[0].body.has('story_id'),false);assert.equal(writes[0].body.has('status'),false);
});
test('shared creation RPC validates and verifies task/bug parent links so UI cannot bypass the project check',async t=>{
 const {state}=fixture(t);const{createHandlers}=await import('../server/handlers.ts');const handlers=createHandlers(async()=>values);
 for(const kind of ['task','bug']){
  const result=await handlers.create({kind,workspaceId:project,title:'独立子单',storyId:parent,owner:'',priority:'',iterationId:'',description:''});assert.equal(result.outcome,'verified');
  const post=state.requests.filter(x=>x.method==='POST').at(-1);assert.equal(post.body.get('story_id'),parent);assert.equal(post.body.has('parent_id'),false);
 }
 const writes=state.requests.filter(x=>x.method==='POST').length;await assert.rejects(handlers.create({kind:'task',workspaceId:'99999999',title:'错误项目',storyId:parent,owner:'',priority:'',iterationId:'',description:''}));assert.equal(state.requests.filter(x=>x.method==='POST').length,writes);
});
test('either category restriction, disabled or missing metadata prevents child writes',async t=>{
 const {call,state}=fixture(t);const input={kind:'story',workspaceId:project,title:'子需求',parentStoryId:parent,workitemTypeId:childType,confirmed:true};
 for(const patch of [{children_ids:'|'}, {children_ids:'99999999'}, {children_ids:null}, {status:'2'}]){
  const old=state.types[0];state.types[0]={...old,...patch};assert.equal((await call('tapd_create',input)).isError,true);state.types[0]=old;
 }
 for(const patch of [{parent_ids:'99999999'}, {parent_ids:null}, {status:'2'}, {workspace_id:'99999999'}]){
  const old=state.types[1];state.types[1]={...old,...patch};assert.equal((await call('tapd_create',input)).isError,true);state.types[1]=old;
 }
 state.typeFailure=true;assert.equal((await call('tapd_create',input)).isError,true);
 assert.equal(state.requests.filter(x=>x.method==='POST').length,0);
});
test('accepted child creation with wrong relation remains unverified and unknown transport never retries',async t=>{
 const {call,state}=fixture(t);const input={kind:'story',workspaceId:project,title:'子需求',parentStoryId:parent,workitemTypeId:childType,confirmed:true};
 state.wrongParent=true;const result=await call('tapd_create',input);assert.equal(result.structuredContent.writeState,'accepted');assert.equal(result.structuredContent.outcome,'unverified');assert.equal(result.structuredContent.ok,false);
 state.writeFailure=true;const failed=await call('tapd_create',input);assert.equal(failed.structuredContent.failure.writeState,'unknown');assert.equal(JSON.stringify(failed).includes('example-secret'),false);
 assert.equal(state.requests.filter(x=>x.method==='POST').length,2);
});
test('child reads retain a successful page after failure, expose unknown totals and never write or claim',async t=>{
 const {call,state}=fixture(t);state.children=Array.from({length:100},(_,i)=>({id:String(50000000+i),workspace_id:project,parent_id:parent,name:'子需求',status:'done'}));state.secondPageFailure=true;
 const result=await call('tapd_children',{workspaceId:project,id:parent});
 assert.equal(result.isError,undefined);assert.equal(result.structuredContent.items.length,100);assert.equal(result.structuredContent.reads.story.total,null);assert.equal(result.structuredContent.reads.story.partial,true);assert.equal(result.structuredContent.reads.story.truncated,true);
 assert.ok(result.structuredContent.items.every(x=>x.responsibleAgent===null));assert.ok(state.requests.every(x=>x.method!=='POST'));
 assert.ok(state.requests.filter(x=>x.url.searchParams.has('parent_id')).every(x=>!x.url.searchParams.has('ancestor_id')));
});
test('child rows with incorrect project or parent are excluded without reporting an empty complete set',async t=>{
 const {call,state}=fixture(t);state.children=[{id:'55555555',workspace_id:'99999999',parent_id:parent},{id:'66666666',workspace_id:project,parent_id:'99999999'}];
 const result=await call('tapd_children',{workspaceId:project,id:parent});assert.deepEqual(result.structuredContent.items,[]);assert.equal(result.structuredContent.reads.story.partial,true);assert.equal(result.structuredContent.reads.story.total,null);
});
test('full child pages retain all rows when count is unknown and expose a reliable larger total when available',async t=>{
 const {call,state}=fixture(t);const rows=Array.from({length:200},(_,i)=>({id:String(50000000+i),workspace_id:project,parent_id:parent,name:'子需求'}));state.childPages={'1':rows.slice(0,100),'2':rows.slice(100)};
 const first=await call('tapd_children',{workspaceId:project,id:parent});assert.equal(first.structuredContent.items.length,200);assert.equal(first.structuredContent.reads.story.total,null);assert.equal(first.structuredContent.reads.story.partial,true);
 state.count=250;const second=await call('tapd_children',{workspaceId:project,id:parent});assert.equal(second.structuredContent.reads.story.total,250);assert.equal(second.structuredContent.reads.story.truncated,true);assert.equal(second.structuredContent.reads.story.partial,false);
});
test('child creation refuses required fields and incomplete or duplicate category candidates before POST',async t=>{
 const {call,state}=fixture(t);const input={kind:'story',workspaceId:project,title:'子需求',parentStoryId:parent,workitemTypeId:childType,confirmed:true};
 state.fields={custom_field_required:{required:1,readonly:0,html_type:'text'}};assert.equal((await call('tapd_create',input)).isError,true);
 state.fields={};state.types=Array.from({length:200},()=>state.types[0]);assert.equal((await call('tapd_create',input)).isError,true);assert.equal(state.requests.filter(x=>x.method==='POST').length,0);
});
test('child owners come only from the actual confirmed association, never from the parent or unresolved candidate',async t=>{
 const {state}=fixture(t);const{createHandlers}=await import('../server/handlers.ts');state.children=[{id:'55555555',workspace_id:project,parent_id:parent}];
 const link={kind:'story',id:parent,tapdWorkspaceId:project,apiEndpoint:values.apiEndpoint,siteUrl:values.siteUrl,agentId:'example-parent-agent',agentTitle:'统筹',responsibility:{revision:'one'}};
 let links=[link];const handlers=createHandlers(async()=>values,{}, {list:async()=>links});
 const first=await handlers.children({workspaceId:project,id:parent});assert.equal(first.items[0].responsibleAgent,null);assert.equal(first.items[0].ownershipUnknown,false);
 links=[link,{...link,id:'55555555',agentId:'example-child-agent',agentTitle:'执行'}];const second=await handlers.children({workspaceId:project,id:parent});assert.equal(second.items[0].responsibleAgent.id,'example-child-agent');
 links=[{...links[1],responsibility:undefined}];const historical=await handlers.children({workspaceId:project,id:parent});assert.equal(historical.items[0].responsibleAgent,null);assert.equal(historical.items[0].ownershipUnknown,true);assert.equal(state.requests.some(x=>x.method==='POST'),false);
 const legacyValues={...values,links:[{...link,id:'55555555',key:'story-55555555'}]};
 const pending=createHandlers(async()=>legacyValues,{}, {list:async()=>[]});assert.equal((await pending.children({workspaceId:project,id:parent})).items[0].ownershipUnknown,true,'unimported settings candidates cannot look unassigned');
 const suppressed=createHandlers(async()=>legacyValues,{}, {list:async()=>[],state:async()=>({links:[],suppressed:[{apiEndpoint:values.apiEndpoint,siteUrl:values.siteUrl,tapdWorkspaceId:project,kind:'story',id:'55555555'}]})});
 assert.equal((await suppressed.children({workspaceId:project,id:parent})).items[0].ownershipUnknown,false,'suppressed settings must not restore old responsibility');
});
