import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { registerHooks } from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/.test(s))return n(s+'.ts',c);throw e;}}});
const { default: contribute } = await import('../index.server.ts');
const { tapdSettingsSchema } = await import('../shared/contracts.ts');
const { clearTapdCache } = await import('../server/tapd.ts');

async function fixture(t) {
  clearTapdCache();
  const previous = Object.fromEntries(['TAPD_TOKEN','TAPD_API_ENDPOINT','TAPD_SITE_URL','TAPD_WORKSPACE_IDS'].map(key => [key, process.env[key]]));
  for (const key of Object.keys(previous)) delete process.env[key];
  t.after(() => { for (const [key,value] of Object.entries(previous)) { if(value === undefined) delete process.env[key]; else process.env[key] = value; } clearTapdCache(); });
  const requests = [], accepted = new Set(['example-token-a','example-token-b']);
  let onUser = async () => {};
  const server = createServer(async (req,res) => {
    const url = new URL(req.url,'http://example.com'), credential = req.headers.authorization?.replace(/^Bearer /,'');
    const account = credential === 'example-token-a' ? 'Example A' : 'Example B';
    requests.push({path:url.pathname,project:url.searchParams.get('workspace_id'),owner:url.searchParams.get('owner'),account});
    if(url.pathname.endsWith('/users/info')) await onUser(account);
    if(!accepted.has(credential)) { res.writeHead(401).end(); return; }
    let data=[];
    if(url.pathname.endsWith('/users/info')) data={nick:account,name:account};
    if(url.pathname.endsWith('/stories')) data=[{Story:{id:'11111111',name:`${account} ${url.searchParams.get('workspace_id')}`,status:'open'}}];
    if(url.pathname.endsWith('/count')) data={count:url.pathname.endsWith('/stories/count')?1:0};
    if(url.pathname.endsWith('/get_fields_info')) data={status:{options:{open:'Open'}}};
    res.setHeader('content-type','application/json'); res.end(JSON.stringify({status:1,data}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const endpoint=`http://127.0.0.1:${server.address().port}`;
  const values=tapdSettingsSchema.parse({token:'example-token-a',workspaceIds:'12345678',apiEndpoint:endpoint,siteUrl:'https://example.com'}), rpcs=new Map();
  const close=contribute({registerSettings:()=>({read:async()=>({status:'ready',values}),subscribe:()=>()=>{}}),handle:(schema,handler)=>rpcs.set(schema.name,{schema,handler}),before:()=>{},on:()=>{}});
  t.after(close);
  return {values,requests,accepted,endpoint,holdUser:fn=>{onUser=fn;},async rpc(name,input={}) {const {schema,handler}=rpcs.get(name); return schema.output.parse(await handler(schema.input.parse(input),{}));}};
}

test('draft connection checks validate their credential, not a prior account response',async t=>{
  const s=await fixture(t);
  assert.equal((await s.rpc('tapd.check')).me,'Example A');
  const rejected=await s.rpc('tapd.check',{token:'example-invalid-token'});
  assert.equal(rejected.ok,false); assert.equal(rejected.me,null);
  assert.equal(s.requests.filter(r=>r.path==='/users/info').length,2);
  assert.equal(s.values.token,'example-token-a','draft checks do not replace saved credentials');
});

test('workbench reads follow the current credential, project, site and endpoint before using a snapshot',async t=>{
  const s=await fixture(t);
  const titles=result=>result.columns.story.items.map(item=>item.title);
  assert.deepEqual(titles(await s.rpc('tapd.board')),['Example A 12345678']);
  const warmCount=s.requests.length;
  await s.rpc('tapd.board');assert.equal(s.requests.length,warmCount,'unchanged scope can reuse the snapshot');
  s.values.token='example-token-b';
  assert.deepEqual(titles(await s.rpc('tapd.board')),['Example B 12345678']);
  assert.ok(s.requests.some(r=>r.path==='/stories'&&r.account==='Example B'&&r.owner==='Example B'));
  s.values.workspaceIds='87654321';
  assert.deepEqual(titles(await s.rpc('tapd.board')),['Example B 87654321']);
  s.values.siteUrl='https://other.example.com';
  assert.match((await s.rpc('tapd.board')).columns.story.items[0].url,/^https:\/\/other\.example\.com\//);
  s.values.apiEndpoint=`${s.endpoint}/v2`;
  assert.deepEqual(titles(await s.rpc('tapd.board')),['Example B 87654321']);
  assert.ok(s.requests.some(r=>r.path==='/v2/stories'));
  s.values.token='example-invalid-token';
  await assert.rejects(s.rpc('tapd.board'),/无法识别当前用户/);
  s.values.token='';
  await assert.rejects(s.rpc('tapd.board'),/未配置 TAPD Token/);
  s.values.token='example-token-a';s.values.workspaceIds='';
  await assert.rejects(s.rpc('tapd.board'),/未配置 TAPD 项目 ID/);
});

test('retesting the same connection detects revoked credentials without trusting a prior success',async t=>{
  const s=await fixture(t);
  assert.equal((await s.rpc('tapd.check')).ok,true);
  s.accepted.delete('example-token-a');
  const result=await s.rpc('tapd.check');
  assert.equal(result.ok,false);assert.equal(result.me,null);
  assert.equal(s.requests.filter(r=>r.path==='/users/info').length,2);
});

test('overlapping workbench account reads cannot join another credential in-flight request',async t=>{
  const s=await fixture(t);
  let release, entered;
  const held=new Promise(resolve=>{release=resolve;}), started=new Promise(resolve=>{entered=resolve;});
  s.holdUser(async account=>{if(account==='Example A'){entered();await held;}});
  const first=s.rpc('tapd.board');
  await started;
  s.values.token='example-token-b';
  let timer;
  try {
    const second=await Promise.race([s.rpc('tapd.board'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('The other account was blocked by a held read')),1500);})]);
    assert.equal(second.columns.story.items[0].title,'Example B 12345678');
    assert.ok(s.requests.some(request=>request.path==='/users/info'&&request.account==='Example B'));
  } finally {clearTimeout(timer);release();await first;}
});
