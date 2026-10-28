import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/.test(s))return n(s+'.ts',c);throw e;}}});
const { default: contribute } = await import('../index.server.ts');
const { tapdSettingsSchema } = await import('../shared/contracts.ts');
const { clearTapdCache } = await import('../server/tapd.ts');
const boardInput={filters:{ownerMode:'all',statusScope:'all'}};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(t) {
  clearTapdCache();
  const prior={...process.env};for(const key of ['TAPD_TOKEN','TAPD_API_ENDPOINT','TAPD_SITE_URL','TAPD_WORKSPACE_IDS'])delete process.env[key];
  let now=Date.now();t.mock.method(Date,'now',()=>now);
  const state={title:'Original',status:'open',posts:0,listReads:0,failLists:false,failVerification:false,failUser:false,userReads:0},plans=[],pending=[];
  t.mock.method(globalThis,'fetch',async(source,init)=>{
    const url=new URL(source);let data=[];
    if(init.method==='POST'){state.posts++;state.title='Updated';state.status='done';data={Story:{id:'11111111'}};}
    else if(url.pathname==='/stories') {
      if(url.searchParams.has('id')) {
        const title=state.title,status=state.status,plan=plans[0]?.detail?plans.shift():null;
        if(plan){plan.started();await plan.held;}
        if(state.failVerification&&state.posts)return new Response(null,{status:503});
        data=[{Story:{id:'11111111',workspace_id:'12345678',name:title,status}}];
      } else {
        state.listReads++;const title=state.title,status=state.status,plan=plans[0]?.detail?null:plans.shift();
        if(plan){plan.started();await plan.held;}
        if(state.failLists)return new Response(null,{status:503});
        data=[{Story:{id:'11111111',name:title,status}}];
      }
    } else if(url.pathname==='/users/info'){state.userReads++;if(state.failUser)return new Response(null,{status:503});data={nick:'example-user'};}
    else if(url.pathname.endsWith('/get_fields_info'))data={status:{options:{open:'Open',done:'Done'}}};
    else if(url.pathname.endsWith('/count'))data={count:url.pathname==='/stories/count'?1:0};
    return Response.json({status:1,data});
  });
  const values=tapdSettingsSchema.parse({token:'example-token',workspaceIds:'12345678',apiEndpoint:'https://api.example.com',siteUrl:'https://example.com'}),rpcs=new Map();let invalidate;
  const close=contribute({registerSettings:()=>({read:async()=>({status:'ready',values}),subscribe:fn=>{invalidate=fn;return()=>{};}}),handle:(schema,handler)=>rpcs.set(schema.name,{schema,handler}),before:()=>{},on:()=>{}});
  t.after(async()=>{for(const release of pending)release();close();for(const key of ['TAPD_TOKEN','TAPD_API_ENDPOINT','TAPD_SITE_URL','TAPD_WORKSPACE_IDS']){if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];}clearTapdCache();});
  const rpc=async(name,input={})=>{const {schema,handler}=rpcs.get(name);return schema.output.parse(await handler(schema.input.parse(input),{}));};
  return {state,values,rpc,invalidate,advance:ms=>now+=ms,now:()=>now,board:(force=false)=>rpc('tapd.board',{...boardInput,force}),hold(detail=false){let release,started;const held=new Promise(resolve=>release=resolve),entered=new Promise(resolve=>started=resolve);plans.push({held,started,detail});pending.push(release);return{entered,release};}};
}

test('a forced board response invalidated by settings cannot return fresh or overwrite the new board',async t=>{
  const s=await fixture(t),held=s.hold();
  const old=s.board(true).then(value=>({value}),error=>({error}));await held.entered;
  s.invalidate();s.state.title='Current';
  assert.equal((await s.board(true)).columns.story.items[0].title,'Current');
  held.release();const obsolete=await old;
  assert.ok(obsolete.error,'obsolete foreground read must fail explicitly, not return a fresh snapshot');
  assert.match(obsolete.error.message,/变更|刷新/);
  assert.equal((await s.board()).columns.story.items[0].title,'Current');
});

test('an invalidated background refresh cannot replace a newer successful snapshot',async t=>{
  const s=await fixture(t);
  await s.board();s.advance(90_001);
  const held=s.hold(),stale=await s.board();
  assert.equal(stale.stale,true);await held.entered;
  s.invalidate();s.state.title='Current';
  assert.equal((await s.board(true)).columns.story.items[0].title,'Current');
  held.release();await tick();
  assert.equal((await s.board()).columns.story.items[0].title,'Current');
});

test('an old background completion cannot clear a newer refresh registered after invalidation',async t=>{
  const s=await fixture(t);await s.board();s.advance(90_001);
  const old=s.hold();await s.board();await old.entered;
  s.invalidate();s.state.title='Current';await s.board(true);s.advance(90_001);
  const current=s.hold();await s.board();await current.entered;
  const reads=s.state.userReads;
  old.release();await tick();s.advance(60_001);
  await s.board();await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(s.state.userReads,reads,'the pending refresh must remain registered even after its user metadata expires');
  current.release();await tick();
});

test('a fresh detail read invalidated by settings fails rather than publishing its obsolete response',async t=>{
  const s=await fixture(t),held=s.hold(true);
  const result=s.rpc('tapd.entity',{kind:'story',id:'11111111',fresh:true}).then(value=>({value}),error=>({error}));
  await held.entered;s.invalidate();held.release();
  const obsolete=await result;
  assert.ok(obsolete.error,'a fresh HTTP read also needs invalidation protection');
  assert.match(obsolete.error.message,/变更|刷新/);
});

test('an accepted status write invalidates an older read even when verification fails, without replaying the write',async t=>{
  const s=await fixture(t),held=s.hold();
  const old=s.board(true).then(value=>({value}),error=>({error}));await held.entered;
  s.state.failVerification=true;
  const result=await s.rpc('tapd.update_status',{kind:'story',id:'11111111',workspaceId:'12345678',status:'done'});
  assert.equal(result.writeState,'accepted');assert.equal(result.outcome,'unverified');
  held.release();assert.ok((await old).error);
  assert.equal((await s.board()).columns.story.items[0].title,'Updated');assert.equal(s.state.posts,1);
});

test('failed background refresh preserves the original successful timestamp and never falls back across connections',async t=>{
  const s=await fixture(t),input={filters:{ownerMode:'mine',statusScope:'all'}};
  const original=await s.rpc('tapd.board',input),at=s.now();
  s.advance(90_001);s.state.failUser=true;
  const first=await s.rpc('tapd.board',input);await tick();
  const again=await s.rpc('tapd.board',input);
  for(const result of [first,again]) {
    assert.equal(result.stale,true);assert.equal(result.cachedAt,new Date(at).toISOString());
    assert.equal(result.fetchedAt,original.fetchedAt);assert.equal(result.columns.story.items[0].title,'Original');
  }
  s.values.siteUrl='https://other.example.com';
  await assert.rejects(s.rpc('tapd.board',input),/无法识别当前用户/);
});
