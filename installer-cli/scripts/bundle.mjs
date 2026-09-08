#!/usr/bin/env node
/**
 * Bundles the CLI into `dist/` so the PUBLISHED package has ZERO runtime dependencies.
 *
 * WHY THIS EXISTS: every install line we print pins `--registry` to the internal
 * Artifactory repo `npm-local`, and that pin governs the WHOLE install tree — not just
 * `weegloo`. `npm-local` is a LOCAL repository: it holds only what we publish and proxies
 * nothing, so a declared dependency on a public package is unresolvable there:
 *
 *   npm error 404 Not Found - GET .../npm-local/@inquirer%2fprompts
 *
 * That failure is invisible to anyone whose `~/.npm/_npx/<hash>/` tree already carries the
 * public packages from an earlier unpinned run — npx skips dependency resolution entirely
 * when the cached tree already satisfies the spec, and the cache key is the package SPEC,
 * not the registry — so it reproduces only on a COLD cache: a new machine, a new hire, CI,
 * or after `npm cache clean --force`.
 *
 * The fix keeps the registry pin (that pin is what stops a same-named PUBLIC `weegloo`,
 * currently at a much higher version, from being installed in place of this one) and
 * removes the reason it hurts: the public code is inlined HERE, at release time, on a
 * machine that can reach npmjs. An installing machine then needs nothing but `npm-local`.
 *
 * The bundled packages stay in `devDependencies` — the sources, the tests and `node bin.js`
 * still import them normally. Only the published artifact is bundled.
 *
 * `assertNoExternalImports` is the invariant that keeps the promise true: if a dependency is
 * ever marked external, or a new one arrives that esbuild cannot inline, the build fails
 * here instead of shipping a tarball that 404s on a stranger's laptop.
 *
 * Run by `npm run build`, by `prepack` (so no `npm publish`/`npm pack` can ship a stale or
 * missing `dist/`), and as an explicit step in scripts/release.mjs.
 */

import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(PACKAGE_ROOT, 'dist');
const ENTRY = 'bin.js';
const OUT = join(DIST, 'bin.js');
const LICENSES = join(DIST, 'THIRD-PARTY-LICENSES.txt');

/**
 * `dist/bin.js` sits exactly ONE level under the package root, same as `src/*.js`, so the
 * `require('../package.json')` in src/github.js resolves to the real package.json in BOTH
 * layouts. Changing this to a nested output directory would silently break `pluginRef`
 * resolution at runtime — the smoke test at the end of this script is what would catch it.
 */
const NODE_TARGET = 'node18'; // matches package.json "engines"

/**
 * Some transitive dependencies are CommonJS (`yoctocolors-cjs`, under @inquirer/core) and call
 * `require('node:tty')` at module init. Bundled into an ESM output there is no `require`, so
 * esbuild emits a shim that throws at startup:
 *
 *   Error: Dynamic require of "node:tty" is not supported
 *
 * The shim consults `typeof require` first, so defining one at module scope is all it needs.
 * ESM output is kept (package.json is "type": "module", and a CJS output would have to be
 * renamed .cjs and could not carry top-level await).
 *
 * This makes a *builtin* require work — it does NOT make a third-party one work, since the
 * published package has no node_modules. `assertNoExternalImports` scans these `__require`
 * calls too, so such a case fails the build rather than the user's install.
 */
const REQUIRE_SHIM = [
  "import { createRequire as __weeglooCreateRequire } from 'node:module';",
  'const require = __weeglooCreateRequire(import.meta.url);',
].join('\n');

// ── invariant checks (pure, unit-tested) ─────────────────────────────────────

/** Node builtins, in both spellings the sources use (`fs` and `node:fs`). */
const isBuiltin = (spec) => builtinModules.includes(String(spec).replace(/^node:/, '').split('/')[0]);

/**
 * Every module specifier the bundle still resolves at RUNTIME. Covers static
 * `import`/`export … from`, dynamic `import()`, and `require()` — including the
 * `__require`/`require2` shims esbuild emits for CommonJS interop and for a
 * `createRequire()` binding it cannot follow.
 * @param {string} code
 * @returns {string[]} unique specifiers, sorted
 */
export function externalSpecifiers(code) {
  const found = new Set();
  const patterns = [
    /(?:^|[^\w.$])(?:import|export)[^\n;]*?from\s*["']([^"']+)["']/g,
    /(?:^|[^\w.$])import\(\s*["']([^"']+)["']\s*\)/g,
    /(?:^|[^\w.$])(?:__require\d*|require\d*)\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) for (const m of code.matchAll(re)) found.add(m[1]);
  return [...found].sort();
}

/**
 * Fail the build unless every runtime specifier is a Node builtin or a relative path.
 * A bare third-party specifier surviving into `dist/` means npm would have to fetch it at
 * install time — the exact 404 this whole bundle exists to prevent.
 * @param {string} code
 */
export function assertNoExternalImports(code) {
  const bare = externalSpecifiers(code).filter((s) => !isBuiltin(s) && !s.startsWith('.') && !s.startsWith('/'));
  if (bare.length) {
    throw new Error(
      `bundle still resolves ${bare.length} third-party specifier(s) at runtime: ${bare.join(', ')}\n` +
      'The published package must depend on NOTHING — installs are pinned to a registry that ' +
      'cannot serve public packages. Inline it, or drop the dependency.'
    );
  }
}

/**
 * The third-party packages esbuild actually inlined, derived from the metafile inputs.
 * Uses the LAST `node_modules/` segment so nested (non-hoisted) copies are attributed to
 * the right package.
 * @param {{inputs: Record<string, unknown>}} metafile
 * @returns {Array<{name: string, dir: string}>} sorted by name, unique
 */
export function collectBundledPackages(metafile) {
  const MARK = 'node_modules/';
  const byName = new Map();
  for (const input of Object.keys(metafile?.inputs || {})) {
    const at = input.lastIndexOf(MARK);
    if (at < 0) continue;
    const parts = input.slice(at + MARK.length).split('/');
    const name = parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    if (!byName.has(name)) byName.set(name, { name, dir: input.slice(0, at + MARK.length) + name });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'LICENCE', 'LICENCE.md', 'COPYING'];

/**
 * Aggregate the licence text of every inlined package. Bundling copies third-party code
 * into our artifact, and the MIT/ISC terms it ships under require the notice to travel
 * with it — so the notice file is part of the build, not an afterthought.
 * @param {Array<{name: string, dir: string}>} packages
 * @returns {string}
 */
function renderLicenses(packages) {
  const out = [
    'Third-party licences',
    '',
    'The published `weegloo` CLI is a single bundled file (dist/bin.js) that inlines the',
    'packages listed below. Their licence terms follow, unmodified.',
    '',
    `Packages: ${packages.length}`,
    '',
  ];
  for (const { name, dir } of packages) {
    const abs = join(PACKAGE_ROOT, dir);
    let version = '';
    try {
      version = JSON.parse(readFileSync(join(abs, 'package.json'), 'utf8')).version || '';
    } catch { /* keep going: a missing package.json only costs us the version line */ }
    out.push('='.repeat(78), `${name}${version ? `@${version}` : ''}`, '');
    const file = existsSync(abs) ? LICENSE_FILES.find((f) => existsSync(join(abs, f))) : null;
    if (file) {
      out.push(readFileSync(join(abs, file), 'utf8').trimEnd());
    } else {
      let spdx = 'UNKNOWN';
      try {
        spdx = JSON.parse(readFileSync(join(abs, 'package.json'), 'utf8')).license || 'UNKNOWN';
      } catch { /* leave it UNKNOWN — better a visible gap than a fabricated licence */ }
      out.push(`No licence file shipped in the package. Declared licence: ${spdx}.`);
    }
    out.push('');
  }
  return out.join('\n');
}

// ── build ────────────────────────────────────────────────────────────────────

async function main() {
  rmSync(DIST, { recursive: true, force: true }); // a stale dist/ must never reach the tarball
  mkdirSync(DIST, { recursive: true });

  const result = await build({
    absWorkingDir: PACKAGE_ROOT,
    entryPoints: [ENTRY],
    outfile: OUT,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: NODE_TARGET,
    metafile: true,
    // Not minified on purpose: the published file is what a security review reads, and the
    // inlined licence comments stay legible. Size is irrelevant for a one-shot npx download.
    logLevel: 'warning',
    banner: { js: REQUIRE_SHIM },
  });

  const code = readFileSync(OUT, 'utf8');
  assertNoExternalImports(code);

  const packages = collectBundledPackages(result.metafile);
  writeFileSync(LICENSES, renderLicenses(packages));

  chmodSync(OUT, 0o755); // `bin` entry: npm links it, so it has to be executable

  // Smoke test the ARTIFACT, not the sources. Catches a broken `../package.json` resolution,
  // a mangled shebang, or an inlined module that throws at init — none of which the unit
  // tests (which import from src/) can see.
  const smoke = spawnSync(process.execPath, [OUT, '--help'], { encoding: 'utf8' });
  if (smoke.status !== 0 || !/Weegloo MCP Plugin Installer/.test(smoke.stdout || '')) {
    throw new Error(
      `bundle failed its smoke test (exit ${smoke.status}):\n${smoke.stderr || smoke.stdout || '(no output)'}`
    );
  }

  const kb = (code.length / 1024).toFixed(0);
  console.log(`✔ bundled  dist/bin.js  ${kb} kB  ·  ${packages.length} package(s) inlined  ·  0 runtime dependencies`);
  console.log('✔ licences dist/THIRD-PARTY-LICENSES.txt');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`\n✖ bundle failed: ${err.message}\n`);
    process.exit(1);
  });
}
