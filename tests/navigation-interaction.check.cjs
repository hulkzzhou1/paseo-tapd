// Actual conversation board and detail panels -> real isolated daemon RPC. No screenshots.
const assert=require('node:assert/strict'),{createRequire}=require('node:module');
const {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os'),path=require('node:path'),{pathToFileURL}=require('node:url'),{spawn}=require('node:child_process'),http=require('node:http');
async function main(){
 assert(process.env.PASEO_RUNTIME_DIR,'Set PASEO_RUNTIME_DIR to a compatible built Paseo checkout');
 const runtime=path.resolve(process.env.PASEO_RUNTIME_DIR),fromApp=createRequire(path.join(runtime,'packages/app/package.json')),root=path.resolve(__dirname,'..'),temp=mkdtempSync(path.join(tmpdir(),'tapd-navigation-ui-'));
 let worker,server,browser,bridgePort,output='',completed=false;
 try{
  const wrapper=path.join(temp,'daemon.mjs');writeFileSync(wrapper,`import {runNavigationDaemon} from ${JSON.stringify(pathToFileURL(path.join(root,'tests/fixtures/navigation-daemon.mjs')).href)};import {runPublicDaemonSandbox} from ${JSON.stringify(pathToFileURL(path.join(root,'tests/fixtures/public-daemon-sandbox.mjs')).href)};if(process.argv[2]==='sandbox')await runNavigationDaemon(${JSON.stringify(temp)});else await runPublicDaemonSandbox(${JSON.stringify(wrapper)},${JSON.stringify(root)});`);
  worker=spawn(process.execPath,[wrapper],{env:{...process.env,PASEO_RUNTIME_DIR:runtime},stdio:['ignore','pipe','pipe']});for(const pipe of [worker.stdout,worker.stderr])pipe.on('data',chunk=>{output=(output+chunk).slice(-4000);});
  for(let count=0;!existsSync(path.join(temp,'ready.json'));count++){assert(count<300&&worker.exitCode===null,`Isolated navigation daemon failed: ${output}`);await new Promise(resolve=>setTimeout(resolve,100));}
  bridgePort=JSON.parse(readFileSync(path.join(temp,'ready.json'))).port;
  const bridge=(url,body={})=>fetch(`http://127.0.0.1:${bridgePort}${url}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const fixture=await(await bridge('/state')).json(),settings=await(await bridge('/rpc',{name:'settings.tapd-workbench-config.read',input:{}})).json();
  const host=path.join(temp,'host.tsx');writeFileSync(host,`
    import React,{useCallback} from 'react';export {TextInput,ScrollView,FlatList} from 'react-native';
    export const defineRpc=value=>value,defineSettings=value=>value,defineAttachmentSource=value=>value;
    export const Icon=()=>null,SettingsAction=()=>null,SettingsCard=()=>null,SettingsInput=()=>null,SettingsRow=()=>null,SettingsSection=()=>null;
    export const useToast=()=>({error:message=>{window.toast=message;},show:message=>{window.toast=message;}}),copyText=async()=>{},openExternalUrl=async()=>{};
    export const useSettings=()=>window.settings;
    export const usePaseo=()=>({agents:{subscribe:()=>()=>{},list:async()=>({entries:[]})},projects:{list:async()=>({projects:[]})},providers:{snapshot:async()=>({entries:[]})}});
    export const useRpc=contract=>useCallback(input=>window.rpc(contract,input),[contract]);
  `);
  const entry=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {View,Text,Pressable} from 'react-native';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {contributeConversationAccess} from ${JSON.stringify(path.join(root,'client/conversation/ConversationAccess.tsx'))};
    window.fixture=${JSON.stringify(fixture)};window.settings=${JSON.stringify(settings)};window.calls=[];window.panelsOpened=[];
    window.rpc=async(contract,input)=>{window.calls.push({name:contract.name,input});const response=await fetch('/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:contract.name,input})});const result=await response.json();if(!response.ok)throw Error('Operation unavailable');return result;};
    const panels=new Map(),pills=new Map(),opened=new Map();let active='',redraw=()=>{};
    const client={paseo:{agents:{subscribe:fn=>{window.refreshAccess=fn;return()=>{};}}},rpc:window.rpc,addAgentPanel:panel=>{panels.set(panel.id,panel);return()=>panels.delete(panel.id);},openPanel:(id,options)=>{if(!panels.has(id))throw Error('Unregistered panel');const key=id+options.agentId;opened.set(key,{id,...options});active=key;window.panelsOpened.push(id);redraw();},addComposerPill:input=>{const pill={...input,update:button=>{pill.button=button;redraw();},remove:()=>{pills.delete(input.agentId);redraw();}};pills.set(input.agentId,pill);redraw();return pill;}};
    const colors={surface0:'#fff',surface1:'#f8fafc',surface2:'#e2e8f0',border:'#cbd5e1',foreground:'#0f172a',foregroundMuted:'#475569',accent:'#2563eb',accentForeground:'#fff',statusSuccess:'#15803d',statusWarning:'#b45309',statusDanger:'#b91c1c'};
    window.access=contributeConversationAccess(client);
    function App(){const [,update]=useState(0);redraw=()=>update(value=>value+1);return <View style={{height:900}}>{[...pills.values()].filter(pill=>pill.agentId===window.fixture.agentId).map(pill=><Pressable key={pill.agentId} accessibilityRole='button' accessibilityLabel={pill.button.title} onPress={pill.button.behavior.onPress}><Text>{pill.button.label}</Text></Pressable>)}{[...opened.entries()].map(([key,tab])=>{const Component=panels.get(tab.id).Component;return <View key={key} testID={'panel-'+tab.id} style={{display:active===key?'flex':'none',height:800}}><Component theme={{colors}} workspaceId={tab.workspaceId} params={{agentId:tab.agentId}} layout={{compact:false}} tab={{setModified(){},setState(){}}}/></View>;})}</View>;}
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><App/></QueryClientProvider>);
  `;
  const script=fromApp('esbuild').buildSync({stdin:{contents:entry,loader:'tsx',resolveDir:root},bundle:true,write:false,define:{'process.env.NODE_ENV':'"development"'},alias:{react:fromApp.resolve('react'),'react/jsx-runtime':fromApp.resolve('react/jsx-runtime'),'react-dom/client':fromApp.resolve('react-dom/client'),'react-dom':fromApp.resolve('react-dom'),'react-native':fromApp.resolve('react-native-web'),'@getpaseo/plugin':host,'@getpaseo/plugin/client':host,'@getpaseo/plugin/client/react-native':host,'@getpaseo/plugin/client/ui':host},logLevel:'silent'}).outputFiles[0].text;
  server=http.createServer(async(req,res)=>{if(req.url==='/rpc'){let raw='';for await(const chunk of req)raw+=chunk;const response=await bridge('/rpc',JSON.parse(raw));res.writeHead(response.status,{'content-type':'application/json'}).end(await response.text());return;}res.writeHead(200,{'content-type':req.url==='/app.js'?'text/javascript':'text/html'}).end(req.url==='/app.js'?script:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/app.js"></script>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await fromApp('@playwright/test').chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1200,height:1000}}),errors=[],remote=[];page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(!request.url().startsWith('http://127.0.0.1:'))remote.push(request.url());});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const pill=page.getByRole('button',{name:'TAPD 任务看板（2）',exact:true});await pill.click();
  await page.getByRole('button',{name:'打开任务 #11111111：Direct task',exact:true}).click();await page.getByRole('heading',{name:'Full direct detail',exact:true}).waitFor();await page.getByText('Complete body from TAPD',{exact:true}).waitFor();
  for(const action of ['写回评论','创建该需求下的任务','刷新'])await page.getByRole('button',{name:action,exact:true}).waitFor();
  await pill.click();await page.getByRole('button',{name:'展开需求 #11111111 的子单据',exact:true}).click();await page.getByRole('button',{name:'打开子单据 #33333333',exact:true}).click();await page.getByRole('heading',{name:'Full child detail',exact:true}).waitFor();await page.getByText('Child body from TAPD',{exact:true}).waitFor();
  await pill.click();await page.getByRole('button',{name:'打开任务 #22222222：Accepted task',exact:true}).click();await page.getByRole('heading',{name:'Full accepted detail',exact:true}).waitFor();
  const panelsBefore=await page.evaluate(()=>new Set(window.panelsOpened.filter(id=>id.startsWith('tapd-detail'))).size);assert.equal(panelsBefore,3);
  await pill.click();await page.getByRole('button',{name:'打开任务 #11111111：Direct task',exact:true}).click();await page.getByRole('heading',{name:'Full direct detail',exact:true}).waitFor();assert.equal(await page.evaluate(()=>new Set(window.panelsOpened.filter(id=>id.startsWith('tapd-detail'))).size),3,'repeated opening reuses existing detail tabs');
  const recent=await(await bridge('/rpc',{name:'tapd.conversations',input:{}})).json();const entities=recent.conversations.find(item=>item.agentId===fixture.agentId).entities;assert.deepEqual(entities.map(item=>item.id).sort(),['11111111','22222222','33333333']);assert.equal(entities.find(item=>item.id==='33333333').labels[0],'child-label');
  const focus=await page.evaluate(()=>window.calls.filter(call=>call.name==='tapd.conversation.focus').map(call=>call.input.entity.id));assert.deepEqual(focus,['11111111','33333333','22222222','11111111']);assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
  await page.evaluate(()=>window.access.dispose());await bridge('/stop');const code=await new Promise(resolve=>worker.once('exit',resolve));assert.equal(code,0,'Viewing must preserve all ownership without TAPD writes or Agent execution');completed=true;
  console.log(JSON.stringify({ok:true,realFocusAndDetailRpc:true,directAssignmentFirstOpen:true,acceptedDelegationFirstOpen:true,childFirstOpen:true,canonicalRecentSummary:true,detailTabReuse:true,tapdWrites:0,providerPrompts:0,screenshots:0}));
 }finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));if(worker&&!completed){if(bridgePort)await fetch(`http://127.0.0.1:${bridgePort}/stop`,{method:'POST'}).catch(()=>{});worker.kill('SIGTERM');}rmSync(temp,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
