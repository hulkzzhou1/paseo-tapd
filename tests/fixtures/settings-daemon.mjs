// A disposable real daemon and public client, driven by the settings UI fixture.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile,symlink,cp} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {settingsRpc} from '@getpaseo/plugin';
const pluginDir=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export async function runSettingsDaemon(root) {
  assert.equal(await readFile(join(homedir(),'tapd-test-home-marker'),'utf8'),'isolated');
  const req=createRequire(join(process.env.PASEO_RUNTIME_DIR,'packages/cli/package.json'));
  const load=name=>import(pathToFileURL(req.resolve(name)).href);
  const {createPaseoDaemon,BUILTIN_PROVIDER_IDS}=await load('@getpaseo/server');
  const {createHostClient}=await load('@getpaseo/client/node');
  const logger=req('pino')({level:'silent'}),home=join(root,'home'),legacyDir=join(root,'legacy-plugin');
  await mkdir(home);await mkdir(legacyDir);await mkdir(join(root,'static'));
  await symlink(join(pluginDir,'node_modules'),join(legacyDir,'node_modules'));
  await writeFile(join(legacyDir,'paseo-plugin.json'),await readFile(join(pluginDir,'paseo-plugin.json')));
  await writeFile(join(legacyDir,'index.client.tsx'),'export default function contribute() {return ()=>{};}');
  await writeFile(join(legacyDir,'index.server.ts'),`import {defineSettings} from '@getpaseo/plugin';import {z} from 'zod';export default function contribute(server){server.registerSettings(defineSettings({id:'tapd-workbench-config',scope:'host',version:6,schema:z.object({}).passthrough()}));return ()=>{};}`);
  // A Git trap records accidental configuration subprocesses; dispatch is checked separately.
  const bin=join(root,'bin'),trap=join(root,'git-attempts');await mkdir(bin);
  await writeFile(join(bin,'git'),`#!/bin/sh\nprintf 'unexpected git invocation\\n' >> '${trap}'\nexit 1\n`,{mode:0o700});
  process.env.PATH=`${bin}:${process.env.PATH}`;
  process.env.PASEO_HOME=home;
  for(const key of ['TAPD_TOKEN','TAPD_API_ENDPOINT','TAPD_SITE_URL','TAPD_WORKSPACE_IDS'])delete process.env[key];
  const daemon=await createPaseoDaemon({listen:'127.0.0.1:0',paseoHome:home,daemonVersion:'0.14.0-beta.1',staticDir:join(root,'static'),agentStoragePath:join(home,'agents'),corsAllowedOrigins:[],mcpDebug:false,mcpEnabled:false,relayEnabled:false,browserToolsEnabled:false,pluginsEnabled:true,plugins:{},agentClients:{},providerOverrides:Object.fromEntries(BUILTIN_PROVIDER_IDS.map(id=>[id,{enabled:false}])),skillSelection:{mode:'custom',skills:[]},metadataGeneration:{providers:[]},idleRuntimeCleanup:false,webUi:{enabled:false,distDir:null}},logger);
  let client,bridge;
  try {
    await daemon.start();const listen=daemon.getListenTarget();assert.equal(listen.type,'tcp');
    client=createHostClient(`127.0.0.1:${listen.port}`,{clientId:'example-settings',clientType:'cli',logger,reconnect:{enabled:false}});await client.connect();
    await client.installDirectoryPlugin(legacyDir);
    const contracts=settingsRpc('tapd-workbench-config');
    const rpc=(name,input={})=>client.invokePluginRpc('tapd-workbench',name,input);
    const previous=await rpc(contracts.read.name);
    const legacy={token:'example-secret',workspaceIds:'12345678',apiEndpoint:'https://api.example.com',siteUrl:'https://example.com',syncGitUrl:'https://backup.example.com/example.git',syncGitToken:'example-retired-secret',syncBranch:'example-branch',favorites:['story-11111111'],columns:{story:['open']},groupByStatus:true,lastRepoPath:'/example/repository',lastProvider:'example-provider',views:[{id:'example-view',name:'Saved example',filters:{ownerMode:'all'}}],defaultViewId:'example-view',links:[{key:'story-11111111',kind:'story',id:'11111111',workspaceId:'example-workspace',agentId:'example-agent'}],createFieldLayout:{task:{order:['name'],hidden:[]}}};
    assert.equal((await rpc(contracts.write.name,{revision:previous.revision,values:legacy})).status,'saved');
    for(const directory of ['server','shared'])await cp(join(pluginDir,directory),join(legacyDir,directory),{recursive:true});
    await cp(join(pluginDir,'index.server.ts'),join(legacyDir,'index.server.ts'));
    await client.reloadPlugin('tapd-workbench');
    const upgraded=await rpc(contracts.read.name);assert.equal(upgraded.status,'ready');
    for(const key of ['syncGitUrl','syncGitToken','syncBranch'])assert.equal(key in upgraded.values,false,`${key} is retired by SDK migration`);
    for(const key of ['token','workspaceIds','apiEndpoint','siteUrl','favorites','columns','groupByStatus','lastRepoPath','lastProvider','defaultViewId','createFieldLayout'])assert.deepEqual(upgraded.values[key],legacy[key]);
    assert.equal(upgraded.values.links[0].agentId,'example-agent');assert.equal(upgraded.values.views[0].name,'Saved example');
    let finish;const stopped=new Promise(resolve=>{finish=resolve;});
    bridge=createServer(async(request,response)=>{
      try {
        let raw='';for await(const part of request)raw+=part;
        const input=raw?JSON.parse(raw):{};let result;
        if(request.url==='/rpc') {
          assert([contracts.read.name,contracts.write.name,'tapd.sync_push','tapd.sync_pull'].includes(input.name));
          result=await rpc(input.name,input.input);
        } else if(request.url==='/reload') {await client.reloadPlugin('tapd-workbench');result={ok:true};}
        else if(request.url==='/stop') {result={ok:true};finish();}
        else throw Error('Unknown fixture operation');
        response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(result));
      } catch {response.writeHead(400,{'content-type':'application/json'}).end(JSON.stringify({error:'Operation unavailable'}));}
    });
    await new Promise(resolve=>bridge.listen(0,'127.0.0.1',resolve));
    await writeFile(join(root,'ready.json'),JSON.stringify({port:bridge.address().port}));
    await stopped;
    await assert.rejects(readFile(trap),{code:'ENOENT'});
  } finally {if(bridge)await new Promise(resolve=>bridge.close(resolve));await client?.close();await daemon.stop();}
}
