import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
registerHooks({ resolve(s, c, next) { try { return next(s, c); } catch (e) { if (e.code === 'ERR_MODULE_NOT_FOUND' && s.startsWith('.') && !/\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; } } });
const { default: contribute } = await import('../index.server.ts');
const { tapdSettingsSchema } = await import('../shared/contracts.ts');
const { clearTapdCache } = await import('../server/tapd.ts');
const target = { kind: 'story', id: '11111111', workspaceId: '12345678' };
async function fixture(t, projects = '12345678,87654321') {
  const home = await mkdtemp(join(tmpdir(), 'tapd-write-project-')), prior = process.env.PASEO_HOME; process.env.PASEO_HOME = home;
  const state = { project: '12345678', id: target.id, wrapper: 'Story', missing: false, offline: false, post: 'accepted', afterPost: false, status: 'open', posts: [] };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1'); let data = [];
    if (req.method === 'POST') {
      let body = ''; for await (const chunk of req) body += chunk; const params = new URLSearchParams(body); state.posts.push({ path: url.pathname, params });
      if (state.post === 'unknown') { req.socket.destroy(); return; }
      if (state.post === 'rejected') { res.writeHead(403).end(); return; }
      if (params.has('status')) state.status = params.get('status'); state.afterPost = true; data = { Story: { id: target.id } };
    } else if (state.offline || (state.afterPost && state.post === 'unverified')) { res.writeHead(503).end(); return; }
    else if (url.pathname === '/stories' && !state.missing && url.searchParams.get('workspace_id') === state.project) data = [{ [state.wrapper]: { id: state.id, workspace_id: state.project, name: 'Example', status: state.status } }];
    else if (url.pathname === '/users/info') data = { nick: 'example-user' };
    else if (url.pathname.endsWith('/get_fields_info')) data = { status: { options: { open: 'Open', done: 'Done' } } };
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: 1, data }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const values = tapdSettingsSchema.parse({ token: 'example-secret', workspaceIds: projects, apiEndpoint: `http://127.0.0.1:${server.address().port}`, siteUrl: 'https://example.com' });
  clearTapdCache(); const rpcs = new Map(); let before;
  const ref = id => ({ id, workspaceId: 'example-workspace', current: () => ({ id }), refresh: async () => ({ agent: { id } }), timeline: { append: async () => ({ epoch: 'example', seq: 1 }), refetch: async () => ({ entries: [], hasOlder: false, hasNewer: false }) } });
  const context = { signal: new AbortController().signal, agent: { id: 'example-agent' }, paseo: { agents: { ref, list: async () => ({ entries: [], pageInfo: { hasMore: false }, subscription: { ready: Promise.resolve(), subscribe: () => () => {}, release: async () => {} } }) } } };
  const close = contribute({ registerSettings: () => ({ read: async () => ({ status: 'ready', values }), subscribe: () => () => {} }), handle: (rpc, fn) => rpcs.set(rpc.name, async input => rpc.output.parse(await fn(rpc.input.parse(input), context))), before: (_, fn) => { before = fn; }, on: () => {} });
  const tools = (await before({ request: { purpose: 'interactive', agentId: 'example-agent', tools: [], env: {} } }, context)).tools;
  t.after(async () => { close(); await new Promise(resolve => server.close(resolve)); if (prior === undefined) delete process.env.PASEO_HOME; else process.env.PASEO_HOME = prior; await rm(home, { recursive: true, force: true }); });
  return { state, rpc: (name, input) => rpcs.get(name)(input), tool: (name, input) => tools.find(tool => tool.name === name).execute(input, context) };
}
test('registered basic write RPCs and tools reject excluded projects before every POST', async t => {
  const f = await fixture(t, '12345678'), bad = { ...target, workspaceId: '87654321' };
  for (const [rpc, tool, input] of [['tapd.create', 'tapd_create', { kind: 'story', workspaceId: bad.workspaceId, title: 'Example' }], ['tapd.update_status', 'tapd_update_status', { ...bad, status: 'done' }], ['tapd.add_comment', 'tapd_add_comment', { ...bad, text: 'Approved comment' }]]) {
    await assert.rejects(f.rpc(rpc, input)); assert.equal((await f.tool(tool, { ...input, confirmed: true })).isError, true);
  }
  assert.equal(f.state.posts.length, 0);
});

test('existing-item RPC writes freshly verify project, type and number and never guess after failed reads', async t => {
  const f = await fixture(t);
  for (const mismatch of [{ project: '87654321' }, { id: '22222222' }, { wrapper: 'Task' }, { missing: true }, { offline: true }]) {
    Object.assign(f.state, { project: '12345678', id: target.id, wrapper: 'Story', missing: false, offline: false }, mismatch); clearTapdCache();
    for (const [name, input] of [['tapd.update_status', { ...target, status: 'done' }], ['tapd.add_comment', { ...target, text: 'Approved comment' }]]) await assert.rejects(f.rpc(name, input));
  }
  assert.equal(f.state.posts.length, 0);
});

test('standalone creation defaults locally while existing writes resolve the actual configured project', async t => {
  const f = await fixture(t); f.state.project = '87654321';
  await f.rpc('tapd.create', { kind: 'story', title: 'Example' });
  assert.equal(f.state.posts.at(-1).params.get('workspace_id'), '12345678');
  const changed = await f.rpc('tapd.update_status', { kind: target.kind, id: target.id, status: 'done' });
  assert.equal(changed.outcome, 'verified');
  await f.rpc('tapd.add_comment', { kind: target.kind, id: target.id, text: 'Approved comment' });
  assert.deepEqual(f.state.posts.slice(1).map(post => post.params.get('workspace_id')), ['87654321', '87654321']);
  f.state.status = 'open';
  for (const [name, input] of [['tapd_update_status', { status: 'done' }], ['tapd_add_comment', { text: 'Approved comment' }]]) {
    const result = await f.tool(name, { ...target, workspaceId: f.state.project, ...input, confirmed: true }); assert.equal(result.isError, undefined); assert.equal(result.structuredContent.ok, true);
  }
  assert.equal(f.state.posts.length, 5); assert.equal(f.state.posts.at(-1).params.get('workspace_id'), '87654321');
});

test('write outcomes distinguish rejection, unknown transport and accepted-unverified without retry', async t => {
  const f = await fixture(t);
  for (const mode of ['rejected', 'unknown']) for (const [rpc, tool, input] of [['tapd.create', 'tapd_create', { kind: 'story', title: 'Example', workspaceId: target.workspaceId }], ['tapd.update_status', 'tapd_update_status', { ...target, status: 'done' }], ['tapd.add_comment', 'tapd_add_comment', { ...target, text: 'Approved comment' }]]) {
    f.state.post = mode; f.state.afterPost = false; const before = f.state.posts.length;
    await assert.rejects(f.rpc(rpc, input), error => error.failure.writeState === (mode === 'rejected' ? 'rejected' : 'unknown'));
    const result = await f.tool(tool, { ...input, confirmed: true }); assert.equal(result.isError, true); assert.equal(result.structuredContent.failure.writeState, mode === 'rejected' ? 'rejected' : 'unknown');
    assert.equal(f.state.posts.length, before + 2, 'one POST per invocation and no automatic retry');
  }
  f.state.post = 'unverified'; f.state.afterPost = false;
  const before = f.state.posts.length;
  const accepted = await f.rpc('tapd.update_status', { ...target, status: 'done' }); assert.equal(accepted.writeState, 'accepted'); assert.equal(accepted.outcome, 'unverified'); assert.equal(accepted.ok, false);
  assert.equal(f.state.posts.length, before + 1);
});
