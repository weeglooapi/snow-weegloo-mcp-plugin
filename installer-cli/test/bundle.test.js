import { test } from 'node:test';
import assert from 'node:assert/strict';

import { externalSpecifiers, assertNoExternalImports, collectBundledPackages } from '../scripts/bundle.mjs';

// ── externalSpecifiers: what the bundle would still resolve at runtime ──

test('externalSpecifiers: finds static, dynamic, and require() specifiers', () => {
  const code = `
    import fs from "node:fs";
    import chalk from "chalk";
    export { x } from './local.js';
    const m = await import("ora");
    var tty = __require("node:tty");
    const p = require2("../package.json");
  `;
  assert.deepEqual(externalSpecifiers(code), [
    '../package.json', './local.js', 'chalk', 'node:fs', 'node:tty', 'ora',
  ]);
});

test('externalSpecifiers: a property call named import/require is not a specifier', () => {
  // The scan is textual, not a parse: it deliberately errs toward FLAGGING (a false positive
  // fails the build, which is recoverable; a false negative ships a tarball that 404s). What
  // it must not do is trip over member calls that merely share the name.
  assert.deepEqual(externalSpecifiers('obj.import("chalk"); foo.require("ora"); a.b.require("ora");'), []);
});

// ── assertNoExternalImports: the invariant that keeps installs dependency-free ──

test('assertNoExternalImports: passes for builtins and relative paths only', () => {
  const code = `import fs from "fs"; import path from "node:path"; import x from "./a.js"; require2("../package.json");`;
  assert.doesNotThrow(() => assertNoExternalImports(code));
});

test('assertNoExternalImports: throws, and names every offender, on a third-party specifier', () => {
  const code = `import chalk from "chalk"; import ora from "ora"; import fs from "node:fs";`;
  assert.throws(() => assertNoExternalImports(code), (err) => {
    assert.match(err.message, /chalk/);
    assert.match(err.message, /ora/);
    assert.doesNotMatch(err.message, /node:fs/);
    return true;
  });
});

test('assertNoExternalImports: a scoped or deep-path dependency is still an offender', () => {
  assert.throws(() => assertNoExternalImports('import { select } from "@inquirer/prompts";'), /@inquirer\/prompts/);
  assert.throws(() => assertNoExternalImports('import x from "lodash/get.js";'), /lodash\/get\.js/);
});

// A builtin's submodule (`node:stream/promises`, `fs/promises`) resolves without npm, so it
// must not be mistaken for a package path.
test('assertNoExternalImports: builtin submodules are not third-party', () => {
  assert.doesNotThrow(() => assertNoExternalImports('import { pipeline } from "node:stream/promises"; import fsp from "fs/promises";'));
});

// ── collectBundledPackages: attribution for the licence notice ──

test('collectBundledPackages: unique, sorted, scoped names handled', () => {
  const metafile = { inputs: {
    'bin.js': {},
    'src/index.js': {},
    'node_modules/chalk/source/index.js': {},
    'node_modules/chalk/source/vendor/x.js': {},
    'node_modules/@inquirer/prompts/dist/esm/index.js': {},
    'node_modules/@inquirer/core/dist/esm/lib/a.js': {},
    'node_modules/ora/index.js': {},
  } };
  assert.deepEqual(collectBundledPackages(metafile).map((p) => p.name), [
    '@inquirer/core', '@inquirer/prompts', 'chalk', 'ora',
  ]);
});

test('collectBundledPackages: a nested copy is attributed to the inner package, with its own dir', () => {
  const metafile = { inputs: { 'node_modules/ora/node_modules/chalk/index.js': {} } };
  const [pkg] = collectBundledPackages(metafile);
  assert.equal(pkg.name, 'chalk');
  assert.equal(pkg.dir, 'node_modules/ora/node_modules/chalk');
});

test('collectBundledPackages: no third-party inputs → empty list', () => {
  assert.deepEqual(collectBundledPackages({ inputs: { 'bin.js': {}, 'src/cli.js': {} } }), []);
  assert.deepEqual(collectBundledPackages({}), []);
});
