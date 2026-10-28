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
 import React,{useCallback} from 'react';import {View,Text} from 'react-native';export {TextInput,ScrollView,FlatList} from 'react-native';
 export const defineRpc=x=>x,defineSettings=x=>x,defineAttachmentSource=x=>x;
 export const SettingsAction=()=>null,SettingsCard=()=>null,SettingsInput=()=>null,SettingsRow=()=>null,SettingsSection=()=>null,SettingsSwitch=()=>null;export const SidebarRow=()=>null;export const Icon=()=>null;export const useToast=()=>({error:()=>{},show:()=>{}});export const copyText=async()=>{},openExternalUrl=async()=>{};
 export const useSettings=()=>({status:'ready',values:window.settings,revision:1,save:async()=>true});
 export const useAgent=(id,select)=>select({workspaceId:window.workspaceId});
 export const usePaseo=()=>({agents:{subscribe:()=>()=>{},list:async()=>({entries:window.assignableAgents??[]})},projects:{list:async()=>({projects:[]})},providers:{snapshot:async()=>({entries:[]})}});
 export const useRpc=rpc=>useCallback(input=>window.rpc(rpc,input),[rpc]);window.rpc=async(rpc,input)=>{window.calls.push({name:rpc.name,input});
 if(rpc.name==='tapd.task.migration')return {groups:window.migrationGroups??[],warnings:[]};
 if(rpc.name==='tapd.task.migration.confirm'){if(window.migrationFail)throw Error('changed');const group=window.migrationGroups.find(group=>group.id===input.id);window.toolLinks=group.candidates.filter(link=>link.agentId===input.agentId).map(link=>({...link,responsibility:{confirmedAt:'2026-01-01',actorAgentId:'user',revision:'migrated'}}));window.migrationGroups=[];return {ok:true,changed:true,link:window.toolLinks[0]};}
 if(rpc.name==='tapd.task-board')return {agentId:input.agentId,workspaceId:window.workspaceId,items:window.boardItems??[],fetchedAt:'2026-01-01T00:00:00Z',partial:false};
 if(rpc.name==='tapd.task.claim'){const link={key:input.kind+'-'+input.id,kind:input.kind,id:input.id,tapdWorkspaceId:input.workspaceId,apiEndpoint:'https://api.example.com',siteUrl:'https://example.com',agentId:input.agentId,agentTitle:'新负责人',workspaceId:'example-workspace',workspaceTitle:'Example',createdAt:'2026-01-01',responsibility:{confirmedAt:'2026-01-01',actorAgentId:'user',revision:'assignment'}};window.toolLinks=[link];return {ok:true,changed:true,link};}
 if(rpc.name==='tapd.task.release'){if(window.failRelease)throw new Error('storage unavailable');window.toolLinks=[];return {ok:true,changed:true};}
 if(rpc.name==='tapd.task.transfer'){if(window.failTransfer)throw new Error('revision changed');const link={...window.toolLinks[0],agentId:input.targetAgentId,agentTitle:'转交目标',responsibility:{confirmedAt:'2026-01-01',actorAgentId:'user',revision:'transferred'}};window.toolLinks=[link];return {ok:true,changed:true,link};}
 if(rpc.name==='tapd.agent-links')return {links:window.toolLinks??[]};
 if(rpc.name==='tapd.remove-agent-link'){window.toolLinks=[];return {ok:true};}
 if(rpc.name==='tapd.conversations')return {conversations:window.refs.length||window.includeEmpty?[{agentId:'example-agent',workspaceId:window.workspaceId,entities:window.refs}]:[]};
 if(rpc.name==='tapd.conversation.refresh'){if(window.failSummary)throw new Error('offline');window.refs=window.refs.map(e=>e.id===input.entity.id&&!e.title?{...e,title:'自动读取的标题',status:'open',statusLabel:'待处理',owner:'示例处理人'}:e);return {ok:true};}
 if(rpc.name==='tapd.conversation.focus')return {ok:true};
 if(rpc.name==='tapd.conversation.remove'){window.refs=window.refs.filter(x=>x.id!==input.entity.id);return {ok:true};}
 if(rpc.name==='tapd.entity')return {...input,workspaceId:'12345678',title:'示例需求',url:'https://example.com/item',status:'open',statusLabel:'待处理',owner:'',creator:'',description:'完整正文',descriptionHtml:'<p>完整正文</p>',comments:[],childTasks:[],childBugs:[],childTasksTotal:0,childBugsTotal:0,parentStory:null};
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
 assert.equal(await page.getByRole('button',{name:/TAPD 任务看板/}).count(),0);
 for(const [operation,caption] of [['create','单据已创建 · 创建时的摘要'],['comment','评论已发表 · 操作时的摘要'],['status','状态已修改 · 操作时的摘要']]){
 const before=await page.evaluate(()=>window.calls.filter(x=>x.name==='tapd.entity').length);
 await page.evaluate(value=>window.showWriteCard(value),operation);await page.getByText(caption,{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.calls.filter(x=>x.name==='tapd.entity').length),before,'write card rendering never refetches or repeats the operation');
 await page.getByRole('button',{name:'打开 TAPD 需求 #11111111：示例需求',exact:true}).focus();await page.keyboard.press('Enter');const detail=page.getByRole('dialog',{name:'#11111111 · 单据详情',exact:true});await detail.getByText('完整正文',{exact:true}).waitFor();
 for(const action of ['写回评论','派给 Agent','绑定 Agent'])await detail.getByRole('button',{name:action,exact:true}).waitFor();
 await detail.getByRole('button',{name:'关闭#11111111 · 单据详情',exact:true}).last().click();await detail.waitFor({state:'hidden'});
 }
 await page.evaluate(()=>{window.toolLinks=[{key:'story-11111111',kind:'story',id:'11111111',tapdWorkspaceId:'12345678',apiEndpoint:'https://api.example.com',workspaceId:'example-workspace',agentId:'example-bound-agent',agentTitle:'工具绑定示例',workspaceTitle:'Example',createdAt:'2026-01-01T00:00:00Z'}];window.showWriteCard('read');});
 await page.getByRole('button',{name:'打开 TAPD 需求 #11111111：示例需求',exact:true}).click();
 await page.getByText('工具绑定示例',{exact:true}).waitFor();
 for(const action of ['派给 Agent','绑定 Agent'])assert.equal(await page.getByRole('button',{name:action,exact:true}).count(),0,'bound items hide duplicate assignment actions even without live status');
 const linkedHeading=await page.getByText('关联任务',{exact:true}).boundingBox();const descriptionHeading=await page.getByText('描述',{exact:true}).boundingBox();assert(linkedHeading.y<descriptionHeading.y,'linked Agent section precedes description');

 await page.getByText('解除',{exact:true}).click();
 await page.getByText('工具绑定示例',{exact:true}).waitFor({state:'hidden'});
 for(const action of ['派给 Agent','绑定 Agent'])await page.getByRole('button',{name:action,exact:true}).waitFor();

 assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.name==='tapd.remove-agent-link').length),1);
 await page.evaluate(()=>window.assignableAgents=[{agent:{id:'example-new-owner',title:'新负责人',workspaceId:'example-workspace',status:'idle'}}]);
 await page.getByRole('button',{name:'绑定 Agent',exact:true}).click();
 await page.getByRole('button',{name:/新负责人/}).click();
 assert.equal(await page.evaluate(()=>window.calls.filter(call=>call.name==='tapd.task.claim').length),0,'selection alone does not assign');
 await page.getByRole('button',{name:'确认指派',exact:true}).click();
 await page.getByText('新负责人',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.calls.filter(call=>call.name==='tapd.task.claim').length),1,'UI uses the same validated ownership claim');
 for(const action of ['派给 Agent','绑定 Agent'])assert.equal(await page.getByRole('button',{name:action,exact:true}).count(),0);
 await page.evaluate(()=>window.assignableAgents=[{agent:{id:'example-transfer-target',title:'转交目标',workspaceId:'example-workspace',status:'idle'}}]);
 await page.getByRole('button',{name:'转交任务',exact:true}).click();
 await page.getByRole('button',{name:/转交目标/}).click();
 const transferDialog=page.getByRole('dialog',{name:'转交 Agent · #11111111',exact:true});
 assert.equal(await page.evaluate(()=>window.calls.filter(call=>call.name==='tapd.task.transfer').length),0);
 await transferDialog.getByRole('textbox',{name:'转交原因',exact:true}).fill('用户批准转交');
 await page.evaluate(()=>window.failTransfer=true);
 await transferDialog.getByRole('button',{name:'确认转交',exact:true}).click();
 await page.waitForFunction(()=>window.calls.filter(call=>call.name==='tapd.task.transfer').length===1);
 assert.equal(await page.evaluate(()=>window.toolLinks[0].agentId),'example-new-owner','failed transfer preserves original owner');
 assert.equal(await transferDialog.isVisible(),true,'failure keeps the confirmation available without replay');
 await page.evaluate(()=>window.failTransfer=false);
 await transferDialog.getByRole('button',{name:'确认转交',exact:true}).click();
 await page.getByText('转交目标',{exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(()=>{const i=window.calls.find(call=>call.name==='tapd.task.transfer').input;return [i.expectedOwnerAgentId,i.expectedRevision,i.targetAgentId,i.reason];}),['example-new-owner','assignment','example-transfer-target','用户批准转交']);
 await page.getByText('退出',{exact:true}).click();
 const releaseDialog=page.getByRole('dialog',{name:'退出任务 · #11111111',exact:true});
 assert.equal(await page.evaluate(()=>window.calls.filter(call=>call.name==='tapd.task.release').length),0);
 await releaseDialog.getByRole('textbox',{name:'退出原因',exact:true}).fill('任务范围调整');
 await page.evaluate(()=>window.failRelease=true);
 await releaseDialog.getByRole('button',{name:'确认退出',exact:true}).click();
 await page.waitForFunction(()=>window.calls.filter(call=>call.name==='tapd.task.release').length===1);
 assert.equal(await page.evaluate(()=>window.toolLinks[0].agentId),'example-transfer-target','failed release retains ownership');
 assert.equal(await releaseDialog.isVisible(),true);
 await page.evaluate(()=>window.failRelease=false);
 await releaseDialog.getByRole('button',{name:'确认退出',exact:true}).click();
 await page.getByRole('button',{name:'绑定 Agent',exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(()=>{const i=window.calls.find(call=>call.name==='tapd.task.release').input;return [i.agentId,i.expectedRevision,i.reason];}),['example-transfer-target','transferred','任务范围调整']);

 await page.getByRole('button',{name:'关闭#11111111 · 单据详情',exact:true}).last().click();
 await page.evaluate(()=>window.showWriteCard(null));

 const boardEntity={siteUrl:'https://example.com',apiEndpoint:'https://api.example.com',workspaceId:'12345678',kind:'story',id:'11111111',title:'明确接手的任务',status:'open',statusLabel:'待处理',owner:''};
 await page.evaluate(entity=>{window.boardItems=[{entity,classification:'unfinished',fetchedAt:'2026-01-01T00:00:00Z',warning:'',link:{agentId:'example-agent',agentTitle:'Example',workspaceId:'example-workspace',kind:'story',id:entity.id,key:'story-'+entity.id,tapdWorkspaceId:entity.workspaceId,apiEndpoint:entity.apiEndpoint,responsibility:{confirmedAt:'2026-01-01',actorAgentId:'example-agent',revision:'example-revision'}}}];window.toolLinks=window.boardItems.map(item=>item.link);window.refresh();},boardEntity);
 await page.getByRole('button',{name:'TAPD 任务看板（1）',exact:true}).click();
 await page.getByRole('button',{name:'未完成（1）',exact:true}).waitFor();
 await page.getByText('明确接手的任务',{exact:true}).waitFor();
 await page.getByRole('button',{name:'已完成（0）',exact:true}).click();
 await page.getByText('当前分类没有任务',{exact:true}).waitFor();
 await page.getByRole('button',{name:'未完成（1）',exact:true}).click();
 await page.getByRole('button',{name:'打开任务 #11111111：明确接手的任务',exact:true}).focus();await page.keyboard.press('Enter');
 await page.getByText('完整正文',{exact:true}).waitFor();
 await page.evaluate(()=>{window.boardItems=[];window.toolLinks=[];window.refresh();window.panelCalls=[];});
 const legacyLink={key:'story-33333333',kind:'story',id:'33333333',tapdWorkspaceId:'12345678',apiEndpoint:'https://api.example.com',siteUrl:'https://example.com',agentId:'example-agent',agentTitle:'历史候选 A',workspaceId:'example-workspace',workspaceTitle:'Example',createdAt:'2026-01-01',legacyOrigins:['settings']};
 await page.evaluate(link=>{window.toolLinks=[link];window.migrationGroups=[{kind:'story',id:link.id,workspaceId:link.tapdWorkspaceId,revision:'legacy-revision',candidates:[link,{...link,agentId:'example-other',agentTitle:'历史候选 B',legacyOrigins:['tool']}]}];window.refresh();},legacyLink);
 await page.getByRole('button',{name:'TAPD 任务看板（0）',exact:true}).click();
 await page.getByRole('button',{name:'待确认归属（1）',exact:true}).click();
 await page.getByText('#33333333 · 负责人待确认',{exact:true}).waitFor();
 await page.getByRole('textbox',{name:'搜索历史关联'}).fill('不存在');await page.getByText('没有匹配的历史关联',{exact:true}).waitFor();
 await page.getByRole('textbox',{name:'搜索历史关联'}).fill('');
 await page.getByRole('radio',{name:'选择历史候选 A 负责 #33333333',exact:true}).focus();await page.keyboard.press('Enter');
 await page.evaluate(()=>window.migrationFail=true);await page.getByRole('button',{name:'确认负责人 #33333333',exact:true}).click();
 await page.getByText('确认未成功，请刷新核对候选后重试；原关联已保留。',{exact:true}).waitFor();
 await page.evaluate(()=>window.migrationFail=false);await page.getByRole('button',{name:'确认负责人 #33333333',exact:true}).click();
 await page.getByText('没有匹配的历史关联',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.calls.filter(call=>call.name==='tapd.task.migration.confirm').length),2,'explicit confirmation retries require another user action');
 await page.getByRole('button',{name:'返回任务看板',exact:true}).click();
 await page.evaluate(()=>{window.toolLinks=[];window.refresh();window.panelCalls=[];});
 const ref={siteUrl:'https://example.com',apiEndpoint:'https://api.example.com',workspaceId:'12345678',kind:'story',id:'11111111',title:'第一张单据',status:'open',statusLabel:'待处理',owner:''};
 await page.evaluate(ref=>{window.refs=[ref];window.refresh();},ref);
 await page.getByRole('button',{name:'TAPD 任务看板（0）'}).click();
 await page.getByText('当前 Agent 的 TAPD 任务',{exact:true}).waitFor();
 await page.getByRole('button',{name:'最近查看（1）',exact:true}).click();
 await page.getByText('本次会话的 TAPD 单据',{exact:true}).waitFor();
 await page.getByRole('textbox',{name:'搜索会话单据'}).fill('不存在的标题');await page.getByText('没有匹配的单据',{exact:true}).waitFor();
 await page.getByRole('textbox',{name:'搜索会话单据'}).fill('');
 await page.getByRole('button',{name:'筛选缺陷',exact:true}).click();await page.getByText('没有匹配的单据',{exact:true}).waitFor();
 await page.getByRole('button',{name:'筛选全部',exact:true}).click();

 assert.equal(await page.getByRole('dialog').count(),0,'entry opens a panel, never an icon-owned modal');
 assert.equal(await page.evaluate(()=>window.panelCalls.at(-1).location),'explorer');
 await page.evaluate(()=>window.failSummary=true);await page.getByRole('button',{name:'刷新摘要',exact:true}).click();await page.getByText('1 张单据读取失败，可刷新重试',{exact:true}).waitFor();
 await page.evaluate(()=>{window.failSummary=false;window.refs[0].title='';});await page.getByRole('button',{name:'刷新摘要',exact:true}).click();await page.getByText('自动读取的标题',{exact:true}).waitFor();
 await page.evaluate(()=>{window.refs[0].title='第一张单据';window.refresh();});

 await page.getByRole('button',{name:'打开 TAPD 需求 #11111111：第一张单据',exact:true}).click();
 await page.getByText('完整正文',{exact:true}).waitFor();assert.equal(await page.getByRole('dialog').count(),0,'detail is inline in its own tab');
 assert.equal(await page.evaluate(()=>window.panelCalls.length),2);
 await page.evaluate(()=>window.mountComposer(false));await page.getByText('完整正文',{exact:true}).waitFor();
 await page.getByRole('button',{name:'写回评论',exact:true}).click();
 const draft=page.getByRole('dialog',{name:'写回评论 · #11111111',exact:true});await draft.getByPlaceholder('输入要写回 TAPD 的内容（纯文本，自动转 HTML）').fill('尚未提交的示例内容');
 await page.keyboard.press('Escape');await draft.getByText('放弃尚未提交的内容？',{exact:true}).waitFor();await draft.getByRole('button',{name:'继续编辑',exact:true}).click();
 await draft.getByRole('button',{name:'返回详情',exact:true}).click();await draft.getByRole('button',{name:'放弃修改',exact:true}).click();
 await page.evaluate(()=>{window.mountComposer(true);window.refs.push({...window.refs[0],id:'22222222',title:'第二张单据'});window.refresh();});
 await page.getByRole('button',{name:'TAPD 任务看板（0）'}).click();
 await page.getByRole('button',{name:'打开 TAPD 需求 #22222222：第二张单据',exact:true}).click();await page.getByText('完整正文',{exact:true}).last().waitFor();
 assert.equal(await page.evaluate(()=>new Set(window.panelCalls.map(x=>x.id)).size),3,'list and two independent detail tabs');
 await page.getByRole('button',{name:'TAPD 任务看板（0）'}).click();
 await page.getByRole('button',{name:'打开 TAPD 需求 #11111111：第一张单据',exact:true}).click();
 assert.equal(await page.evaluate(()=>new Set(window.panelCalls.map(x=>x.id)).size),3,'reopening reuses the existing detail tab');
 await page.getByRole('button',{name:'TAPD 任务看板（0）'}).click();await page.setViewportSize({width:360,height:740});await page.evaluate(()=>window.setNight(true));
 for(const id of ['11111111','22222222'])await page.getByRole('button',{name:'从会话移除 #'+id,exact:true}).click();
 await page.getByText('当前会话没有 TAPD 单据。',{exact:true}).waitFor();await page.getByRole('button',{name:/TAPD 任务看板/}).waitFor({state:'hidden'});
 assert.equal(await page.evaluate(()=>window.calls.some(x=>['tapd.create','tapd.add_comment','tapd.update_status'].includes(x.name))),false);
 // Unavailable references stay removable; failed polls retain the visible list.
 await page.evaluate(ref=>{window.refs=[ref];window.refresh();},ref);
 await page.getByRole('button',{name:'TAPD 任务看板（0）'}).click();
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
 await page.getByRole('button',{name:'TAPD 任务看板（0）'}).click();
 await page.getByRole('button',{name:'最近查看（1）',exact:true}).click();
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
