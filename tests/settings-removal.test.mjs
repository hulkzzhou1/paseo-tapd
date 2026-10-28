import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
registerHooks({resolve(specifier, context, next) {
  try { return next(specifier, context); } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier)) return next(specifier + '.ts', context);
    throw error;
  }
}});
const { default: contribute } = await import('../index.server.ts');
const { tapdSettings } = await import('../shared/contracts.ts');
const legacy = {
  token:'example-secret', apiEndpoint:'https://api.example.com', siteUrl:'https://example.com', workspaceIds:'12345678',
  syncGitUrl:'https://backup.example.com/example.git', syncGitToken:'example-retired-secret', syncBranch:'example-branch',
  views:[{id:'example-view',name:'Example',filters:{ownerMode:'all'}}], defaultViewId:'example-view', favorites:['story-11111111'],
  columns:{story:['open']}, groupByStatus:true, lastRepoPath:'/example/repository', lastProvider:'example-provider',
  links:[{key:'story-11111111',kind:'story',id:'11111111',agentId:'example-agent',workspaceId:'example-workspace'}],
  createFieldLayout:{task:{order:['name'],hidden:[]}}, autoRefreshSeconds:90,
};

test('settings upgrade retires configuration Git fields and preserves all remaining local values', async () => {
  const previous = tapdSettings.schema.parse(legacy);
  const upgraded = tapdSettings.schema.parse(await tapdSettings.migrate(legacy, 6));
  const expected = {...previous};
  for (const key of ['syncGitUrl','syncGitToken','syncBranch']) {
    delete expected[key];
    assert.equal(key in upgraded, false, `${key} must no longer be saved`);
  }
  assert.deepEqual(upgraded, expected);
  assert.deepEqual(tapdSettings.schema.parse(await tapdSettings.migrate(upgraded, tapdSettings.version)), upgraded);
  assert.equal(legacy.syncGitToken, 'example-retired-secret', 'migration does not modify the old source object');
});

test('removed Git RPCs are unavailable and settings changes never schedule backups', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const requests=[];
  t.mock.method(globalThis,'fetch', async url => {requests.push(String(url));throw Error('Unexpected network request');});
  const registered=new Map(); let changed, unsubscribed=false;
  const close=contribute({
    registerSettings:definition=>({read:async()=>({status:'ready',values:definition.schema.parse(await definition.migrate(legacy,6))}),subscribe:callback=>{changed=callback;return ()=>{unsubscribed=true;};}}),
    handle:(rpc, handler)=>registered.set(rpc.name, handler), before(){}, on(){},
  });
  try {
    for (const name of ['tapd.sync_push','tapd.sync_pull']) assert.equal(registered.has(name),false, `${name} must be unavailable`);
    changed(); changed();
    t.mock.timers.tick(60_000);
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(requests,[]);
  } finally {close();}
  assert.equal(unsubscribed,true);
});

test('upgrading older settings versions keeps local data while applying historical view migrations', async () => {
  for (const version of [1, 2, 3, 4, 5, 6]) {
    const values=tapdSettings.schema.parse(await tapdSettings.migrate(legacy,version));
    for (const key of ['token','apiEndpoint','siteUrl','workspaceIds','favorites','columns','groupByStatus','lastRepoPath','lastProvider','createFieldLayout','autoRefreshSeconds']) {
      assert.deepEqual(values[key],legacy[key],`version ${version}: ${key} preserved`);
    }
    assert.equal(values.links[0].agentId,'example-agent');
  }
});
