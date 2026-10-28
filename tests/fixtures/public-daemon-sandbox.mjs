import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {dirname,join,resolve} from 'node:path';

export async function runPublicDaemonSandbox(self, pluginDir) {
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
testScript=$8
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
exec "$nodeExecutable" "$testScript" sandbox
`;
    const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, LANG: 'C.UTF-8',
      PASEO_RUNTIME_DIR: runtime, TMPDIR: join(root, 'tmp') };
    const child = spawn('unshare', ['--user', '--map-root-user', '--mount', 'bash', '-c', setup,
      'tapd-daemon-test', root, homedir(), runtime, pluginDir, deps, nodeRoot, process.execPath, self], { env, stdio: 'inherit' });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    assert.equal(code, 0, 'Isolated mount namespace check failed (requires Linux user/mount namespaces)');
  } finally { await rm(root, { recursive: true, force: true }); }
}
