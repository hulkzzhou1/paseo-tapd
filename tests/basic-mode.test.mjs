import assert from 'node:assert/strict';
import {test} from 'node:test';
import {registerHooks} from 'node:module';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

registerHooks({resolve(s,c,next){try{return next(s,c);}catch(error){if(error.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/.test(s))return next(s+'.ts',c);throw error;}}});
const {default:contribute}=await import('../index.server.ts');
const {tapdSettingsSchema}=await import('../shared/contracts.ts');

test('basic plugin registers direct TAPD tools without local tasks, lifecycle tracking or touching retired stores',async t=>{
  const home=await mkdtemp(join(tmpdir(),'tapd-basic-'));
  const previous=process.env.PASEO_HOME;process.env.PASEO_HOME=home;
  t.after(async()=>{if(previous===undefined)delete process.env.PASEO_HOME;else process.env.PASEO_HOME=previous;await rm(home,{recursive:true,force:true});});
  const folder=join(home,'plugin-data/tapd-workbench');await mkdir(folder,{recursive:true});
  for(const name of ['agent-links.json','conversations.json'])await writeFile(join(folder,name),'legacy records remain untouched');
  const handlers=new Map(),before=new Map(),events=[];
  const values=tapdSettingsSchema.parse({token:'example-token',workspaceIds:'12345678',apiEndpoint:'https://api.example.com',siteUrl:'https://example.com'});
  const dispose=contribute({registerSettings:()=>({read:async()=>({status:'ready',values}),subscribe:()=>()=>{}}),handle:(rpc,handler)=>handlers.set(rpc.name,{rpc,handler}),before:(name,handler)=>before.set(name,handler),on:name=>{events.push(name);return()=>{};}});
  t.after(dispose);
  assert.deepEqual(events,[],'No Agent/task lifecycle is tracked');
  for(const name of ['tapd.entity','tapd.board','tapd.story-fields','tapd.story-document','tapd.update_iteration','tapd.update_status','tapd.update_field','tapd.add_comment','tapd.dispatch_agent'])assert.ok(handlers.has(name),name);
  assert.ok(![...handlers.keys()].some(name=>/conversation|task-board|task\.|agent.links|agent-links|agent_status|migration|claim|release|transfer/.test(name)));
  let hostCalls=0;
  const paseo=new Proxy({},{get(){hostCalls++;throw Error('Agent management is retired');}});
  const launch=await before.get('agent.session_open')({request:{purpose:'interactive',agentId:'example-agent',tools:[],env:{}}},{paseo});
  const names=launch.tools.map(tool=>tool.name);
  for(const name of ['tapd_entity','tapd_create','tapd_update_status','tapd_read_field','tapd_update_iteration','tapd_update_labels'])assert.ok(names.includes(name),name);
  assert.ok(!names.some(name=>/bind_agent|task_board|take_task|leave_task|delegate_task|accept_task|task_history/.test(name)));
  const result=await launch.tools.find(tool=>tool.name==='tapd_projects').execute({},{signal:new AbortController().signal,paseo,agent:{id:'example-agent'}});
  assert.deepEqual(result.structuredContent,{workspaceIds:['12345678']});
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input);assert.equal(url.origin,'https://api.example.com');
    return Response.json({status:1,data:url.pathname==='/stories'&&url.searchParams.get('id')==='11111111'?[{Story:{id:'11111111',workspace_id:'12345678',workitem_type_id:'0',name:'Example requirement',status:'open',description:'<p>Original description</p>'}}]:[]});
  });
  const detail=await launch.tools.find(tool=>tool.name==='tapd_entity').execute({kind:'story',workspaceId:'12345678',id:'11111111'},{signal:new AbortController().signal,paseo,agent:{id:'example-agent'}});
  assert.equal(detail.structuredContent.title,'Example requirement');
  assert.equal(hostCalls,0);
  for(const name of ['agent-links.json','conversations.json'])assert.equal(await readFile(join(folder,name),'utf8'),'legacy records remain untouched');
});
