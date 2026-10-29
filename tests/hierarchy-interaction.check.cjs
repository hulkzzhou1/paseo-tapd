// Actual native TAPD hierarchy and detail creation flow; synthetic public RPCs only, no screenshots.
const assert=require('node:assert/strict'),{createRequire}=require('node:module'),{mkdtempSync,writeFileSync,rmSync}=require('node:fs'),{tmpdir}=require('node:os'),path=require('node:path'),http=require('node:http');
async function main(){
 const root=path.resolve(__dirname,'..'),fromApp=createRequire(path.join(process.env.PASEO_APP_DIR,'package.json')),temp=mkdtempSync(path.join(tmpdir(),'tapd-hierarchy-ui-'));
 let browser,server;
 try{
 const host=path.join(temp,'host.tsx');writeFileSync(host,`
 import React,{useCallback} from 'react';import{Text,View}from'react-native';export{TextInput,ScrollView,FlatList}from'react-native';
 export const defineRpc=x=>x,defineSettings=x=>x,defineAttachmentSource=x=>x,Icon=()=>null;
 export const useToast=()=>({show:()=>{},error:message=>{window.toast=message;}}),openExternalUrl=async()=>{},copyText=async()=>{};
 export const useSettings=()=>({status:'ready',values:window.settings,revision:1,save:async()=>true});
 const sdk={agents:{subscribe:()=>()=>{},list:async()=>({entries:[]})}};export const usePaseo=()=>sdk;
 export const useRpc=rpc=>useCallback(async input=>{window.calls.push({name:rpc.name,input});
 if(rpc.name==='tapd.children')return {items:[window.child],reads:{story:{total:1,partial:false,truncated:false,error:null},task:{total:0,partial:false,truncated:false,error:null},bug:{total:null,partial:true,truncated:true,error:'相关缺陷读取不完整'}}};
 if(rpc.name==='tapd.entity')return {...window.parent,...input,title:input.id==='11111111'?'父需求':'子需求',description:'可阅读正文',descriptionHtml:'<p>可阅读正文</p>',comments:[],commentsError:null,childStories:input.id==='11111111'?[window.child]:[],childTasks:[],childBugs:[],childTasksTotal:0,childBugsTotal:0,parentStory:null};
 if(rpc.name==='tapd.child_types'){if(window.typesFailed)throw Error('offline');return {types:[{id:'33333333',name:'可交付子需求'}]};}
 if(rpc.name==='tapd.create_fields')return {me:'',fields:[]};
 if(rpc.name==='tapd.filter_options')return {iterations:[],priorities:[],statuses:{story:[],task:[],bug:[]}};
 if(rpc.name==='tapd.create')return {id:'55555555',kind:input.kind,url:'https://example.com/new',writeState:'accepted',outcome:window.unverified?'unverified':'verified'};
 if(rpc.name==='tapd.agent-links')return {links:[]};if(rpc.name==='tapd.agent_status')return {items:[]};if(rpc.name==='tapd.status_options')return {options:[]};throw Error('Unexpected '+rpc.name);
 },[rpc]);`);
 const entry=`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{View}from'react-native';
 import{EntityDetailExperience}from${JSON.stringify(path.join(root,'client/workbench/EntityDetailExperience.tsx'))};import{tapdSettingsSchema}from${JSON.stringify(path.join(root,'shared/contracts.ts'))};
 window.calls=[];window.settings=tapdSettingsSchema.parse({workspaceIds:'12345678'});window.parent={kind:'story',id:'11111111',workspaceId:'12345678',siteUrl:'https://example.com',apiEndpoint:'https://api.example.com',title:'父需求',url:'https://example.com/parent',status:'open',statusLabel:'进行中',owner:'',labels:['Parent-only']};window.child={...window.parent,id:'44444444',title:'子需求',status:'done',statusLabel:'已完成',parentId:'11111111'};delete window.child.labels;
 const theme={colors:{surface0:'#fff',surface1:'#f8fafc',surface2:'#eee',border:'#ccc',foreground:'#111',foregroundMuted:'#555',accent:'#1677cc',accentForeground:'#fff',statusSuccess:'#15803d',statusWarning:'#b45309',statusDanger:'#b91c1c'}};
 function App(){const[target,setTarget]=useState(window.parent);return <View style={{flex:1}}><EntityDetailExperience target={target} onTargetChange={setTarget} theme={theme}/></View>;}
 createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><App/></QueryClientProvider>);`;
 const script=fromApp('esbuild').buildSync({stdin:{contents:entry,loader:'tsx',resolveDir:root},bundle:true,write:false,define:{'process.env.NODE_ENV':'"development"'},alias:{react:fromApp.resolve('react'),'react/jsx-runtime':fromApp.resolve('react/jsx-runtime'),'react-dom':fromApp.resolve('react-dom'),'react-dom/client':fromApp.resolve('react-dom/client'),'react-native':fromApp.resolve('react-native-web'),'@getpaseo/plugin':host,'@getpaseo/plugin/client':host,'@getpaseo/plugin/client/react-native':host},logLevel:'silent'}).outputFiles[0].text;
 server=http.createServer((req,res)=>{res.setHeader('content-type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?script:'<!doctype html><style>html,body,#root{height:100%;margin:0}#root{display:flex}</style><div id="root"></div><script src="/app.js"></script>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await fromApp('@playwright/test').chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1100,height:800}});page.setDefaultTimeout(8000);await page.goto('http://127.0.0.1:'+server.address().port);
 const detail=page.getByRole('dialog',{name:'#11111111 · 单据详情',exact:true});await detail.getByRole('button',{name:'创建该需求下的子需求',exact:true}).click();const form=page.getByRole('dialog',{name:'新建单据',exact:true});await form.getByRole('button',{name:'可交付子需求',exact:true}).click();await form.getByLabel('标题（必填）',{exact:true}).fill('独立交付');await page.evaluate(()=>{window.unverified=true;});await form.getByRole('button',{name:'创建',exact:true}).click();await form.getByText(/父级关系未核实（#55555555）/).waitFor();assert.equal(await form.getByRole('button',{name:'创建',exact:true}).isDisabled(),true);
 const writes=await page.evaluate(()=>window.calls.filter(x=>x.name==='tapd.create'));assert.equal(writes.length,1);assert.equal(writes[0].input.parentStoryId,'11111111');assert.equal(writes[0].input.workitemTypeId,'33333333');assert.equal(writes[0].input.storyId,undefined);assert.equal(writes[0].input.workspaceId,'12345678');
 assert.equal(await page.evaluate(()=>window.calls.some(x=>/claim|dispatch|status|comment/.test(x.name)&&x.name!=='tapd.status_options'&&x.name!=='tapd.agent_status')),false);
 console.log('PASS hierarchy UI: category selection, explicit parent/type creation and accepted-unverified repeat protection');
 }finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));rmSync(temp,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
