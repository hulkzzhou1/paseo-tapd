// Public real daemon/client entry points, disposable user/mount namespace and loopback TAPD only.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir,homedir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {settingsRpc} from '@getpaseo/plugin';
import {runPublicDaemonSandbox} from './fixtures/public-daemon-sandbox.mjs';
import {ownershipProvider} from './fixtures/ownership-provider.mjs';
const self=fileURLToPath(import.meta.url),pluginDir=resolve(dirname(self),'..');
const [phase,fixtureRoot]=process.argv.slice(2);
const target={kind:'story',id:'11111111',workspaceId:'12345678',confirmed:true};
assert(process.env.PASEO_RUNTIME_DIR,'Set PASEO_RUNTIME_DIR to a compatible built Paseo checkout');
let step='start';
const checkpoint=value=>{step=value;console.log(JSON.stringify({checkpoint:value}));};
async function daemonPhase(){
 assert.equal(await readFile(join(homedir(),'tapd-test-home-marker'),'utf8'),'isolated');
 assert(['seed','restart'].includes(phase));assert.equal(process.env.PASEO_HOME,join(fixtureRoot,'home'));
 const req=createRequire(join(resolve(process.env.PASEO_RUNTIME_DIR),'packages/cli/package.json'));
 const publicImport=name=>import(pathToFileURL(req.resolve(name)).href);
 const {createPaseoDaemon,loadPersistedConfig,BUILTIN_PROVIDER_IDS}=await publicImport('@getpaseo/server');
 const {createHostClient}=await publicImport('@getpaseo/client/node');
 const {Client}=await publicImport('@modelcontextprotocol/sdk/client/index.js');
 const {StreamableHTTPClientTransport}=await publicImport('@modelcontextprotocol/sdk/client/streamableHttp.js');
 const logger=req('pino')({level:'silent'}),home=process.env.PASEO_HOME;
 let prompts=0;
 const persisted=loadPersistedConfig(home,logger);
 // Trusted main code retains an older package version; exercise the declared beta SDK contract.
 checkpoint('construct-daemon');
 const daemon=await createPaseoDaemon({listen:'127.0.0.1:0',paseoHome:home,daemonVersion:'0.14.0-beta.1',staticDir:join(fixtureRoot,'static'),agentStoragePath:join(home,'agents'),corsAllowedOrigins:[],mcpDebug:false,mcpEnabled:true,relayEnabled:false,browserToolsEnabled:false,pluginsEnabled:true,plugins:persisted.plugins,agentClients:{codex:ownershipProvider(()=>prompts++)},providerOverrides:Object.fromEntries(BUILTIN_PROVIDER_IDS.map(id=>[id,{enabled:id==='codex'}])),skillSelection:{mode:'custom',skills:[]},metadataGeneration:{providers:[]},idleRuntimeCleanup:false,webUi:{enabled:false,distDir:null}},logger);
 let client,mcp;
 try{
  checkpoint('start-daemon');await daemon.start();const listen=daemon.getListenTarget();assert.equal(listen.type,'tcp');
  const connect=async()=>{client=createHostClient(`127.0.0.1:${listen.port}`,{clientId:'ownership-acceptance',clientType:'cli',logger,reconnect:{enabled:false}});await client.connect();};
  checkpoint('connect-client');await connect();if(phase==='seed'){checkpoint('install-plugin');await client.installDirectoryPlugin(pluginDir);}checkpoint('plugin-running');
  assert.equal((await client.listPlugins()).find(p=>p.id==='tapd-workbench')?.status,'running');
  const rpc=(name,input={})=>client.invokePluginRpc('tapd-workbench',`tapd.${name}`,input);
  const counts=()=>fetch(`${process.env.TAPD_API_ENDPOINT}/fixture/counts`).then(response=>response.json());
  const board=agentId=>rpc('task-board',{agentId});
  const useCaller=async agentId=>{await mcp?.close();mcp=new Client({name:'ownership-acceptance',version:'1'});await mcp.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${listen.port}/mcp/agents?callerAgentId=${agentId}`)));};
  const tool=async(name,input)=>{const result=await mcp.callTool({name,arguments:input});assert.notEqual(result.isError,true,`Tool ${name} failed`);return result.structuredContent??JSON.parse(result.content.find(block=>block.type==='text').text);};
  const settings=settingsRpc('tapd-workbench-config');
  const saveLegacy=async links=>{const current=await client.invokePluginRpc('tapd-workbench',settings.read.name,{});const saved=await client.invokePluginRpc('tapd-workbench',settings.write.name,{revision:current.revision,values:{...current.values,links}});assert.equal(saved.status,'saved');};
  if(phase==='seed'){
   checkpoint('create-synthetic-agents');
   const a=await client.createAgent({provider:'codex',cwd:fixtureRoot,model:'example-model',modeId:'full-access'});
   const b=await client.createAgent({provider:'codex',cwd:fixtureRoot,model:'example-model',modeId:'full-access'});
   const c=await client.createAgent({provider:'codex',cwd:fixtureRoot,model:'example-model',modeId:'full-access'});
   assert(a.id&&b.id&&c.id);
   const legacy=(id,agent)=>({key:`story-${id}`,kind:'story',id,agentId:agent.id,workspaceId:agent.workspaceId??'',agentTitle:'Fixture',workspaceTitle:'',createdAt:''});
   const sources=[legacy('33333333',a),legacy('33333333',b),legacy('44444444',c)];
   await saveLegacy(sources);
   const savedSettings=await client.invokePluginRpc('tapd-workbench',settings.read.name,{});assert.equal(savedSettings.values.links.length,3,'Legacy settings persisted');
   assert(await client.fetchAgent(b.id),'Created Agent is present through public client');
   checkpoint('persist-migration');
   const groups=await rpc('task.migration',{agentId:b.id});
   const selected=groups.groups.find(group=>group.id==='33333333');assert(selected,`Expected migration group; groups=${groups.groups.length}, warnings=${groups.warnings.length}`);assert.equal(selected.candidates.length,2);
   await rpc('task.migration.confirm',{...target,id:'33333333',agentId:b.id,expectedRevision:selected.revision});
   checkpoint('persist-transfer-release-offer');
   const owned=await rpc('task.claim',{...target,agentId:a.id});
   const moved=await rpc('task.transfer',{...target,targetAgentId:b.id,expectedOwnerAgentId:a.id,expectedRevision:owned.link.responsibility.revision,reason:'Approved fixture transfer'});
   const released=await rpc('task.claim',{...target,id:'22222222',agentId:a.id});
   await rpc('task.release',{...target,id:'22222222',agentId:a.id,expectedRevision:released.link.responsibility.revision,reason:'Approved fixture release'});
   const archived=await rpc('task.claim',{...target,id:'55555555',agentId:a.id});
   await useCaller(a.id);
   const offer=await tool('tapd_delegate_task',{...target,id:'55555555',targetAgentId:b.id,expectedOwnerAgentId:a.id,expectedRevision:archived.link.responsibility.revision,reason:'Pending approved handover'});
   assert(offer.offer.offerId);
   checkpoint('close-archive-retain');
   await client.closeItems({agentIds:[b.id]});
   assert.equal((await board(b.id)).items.length,2);
   await client.archiveAgent(a.id);assert.equal((await board(a.id)).items.length,1);
   checkpoint('offline-reload-no-replay');
   const before=await counts();await mcp.close();mcp=undefined;await client.close();await connect();await client.reloadPlugin('tapd-workbench');
   assert.equal((await rpc('agent-links')).links.filter(link=>link.responsibility).length,3);
   assert.deepEqual(await counts(),before,'Reload/reconnect recovery performs no TAPD requests');
   await writeFile(join(fixtureRoot,'fixture.json'),JSON.stringify({a:a.id,b:b.id,c:c.id,sources,movedRevision:moved.link.responsibility.revision,pendingOffer:offer.offer.offerId}),{mode:0o600});
  }else{
   const fixture=JSON.parse(await readFile(join(fixtureRoot,'fixture.json'),'utf8'));
   checkpoint('restart-local-recovery');const before=await counts();
   const links=await rpc('agent-links');assert.equal(links.links.filter(link=>link.responsibility).length,3);assert(links.links.some(link=>!link.responsibility&&link.agentId===fixture.c));
   await client.refreshAgent(fixture.b);await useCaller(fixture.b);
   const history=await tool('tapd_task_history',target);assert(history.history.some(event=>event.reason==='Approved fixture transfer'));
   assert.deepEqual(await counts(),before,'Restart and local history do not perform TAPD reads/writes');
   assert.deepEqual((await board(fixture.b)).items.map(item=>item.entity.id).sort(),['11111111','33333333']);
   assert.equal((await board(fixture.a)).items[0].entity.id,'55555555','Archive retains reservation across daemon processes');
   await client.refreshAgent(fixture.a);assert.equal((await client.fetchAgent(fixture.a)).agent.archivedAt,null);assert.equal((await board(fixture.a)).items.length,1,'Explicit reopen restores access without executing a prompt');
   assert.deepEqual((await rpc('task.migration',{agentId:fixture.c})).groups.map(group=>group.id),['44444444']);
   checkpoint('delete-preserve-other-owner');
   await client.deleteAgent(fixture.a);await client.deleteAgent(fixture.c);
   const after=await rpc('agent-links');assert(after.links.every(link=>link.agentId===fixture.b));
   assert.equal((await board(fixture.b)).items.length,2);
   const remainingHistory=await tool('tapd_task_history',target);assert.deepEqual(remainingHistory.history.map(event=>event.action),['transfer']);
   const oldOffer=await mcp.callTool({name:'tapd_accept_task',arguments:{...target,id:'55555555',offerId:fixture.pendingOffer,reason:'Stale handover',confirmed:true}});assert.equal(oldOffer.isError,true);
   checkpoint('legacy-replay-and-corrupt-retention');
   await saveLegacy([...fixture.sources,{...fixture.sources[0],id:'66666666',key:'story-66666666',agentTitle:'Replayed source'}]);
   await client.reloadPlugin('tapd-workbench');assert.deepEqual((await rpc('task.migration',{agentId:fixture.b})).groups,[]);
   assert((await rpc('agent-links')).pendingAgents.every(link=>link.agentId===fixture.b));
   const file=join(home,'plugin-data/tapd-workbench/agent-links.json'),valid=await readFile(file,'utf8');
   await writeFile(file,'corrupt-fixture');await client.reloadPlugin('tapd-workbench');await assert.rejects(rpc('agent-links'));assert.equal(await readFile(file,'utf8'),'corrupt-fixture');
   await writeFile(file,valid);await client.reloadPlugin('tapd-workbench');assert.equal((await board(fixture.b)).items.length,2);
   await assert.rejects(rpc('task.claim',{...target,id:'55555555',agentId:fixture.a}));
   assert.equal((await rpc('task.claim',{...target,id:'55555555',agentId:fixture.b})).changed,true,'Surviving Agent may explicitly accept released responsibility');
  }
  assert.equal(prompts,0,'Recovery and direct assignments never run the provider');
  console.log(JSON.stringify({ok:true,phase,prompts}));
 }catch(error){console.log(JSON.stringify({ok:false,phase,step,errorKind:`${error.name}:${error.code??''}`,versionRelated:/version|requirements/i.test(error.message??''),message:error instanceof assert.AssertionError?error.message:error instanceof TypeError?error.message:undefined}));throw error;}finally{await mcp?.close();await client?.close();await daemon.stop();}
}
async function isolated(){
 const root=await mkdtemp(join(tmpdir(),'tapd-ownership-daemon-'));let child;const reads=[],writes=[];let fixtureError;
 const mock=createServer(async(request,response)=>{try{
  const url=new URL(request.url,'http://127.0.0.1');
  if(url.pathname==='/fixture/counts'){response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({reads:reads.length,writes:writes.length}));return;}
  assert.equal(request.method,'GET','No TAPD write, label mutation or write replay is allowed');reads.push(url.pathname);
  assert(['/stories','/stories/get_fields_info','/workflows/last_steps'].includes(url.pathname));
  const data=url.pathname==='/stories'?[{Story:{id:url.searchParams.get('id'),workspace_id:target.workspaceId,name:'Fixture',status:'open'}}]:url.pathname==='/workflows/last_steps'?{done:'Done'}:{status:{options:{open:'Open',done:'Done'}}};
  response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({status:1,data}));
 }catch(error){fixtureError=error;if(request.method==='POST')writes.push('unexpected');response.writeHead(500).end();}});
 try{
  await mkdir(join(root,'home'),{mode:0o700});await mkdir(join(root,'static'));await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
  const env=Object.fromEntries(['PATH','LANG','LC_ALL','LD_LIBRARY_PATH','FONTCONFIG_FILE'].flatMap(key=>process.env[key]?[[key,process.env[key]]]:[]));
  Object.assign(env,{PASEO_RUNTIME_DIR:resolve(process.env.PASEO_RUNTIME_DIR),PASEO_HOME:join(root,'home'),PASEO_RELAY_ENABLED:'false',PASEO_LOCAL_SPEECH_AUTO_DOWNLOAD:'0',PASEO_DICTATION_ENABLED:'0',PASEO_VOICE_MODE_ENABLED:'0',TAPD_TOKEN:'example-fixture-secret',TAPD_API_ENDPOINT:`http://127.0.0.1:${mock.address().port}`,TAPD_SITE_URL:'https://example.com',TAPD_WORKSPACE_IDS:target.workspaceId});
  const pids=[];
  for(const stage of ['seed','restart']){
   let output='';child=spawn(process.execPath,[self,stage,root],{env,stdio:['ignore','pipe','pipe'],detached:true});pids.push(child.pid);
   child.stdout.on('data',chunk=>{output=(output+chunk).slice(-8192);});child.stderr.on('data',()=>{});
   const timer=setTimeout(()=>{process.kill(-child.pid,'SIGTERM');setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},1000).unref();},45000);
   const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});clearTimeout(timer);
   const last=output.split('\n').filter(line=>line.startsWith('{\"checkpoint\":')).at(-1);
   const report=output.split('\n').findLast(line=>line.startsWith('{"ok":'));const parsed=report&&JSON.parse(report);
   assert.equal(code,0,`Ownership daemon ${stage} failed at ${parsed?.step??(last?JSON.parse(last).checkpoint:'startup')} (${parsed?.errorKind??'unknown'}): ${parsed?.message??''}`);assert.equal(parsed?.ok,true);assert.deepEqual(writes,[]);
  }
  assert.ifError(fixtureError);assert.equal(new Set(pids).size,2);
  console.log(JSON.stringify({ok:true,distinctDaemonProcesses:true,publicExportsOnly:true,ownershipRecovery:true,migrationTransferRelease:true,archiveRetention:true,deletionCleanup:true,legacyReplaySuppressed:true,corruptStoragePreserved:true,providerPrompts:0,tapdWrites:0,replayedWrites:0}));
 }finally{if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await new Promise(resolve=>mock.close(resolve));await rm(root,{recursive:true,force:true});}
}
(phase==='sandbox'?isolated():phase?daemonPhase():runPublicDaemonSandbox(self,pluginDir)).catch(error=>{console.log(JSON.stringify({ok:false,phase:phase??'parent',step,errorKind:`${error.name}:${error.code??''}`,message:error instanceof assert.AssertionError?error.message:undefined}));process.exitCode=1;});
