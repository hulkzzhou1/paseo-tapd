// Mixed workflow through registered tools/RPC; HTTP and Paseo are synthetic public boundaries.
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
test('approved mixed work keeps children, labels, business status and responsibility independent',async t=>{
 const home=await mkdtemp(join(tmpdir(),'tapd-acceptance-')),prior=process.env.PASEO_HOME;process.env.PASEO_HOME=home;
 for(const key of ['TAPD_TOKEN','TAPD_API_ENDPOINT','TAPD_SITE_URL','TAPD_WORKSPACE_IDS'])delete process.env[key];
 const values=tapdSettingsSchema.parse({token:'example-secret',workspaceIds:'12345678',apiEndpoint:'https://api.example.com',siteUrl:'https://example.com'});
 const parent={kind:'story',id:'11111111',workspaceId:'12345678',confirmed:true};
 const child={kind:'task',id:'22222222',workspaceId:'12345678',confirmed:true};
 const rows=new Map([[parent.id,{id:parent.id,workspace_id:parent.workspaceId,name:'Parent deliverable',status:'open',workitem_type_id:'33333333',label:'human'}]]);
 const agents=new Map(['example-agent','example-other'].map(id=>[id,{id,title:id,workspaceId:'example-workspace',archivedAt:null}]));
 const writes=[];let offline=false,workflowKnown=true,sends=0;
 const ref=id=>({id,workspaceId:'example-workspace',current:()=>agents.get(id),refresh:async()=>({agent:agents.get(id)}),send:async()=>{sends++;}});
 const context={agent:{id:'example-agent'},signal:new AbortController().signal,paseo:{agents:{ref,list:async()=>({entries:[...agents.values()].map(agent=>({agent}))})}}};
 clearTapdCache();t.mock.method(globalThis,'fetch',async(input,init)=>{
  if(offline)throw Error('offline');const u=new URL(input),body=new URLSearchParams(init.body);assert.equal(u.origin,values.apiEndpoint);let data=[];
  if(u.pathname.endsWith('/get_fields_info'))data={name:{required:1,readonly:0,html_type:'text'},status:{options:{open:'待处理',done:'已完成'}}};
  if(u.pathname==='/workflows/last_steps')data=workflowKnown?{done:'已完成'}:[];
  const kind=u.pathname==='/stories'?'Story':u.pathname==='/tasks'?'Task':'Bug';
  if(['/stories','/tasks','/bugs'].includes(u.pathname)){
   if(init.method==='POST'){
    writes.push({path:u.pathname,body});const id=body.get('id');
    if(id){for(const key of ['status','label'])if(body.has(key))rows.get(id)[key]=body.get(key);}
    else rows.set(child.id,{id:child.id,workspace_id:parent.workspaceId,name:body.get('name'),story_id:body.get('story_id'),status:'open',label:''});
    data={[kind]:rows.get(id??child.id)};
   }else if(u.searchParams.has('id'))data=rows.has(u.searchParams.get('id'))?[{[kind]:rows.get(u.searchParams.get('id'))}]:[];
   else if(u.pathname==='/tasks'&&u.searchParams.get('story_id')===parent.id)data=[...rows.values()].filter(row=>row.story_id===parent.id).map(Task=>({Task}));
  }
  return Response.json({status:1,data});
 });
 const rpcs=new Map();let before;const close=contribute({registerSettings:()=>({read:async()=>({status:'ready',values}),subscribe:()=>()=>{}}),handle:(rpc,fn)=>rpcs.set(rpc.name,fn),before:(_name,fn)=>before=fn,on:()=>{}});
 t.after(async()=>{close();if(prior===undefined)delete process.env.PASEO_HOME;else process.env.PASEO_HOME=prior;await rm(home,{recursive:true,force:true});});
 const tools=(await before({request:{purpose:'interactive',agentId:context.agent.id,tools:[],env:{}}},context)).tools;
 assert.equal(new Set(tools.map(tool=>tool.name)).size,tools.length);t.diagnostic(`registered TAPD tools: ${tools.length}`);
 const call=async(name,input={},agentId='example-agent')=>{const result=await tools.find(tool=>tool.name===name).execute(input,{...context,agent:{id:agentId}});assert.notEqual(result.isError,true,`${name}: ${JSON.stringify(result.structuredContent)}`);return result.structuredContent;};
 const rpc=(name,input={})=>rpcs.get(name)(input,context);
 await call('tapd_entity',parent);assert.deepEqual((await call('tapd_task_board')).items,[],'a recent read is not acceptance');
 await call('tapd_take_task',parent);
 assert.equal((await call('tapd_create',{kind:'task',workspaceId:parent.workspaceId,storyId:parent.id,title:'Independent child',confirmed:true})).outcome,'verified');
 assert.deepEqual((await call('tapd_task_board')).items.map(item=>item.entity.id),[parent.id],'creation does not inherit ownership');
 const offer=await call('tapd_delegate_task',{...child,targetAgentId:'example-other',reason:'Approved independent deliverable'});
 await call('tapd_accept_task',{...child,offerId:offer.offer.offerId,reason:'Accept approved work'},'example-other');
 const children=await rpc('tapd.children',{workspaceId:parent.workspaceId,id:parent.id});
 assert.equal(children.items[0].responsibleAgent.id,'example-other');assert.equal(children.items[0].id,child.id);
 const changed=await call('tapd_update_labels',{...parent,expectedValue:'human',add:['review:ready','done'],remove:[]});assert.equal(changed.outcome,'verified');
 const beforeStatus=await call('tapd_task_board');assert.equal(beforeStatus.items[0].classification,'unfinished');assert.deepEqual(beforeStatus.items[0].entity.labels,['human','review:ready','done']);
 await call('tapd_update_status',{...child,status:'done'},'example-other');
 assert.equal((await call('tapd_task_board',{},'example-other')).items[0].classification,'completed');
 assert.equal((await call('tapd_task_board')).items[0].classification,'unfinished','child completion cannot complete parent');
 workflowKnown=false;assert.equal((await call('tapd_task_board')).items[0].classification,'unknown');workflowKnown=true;
 const fresh=await rpc('tapd.task-board',{agentId:'example-agent'});offline=true;
 const stale=await call('tapd_task_board');assert.equal(stale.items[0].stale,true);assert.equal(stale.items[0].classification,'unknown');assert.deepEqual(stale.items[0].entity.labels,fresh.items[0].entity.labels);offline=false;
 const owned=(await call('tapd_task_board')).items[0].link;
 const handover=await call('tapd_delegate_task',{...parent,targetAgentId:'example-other',expectedOwnerAgentId:'example-agent',expectedRevision:owned.responsibility.revision,reason:'Approved handover'});
 assert.equal((await call('tapd_task_board')).items.length,1,'offer alone does not transfer');
 await call('tapd_accept_task',{...parent,offerId:handover.offer.offerId,reason:'Accept handover'},'example-other');
 assert.deepEqual((await rpc('tapd.task-board',{agentId:'example-agent'})).items,[]);
 const transferred=(await call('tapd_task_board',{},'example-other')).items.find(item=>item.entity.id===parent.id);
 await call('tapd_leave_task',{...parent,expectedRevision:transferred.link.responsibility.revision,reason:'Approved scope change'},'example-other');
 assert.deepEqual((await rpc('tapd.task-board',{agentId:'example-other'})).items.map(item=>item.entity.id),[child.id]);
 assert.deepEqual(writes.map(write=>[write.path,[...write.body.keys()].filter(key=>!['workspace_id','id'].includes(key)).sort()]),[['/tasks',['name','story_id']],['/stories',['label']],['/tasks',['status']]]);
 assert.equal(rows.get(parent.id).status,'open');assert.equal(rows.get(parent.id).label,'human|review:ready|done');assert.equal(sends,0);
});
