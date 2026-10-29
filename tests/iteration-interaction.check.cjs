// Actual workbench, client entry and full detail -> real isolated daemon RPC. No screenshots.
const assert=require('node:assert/strict'),{createRequire}=require('node:module');
const {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os'),path=require('node:path'),{pathToFileURL}=require('node:url'),{spawn}=require('node:child_process'),http=require('node:http');
async function main(){
 assert(process.env.PASEO_RUNTIME_DIR,'Set PASEO_RUNTIME_DIR to a compatible built Paseo checkout');
 const runtime=path.resolve(process.env.PASEO_RUNTIME_DIR),fromApp=createRequire(path.join(runtime,'packages/app/package.json')),root=path.resolve(__dirname,'..'),temp=mkdtempSync(path.join(tmpdir(),'tapd-iteration-ui-'));
 let worker,server,browser,bridgePort,output='',completed=false;
 try{
  const wrapper=path.join(temp,'daemon.mjs');writeFileSync(wrapper,`import {runNavigationDaemon} from ${JSON.stringify(pathToFileURL(path.join(root,'tests/fixtures/navigation-daemon.mjs')).href)};import {runPublicDaemonSandbox} from ${JSON.stringify(pathToFileURL(path.join(root,'tests/fixtures/public-daemon-sandbox.mjs')).href)};if(process.argv[2]==='sandbox')await runNavigationDaemon(${JSON.stringify(temp)},false,true);else await runPublicDaemonSandbox(${JSON.stringify(wrapper)},${JSON.stringify(root)});`);
  worker=spawn(process.execPath,[wrapper],{env:{...process.env,PASEO_RUNTIME_DIR:runtime},stdio:['ignore','pipe','pipe']});for(const pipe of [worker.stdout,worker.stderr])pipe.on('data',chunk=>{output=(output+chunk).slice(-4000);});
  for(let count=0;!existsSync(path.join(temp,'ready.json'));count++){assert(count<300&&worker.exitCode===null,`Isolated navigation daemon failed: ${output}`);await new Promise(resolve=>setTimeout(resolve,100));}
  bridgePort=JSON.parse(readFileSync(path.join(temp,'ready.json'))).port;
  const bridge=(url,body={})=>fetch(`http://127.0.0.1:${bridgePort}${url}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const fixture=await(await bridge('/state')).json(),settings=await(await bridge('/rpc',{name:'settings.tapd-workbench-config.read',input:{}})).json();
  const host=path.join(temp,'host.tsx');writeFileSync(host,`
    import React,{useCallback} from 'react';export {TextInput,ScrollView,FlatList} from 'react-native';
    export const defineRpc=value=>value,defineSettings=value=>value,defineAttachmentSource=value=>value;
    export const SidebarRow=()=>null,useAgent=()=>window.fixture.workspaceId;export const Icon=()=>null,SettingsAction=()=>null,SettingsCard=()=>null,SettingsInput=()=>null,SettingsRow=()=>null,SettingsSection=()=>null;
    export const useToast=()=>({error:message=>{window.toast=message;},show:message=>{window.toast=message;}}),copyText=async()=>{},openExternalUrl=async()=>{};
    export const useSettings=()=>window.settings;
    export const usePaseo=()=>({agents:{subscribe:()=>()=>{},list:async()=>({entries:[]})},projects:{list:async()=>({projects:[]})},providers:{snapshot:async()=>({entries:[]})}});
    export const useRpc=contract=>useCallback(input=>window.rpc(contract,input),[contract]);
  `);
  const entry=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {View,Text,Pressable} from 'react-native';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import contributeClient from ${JSON.stringify(path.join(root,'index.client.tsx'))};import {DEFAULT_FILTERS} from ${JSON.stringify(path.join(root,'shared/contracts.ts'))};
    window.fixture=${JSON.stringify(fixture)};window.settings=${JSON.stringify(settings)};window.calls=[];window.panelsOpened=[];window.cards=[];window.settings.values.views=[{id:'all',name:'All',filters:{...DEFAULT_FILTERS,ownerMode:'all'}}];window.settings.values.defaultViewId='all';
    window.rpc=async(contract,input)=>{window.calls.push({name:contract.name,input});const response=await fetch('/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:contract.name,input})});const result=await response.json();if(!response.ok)throw Error('Operation unavailable');return result;};
    const screens=new Map();
    const forbidden=()=>{throw Error('Retired conversation integration must not be registered');};
    const client={addScreen:s=>screens.set(s.id,s),addSettingsScreen:()=>{},addSidebarHeaderItem:()=>{},addCommandCenterItem:()=>{},addAttachmentSource:()=>{},addTimelineTransformer:forbidden,addTimelineRenderer:forbidden,addAgentPanel:forbidden,addComposerPill:forbidden};
    const colors={surface0:'#fff',surface1:'#f8fafc',surface2:'#e2e8f0',border:'#cbd5e1',foreground:'#0f172a',foregroundMuted:'#475569',accent:'#2563eb',accentForeground:'#fff',statusSuccess:'#15803d',statusWarning:'#b45309',statusDanger:'#b91c1c'};
    window.clientCleanup=contributeClient(client);
    function App(){const Board=screens.get('tapd-board').Component;return <View style={{height:'100vh'}}><Board theme={{colors}} navigation={{}} layout={{compact:false}} /></View>;}
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><App/></QueryClientProvider>);
  `;
  const script=fromApp('esbuild').buildSync({stdin:{contents:entry,loader:'tsx',resolveDir:root},bundle:true,write:false,define:{'process.env.NODE_ENV':'"development"'},alias:{react:fromApp.resolve('react'),'react/jsx-runtime':fromApp.resolve('react/jsx-runtime'),'react-dom/client':fromApp.resolve('react-dom/client'),'react-dom':fromApp.resolve('react-dom'),'react-native':fromApp.resolve('react-native-web'),'@getpaseo/plugin':host,'@getpaseo/plugin/client':host,'@getpaseo/plugin/client/react-native':host,'@getpaseo/plugin/client/ui':host},logLevel:'silent'}).outputFiles[0].text;
  server=http.createServer(async(req,res)=>{if(req.url==='/cards'){const response=await bridge('/cards');res.writeHead(response.status,{'content-type':'application/json'}).end(await response.text());return;}if(req.url==='/rpc'){let raw='';for await(const chunk of req)raw+=chunk;const response=await bridge('/rpc',JSON.parse(raw));res.writeHead(response.status,{'content-type':'application/json'}).end(await response.text());return;}res.writeHead(200,{'content-type':req.url==='/app.js'?'text/javascript':'text/html'}).end(req.url==='/app.js'?script:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/app.js"></script>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await fromApp('@playwright/test').chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1200,height:1000}}),errors=[],remote=[];page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(!request.url().startsWith('http://127.0.0.1:'))remote.push(request.url());});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  assert.equal(await page.evaluate(()=>typeof window.clientCleanup),'function');
  await page.getByText('Previous iteration',{exact:true}).first().waitFor();
  await page.getByText('Direct task',{exact:true}).click();
  const detail=page.getByRole('dialog',{name:'#11111111 · 单据详情',exact:true});
  await detail.getByRole('heading',{name:'Full direct detail',exact:true}).waitFor();
  await detail.getByText('Mixed short value',{exact:true}).waitFor();
  assert.equal(await detail.getByRole('button',{name:'绑定 Agent',exact:true}).count(),0);
  assert.equal(await detail.getByRole('button',{name:'派给 Agent',exact:true}).count(),1);
  const initial=await(await bridge('/state')).json();
  assert(initial.readDetails.filter(read=>read.path==='/stories').every(read=>read.query.fields&&!read.query.fields.split(',').includes('custom_field_design')));
  await detail.getByRole('tab',{name:'Example design',exact:true}).click();
  await detail.getByRole('heading',{name:'Mixed design document',exact:true}).waitFor();
  const changed=await bridge('/iteration-tool',{kind:'story',id:'11111111',workspaceId:'12345678',iterationId:'77777777',expectedValue:'66666666',confirmed:true});assert.equal(changed.status,200);assert.equal((await changed.json()).outcome,'verified');
  await detail.getByRole('tab',{name:'详细信息',exact:true}).click();
  await detail.getByRole('button',{name:'刷新',exact:true}).click();
  await detail.getByText('Selected iteration',{exact:true}).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'刷新',exact:true}).click();
  await page.getByText('Selected iteration',{exact:true}).first().waitFor();
  assert.deepEqual(await(await bridge('/cards')).json(),[]);
  await page.getByText('Direct task',{exact:true}).click();
  await detail.getByText('Selected iteration',{exact:true}).waitFor();
  assert.equal((await bridge('/iteration-scenario',{failReadback:true})).status,200);
  const unverified=await bridge('/iteration-tool',{kind:'story',id:'11111111',workspaceId:'12345678',iterationId:'66666666',expectedValue:'77777777',confirmed:true});
  assert.equal(unverified.status,200);const accepted=await unverified.json();assert.equal(accepted.writeState,'accepted');assert.equal(accepted.outcome,'unverified');
  await detail.getByRole('button',{name:'刷新',exact:true}).click();
  await detail.getByRole('button',{name:'重试加载单据',exact:true}).waitFor();
  assert.equal((await bridge('/iteration-scenario',{failReadback:false})).status,200);
  await detail.getByRole('button',{name:'重试加载单据',exact:true}).click();
  await detail.getByText('Previous iteration',{exact:true}).waitFor();
  await detail.getByRole('tab',{name:'Example design',exact:true}).click();
  await detail.getByText('Design remains readable after planning',{exact:true}).waitFor();
  assert.deepEqual(await(await bridge('/cards')).json(),[]);
  const state=await(await bridge('/state')).json();assert.equal(state.iterationPosts.length,2);assert.equal(state.prompts,0);
  const retired=await bridge('/rpc',{name:'tapd.task-board',input:{agentId:fixture.agentId}});assert.equal(retired.status,400);
  assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);await bridge('/stop');assert.equal(await new Promise(resolve=>worker.once('exit',resolve)),0);completed=true;
  console.log(JSON.stringify({ok:true,realToolAndRpc:true,noConversationContributions:true,noTimelineRegistrations:true,fullDetail:true,manualRefresh:true,readonlyDocument:true,acceptedUnverifiedRecovery:true,noWriteReplay:true,providerPrompts:0,screenshots:0}));
 }finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));if(worker&&!completed){if(bridgePort)await fetch(`http://127.0.0.1:${bridgePort}/stop`,{method:'POST'}).catch(()=>{});worker.kill('SIGTERM');}rmSync(temp,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
