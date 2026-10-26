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
  const temp = mkdtempSync(path.join(tmpdir(), 'tapd-filter-'));
  const entry = `
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {View,Text,Pressable} from 'react-native';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import {FilterBar} from ${JSON.stringify(path.join(root, 'client/workbench/FilterBar.tsx'))};
    import {ColumnPickerModal} from ${JSON.stringify(path.join(root, 'client/workbench/ColumnPickerModal.tsx'))};
    import {DEFAULT_FILTERS} from ${JSON.stringify(path.join(root, 'shared/contracts.ts'))};
    const theme={colors:{surface0:'#fff',surface1:'#f8fafc',surface2:'#e2e8f0',border:'#cbd5e1',foreground:'#0f172a',foregroundMuted:'#475569',accent:'#2563eb',accentForeground:'#fff',statusDanger:'#b91c1c'}};
    function App(){
      const [columns,setColumns]=useState(null),[pickerOpen,setPickerOpen]=useState(false);
      const [filters,setFilters]=useState({...DEFAULT_FILTERS,ownerMode:'related'});
      return <View style={{padding:24,gap:8}}>
        <FilterBar theme={theme} filters={filters} onChange={patch=>setFilters(current=>({...current,...patch}))} onReset={()=>setFilters({...DEFAULT_FILTERS,ownerMode:'related'})}/>
        <Pressable accessibilityRole="button" onPress={()=>setPickerOpen(true)}><Text>选择状态列</Text></Pressable>
        <ColumnPickerModal open={pickerOpen} onClose={()=>setPickerOpen(false)} theme={theme} kind="story" statuses={[{value:'open',label:'待处理'},{value:'done',label:'已完成'}]} counts={{open:1}} current={columns} onSave={value=>{setColumns(value);setPickerOpen(false);}}/>
        <Text accessibilityLabel="列选择结果">{JSON.stringify(columns)}</Text>
        <Text accessibilityLabel="筛选结果">{JSON.stringify(filters)}</Text>
        <Pressable accessibilityRole="button" onPress={()=>setFilters({...DEFAULT_FILTERS,statusScope:'active',iterationId:'saved-iteration',ownerMode:'custom',owner:'saved-owner',creator:'saved-creator',priorities:['saved-priority']})}><Text>切换已保存视图</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={()=>setFilters({...DEFAULT_FILTERS,ownerMode:'custom',owner:'saved-member',creator:'saved-member'})}><Text>切换同成员视图</Text></Pressable>
      </View>;
    }
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><App/></QueryClientProvider>);
  `;
  writeFileSync(path.join(temp, 'sdk.tsx'), `
    import React from 'react';
    import {View,Text,Pressable} from 'react-native';
    export {TextInput,ScrollView,FlatList} from 'react-native';
    export const Icon=()=>null;
    export function Modal({open,title,children,onOpenChange}) {return open?<View accessibilityRole="dialog" accessibilityLabel={title}><Text>{title}</Text>{children}<Pressable accessibilityRole="button" onPress={()=>onOpenChange(false)}><Text>关闭条件编辑器</Text></Pressable></View>:null;}
    Modal.Content=({children})=><View>{children}</View>;
  `);
  writeFileSync(path.join(temp, 'rpc.ts'), `
    export const defineRpc=x=>x,defineSettings=x=>x,defineAttachmentSource=x=>x;
    const methods={
      'tapd.filter_options':async()=>({iterations:[{id:'iteration-one',name:'示例迭代',status:'open'}],priorities:[{value:'high',label:'高',kinds:['story']},{value:'low',label:'低',kinds:['task']}],severities:[{value:'major',label:'严重'},{value:'minor',label:'轻微'}],statuses:{story:[],task:[],bug:[]}}),
      'tapd.members':async()=>{window.memberRequests=(window.memberRequests||0)+1;return {members:[{value:'sample-member',label:'sample-member'}],error:window.memberRequests===1?'部分项目的人员候选读取失败，请重试；仍可输入准确昵称。':null};},
      'tapd.filter_fields':async()=>{window.fieldRequests=(window.fieldRequests||0)+1;if(!window.allowFields)throw new Error('untrusted upstream response');return {fields:[{key:'status',label:'需求状态',kind:'enum',single:false,kinds:['story'],options:[{value:'developing',label:'开发中'}]}]};},
    };
    export const useRpc=rpc=>methods[rpc.name];
  `);
  try {
    const result = fromApp('esbuild').buildSync({stdin:{contents:entry,loader:'tsx',resolveDir:root},bundle:true,write:false,define:{'process.env.NODE_ENV':'"development"'},alias:{'@getpaseo/plugin/client':path.join(temp,'rpc.ts'),'@getpaseo/plugin':path.join(temp,'rpc.ts'),react:fromApp.resolve('react'),'react/jsx-runtime':fromApp.resolve('react/jsx-runtime'),'react-dom/client':fromApp.resolve('react-dom/client'),'react-dom':fromApp.resolve('react-dom'),'react-native':fromApp.resolve('react-native-web'),'@getpaseo/plugin/client/react-native':path.join(temp,'sdk.tsx')},logLevel:'silent'});
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
      assert.equal(await page.evaluate(()=>window.memberRequests||0),0);
      for (const name of ['状态：全部','迭代：全部','更新时间：不限','处理人：我相关的','创建人：全部','优先级：全部']) {
        await page.getByRole('button',{name,exact:true}).waitFor();
      }
      await page.getByRole('button',{name:'状态：全部',exact:true}).click();
      await page.getByRole('menuitemradio',{name:'未结束',exact:true}).click();
      const result=()=>page.getByLabel('筛选结果',{exact:true}).textContent().then(JSON.parse);
      assert.equal((await result()).statusScope,'active');
      assert.equal(await page.getByRole('menuitemradio',{name:'未结束',exact:true}).count(),0);
      await page.getByRole('button',{name:'迭代：全部',exact:true}).click();
      await page.getByRole('menuitemradio',{name:'示例迭代',exact:true}).click();
      await page.getByRole('button',{name:'更新时间：不限',exact:true}).click();
      await page.getByRole('menuitemradio',{name:'近 7 天',exact:true}).click();
      await page.getByRole('button',{name:'创建人：全部',exact:true}).click();
      await page.getByText('部分项目的人员候选读取失败，请重试；仍可输入准确昵称。',{exact:true}).waitFor();
      await page.getByLabel('搜索创建人',{exact:true}).fill(' missing-member ');
      assert.equal((await result()).creator,'');
      await page.getByRole('button',{name:'使用准确昵称：missing-member',exact:true}).click();
      assert.equal((await result()).creator,'missing-member');
      await page.getByRole('button',{name:'创建人：missing-member',exact:true}).click();
      await page.getByRole('button',{name:'重试',exact:true}).click();
      await page.getByText('部分项目的人员候选读取失败，请重试；仍可输入准确昵称。',{exact:true}).waitFor({state:'hidden'});
      await page.getByRole('menuitemradio',{name:'sample-member',exact:true}).click();
      await page.getByRole('button',{name:'处理人：我相关的',exact:true}).click();
      await page.getByRole('menuitemradio',{name:'我处理的',exact:true}).click();
      await page.getByRole('button',{name:'优先级：全部',exact:true}).click();
      await page.getByRole('menuitemcheckbox',{name:'高',exact:true}).click();
      await page.getByRole('menuitemcheckbox',{name:'低',exact:true}).click();
      assert.equal(await page.getByRole('menuitemcheckbox',{name:'高',exact:true}).getAttribute('aria-checked'),'true');
      await page.keyboard.press('Escape');
      const {statusScope,iterationId,modifiedWithinDays,creator,ownerMode,priorities}=await result();
      assert.deepEqual({statusScope,iterationId,modifiedWithinDays,creator,ownerMode,priorities},{statusScope:'active',iterationId:'iteration-one',modifiedWithinDays:7,creator:'sample-member',ownerMode:'mine',priorities:['high','low']});
      assert.equal(await page.evaluate(()=>window.memberRequests),2);
      assert.equal(await page.getByRole('button',{name:/更多筛选/}).count(),0);
      await page.getByLabel('关键词',{exact:true}).fill('示例关键词');
      await page.waitForFunction(()=>JSON.parse(document.querySelector('[aria-label="筛选结果"]').textContent).keyword==='示例关键词');
      await page.getByLabel('标签',{exact:true}).fill('example-label');
      await page.waitForFunction(()=>JSON.parse(document.querySelector('[aria-label="筛选结果"]').textContent).label==='example-label');
      await page.getByRole('button',{name:'严重程度：全部',exact:true}).click();
      await page.getByRole('menuitemcheckbox',{name:'严重',exact:true}).click();
      await page.getByRole('menuitemcheckbox',{name:'轻微',exact:true}).click();
      assert.deepEqual((await result()).severities,['major','minor']);
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(()=>window.fieldRequests||0),0);
      await page.getByRole('button',{name:'添加条件',exact:true}).click();
      await page.getByText('字段加载失败，请重试。',{exact:true}).waitFor();
      await page.evaluate(()=>window.allowFields=true);
      await page.getByRole('button',{name:'重试',exact:true}).click();
      await page.getByText('需求状态',{exact:true}).click();
      await page.getByText('开发中（developing）',{exact:true}).click();
      await page.getByText('确定',{exact:true}).click();
      assert.deepEqual((await result()).conditions,[{field:'status',label:'需求状态',kind:'enum',kinds:['story'],values:['developing'],from:'',to:''}]);
      await page.getByText('需求状态：developing',{exact:true}).waitFor();
      await page.getByRole('button',{name:'移除需求状态条件',exact:true}).click();
      assert.deepEqual((await result()).conditions,[]);
      await page.getByRole('button',{name:'切换已保存视图',exact:true}).click();
      assert.equal(await page.getByLabel('关键词',{exact:true}).inputValue(),'');
      assert.equal(await page.getByLabel('标签',{exact:true}).inputValue(),'');
      for(const name of ['状态：未结束','迭代：saved-iteration','处理人：saved-owner','创建人：saved-creator','优先级：saved-priority']) await page.getByRole('button',{name,exact:true}).waitFor();
      for(const [name,option,role] of [['迭代：saved-iteration','saved-iteration','menuitemradio'],['创建人：saved-creator','saved-creator','menuitemradio'],['处理人：saved-owner','saved-owner','menuitemradio'],['优先级：saved-priority','saved-priority','menuitemcheckbox']]) {
        await page.getByRole('button',{name,exact:true}).click();
        assert.equal(await page.getByRole(role,{name:option,exact:true}).getAttribute('aria-checked'),'true');
        await page.keyboard.press('Escape');
      }
      await page.getByRole('button',{name:'处理人：saved-owner',exact:true}).click();
      await page.getByRole('menuitemradio',{name:'全部人',exact:true}).click();
      assert.equal((await result()).ownerMode,'all');
      await page.getByRole('button',{name:'处理人：全部人',exact:true}).click();
      await page.getByRole('menuitemradio',{name:'sample-member',exact:true}).click();
      assert.equal((await result()).ownerMode,'custom');
      assert.equal((await result()).owner,'sample-member');
      await page.getByRole('button',{name:'处理人：sample-member',exact:true}).click();
      await page.getByLabel('搜索处理人',{exact:true}).fill(' owner-fallback ');
      await page.getByRole('button',{name:'使用准确昵称：owner-fallback',exact:true}).click();
      assert.equal((await result()).owner,'owner-fallback');
      assert.equal((await result()).ownerMode,'custom');
      await page.getByRole('button',{name:'优先级：saved-priority',exact:true}).click();
      await page.getByRole('menuitemcheckbox',{name:'全部',exact:true}).click();
      assert.deepEqual((await result()).priorities,[]);
      await page.keyboard.press('Escape');
      await page.getByRole('button',{name:'切换同成员视图',exact:true}).click();
      await page.getByRole('button',{name:'创建人：saved-member',exact:true}).click();
      await page.getByRole('dialog',{name:'创建人选项',exact:true}).waitFor();
      assert.equal(await page.getByRole('menuitemradio',{name:'saved-member',exact:true}).count(),1);
      await page.keyboard.press('Escape');
      await page.getByRole('button',{name:'重置',exact:true}).click();
      assert.equal((await result()).ownerMode,'related');
      assert.equal((await result()).statusScope,'all');
      assert.equal((await result()).iterationId,'');
      assert.equal((await result()).creator,'');
      assert.deepEqual((await result()).conditions,[]);
      await page.getByRole('button',{name:'处理人：我相关的',exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>window.memberRequests),2);
      await page.setViewportSize({width:390,height:650});
      const controls=await page.getByRole('button',{name:/^(状态|迭代|更新时间|处理人|创建人|优先级|严重程度)：/}).all();
      assert.equal(controls.length,7);
      for(const control of controls) {
        const box=await control.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=390);
      }
      await page.getByRole('button',{name:'处理人：我相关的',exact:true}).click();
      const box=await page.getByRole('dialog',{name:'处理人选项',exact:true}).boundingBox();
      assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=390&&box.y+box.height<=650);
      await page.keyboard.press('Escape');
      await page.getByRole('button',{name:'选择状态列',exact:true}).click();
      await page.getByRole('checkbox',{name:'待处理',exact:true,checked:true}).waitFor();
      await page.getByRole('checkbox',{name:'已完成',exact:true,checked:false}).waitFor();
      await page.getByRole('checkbox',{name:'已完成',exact:true}).click();
      await page.getByText('保存',{exact:true}).click();
      assert.deepEqual(JSON.parse(await page.getByLabel('列选择结果',{exact:true}).textContent()),['open','done']);
      await page.getByRole('button',{name:'选择状态列',exact:true}).click();
      await page.getByRole('checkbox',{name:'已完成',exact:true,checked:true}).waitFor();
      await page.getByText('恢复默认（隐藏空列）',{exact:true}).click();
      assert.equal(await page.getByLabel('列选择结果',{exact:true}).textContent(),'null');
      await page.getByRole('button',{name:'选择状态列',exact:true}).click();
      await page.getByRole('checkbox',{name:'已完成',exact:true,checked:false}).waitFor();
      await page.getByRole('button',{name:'关闭条件编辑器',exact:true}).click();
      assert.deepEqual(errors,[]);
      console.log('PASS inline FilterBar public interactions: all filters visible, seven dropdowns, combined immediate filters, lazy shared members/retry/exact nickname, owner modes, multi-select, saved values/reset, inline keyword/label/severity/advanced workflow state, mobile wrapping, column defaults/explicit selection/reset');
    } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
  } finally {rmSync(temp,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
