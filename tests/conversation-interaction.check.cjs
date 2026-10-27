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
 export const SettingsAction=()=>null,SettingsCard=()=>null,SettingsInput=()=>null,SettingsRow=()=>null,SettingsSection=()=>null,SettingsSwitch=()=>null;export const SidebarRow=()=>null;export const Icon=()=>null;export const useToast=()=>({error:()=>{},show:()=>{}});export const copyText=async()=>{},openExternalUrl=async()=>{};
 export const useSettings=()=>({status:'ready',values:window.settings,revision:1,save:async()=>true});
 export const useAgent=(id,select)=>select({workspaceId:window.workspaceId});
 export const usePaseo=()=>({agents:{subscribe:()=>()=>{},list:async()=>({entries:[]})},projects:{list:async()=>({projects:[]})},providers:{snapshot:async()=>({entries:[]})}});
 export const useRpc=rpc=>input=>window.rpc(rpc,input);window.rpc=async(rpc,input)=>{window.calls.push({name:rpc.name,input});
 if(rpc.name==='tapd.conversations')return {conversations:window.refs.length||window.includeEmpty?[{agentId:'example-agent',workspaceId:window.workspaceId,entities:window.refs}]:[]};
 if(rpc.name==='tapd.conversation.focus')return {ok:true};
 if(rpc.name==='tapd.conversation.remove'){window.refs=window.refs.filter(x=>x.id!==input.entity.id);return {ok:true};}
 if(rpc.name==='tapd.entity')return {...input,title:'示例需求',url:'https://example.com/item',status:'open',statusLabel:'待处理',owner:'',creator:'',description:'完整正文',descriptionHtml:'<p>完整正文</p>',comments:[],childTasks:[],childBugs:[],childTasksTotal:0,childBugsTotal:0,parentStory:null};
 if(rpc.name==='tapd.status_options')return {options:[]};if(rpc.name==='tapd.agent_status')return {items:[]};throw new Error('Unexpected RPC');};
 `);
 const entry=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {Pressable,Text,View} from 'react-native';import contribute from ${JSON.stringify(path.join(root,'index.client.tsx'))};import {EntityResultCard} from ${JSON.stringify(path.join(root,'client/conversation/EntityResultCard.tsx'))};import {tapdSettingsSchema} from ${JSON.stringify(path.join(root,'shared/contracts.ts'))};
 window.calls=[];window.refs=[];window.workspaceId='example-workspace';window.settings=tapdSettingsSchema.parse({workspaceIds:'12345678'});const query=new QueryClient({defaultOptions:{queries:{retry:false}}});window.refresh=()=>window.nudge();
 const renderers=new Map();const panels=new Map();const opened=new Map();let activePanel=null;window.panelCalls=[];window.selectPanel=id=>{activePanel=id;refresh();};const registrations=new Map();let refresh=()=>{};const client={paseo:{agents:{subscribe(fn){window.nudge=fn;return()=>{window.nudge=()=>{}};}}},rpc:(contract,input)=>window.rpc(contract,input),addAgentPanel(input){panels.set(input.id,input);return()=>panels.delete(input.id);},openPanel(id,options){if(!panels.has(id))throw Error('Unregistered panel');window.panelCalls.push({id,...options});const key=id+options.agentId;opened.set(key,{id,...options});activePanel=key;refresh();},addScreen:()=>()=>{},addSettingsScreen:()=>()=>{},addSidebarHeaderItem:()=>()=>{},addCommandCenterItem:()=>()=>{},addAttachmentSource:()=>()=>{},addTimelineRenderer(input){renderers.set(input.kind,input.Component);return()=>renderers.delete(input.kind);},addComposerPill(input){const registration={...input,update(patch){registration.button={...registration.button,...patch};refresh();},remove(){registrations.delete(input.id);refresh();}};registrations.set(input.id,registration);refresh();return registration;}};
 const theme={colors:{surface0:'#fff',surface1:'#f8fafc',surface2:'#e2e8f0',border:'#cbd5e1',foreground:'#0f172a',foregroundMuted:'#475569',accent:'#2563eb',accentForeground:'#fff',statusSuccess:'#15803d',statusWarning:'#b45309',statusDanger:'#b91c1c'}};
 const cleanup=contribute(client);window.stopAccess=cleanup;window.restartAccess=()=>{window.stopAccess();window.stopAccess=contribute(client);};function ComposerButton({entry:x,theme}){const [open,setOpen]=useState(false);const Content=x.button.behavior.Content;return <><Pressable accessibilityRole='button' accessibilityLabel={x.button.title} onPress={()=>x.button.behavior.kind==='action'?x.button.behavior.onPress():setOpen(true)}><View pointerEvents='none' accessible={false} accessibilityElementsHidden importantForAccessibility='no-hide-descendants'>{typeof x.button.icon==='function'?<x.button.icon host={{id:'example-host',label:'Example'}} theme={theme} layout={{compact:false,platform:'web'}} agentId={x.agentId} workspaceId={x.workspaceId} context='agent' size={14} color='#475569'/>:null}</View><Text>{x.button.label}</Text></Pressable>{open?<Content host={{id:'example-host',label:'Example'}} theme={theme} layout={{compact:false,platform:'web'}} agentId={x.agentId} workspaceId={x.workspaceId} context='agent' close={()=>setOpen(false)}/>:null}</>;}function App(){const [,setVersion]=useState(0);const [operation,setOperation]=useState(null);const [mounted,setMounted]=useState(true);const [night,setNight]=useState(false);const [currentAgent,setCurrentAgent]=useState('example-agent');window.mountComposer=setMounted;window.setNight=setNight;window.switchAgent=setCurrentAgent;const currentTheme=night?{...theme,colors:{...theme.colors,surface0:'#111827',surface1:'#1f2937',foreground:'#f9fafb',foregroundMuted:'#cbd5e1'}}:theme;window.showWriteCard=setOperation;const Card=window.registeredCards?renderers.get("tapd-entity-result"):EntityResultCard;refresh=()=>setVersion(v=>v+1);return <>{operation?<Card theme={currentTheme} agentId="example-agent" item={{data:{operation,entity:{siteUrl:"https://example.com",apiEndpoint:"https://api.example.com",workspaceId:"12345678",kind:"story",id:"11111111",title:"示例需求",status:"open",statusLabel:"待处理",owner:""},warnings:[]}}}/>:null}{[...opened.entries()].map(([key,tab])=>{const Panel=panels.get(tab.id)?.Component;return Panel?<View key={key} testID={'panel-'+key} style={{display:activePanel===key?'flex':'none',height:650,width:'100%'}}><Panel theme={currentTheme} workspaceId={tab.workspaceId} params={{agentId:tab.agentId}} layout={{compact:false}} tab={{setModified(){},setState(){}}}/></View>:null})}{[...registrations.values()].filter(x=>mounted&&x.agentId===currentAgent&&x.button.visible!==false).map(x=><ComposerButton key={x.id} entry={x} theme={currentTheme}/>)}</>};createRoot(document.getElementById('root')).render(<QueryClientProvider client={query}><App/></QueryClientProvider>);`;
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

 const ref={siteUrl:'https://example.com',apiEndpoint:'https://api.example.com',workspaceId:'12345678',kind:'story',id:'11111111',title:'第一张单据',status:'open',statusLabel:'待处理',owner:''};
 await page.evaluate(ref=>{window.refs=[ref];window.refresh();},ref);
 await page.getByRole('button',{name:'会话 TAPD 单据（1）'}).click();
 await page.getByText('本次会话的 TAPD 单据',{exact:true}).waitFor();
 assert.equal(await page.getByRole('dialog').count(),0,'entry opens a panel, never an icon-owned modal');
 assert.equal(await page.evaluate(()=>window.panelCalls.at(-1).location),'explorer');
 await page.getByRole('button',{name:'打开 TAPD 需求 #11111111：第一张单据',exact:true}).click();
 await page.getByText('完整正文',{exact:true}).waitFor();assert.equal(await page.getByRole('dialog').count(),0,'detail is inline in its own tab');
 assert.equal(await page.evaluate(()=>window.panelCalls.length),2);
 await page.evaluate(()=>window.mountComposer(false));await page.getByText('完整正文',{exact:true}).waitFor();
 await page.getByRole('button',{name:'写回评论',exact:true}).click();
 const draft=page.getByRole('dialog',{name:'写回评论 · #11111111',exact:true});await draft.getByPlaceholder('输入要写回 TAPD 的内容（纯文本，自动转 HTML）').fill('尚未提交的示例内容');
 await page.keyboard.press('Escape');await draft.getByText('放弃尚未提交的内容？',{exact:true}).waitFor();await draft.getByRole('button',{name:'继续编辑',exact:true}).click();
 await draft.getByRole('button',{name:'返回详情',exact:true}).click();await draft.getByRole('button',{name:'放弃修改',exact:true}).click();
 await page.evaluate(()=>{window.mountComposer(true);window.refs.push({...window.refs[0],id:'22222222',title:'第二张单据'});window.refresh();});
 await page.getByRole('button',{name:'会话 TAPD 单据（2）'}).click();
 await page.getByRole('button',{name:'打开 TAPD 需求 #22222222：第二张单据',exact:true}).click();await page.getByText('完整正文',{exact:true}).last().waitFor();
 assert.equal(await page.evaluate(()=>new Set(window.panelCalls.map(x=>x.id)).size),3,'list and two independent detail tabs');
 await page.getByRole('button',{name:'会话 TAPD 单据（2）'}).click();
 await page.getByRole('button',{name:'打开 TAPD 需求 #11111111：第一张单据',exact:true}).click();
 assert.equal(await page.evaluate(()=>new Set(window.panelCalls.map(x=>x.id)).size),3,'reopening reuses the existing detail tab');
 await page.getByRole('button',{name:'会话 TAPD 单据（2）'}).click();await page.setViewportSize({width:360,height:740});await page.evaluate(()=>window.setNight(true));
 for(const id of ['11111111','22222222'])await page.getByRole('button',{name:'从会话移除 #'+id,exact:true}).click();
 await page.getByText('当前会话没有 TAPD 单据。',{exact:true}).waitFor();await page.getByRole('button',{name:/会话 TAPD 单据/}).waitFor({state:'hidden'});
 assert.equal(await page.evaluate(()=>window.calls.some(x=>['tapd.create','tapd.add_comment','tapd.update_status'].includes(x.name))),false);
 // Unavailable references stay removable; failed polls retain the visible list.
 await page.evaluate(ref=>{window.refs=[ref];window.refresh();},ref);
 await page.getByRole('button',{name:'会话 TAPD 单据（1）'}).click();
 await page.evaluate(()=>{window.originalRpc=window.rpc;window.rpc=(contract,input)=>['tapd.conversations','tapd.conversation.focus'].includes(contract.name)?Promise.reject(new Error('Example unavailable')):window.originalRpc(contract,input);window.refresh();});
 await page.getByRole('button',{name:'打开 TAPD 需求 #11111111：第一张单据',exact:true}).click();
 await page.getByText('本次会话的 TAPD 单据',{exact:true}).waitFor();
 await page.evaluate(()=>{window.rpc=window.originalRpc;});
 await page.getByRole('button',{name:'从会话移除 #11111111',exact:true}).click();await page.getByText('当前会话没有 TAPD 单据。',{exact:true}).waitFor();
 await page.evaluate(()=>{window.registeredCards=true;window.showWriteCard('read');});
 await page.getByRole('button',{name:'打开 TAPD 需求 #11111111：示例需求',exact:true}).click();
 await page.getByText('完整正文',{exact:true}).first().waitFor();
 assert.equal(await page.getByRole('dialog').count(),0,'registered timeline cards use the same detail tab navigation');
 assert.equal(await page.evaluate(()=>new Set(window.panelCalls.map(x=>x.id)).size),3,'card reuses list-opened item tab');
 // Host tab identities survive plugin registration rebuilds.
 await page.evaluate(ref=>{window.refs=[ref];window.showWriteCard(null);window.restartAccess();},ref);
 await page.getByRole('button',{name:'会话 TAPD 单据（1）'}).click();
 await page.getByRole('button',{name:'打开 TAPD 需求 #11111111：第一张单据',exact:true}).click();
 await page.getByText('完整正文',{exact:true}).first().waitFor();
 assert.equal(await page.evaluate(()=>new Set(window.panelCalls.map(x=>x.id)).size),3);
 // The public SDK cannot open a panel without a workspace: retain card fallback.
 await page.evaluate(()=>{window.workspaceId=null;window.showWriteCard('read');});
 await page.getByRole('button',{name:'打开 TAPD 需求 #11111111：示例需求',exact:true}).click();
 const fallback=page.getByRole('dialog',{name:'#11111111 · 单据详情',exact:true});await fallback.getByText('完整正文',{exact:true}).waitFor();
 await page.keyboard.press('Escape');await fallback.waitFor({state:'hidden'});
 await page.evaluate(()=>{window.showWriteCard(null);window.stopAccess();});
 console.log('PASS composer action → conversation Explorer panel → independent reusable detail tabs, composer unmount, draft protection, remove, narrow/dark');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
 }finally{rmSync(temp,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
