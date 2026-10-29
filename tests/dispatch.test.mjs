import assert from 'node:assert/strict';
import {test} from 'node:test';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){try{return next(s,c);}catch(error){if(error.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/.test(s))return next(s+'.ts',c);throw error;}}});
const {default:contribute}=await import('../index.server.ts');
const {tapdSettingsSchema}=await import('../shared/contracts.ts');
const {clearTapdCache}=await import('../server/tapd.ts');
for(const key of ['TAPD_TOKEN','TAPD_WORKSPACE_IDS','TAPD_API_ENDPOINT','TAPD_SITE_URL'])delete process.env[key];
const input={kind:'story',id:'11111111',workspaceId:'12345678',repoPath:'/example/repo',provider:'codex/example-model',branchName:'tapd/example',prompt:'Approved implementation',confirmed:true};
function fixture(t){
 clearTapdCache();let values=tapdSettingsSchema.parse({token:'example-secret',workspaceIds:'12345678',apiEndpoint:'https://api.example.com',siteUrl:'https://example.com'});
 const state={calls:[],fail:'',project:'12345678',controller:new AbortController()};
 t.mock.method(globalThis,'fetch',async(source,init)=>{const url=new URL(source);assert.equal(url.origin,'https://api.example.com');assert.notEqual(init.method,'POST');return Response.json({status:1,data:url.pathname==='/stories'?[{Story:{id:input.id,workspace_id:state.project,status:'open',name:'Example'}}]:[]});});
 const paseo={projects:{list:async()=>({projects:[{projectKind:'git',projectRootPath:input.repoPath,projectDisplayName:'Example'}]})},providers:{snapshot:async()=>({entries:[{provider:'codex',models:[{id:'example-model',label:'Example'}]}]})},workspaces:{create:async data=>{state.calls.push(['workspace',data]);if(state.fail==='workspace')throw Error('private example-secret');state.afterWorkspace?.();return{id:'example-workspace',agents:{create:async data=>{state.calls.push(['agent',data]);if(state.fail==='agent')throw Error('private example-secret');state.afterAgent?.();return{id:'example-agent',send:async prompt=>{state.calls.push(['prompt',prompt]);if(state.fail==='prompt')throw Error('private example-secret');}};}}};}}};
 const handlers=new Map();let before;
 const dispose=contribute({registerSettings:()=>({read:async()=>({status:'ready',values}),subscribe:()=>()=>{}}),handle:(rpc,handler)=>handlers.set(rpc.name,async raw=>rpc.output.parse(await handler(rpc.input.parse(raw),{paseo,signal:state.controller.signal}))),before:(_,handler)=>{before=handler;},on(){assert.fail('No local lifecycle tracking');}});t.after(dispose);
 return {state,change:patch=>{values={...values,...patch};},rpc:raw=>handlers.get('tapd.dispatch_agent')(raw),async tool(name,raw){const launch=await before({request:{purpose:'interactive',tools:[],env:{}}});return launch.tools.find(tool=>tool.name===name).execute(raw,{paseo,signal:state.controller.signal});}};
}
test('registered dispatch RPC/tool keep worktree and execution without binding or TAPD writes',async t=>{
 const f=fixture(t);const options=await f.tool('tapd_agent_options',{});assert.equal(options.structuredContent.models[0].value,input.provider);assert.equal('bindings' in options.structuredContent,false);
 for(const run of [raw=>f.rpc(raw),raw=>f.tool('tapd_dispatch_agent',raw).then(r=>r.structuredContent)]){
  f.state.calls=[];const result=await run(input);assert.equal(result.ok,true);assert.equal(result.agentId,'example-agent');assert.equal(result.promptSent,true);
  assert.deepEqual(f.state.calls.map(([stage])=>stage),['workspace','agent','prompt']);
  assert.equal(f.state.calls[0][1].source.kind,'worktree');assert.deepEqual(f.state.calls[1][1],{config:{provider:input.provider},title:'TAPD #11111111'});assert.equal(f.state.calls[2][1],input.prompt);assert.equal('bound' in result,false);
 }
});
test('invalid approval, target, project, model or credential-bearing prompt creates no resources',async t=>{
 const f=fixture(t);
 for(const patch of [{confirmed:false},{workspaceId:'87654321'},{provider:'codex/missing'},{repoPath:'/unknown'},{prompt:'private example-secret'}])assert.equal((await f.tool('tapd_dispatch_agent',{...input,...patch})).isError,true);
 f.state.project='87654321';assert.equal((await f.tool('tapd_dispatch_agent',input)).isError,true);assert.deepEqual(f.state.calls,[]);
});
test('partial dispatch retains resource IDs, signals uncertain prompt and never retries automatically',async t=>{
 for(const stage of ['workspace','agent','prompt']){
  const f=fixture(t);f.state.fail=stage;const result=await f.rpc(input);
  assert.equal(result.ok,false);assert.equal(result.phase,stage);assert.equal(result.promptSent,stage==='prompt'?'unknown':false);
  assert.equal(result.workspaceId,stage==='workspace'?undefined:'example-workspace');assert.equal(result.agentId,stage==='prompt'?'example-agent':undefined);
  assert.equal(f.state.calls.filter(([name])=>name===stage).length,1);assert.equal(JSON.stringify(result).includes('example-secret'),false);assert.match(result.warning,/勿重复/);
 }
});

test('dispatch cancellation and changed connection stop later stages without deleting known resources',async t=>{
 for(const stage of ['before','workspace','agent','configuration']){
  const f=fixture(t);
  if(stage==='before')f.state.controller.abort();
  else if(stage==='configuration')f.state.afterWorkspace=()=>f.change({token:'replacement-example-secret'});
  else f.state[stage==='workspace'?'afterWorkspace':'afterAgent']=()=>f.state.controller.abort();
  const result=await f.tool('tapd_dispatch_agent',input);
  if(stage==='before'){assert.equal(result.isError,true);assert.deepEqual(f.state.calls,[]);}
  else{assert.equal(result.structuredContent.ok,false);assert.equal(result.structuredContent.workspaceId,'example-workspace');assert.equal(result.structuredContent.promptSent,false);assert.equal(f.state.calls.some(([name])=>name==='prompt'),false);}
 }
});
