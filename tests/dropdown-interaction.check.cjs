// Run with PASEO_APP_DIR pointing to a local Paseo app checkout (no product dependency).
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
  const temp = mkdtempSync(path.join(tmpdir(), 'tapd-dropdown-'));
  const entry = `
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {View,Text,Pressable} from 'react-native';
    import {Dropdown} from ${JSON.stringify(path.join(root, 'client/workbench/Dropdown.tsx'))};
    const theme={colors:{surface0:'#fff',surface1:'#f8fafc',surface2:'#e2e8f0',border:'#cbd5e1',foreground:'#0f172a',foregroundMuted:'#475569',accent:'#2563eb',accentForeground:'#fff',statusDanger:'#b91c1c'}};
    function App(){
      const [selected,setSelected]=useState(['all']);const [priorities,setPriorities]=useState([]);
      const [error,setError]=useState('');const [failed,setFailed]=useState(true);const [loading,setLoading]=useState(false);
      return <View style={{padding:24,gap:8,alignItems:'flex-start'}}>
        <Dropdown label="状态" summary={selected[0]} selected={selected} theme={theme} options={[{value:'all',label:'全部'},{value:'active',label:'未结束'},{value:'done',label:'已结束'},{value:'blocked',label:'不可选',disabled:true}]} onSelect={v=>{setSelected([v]);}}/>
        <Text accessibilityLabel="状态结果">{selected.join(',')}</Text>
        <Dropdown label="优先级" summary={priorities.join(',')||'全部'} selected={priorities} multiple theme={theme} options={[{value:'high',label:'高'},{value:'low',label:'低'}]} onSelect={v=>setPriorities(a=>a.includes(v)?a.filter(x=>x!==v):[...a,v])}/>
        <Text accessibilityLabel="优先级结果">{priorities.join(',')}</Text>
        <Dropdown label="创建人" summary={selected[0]} selected={selected} searchable theme={theme} options={[{value:'sample-member',label:'sample-member'}]} error={error} onRetry={()=>setError('')} onSelect={v=>setSelected([v])} onCustomValue={v=>setSelected([v])}/>
        <Dropdown label="修改状态" summary="全部" selected={['all']} theme={theme} options={[{value:'all',label:'全部'},{value:'done',label:'完成'}]} error={error} onSelect={async()=>{window.submissions=(window.submissions||0)+1;await new Promise(r=>setTimeout(r,150));if(failed){setError('修改失败，请重试');setFailed(false);return false;}setError('');return true;}}/>
        <Dropdown label="空候选" summary="全部" selected={[]} searchable theme={theme} options={[]} loading={false} error="加载失败" onRetry={()=>{window.retried=true;}} onSelect={()=>{}} onCustomValue={v=>setSelected([v])}/>
        <Dropdown label="禁用" summary="全部" disabled selected={[]} options={[]} onSelect={()=>{window.disabledSelected=true;}} theme={theme}/>
        <Dropdown label="加载" summary="全部" loading={loading} onOpen={()=>setLoading(true)} selected={[]} options={[{value:'loading',label:'加载选项'}]} onSelect={()=>{window.loadingSelected=true;}} theme={theme}/>
        <View style={{position:'absolute',right:0,top:730}}><Dropdown label="边缘" summary="全部" selected={[]} options={[{value:'all',label:'全部'}]} onSelect={()=>{}} theme={theme}/></View>
        <Pressable accessibilityRole="button"><Text>外部按钮</Text></Pressable>
      </View>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  `;
  writeFileSync(path.join(temp, 'sdk.ts'), "export {TextInput,ScrollView} from 'react-native';");
  try {
    const result = fromApp('esbuild').buildSync({stdin:{contents:entry,loader:'tsx',resolveDir:root},bundle:true,write:false,define:{'process.env.NODE_ENV':'"development"'},alias:{react:fromApp.resolve('react'),'react/jsx-runtime':fromApp.resolve('react/jsx-runtime'),'react-dom/client':fromApp.resolve('react-dom/client'),'react-dom':fromApp.resolve('react-dom'),'react-native':fromApp.resolve('react-native-web'),'@getpaseo/plugin/client/react-native':path.join(temp,'sdk.ts')},logLevel:'silent'});
    const script = result.outputFiles[0].text;
    const server = http.createServer((req,res)=>{res.setHeader('content-type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?script:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/app.js"></script>');});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    let browser;
    try {
      browser = await fromApp('@playwright/test').chromium.launch({headless:true,args:['--no-sandbox']});
      const page = await browser.newPage({viewport:{width:1100,height:800}});
      page.setDefaultTimeout(7000);
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.getByRole('button',{name:'状态：all',exact:true}).click();
      await page.getByRole('menuitemradio',{name:'未结束',exact:true}).click();
      assert.equal(await page.getByLabel('状态结果',{exact:true}).textContent(),'active');
      assert.equal(await page.getByRole('menuitemradio',{name:'未结束',exact:true}).count(),0);
      const trigger=page.getByRole('button',{name:'状态：active',exact:true});
      await trigger.click();await page.getByRole('menuitemradio',{name:'未结束',exact:true}).waitFor();await page.keyboard.press('End');await page.keyboard.press('Enter');
      assert.equal(await page.getByLabel('状态结果',{exact:true}).textContent(),'done');
      await page.getByRole('button',{name:'状态：done',exact:true}).click();await page.getByRole('menuitemradio',{name:'已结束',exact:true}).waitFor();await page.keyboard.press('Escape');await page.getByRole('menuitemradio',{name:'已结束',exact:true}).waitFor({state:'hidden'});
      assert.equal(await page.getByRole('button',{name:'状态：done',exact:true}).evaluate(e=>e===document.activeElement),true);
      await page.getByRole('button',{name:'优先级：全部',exact:true}).click();
      await page.getByRole('menuitemcheckbox',{name:'高',exact:true}).click();await page.getByRole('menuitemcheckbox',{name:'低',exact:true}).click();
      assert.equal(await page.getByLabel('优先级结果',{exact:true}).textContent(),'high,low');
      assert.equal(await page.getByRole('menuitemcheckbox',{name:'高',exact:true}).getAttribute('aria-checked'),'true');
      await page.getByRole('button',{name:'关闭优先级菜单',exact:true}).first().click();
      await page.getByRole('button',{name:'创建人：done',exact:true}).click();
      await page.getByLabel('搜索创建人',{exact:true}).fill(' missing-member ');
      await page.getByText('没有匹配的选项',{exact:true}).waitFor();
      assert.equal(await page.getByLabel('状态结果',{exact:true}).textContent(),'done');
      await page.getByRole('button',{name:'使用准确昵称：missing-member',exact:true}).click();
      assert.equal(await page.getByLabel('状态结果',{exact:true}).textContent(),'missing-member');
      await page.getByRole('button',{name:'空候选：全部',exact:true}).click();
      await page.getByRole('button',{name:'重试',exact:true}).click();assert.equal(await page.evaluate(()=>window.retried),true);
      await page.getByLabel('搜索空候选',{exact:true}).fill('fallback-member');
      await page.getByRole('button',{name:'使用准确昵称：fallback-member',exact:true}).click();
      await page.getByRole('button',{name:'修改状态：全部',exact:true}).click();
      await page.getByRole('menuitemradio',{name:'全部',exact:true}).click();assert.equal(await page.evaluate(()=>window.submissions||0),0);
      await page.getByRole('menuitemradio',{name:'完成',exact:true}).dblclick();
      await page.getByText('修改失败，请重试',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.submissions),1);
      await page.getByRole('menuitemradio',{name:'完成',exact:true}).click();await page.getByRole('menuitemradio',{name:'完成',exact:true}).waitFor({state:'hidden'});
      assert.equal(await page.evaluate(()=>window.submissions),2);
      assert.equal(await page.getByRole('button',{name:'禁用：全部',exact:true}).isDisabled(),true);
      await page.getByRole('button',{name:'加载：全部',exact:true}).click();
      await page.getByText('正在加载…',{exact:true}).waitFor();
      assert.equal(await page.getByRole('menuitemradio',{name:'加载选项',exact:true}).isDisabled(),true);
      await page.keyboard.press('End');await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>window.loadingSelected||false),false);
      await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'加载选项',exact:true}).waitFor({state:'hidden'});
      await page.getByRole('button',{name:'边缘：全部',exact:true}).click();
      await page.getByRole('dialog',{name:'边缘选项',exact:true}).waitFor();
      const edgeBounds=await page.getByRole('dialog',{name:'边缘选项',exact:true}).evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};});
      assert.ok(edgeBounds.x>=16&&edgeBounds.y>=16&&edgeBounds.right<=1084&&edgeBounds.bottom<=784);
      await page.getByRole('button',{name:'关闭边缘菜单',exact:true}).first().click({position:{x:1,y:1}});
      await page.setViewportSize({width:390,height:600});
      await page.getByRole('button',{name:'创建人：fallback-member',exact:true}).click();
      await page.getByRole('dialog',{name:'创建人选项',exact:true}).waitFor();
      const bounds=await page.getByRole('dialog',{name:'创建人选项',exact:true}).evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};});
      assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.right<=390&&bounds.bottom<=600);
      for(let tab=0;tab<12;tab++){await page.keyboard.press('Tab');assert.notEqual(await page.evaluate(()=>document.activeElement.textContent),'外部按钮');}
      await page.keyboard.press('Escape');assert.deepEqual(errors,[]);
      console.log('PASS dropdown public interactions: single/multi, keyboard/focus, exact nickname, retry, current/no-op, failed write/double submit, disabled/loading, desktop/compact bounds');
    } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
  } finally {rmSync(temp,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
