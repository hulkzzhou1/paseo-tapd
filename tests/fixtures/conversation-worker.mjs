// Separate Node process, real plugin entrypoint, synthetic public SDK and TAPD.
import { registerHooks } from 'node:module';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/.test(s))return n(s+'.ts',c);throw e;}}});
const {default:contribute}=await import('../../index.server.ts');
const {tapdSettingsSchema}=await import('../../shared/contracts.ts');
const values=tapdSettingsSchema.parse({token:'example-secret',workspaceIds:'12345678',siteUrl:'https://example.com',apiEndpoint:'https://api.example.com'});
let reads=0;const rows=[];
globalThis.fetch=async source=>{reads++;const u=new URL(source);return Response.json({status:1,data:u.pathname==='/stories'&&u.searchParams.has('id')?[{Story:{id:u.searchParams.get('id'),name:'示例需求',status:'open',description:'不应持久化的正文'}}]:[]});};
const handle={address:{serverId:'example-host',agentId:'example-agent'},workspaceId:'example-workspace',refresh:async()=>({agent:{id:'example-agent',workspaceId:'example-workspace'}}),timeline:{append:async item=>{rows.push({...item,pluginId:'tapd-workbench'});return {seq:rows.length,epoch:'example-epoch'};},refetch:async()=>({entries:rows.map(item=>({item})),hasOlder:false,hasNewer:false,epoch:'example-epoch'})}};
const paseo={agents:{ref:()=>handle,list:async()=>({entries:[],pageInfo:{hasMore:false},subscription:{ready:Promise.resolve(),subscribe:()=>()=>{},release:async()=>{}}})}};
const rpcs=new Map(),hooks=new Map();const close=contribute({registerSettings:()=>({read:async()=>({status:'ready',values}),subscribe:()=>()=>{}}),handle:(rpc,fn)=>rpcs.set(rpc.name,fn),before:(name,fn)=>hooks.set(name,fn),on(){}});
const context={paseo,signal:new AbortController().signal};
try{
 if(process.argv[2]==='seed'){
  const {tools}=await hooks.get('agent.session_open')({request:{purpose:'interactive',agentId:'example-agent',tools:[],env:{}}},context);
  await tools.find(t=>t.name==='tapd_entity').execute({kind:'story',id:'11111111'},{...context,agent:{id:'example-agent'}});
  const entity=(await rpcs.get('tapd.conversations')({},context)).conversations[0].entities[0];
  await rpcs.get('tapd.conversation.remove')({agentId:'example-agent',entity},context);
  await writeFile(join(process.env.PASEO_HOME,'plugin-data/tapd-workbench/conversations.json.interrupted.tmp'),'{"version":');
 }
 const result=await rpcs.get('tapd.conversations')({},context);
 const persisted=await readFile(join(process.env.PASEO_HOME,'plugin-data/tapd-workbench/conversations.json'),'utf8');
 if(persisted.includes(values.token)||persisted.includes('不应持久化的正文'))throw new Error('Unsafe persisted content');
 console.log(JSON.stringify({stage:process.argv[2],reads,references:result.conversations[0].entities.length,cards:rows.length}));
}finally{close();}
