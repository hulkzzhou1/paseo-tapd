// Public detail action with fake host RPCs; no TAPD requests or screenshots.
// Run with PASEO_APP_DIR pointing to an existing Paseo app checkout.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const http = require('node:http');

async function main() {
  assert.ok(process.env.PASEO_APP_DIR, 'Set PASEO_APP_DIR to a local Paseo app directory');
  const fromApp = createRequire(path.join(process.env.PASEO_APP_DIR, 'package.json'));
  const root = path.resolve(__dirname, '..');
  const temp = mkdtempSync(path.join(tmpdir(), 'tapd-status-dropdown-'));
  const entry = `
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import {Text,View,Pressable} from 'react-native';
    import {EntityDetailModal} from ${JSON.stringify(path.join(root, 'client/workbench/EntityDetailModal.tsx'))};
    const light={surface0:'#ffffff',surface1:'#f8fafc',surface2:'#e2e8f0',border:'#cbd5e1',foreground:'#0f172a',foregroundMuted:'#475569',accent:'#2563eb',accentForeground:'#ffffff',statusSuccess:'#15803d',statusWarning:'#b45309',statusDanger:'#b91c1c'};
    const dark={surface0:'#111827',surface1:'#1f2937',surface2:'#374151',border:'#4b5563',foreground:'#f9fafb',foregroundMuted:'#cbd5e1',accent:'#60a5fa',accentForeground:'#111827',statusSuccess:'#4ade80',statusWarning:'#fbbf24',statusDanger:'#f87171'};
    function App(){
      const [version,setVersion]=useState(0);const [kind,setKind]=useState('task');const [night,setNight]=useState(false);
      window.changeDetail=()=>{setKind('bug');setNight(true);};
      const Detail=EntityDetailModal;
      return <View style={{flex:1}}><Pressable accessibilityRole="button" style={{zIndex:10,position:'absolute',top:0}} onPress={()=>{setKind('bug');setNight(true);}}><Text>切换缺陷详情</Text></Pressable>
        <Text accessibilityLabel="看板状态">{window.savedStatus||'open'}</Text>
        <Detail target={{kind,id:'12345678',title:'示例单据'}} onClose={()=>{}} theme={{colors:night?dark:light}} extras={{links:[],refreshToken:version,onStatusDone:()=>{window.refreshed=(window.refreshed||0)+1;setVersion(v=>v+1);}}}/>
      </View>;
    }
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><App/></QueryClientProvider>);
  `;
  writeFileSync(path.join(temp, 'host.tsx'), `
    import React from 'react';import {Text,ScrollView,TextInput,View} from 'react-native';
    export {ScrollView,TextInput};export const defineRpc=x=>x;export const defineSettings=x=>x;export const defineAttachmentSource=x=>x;
    export const openExternalUrl=async()=>{};export const copyText=async()=>{};export const usePaseo=()=>({});
    export const Icon=()=>null;export const useToast=()=>({show:(text)=>{window.toast=text;},error:(text)=>{window.toast=text;}});
    export function Modal({open,children}){return open?<View>{children}</View>:null;}Modal.Content=({children})=><View>{children}</View>;
    export const useRpc=rpc=>async input=>{
      window.calls=window.calls||[];window.calls.push({name:rpc.name,input});
      if(rpc.name==='tapd.entity')return {kind:input.kind,id:input.id,workspaceId:input.kind==='bug'?'87654321':'23456789',title:'示例单据',status:window.savedStatus||'open',statusLabel:window.savedStatus==='done'?'已完成':'待处理',owner:'',creator:'',priority:'',description:'示例描述',comments:[],commentsError:null,childTasks:[],childBugs:[],childTasksTotal:0,childBugsTotal:0,parentStory:null,url:'https://example.com'};
      if(rpc.name==='tapd.status_options'){
        if(window.optionFailure){window.optionFailure=false;throw new Error('private host error must stay hidden');}
        return {options:[{value:'open',label:'待处理'},{value:'done',label:input.kind==='bug'?'缺陷完成':'已完成'}],...(input.kind==='bug'?{current:window.savedStatus||'open',transitions:[{value:'done',label:'缺陷完成',fields:[],supported:true}]}:{})};
      }
      if(rpc.name==='tapd.update_status'){
        await new Promise(r=>setTimeout(r,180));
        if(!window.writeFailed){window.writeFailed=true;throw new Error('private write error must stay hidden');}
        if(window.unverified)return {ok:false,outcome:'unverified',writeState:'accepted',status:window.savedStatus};window.savedStatus=input.status;return {ok:true,outcome:'verified',writeState:'accepted',status:input.status};
      }
      if(rpc.name==='tapd.agent_status')return {items:[]};
      throw new Error('Unexpected RPC '+rpc.name);
    };
  `);
  try {
    const host = path.join(temp, 'host.tsx');
    const result = fromApp('esbuild').buildSync({stdin:{contents:entry,loader:'tsx',resolveDir:root},bundle:true,write:false,define:{'process.env.NODE_ENV':'"development"'},alias:{react:fromApp.resolve('react'),'react/jsx-runtime':fromApp.resolve('react/jsx-runtime'),'react-dom/client':fromApp.resolve('react-dom/client'),'react-dom':fromApp.resolve('react-dom'),'react-native':fromApp.resolve('react-native-web'),'@getpaseo/plugin':host,'@getpaseo/plugin/client':host,'@getpaseo/plugin/client/react-native':host},logLevel:'silent'});
    const script = result.outputFiles[0].text;
    const server = http.createServer((req,res)=>{res.setHeader('content-type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?script:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}#root{display:flex}</style><div id="root"></div><script src="/app.js"></script>');});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    let browser;
    try {
      browser = await fromApp('@playwright/test').chromium.launch({headless:true,args:['--no-sandbox']});
      const page = await browser.newPage({viewport:{width:1100,height:800}});
      page.setDefaultTimeout(7000);
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const calls = name=>page.evaluate(name=>(window.calls||[]).filter(c=>c.name===name),name);
      await page.getByText('示例描述',{exact:true}).waitFor();
      assert.equal((await calls('tapd.status_options')).length,0,'status options are lazy');
      await page.getByRole('button',{name:'修改状态：待处理',exact:true}).click();
      await page.getByRole('menuitemradio',{name:'待处理',exact:true}).waitFor();
      assert.deepEqual((await calls('tapd.status_options'))[0].input,{kind:'task',workspaceId:'23456789'});
      assert.equal(await page.getByRole('menuitemradio',{name:'待处理',exact:true}).getAttribute('aria-checked'),'true');
      await page.getByRole('menuitemradio',{name:'待处理',exact:true}).click();
      assert.equal((await calls('tapd.update_status')).length,0);
      await page.getByRole('menuitemradio',{name:'已完成',exact:true}).dblclick();
      await page.getByText('状态未确认，请读取详情核对后再操作。',{exact:true}).waitFor();
      assert.equal((await calls('tapd.update_status')).length,1,'double click writes only once');
      assert.equal(await page.getByRole('menuitemradio',{name:'待处理',exact:true}).getAttribute('aria-checked'),'true');
      assert.equal(await page.getByText('private write error must stay hidden',{exact:true}).count(),0);
      assert.equal(await page.evaluate(()=>window.refreshed||0),0);
      await page.getByRole('menuitemradio',{name:'已完成',exact:true}).click();
      await page.getByRole('button',{name:'修改状态：已完成',exact:true}).waitFor();
      assert.deepEqual((await calls('tapd.update_status')).map(c=>c.input),[
        {kind:'task',id:'12345678',workspaceId:'23456789',status:'done'},
        {kind:'task',id:'12345678',workspaceId:'23456789',status:'done'},
      ]);
      assert.equal(await page.evaluate(()=>window.refreshed),1);
      assert.equal(await page.getByLabel('看板状态',{exact:true}).textContent(),'done');
      assert.ok((await calls('tapd.entity')).length>=2,'detail refreshed');
      assert.equal(await page.getByRole('dialog',{name:'修改状态选项',exact:true}).count(),0);
      await page.evaluate(()=>{window.optionFailure=true;window.savedStatus='open';});
      await page.evaluate(()=>window.changeDetail());
      await page.setViewportSize({width:390,height:640});
      await page.getByRole('button',{name:'修改状态：待处理',exact:true}).click();
      await page.getByText('读取状态选项失败，请重试。',{exact:true}).waitFor();
      assert.equal(await page.getByText('private host error must stay hidden',{exact:true}).count(),0);
      await page.getByRole('button',{name:'重试',exact:true}).click();
      await page.getByRole('menuitemradio',{name:'缺陷完成',exact:true}).waitFor();
      const optionCalls=await calls('tapd.status_options');
      assert.deepEqual(optionCalls.slice(1).map(c=>c.input),[{kind:'bug',workspaceId:'87654321',id:'12345678'},{kind:'bug',workspaceId:'87654321',id:'12345678'}]);
      await page.getByRole('menuitemradio',{name:'缺陷完成',exact:true}).click();
      await page.getByRole('button',{name:'修改状态：已完成',exact:true}).waitFor();
      assert.deepEqual((await calls('tapd.update_status')).at(-1).input,{kind:'bug',id:'12345678',workspaceId:'87654321',status:'done',expectedStatus:'open',transitionFields:{}});
      assert.equal(await page.evaluate(()=>window.refreshed),2);
      await page.evaluate(()=>window.unverified=true);
      await page.getByRole('button',{name:'修改状态：已完成',exact:true}).click();
      await page.getByRole('menuitemradio',{name:'待处理',exact:true}).click();
      await page.waitForFunction(()=>window.toast==='已接受状态修改，但当前状态未核实；请刷新核对，勿重复提交。');
      await page.getByRole('button',{name:'修改状态：已完成',exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>window.savedStatus),'done','accepted-unverified must not display the requested status');
      assert.equal(await page.evaluate(()=>window.refreshed),3);await page.waitForTimeout(250);
      assert.equal((await calls('tapd.update_status')).length,4,'unverified feedback never retries the write');
      assert.deepEqual(errors,[]);
      console.log('PASS status detail dropdown: lazy project/kind candidates, current/no-op, double submit, safe failure/retry, detail/board refresh, compact dark detail');
    } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
  } finally {rmSync(temp,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
