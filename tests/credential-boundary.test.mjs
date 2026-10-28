import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
registerHooks({ resolve(s, c, next) { try { return next(s, c); } catch (e) { if (e.code === 'ERR_MODULE_NOT_FOUND' && s.startsWith('.') && !/\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; } } });
const { default: contribute } = await import('../index.server.ts');
const { tapdSettingsSchema } = await import('../shared/contracts.ts');
const { clearTapdCache } = await import('../server/tapd.ts');
const target = { kind: 'task', id: '11111111', workspaceId: '12345678' };
async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'tapd-protected-rpc-'));
  const prior = { ...process.env };
  process.env.PASEO_HOME = home;
  for (const key of ['TAPD_TOKEN', 'TAPD_API_ENDPOINT', 'TAPD_SITE_URL', 'TAPD_WORKSPACE_IDS']) delete process.env[key];
  const values = { ...tapdSettingsSchema.parse({ token: 'settings"\\example-secret', workspaceIds: target.workspaceId, apiEndpoint: 'https://api.example.com', siteUrl: 'https://example.com' }), syncGitToken: 'legacy"\\example-secret' };
  process.env.TAPD_TOKEN = 'daemon"\\example-secret';
  const state = { field: '', value: '', posts: 0, commentsFail: false };
  clearTapdCache();
  t.mock.method(globalThis, 'fetch', async (source, init) => {
    const url = new URL(source); assert.equal(url.origin, values.apiEndpoint);
    let data = [];
    if (init.method === 'POST') { state.posts++; data = { Task: { id: target.id } }; }
    else if (url.pathname === '/tasks') data = [{ Task: { id: target.id, workspace_id: target.workspaceId, name: 'Example task', status: 'open', description: '<p>Full text</p>', ...(state.field === 'title' ? { name: state.value } : state.field === 'description' ? { description: state.value } : {}) } }];
    else if (url.pathname === '/comments') { if (state.commentsFail) return Response.json({ status: 0, info: state.value }, { status: 403 }); data = [{ Comment: { id: '22222222', author: 'Example', description: state.field === 'comment' ? state.value : 'Safe comment' } }]; }
    else if (url.pathname === '/users/info') data = { nick: 'example-user' };
    else if (url.pathname.endsWith('/get_fields_info')) data = { status: { options: { open: 'Open' } } };
    else if (url.pathname.endsWith('/count')) data = { count: 1 };
    return Response.json({ status: 1, data });
  });
  const ref = id => ({ id, workspaceId: 'example-workspace', current: () => ({ id, workspaceId: 'example-workspace' }), refresh: async () => ({ agent: { id } }), timeline: { refetch: async () => ({ entries: [], hasOlder: false, hasNewer: false }), append: async () => ({ epoch: 'example', seq: 1 }) } });
  const context = { agent: { id: 'example-agent' }, signal: new AbortController().signal, paseo: { agents: { ref, list: async () => ({ entries: [], pageInfo: { hasMore: false }, subscription: { ready: Promise.resolve(), subscribe: () => () => {}, release: async () => {} } }) } } };
  const handlers = new Map(); let before;
  const close = contribute({ registerSettings: () => ({ read: async () => ({ status: 'ready', values }), subscribe: () => () => {} }), handle: (rpc, fn) => handlers.set(rpc.name, async input => rpc.output.parse(await fn(rpc.input.parse(input), context))), before: (_, fn) => { before = fn; }, on: () => {} });
  const tools = (await before({ request: { purpose: 'interactive', agentId: 'example-agent', tools: [], env: {} } }, context)).tools;
  t.after(async () => { close(); for (const key of ['PASEO_HOME', 'TAPD_TOKEN', 'TAPD_API_ENDPOINT', 'TAPD_SITE_URL', 'TAPD_WORKSPACE_IDS']) { if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key]; } await rm(home, { recursive: true, force: true }); });
  return { values, state, rpc: (name, input) => handlers.get(name)(input), tool: (name, input) => tools.find(tool => tool.name === name).execute(input, context) };
}
test('registered detail RPC and tool reject protected titles, full text and comments from every credential source', async t => {
  const f = await fixture(t);
  for (const secret of [f.values.token, process.env.TAPD_TOKEN, f.values.syncGitToken]) for (const field of ['title', 'description', 'comment']) {
    f.state.field = field; f.state.value = `Safe prefix ${secret} safe suffix`; clearTapdCache();
    await assert.rejects(f.rpc('tapd.entity', { ...target, fresh: true }), { message: '字段数据包含受保护内容，无法安全读取或写入。' });
    const result = await f.tool('tapd_entity', target); assert.equal(result.isError, true); assert.equal(JSON.stringify(result).includes(JSON.stringify(secret).slice(1, -1)), false);
  }
});
test('registered comment RPC and tool refuse credential-bearing text before any POST', async t => {
  const f = await fixture(t);
  for (const secret of [f.values.token, process.env.TAPD_TOKEN, f.values.syncGitToken]) {
    await assert.rejects(f.rpc('tapd.add_comment', { ...target, text: `Approved ${secret}` }), { message: '字段数据包含受保护内容，无法安全读取或写入。' });
    assert.equal((await f.tool('tapd_add_comment', { ...target, text: secret, confirmed: true })).isError, true);
  }
  assert.equal(f.state.posts, 0);
});
test('safe partial detail remains readable with an explicit comments failure', async t => {
  const f = await fixture(t); f.state.commentsFail = true; f.state.value = f.values.token;
  const detail = await f.rpc('tapd.entity', { ...target, fresh: true });
  assert.equal(detail.title, 'Example task'); assert.equal(detail.description, 'Full text'); assert.ok(detail.commentsError); assert.deepEqual(detail.comments, []);
  assert.equal(JSON.stringify(detail).includes(JSON.stringify(f.values.token).slice(1, -1)), false);
});

test('registered board and search RPCs cannot bypass the protected-output boundary', async t => {
  const f = await fixture(t); f.state.field = 'title'; f.state.value = f.values.token;
  await assert.rejects(f.rpc('tapd.board', { filters: { ownerMode: 'all' }, force: true }), { message: '字段数据包含受保护内容，无法安全读取或写入。' });
  await assert.rejects(f.rpc('tapd.search', { query: 'Example' }), { message: '字段数据包含受保护内容，无法安全读取或写入。' });
  for (const [name, input] of [['tapd_board', { filters: { ownerMode: 'all' } }], ['tapd_search', { query: 'Example' }]]) assert.equal((await f.tool(name, input)).isError, true);
  assert.equal(f.state.posts, 0);
});
