---
name: weegloo-npm-publish
description: Publish the weegloo installer CLI (installer-cli/) to the internal Artifactory npm registry. A release script does all the deterministic work (auth, registry pinning, branch/version/dirty checks, tests, publish); this skill only drives the single human decision — picking the release (which doubles as publish approval) — and commits the version bump afterward. Use when the user wants to release/publish the weegloo npm package, ship a new installer CLI version, run `npm publish` for installer-cli, or "버전 올리고 배포".
---

# weegloo npm publish

Publishes the `weegloo` npm package from `installer-cli/` (no publish CI exists).

**Almost everything here is a script.** `installer-cli/scripts/release.mjs` absorbs every
deterministic step — config (read from `package.json`), npm auth, branch/dirty checks,
published-vs-current version comparison, tests, the actual `npm publish`, and the final report.
Run it from `installer-cli/`.

**Target registry.** This fork publishes to the **internal** registry in `package.json`
`publishConfig.registry`, and the script pins every npm call to it. Do not undo that: the
**public** npm registry carries a *different* `weegloo` package at a **higher** version, so an
unpinned `npm view` reads that one and the version comparison falsely reports "registry ahead"
and refuses to publish. If a number in the status block looks impossible, check the `registry`
line first.

Your job is only the **one decision** the script won't make on its own — **which bump**, when
one is needed (`NEEDS_BUMP`). When the version is already ahead (`READY`), there's nothing to
decide, so just publish. Either way the script never publishes without an explicit `--yes`.
After a successful publish you also **commit the version bump** so the repo doesn't fall behind
the registry.

Pushing stays the user's call — this skill commits the bump but never pushes.

## 1. Preflight (script) — read the verdict

```bash
cd installer-cli
node scripts/release.mjs preflight        # or: npm run preflight   (add --json to parse)
```

The script prints a status block and one **verdict**:

- **`BLOCKED`** → surface the listed blocker(s) to the user in Korean and stop. Common cases:
  - *not authenticated to the registry* → the script accepts **either** mechanism, and tries them in this order:
    1. **An ambient credential in `~/.npmrc`** for that registry (`//<host>/<path>:_authToken=…`). This is the normal developer setup here — when it works, `NPM_TOKEN` is **not** needed and its absence is **not** a blocker.
    2. **`NPM_TOKEN`** (env, or a gitignored `.env` in `installer-cli/` or the repo root) together with an `installer-cli/.npmrc` that resolves `${NPM_TOKEN}` — the CI shape.

    So when this blocks, **both** are missing or wrong. The credential is the one thing that must come from the user: tell them (Korean) to generate a token from their **Artifactory user profile** (Edit Profile → identity token / API key). Don't paste a memorized deep link — look up the current one, or just name the menu path. Then offer **two paths — do not pick for them**:
    - **(a) 붙여넣어 주시면 제가 파일에 기록** — the user pastes the token and you write it yourself. Recommended first option (mirrors the weegloo-upload token rule: edit the file for them rather than making them do it).
    - **(b) 직접 넣기** — the user edits `~/.npmrc` or `installer-cli/.env` themselves.
    - **Writing it for them (path a) — safely:**
      1. **Confirm the target is gitignored** before writing (`installer-cli/.gitignore` already ignores `.env` and `.npmrc`). `~/.npmrc` is outside the repo, so it is never tracked. Never write a token to a tracked file.
      2. For the `NPM_TOKEN` path, write/update `NPM_TOKEN=<value>` in **`installer-cli/.env`** — **replace an existing `NPM_TOKEN` line** rather than appending a duplicate, and leave other vars untouched.
      3. **Never echo the token back** to chat, never commit it, never print it in a command. When you must load it, source the file (`set -a; . installer-cli/.env; set +a`) — don't inline the value.
    - Then **re-run preflight** — `npm whoami --registry=…` verifies the credential actually works against *this* registry.
  - *`npm whoami` failed* → the credential is wrong/expired **for that registry** (a valid public-npm token still fails here). Same two paths as above, then re-run preflight.
  - *registry ahead (published > current)* → do **not** overwrite; that registry has a newer version. Surface it and stop. First sanity-check the `registry` line — reading the wrong registry is the usual cause of a surprising "ahead".
- **`NEEDS_BUMP`** → published == current. The status block lists the resolved numbers for each bump (`patch → x.y.z`, `minor`, `major`) — also in `nextVersions` under `--json`.
- **`READY`** → current > published (or first publish). No bump needed.

Warnings (dirty tree, branch ≠ dist-tag) are shown but do **not** block — mention them and let the user decide whether to continue.

## 2. Bump / publish — ask only when there's a real decision

The user invoked a **publish** skill, so shipping is the intent. Only ask when there's genuinely something to decide.

- **`NEEDS_BUMP`** (published == current) → there IS a decision: which bump. Ask one question, showing the resolved numbers from the status block:
  *"이번 릴리스로 배포할까요? patch → x.y.z / minor → … / major → … / custom"* — the user's pick is the publish approval. Do **not** pick for them.
- **`READY`** (local > published, or first publish) → **nothing to decide — just publish.** The version was already bumped deliberately and the invocation is the go-ahead, so don't add a confirm. Instead **announce what you're shipping — version, dist-tag, current branch, and the registry** — in one line so a genuinely wrong state is visible before it runs, e.g. *"1.5.6을 latest 태그로 (latest 브랜치에서) 사내 artifactory 에 배포합니다"*, then run it.
  - Don't gate on the `branch ≠ dist-tag` or `dirty tree` warnings here: releasing from `develop` first, and an uncommitted bump, are both normal in this repo's flow — they'd be false alarms every release. Just include the branch in the announcement so it's never hidden. The script's required `--yes` remains the real backstop.

Tests run inside `release` and abort before publish if they fail — nothing ships on a red build. The
`dist/` bundle is then built and smoke-tested, also before the publish gate, so a broken bundle
stops the release instead of shipping.

Then publish in one shot:

```bash
node scripts/release.mjs release --bump <patch|minor|major|x.y.z> --yes   # NEEDS_BUMP
node scripts/release.mjs release --yes                                    # READY (no bump)
```

`--bump` and `--yes` are two **safety flags** the script requires together (it never publishes without both) — but that is one *human* turn, not two. Without `--yes` the script only prints a plan; use that for a dry run if asked. The script bumps `package.json`, runs `npm test`, builds the `dist/` bundle, publishes `npm publish --tag <distTag> --registry=<publishConfig.registry>`, and reports the version, tag, registry, and the `npx -y --registry=… weegloo@<tag>` command that installs it. (`--access public` is sent only when the target really is npmjs; it is an npmjs-only concept.)

## 3. Commit the bump (after publish succeeds)

If a bump happened, the published version MUST be committed — otherwise the repo's `package.json` falls behind the registry (the "registry ahead" drift). The script deliberately does **not** touch git; **you (the skill) commit** it here:

```bash
git add installer-cli/package.json installer-cli/package-lock.json
git commit -m "chore(release): weegloo@<version>"
```

Commit only — **do not push**; pushing stays the user's call (verify the branch/remote first). Tell the user the commit was made and that they should push it. For a real release this should land on the branch matching the dist-tag (`latest`), so confirm the branch before committing if it doesn't match.

## Notes

- **Secrets:** a credential lives either in `~/.npmrc` (outside the repo) or as `NPM_TOKEN` in the environment / a gitignored `.env` (repo root or `installer-cli/`), with `installer-cli/.npmrc` resolving `${NPM_TOKEN}`. Both `.npmrc` and `.env` are gitignored — never commit or print the token. The `${NPM_TOKEN}`-resolving `.npmrc` is only required for the `NPM_TOKEN` path, so preflight warns about it only when auth actually came from `NPM_TOKEN`.
- **What ships:** only `dist/` (`files` field) — a single bundled `dist/bin.js` plus its licence notice. `bin.js`, `src/` and `scripts/` are **not** published, and the package declares **zero runtime dependencies** on purpose: installs are pinned to the internal `npm-local` registry, which cannot serve the public packages the sources import (`@inquirer/prompts`, `chalk`, `ora`), so a declared dependency 404s on any machine with a cold npx cache. `scripts/bundle.mjs` inlines them at release time and fails the build if any third-party specifier survives. Never move those three back to `dependencies`, and never publish with `npm publish` from a tree where `npm run build` has not run (`prepack` runs it for you). Skills/rules are still fetched at runtime from the GitHub branch, so no manifest rebuild is needed before publishing.
- **`pluginRef`** in `package.json` maps the npm dist-tag ⇄ git **branch** (both `latest`). The installer fetches skills/rules from that branch, so the branch must hold the intended content before publishing. The script derives `distTag` from `pluginRef`; override with `--dist-tag` for a `beta` release.
- Flags: `--no-tests` skips `npm test`; `--json` makes preflight machine-readable.
