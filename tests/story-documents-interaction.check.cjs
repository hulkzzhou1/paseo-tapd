// Actual detail action pages -> actual plugin RPC in an isolated daemon. No screenshots.
const assert=require('node:assert/strict'),{createRequire}=require('node:module');
const {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os'),path=require('node:path'),{pathToFileURL}=require('node:url'),{spawn}=require('node:child_process'),http=require('node:http');
async function main(){
 assert(process.env.PASEO_RUNTIME_DIR);const runtime=path.resolve(process.env.PASEO_RUNTIME_DIR),fromApp=createRequire(path.join(runtime,'packages/app/package.json')),root=path.resolve(__dirname,'..'),temp=mkdtempSync(path.join(tmpdir(),'tapd-short-fields-ui-'));
 let worker,server,browser,bridgePort,output='',completed=false;
 try{
  const wrapper=path.join(temp,'daemon.mjs');writeFileSync(wrapper,`import {runStoryFieldsDaemon} from ${JSON.stringify(pathToFileURL(path.join(root,'tests/fixtures/story-fields-daemon.mjs')).href)};import {runPublicDaemonSandbox} from ${JSON.stringify(pathToFileURL(path.join(root,'tests/fixtures/public-daemon-sandbox.mjs')).href)};if(process.argv[2]==='sandbox')await runStoryFieldsDaemon(${JSON.stringify(temp)},{documents:true});else await runPublicDaemonSandbox(${JSON.stringify(wrapper)},${JSON.stringify(root)});`);
  worker=spawn(process.execPath,[wrapper],{env:{...process.env,PASEO_RUNTIME_DIR:runtime},stdio:['ignore','pipe','pipe']});for(const pipe of [worker.stdout,worker.stderr])pipe.on('data',chunk=>{output=(output+chunk).slice(-4000);});
  for(let count=0;!existsSync(path.join(temp,'ready.json'));count++){assert(count<300&&worker.exitCode===null,`Isolated short field daemon failed: ${output}`);await new Promise(resolve=>setTimeout(resolve,100));}
  bridgePort=JSON.parse(readFileSync(path.join(temp,'ready.json'))).port;
  const bridge=(url,body={})=>fetch(`http://127.0.0.1:${bridgePort}${url}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const settings=await(await bridge('/rpc',{name:'settings.tapd-workbench-config.read',input:{}})).json();
  const host=path.join(temp,'host.tsx');writeFileSync(host,`
   import React,{useCallback} from 'react';export {TextInput,ScrollView,FlatList} from 'react-native';
   export const defineRpc=x=>x,defineSettings=x=>x,defineAttachmentSource=x=>x,Icon=()=>null;
   export const SettingsAction=()=>null,SettingsCard=()=>null,SettingsInput=()=>null,SettingsRow=()=>null,SettingsSection=()=>null;
   export const useToast=()=>({error:()=>{},show:()=>{}}),copyText=async()=>{},openExternalUrl=async url=>{window.opened.push(url);};
   export const useSettings=()=>window.settings;
   export const usePaseo=()=>({agents:{list:async()=>({entries:[]})}});
   export const useRpc=contract=>useCallback(input=>window.rpc(contract,input),[contract]);
  `);
  const entry=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {View} from 'react-native';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {EntityDetailExperience} from ${JSON.stringify(path.join(root,'client/workbench/EntityDetailExperience.tsx'))};
   window.settings=${JSON.stringify(settings)};window.calls=[];window.opened=[];
   window.rpc=async(contract,input)=>{window.calls.push({name:contract.name,input});const r=await fetch('/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:contract.name,input})});const result=await r.json();if(!r.ok)throw Error('Safe fixture failure');return result;};
   const colors={surface0:'#111827',surface1:'#1f2937',surface2:'#374151',border:'#475569',foreground:'#f9fafb',foregroundMuted:'#9ca3af',accent:'#60a5fa',accentForeground:'#111827',statusSuccess:'#4ade80',statusWarning:'#fbbf24',statusDanger:'#f87171'};
   function App(){const [target,setTarget]=useState({kind:'story',id:'11111111',title:'Example',workspaceId:'12345678'}),[dark,setDark]=useState(false),[panel,setPanel]=useState(false);window.setExample=id=>setTarget(id?{kind:'story',id,title:'Example',workspaceId:'12345678'}:null);window.setDark=setDark;window.setPanel=setPanel;const palette=dark?colors:{...colors,surface0:'#ffffff',surface1:'#f8fafc',foreground:'#0f172a',foregroundMuted:'#475569'};return <View style={{height:'100vh'}}><EntityDetailExperience target={target} onTargetChange={setTarget} theme={{colors:palette}} presentation={panel?'panel':'dialog'} /></View>;}
   createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><App/></QueryClientProvider>);
  `;
  const script=fromApp('esbuild').buildSync({stdin:{contents:entry,loader:'tsx',resolveDir:root},bundle:true,write:false,define:{'process.env.NODE_ENV':'"development"'},alias:{react:fromApp.resolve('react'),'react/jsx-runtime':fromApp.resolve('react/jsx-runtime'),'react-dom/client':fromApp.resolve('react-dom/client'),'react-dom':fromApp.resolve('react-dom'),'react-native':fromApp.resolve('react-native-web'),'@getpaseo/plugin':host,'@getpaseo/plugin/client':host,'@getpaseo/plugin/client/react-native':host},logLevel:'silent'}).outputFiles[0].text;
  server=http.createServer(async(req,res)=>{try{if(req.url==='/rpc'){let body='';for await(const chunk of req)body+=chunk;const r=await bridge('/rpc',JSON.parse(body));res.writeHead(r.status,{'content-type':'application/json'}).end(await r.text());return;}res.writeHead(200,{'content-type':req.url==='/app.js'?'text/javascript':'text/html'}).end(req.url==='/app.js'?script:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/app.js"></script>');}catch{res.writeHead(503).end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await fromApp('@playwright/test').chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1200,height:950}}),errors=[];page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(error.message));
  const url=`http://127.0.0.1:${server.address().port}`;
  await page.goto(url);
  await page.getByText('Readonly short value',{exact:true}).waitFor();
  const labels=['详细信息','Example document','Example empty report','Example unknown report','Example missing report','Example malformed report','Example second document'];
  assert.deepEqual(await page.getByRole('tab').allTextContents(),labels);
  const initial=await(await bridge('/state')).json();assert(initial.reads.filter(read=>read.path==='/stories').every(read=>!read.query.fields?.split(',').some(key=>key.endsWith('_document')||key.endsWith('_report'))));
  const reader=page.getByTestId('detail-reading-scroll'),header=page.getByTestId('detail-fixed-header');
  const scrollTo=async y=>{await reader.evaluate((element,value)=>element.scrollTop=value,y);await page.waitForFunction(value=>Math.abs(document.querySelector('[data-testid="detail-reading-scroll"]').scrollTop-value)<3,y).catch(async()=>{throw Error(JSON.stringify(await reader.evaluate(element=>({top:element.scrollTop,height:element.clientHeight,full:element.scrollHeight}))))});await page.waitForTimeout(100);};
  await page.getByRole('button',{name:'更多属性（1）',exact:true}).click();
  await page.getByRole('button',{name:'显示空字段（1）',exact:true}).click();
  await page.getByText('Seventh value',{exact:true}).waitFor();
  const detailOffset=await reader.evaluate(element=>element.scrollHeight-element.clientHeight-20);
  await scrollTo(detailOffset);
  const detailsTab=page.getByRole('tab',{name:'详细信息',exact:true});await detailsTab.focus();await page.keyboard.press('ArrowRight');
  await page.getByRole('heading',{name:'Example design',exact:true}).waitFor();
  assert.equal(await page.getByText('Base detail remains readable',{exact:true}).isVisible(),false);
  assert.equal(await page.getByText('评论（0）',{exact:true}).isVisible(),false);
  for(const value of ['Readable list','const example = 1;','Column 5','Value 5'])await page.getByText(value,{exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Unsafe link text',exact:true}).count(),0);assert.equal(await page.evaluate(()=>window.unsafeExecuted),undefined);
  await page.getByText('图片加载失败',{exact:true}).waitFor();
  const imageBefore=(await(await bridge('/state')).json()).reads.filter(read=>read.path==='/files/get_image').length;
  await page.getByRole('button',{name:'重试加载图片：Example diagram',exact:true}).click();
  await page.waitForTimeout(200);assert((await(await bridge('/state')).json()).reads.filter(read=>read.path==='/files/get_image').length>imageBefore);
  await page.getByRole('link',{name:'查看原图：Example diagram',exact:true}).focus();await page.keyboard.press('Enter');assert.deepEqual(await page.evaluate(()=>window.opened),['https://example.com/tfl/captures/example.png']);
  const headerTop=(await header.boundingBox()).y;await scrollTo(600);assert.equal((await header.boundingBox()).y,headerTop);
  await detailsTab.click();await page.getByText('Base detail remains readable',{exact:true}).waitFor();
  await page.getByText('Seventh value',{exact:true}).waitFor();
  await page.getByText('Example empty',{exact:true}).waitFor();
  await page.getByRole('button',{name:'收起属性',exact:true}).waitFor();
  await page.waitForFunction(offset=>Math.abs(document.querySelector('[data-testid="detail-reading-scroll"]').scrollTop-offset)<3,detailOffset);
  await page.getByRole('tab',{name:'Example document',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-testid="detail-reading-scroll"]').scrollTop>590);
  await page.getByRole('tab',{name:'Example second document',exact:true}).click();await page.getByRole('heading',{name:'Example report',exact:true}).waitFor();await scrollTo(350);
  await page.getByRole('tab',{name:'Example document',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-testid="detail-reading-scroll"]').scrollTop>590);
  // Comment action keeps the selected page and protects an unsent draft, without a TAPD POST.
  await page.getByRole('button',{name:'写回评论',exact:true}).click();
  const comment=page.getByRole('dialog',{name:'写回评论 · #11111111',exact:true});await comment.waitFor();
  await comment.getByPlaceholder('输入要写回 TAPD 的内容（纯文本，自动转 HTML）').fill('Unsent example comment');
  await page.keyboard.press('Escape');await comment.getByRole('button',{name:'继续编辑',exact:true}).click();
  assert.equal(await comment.getByRole('textbox').inputValue(),'Unsent example comment');
  await comment.getByRole('button',{name:'返回详情',exact:true}).click();await comment.getByRole('button',{name:'放弃修改',exact:true}).click();
  await page.getByRole('heading',{name:'Example design',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('[data-testid="detail-reading-scroll"]').scrollTop>590);
  for(const [name,message]of [['Example empty report','尚未填写'],['Example unknown report','字段值未知（null）'],['Example missing report','此字段未返回，无法确认内容。'],['Example malformed report','字段值格式无法识别。']]){
   await page.getByRole('tab',{name,exact:true}).click();await page.getByText(message,{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'写回评论',exact:true}).count(),1);
  }
  await page.getByRole('tab',{name:'Example document',exact:true}).click();await bridge('/scenario',{failDocument:true});await page.getByRole('button',{name:'刷新当前文档',exact:true}).click();await page.getByText('文档读取失败，请重试；其他页仍可阅读。',{exact:true}).waitFor();
  await detailsTab.click();await page.getByText('Base detail remains readable',{exact:true}).waitFor();
  await page.getByRole('tab',{name:'Example document',exact:true}).click();await bridge('/scenario',{documentValue:'<h2>Updated document</h2><p>Refreshed content</p>'});await page.getByRole('button',{name:'重试读取文档',exact:true}).click();await page.getByRole('heading',{name:'Updated document',exact:true}).waitFor();
  // A forced refresh while a prior HTTP read is held must win even when the older body arrives last.
  await bridge('/scenario',{documentValue:'<h2>Stale late document</h2>',holdNext:true});await page.getByRole('button',{name:'刷新当前文档',exact:true}).click();await page.getByText('正在读取文档…',{exact:true}).waitFor();
  for(let count=0;(await(await bridge('/state')).json()).held===0;count++){assert(count<80);await page.waitForTimeout(50);}
  await bridge('/scenario',{documentValue:'<h2>Newest document</h2>'});await page.getByRole('button',{name:'刷新当前文档',exact:true}).click();await page.getByRole('heading',{name:'Newest document',exact:true}).waitFor();await bridge('/release');await page.waitForTimeout(200);assert.equal(await page.getByText('Stale late document',{exact:true}).count(),0);
  await bridge('/scenario',{documentValue:'<h2>Old target document</h2>',holdNext:true});await page.getByRole('button',{name:'刷新当前文档',exact:true}).click();
  for(let count=0;(await(await bridge('/state')).json()).held===0;count++){assert(count<80);await page.waitForTimeout(50);}
  await page.evaluate(()=>window.setExample('22222222'));await page.getByText('Other value',{exact:true}).waitFor();await bridge('/release');assert.deepEqual(await page.getByRole('tab').allTextContents(),['详细信息']);assert.equal(await page.getByText('Old target document',{exact:true}).count(),0);
  await page.evaluate(()=>window.setExample('11111111'));await page.getByText('Readonly short value',{exact:true}).waitFor();assert.equal(await detailsTab.getAttribute('aria-selected'),'true');
  await page.getByRole('tab',{name:'Example document',exact:true}).click();await page.getByRole('heading',{name:'Old target document',exact:true}).waitFor();
  await page.getByRole('button',{name:'关闭#11111111 · 单据详情',exact:true}).last().click();
  await bridge('/scenario',{documentValue:'<h2>After reopen document</h2>'});await page.evaluate(()=>window.setExample('11111111'));await page.getByText('Readonly short value',{exact:true}).waitFor();assert.equal(await detailsTab.getAttribute('aria-selected'),'true');
  await page.getByRole('tab',{name:'Example document',exact:true}).click();await page.getByRole('heading',{name:'After reopen document',exact:true}).waitFor();assert.equal(await page.getByText('Old target document',{exact:true}).count(),0);
  await bridge('/scenario',{documentValue:'<h2>Toolbar refreshed document</h2>'});await page.getByRole('button',{name:'刷新',exact:true}).click();await page.getByRole('heading',{name:'Toolbar refreshed document',exact:true}).waitFor();
  // Both entry points, both themes and widths; tab focus and table overflow stay local.
  await bridge('/scenario',{resetDocument:true});
  if(process.env.TAPD_STORY_DOCUMENT_LAYOUT!=='0')for(const panel of [false,true])for(const dark of [false,true])for(const width of [360,1200]){
   await page.setViewportSize({width,height:800});await page.evaluate(({panel,dark})=>{window.setPanel(panel);window.setDark(dark);window.setExample(null);},{panel,dark});await page.waitForTimeout(50);await page.evaluate(()=>window.setExample('11111111'));await page.getByText('Readonly short value',{exact:true}).waitFor();
   await page.getByRole('tab',{name:'详细信息',exact:true}).focus();await page.keyboard.press('End');assert.equal(await page.getByRole('tab',{name:'Example second document',exact:true}).getAttribute('aria-selected'),'true');await page.getByRole('heading',{name:'Example report',exact:true}).waitFor();
   await page.keyboard.press('Home');assert.equal(await page.getByRole('tab',{name:'详细信息',exact:true}).getAttribute('aria-selected'),'true');
   await page.getByRole('tab',{name:'Example document',exact:true}).click();await page.getByRole('heading',{name:'Example design',exact:true}).waitFor();
   const bounds=await header.boundingBox(),body=await reader.boundingBox();assert(bounds&&body&&body.height>150&&bounds.x>=0&&bounds.x+bounds.width<=width+1);
   const top=bounds.y;await scrollTo(400);assert.equal((await header.boundingBox()).y,top);
   const table=await reader.evaluate(element=>Array.from(element.querySelectorAll('div')).some(child=>child.scrollWidth>child.clientWidth+10&&['auto','scroll'].includes(getComputedStyle(child).overflowX)));assert(table,'wide tables scroll within reading content');
   assert.equal(await page.getByRole('textbox').count(),0);
  }
  assert.equal((await(await bridge('/state')).json()).writes,0);assert.deepEqual(errors,[]);
  await bridge('/stop');assert.equal(await new Promise(resolve=>worker.once('exit',resolve)),0);completed=true;
  console.log(JSON.stringify({ok:true,realStoryDocumentRpc:true,lazyTabs:true,refreshRace:true,resetAndReopen:true,perTabScroll:true,fixedHeader:true,draftProtection:true,states:true,safeRichText:true,themeAndWidths:process.env.TAPD_STORY_DOCUMENT_LAYOUT!=='0',screenshots:0}));
 }finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));if(worker&&!completed){if(bridgePort)await fetch(`http://127.0.0.1:${bridgePort}/stop`,{method:'POST'}).catch(()=>{});worker.kill('SIGTERM');}rmSync(temp,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
