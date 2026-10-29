// Disposable real daemon/public RPC and MCP tools; TAPD/provider are synthetic boundaries.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {settingsRpc} from '@getpaseo/plugin';
import {syntheticProvider} from './synthetic-provider.mjs';
const pluginDir=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export async function runNavigationDaemon(root, workflowMode = false, iterationMode = false){
 assert.equal(await readFile(join(homedir(),'tapd-test-home-marker'),'utf8'),'isolated');
 const req=createRequire(join(process.env.PASEO_RUNTIME_DIR,'packages/cli/package.json')),load=name=>import(pathToFileURL(req.resolve(name)).href);
 const {createPaseoDaemon,BUILTIN_PROVIDER_IDS}=await load('@getpaseo/server'),{createHostClient}=await load('@getpaseo/client/node');
 const {Client}=await load('@modelcontextprotocol/sdk/client/index.js'),{StreamableHTTPClientTransport}=await load('@modelcontextprotocol/sdk/client/streamableHttp.js');
 const logger=req('pino')({level:'silent'}),home=join(root,'home');await mkdir(home);await mkdir(join(root,'static'));
 process.env.PASEO_HOME=home;let prompts=0,writes=0,fixtureError;const reads=[],readDetails=[];
 let workflowStatus="in_progress",workflowScenario="verified";const workflowPosts=[],iterationPosts=[];let failIterationReadback=false,iterationReadbackBlocked=false;
 const rows=new Map([
  ['11111111',{id:'11111111',workspace_id:'12345678',name:'Direct task',status:'open',owner:'example-member',label:'example-label',workitem_type_id:'44444444',description:'<h2>Full direct detail</h2><p>Complete body from TAPD</p>'}],
  ['22222222',{id:'22222222',workspace_id:'12345678',name:'Accepted task',status:'open',owner:'example-member',label:'example-label',workitem_type_id:'44444444',description:'<h2>Full accepted detail</h2><p>Accepted delegated body</p>'}],
  ['33333333',{id:'33333333',workspace_id:'12345678',name:'Child task',status:'open',owner:'example-child',label:'child-label',story_id:'11111111',description:'<h2>Full child detail</h2><p>Child body from TAPD</p>'}],
 ]);
 if(iterationMode)for(const row of rows.values()){row.iteration_id='66666666';row.custom_field_example='Mixed short value';row.custom_field_design='<h2>Mixed design document</h2><p>Design remains readable after planning</p>';}
 const tapd=createServer(async(request,response)=>{try{
  if(request.method!=='GET'){
   if(!workflowMode&&!iterationMode)throw Error('No business writes allowed');
   let raw='';for await(const chunk of request)raw+=chunk;const body=new URLSearchParams(raw);
   if(iterationMode){
    assert.equal(request.url,'/stories');assert.deepEqual([...body.keys()].sort(),['id','iteration_id','workspace_id']);
    assert.equal(body.get('workspace_id'),'12345678');assert.equal(body.get('id'),'11111111');
    assert(['66666666','77777777'].includes(body.get('iteration_id')));iterationPosts.push(Object.fromEntries(body));
    rows.get('11111111').iteration_id=body.get('iteration_id');iterationReadbackBlocked=failIterationReadback;
    response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({status:1,data:{}}));return;
   }
   workflowPosts.push({path:request.url,fields:Object.fromEntries(body)});
   assert.equal(request.url,'/bugs');assert.equal(body.get('workspace_id'),'12345678');assert.equal(body.get('id'),'55555555');
   if(workflowScenario==='unknown'){workflowStatus='status_5';request.socket.destroy();return;}
   if(workflowScenario==='rejected'||!body.get('remarks')){response.writeHead(403,{'content-type':'application/json'}).end(JSON.stringify({status:0}));return;}
   assert.equal(body.get('status'),'status_5');workflowStatus='status_5';
   response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({status:1,data:{Bug:{id:'55555555'}}}));return;
  }
  const url=new URL(request.url,'http://127.0.0.1');reads.push(url.pathname);readDetails.push({path:url.pathname,query:Object.fromEntries(url.searchParams)});let data=[];
  if(iterationReadbackBlocked&&url.pathname==='/stories'&&url.searchParams.get('id')==='11111111'){response.writeHead(503).end();return;}
  if(iterationMode&&url.pathname==='/iterations')data=['66666666','77777777'].filter(id=>!url.searchParams.get('id')||url.searchParams.get('id')===id).map(id=>({Iteration:{id,workspace_id:'12345678',name:id==='66666666'?'Previous iteration':'Selected iteration'}}));
  else if(workflowMode&&url.pathname==='/bugs/get_fields_info')data={status:{options:{in_progress:'处理中',status_5:'已解决',closed:'已关闭'}},current_owner:{html_type:'user_chooser',label:'处理人'}};
  else if(workflowMode&&url.pathname==='/workflows/all_transitions')data=[{Name:'in_progress-status_5',StepPrevious:'in_progress',StepNext:'status_5',Appendfield:workflowScenario==='unknown'?[]:[{DBModel:'Bug',FieldName:'remarks',Notnull:'yes'},{DBModel:'Bug',FieldName:'current_owner',Notnull:'no'},{DBModel:'Bug',FieldName:'enable_add_timesheet',Notnull:'no'},{DBModel:'Bug',FieldName:'transition_description',Notnull:'no'}]},{Name:'status_5-closed',StepPrevious:'status_5',StepNext:'closed',Appendfield:[]}];
  else if(workflowMode&&url.pathname==='/bugs'){
   if(workflowStatus==='status_5'&&workflowScenario==='unverified'){response.writeHead(503).end();return;}
   data=[{Bug:{id:'55555555',workspace_id:'12345678',title:'Workflow defect',status:workflowStatus,description:'Complete defect body'}}];
  }
  else if(iterationMode&&url.pathname==='/stories/get_fields_info')data={status:{options:{open:'Open',done:'Done'}},custom_field_example:{label:'Example attribute',html_type:'text',readonly:1},custom_field_design:{label:'Example design',html_type:'rich_edit',readonly:1}};
  else if(url.pathname.endsWith('/get_fields_info'))data={status:{options:{open:'Open',done:'Done'}}};
  else if(url.pathname==='/workflows/last_steps')data={done:'Done'};
  else if(['/stories','/tasks','/bugs'].includes(url.pathname)){
   const kind={'/stories':'Story','/tasks':'Task','/bugs':'Bug'}[url.pathname],id=url.searchParams.get('id');
   if(id){const row=rows.get(id),selected=iterationMode?url.searchParams.get('fields')?.split(','):null;data=row?[{[kind]:selected?Object.fromEntries(Object.entries(row).filter(([key])=>selected.includes(key))):row}]:[];}
   else if(iterationMode&&url.pathname==='/stories')data=[{Story:rows.get('11111111')}];
   else if(url.pathname==='/tasks'&&url.searchParams.get('story_id')==='11111111')data=[{Task:rows.get('33333333')}];
  }
  response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({status:1,data}));
 }catch(error){fixtureError=error;response.writeHead(500).end();}});await new Promise(resolve=>tapd.listen(0,'127.0.0.1',resolve));
 for(const key of ['TAPD_TOKEN','TAPD_API_ENDPOINT','TAPD_SITE_URL','TAPD_WORKSPACE_IDS'])delete process.env[key];
 const daemon=await createPaseoDaemon({listen:'127.0.0.1:0',paseoHome:home,daemonVersion:'0.14.0-beta.1',staticDir:join(root,'static'),agentStoragePath:join(home,'agents'),corsAllowedOrigins:[],mcpDebug:false,mcpEnabled:true,relayEnabled:false,browserToolsEnabled:false,pluginsEnabled:true,plugins:{},agentClients:{codex:syntheticProvider(()=>prompts++)},providerOverrides:Object.fromEntries(BUILTIN_PROVIDER_IDS.map(id=>[id,{enabled:id==='codex'}])),skillSelection:{mode:'custom',skills:[]},metadataGeneration:{providers:[]},idleRuntimeCleanup:false,webUi:{enabled:false,distDir:null}},logger);
 let client,mcp,bridge;
 try{
  await daemon.start();const listen=daemon.getListenTarget();assert.equal(listen.type,'tcp');
  client=createHostClient(`127.0.0.1:${listen.port}`,{clientId:'example-navigation',clientType:'cli',logger,reconnect:{enabled:false}});await client.connect();await client.installDirectoryPlugin(pluginDir);
  const rpc=(name,input={})=>client.invokePluginRpc('tapd-workbench',name,input),settings=settingsRpc('tapd-workbench-config');
  const initial=await rpc(settings.read.name),api=`http://127.0.0.1:${tapd.address().port}`;
  assert.equal((await rpc(settings.write.name,{revision:initial.revision,values:{...initial.values,token:'example-secret',workspaceIds:'12345678',apiEndpoint:api,siteUrl:'https://example.com'}})).status,'saved');
  const agent=await client.createAgent({provider:'codex',cwd:root,model:'example-model',modeId:'full-access'});
  const useCaller=async id=>{await mcp?.close();mcp=new Client({name:'example-navigation',version:'1'});await mcp.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${listen.port}/mcp/agents?callerAgentId=${id}`)));};
  const tool=async(name,input)=>{const result=await mcp.callTool({name,arguments:input});assert.notEqual(result.isError,true);return result.structuredContent??JSON.parse(result.content.find(block=>block.type==='text').text);};
  let finish;const stopped=new Promise(resolve=>{finish=resolve;});
  bridge=createServer(async(request,response)=>{try{
   let raw='';for await(const chunk of request)raw+=chunk;const input=raw?JSON.parse(raw):{};let result;
   if(request.url==='/rpc')result=await rpc(input.name,input.input);
   else if(request.url==='/state')result={agentId:agent.id,workspaceId:agent.workspaceId,apiEndpoint:api,reads:reads.length,readDetails,writes,prompts,workflowPosts,iterationPosts};
   else if(request.url==='/iteration-scenario'&&iterationMode){failIterationReadback=input.failReadback===true;if(!failIterationReadback)iterationReadbackBlocked=false;result={ok:true};}
   else if(request.url==='/iteration-tool'&&iterationMode){await useCaller(agent.id);result=await tool('tapd_update_iteration',input);}
   else if(request.url==='/cards'&&iterationMode)result=(await client.fetchAgentTimeline(agent.id)).entries.map(entry=>entry.item).filter(item=>item.type==='plugin'&&item.kind==='tapd-entity-result');
   else if(request.url==='/scenario'&&workflowMode){workflowScenario=input.scenario;workflowStatus='in_progress';await client.reloadPlugin('tapd-workbench');result={ok:true};}
   else if(request.url==='/stop'){result={ok:true};finish();}
   else throw Error('Unavailable');
   response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(result));
  }catch{response.writeHead(400,{'content-type':'application/json'}).end(JSON.stringify({error:'Operation unavailable'}));}});
  await new Promise(resolve=>bridge.listen(0,'127.0.0.1',resolve));await writeFile(join(root,'ready.json'),JSON.stringify({port:bridge.address().port}));
  await stopped;assert.ifError(fixtureError);assert.equal(writes,0);assert.equal(prompts,0);
 }finally{if(bridge)await new Promise(resolve=>bridge.close(resolve));await mcp?.close();await client?.close();await daemon.stop();await new Promise(resolve=>tapd.close(resolve));}
}
