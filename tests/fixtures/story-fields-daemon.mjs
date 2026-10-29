// Read-only public daemon fixture: external TAPD is synthetic and every write is rejected.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {settingsRpc} from '@getpaseo/plugin';
const pluginDir=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export async function runStoryFieldsDaemon(root,{documents=false}={}){
 assert.equal(await readFile(join(homedir(),'tapd-test-home-marker'),'utf8'),'isolated');
 const req=createRequire(join(process.env.PASEO_RUNTIME_DIR,'packages/cli/package.json')),load=name=>import(pathToFileURL(req.resolve(name)).href);
 const {createPaseoDaemon,BUILTIN_PROVIDER_IDS}=await load('@getpaseo/server'),{createHostClient}=await load('@getpaseo/client/node');
 const home=join(root,'home');await mkdir(home);await mkdir(join(root,'static'));process.env.PASEO_HOME=home;
 for(const key of ['TAPD_TOKEN','TAPD_API_ENDPOINT','TAPD_SITE_URL','TAPD_WORKSPACE_IDS'])delete process.env[key];
 const reads=[];let writes=0,failFields=false,failDocument=false,holdNext=false;
 const held=[];
 const initialDocumentValue='<h2>Example design</h2><p>Design introduction</p><ul><li>Readable list</li></ul><pre><code>const example = 1;</code></pre><table><tr>'+Array.from({length:5},(_,i)=>'<th>Column '+(i+1)+'</th>').join('')+'</tr><tr>'+Array.from({length:5},(_,i)=>'<td>Value '+(i+1)+'</td>').join('')+'</tr></table><img src="/tfl/captures/example.png" alt="Example diagram"><a href="https://example.com/read">Example safe link</a><a href="javascript:alert(1)">Unsafe link text</a><script>window.unsafeExecuted=true</script><style>body{display:none}</style>'+Array.from({length:50},(_,i)=>'<p>Design paragraph '+(i+1)+'</p>').join('');
 let documentValue=initialDocumentValue;
 const fields={custom_field_one:{label:'Example text',html_type:'text',readonly:1},custom_field_two:{label:'Example number',html_type:'integer'},custom_field_three:{label:'Example boolean',html_type:'boolean'},custom_field_four:{label:'Example choices',html_type:'multi_select',options:{a:'Alpha',b:'Beta'}},custom_field_five:{label:'Example people',html_type:'user_chooser'},custom_field_six:{label:'Example date',html_type:'dateinput'},custom_field_seven:{label:'Example extra',html_type:'text'},custom_field_empty:{label:'Example empty',html_type:'text'},custom_field_null:{label:'Example unknown',html_type:'text'},custom_field_missing:{label:'Example missing',html_type:'text'},custom_field_object:{label:'Example unrecognized',html_type:'text'},custom_field_document:{label:'Example document',html_type:'rich_edit'}};
 if(documents)Object.assign(fields,{
  custom_field_empty_report:{label:'Example empty report',html_type:'rich_edit'},custom_field_null_report:{label:'Example unknown report',html_type:'rich_text'},
  custom_field_absent_report:{label:'Example missing report',html_type:'rich_edit'},custom_field_malformed_report:{label:'Example malformed report',html_type:'rich_edit'},custom_field_other_report:{label:'Example second document',html_type:'rich_text'},
 });
 const tapd=createServer((request,response)=>{
  if(request.method!=='GET'){writes++;response.writeHead(403).end();return;}
  const url=new URL(request.url,'http://example.com');reads.push({path:url.pathname,query:Object.fromEntries(url.searchParams)});let data=[];
  if(documents&&url.pathname==='/tasks'&&url.searchParams.get('story_id')==='11111111'){
   data=Array.from({length:12},(_,index)=>({Task:{id:String(33333001+index),workspace_id:'12345678',story_id:'11111111',name:'Example child task '+(index+1),status:'open',owner:''}}));
  }else if(url.pathname==='/stories/get_fields_info'){
   if(failFields){response.writeHead(503).end();return;}
   data=url.searchParams.get('workitem_type_id')==='33333333'?{custom_field_one:{label:'Other category',html_type:'text'}}:fields;
  }else if(url.pathname==='/stories'&&url.searchParams.has('id')){
   const other=url.searchParams.get('id')==='22222222';
   const row={id:url.searchParams.get('id'),workspace_id:url.searchParams.get('workspace_id'),workitem_type_id:other?'33333333':'22222222',name:other?'Other requirement':documents?'Example requirement title for narrow reading with more context and a deliberately long description of the planned work':'Short fields requirement',status:'open',description:'<p>Base detail remains readable</p>',label:'',custom_field_one:other?'Other value':'Readonly short value',custom_field_two:0,custom_field_three:false,custom_field_four:['a','b'],custom_field_five:['example-member','example-other'],custom_field_six:'2026-01-02',custom_field_seven:'Seventh value',custom_field_empty:'',custom_field_null:null,custom_field_object:{unrecognized:true},custom_field_document:'<p>Unopened private document</p>'};
   if(documents)Object.assign(row,{description:'<p>Base detail remains readable</p>'+Array.from({length:25},(_,i)=>'<p>Detail paragraph '+(i+1)+'</p>').join(''),custom_field_document:documentValue,custom_field_empty_report:'',custom_field_null_report:null,custom_field_malformed_report:{unknown:true},custom_field_other_report:'<h2>Example report</h2>'+Array.from({length:40},(_,i)=>'<p>Report paragraph '+(i+1)+'</p>').join('')});
   const selected=url.searchParams.get('fields')?.split(',');
   if(selected?.includes('custom_field_document')&&failDocument){response.writeHead(503).end();return;}
   data=[{Story:selected?Object.fromEntries(Object.entries(row).filter(([key])=>selected.includes(key))):row}];
   if(selected?.includes('custom_field_document')&&holdNext){holdNext=false;held.push(()=>response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({status:1,data})));return;}
  }
  if(url.pathname==='/files/get_image'){response.writeHead(503).end();return;}
  response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({status:1,data}));
 });await new Promise(resolve=>tapd.listen(0,'127.0.0.1',resolve));
 const logger=req('pino')({level:'silent'}),daemon=await createPaseoDaemon({listen:'127.0.0.1:0',paseoHome:home,daemonVersion:'0.14.0-beta.1',staticDir:join(root,'static'),agentStoragePath:join(home,'agents'),corsAllowedOrigins:[],mcpDebug:false,mcpEnabled:false,relayEnabled:false,browserToolsEnabled:false,pluginsEnabled:true,plugins:{},agentClients:{},providerOverrides:Object.fromEntries(BUILTIN_PROVIDER_IDS.map(id=>[id,{enabled:false}])),skillSelection:{mode:'custom',skills:[]},metadataGeneration:{providers:[]},idleRuntimeCleanup:false,webUi:{enabled:false,distDir:null}},logger);
 let client,bridge;
 try{
  await daemon.start();const listen=daemon.getListenTarget();assert.equal(listen.type,'tcp');client=createHostClient(`127.0.0.1:${listen.port}`,{clientId:'example-short-fields',clientType:'cli',logger,reconnect:{enabled:false}});await client.connect();await client.installDirectoryPlugin(pluginDir);
  const rpc=(name,input={})=>client.invokePluginRpc('tapd-workbench',name,input),settings=settingsRpc('tapd-workbench-config'),previous=await rpc(settings.read.name);
  assert.equal((await rpc(settings.write.name,{revision:previous.revision,values:{...previous.values,token:'example-secret',workspaceIds:'12345678',apiEndpoint:`http://127.0.0.1:${tapd.address().port}`,siteUrl:'https://example.com'}})).status,'saved');
  let stop;const stopped=new Promise(resolve=>stop=resolve);
  bridge=createServer(async(request,response)=>{try{let raw='';for await(const chunk of request)raw+=chunk;const input=raw?JSON.parse(raw):{};let result;
   if(request.url==='/rpc')result=await rpc(input.name,input.input);
   else if(request.url==='/state')result={reads,writes,held:held.length};
   else if(request.url==='/scenario'){failFields=input.failFields===true;failDocument=input.failDocument===true;holdNext=input.holdNext===true;if(input.resetDocument)documentValue=initialDocumentValue;if(typeof input.documentValue==='string')documentValue=input.documentValue;result={ok:true};}
   else if(request.url==='/release'){for(const release of held.splice(0))release();result={ok:true};}
   else if(request.url==='/stop'){for(const release of held.splice(0))release();result={ok:true};stop();}
   else throw Error('Unavailable');response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(result));
  }catch{response.writeHead(400,{'content-type':'application/json'}).end(JSON.stringify({error:'Operation unavailable'}));}});
  await new Promise(resolve=>bridge.listen(0,'127.0.0.1',resolve));await writeFile(join(root,'ready.json'),JSON.stringify({port:bridge.address().port}));await stopped;assert.equal(writes,0);
 }finally{if(bridge)await new Promise(resolve=>bridge.close(resolve));await client?.close();await daemon.stop();await new Promise(resolve=>tapd.close(resolve));}
}
