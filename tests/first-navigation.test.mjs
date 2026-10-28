// Registered tools and RPC, synthetic HTTP/provider and isolated plugin data.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {registerHooks} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/.test(s))return n(s+'.ts',c);throw e;}}});
const {default:contribute}=await import('../index.server.ts');
const {tapdSettingsSchema}=await import('../shared/contracts.ts');
const {clearTapdCache}=await import('../server/tapd.ts');
async function setup(t){
 const directory=await mkdtemp(join(tmpdir(),'tapd-first-navigation-')),previous=process.env.PASEO_HOME;process.env.PASEO_HOME=directory;
 for(const key of ['TAPD_TOKEN','TAPD_API_ENDPOINT','TAPD_SITE_URL','TAPD_WORKSPACE_IDS'])delete process.env[key];
 const values=tapdSettingsSchema.parse({token:'example-secret',workspaceIds:'12345678',apiEndpoint:'https://api.example.com',siteUrl:'https://example.com'});
 const agents=new Map(['example-agent','example-other'].map(id=>[id,{id,workspaceId:'example-workspace',title:id,archivedAt:null,status:'idle'}]));
 const rows=new Map(['11111111','22222222','33333333'].map((id,i)=>[id,{id,workspace_id:'12345678',name:['Direct task','Accepted task','Child task'][i],status:'open',owner:'example-member',label:'example-label',workitem_type_id:'44444444',...(i===2?{story_id:'11111111'}:{})}]));
 const timeline=new Map(),requests=[];let offline=false;
 const ref=id=>({id,address:{serverId:'example-host',agentId:id},get workspaceId(){return agents.get(id)?.workspaceId??null;},current:()=>agents.get(id),refresh:async()=>agents.has(id)?{agent:agents.get(id)}:null,timeline:{refetch:async()=>({entries:[],hasOlder:false,hasNewer:false,epoch:'example-epoch'}),append:async item=>{timeline.set(item.id,item);return {epoch:'example-epoch',seq:timeline.size};}}});
 const paseo={agents:{ref,list:async()=>({entries:[...agents.values()].map(agent=>({agent})),pageInfo:{hasMore:false},subscription:{ready:Promise.resolve(),release:async()=>{},subscribe:()=>()=>{}}})}};
 const context={paseo,signal:new AbortController().signal};
 clearTapdCache();t.mock.method(globalThis,'fetch',async(input,init)=>{
  assert.equal(init.method??'GET','GET');const url=new URL(input);requests.push(url);if(offline)throw Error('private upstream example-secret');
  let data=[];
  if(url.pathname.endsWith('/get_fields_info'))data={status:{options:{open:'Open',done:'Done'}}};
  else if(url.pathname==='/workflows/last_steps')data={done:'Done'};
  else if(['/stories','/tasks','/bugs'].includes(url.pathname)){
   const wrapper={'/stories':'Story','/tasks':'Task','/bugs':'Bug'}[url.pathname];
   if(url.searchParams.has('id')){const row=rows.get(url.searchParams.get('id'));data=row?[{[wrapper]:row}]:[];}
   else if(url.pathname==='/tasks'&&url.searchParams.get('story_id')==='11111111')data=[{Task:rows.get('33333333')}];
  }
  return Response.json({status:1,data});
 });
 const rpcs=new Map();let before;
 const close=contribute({registerSettings:()=>({read:async()=>({status:'ready',values}),subscribe:()=>()=>{}}),handle:(rpc,fn)=>rpcs.set(rpc.name,{rpc,fn}),before:(_name,fn)=>{before=fn;},on(){}});
 t.after(async()=>{close();if(previous===undefined)delete process.env.PASEO_HOME;else process.env.PASEO_HOME=previous;await rm(directory,{recursive:true,force:true});});
 const rpc=async(name,input={})=>{const entry=rpcs.get(name);return entry.rpc.output.parse(await entry.fn(entry.rpc.input.parse(input),context));};
 const {tools}=await before({request:{purpose:'interactive',agentId:'example-agent',tools:[],env:{}}},context);
 const tool=async(name,input,agentId='example-agent')=>{const result=await tools.find(tool=>tool.name===name).execute(input,{...context,agent:{id:agentId}});assert.notEqual(result.isError,true,`${name} failed`);return result.structuredContent;};
 const target=(id,kind='story')=>({siteUrl:values.siteUrl,apiEndpoint:values.apiEndpoint,workspaceId:'12345678',kind,id,title:'Forged title',status:'forged',statusLabel:'forged',owner:'forged',labels:['forged']});
 return {rpc,tool,target,rows,agents,timeline,requests,offline:value=>{offline=value;}};
}
test('direct assignment and accepted delegation open first-time tasks without creating history cards or changing ownership',async t=>{
 const s=await setup(t),direct={kind:'story',id:'11111111',workspaceId:'12345678',agentId:'example-other',confirmed:true};
 await s.rpc('tapd.task.claim',direct);
 const offer=await s.tool('tapd_delegate_task',{kind:'story',id:'22222222',workspaceId:'12345678',targetAgentId:'example-other',reason:'Approved independent task',confirmed:true});
 await s.tool('tapd_accept_task',{kind:'story',id:'22222222',workspaceId:'12345678',offerId:offer.offer.offerId,reason:'Accepted approved task',confirmed:true},'example-other');
 assert.equal(s.timeline.size,0);assert((await s.rpc('tapd.conversations')).conversations.every(item=>item.entities.length===0));
 const before=(await s.rpc('tapd.agent-links')).links;
 for(const id of ['11111111','22222222'])await s.rpc('tapd.conversation.focus',{agentId:'example-other',entity:s.target(id)});
 const recent=(await s.rpc('tapd.conversations')).conversations.find(item=>item.agentId==='example-other').entities;
 assert.deepEqual(recent.map(item=>[item.id,item.title,item.statusLabel,item.owner,item.labels]),[['22222222','Accepted task','Open','example-member',['example-label']],['11111111','Direct task','Open','example-member',['example-label']]]);
 assert.deepEqual((await s.rpc('tapd.agent-links')).links,before);assert.equal(s.timeline.size,0);
});

test('a first expanded child opens with its own canonical metadata and viewing never takes responsibility',async t=>{
 const s=await setup(t);const children=await s.rpc('tapd.children',{workspaceId:'12345678',id:'11111111'});
 const child=children.items.find(item=>item.id==='33333333');assert.equal(child.kind,'task');
 await s.rpc('tapd.conversation.focus',{agentId:'example-agent',entity:{...s.target(child.id,child.kind),...child,labels:['forged-parent-label']}});
 const recent=(await s.rpc('tapd.conversations')).conversations.find(item=>item.agentId==='example-agent').entities;
 assert.deepEqual(recent.map(item=>[item.id,item.kind,item.title,item.labels]),[['33333333','task','Child task',['example-label']]]);
 assert.deepEqual((await s.rpc('tapd.task-board',{agentId:'example-agent'})).items,[]);
 assert.equal(s.timeline.size,0);
 s.offline(true);await s.rpc('tapd.conversation.focus',{agentId:'example-agent',entity:{...recent[0],title:'Forged replacement',labels:['forged']}});
 assert.equal((await s.rpc('tapd.conversations')).conversations[0].entities[0].title,'Child task','known references remain usable offline without accepting client metadata');
});

test('unseen focus requires actual project/type/id evidence and refuses unsafe or unavailable targets',async t=>{
 const s=await setup(t),entity=s.target('33333333','task'),original={...s.rows.get(entity.id)};
 for(const patch of [{workspace_id:'87654321'},{workspace_id:undefined},{id:'99999999'},{entity_type:'bug'},{name:'x'.repeat(600)+'example-secret'}]){
  s.rows.set(entity.id,{...original,...patch});
  await assert.rejects(s.rpc('tapd.conversation.focus',{agentId:'example-agent',entity}),error=>!error.message.includes('example-secret'));
 }
 s.rows.set(entity.id,original);
 const before=s.requests.length;
 for(const patch of [{siteUrl:'https://other.example.com'},{apiEndpoint:'https://other.example.com'},{workspaceId:'87654321'},{kind:'other'},{id:'not-an-id'},{title:'example-secret'}])await assert.rejects(s.rpc('tapd.conversation.focus',{agentId:'example-agent',entity:{...entity,...patch}}));
 await assert.rejects(s.rpc('tapd.conversation.focus',{agentId:'example-missing',entity}),/不可用/);
 assert.equal(s.requests.length,before,'invalid scope and inaccessible Agent do not fetch an item');
 s.rows.delete(entity.id);await assert.rejects(s.rpc('tapd.conversation.focus',{agentId:'example-agent',entity}),/不可用/);
 assert((await s.rpc('tapd.conversations')).conversations.every(item=>item.entities.length===0));
 assert.deepEqual((await s.rpc('tapd.agent-links')).links,[]);
});
