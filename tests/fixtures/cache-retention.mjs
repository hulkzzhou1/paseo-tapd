// Isolated --expose-gc probe observes HTTP payload reachability, never private cache state.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/.test(s))return n(s+'.ts',c);throw e;}}});
const {default:contribute}=await import('../../index.server.ts');
const {tapdSettingsSchema}=await import('../../shared/contracts.ts');
assert.equal(typeof global.gc,'function');
const home=await mkdtemp(join(tmpdir(),'tapd-retention-'));process.env.PASEO_HOME=home;
for(const key of ['TAPD_TOKEN','TAPD_API_ENDPOINT','TAPD_SITE_URL','TAPD_WORKSPACE_IDS'])delete process.env[key];
const values=tapdSettingsSchema.parse({token:'example-token',workspaceIds:'12345678',apiEndpoint:'https://api.example.com',siteUrl:'https://example.com'});
const refs=[],mode=process.argv[2]??'zero';let now=Date.now();const originalNow=Date.now;Date.now=()=>now;
const originalFetch=globalThis.fetch;
globalThis.fetch=async(source,init)=>{
  assert.notEqual(init.method,'POST');const url=new URL(source);assert.equal(url.origin,'https://api.example.com');let data=[];
  if(url.pathname==='/stories'||url.pathname==='/tasks'){
    data=[{[url.pathname==='/stories'?'Story':'Task']:{id:url.searchParams.get('id'),workspace_id:'12345678',name:'Example summary',status:'open'}}];
    if(refs.length<1000)refs.push(new WeakRef(data));
  } else if(url.pathname.endsWith('/get_fields_info'))data={status:{options:{open:'Open'}}};
  // Return the exact HTTP-decoded object so WeakRef tracks the payload consumed by the real reader.
  const response=Response.json({status:1,data});response.json=async()=>({status:1,data});return response;
};
const rpcs=new Map();
const close=contribute({registerSettings:()=>({read:async()=>({status:'ready',values}),subscribe:()=>()=>{}}),handle:(schema,handler)=>rpcs.set(schema.name,{schema,handler}),before:()=>{},on:()=>{}});
try {
  const {schema,handler}=rpcs.get('tapd.entity');
  const context={paseo:{agents:{ref:id=>({id,refresh:async()=>null,current:()=>null})}}};
  for(let i=0;i<1000;i++){
    const input={kind:'task',id:String(10000000+i),fresh:mode==='zero'};
    await handler(schema.input.parse(input),context);
  }
  assert.equal(refs.length,1000);
  for(let i=0;i<8;i++){await new Promise(resolve=>setImmediate(resolve));global.gc();}
  const retained=refs.filter(ref=>ref.deref()!==undefined).length;
  if(mode==='zero'){
    console.log(JSON.stringify({observed:refs.length,retained}));
    assert.ok(retained<=2,'fresh payloads must be collectible after their RPC finishes');
  } else {
    now+=31*60_000;await handler(schema.input.parse({kind:'task',id:'22222222',fresh:false}),context);
    for(let i=0;i<8;i++){await new Promise(resolve=>setImmediate(resolve));global.gc();}
    const expiredRetained=refs.filter(ref=>ref.deref()!==undefined).length;
    console.log(JSON.stringify({observed:refs.length,retained,expiredRetained}));
    assert.ok(retained<=500,'retained positive-lifetime response payloads must stay within a finite capacity');
    assert.ok(expiredRetained<=2,'expired response payloads must be collectible on a later read');
  }
} finally {close();globalThis.fetch=originalFetch;Date.now=originalNow;await rm(home,{recursive:true,force:true});}
