// Real mainline daemon acceptance; no user home, credentials, provider or TAPD service.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mainDir = process.env.PASEO_MAIN_DIR;
assert(mainDir, 'Set PASEO_MAIN_DIR to the matching built mainline Paseo checkout');
const tsx = join(resolve(mainDir), 'node_modules/tsx/dist/cli.mjs');
await access(tsx);
const pluginDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = await mkdtemp(join(tmpdir(), 'tapd-daemon-acceptance-'));
let reads = 0;
const writes = [];
const mock = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  let data = [];
  if (request.method === 'POST') {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const body = new URLSearchParams(raw);
    writes.push({ path: url.pathname, project: body.get('workspace_id') });
    data = url.pathname === '/stories' ? { Story: { id: body.get('id') || '22222222' } } : {};
  } else {
    reads++;
    if (url.pathname === '/users/info') data = { nick: 'example-member', name: 'Example' };
    if (url.pathname.endsWith('/get_fields_info')) data = { status: { options: { open: '待处理', done: '已完成' } } };
    if (url.pathname === '/stories') data = url.searchParams.has('id')
      ? [{ Story: { id: url.searchParams.get('id'), name: '示例需求', status: 'open', description: '<p>不应保存的正文</p>' } }]
      : Array.from({ length: 5 }, (_, i) => ({ Story: { id: String(33333330 + i), name: '示例批量需求', status: 'open' } }));
    if (url.pathname === '/tasks' && !url.searchParams.has('story_id')) data = [{ Task: { id: '44444444', name: '示例批量任务', status: 'open' } }];
  }
  response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 1, data }));
});
let child;
try {
  await mkdir(join(fixtureRoot, '.paseo'), { mode: 0o700 });
  await mkdir(join(fixtureRoot, 'tmp'), { mode: 0o700 });
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
  const address = mock.address(); assert(address && typeof address === 'object');
  const env = Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'LD_LIBRARY_PATH', 'FONTCONFIG_FILE'].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
  Object.assign(env, { PASEO_MAIN_DIR: resolve(mainDir), PASEO_HOME: join(fixtureRoot, '.paseo'), TMPDIR: join(fixtureRoot, 'tmp'),
    PASEO_RELAY_ENABLED: 'false', PASEO_LOCAL_SPEECH_AUTO_DOWNLOAD: '0', PASEO_DICTATION_ENABLED: '0', PASEO_VOICE_MODE_ENABLED: '0', CI: 'true',
    TAPD_TOKEN: 'example-fixture-secret', TAPD_API_ENDPOINT: `http://127.0.0.1:${address.port}`, TAPD_SITE_URL: 'https://example.com', TAPD_WORKSPACE_IDS: '12345678,87654321' });
  const pids = [];
  let recoveryReads = 0;
  for (const phase of ['A', 'H', 'B']) {
    const before = reads;
    let output = '';
    child = spawn(process.execPath, [tsx, join(pluginDir, 'tests/fixtures/daemon-lifecycle.mts'), fixtureRoot, phase, pluginDir], { env: phase === 'H' ? { ...env, PASEO_SERVER_ID: 'example-other-host' } : env, stdio: ['ignore', 'pipe', 'pipe'] });
    pids.push(child.pid);
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-65536); });
    child.stderr.on('data', () => {});
    const timer = setTimeout(() => child.kill('SIGTERM'), 55000);
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    clearTimeout(timer);
    const line = output.split('\n').findLast(line => line.startsWith('{"ok":'));
    const report = line && JSON.parse(line);
    assert.equal(code, 0, `Isolated daemon phase ${phase} failed at ${report?.step ?? 'startup'}`);
    assert.equal(report?.ok, true);
    if (phase !== 'A') recoveryReads += reads - before;
  }
  assert.equal(new Set(pids).size, 3);
  assert.notEqual(pids[0], pids[2], 'Restart must launch a distinct process');
  assert.equal(recoveryReads, 0, 'Restoration and local navigation must not read TAPD');
  assert.deepEqual(writes, [{ path: '/stories', project: '12345678' }, { path: '/comments', project: '12345678' }, { path: '/stories', project: '12345678' }], 'Only the three explicitly confirmed operations may write, never replay');
  console.log(JSON.stringify({ ok: true, distinctDaemonProcesses: true, clientOffline: true, reload: true, archiveRestore: true, deletedCleanup: true, mixedCardsAndLinks: true, hostAgentProjectIsolation: true, oldRemovalPreserved: true, newMentionRecollected: true, recoveryTapdReads: recoveryReads, mockTapdReads: reads, explicitMockWrites: writes.length, replayedWrites: 0 }));
} finally {
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await new Promise(resolve => mock.close(resolve));
  await rm(fixtureRoot, { recursive: true, force: true });
}
