// Actual detail action pages -> actual plugin RPC in an isolated daemon. No screenshots.
const assert=require('node:assert/strict'),{createRequire}=require('node:module');
const {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os'),path=require('node:path'),{pathToFileURL}=require('node:url'),{spawn}=require('node:child_process'),http=require('node:http');
async function main(){
 assert(process.env.PASEO_RUNTIME_DIR);const runtime=path.resolve(process.env.PASEO_RUNTIME_DIR),fromApp=createRequire(path.join(runtime,'packages/app/package.json')),root=path.resolve(__dirname,'..'),temp=mkdtempSync(path.join(tmpdir(),'tapd-short-fields-ui-'));
 let worker,server,browser,bridgePort,output='',completed=false;
 try{
  const wrapper=path.join(temp,'daemon.mjs');writeFileSync(wrapper,`import {runStoryFieldsDaemon} from ${JSON.stringify(pathToFileURL(path.join(root,'tests/fixtures/story-fields-daemon.mjs')).href)};import {runPublicDaemonSandbox} from ${JSON.stringify(pathToFileURL(path.join(root,'tests/fixtures/public-daemon-sandbox.mjs')).href)};if(process.argv[2]==='sandbox')await runStoryFieldsDaemon(${JSON.stringify(temp)});else await runPublicDaemonSandbox(${JSON.stringify(wrapper)},${JSON.stringify(root)});`);
  worker=spawn(process.execPath,[wrapper],{env:{...process.env,PASEO_RUNTIME_DIR:runtime},stdio:['ignore','pipe','pipe']});for(const pipe of [worker.stdout,worker.stderr])pipe.on('data',chunk=>{output=(output+chunk).slice(-4000);});
  for(let count=0;!existsSync(path.join(temp,'ready.json'));count++){assert(count<300&&worker.exitCode===null,`Isolated short field daemon failed: ${output}`);await new Promise(resolve=>setTimeout(resolve,100));}
  bridgePort=JSON.parse(readFileSync(path.join(temp,'ready.json'))).port;
  const bridge=(url,body={})=>fetch(`http://127.0.0.1:${bridgePort}${url}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const settings=await(await bridge('/rpc',{name:'settings.tapd-workbench-config.read',input:{}})).json();
  const host=path.join(temp,'host.tsx');writeFileSync(host,`
   import React,{useCallback} from 'react';export {TextInput,ScrollView,FlatList} from 'react-native';
   export const defineRpc=x=>x,defineSettings=x=>x,defineAttachmentSource=x=>x,Icon=()=>null;
   export const SettingsAction=()=>null,SettingsCard=()=>null,SettingsInput=()=>null,SettingsRow=()=>null,SettingsSection=()=>null;
   export const useToast=()=>({error:()=>{},show:()=>{}}),copyText=async()=>{},openExternalUrl=async()=>{};
   export const useSettings=()=>window.settings;
   export const usePaseo=()=>({agents:{list:async()=>({entries:[]})}});
   export const useRpc=contract=>useCallback(input=>window.rpc(contract,input),[contract]);
  `);
  const entry=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {View} from 'react-native';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {EntityDetailExperience} from ${JSON.stringify(path.join(root,'client/workbench/EntityDetailExperience.tsx'))};
   window.settings=${JSON.stringify(settings)};window.calls=[];
   window.rpc=async(contract,input)=>{window.calls.push({name:contract.name,input});const r=await fetch('/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:contract.name,input})});const result=await r.json();if(!r.ok)throw Error('Safe fixture failure');return result;};
   const colors={surface0:'#111827',surface1:'#1f2937',surface2:'#374151',border:'#475569',foreground:'#f9fafb',foregroundMuted:'#9ca3af',accent:'#60a5fa',accentForeground:'#111827',statusSuccess:'#4ade80',statusWarning:'#fbbf24',statusDanger:'#f87171'};
   function App(){const [target,setTarget]=useState({kind:'story',id:'11111111',title:'Example',workspaceId:'12345678'}),[dark,setDark]=useState(false);window.setExample=id=>setTarget({kind:'story',id,title:'Example',workspaceId:'12345678'});window.setDark=setDark;const palette=dark?colors:{...colors,surface0:'#ffffff',surface1:'#f8fafc',foreground:'#0f172a',foregroundMuted:'#475569'};return <View style={{height:'100vh'}}><EntityDetailExperience target={target} onTargetChange={setTarget} theme={{colors:palette}} /></View>;}
   createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><App/></QueryClientProvider>);
  `;
  const script=fromApp('esbuild').buildSync({stdin:{contents:entry,loader:'tsx',resolveDir:root},bundle:true,write:false,define:{'process.env.NODE_ENV':'"development"'},alias:{react:fromApp.resolve('react'),'react/jsx-runtime':fromApp.resolve('react/jsx-runtime'),'react-dom/client':fromApp.resolve('react-dom/client'),'react-dom':fromApp.resolve('react-dom'),'react-native':fromApp.resolve('react-native-web'),'@getpaseo/plugin':host,'@getpaseo/plugin/client':host,'@getpaseo/plugin/client/react-native':host},logLevel:'silent'}).outputFiles[0].text;
  server=http.createServer(async(req,res)=>{try{if(req.url==='/rpc'){let body='';for await(const chunk of req)body+=chunk;const r=await bridge('/rpc',JSON.parse(body));res.writeHead(r.status,{'content-type':'application/json'}).end(await r.text());return;}res.writeHead(200,{'content-type':req.url==='/app.js'?'text/javascript':'text/html'}).end(req.url==='/app.js'?script:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/app.js"></script>');}catch{res.writeHead(503).end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await fromApp('@playwright/test').chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1200,height:950}}),errors=[];page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(error.message));
  const url=`http://127.0.0.1:${server.address().port}`;
  await page.goto(url);
  await page.getByText('Readonly short value',{exact:true}).waitFor();
  for(const value of ['0','false','Alpha、Beta','example-member、example-other','2026-01-02'])await page.getByText(value,{exact:true}).waitFor();
  assert.equal(await page.getByText('Seventh value',{exact:true}).count(),0);
  const more=page.getByRole('button',{name:'更多属性（1）',exact:true});await more.focus();await page.keyboard.press('Enter');
  await page.getByText('Seventh value',{exact:true}).waitFor();
  for(const value of ['未知（null）','未返回','无法识别'])await page.getByText(value,{exact:true}).waitFor();
  assert.equal(await page.getByText('Example empty',{exact:true}).count(),0);
  await page.getByRole('button',{name:'显示空字段（1）',exact:true}).click();await page.getByText('未填写',{exact:true}).waitFor();
  assert.equal(await page.getByRole('textbox').count(),0,'new attributes remain readonly');
  const initial=await(await bridge('/state')).json();
  const storyReads=initial.reads.filter(read=>read.path==='/stories'&&read.query.id==='11111111');
  assert(storyReads.length>0);assert(storyReads.every(read=>read.query.fields&&!read.query.fields.split(',').includes('custom_field_document')),'unopened rich content must never be requested');
  assert.equal(initial.writes,0);
  await page.evaluate(()=>window.setExample('22222222'));await page.getByText('Other value',{exact:true}).waitFor();assert.equal(await page.getByText('Readonly short value',{exact:true}).count(),0);
  await Promise.all([page.waitForResponse(response=>response.url().endsWith('/rpc')&&response.request().postDataJSON()?.name==='tapd.story-fields'&&response.request().postDataJSON()?.input?.id==='11111111'),page.evaluate(()=>window.setExample('11111111'))]);await page.getByText('Readonly short value',{exact:true}).waitFor();assert.equal(await page.getByText('Seventh value',{exact:true}).count(),0);
  await bridge('/scenario',{failFields:true});await page.getByRole('button',{name:'刷新自定义字段',exact:true}).click();await page.getByText('读取自定义字段失败，请重试。',{exact:true}).waitFor();await page.getByText('Base detail remains readable',{exact:true}).waitFor();
  await bridge('/scenario',{failFields:false});await page.getByRole('button',{name:'重试自定义字段',exact:true}).click();await page.getByText('Readonly short value',{exact:true}).waitFor();
  await page.setViewportSize({width:360,height:800});await page.evaluate(()=>{window.setDark(true);});await page.getByText('Readonly short value',{exact:true}).waitFor();
  const bounds=await page.getByTestId('story-short-fields').boundingBox();assert(bounds&&bounds.width<=360&&bounds.x>=0&&bounds.x+bounds.width<=361);
  assert.deepEqual(errors,[]);
  await bridge('/stop');assert.equal(await new Promise(resolve=>worker.once('exit',resolve)),0);completed=true;
  console.log(JSON.stringify({ok:true,realStoryFieldsRpc:true,firstSix:true,moreAndEmpty:true,unknownStates:true,categoryIsolation:true,noRichPrefetch:true,readonly:true,compactDark:true,screenshots:0}));
 }finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));if(worker&&!completed){if(bridgePort)await fetch(`http://127.0.0.1:${bridgePort}/stop`,{method:'POST'}).catch(()=>{});worker.kill('SIGTERM');}rmSync(temp,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
