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
const values = tapdSettingsSchema.parse({ token: 'example-secret', workspaceIds: '12345678', apiEndpoint: 'https://api.example.com', siteUrl: 'https://example.com' });
async function fixture(t, long = false) {
  const home = await mkdtemp(join(tmpdir(), 'tapd-card-performance-')), prior = process.env.PASEO_HOME; process.env.PASEO_HOME = home;
  const agents = new Map(['example-agent', 'example-other'].map(id => [id, { id, workspaceId: 'example-workspace', status: 'idle', archivedAt: null }]));
  const state = { rows: new Map(), pages: new Map(), listeners: new Map(), gate: null, gatedAgent: '', directoryEmpty: false, uncertain: false, writes: 0, prompts: 0 };
  if (long) state.rows.set('example-agent', Array.from({ length: 10000 }, (_, index) => ({ item: { type: 'tool_call', id: String(index) }, seqStart: index + 1, seqEnd: index + 1 })));
  const ref = id => ({ address: { serverId: 'example-host', agentId: id }, workspaceId: 'example-workspace', status: 'idle', refresh: async () => agents.has(id) ? { agent: agents.get(id) } : null, current: () => agents.get(id), send: async () => { state.prompts++; }, timeline: {
    subscribe: listener => { state.listeners.set(id, listener); return { ready: Promise.resolve(), release: async () => {} }; },
    refetch: async ({ cursor, limit = 200 } = {}) => { state.pages.set(id, (state.pages.get(id) ?? 0) + 1); if (state.gatedAgent === id) await state.gate; const rows = state.rows.get(id) ?? [], end = cursor?.offset ?? rows.length, start = Math.max(0, end - limit); return { entries: rows.slice(start, end), hasOlder: start > 0, hasNewer: false, startCursor: { offset: start }, epoch: 'example-epoch' }; },
    append: async item => { const rows = state.rows.get(id) ?? []; rows.push({ item: { ...item, pluginId: 'tapd-workbench' }, seqStart: rows.length + 1, seqEnd: rows.length + 1 }); state.rows.set(id, rows); if (state.uncertain) { state.uncertain = false; throw Error('accepted but response lost'); } return { epoch: 'example-epoch', seq: rows.length }; },
  } });
  const paseo = { agents: { ref, list: async () => ({ entries: state.directoryEmpty ? [] : [...agents.values()].map(agent => ({ agent })), pageInfo: { hasMore: false }, subscription: { ready: Promise.resolve(), subscribe: () => () => {}, release: async () => {} } }) } };
  clearTapdCache(); t.mock.method(globalThis, 'fetch', async (source, init) => { const url = new URL(source); assert.equal(url.origin, values.apiEndpoint); if (init.method === 'POST') state.writes++; return Response.json({ status: 1, data: url.pathname === '/tasks' ? [{ Task: { id: url.searchParams.get('id') ?? '11111111', workspace_id: '12345678', name: 'Example task', status: 'open' } }] : [] }); });
  let close, rpcs, before, tools;
  const context = { paseo, signal: new AbortController().signal };
  function start() { rpcs = new Map(); tools = null; close = contribute({ registerSettings: () => ({ read: async () => ({ status: 'ready', values }), subscribe: () => () => {} }), handle: (rpc, fn) => rpcs.set(rpc.name, async input => rpc.output.parse(await fn(rpc.input.parse(input), context))), before: (_, fn) => { before = fn; }, on: () => {} }); }
  start(); t.after(async () => { close(); if (prior === undefined) delete process.env.PASEO_HOME; else process.env.PASEO_HOME = prior; await rm(home, { recursive: true, force: true }); });
  return { state, rpc: (name, input = {}) => rpcs.get(name)(input), restart() { close(); start(); }, async call(name = 'tapd_entity', input = { kind: 'task', id: '11111111' }, agentId = 'example-agent') { tools ??= (await before({ request: { purpose: 'interactive', agentId, tools: [], env: {} } }, context)).tools; return tools.find(tool => tool.name === name).execute(input, { ...context, agent: { id: agentId } }); }, cards(id = 'example-agent') { return (state.rows.get(id) ?? []).filter(entry => entry.item.type === 'plugin').map(entry => entry.item); } };
}
test('new registered single and batch cards append without rescanning a recovered 10000-row history', async t => {
  const f = await fixture(t, true); await f.call(); await f.rpc('tapd.conversations'); f.state.pages.clear();
  await f.call(); await f.call('tapd_search', { query: 'Example' });
  assert.equal(f.state.pages.get('example-agent') ?? 0, 0, 'normal cards must not read historical timeline pages');
  assert.equal(f.cards().length, 3); assert.equal(new Set(f.cards().map(card => card.id)).size, 3); assert.equal(f.state.writes, 0);
});

test('a suspended Agent recovery cannot block another Agents newly registered result card', { timeout: 5000 }, async t => {
  const f = await fixture(t); await f.call('tapd_entity', { kind: 'task', id: '11111111' }, 'example-other'); await f.rpc('tapd.conversations');
  f.state.directoryEmpty = true; f.restart(); let release; f.state.gate = new Promise(resolve => { release = resolve; }); f.state.gatedAgent = 'example-other'; let timer;
  try {
    const result = await Promise.race([f.call(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('unrelated recovery blocked a new card')), 1500); })]);
    assert.equal(result.structuredContent.presentationWarning, undefined); assert.equal(f.cards().length, 1);
  } finally { clearTimeout(timer); release(); f.state.gatedAgent = ''; await f.rpc('tapd.conversations'); }
  assert.equal(f.cards().length, 1); assert.equal(f.cards('example-other').length, 1);
});

test('uncertain accepted-write presentation, reconnect, replacement and restart recover stable cards without replaying writes', async t => {
  const f = await fixture(t); f.state.uncertain = true;
  const result = await f.call('tapd_add_comment', { kind: 'task', id: '11111111', workspaceId: '12345678', text: 'Approved comment', confirmed: true });
  assert.equal(result.structuredContent.ok, true); assert.ok(result.structuredContent.presentationWarning); assert.equal(f.state.writes, 1);
  const original = f.cards()[0]; assert.ok(original.id);
  await f.rpc('tapd.conversations'); assert.equal(f.cards().length, 1, 'uncertain append was accepted, so recovery must not duplicate it');
  for (const type of ['replacement', 'subscription_restored']) {
    f.state.rows.set('example-agent', []); f.state.listeners.get('example-agent')({ event: { type } }); await f.rpc('tapd.conversations');
    assert.equal(f.cards().length, 1); assert.equal(f.cards()[0].id, original.id); assert.equal(f.state.writes, 1);
  }
  f.restart(); f.state.rows.set('example-agent', []); await f.rpc('tapd.conversations');
  assert.equal(f.cards().length, 1); assert.equal(f.cards()[0].id, original.id); assert.equal(f.state.writes, 1); assert.equal(f.state.prompts, 0);
});
