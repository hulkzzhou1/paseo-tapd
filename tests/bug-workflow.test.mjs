import assert from 'node:assert/strict';
import {test} from 'node:test';
import {registerHooks} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/.test(s))return n(s+'.ts',c);throw e;}}});
const {default:contribute}=await import('../index.server.ts');
const {tapdSettingsSchema}=await import('../shared/contracts.ts');
const {clearTapdCache}=await import('../server/tapd.ts');
const target={kind:'bug',workspaceId:'12345678',id:'11111111'};
async function fixture(t){
 const home=await mkdtemp(join(tmpdir(),'tapd-workflow-')),env={...process.env};process.env.PASEO_HOME=home;
 for(const k of ['TAPD_TOKEN','TAPD_API_ENDPOINT','TAPD_SITE_URL','TAPD_WORKSPACE_IDS'])delete process.env[k];
 const values=tapdSettingsSchema.parse({token:'example-secret',workspaceIds:target.workspaceId,apiEndpoint:'https://api.example.com',siteUrl:'https://example.com'});
 const state={omitReadonly:false,remarksMetadata:undefined,status:'in_progress',posts:[],reads:[],ruleFailure:false,readbackFailure:false,afterPost:false,
  transitions:[{Name:'in_progress-status_5',StepPrevious:'in_progress',StepNext:'status_5',Appendfield:[{DBModel:'Bug',FieldName:'remarks',Notnull:'yes'}]},
   {Name:'status_5-closed',StepPrevious:'status_5',StepNext:'closed',Appendfield:[]}]};
 clearTapdCache();t.mock.method(globalThis,'fetch',async(source,init)=>{
  const u=new URL(source);assert.equal(u.origin,values.apiEndpoint);let data=[];
  if(init.method==='POST'){
   const body=new URLSearchParams(init.body);state.posts.push({path:u.pathname,body});
   if(u.pathname!=='/bugs'||!body.get('remarks'))return Response.json({status:0},{status:403});
   state.status=body.get('status');state.afterPost=true;data={Bug:{id:target.id,workspace_id:target.workspaceId,status:state.status}};
  }else{
   state.reads.push(u.pathname);
   if(state.readbackFailure&&state.afterPost&&u.pathname==='/bugs')return Response.json({status:0},{status:503});
   if(u.pathname==='/bugs')data=[{Bug:{id:target.id,workspace_id:target.workspaceId,title:'Example defect',status:state.status,current_owner:'example-member',description:'Example body'}}];
   else if(u.pathname==='/bugs/get_fields_info')data={status:{options:{in_progress:'处理中',status_5:'已解决',closed:'已关闭'}},current_owner:{label:'处理人',html_type:'user_chooser',readonly:0},resolution:{label:'解决方法',html_type:'radio',readonly:0,options:{fixed:'已修复',duplicated:'重复'}},custom_field_one:{label:'说明',html_type:'text',readonly:0},enable_add_timesheet:{html_type:'text',readonly:0},transition_description:{html_type:'text',readonly:0},...(state.remarksMetadata?{remarks:state.remarksMetadata}:{})};
   else if(u.pathname==='/workflows/all_transitions'){
    if(state.ruleFailure)return Response.json({status:0},{status:403});data=state.transitions;
   }else if(u.pathname==='/users/info')data={nick:'example-member'};
  }
  if(state.omitReadonly&&u.pathname==='/bugs/get_fields_info')for(const info of Object.values(data))delete info.readonly;
  return Response.json({status:1,data});
 });
 const ref=id=>({id,workspaceId:'example-workspace',address:{serverId:'example-host'},current:()=>({id}),refresh:async()=>({agent:{id}}),timeline:{append:async()=>({epoch:'example',seq:1}),refetch:async()=>({entries:[],hasOlder:false})}});
 const context={agent:{id:'example-agent'},signal:new AbortController().signal,paseo:{agents:{ref,list:async()=>({entries:[],pageInfo:{hasMore:false},subscription:{ready:Promise.resolve(),subscribe:()=>()=>{},release:async()=>{}}})}}};
 const rpcs=new Map();let before;
 const close=contribute({registerSettings:()=>({read:async()=>({status:'ready',values}),subscribe:()=>()=>{}}),handle:(rpc,fn)=>rpcs.set(rpc.name,async input=>rpc.output.parse(await fn(rpc.input.parse(input),context))),before:(_,fn)=>before=fn,on:()=>{}});
 const tools=(await before({request:{purpose:'interactive',agentId:context.agent.id,tools:[],env:{}}},context)).tools;
 t.after(async()=>{close();for(const k of ['PASEO_HOME','TAPD_TOKEN','TAPD_API_ENDPOINT','TAPD_SITE_URL','TAPD_WORKSPACE_IDS']){if(env[k]===undefined)delete process.env[k];else process.env[k]=env[k];}await rm(home,{recursive:true,force:true});});
 return {state,values,rpc:(name,input)=>rpcs.get(name)(input),tool:(name,input)=>tools.find(t=>t.name===name).execute(input,context)};
}
test('item-specific defect status options use current workflow edges and expose required remarks',async t=>{
 const f=await fixture(t);
 const project=await f.rpc('tapd.status_options',{kind:'bug',workspaceId:target.workspaceId});assert.equal(project.options.length,3);
 const current=await f.rpc('tapd.status_options',target);
 assert.deepEqual(current.options.map(x=>x.value),['status_5']);
 const tool=await f.tool('tapd_status_options',target);assert.notEqual(tool.isError,true);
 assert.deepEqual(tool.structuredContent.options.map(x=>x.value),['status_5']);assert.equal(tool.structuredContent.current,'in_progress');
 assert.equal(current.current,'in_progress');
 assert.deepEqual(current.transitions[0].fields.map(x=>[x.key,x.label,x.required]),[['remarks','流转评论',true]]);
 assert.equal(f.state.posts.length,0);
});
test('required transition remarks travel with the single defect status POST through RPC and tools',async t=>{
 const f=await fixture(t);
 const args={...target,status:'status_5',expectedStatus:'in_progress',transitionFields:{remarks:'Approved verification result'}};
 const result=await f.rpc('tapd.update_status',args);assert.equal(result.outcome,'verified');
 assert.equal(f.state.posts.length,1);assert.equal(f.state.posts[0].path,'/bugs');assert.equal(f.state.posts[0].body.get('remarks'),args.transitionFields.remarks);
 f.state.status='in_progress';f.state.afterPost=false;clearTapdCache();
 const tool=await f.tool('tapd_update_status',{...args,confirmed:true});assert.notEqual(tool.isError,true);assert.equal(tool.structuredContent.outcome,'verified');
 assert.equal(f.state.posts.length,2);assert.equal(f.state.posts[1].body.get('remarks'),args.transitionFields.remarks);
});
test('direct RPC and tools reject absent remarks, unreachable edges and stale status without sending writes',async t=>{
 const f=await fixture(t);
 for(const input of [
  {status:'status_5'},
  {status:'closed',transitionFields:{remarks:'Approved close'}},
  {status:'status_5',expectedStatus:'new',transitionFields:{remarks:'Approved resolve'}},
  {status:'status_5',transitionFields:{remarks:'Approved resolve',status:'closed'}},
 ]){
  await assert.rejects(f.rpc('tapd.update_status',{...target,...input}),e=>e.failure?.writeState==='not_sent');
  assert.equal((await f.tool('tapd_update_status',{...target,...input,confirmed:true})).isError,true);
 }
 assert.equal(f.state.posts.length,0);
});
test('rule failures and unsupported or missing mandatory field metadata never fall back to project statuses',async t=>{
 const f=await fixture(t);const args={...target,status:'status_5',transitionFields:{remarks:'Approved resolve'}};
 for(const setup of [
  ()=>{f.state.ruleFailure=true;},
  ()=>{f.state.ruleFailure=false;f.state.transitions[0].Appendfield=[{DBModel:'Bug',FieldName:'unknown_field',Notnull:'yes'}];},
  ()=>{f.state.transitions[0].Appendfield=[{DBModel:'Bug',FieldName:'resolution',Notnull:'maybe'}];},
  ()=>{f.state.transitions[0].Appendfield=[{DBModel:'Bug',FieldName:'status',Notnull:'yes'}];},
 ]){setup();clearTapdCache();await assert.rejects(f.rpc('tapd.update_status',args));}
 assert.equal(f.state.posts.length,0);
});
test('metadata defaults never silently author a required transition comment',async t=>{
 const f=await fixture(t);
 f.state.transitions[0].Appendfield[0].DefaultValue=[{Type:'default_value',Value:'Remote comment template'}];
 await assert.rejects(f.rpc('tapd.update_status',{...target,status:'status_5'}),e=>e.failure?.writeState==='not_sent');
 assert.equal(f.state.posts.length,0);
});
test('fresh transition fields validate enum values and preserve declared record defaults',async t=>{
 const f=await fixture(t);
 f.state.transitions[0].Appendfield.push(
  {DBModel:'Bug',FieldName:'resolution',Notnull:'yes'},
  {DBModel:'Bug',FieldName:'current_owner',Notnull:'yes',DefaultValue:[{Type:'record_value',DBModel:'Bug',Field:'current_owner'}]});
 const options=await f.rpc('tapd.status_options',target);
 assert.equal(options.transitions[0].fields.find(x=>x.key==='current_owner').value,'example-member');
 for(const resolution of ['', 'invented'])await assert.rejects(f.rpc('tapd.update_status',{...target,status:'status_5',transitionFields:{remarks:'Approved result',resolution}}));
 assert.equal(f.state.posts.length,0);
 const result=await f.rpc('tapd.update_status',{...target,status:'status_5',transitionFields:{remarks:'Approved result',resolution:'fixed'}});
 assert.equal(result.outcome,'verified');assert.equal(f.state.posts.length,1);
 assert.equal(f.state.posts[0].body.get('current_owner'),'example-member');assert.equal(f.state.posts[0].body.get('resolution'),'fixed');
});
test('accepted status writes with failed fresh verification never replay the remarks POST',async t=>{
 const f=await fixture(t);f.state.readbackFailure=true;
 const result=await f.tool('tapd_update_status',{...target,status:'status_5',expectedStatus:'in_progress',transitionFields:{remarks:'Approved result'},confirmed:true});
 assert.notEqual(result.isError,true);assert.equal(result.structuredContent.outcome,'unverified');
 assert.equal(f.state.posts.length,1);assert.equal(f.state.status,'status_5');
});
test('fields revalidate current rules at submit and credentials are not forwarded',async t=>{
 const f=await fixture(t);await f.rpc('tapd.status_options',target);
 f.state.transitions[0].Appendfield.push({DBModel:'Bug',FieldName:'resolution',Notnull:'yes'});
 await assert.rejects(f.rpc('tapd.update_status',{...target,status:'status_5',transitionFields:{remarks:'Approved result'}}));
 await assert.rejects(f.rpc('tapd.update_status',{...target,status:'status_5',transitionFields:{remarks:f.values.token,resolution:'fixed'}}));
 assert.equal(f.state.posts.length,0);
});
test('a defect already at the requested status remains a no-op without a self edge',async t=>{
 const f=await fixture(t);
 const result=await f.tool('tapd_update_status',{...target,status:'in_progress',confirmed:true});
 assert.notEqual(result.isError,true);assert.equal(result.structuredContent.unchanged,true);assert.equal(f.state.posts.length,0);
});

test('explicit readonly remarks metadata prevents both RPC and tool writes',async t=>{
 const f=await fixture(t);f.state.remarksMetadata={html_type:'textarea',readonly:1};
 const options=await f.rpc('tapd.status_options',target);assert.equal(options.transitions[0].supported,false);
 const args={...target,status:'status_5',transitionFields:{remarks:'Approved result'}};
 await assert.rejects(f.rpc('tapd.update_status',args));assert.equal((await f.tool('tapd_update_status',{...args,confirmed:true})).isError,true);
 assert.equal(f.state.posts.length,0);
});

test('declared defect transition fields support documented metadata without readonly and ignore only optional UI configuration',async t=>{
 const f=await fixture(t);f.state.omitReadonly=true;
 f.state.transitions[0].Appendfield.push(
  {DBModel:'Bug',FieldName:'current_owner',Notnull:'no'},
  {DBModel:'Bug',FieldName:'enable_add_timesheet',Notnull:'no'},
  {DBModel:'Bug',FieldName:'transition_description',Notnull:'no'});
 const result=await f.tool('tapd_status_options',target);assert.notEqual(result.isError,true);
 const transition=result.structuredContent.transitions[0];assert.equal(transition.supported,true);
 assert.deepEqual(transition.fields.map(x=>x.key),['remarks','current_owner']);
 const write=await f.tool('tapd_update_status',{...target,status:'status_5',transitionFields:{remarks:'Approved result'},confirmed:true});
 assert.notEqual(write.isError,true);assert.equal(write.structuredContent.outcome,'verified');assert.equal(f.state.posts.length,1);
 assert.equal(f.state.posts[0].body.has('enable_add_timesheet'),false);assert.equal(f.state.posts[0].body.has('transition_description'),false);
 f.state.status='in_progress';
 for(const key of ['enable_add_timesheet','transition_description']){
  f.state.transitions[0].Appendfield=[{DBModel:'Bug',FieldName:'remarks',Notnull:'yes'},{DBModel:'Bug',FieldName:key,Notnull:'yes'}];
  assert.equal((await f.rpc('tapd.status_options',target)).transitions[0].supported,false);
  await assert.rejects(f.rpc('tapd.update_status',{...target,status:'status_5',transitionFields:{remarks:'Approved result',[key]:'1'}}));
 }
 assert.equal(f.state.posts.length,1);
});
test('only absent readonly is accepted for a declared field; unknown markers and arbitrary optional fields remain blocked',async t=>{
 const f=await fixture(t);f.state.transitions[0].Appendfield.push({DBModel:'Bug',FieldName:'remarks',Notnull:'yes'});
 // Duplicate and unrecognized declarations cannot expand the writable field set.
 await assert.rejects(f.rpc('tapd.status_options',target));
 f.state.transitions[0].Appendfield=[{DBModel:'Bug',FieldName:'unknown_optional',Notnull:'no'}];
 assert.equal((await f.rpc('tapd.status_options',target)).transitions[0].supported,false);
 f.state.transitions[0].Appendfield=[{DBModel:'Bug',FieldName:'remarks',Notnull:'yes'}];
 for(const readonly of [null,'unknown',1]){f.state.remarksMetadata={html_type:'textarea',readonly};assert.equal((await f.rpc('tapd.status_options',target)).transitions[0].supported,false);}
 assert.equal(f.state.posts.length,0);
});
