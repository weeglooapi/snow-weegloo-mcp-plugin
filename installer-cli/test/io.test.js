import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';

import { uploadServerCommand } from '../src/io.js';
import { NPM_REGISTRY } from '../src/cli.js';

const REGISTRY_FLAG = `--registry=${NPM_REGISTRY}`;

test('uploadServerCommand pins the internal registry BEFORE the package name', () => {
  // npx forwards everything after the package name to the server process, so a trailing
  // --registry would never reach npx — it would resolve `weegloo-upload` from the PUBLIC
  // registry (same name, higher version there) and launch the community build against our
  // internal upload endpoint. Silent failure, hence the ordering assertion.
  for (const platform of ['darwin', 'linux', 'win32']) {
    const { args } = uploadServerCommand({ platform });
    const flagAt = args.indexOf(REGISTRY_FLAG);
    const pkgAt = args.indexOf('weegloo-upload');
    assert.notEqual(flagAt, -1, `${platform}: registry flag present`);
    assert.notEqual(pkgAt, -1, `${platform}: package present`);
    assert.ok(flagAt < pkgAt, `${platform}: registry flag must precede the package name`);
  }
});

test('uploadServerCommand: npx on posix, cmd /c shim on win32', () => {
  assert.deepEqual(uploadServerCommand({ platform: 'linux' }), {
    command: 'npx',
    args: ['-y', REGISTRY_FLAG, 'weegloo-upload'],
    env: {},
  });
  // `npx` is `npx.cmd` on Windows — an MCP client spawning without a shell needs `cmd /c`.
  assert.deepEqual(uploadServerCommand({ platform: 'win32' }), {
    command: 'cmd',
    args: ['/c', 'npx', '-y', REGISTRY_FLAG, 'weegloo-upload'],
    env: {},
  });
});

test('uploadServerCommand injects PATH only for GUI hosts, and only on posix', () => {
  const execPath = path.join('/opt', 'node', 'v20.0.0', 'bin', 'node');
  const hosted = uploadServerCommand({ injectPath: true, execPath, platform: 'darwin' });
  assert.equal(hosted.env.PATH, `${path.dirname(execPath)}:/usr/bin:/bin`);
  // The registry pin survives PATH injection — the two concerns are independent.
  assert.deepEqual(hosted.args, ['-y', REGISTRY_FLAG, 'weegloo-upload']);

  assert.deepEqual(uploadServerCommand({ injectPath: false, execPath, platform: 'darwin' }).env, {});
  // Windows resolves node next to npx.cmd, so it never needs the PATH entry.
  assert.deepEqual(uploadServerCommand({ injectPath: true, execPath, platform: 'win32' }).env, {});
});
