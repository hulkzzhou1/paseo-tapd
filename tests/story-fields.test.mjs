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
const target={workspaceId:'12345678',id:'11111111'};
async function fixture(t){
 const prior={...process.env},home=await mkdtemp(join(tmpdir(),'tapd-short-fields-'));process.env.PASEO_HOME=home;for(const key of ['TAPD_TOKEN','TAPD_API_ENDPOINT','TAPD_SITE_URL','TAPD_WORKSPACE_IDS'])delete process.env[key];
 const values=tapdSettingsSchema.parse({token:'example-secret',workspaceIds:'12345678,87654321',apiEndpoint:'https://api.example.com',siteUrl:'https://example.com'});
 const state={category:'22222222',project:target.workspaceId,failFields:false,failValues:false,posts:0,requests:[],fields:{
  custom_field_one:{label:'Example text',html_type:'text',readonly:1},
  custom_field_two:{label:'Example number',html_type:'integer'},
  custom_field_three:{label:'Example boolean',html_type:'boolean'},
  custom_field_four:{label:'Example choices',html_type:'multi_select',options:{a:'Alpha',b:'Beta'}},
  custom_field_five:{label:'Example people',html_type:'user_chooser'},
  custom_field_six:{label:'Example date',html_type:'dateinput'},
  custom_field_seven:{label:'Example extra',html_type:'text'},
  custom_field_empty:{label:'Example empty',html_type:'text'},
  custom_field_null:{label:'Example unknown',html_type:'text'},
  custom_field_missing:{label:'Example missing',html_type:'text'},
  custom_field_object:{label:'Example unsupported value',html_type:'text'},
  custom_field_document:{label:'Example document',html_type:'rich_edit'},
 },data:{custom_field_one:'Readable readonly text',custom_field_two:0,custom_field_three:false,custom_field_four:['a','b'],custom_field_five:['example-member','example-other'],custom_field_six:'2026-01-02',custom_field_seven:'Seventh value',custom_field_empty:'',custom_field_null:null,custom_field_object:{unexpected:'value'},custom_field_document:'<p>Unopened document</p>'}};
 clearTapdCache();t.mock.method(globalThis,'fetch',async(source,init)=>{
  const url=new URL(source);assert.equal(url.origin,values.apiEndpoint);state.requests.push(url);let data=[];
  if(init.method==='POST'){state.posts++;throw Error('Unexpected write');}
  if(url.pathname==='/stories/get_fields_info'){if(state.failFields)return new Response(null,{status:503});data=state.fields;}
  else if(url.pathname==='/stories'&&url.searchParams.has('id')){
   const fields=url.searchParams.get('fields')?.split(',');
   if(state.failValues&&fields?.some(key=>key.startsWith('custom_field_')))return new Response(null,{status:503});
   const row={id:url.searchParams.get('id'),workspace_id:state.project,workitem_type_id:state.category,name:'Example requirement',status:'open',description:'<p>Base description</p>',...state.data};
   data=[{Story:fields?Object.fromEntries(Object.entries(row).filter(([key])=>fields.includes(key))):row}];
  }
  return Response.json({status:1,data});
 });
 const handlers=new Map();const close=contribute({registerSettings:()=>({read:async()=>({status:'ready',values}),subscribe:()=>()=>{}}),handle:(rpc,handler)=>handlers.set(rpc.name,input=>handler(rpc.input.parse(input),{}).then(result=>rpc.output.parse(result))),before(){},on(){}});
 t.after(async()=>{close();clearTapdCache();for(const key of ['PASEO_HOME','TAPD_TOKEN','TAPD_API_ENDPOINT','TAPD_SITE_URL','TAPD_WORKSPACE_IDS']){if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];}await rm(home,{recursive:true,force:true});});
 return{state,values,async rpc(name,input){assert.ok(handlers.has(name),`Registered RPC ${name}`);return handlers.get(name)(input);}};
}

test('registered story reading RPC returns ordered short fields and rich definitions without prefetching documents',async t=>{
 const f=await fixture(t),result=await f.rpc('tapd.story-fields',target);
 assert.equal(result.workitemTypeId,'22222222');
 assert.deepEqual(result.fields.slice(0,7).map(field=>field.display),['Readable readonly text','0','false','Alpha、Beta','example-member、example-other','2026-01-02','Seventh value']);
 assert.equal(result.fields[0].readonly,true);assert.equal(result.fields[1].readonly,null);
 assert.deepEqual(result.fields.slice(7).map(field=>field.state),['empty','unknown','not_returned','unrecognized','unread']);
 assert.equal(result.fields.at(-1).kind,'richtext');assert.equal(result.fields.at(-1).value,null);
 assert.ok(f.state.requests.some(url=>url.pathname.endsWith('get_fields_info')&&url.searchParams.get('workitem_type_id')==='22222222'));
 assert.ok(f.state.requests.filter(url=>url.pathname==='/stories').every(url=>url.searchParams.has('fields')&&!url.searchParams.get('fields').split(',').includes('custom_field_document')));
 assert.equal(f.state.posts,0);
});

test('initial full story detail selects only standard fields and never fetches custom rich text',async t=>{
 const f=await fixture(t),result=await f.rpc('tapd.entity',{kind:'story',...target,fresh:true});
 assert.equal(result.description,'Base description');assert.equal(result.title,'Example requirement');
 assert.equal(JSON.stringify(result).includes('Unopened document'),false);
 const reads=f.state.requests.filter(url=>url.pathname==='/stories'&&url.searchParams.get('id')===target.id);
 assert.ok(reads.length>0);assert.ok(reads.every(url=>url.searchParams.has('fields')&&!url.searchParams.get('fields').includes('custom_field_')),'base detail must not request unopened custom documents');
});

test('field identities use each actual project and category, and never accept a mismatched target',async t=>{
 const f=await fixture(t);const first=await f.rpc('tapd.story-fields',target);
 f.state.project='87654321';f.state.category='33333333';f.state.fields.custom_field_one.label='Other category text';
 const other=await f.rpc('tapd.story-fields',{...target,workspaceId:'87654321'});
 assert.equal(other.fields[0].label,'Other category text');assert.equal(first.fields[0].label,'Example text');
 assert.equal(other.workitemTypeId,'33333333');
 assert.ok(f.state.requests.some(url=>url.pathname.endsWith('get_fields_info')&&url.searchParams.get('workspace_id')==='87654321'&&url.searchParams.get('workitem_type_id')==='33333333'));
 await assert.rejects(f.rpc('tapd.story-fields',target));
 const count=f.state.requests.length;await assert.rejects(f.rpc('tapd.story-fields',{...target,workspaceId:'99999999'}));assert.equal(f.state.requests.length,count);
});

test('metadata and short-value failures remain explicit and do not remove basic detail or rich definitions',async t=>{
 const f=await fixture(t);f.state.failFields=true;
 await assert.rejects(f.rpc('tapd.story-fields',target));
 assert.equal((await f.rpc('tapd.entity',{kind:'story',...target})).title,'Example requirement');
 f.state.failFields=false;f.state.failValues=true;
 const failed=await f.rpc('tapd.story-fields',target);
 assert.ok(failed.readError);assert.equal(failed.fields[0].state,'failed');assert.equal(failed.fields.at(-1).state,'unread');
 f.state.failValues=false;
 assert.equal((await f.rpc('tapd.story-fields',target)).fields[0].state,'value');
});

test('unknown types and incomplete enum mappings stay distinguishable from empty, and old editing permissions stay strict',async t=>{
 const f=await fixture(t);f.state.fields.custom_field_untyped={label:'Example unknown type',html_type:'unrecognized_widget'};
 f.state.data.custom_field_untyped={unsupported:true};f.state.data.custom_field_four=['a','missing'];
 const result=await f.rpc('tapd.story-fields',target);
 const choices=result.fields.find(field=>field.key==='custom_field_four');assert.equal(choices.display,'Alpha、missing');assert.ok(choices.warning);
 assert.equal(result.fields.at(-1).state,'unrecognized');assert.equal(result.fields.at(-1).value,null);
 for(const fieldKey of ['custom_field_one','custom_field_seven'])await assert.rejects(f.rpc('tapd.update_field',{kind:'story',...target,fieldKey,expectedValue:f.state.data[fieldKey],value:'Approved replacement',confirmed:true}));
 assert.equal(f.state.posts,0);
});

test('credential-bearing short values fail safely without returning or storing protected content',async t=>{
 const f=await fixture(t);process.env.TAPD_TOKEN='example-independent-ambient';f.values.syncGitToken='example-independent-retired';
 for(const secret of [f.values.token,process.env.TAPD_TOKEN,f.values.syncGitToken]){
  f.state.data.custom_field_one=secret;
  const result=await f.rpc('tapd.story-fields',target);assert.equal(result.fields[0].state,'failed');assert.ok(result.readError);
  assert.equal(JSON.stringify(result).includes(secret),false);
 }
 f.state.fields.custom_field_one.label=f.values.token;
 await assert.rejects(f.rpc('tapd.story-fields',target),error=>!error.message.includes(f.values.token));assert.equal(f.state.posts,0);
});

test('confirmed blank numeric and boolean fields stay empty while malformed typed values stay unrecognized',async t=>{
 const f=await fixture(t);f.state.data.custom_field_two='';f.state.data.custom_field_three='';
 let result=await f.rpc('tapd.story-fields',target);
 assert.equal(result.fields[1].state,'empty');assert.equal(result.fields[2].state,'empty');
 f.state.data.custom_field_two={value:0};f.state.data.custom_field_three='not-a-boolean';
 result=await f.rpc('tapd.story-fields',target);
 assert.equal(result.fields[1].state,'unrecognized');assert.equal(result.fields[2].state,'unrecognized');
});


test('unrecognized inherited names stay safe metadata and metadata is protected before truncation',async t=>{
 const f=await fixture(t);f.state.fields.custom_field_widget={label:'Example unknown widget',html_type:'constructor'};
 let result=await f.rpc('tapd.story-fields',target);assert.equal(result.fields.at(-1).kind,'unknown');assert.equal(result.fields.at(-1).state,'unrecognized');
 f.values.token='example-'+ 'x'.repeat(600);f.state.fields.custom_field_one.label=f.values.token;
 await assert.rejects(f.rpc('tapd.story-fields',target),error=>!error.message.includes('x'.repeat(100)));
});

test('reading identity and category require scalar numeric metadata before accepting a project definition',async t=>{
 const f=await fixture(t);
 for(const key of ['id','workspace_id']){
  for(const malformed of [[key==='id'?target.id:target.workspaceId],{value:key==='id'?target.id:target.workspaceId},true,Number.MAX_SAFE_INTEGER+1]){
   f.state.data[key]=malformed;
   await assert.rejects(f.rpc('tapd.story-fields',target));
  }
  delete f.state.data[key];
 }
 for(const category of [['22222222'],{value:'22222222'},true,Number.MAX_SAFE_INTEGER+1]){
  f.state.category=category;
  await assert.rejects(f.rpc('tapd.story-fields',target));
 }
 f.state.category=0;
 assert.equal((await f.rpc('tapd.story-fields',target)).workitemTypeId,null);
});
