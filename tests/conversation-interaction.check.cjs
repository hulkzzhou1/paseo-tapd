// Actual composer host, list and shared detail; only fake public RPC/SDK inputs.
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
 if(rpc.name==='tapd.conversations')return {conversations:window.refs.length?[{agentId:'example-agent',workspaceId:'example-workspace',entities:window.refs}]:[]};
 if(rpc.name==='tapd.conversation.focus')return {ok:true};
 if(rpc.name==='tapd.conversation.remove'){window.refs=window.refs.filter(x=>x.id!==input.entity.id);return {ok:true};}
 if(rpc.name==='tapd.entity')return {...input,title:'示例需求',url:'https://example.com/item',status:'open',statusLabel:'待处理',owner:'',creator:'',description:'完整正文',descriptionHtml:'<p>完整正文</p>',comments:[],childTasks:[],childBugs:[],childTasksTotal:0,childBugsTotal:0,parentStory:null};
 if(rpc.name==='tapd.status_options')return {options:[]};if(rpc.name==='tapd.agent_status')return {items:[]};throw new Error('Unexpected RPC');};
 `);
 const entry=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {Pressable,Text} from 'react-native';import {ConversationAccess} from ${JSON.stringify(path.join(root,'client/conversation/ConversationAccess.tsx'))};import {EntityResultCard} from ${JSON.stringify(path.join(root,'client/conversation/EntityResultCard.tsx'))};import {tapdSettingsSchema} from ${JSON.stringify(path.join(root,'shared/contracts.ts'))};
 window.calls=[];window.refs=[];window.settings=tapdSettingsSchema.parse({workspaceIds:'12345678'});const query=new QueryClient({defaultOptions:{queries:{retry:false}}});window.refresh=()=>query.invalidateQueries();
 const registrations=new Map();let refresh=()=>{};const client={addComposerPill(input){const registration={...input,update(patch){registration.button={...registration.button,...patch};refresh();},remove(){registrations.delete(input.id);refresh();}};registrations.set(input.id,registration);refresh();return registration;}};
 const theme={colors:{surface0:'#fff',surface1:'#f8fafc',surface2:'#e2e8f0',border:'#cbd5e1',foreground:'#0f172a',foregroundMuted:'#475569',accent:'#2563eb',accentForeground:'#fff',statusSuccess:'#15803d',statusWarning:'#b45309',statusDanger:'#b91c1c'}};
 function App(){const [,setVersion]=useState(0);const [operation,setOperation]=useState(null);window.showWriteCard=setOperation;refresh=()=>setVersion(v=>v+1);return <>{operation?<EntityResultCard theme={theme} agentId="example-agent" item={{data:{operation,entity:{siteUrl:"https://example.com",apiEndpoint:"https://api.example.com",workspaceId:"12345678",kind:"story",id:"11111111",title:"示例需求",status:"open",statusLabel:"待处理",owner:""},warnings:[]}}}/>:null}<ConversationAccess client={client} host={{id:'example-host',label:'Example'}} theme={theme} layout={{compact:false,platform:'web'}}/>{[...registrations.values()].filter(x=>x.button.visible!==false).map(x=><Pressable key={x.id} accessibilityRole='button' accessibilityLabel={x.button.title} onPress={x.button.behavior.onPress}><Text>{x.button.label}</Text></Pressable>)}</>};createRoot(document.getElementById('root')).render(<QueryClientProvider client={query}><App/></QueryClientProvider>);`;
 const code=fromApp('esbuild').buildSync({stdin:{contents:entry,loader:'tsx',resolveDir:root},bundle:true,write:false,define:{'process.env.NODE_ENV':'"development"'},alias:{react:fromApp.resolve('react'),'react/jsx-runtime':fromApp.resolve('react/jsx-runtime'),'react-dom/client':fromApp.resolve('react-dom/client'),'react-dom':fromApp.resolve('react-dom'),'react-native':fromApp.resolve('react-native-web'),'@getpaseo/plugin':host,'@getpaseo/plugin/client':host,'@getpaseo/plugin/client/react-native':host,'@getpaseo/plugin/client/ui':host},logLevel:'silent'}).outputFiles[0].text;
 const server=http.createServer((req,res)=>{res.setHeader('content-type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?code:'<!doctype html><div id="root"></div><script src="/app.js"></script>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{browser=await fromApp('@playwright/test').chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1200,height:850}});page.setDefaultTimeout(8000);await page.goto('http://127.0.0.1:'+server.address().port);
 assert.equal(await page.getByRole('button',{name:/会话 TAPD/}).count(),0);
 for(const [operation,caption] of [['create','单据已创建 · 创建时的摘要'],['comment','评论已发表 · 操作时的摘要'],['status','状态已修改 · 操作时的摘要']]){
 const before=await page.evaluate(()=>window.calls.filter(x=>x.name==='tapd.entity').length);
 await page.evaluate(value=>window.showWriteCard(value),operation);await page.getByText(caption+' · 打开查看最新详情',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.calls.filter(x=>x.name==='tapd.entity').length),before,'write card rendering never refetches or repeats the operation');
 await page.getByRole('button',{name:'打开 TAPD 需求 #11111111：示例需求',exact:true}).focus();await page.keyboard.press('Enter');const detail=page.getByRole('dialog',{name:'#11111111 · 单据详情',exact:true});await detail.getByText('完整正文',{exact:true}).waitFor();
 for(const action of ['写回评论','派给 Agent','绑定 Agent'])await detail.getByRole('button',{name:action,exact:true}).waitFor();
 await detail.getByRole('button',{name:'关闭#11111111 · 单据详情',exact:true}).last().click();await detail.waitFor({state:'hidden'});
 }
 await page.evaluate(()=>window.showWriteCard(null));

 await page.evaluate(()=>{window.refs=[{siteUrl:'https://example.com',apiEndpoint:'https://api.example.com',workspaceId:'12345678',kind:'story',id:'11111111',title:'示例需求',status:'open',statusLabel:'待处理',owner:''}];return window.refresh();});
 await page.getByRole('button',{name:'会话 TAPD 单据（1）'}).focus();await page.keyboard.press('Enter');await page.getByRole('dialog',{name:'#11111111 · 单据详情',exact:true}).waitFor();
 assert.equal(await page.getByRole('dialog',{name:'会话 TAPD 单据',exact:true}).count(),0,'one item opens detail directly');await page.getByText('完整正文',{exact:true}).waitFor();
 await page.getByRole('button',{name:'关闭#11111111 · 单据详情',exact:true}).last().click();
 await page.evaluate(()=>{window.refs=[{...window.refs[0],id:'22222222',title:'第二张单据'},...window.refs];return window.refresh();});
 await page.setViewportSize({width:360,height:740});await page.getByRole('button',{name:'会话 TAPD 单据（2）'}).click();const list=page.getByRole('dialog',{name:'会话 TAPD 单据',exact:true});await list.waitFor();assert.ok((await list.boundingBox()).width<=360);assert.equal(await list.getByRole('button',{name:/打开 TAPD/}).count(),2);
 await list.getByRole('button',{name:'从会话移除 #22222222',exact:true}).click();await page.getByRole('button',{name:'会话 TAPD 单据（1）'}).waitFor();await list.getByRole('button',{name:'打开 TAPD 需求 #11111111：示例需求',exact:true}).click();await page.getByRole('dialog',{name:'#11111111 · 单据详情',exact:true}).waitFor();assert.equal(await list.count(),0);
 const focused=await page.evaluate(()=>window.calls.filter(x=>x.name==='tapd.conversation.focus').length);assert.equal(focused,5);assert.equal(await page.evaluate(()=>window.calls.some(x=>['tapd.create','tapd.add_comment','tapd.update_status'].includes(x.name))),false);
 console.log('PASS create/comment/status card outcomes and shared detail, composer zero/one/multiple, remove and focused open');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
 }finally{rmSync(temp,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
