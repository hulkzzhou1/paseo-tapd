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
 const registrations=new Map();let refresh=()=>{};const client={paseo:{agents:{subscribe(fn){window.nudge=fn;return()=>{window.nudge=()=>{}};}}},rpc:(contract,input)=>window.rpc(contract,input),addScreen:()=>()=>{},addSettingsScreen:()=>()=>{},addSidebarHeaderItem:()=>()=>{},addCommandCenterItem:()=>()=>{},addAttachmentSource:()=>()=>{},addTimelineRenderer:()=>()=>{},addComposerPill(input){const registration={...input,update(patch){registration.button={...registration.button,...patch};refresh();},remove(){registrations.delete(input.id);refresh();}};registrations.set(input.id,registration);refresh();return registration;}};
 const theme={colors:{surface0:'#fff',surface1:'#f8fafc',surface2:'#e2e8f0',border:'#cbd5e1',foreground:'#0f172a',foregroundMuted:'#475569',accent:'#2563eb',accentForeground:'#fff',statusSuccess:'#15803d',statusWarning:'#b45309',statusDanger:'#b91c1c'}};
 const cleanup=contribute(client);window.stopAccess=cleanup;window.restartAccess=()=>{window.stopAccess();window.stopAccess=contribute(client);};function ComposerButton({entry:x,theme}){const [open,setOpen]=useState(false);const Content=x.button.behavior.Content;return <><Pressable accessibilityRole='button' accessibilityLabel={x.button.title} onPress={()=>setOpen(true)}><View pointerEvents='none' accessible={false} accessibilityElementsHidden importantForAccessibility='no-hide-descendants'><x.button.icon host={{id:'example-host',label:'Example'}} theme={theme} layout={{compact:false,platform:'web'}} agentId={x.agentId} workspaceId={x.workspaceId} context='agent' size={14} color='#475569'/></View><Text>{x.button.label}</Text></Pressable>{open?<Content host={{id:'example-host',label:'Example'}} theme={theme} layout={{compact:false,platform:'web'}} agentId={x.agentId} workspaceId={x.workspaceId} context='agent' close={()=>setOpen(false)}/>:null}</>;}function App(){const [,setVersion]=useState(0);const [operation,setOperation]=useState(null);const [mounted,setMounted]=useState(true);const [night,setNight]=useState(false);const [currentAgent,setCurrentAgent]=useState('example-agent');window.mountComposer=setMounted;window.setNight=setNight;window.switchAgent=setCurrentAgent;const currentTheme=night?{...theme,colors:{...theme.colors,surface0:'#111827',surface1:'#1f2937',foreground:'#f9fafb',foregroundMuted:'#cbd5e1'}}:theme;window.showWriteCard=setOperation;refresh=()=>setVersion(v=>v+1);return <>{operation?<EntityResultCard theme={currentTheme} agentId="example-agent" item={{data:{operation,entity:{siteUrl:"https://example.com",apiEndpoint:"https://api.example.com",workspaceId:"12345678",kind:"story",id:"11111111",title:"示例需求",status:"open",statusLabel:"待处理",owner:""},warnings:[]}}}/>:null}{[...registrations.values()].filter(x=>mounted&&x.agentId===currentAgent&&x.button.visible!==false).map(x=><ComposerButton key={x.id} entry={x} theme={currentTheme}/>)}</>};createRoot(document.getElementById('root')).render(<QueryClientProvider client={query}><App/></QueryClientProvider>);`;
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

 const beforeUnknown=await page.evaluate(()=>window.calls.filter(x=>x.name==='tapd.entity').length);
 await page.evaluate(()=>{window.refs=[{siteUrl:'https://example.com',apiEndpoint:'https://api.example.com',workspaceId:'12345678',kind:'story',id:'11111111',title:'',status:'',statusLabel:'',owner:''}];return window.refresh();});
 await page.getByRole('button',{name:'会话 TAPD 单据（1）'}).waitFor();assert.equal(await page.evaluate(()=>window.calls.filter(x=>x.name==='tapd.entity').length),beforeUnknown,'unknown link placeholders never load detail before a click');
 await page.getByRole('button',{name:'会话 TAPD 单据（1）'}).focus();await page.keyboard.press('Enter');await page.getByRole('dialog',{name:'#11111111 · 单据详情',exact:true}).waitFor();
 assert.equal(await page.getByRole('dialog',{name:'会话 TAPD 单据',exact:true}).count(),0,'one item opens detail directly');await page.getByText('完整正文',{exact:true}).waitFor();
 await page.getByRole('button',{name:'关闭#11111111 · 单据详情',exact:true}).last().click();
 await page.evaluate(()=>{window.refs=[{...window.refs[0],id:'22222222',title:'第二张单据'},...window.refs];return window.refresh();});
 await page.setViewportSize({width:360,height:740});await page.getByRole('button',{name:'会话 TAPD 单据（2）'}).click();const list=page.getByRole('dialog',{name:'会话 TAPD 单据',exact:true});await list.waitFor();assert.ok((await list.boundingBox()).width<=360);assert.equal(await list.getByRole('button',{name:/打开 TAPD/}).count(),2);
 await list.getByText('#11111111',{exact:true}).waitFor();
 await list.getByRole('button',{name:'从会话移除 #22222222',exact:true}).click();await page.getByRole('button',{name:'会话 TAPD 单据（1）'}).waitFor();await list.getByRole('button',{name:'打开 TAPD 需求 #11111111：',exact:true}).click();await page.getByRole('dialog',{name:'#11111111 · 单据详情',exact:true}).waitFor();assert.equal(await list.count(),0);
 // Closing the short-lived list/popover cannot destroy a dirty operation page.
 const composerDetail=page.getByRole('dialog',{name:'#11111111 · 单据详情',exact:true});await composerDetail.getByRole('button',{name:'写回评论',exact:true}).click();
 const draft=page.getByRole('dialog',{name:'写回评论 · #11111111',exact:true});await draft.getByPlaceholder('输入要写回 TAPD 的内容（纯文本，自动转 HTML）').fill('尚未提交的示例内容');
 await page.evaluate(()=>{window.savedRpc=window.rpc;window.rpc=(contract,input)=>contract.name==='tapd.conversations'?Promise.reject(new Error('Example local RPC unavailable')):window.savedRpc(contract,input);window.refresh();});
 await page.waitForFunction(()=>window.calls.filter(x=>x.name==='tapd.conversation.focus').length===5);assert.equal(await draft.getByPlaceholder('输入要写回 TAPD 的内容（纯文本，自动转 HTML）').inputValue(),'尚未提交的示例内容','a failed refresh cannot unmount an open operation');
 await page.evaluate(()=>{window.rpc=window.savedRpc;window.refresh();});

 await page.keyboard.press('Escape');await draft.getByText('放弃尚未提交的内容？',{exact:true}).waitFor();await draft.getByRole('button',{name:'继续编辑',exact:true}).click();assert.equal(await draft.getByPlaceholder('输入要写回 TAPD 的内容（纯文本，自动转 HTML）').inputValue(),'尚未提交的示例内容');
 await draft.getByRole('button',{name:'返回详情',exact:true}).click();await draft.getByRole('button',{name:'放弃修改',exact:true}).click();await composerDetail.getByText('完整正文',{exact:true}).waitFor();
 await composerDetail.getByRole('button',{name:'从会话移除',exact:true}).click();await page.waitForFunction(()=>window.refs.length===0);await composerDetail.getByRole('button',{name:'写回评论',exact:true}).click();
 const removedDraft=page.getByRole('dialog',{name:'写回评论 · #11111111',exact:true});await removedDraft.getByPlaceholder('输入要写回 TAPD 的内容（纯文本，自动转 HTML）').fill('移除引用后仍可继续编辑');await page.evaluate(()=>window.refresh());
 await page.keyboard.press('Escape');await removedDraft.getByText('放弃尚未提交的内容？',{exact:true}).waitFor();await removedDraft.getByRole('button',{name:'放弃修改',exact:true}).click();await composerDetail.waitFor();await page.keyboard.press('Escape');await composerDetail.waitFor({state:'hidden'});await page.getByRole('button',{name:/会话 TAPD 单据/}).waitFor({state:'hidden'});
 await page.evaluate(()=>{window.refs=[{siteUrl:'https://example.com',apiEndpoint:'https://api.example.com',workspaceId:'12345678',kind:'story',id:'11111111',title:'',status:'',statusLabel:'',owner:''}];return window.refresh();});


 const focused=await page.evaluate(()=>window.calls.filter(x=>x.name==='tapd.conversation.focus').length);assert.equal(focused,5);assert.equal(await page.evaluate(()=>window.calls.some(x=>['tapd.create','tapd.add_comment','tapd.update_status'].includes(x.name))),false);
 await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
 // Removing the final list row must publish the empty state without unmounting its owner.
 for(const includeEmpty of [false,true]){
 await page.evaluate(value=>{window.includeEmpty=value;},includeEmpty);
 await page.evaluate(()=>{window.refs=[window.refs[0],{...window.refs[0],id:'22222222'}];window.refresh();});
 await page.getByRole('button',{name:'会话 TAPD 单据（2）'}).click();
 const emptiedList=page.getByRole('dialog',{name:'会话 TAPD 单据',exact:true});
 await emptiedList.getByRole('button',{name:'从会话移除 #22222222',exact:true}).click();
 await emptiedList.getByRole('button',{name:'从会话移除 #11111111',exact:true}).click();
 await emptiedList.getByText('当前会话没有 TAPD 单据。',{exact:true}).waitFor();
 assert.equal(await emptiedList.getByRole('button',{name:/打开 TAPD|从会话移除/}).count(),0);
 await page.keyboard.press('Escape');await emptiedList.waitFor({state:'hidden'});await page.getByRole('button',{name:/会话 TAPD 单据/}).waitFor({state:'hidden'});
 await page.evaluate(()=>{window.refs=[{siteUrl:'https://example.com',apiEndpoint:'https://api.example.com',workspaceId:'12345678',kind:'story',id:'11111111',title:'',status:'',statusLabel:'',owner:''}];window.refresh();});
 }
 // Local removal remains available when detail reads or connection guards reject the sole reference.
 for(const failure of ['detail','focus']){
  await page.evaluate(mode=>{window.failureRpc=window.rpc;window.rpc=(contract,input)=>contract.name===(mode==='detail'?'tapd.entity':'tapd.conversation.focus')?Promise.reject(new Error('Example inaccessible reference')):window.failureRpc(contract,input);window.refs=[{siteUrl:'https://example.com',apiEndpoint:'https://api.example.com',workspaceId:'12345678',kind:'story',id:'11111111',title:'',status:'',statusLabel:'',owner:''}];window.refresh();},failure);
  await page.getByRole('button',{name:'会话 TAPD 单据（1）'}).click();
  const failedDialog=page.getByRole('dialog',{name:failure==='detail'?'#11111111 · 单据详情':'会话 TAPD 单据',exact:true});
  if(failure==='detail')await failedDialog.getByRole('button',{name:'重试加载单据',exact:true}).waitFor();
  const beforeRemove=await page.evaluate(()=>window.calls.filter(x=>x.name==='tapd.entity').length);
  await failedDialog.getByRole('button',{name:failure==='detail'?'从会话移除':'从会话移除 #11111111',exact:true}).click();
  await page.waitForFunction(()=>window.refs.length===0);
  if(failure==='focus')await failedDialog.getByText('当前会话没有 TAPD 单据。',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.calls.filter(x=>x.name==='tapd.entity').length),beforeRemove,'removing an inaccessible shortcut never reads TAPD');
  await page.keyboard.press('Escape');await failedDialog.waitFor({state:'hidden'});await page.getByRole('button',{name:/会话 TAPD 单据/}).waitFor({state:'hidden'});
  await page.evaluate(()=>{window.rpc=window.failureRpc;});
 }
 await page.evaluate(()=>{window.refs=[{siteUrl:'https://example.com',apiEndpoint:'https://api.example.com',workspaceId:'12345678',kind:'story',id:'11111111',title:'',status:'',statusLabel:'',owner:''}];window.refresh();});
 // Hiding/rebuilding composer surfaces never controls registration or reopens an old action.
 await page.evaluate(()=>window.mountComposer(false));await page.getByRole('button',{name:/会话 TAPD 单据/}).waitFor({state:'hidden'});
 await page.evaluate(()=>window.mountComposer(true));await page.getByRole('button',{name:'会话 TAPD 单据（1）'}).waitFor();assert.equal(await page.getByRole('dialog').count(),0);
 await page.evaluate(()=>window.switchAgent('other-example-agent'));await page.getByRole('button',{name:/会话 TAPD 单据/}).waitFor({state:'hidden'});
 await page.evaluate(()=>window.switchAgent('example-agent'));assert.equal(await page.getByRole('button',{name:/会话 TAPD 单据/}).count(),1);
 await page.evaluate(()=>window.restartAccess());await page.getByRole('button',{name:'会话 TAPD 单据（1）'}).waitFor();assert.equal(await page.getByRole('button',{name:/会话 TAPD 单据/}).count(),1);
 await page.evaluate(()=>{window.workspaceId=null;return window.refresh();});await page.getByRole('button',{name:/会话 TAPD 单据/}).waitFor({state:'hidden'});
 await page.evaluate(()=>{window.setNight(true);window.showWriteCard('read');});
 const fallback=page.getByRole('button',{name:'打开 TAPD 需求 #11111111：示例需求',exact:true});await fallback.focus();await page.keyboard.press('Enter');
 const fallbackDetail=page.getByRole('dialog',{name:'#11111111 · 单据详情',exact:true});await fallbackDetail.getByText('完整正文',{exact:true}).waitFor();
 const panel=await page.getByTestId('workbench-dialog-panel').boundingBox();assert(panel.width<=360&&panel.x>=0);
 await page.keyboard.press('Escape');await fallbackDetail.waitFor({state:'hidden'});await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='打开 TAPD 需求 #11111111：示例需求');
 // A response finishing after plugin cleanup cannot recreate its composer entry.
 await page.evaluate(()=>{window.workspaceId='example-workspace';const original=window.rpc;window.rpc=(contract,input)=>contract.name==='tapd.conversations'?new Promise(resolve=>{window.releasePoll=()=>resolve({conversations:[{agentId:'example-agent',workspaceId:'example-workspace',entities:window.refs}]});}):original(contract,input);window.refresh();});
 await page.waitForFunction(()=>typeof window.releasePoll==='function');await page.evaluate(()=>{window.stopAccess();window.releasePoll();});await page.getByRole('button',{name:/会话 TAPD 单据/}).waitFor({state:'hidden'});
 console.log('PASS actual contribution without sidebar, composer mount/switch/reload and late cleanup, no-workspace dark/narrow card fallback; create/comment/status card outcomes and shared detail, composer zero/one/multiple, unknown-link placeholder, explicit detail load, remove and focused open');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
 }finally{rmSync(temp,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
