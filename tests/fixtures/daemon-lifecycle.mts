// Mainline internals belong only to this isolated test driver; plugin code uses public SDK.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [fixtureRoot, phase, pluginDir] = process.argv.slice(2);
assert(fixtureRoot && ['A', 'H', 'B'].includes(phase) && process.env.PASEO_HOME === join(fixtureRoot, '.paseo'));
const fromMain = (path: string) => import(pathToFileURL(join(process.env.PASEO_MAIN_DIR!, path)).href);
const { createTestPaseoDaemon } = await fromMain('packages/server/src/server/test-utils/paseo-daemon.ts');
const { DaemonClient } = await fromMain('packages/server/src/server/test-utils/daemon-client.ts');
const { createTestAgentClient } = await fromMain('packages/server/src/server/test-utils/fake-agent-client.ts');
const { createPaseoApi } = await fromMain('packages/client/src/index.ts');
const { Client } = await fromMain('node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js');
const { StreamableHTTPClientTransport } = await fromMain('node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js');
let step = 'start';
let daemon: any, client: any, api: any, mcp: any;
async function connect() {
  client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` }); await client.connect(); api = createPaseoApi(client);
}
async function disconnect() { await api?.dispose(); await client?.close(); }
const rpc = (name: string, input = {}) => client.invokePluginRpc('tapd-workbench', name, input);
const list = () => rpc('tapd.conversations');
const entities = (state: any, agentId: string) => state.conversations.find((row: any) => row.agentId === agentId)?.entities ?? [];
const cards = async (id: string) => (await api.agents.ref(id).timeline.refetch({ limit: 100 })).entries.map((x: any) => x.item).filter((item: any) => item.type === 'plugin' && item.pluginId === 'tapd-workbench');
async function tool(name: string, input: any) {
  const result = await mcp.callTool({ name, arguments: input });
  assert.notEqual(result.isError, true); assert(!JSON.stringify(result).includes('presentationWarning')); return result;
}
async function eventually(check: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 30)); }
  assert.fail('Expected public conversation state was not reached');
}
const link = (id: string, project = '12345678') => `https://example.com/tapd_fe/${project}/story/detail/${id}`;
try {
  const staticDir = join(fixtureRoot, 'static'); await mkdir(staticDir, { recursive: true });
  daemon = await createTestPaseoDaemon({ paseoHomeRoot: fixtureRoot, staticDir, cleanup: false, pluginsEnabled: true, mcpEnabled: true, relayEnabled: false, daemonVersion: '0.13.2', agentClients: { codex: createTestAgentClient('codex', { supportsMcpServers: true }) } });
  await connect(); await client.installDirectoryPlugin(pluginDir);
  if (phase === 'A') {
    step = 'create-agents';
    const agent = await daemon.daemon.agentManager.createAgent({ provider: 'codex', cwd: fixtureRoot, modeId: 'full-access' }, undefined, { labels: {}, initialTitle: 'Example conversation' });
    const other = await daemon.daemon.agentManager.createAgent({ provider: 'codex', cwd: fixtureRoot, modeId: 'full-access' }, undefined, { labels: {}, initialTitle: 'Other conversation' });
    mcp = new Client({ name: 'tapd-lifecycle-acceptance', version: '1' });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${daemon.port}/mcp/agents?callerAgentId=${agent.id}`)));
    step = 'client-offline-read'; await disconnect();
    await tool('tapd_entity', { kind: 'story', id: '11111111' });
    await connect(); assert.equal(entities(await list(), agent.id).length, 1); assert.equal(entities(await list(), other.id).length, 0);
    step = 'ordinary-message-links';
    await client.sendAgentMessage(agent.id, `${link('55555555')} ${link('55555555', '87654321')} ${link('99999999', '99999999')}`);
    await eventually(async () => entities(await list(), agent.id).length === 3);
    assert.equal(entities(await list(), agent.id).filter((entity: any) => entity.id === '55555555').length, 2, 'Same number in distinct projects remains distinct');
    assert(entities(await list(), agent.id).filter((entity: any) => entity.id === '55555555').every((entity: any) => entity.title === ''), 'Link scanning must not read detail');
    step = 'batch-query';
    await tool('tapd_search', { query: '示例' });
    assert.equal(entities(await list(), agent.id).length, 3, 'Batch must not collect all rows');
    const batch = (await cards(agent.id)).find((row: any) => row.kind === 'tapd-batch-result'); assert(batch); assert.equal(batch.data.items.length, 5); assert(batch.data.returned > 5);
    const page = await rpc('tapd.conversation.batch_page', { agentId: agent.id, batchId: batch.data.batchId, siteUrl: batch.data.siteUrl, apiEndpoint: batch.data.apiEndpoint, offset: 5 });
    assert(page.items.length > 0);
    await rpc('tapd.conversation.focus', { agentId: agent.id, entity: { siteUrl: batch.data.siteUrl, apiEndpoint: batch.data.apiEndpoint, ...page.items[0] } });
    assert.equal(entities(await list(), agent.id).length, 4);
    step = 'explicit-writes';
    await tool('tapd_create', { kind: 'story', workspaceId: '12345678', title: '新建示例需求', description: '不应保存的正文', confirmed: true });
    await tool('tapd_add_comment', { kind: 'story', id: '11111111', workspaceId: '12345678', text: '不应保存的评论', confirmed: true });
    await tool('tapd_update_status', { kind: 'story', id: '11111111', workspaceId: '12345678', status: 'done', confirmed: true });
    const beforeCards = await cards(agent.id); assert.equal(beforeCards.length, 5);
    assert.deepEqual(beforeCards.filter((row: any) => row.kind === 'tapd-entity-result').map((row: any) => row.data.operation), ['read', 'create', 'comment', 'status']);
    step = 'remove-reload';
    const removed = entities(await list(), agent.id).find((entity: any) => entity.id === '55555555' && entity.workspaceId === '12345678');
    await rpc('tapd.conversation.remove', { agentId: agent.id, entity: removed });
    await client.reloadPlugin('tapd-workbench');
    const after = entities(await list(), agent.id); assert(!after.some((entity: any) => entity.id === removed.id && entity.workspaceId === removed.workspaceId));
    assert.deepEqual((await cards(agent.id)).map((row: any) => row.id), beforeCards.map((row: any) => row.id));
    await writeFile(join(fixtureRoot, 'fixture.json'), JSON.stringify({ agentId: agent.id, otherId: other.id, removed, entities: after, cards: beforeCards.map((row: any) => ({ id: row.id, kind: row.kind })), batch: batch.data }), { mode: 0o600 });
  } else if (phase === 'H') {
    step = 'other-host-does-not-restore-cards-or-tool-refs';
    const fixture = JSON.parse(await readFile(join(fixtureRoot, 'fixture.json'), 'utf8'));
    const state = await list();
    assert(entities(state, fixture.agentId).every((entity: any) => entity.id === '55555555' && entity.title === ''), 'Other hosts may independently recognize ordinary links but cannot inherit tool summaries');
    assert.equal((await cards(fixture.agentId)).length, 0);
    await assert.rejects(rpc('tapd.conversation.batch_page', { agentId: fixture.agentId, batchId: fixture.batch.batchId, siteUrl: fixture.batch.siteUrl, apiEndpoint: fixture.batch.apiEndpoint, offset: 5 }));
  } else {
    const fixture = JSON.parse(await readFile(join(fixtureRoot, 'fixture.json'), 'utf8'));
    step = 'restart-recovery';
    assert.deepEqual(entities(await list(), fixture.agentId), fixture.entities);
    assert.equal(entities(await list(), fixture.otherId).length, 0);
    assert.deepEqual((await cards(fixture.agentId)).map((row: any) => ({ id: row.id, kind: row.kind })), fixture.cards);
    const page = await rpc('tapd.conversation.batch_page', { agentId: fixture.agentId, batchId: fixture.batch.batchId, siteUrl: fixture.batch.siteUrl, apiEndpoint: fixture.batch.apiEndpoint, offset: 5 }); assert(page.items.length > 0);
    await assert.rejects(rpc('tapd.conversation.batch_page', { agentId: fixture.otherId, batchId: fixture.batch.batchId, siteUrl: fixture.batch.siteUrl, apiEndpoint: fixture.batch.apiEndpoint, offset: 5 }));
    step = 'new-message-recollect';
    await client.sendAgentMessage(fixture.agentId, link(fixture.removed.id));
    await eventually(async () => entities(await list(), fixture.agentId).some((entity: any) => entity.id === fixture.removed.id && entity.workspaceId === fixture.removed.workspaceId));
    step = 'archive-restore';
    const before = entities(await list(), fixture.agentId);
    await client.archiveAgent(fixture.agentId); step = 'archived-preserves'; assert.deepEqual(entities(await list(), fixture.agentId), before);
    step = 'restore-by-user-prompt'; await client.sendAgentMessage(fixture.agentId, '继续讨论');
    await eventually(async () => !(await api.agents.ref(fixture.agentId).refresh()).agent.archivedAt);
    assert.deepEqual(entities(await list(), fixture.agentId), before);
    step = 'delete';
    await client.deleteAgent(fixture.agentId); assert.equal(entities(await list(), fixture.agentId).length, 0); assert(!(await list()).conversations.some((row: any) => row.agentId === fixture.agentId));
    step = 'repeat-restore'; await client.reloadPlugin('tapd-workbench'); assert.equal((await list()).conversations.length, 0);
  }
  console.log(JSON.stringify({ ok: true, phase }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, phase, step, errorKind: error instanceof Error ? error.name : 'unknown' })); process.exitCode = 1;
} finally {
  await mcp?.close().catch(() => {}); await disconnect().catch(() => {}); await daemon?.close().catch(() => {});
}
