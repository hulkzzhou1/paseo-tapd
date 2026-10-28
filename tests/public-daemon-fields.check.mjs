// Isolated real daemon/worker over public package exports; only loopback TAPD fixtures.
// PASEO_RUNTIME_DIR points to a trusted built Paseo checkout, used read-only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, realpath, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir, homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const self = fileURLToPath(import.meta.url);
const pluginDir = resolve(dirname(self), '..');
const target = { kind: 'story', workspaceId: '12345678', id: '11111111', fieldKey: 'custom_field_example' };
const original = '  <p>人工段落 &amp; 原文</p>\n';
const updated = '  <p>人工段落 &amp; 新方案</p>\n';
const [phase, fixtureRoot] = process.argv.slice(2);
assert(process.env.PASEO_RUNTIME_DIR, 'Set PASEO_RUNTIME_DIR to a compatible built Paseo checkout');

async function runDaemonPhase() {
  assert.equal(await readFile(join(homedir(), 'tapd-test-home-marker'), 'utf8'), 'isolated');
  assert(['write', 'restart'].includes(phase));
  assert.equal(process.env.PASEO_HOME, join(fixtureRoot, 'home'));
  const req = createRequire(join(resolve(process.env.PASEO_RUNTIME_DIR), 'packages/cli/package.json'));
  const publicImport = name => import(pathToFileURL(req.resolve(name)).href);
  const { createPaseoDaemon, loadPersistedConfig, BUILTIN_PROVIDER_IDS } = await publicImport('@getpaseo/server');
  const { createHostClient } = await publicImport('@getpaseo/client/node');
  const logger = req('pino')({ level: 'silent' });
  const home = process.env.PASEO_HOME;
  const persisted = loadPersistedConfig(home, logger); // Only this test's newly created home.
  const daemon = await createPaseoDaemon({
    listen: '127.0.0.1:0', paseoHome: home, daemonVersion: req(join(resolve(process.env.PASEO_RUNTIME_DIR), 'packages/server/package.json')).version,
    staticDir: join(fixtureRoot, 'static'), agentStoragePath: join(home, 'agents'), corsAllowedOrigins: [],
    mcpDebug: false, mcpEnabled: false, relayEnabled: false, browserToolsEnabled: false,
    pluginsEnabled: true, plugins: persisted.plugins, agentClients: {},
    providerOverrides: Object.fromEntries(BUILTIN_PROVIDER_IDS.map(id => [id, { enabled: false }])),
    skillSelection: { mode: 'custom', skills: [] }, metadataGeneration: { providers: [] }, idleRuntimeCleanup: false, webUi: { enabled: false, distDir: null },
  }, logger);
  let client;
  try {
    await daemon.start();
    const listen = daemon.getListenTarget(); assert.equal(listen.type, 'tcp');
    client = createHostClient(`127.0.0.1:${listen.port}`, {
      clientId: 'example-validation', clientType: 'cli', logger, reconnect: { enabled: false },
    });
    await client.connect();
    if (phase === 'write') await client.installDirectoryPlugin(pluginDir);
    assert.equal((await client.listPlugins()).find(p => p.id === 'tapd-workbench')?.status, 'running');
    const rpc = (method, input) => client.invokePluginRpc('tapd-workbench', `tapd.${method}`, input);
    const read = () => rpc('read_field', target);
    if (phase === 'write') {
      const metadata = await rpc('field_definitions', { kind: 'story', workspaceId: target.workspaceId });
      assert.deepEqual(metadata.fields.map(f => [f.key, f.readonly, f.supported]), [[target.fieldKey, false, true]]);
      assert.equal((await read()).value, original);
      const result = await rpc('update_field', { ...target, expectedValue: original, value: updated, confirmed: true });
      assert.equal(result.outcome, 'verified'); assert.equal(result.writeState, 'accepted');
      await assert.rejects(rpc('update_field', { ...target, expectedValue: original, value: 'stale', confirmed: true }));
      await assert.rejects(rpc('update_field', { ...target, expectedValue: updated, value: 'reject-fixture', confirmed: true }), error =>
        !error.message.includes('private-fixture') && !error.message.includes('example-fixture-secret'));
      const unverified = await rpc('update_field', { ...target, expectedValue: updated, value: 'normalize-fixture ', confirmed: true });
      assert.equal(unverified.outcome, 'unverified'); assert.equal(unverified.writeState, 'accepted');
      assert.equal((await read()).value, 'normalize-fixture');
      const clear = await rpc('update_field', { ...target, expectedValue: 'normalize-fixture', value: '', confirmed: true });
      assert.equal(clear.outcome, 'verified');
      await client.reloadPlugin('tapd-workbench');
    }
    assert.equal((await read()).value, '');
    assert.deepEqual(await rpc('agent_status', { agentIds: [] }), { items: [] });
    console.log(JSON.stringify({ ok: true, phase }));
  } finally { await client?.close(); await daemon.stop(); }
}

async function runIsolated() {
  const root = await mkdtemp(join(tmpdir(), 'tapd-public-daemon-'));
  const writes = [], reads = [];
  let value = original, child, fixtureError;
  const mock = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      assert(['/stories', '/stories/get_fields_info'].includes(url.pathname));
      let data;
      if (request.method === 'POST') {
        let raw = ''; for await (const chunk of request) raw += chunk;
        const body = new URLSearchParams(raw);
        assert.deepEqual([...body.keys()].sort(), ['workspace_id', 'id', target.fieldKey].sort());
        assert.equal(body.get('workspace_id'), target.workspaceId); assert.equal(body.get('id'), target.id);
        writes.push(body.get(target.fieldKey));
        if (body.get(target.fieldKey) === 'reject-fixture') {
          response.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 0, info: 'private-fixture example-fixture-secret' })); return;
        }
        value = body.get(target.fieldKey) === 'normalize-fixture ' ? 'normalize-fixture' : body.get(target.fieldKey);
        data = { Story: { id: target.id } };
      } else {
        reads.push(url.pathname);
        data = url.pathname.endsWith('get_fields_info')
          ? { [target.fieldKey]: { label: '示例方案', html_type: 'rich_edit', readonly: 0 } }
          : [{ Story: { id: target.id, workspace_id: target.workspaceId, name: '示例需求', [target.fieldKey]: value } }];
      }
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 1, data }));
    } catch (error) { fixtureError = error; response.writeHead(500).end(); }
  });
  try {
    await mkdir(join(root, 'home'), { mode: 0o700 }); await mkdir(join(root, 'static'));
    await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
    const env = Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'LD_LIBRARY_PATH', 'FONTCONFIG_FILE'].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
    Object.assign(env, { PASEO_RUNTIME_DIR: resolve(process.env.PASEO_RUNTIME_DIR), PASEO_HOME: join(root, 'home'),
      PASEO_RELAY_ENABLED: 'false', PASEO_LOCAL_SPEECH_AUTO_DOWNLOAD: '0', PASEO_DICTATION_ENABLED: '0', PASEO_VOICE_MODE_ENABLED: '0',
      TAPD_TOKEN: 'example-fixture-secret', TAPD_API_ENDPOINT: `http://127.0.0.1:${mock.address().port}`, TAPD_SITE_URL: 'https://example.com', TAPD_WORKSPACE_IDS: target.workspaceId });
    const pids = [];
    for (const stage of ['write', 'restart']) {
      let output = '';
      child = spawn(process.execPath, [self, stage, root], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      pids.push(child.pid);
      child.stdout.on('data', chunk => { output = (output + chunk).slice(-8192); });
      child.stderr.on('data', () => {});
      const timer = setTimeout(() => child.kill('SIGTERM'), 45_000);
      const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
      clearTimeout(timer);
      const line = output.split('\n').findLast(line => line.startsWith('{"ok":'));
      const report = line && JSON.parse(line);
      assert.equal(code, 0, `Public daemon phase ${stage}: ${report?.errorKind ?? 'startup failed'}`);
      assert.equal(report?.ok, true);
      assert.deepEqual(writes, [updated, 'reject-fixture', 'normalize-fixture ', ''], 'No retry, stale write or reload/restart replay');
    }
    assert.ifError(fixtureError);
    assert.equal(new Set(pids).size, 2);
    console.log(JSON.stringify({ ok: true, distinctDaemonProcesses: true, publicExportsOnly: true, fieldRpc: true,
      conflict: true, safeRejection: true, acceptedUnverified: true, explicitClear: true, reload: true, restart: true,
      mockTapdReads: reads.length, explicitMockWrites: writes.length, replayedWrites: 0 }));
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await new Promise(resolve => mock.close(resolve)); await rm(root, { recursive: true, force: true });
  }
}
async function runInMountNamespace() {
  const root = await mkdtemp(join(tmpdir(), 'tapd-daemon-sandbox-'));
  try {
    await mkdir(join(root, 'user')); await mkdir(join(root, 'tmp'));
    await writeFile(join(root, 'user', 'tapd-test-home-marker'), 'isolated');
    const runtime = resolve(process.env.PASEO_RUNTIME_DIR);
    const deps = await realpath(join(pluginDir, 'node_modules'));
    const nodeRoot = dirname(dirname(process.execPath));
    // The daemon maintains user-level skills on startup; isolate the actual home too.
    const setup = `set -eu
sandboxRoot=$1
userRoot=$2
runtimeRoot=$3
pluginRoot=$4
depsRoot=$5
nodeRoot=$6
nodeExecutable=$7
mount --make-rprivate /
mkdir -p "$sandboxRoot/mounts"
for part in runtime plugin deps node; do mkdir "$sandboxRoot/mounts/$part"; done
mount --bind "$runtimeRoot" "$sandboxRoot/mounts/runtime"
mount --bind "$pluginRoot" "$sandboxRoot/mounts/plugin"
mount --bind "$depsRoot" "$sandboxRoot/mounts/deps"
mount --bind "$nodeRoot" "$sandboxRoot/mounts/node"
for part in runtime plugin deps node; do
  mount -o remount,bind,ro "$sandboxRoot/mounts/$part"
  test ! -w "$sandboxRoot/mounts/$part"
done
mount --bind "$sandboxRoot/user" "$userRoot"
if [ "$userRoot" != /root ]; then mount --bind "$sandboxRoot/user" /root; fi
mkdir -p "$runtimeRoot" "$pluginRoot" "$depsRoot" "$nodeRoot"
mount --bind "$sandboxRoot/mounts/runtime" "$runtimeRoot"
mount --bind "$sandboxRoot/mounts/plugin" "$pluginRoot"
mount --bind "$sandboxRoot/mounts/deps" "$depsRoot"
mount --bind "$sandboxRoot/mounts/node" "$nodeRoot"
for path in "$runtimeRoot" "$pluginRoot" "$depsRoot" "$nodeRoot"; do
  mount -o remount,bind,ro "$path"
  test ! -w "$path"
done
cd "$sandboxRoot"
exec "$nodeExecutable" "$pluginRoot/tests/public-daemon-fields.check.mjs" sandbox
`;
    const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, LANG: 'C.UTF-8',
      PASEO_RUNTIME_DIR: runtime, TMPDIR: join(root, 'tmp') };
    const child = spawn('unshare', ['--user', '--map-root-user', '--mount', 'bash', '-c', setup,
      'tapd-daemon-test', root, homedir(), runtime, pluginDir, deps, nodeRoot, process.execPath], { env, stdio: 'inherit' });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    assert.equal(code, 0, 'Isolated mount namespace check failed (requires Linux user/mount namespaces)');
  } finally { await rm(root, { recursive: true, force: true }); }
}
(phase === 'sandbox' ? runIsolated() : phase ? runDaemonPhase() : runInMountNamespace()).catch(error => {
  console.log(JSON.stringify({ ok: false, phase: phase ?? 'parent', errorKind: `${error.name}:${error.code ?? ''}`, message: error instanceof assert.AssertionError ? error.message : 'Isolated runtime check failed' }));
  process.exitCode = 1;
});
