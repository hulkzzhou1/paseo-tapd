// Actual batch card, stored pagination and shared detail; only fake public RPC/SDK inputs.
const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const {mkdtempSync,writeFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');const http=require('node:http');
async function main(){
 assert.ok(process.env.PASEO_APP_DIR);const fromApp=createRequire(path.join(process.env.PASEO_APP_DIR,'package.json'));const root=path.resolve(__dirname,'..');const temp=mkdtempSync(path.join(tmpdir(),'tapd-conversation-ui-'));
 try{
 const host=path.join(temp,'host.tsx');writeFileSync(host,`
 import React from 'react';import {View,Text} from 'react-native';export {TextInput,ScrollView,FlatList} from 'react-native';
 export const defineRpc=x=>x,defineSettings=x=>x,defineAttachmentSource=x=>x;
 export const Icon=()=>null;export const useToast=()=>({error:()=>{},show:()=>{}});export const copyText=async()=>{},openExternalUrl=async()=>{};
 export const useSettings=()=>({status:'ready',values:window.settings,revision:1,save:async()=>true});
 export const usePaseo=()=>({agents:{subscribe:()=>()=>{},list:async()=>({entries:[]})},projects:{list:async()=>({projects:[]})},providers:{snapshot:async()=>({entries:[]})}});
 export const useRpc=rpc=>async input=>{window.calls.push({name:rpc.name,input});
 if(rpc.name==='tapd.conversation.batch_page'){if(window.pageFailure){window.pageFailure=false;throw new Error('private failure');}return {items:window.rows.slice(input.offset,input.offset+5),nextOffset:input.offset+5<window.rows.length?input.offset+5:null};}
 if(rpc.name==='tapd.conversations')return {conversations:window.refs.length?[{agentId:'example-agent',workspaceId:'example-workspace',entities:window.refs}]:[]};
 if(rpc.name==='tapd.conversation.focus'){window.refs=window.refs.filter(x=>x.id!==input.entity.id);window.refs.unshift(input.entity);return {ok:true};}
 if(rpc.name==='tapd.conversation.remove'){window.refs=window.refs.filter(x=>x.id!==input.entity.id);return {ok:true};}
 if(rpc.name==='tapd.entity')return {...input,title:'示例需求',url:'https://example.com/item',status:'open',statusLabel:'待处理',owner:'',creator:'',description:'完整正文',descriptionHtml:'<p>完整正文</p>',comments:[],childTasks:[],childBugs:[],childTasksTotal:0,childBugsTotal:0,parentStory:null};
 if(rpc.name==='tapd.status_options')return {options:[]};if(rpc.name==='tapd.agent_status')return {items:[]};throw new Error('Unexpected RPC');};
 `);
 const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {BatchResultCard} from ${JSON.stringify(path.join(root,'client/conversation/BatchResultCard.tsx'))};import {tapdSettingsSchema} from ${JSON.stringify(path.join(root,'shared/contracts.ts'))};
 window.calls=[];window.refs=[];window.pageFailure=true;window.rows=Array.from({length:8},(_,i)=>({workspaceId:'12345678',kind:'story',id:String(11111111+i),title:'示例需求 '+i,status:'open',statusLabel:'待处理',owner:''}));window.settings=tapdSettingsSchema.parse({workspaceIds:'12345678'});
 const theme={colors:{surface0:'#fff',surface1:'#f8fafc',surface2:'#e2e8f0',border:'#cbd5e1',foreground:'#0f172a',foregroundMuted:'#475569',accent:'#2563eb',accentForeground:'#fff',statusSuccess:'#15803d',statusWarning:'#b45309',statusDanger:'#b91c1c'}};
 const hostRoot=createRoot(document.getElementById('root'));const query=new QueryClient({defaultOptions:{queries:{retry:false}}});window.draw=(override={},night=false)=>hostRoot.render(<QueryClientProvider client={query}><BatchResultCard key={override.batchId||'example-batch'} theme={night?{colors:{...theme.colors,surface0:'#111827',surface1:'#1f2937',foreground:'#f9fafb'}}:theme} host={{id:'example-host',label:'Example'}} layout={{compact:false}} agentId='example-agent' timestamp={new Date()} item={{type:'plugin',kind:'tapd-batch-result',version:1,data:{batchId:'example-batch',operation:'board',siteUrl:'https://example.com',apiEndpoint:'https://api.example.com',items:window.rows.slice(0,5),returned:8,total:50,partial:true,truncated:true,stale:true,cachedAt:'2026-01-01',fetchedAt:'2026-01-01',warnings:['部分数据读取失败，请重新查询。'],...override}}}/></QueryClientProvider>);window.draw();`;
 const code=fromApp('esbuild').buildSync({stdin:{contents:entry,loader:'tsx',resolveDir:root},bundle:true,write:false,define:{'process.env.NODE_ENV':'"development"'},alias:{react:fromApp.resolve('react'),'react/jsx-runtime':fromApp.resolve('react/jsx-runtime'),'react-dom/client':fromApp.resolve('react-dom/client'),'react-dom':fromApp.resolve('react-dom'),'react-native':fromApp.resolve('react-native-web'),'@getpaseo/plugin':host,'@getpaseo/plugin/client':host,'@getpaseo/plugin/client/react-native':host,'@getpaseo/plugin/client/ui':host},logLevel:'silent'}).outputFiles[0].text;
 const server=http.createServer((req,res)=>{res.setHeader('content-type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?code:'<!doctype html><div id="root"></div><script src="/app.js"></script>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{browser=await fromApp('@playwright/test').chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1200,height:850}});page.setDefaultTimeout(8000);await page.goto('http://127.0.0.1:'+server.address().port);
 assert.equal(await page.getByRole('button',{name:/打开 TAPD/}).count(),5);assert.equal(await page.evaluate(()=>window.calls.length),0,'render must not read or collect');
 await page.getByText('已返回 8 条 · 查询总数 50').waitFor();await page.getByText('结果已截断，未包含全部匹配单据。').waitFor();await page.getByText('缓存结果 · 2026-01-01').waitFor();
 await page.getByRole('button',{name:'展开更多已返回单据（5/8）',exact:true}).click();await page.getByText('其余结果暂时无法加载，请重试。').waitFor();assert.equal(await page.getByRole('button',{name:/打开 TAPD/}).count(),5);
 await page.getByRole('button',{name:'重试加载其余单据',exact:true}).click();await page.getByRole('button',{name:'打开 TAPD 需求 #11111118：示例需求 7',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:/打开 TAPD/}).count(),8);
 await page.setViewportSize({width:360,height:740});await page.getByRole('button',{name:'打开 TAPD 需求 #11111118：示例需求 7',exact:true}).focus();await page.keyboard.press('Enter');await page.getByRole('dialog',{name:'#11111118 · 单据详情',exact:true}).waitFor();await page.getByText('完整正文',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.refs.length),1);assert.equal(await page.evaluate(()=>window.refs[0].id),'11111118');
 await page.getByRole('button',{name:'关闭#11111118 · 单据详情',exact:true}).last().click();await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='打开 TAPD 需求 #11111118：示例需求 7');
 await page.evaluate(()=>window.draw({},true));assert.equal(await page.getByRole('button',{name:/打开 TAPD/}).count(),8);
 await page.evaluate(()=>window.draw({batchId:'example-empty',items:[],returned:0,total:0,partial:false,truncated:false,stale:false,warnings:[]}));await page.getByText('没有匹配的单据。',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:/打开 TAPD/}).count(),0);
 await page.evaluate(()=>window.draw({batchId:'example-failed',items:[],returned:0,total:null,partial:true,truncated:false,stale:false,warnings:[]}));await page.getByText('未取得单据，请重新查询。',{exact:true}).waitFor();assert.equal(await page.getByText('没有匹配的单据。',{exact:true}).count(),0);
 assert.equal(await page.evaluate(()=>window.calls.some(x=>['tapd.create','tapd.add_comment','tapd.update_status'].includes(x.name))),false);
 console.log('PASS batch default five, stored expansion retry, partial/truncated/stale, selected collection, full detail and focus');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
 }finally{rmSync(temp,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
