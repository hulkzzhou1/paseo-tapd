// Actual readonly detail labels with fake public RPCs; no TAPD requests or screenshots.
const assert=require('node:assert/strict'),{createRequire}=require('node:module'),{mkdtempSync,writeFileSync,rmSync}=require('node:fs'),{tmpdir}=require('node:os'),path=require('node:path'),http=require('node:http');
async function main(){
 const root=path.resolve(__dirname,'..'),fromApp=createRequire(path.join(process.env.PASEO_APP_DIR,'package.json')),temp=mkdtempSync(path.join(tmpdir(),'tapd-label-display-'));let browser,server;
 try{
 const host=path.join(temp,'host.tsx');writeFileSync(host,`
 import React,{useCallback}from'react';export{TextInput,ScrollView,FlatList}from'react-native';export const defineRpc=x=>x,defineSettings=x=>x,defineAttachmentSource=x=>x,Icon=()=>null;
 export const useToast=()=>({show:()=>{},error:()=>{}}),copyText=async()=>{},openExternalUrl=async()=>{};export const useSettings=()=>({status:'ready',values:window.settings,revision:1,save:async()=>true});
 const sdk={agents:{subscribe:()=>()=>{},list:async()=>({entries:[]})}};export const usePaseo=()=>sdk;
 export const useRpc=rpc=>useCallback(async input=>{window.calls.push({name:rpc.name,input});
 if(rpc.name==='tapd.entity'){const item=window.entities.find(x=>x.id===input.id);return {...item,url:'https://example.com/item',creator:'',description:'正文',descriptionHtml:'<p>正文</p>',comments:[],commentsError:null,childStories:[],childTasks:[],childBugs:[],childTasksTotal:0,childBugsTotal:0,parentStory:null};}
 if(rpc.name==='tapd.status_options')return {options:[]};throw Error('Unexpected '+rpc.name);
 },[rpc]);`);
 const entry=`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{View}from'react-native';
 import{EntityDetailExperience}from${JSON.stringify(path.join(root,'client/workbench/EntityDetailExperience.tsx'))};import{tapdSettingsSchema}from${JSON.stringify(path.join(root,'shared/contracts.ts'))};
 window.calls=[];window.settings=tapdSettingsSchema.parse({workspaceIds:'12345678'});const base={kind:'task',workspaceId:'12345678',siteUrl:'https://example.com',apiEndpoint:'https://api.example.com',status:'open',statusLabel:'未开始',owner:''};window.longLabel='long-label-'.repeat(18);window.entities=[[],['one'],['a','b','c'],[window.longLabel,'second','third'],undefined,null].map((labels,index)=>({...base,id:String(11111111+index),title:'Case '+index,...(labels===undefined?{}:{labels})}));
 const theme={colors:{surface0:'#fff',surface1:'#f8fafc',surface2:'#e2e8f0',border:'#ccc',foreground:'#111',foregroundMuted:'#555',accent:'#1677cc',accentForeground:'#fff',statusSuccess:'#15803d',statusWarning:'#b45309',statusDanger:'#b91c1c'}};
 function App(){const[target,setTarget]=useState(window.entities[2]);return <View style={{flex:1}}><EntityDetailExperience target={target} onTargetChange={setTarget} theme={theme}/></View>;}
 createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><App/></QueryClientProvider>);`;
 const script=fromApp('esbuild').buildSync({stdin:{contents:entry,loader:'tsx',resolveDir:root},bundle:true,write:false,define:{'process.env.NODE_ENV':'"development"'},alias:{react:fromApp.resolve('react'),'react/jsx-runtime':fromApp.resolve('react/jsx-runtime'),'react-dom':fromApp.resolve('react-dom'),'react-dom/client':fromApp.resolve('react-dom/client'),'react-native':fromApp.resolve('react-native-web'),'@getpaseo/plugin':host,'@getpaseo/plugin/client':host,'@getpaseo/plugin/client/react-native':host},logLevel:'silent'}).outputFiles[0].text;
 server=http.createServer((req,res)=>{res.setHeader('content-type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?script:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}#root{display:flex}</style><div id="root"></div><script src="/app.js"></script>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await fromApp('@playwright/test').chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1100,height:900}});page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
 const detail=page.getByRole('dialog',{name:'#11111113 · 单据详情',exact:true});for(const name of ['a','b','c'])await detail.getByLabel('标签：'+name,{exact:true}).waitFor();assert.equal(await detail.getByLabel('另有 1 个标签',{exact:true}).count(),0);
 await page.evaluate(()=>{window.entities[2].labels=['fresh-label'];});await detail.getByRole('button',{name:'刷新',exact:true}).click();await detail.getByLabel('标签：fresh-label',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.calls.some(x=>/create|update_labels|claim|dispatch|comment/.test(x.name))),false);assert.deepEqual(errors,[]);
 console.log('PASS label display UI: all detail labels, explicit refresh and no implicit writes');
 }finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));rmSync(temp,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
