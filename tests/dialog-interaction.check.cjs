// Public detail action with fake host RPCs; no TAPD requests or screenshots.
// Run with PASEO_APP_DIR pointing to an existing Paseo app checkout.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const http = require('node:http');

async function main() {
  assert.ok(process.env.PASEO_APP_DIR, 'Set PASEO_APP_DIR to a local Paseo app directory');
  const fromApp = createRequire(path.join(process.env.PASEO_APP_DIR, 'package.json'));
  const root = path.resolve(__dirname, '..');
  const temp = mkdtempSync(path.join(tmpdir(), 'tapd-dialogs-'));
  const conversation = process.env.TAPD_DIALOG_CONVERSATION === '1';
  const entry = `
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import {View,useWindowDimensions} from 'react-native';
    import {EntityResultCard} from ${JSON.stringify(path.join(root,'client/conversation/EntityResultCard.tsx'))};
    import {WorkbenchScreen} from ${JSON.stringify(path.join(root,'client/workbench/WorkbenchScreen.tsx'))};
    import {tapdSettingsSchema} from ${JSON.stringify(path.join(root,'shared/contracts.ts'))};
    window.detailFailure=${conversation};
    window.settings=tapdSettingsSchema.parse({workspaceIds:'12345678'});
    const light={surface0:'#ffffff',surface1:'#f8fafc',surface2:'#e2e8f0',border:'#cbd5e1',foreground:'#0f172a',foregroundMuted:'#475569',accent:'#2563eb',accentForeground:'#ffffff',statusSuccess:'#15803d',statusWarning:'#b45309',statusDanger:'#b91c1c'};
    const dark={...light,surface0:'#111827',surface1:'#1f2937',surface2:'#374151',border:'#4b5563',foreground:'#f9fafb',foregroundMuted:'#cbd5e1',accent:'#60a5fa',accentForeground:'#111827'};
    function App(){const {width}=useWindowDimensions();const [night,setNight]=useState(false);window.setNight=()=>setNight(true);return <View style={{flex:1}}>${conversation ? `<EntityResultCard theme={{colors:night?dark:light}} layout={{compact:width<768}} host={{id:'example-host',label:'Example'}} agentId='example-agent' timestamp={new Date()} item={{type:'plugin',kind:'tapd-entity-result',version:1,data:{operation:'read',entity:{kind:'story',id:'12345678',workspaceId:'12345678',siteUrl:'https://example.com',apiEndpoint:'https://api.example.com',title:'示例需求',status:'open',statusLabel:'待处理',owner:'example-member'},warnings:['部分评论读取失败，请在详情中重试。']}}}/>` : `<WorkbenchScreen theme={{colors:night?dark:light}} layout={{compact:width<768}} navigation={{}}/>`}</View>;}
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><App/></QueryClientProvider>);
  `;
  writeFileSync(path.join(temp,'host.tsx'), `
    import React from 'react';
    import {View,Text} from 'react-native';
    export {TextInput,ScrollView,FlatList} from 'react-native';
    export function defineRpc(x){return x;}export function defineSettings(x){return x;}export function defineAttachmentSource(x){return x;}
    export const Icon=()=>null;export const useToast=()=>({show:text=>{window.toast=text;},error:text=>{window.toast=text;}});
    export const copyText=async()=>{};export const openExternalUrl=async url=>{window.openedUrls=(window.openedUrls||[]).concat(url);};
    const sdk={agents:{subscribe:()=>()=>{},list:async()=>({entries:[]})},projects:{list:async()=>({projects:[]})},providers:{snapshot:async()=>({entries:[]})}};
    export const usePaseo=()=>sdk;
    export const useSettings=()=>({status:'ready',values:window.settings,revision:1,save:async values=>{window.settings=values;return true;},reset:async()=>{},reload:async()=>{}});
    const Setting=({children,title,label})=><View><Text>{title||label||''}</Text>{children}</View>;
    export const SettingsAction=Setting,SettingsCard=Setting,SettingsInput=Setting,SettingsRow=Setting,SettingsSection=Setting,SettingsSwitch=Setting;
    const html='<h2>阅读标题</h2><p>完整段落 <strong>重点文字</strong> 与 <a href="https://example.com/help">参考链接</a></p><ul><li>第一条要求</li></ul><pre><code>sample code</code><img src="/image.png" alt="代码旁图片"></pre><table><tr><th>字段</th><td><p>示例值</p><p>第二行<img src="/image.png" alt="表格图片"></p></td></tr></table><p><img src="/tfl/captures/example.png" alt="受保护图片"></p><p>图片前文 <strong>重点在前<img src="/image.png" alt="示例图片">重点在后</strong> 图片后文</p><p><a href="/retry-image.png"><img src="/retry-image.png" alt="重试图片"></a></p><script>不应显示的脚本</script>'+('<p>较长正文用于验证阅读位置和完整内容。</p>'.repeat(80))+'<p>最末尾完整描述</p>';
    const item={kind:'story',id:'12345678',workspaceId:'12345678',title:'示例需求',url:window.location.origin+'/project/item',status:'open',statusLabel:'待处理',owner:'example-member',creator:'example-creator',priority:'高',iterationName:'示例迭代',createdAt:'2026-01-01',modifiedAt:'2026-01-02',modified:'2026-01-02',done:false,description:'plain snapshot',descriptionHtml:html,comments:[{id:'11111111',author:'example-member',createdAt:'2026-01-02',text:'示例评论',html:'<p>示例评论</p><p><img src="/image.png" alt="评论图片"><img src="/tfl/captures/example.png" alt="受保护评论图片"></p>'}],commentsError:null,childTasks:[],childBugs:[],childTasksTotal:0,childBugsTotal:0,parentStory:null};
    export const useRpc=rpc=>async input=>{
      window.calls=(window.calls||[]).concat({name:rpc.name,input});
      if(rpc.name==='tapd.conversation.focus')return {ok:true};
      if(rpc.name==='tapd.image'){window.imageAttempts=(window.imageAttempts||0)+1;if(window.imageAttempts===1)throw new Error('untrusted image service response');if(input.workspaceId!=='12345678'||input.imagePath!=='/tfl/captures/example.png')throw new Error('Invalid image project/path');return await (await fetch('/fixture-image-data')).json();}
      if(rpc.name==='tapd.board')return {fetchedAt:'2026-01-02',stale:false,me:{nick:'example-member'},columns:{story:{items:[item],total:1,truncated:false,error:null},task:{items:[],total:0,error:null},bug:{items:[],total:0,error:null}}};
      if(rpc.name==='tapd.filter_options')return {iterations:[],priorities:[{value:'high',label:'高',kinds:['story','task','bug']}],severities:[],statuses:{story:[{value:'open',label:'待处理'}],task:[],bug:[]}};
      if(rpc.name==='tapd.update_check')return {updateAvailable:false};
      if(rpc.name==='tapd.entity'&&window.detailFailure)throw new Error('untrusted private failure');
      if(rpc.name==='tapd.entity'&&input.siteUrl&&(input.siteUrl!=='https://example.com'||input.apiEndpoint!=='https://api.example.com'||input.workspaceId!=='12345678'))throw new Error('wrong reference');
      if(rpc.name==='tapd.entity')return {...item,kind:input.kind,id:input.id,title:input.kind==='story'?'示例需求':'新建示例任务'};
      if(rpc.name==='tapd.create_fields')return {me:'example-member',fields:[{key:'custom_text',label:'扩展文本',required:false,inputKind:'text',single:true,options:[]}]};
      if(rpc.name==='tapd.create'){if(!window.createRetried){window.createRetried=true;throw new Error('模拟创建失败');}return {kind:input.kind,id:'87654321',url:'https://example.com/new'};}
      if(rpc.name==='tapd.add_comment'){if(!window.commentRetried){window.commentRetried=true;throw new Error('模拟评论失败');}return {ok:true};}
      if(rpc.name==='tapd.agent_status')return {items:[]};
      if(rpc.name==='tapd.status_options')return {options:[{value:'open',label:'待处理'}]};
      throw new Error('Unexpected RPC '+rpc.name);
    };
  `);
  try {
    const host = path.join(temp, 'host.tsx');
    const result = fromApp('esbuild').buildSync({stdin:{contents:entry,loader:'tsx',resolveDir:root},bundle:true,write:false,define:{'process.env.NODE_ENV':'"development"'},alias:{react:fromApp.resolve('react'),'react/jsx-runtime':fromApp.resolve('react/jsx-runtime'),'react-dom/client':fromApp.resolve('react-dom/client'),'react-dom':fromApp.resolve('react-dom'),'react-native':fromApp.resolve('react-native-web'),'@getpaseo/plugin':host,'@getpaseo/plugin/client':host,'@getpaseo/plugin/client/react-native':host,'@getpaseo/plugin/client/ui':host},logLevel:'silent'});
    const script = result.outputFiles[0].text;
    let allowImageRetry=false, imageAuthHeaderSeen=false, releaseImages;
    const imagesReady=new Promise(resolve=>{releaseImages=resolve;});
    const server = http.createServer(async(req,res)=>{
      if(req.url==='/fixture-image-data'){res.setHeader('content-type','application/json');res.end(JSON.stringify({dataUri:'data:image/png;base64,'+readFileSync(path.join(root,'assets/icon.png')).toString('base64')}));return;}
      if(req.url==='/allow-image-load'){releaseImages();res.end('ok');return;}
      if(req.url==='/allow-image-retry'){allowImageRetry=true;res.end('ok');return;}
      if(req.url==='/image.png'||req.url==='/retry-image.png'){
        imageAuthHeaderSeen=imageAuthHeaderSeen||!!req.headers.authorization;
        if(req.url==='/image.png')await imagesReady;
        res.setHeader('cache-control','no-store');
        if(req.url==='/retry-image.png'&&!allowImageRetry){res.statusCode=503;res.end();return;}
        res.setHeader('content-type','image/png');res.end(readFileSync(path.join(root,'assets/icon.png')));return;
      }
      res.setHeader('content-type',req.url==='/app.js'?'text/javascript':'text/html');
      res.end(req.url==='/app.js'?script:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}#root{display:flex}</style><div id="root"></div><script src="/app.js"></script>');
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    let browser;
    try {
      browser = await fromApp('@playwright/test').chromium.launch({headless:true,args:['--no-sandbox']});
      const page = await browser.newPage({viewport:{width:1440,height:900}});
      page.setDefaultTimeout(8000);
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      const remote=[];page.on('request',req=>{if(!req.url().startsWith('http://127.0.0.1:'))remote.push(req.url());});
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const calls=name=>page.evaluate(name=>(window.calls||[]).filter(call=>call.name===name),name);
      if (conversation) {
        assert.equal((await calls('tapd.entity')).length,0,'card rendering must not fetch detail');
        await page.getByText('查询时的摘要 · 打开查看最新详情',{exact:true}).waitFor();
        await page.getByText('部分评论读取失败，请在详情中重试。',{exact:true}).waitFor();
        await page.getByRole('button',{name:'打开 TAPD 需求 #12345678：示例需求',exact:true}).focus();
        await page.keyboard.press('Enter');
      } else
      await page.getByText('示例需求',{exact:true}).click();
      const detail=page.getByRole('dialog',{name:'#12345678 · 单据详情',exact:true});
      if(conversation){
        await detail.getByRole('button',{name:'重试加载单据',exact:true}).waitFor();
        assert.equal(await detail.getByText('untrusted private failure',{exact:true}).count(),0);
        await page.evaluate(()=>{window.detailFailure=false;});
        await detail.getByRole('button',{name:'重试加载单据',exact:true}).click();
      }
      await detail.getByRole('heading',{name:'阅读标题',exact:true}).waitFor();
      assert.equal(await page.getByRole('dialog').count(),1);
      assert.equal(await detail.getByRole('img',{name:'示例图片',exact:true}).count(),1,'description must contain an inline image, not only a text link');
      await detail.getByRole('img',{name:'示例图片',exact:true}).waitFor();
      await detail.getByText('图片加载中…',{exact:true}).first().waitFor();
      await page.evaluate(()=>fetch('/allow-image-load'));
      await page.waitForFunction(()=>document.querySelector('[aria-label="示例图片"] img')?.naturalWidth>0);
      await detail.getByText('图片加载中…',{exact:true}).first().waitFor({state:'hidden'});
      await detail.getByRole('button',{name:'重试加载图片：受保护图片',exact:true}).click();
      for(const name of ['受保护图片','受保护评论图片'])await detail.getByRole('img',{name,exact:true}).waitFor();
      assert.equal((await calls('tapd.image')).length,2,'description/comment share one failed read and one retry');
      assert.equal(await detail.getByText('untrusted image service response',{exact:true}).count(),0);
      const imageBox=await detail.getByRole('img',{name:'示例图片',exact:true}).boundingBox();
      assert.ok(imageBox.width>0&&imageBox.width<=760&&imageBox.height>0);
      for(const name of ['评论图片','表格图片','代码旁图片']) assert.equal(await detail.getByRole('img',{name,exact:true}).count(),1,'all supported content containers share inline images');
      const intrinsic=await page.evaluate(()=>{const image=document.querySelector('[aria-label="示例图片"] img');return {width:image.naturalWidth,height:image.naturalHeight};});
      assert.ok(Math.abs(imageBox.width/imageBox.height-intrinsic.width/intrinsic.height)<0.02, JSON.stringify({imageBox,intrinsic}));
      await detail.getByText('图片加载失败',{exact:true}).waitFor();
      await page.evaluate(()=>fetch('/allow-image-retry'));
      await detail.getByRole('button',{name:'重试加载图片：重试图片',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('[aria-label="重试图片"] img')?.naturalWidth>0);
      await detail.getByText('图片加载失败',{exact:true}).waitFor({state:'hidden'});
      const imageOrder=await detail.getByRole('img',{name:'示例图片',exact:true}).evaluate(image=>{
        const before=[...document.querySelectorAll('*')].find(e=>e.childNodes.length===1&&e.firstChild.nodeType===3&&e.textContent==='重点在前');
        const after=[...document.querySelectorAll('*')].find(e=>e.childNodes.length===1&&e.firstChild.nodeType===3&&e.textContent==='重点在后');
        return {before:!!(before.compareDocumentPosition(image)&Node.DOCUMENT_POSITION_FOLLOWING),after:!!(image.compareDocumentPosition(after)&Node.DOCUMENT_POSITION_FOLLOWING)};
      });
      assert.deepEqual(imageOrder,{before:true,after:true});

      const panel=await page.getByTestId('workbench-dialog-panel').boundingBox();
      const close=detail.getByRole('button',{name:'关闭#12345678 · 单据详情',exact:true}).last();
      await close.focus();
      assert.equal(await close.evaluate(e=>getComputedStyle(e).borderTopColor),'rgb(37, 99, 235)');
      assert.equal(panel.width,1040);assert.ok(panel.y>=24&&panel.y+panel.height<=876);
      assert.equal(await page.getByText('不应显示的脚本',{exact:true}).count(),0);
      await detail.getByRole('link',{name:'参考链接',exact:true}).focus();
      assert.equal(await detail.getByRole('link',{name:'参考链接',exact:true}).evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(226, 232, 240)');
      await page.keyboard.press('Enter');
      await page.waitForFunction(()=>window.openedUrls?.length===1);
      await detail.getByRole('link',{name:/示例图片/}).focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(()=>window.openedUrls?.length===2);
      await detail.getByRole('link',{name:/示例图片/}).click();
      assert.deepEqual(await page.evaluate(()=>window.openedUrls),['https://example.com/help',new URL('/image.png',page.url()).href,new URL('/image.png',page.url()).href]);
      assert.deepEqual(remote,[]);
      const body=detail.getByText('最末尾完整描述',{exact:true});await body.waitFor();
      const scrollTop=await body.evaluate(e=>{let p=e.parentElement;while(p&&p.scrollHeight<=p.clientHeight+1)p=p.parentElement;p.scrollTop=220;p.dispatchEvent(new Event('scroll'));return p.scrollTop;});
      assert.ok(scrollTop>0);
      await detail.getByRole('button',{name:'创建该需求下的任务',exact:true}).evaluate(e=>e.click());
      const create=page.getByRole('dialog',{name:'新建单据',exact:true});await create.waitFor();
      assert.equal(await page.getByRole('dialog').count(),1);
      for(const name of ['基本信息','处理安排','扩展字段'])await create.getByRole('heading',{name,exact:true}).waitFor();
      const ownerBounds=await create.getByLabel('处理人',{exact:true}).boundingBox();
      const titleBounds=await create.getByLabel('标题（必填）',{exact:true}).boundingBox();
      assert.ok(ownerBounds.width<titleBounds.width*0.7);
      await create.getByLabel('标题（必填）',{exact:true}).fill('未提交草稿');
      await create.getByRole('button',{name:'返回详情',exact:true}).click();
      await create.getByText('放弃尚未提交的内容？',{exact:true}).waitFor();
      await create.getByRole('button',{name:'继续编辑',exact:true}).click();
      assert.equal(await create.getByLabel('标题（必填）',{exact:true}).inputValue(),'未提交草稿');
      await page.keyboard.press('Escape');
      await create.getByRole('button',{name:'放弃修改',exact:true}).click();
      await detail.waitFor();
      const restored=await detail.getByText('最末尾完整描述',{exact:true}).evaluate(e=>{let p=e.parentElement;while(p&&p.scrollHeight<=p.clientHeight+1)p=p.parentElement;return p.scrollTop;});
      assert.ok(Math.abs(restored-scrollTop)<4,`restored ${restored}, expected ${scrollTop}`);
      await detail.getByRole('button',{name:'写回评论',exact:true}).click();
      const comment=page.getByRole('dialog',{name:'写回评论 · #12345678',exact:true});await comment.waitFor();
      await comment.getByPlaceholder('输入要写回 TAPD 的内容（纯文本，自动转 HTML）').fill('示例新评论');
      await page.keyboard.press('Escape');await comment.getByRole('button',{name:'继续编辑',exact:true}).click();
      await comment.getByRole('button',{name:'提交',exact:true}).click();
      assert.equal(await page.evaluate(()=>window.toast),'模拟评论失败');
      await comment.getByRole('button',{name:'提交',exact:true}).click();await detail.waitFor();
      assert.equal((await calls('tapd.add_comment')).at(-1).input.workspaceId,'12345678');
      for(const action of ['派给 Agent','绑定 Agent']){
        await detail.getByRole('button',{name:action,exact:true}).click();
        await page.getByRole('button',{name:'返回详情',exact:true}).click();await detail.waitFor();
      }
      await detail.getByRole('button',{name:'创建该需求下的任务',exact:true}).click();
      await create.getByRole('button',{name:'返回详情',exact:true}).click();await detail.waitFor();
      await detail.getByRole('button',{name:'创建该需求下的任务',exact:true}).click();
      await create.getByLabel('标题（必填）',{exact:true}).fill('新建示例任务');
      await create.getByRole('button',{name:'创建',exact:true}).click();
      assert.equal(await page.evaluate(()=>window.toast),'模拟创建失败');
      await create.getByRole('button',{name:'创建',exact:true}).click();
      await page.getByRole('dialog',{name:'#87654321 · 单据详情',exact:true}).waitFor();
      const created=(await calls('tapd.create')).at(-1).input;assert.equal(created.storyId,'12345678');assert.equal(created.workspaceId,'12345678');
      await page.setViewportSize({width:390,height:680});await page.evaluate(()=>window.setNight());
      const compact=await page.getByTestId('workbench-dialog-panel').boundingBox();assert.ok(compact.x>=8&&compact.x+compact.width<=382&&compact.y>=8&&compact.y+compact.height<=672);
      const narrowImage=await page.getByRole('img',{name:'示例图片',exact:true}).boundingBox();
      assert.ok(narrowImage.x>=0&&narrowImage.x+narrowImage.width<=390);
      assert.equal(imageAuthHeaderSeen,false);
      assert.deepEqual(remote,[]);assert.deepEqual(errors,[]);
      await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
      if (conversation) await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='打开 TAPD 需求 #12345678：示例需求');
      if (conversation) {
        await page.getByRole('button',{name:'打开 TAPD 需求 #12345678：示例需求',exact:true}).focus();
        await page.keyboard.press('Enter');
        await detail.getByRole('button',{name:'创建该需求下的任务',exact:true}).click();
      } else await page.getByRole('button',{name:'新建',exact:true}).click();
      const narrowTitle=await create.getByLabel('标题（必填）',{exact:true}).boundingBox();
      const narrowOwner=await create.getByLabel('处理人',{exact:true}).boundingBox();
      assert.ok(Math.abs(narrowTitle.width-narrowOwner.width)<2);
      await page.keyboard.press('Escape');
      if (conversation) { await detail.waitFor(); await page.keyboard.press('Escape'); }
      await page.getByRole('dialog').waitFor({state:'hidden'});
      console.log('PASS workbench dialog consumer: complete structured reading, inline image load/error/retry/order/size and original-link keyboard activation, desktop/compact dark bounds, single visible page, return scroll, discard/continue, create/comment error retry, project semantics, dispatch/bind return, Escape');
    } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
  } finally {rmSync(temp,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
