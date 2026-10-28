// Actual settings UI -> real isolated SDK settings RPC. No screenshots or live accounts.
const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {spawn}=require('node:child_process');
const http=require('node:http');
async function main(){
 assert(process.env.PASEO_RUNTIME_DIR,'Set PASEO_RUNTIME_DIR to a compatible built Paseo checkout');
 const runtime=path.resolve(process.env.PASEO_RUNTIME_DIR),fromApp=createRequire(path.join(runtime,'packages/app/package.json'));
 const root=path.resolve(__dirname,'..'),temp=mkdtempSync(path.join(tmpdir(),'tapd-settings-ui-'));
 let worker,server,browser,bridgePort,output='',completed=false;
 try {
  const wrapper=path.join(temp,'daemon.mjs');
  writeFileSync(wrapper,`import {runSettingsDaemon} from ${JSON.stringify(pathToFileURL(path.join(root,'tests/fixtures/settings-daemon.mjs')).href)};import {runPublicDaemonSandbox} from ${JSON.stringify(pathToFileURL(path.join(root,'tests/fixtures/public-daemon-sandbox.mjs')).href)};if(process.argv[2]==='sandbox')await runSettingsDaemon(${JSON.stringify(temp)});else await runPublicDaemonSandbox(${JSON.stringify(wrapper)},${JSON.stringify(root)});`);
  worker=spawn(process.execPath,[wrapper],{env:{...process.env,PASEO_RUNTIME_DIR:runtime},stdio:['ignore','pipe','pipe']});
  worker.stdout.on('data',chunk=>{output=(output+chunk).slice(-4000);});worker.stderr.on('data',chunk=>{output=(output+chunk).slice(-4000);});
  for(let count=0;!existsSync(path.join(temp,'ready.json'));count++){
   assert(count<300&&worker.exitCode===null,`Isolated settings daemon failed: ${output}`);
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  bridgePort=JSON.parse(readFileSync(path.join(temp,'ready.json'))).port;
  const bridge=async(url,body)=>fetch(`http://127.0.0.1:${bridgePort}${url}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body??{})});
  const fixtureHost=path.join(temp,'host.tsx');
  writeFileSync(fixtureHost,`
    import React,{useState,useEffect} from 'react';import {View,Text,TextInput,Pressable} from 'react-native';
    export function defineRpc(value){return value;}export function defineSettings(value){return value;}export function defineAttachmentSource(value){return value;}
    const call=async(name,input={})=>{const response=await fetch('/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,input})});const result=await response.json();if(!response.ok)throw Error('Operation unavailable');return result;};
    export const Icon=()=>null;
    export const useRpc=rpc=>input=>call(rpc.name,input);
    export const useToast=()=>({show:text=>{window.toast=text;},error:text=>{window.toast=text;}});
    export function useSettings(definition){const [state,setState]=useState({status:'loading'}),[saveError,setSaveError]=useState(null);const read='settings.'+definition.id+'.read',write='settings.'+definition.id+'.write';
      const reload=async()=>{const result=await call(read);setState(result);};useEffect(()=>{reload();},[]);
      const save=async(values,revision)=>{const result=await call(write,{values,revision});if(result.status!=='saved'){setSaveError(result.error);window.saveOutcome=result.status;return false;}setState({status:'ready',values:result.values,revision:result.revision});window.saveOutcome='saved';return true;};
      window.reloadSettings=reload;window.currentSettings=state;window.readSettings=()=>call(read);window.externalSave=async()=>{const current=await call(read);return call(write,{revision:current.revision,values:{...current.values,lastProvider:'example-external'}});};return {...state,save,saveError,reload,reset:async()=>{}};}
    const Section=({title,children})=><View><Text>{title}</Text>{children}</View>;
    export const SettingsSection=Section,SettingsCard=({children})=><View>{children}</View>,SettingsRow=({label,children})=><View><Text>{label}</Text>{children}</View>;
    export const SettingsInput=({label,initialValue,onChangeText,secureTextEntry})=><View><Text>{label}</Text><TextInput accessibilityLabel={label} defaultValue={initialValue} onChangeText={onChangeText} secureTextEntry={secureTextEntry}/></View>;
    export const SettingsAction=({label,actionLabel,onPress,disabled})=><Pressable accessibilityRole='button' accessibilityLabel={label} onPress={onPress} disabled={disabled}><Text>{actionLabel}</Text></Pressable>;
  `);
  const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {TapdSettingsScreen} from ${JSON.stringify(path.join(root,'client/workbench/SettingsForm.tsx'))};const colors={surface0:'#fff',surface1:'#f8fafc',surface2:'#e2e8f0',border:'#cbd5e1',foreground:'#0f172a',foregroundMuted:'#475569',accent:'#2563eb',accentForeground:'#fff',statusSuccess:'#15803d',statusWarning:'#b45309',statusDanger:'#b91c1c'};createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><TapdSettingsScreen theme={{colors}}/></QueryClientProvider>);`;
  const script=fromApp('esbuild').buildSync({stdin:{contents:entry,loader:'tsx',resolveDir:root},bundle:true,write:false,define:{'process.env.NODE_ENV':'"development"'},alias:{react:fromApp.resolve('react'),'react/jsx-runtime':fromApp.resolve('react/jsx-runtime'),'react-dom/client':fromApp.resolve('react-dom/client'),'react-dom':fromApp.resolve('react-dom'),'react-native':fromApp.resolve('react-native-web'),'@getpaseo/plugin':fixtureHost,'@getpaseo/plugin/client':fixtureHost,'@getpaseo/plugin/client/react-native':fixtureHost,'@getpaseo/plugin/client/ui':fixtureHost},logLevel:'silent'}).outputFiles[0].text;
  server=http.createServer(async(req,res)=>{
   if(req.url==='/rpc'){let raw='';for await(const part of req)raw+=part;const response=await bridge('/rpc',JSON.parse(raw));res.writeHead(response.status,{'content-type':'application/json'}).end(await response.text());return;}
   res.writeHead(200,{'content-type':req.url==='/app.js'?'text/javascript':'text/html'}).end(req.url==='/app.js'?script:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/app.js"></script>');
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await fromApp('@playwright/test').chromium.launch({headless:true,args:['--no-sandbox']});
  const page=await browser.newPage(),errors=[],remote=[];page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(!request.url().startsWith('http://127.0.0.1:'))remote.push(request.url());});
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByRole('button',{name:'保存设置',exact:true}).waitFor();
  for(const label of ['Git 仓库地址','Git 访问令牌','分支'])assert.equal(await page.getByLabel(label,{exact:true}).count(),0);
  assert.equal(await page.getByText('配置同步（Git）',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:/推送|拉取|恢复/}).count(),0);
  await page.getByLabel('网页域名',{exact:true}).fill('https://new.example.com');await page.getByRole('button',{name:'保存设置',exact:true}).click();await page.waitForFunction(()=>window.saveOutcome==='saved');
  let saved=await page.evaluate(()=>window.readSettings());assert.equal(saved.values.siteUrl,'https://new.example.com');assert.deepEqual(saved.values.favorites,['story-11111111']);assert.equal(saved.values.links[0].agentId,'example-agent');assert.equal(saved.values.createFieldLayout.task.order[0],'name');assert.equal(saved.values.lastRepoPath,'/example/repository');
  const beforeConflict=saved.revision;assert.equal((await page.evaluate(()=>window.externalSave())).status,'saved');
  await page.evaluate(()=>{window.saveOutcome=null;});await page.getByLabel('网页域名',{exact:true}).fill('https://stale.example.com');await page.getByRole('button',{name:'保存设置',exact:true}).click();await page.waitForFunction(()=>window.saveOutcome==='conflict');
  saved=await page.evaluate(()=>window.readSettings());assert.notEqual(saved.revision,beforeConflict);assert.equal(saved.values.siteUrl,'https://new.example.com');assert.equal(saved.values.lastProvider,'example-external');
  await page.evaluate(()=>window.reloadSettings());await page.getByLabel('网页域名',{exact:true}).fill('https://final.example.com');await page.getByRole('button',{name:'保存设置',exact:true}).click();await page.waitForFunction(()=>window.saveOutcome==='saved');
  for(const name of ['tapd.sync_push','tapd.sync_pull'])assert.equal((await bridge('/rpc',{name,input:{}})).ok,false);
  await new Promise(resolve=>setTimeout(resolve,11_000));await bridge('/reload');
  saved=await page.evaluate(()=>window.readSettings());assert.equal(saved.values.siteUrl,'https://final.example.com');assert.equal(saved.values.lastProvider,'example-external');for(const key of ['syncGitUrl','syncGitToken','syncBranch'])assert.equal(key in saved.values,false);
  assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
  await bridge('/stop');const code=await new Promise(resolve=>worker.once('exit',resolve));assert.equal(code,0,'No Git subprocess after upgrade/save/reload/debounce');completed=true;
  console.log(JSON.stringify({ok:true,realSettingsRpc:true,legacyMigration:true,removedSyncUiAndRpc:true,revisionConflict:true,localDataPreserved:true,noConfigGitSubprocess:true,noBackupNetwork:true,screenshots:0}));
 }finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));if(worker&&!completed){if(bridgePort)await fetch(`http://127.0.0.1:${bridgePort}/stop`,{method:'POST'}).catch(()=>{});worker.kill('SIGTERM');}rmSync(temp,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
