<div align="center">

# ⚡ ntsx

[![CI](https://github.com/itskreisler/ntsx/actions/workflows/ci.yml/badge.svg)](https://github.com/itskreisler/ntsx/actions)
[![npm](https://img.shields.io/npm/v/@kreisler/ntsx)](https://www.npmjs.com/package/@kreisler/ntsx)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](/LICENSE)

**Run any Node/TS script with ephemeral dependencies — no `npm install`, no project pollution.**

```bash
ntsx run --with chalk -e "import c from 'chalk'; console.log(c.green('hello world'))"
```

**Plant, run, restore. Your `node_modules` stays exactly as it was.**
*`uv --with`, but for Node.js.*

> 🌐 [Español](/README-es.md)

---

<p>
  <b>npm run</b> ·
  <b>tsx</b> ·
  <b>npx</b> ·
  <b>uv --with</b> ·
  <b>Node ≥ 22</b>
</p>

</div>

---

## What is this?

`ntsx` runs a script (`.js`, `.ts`, `.tsx`, or inline code with `-e`) with **ephemeral
dependencies**: it installs them on the fly into an isolated cache (`~/.cache/ntsx`), links them
through a temporary `node_modules`, and **restores your real `node_modules` when done**.

A snippet, a scraper, a throwaway API, a QR in your terminal... **without ever touching the
`package.json`** of your project. Like `uv --with`, but for Node.

```bash
# a script that needs deps you DON'T have installed
ntsx run --with axios --with jsdom examples/scrape.ts

# inline code, without creating a single file
ntsx run --with qrcode -e "import QR from 'qrcode'; QR.toString('https://npmjs.com/package/@kreisler/ntsx', {type:'terminal', small:true}).then(console.log)"

# pinned versions
ntsx run --with chalk@^4 script.js arg1

# pin Node version
ntsx run --node 24 script.ts

# generate lockfile
ntsx lock script.ts

# run ephemeral tool
ntsx tool prettier --write script.ts

# pass args to the script
ntsx run --with axios diario.ts --fecha hoy
```

## Why ntsx over <del>npx/tsx/npm</del>?

| What you want to do | npx | tsx | ntsx |
|---|---|---|---|
| Run TS without installing anything | ❌ no transpile | ✅ | ✅ |
| Use a dep you don't have installed | ⚠️ `npx -p chalk` (ugly) | ❌ needs `npm i` | ✅ `--with chalk` |
| Repeatable, pinned versions | ⚠️ | ❌ | ✅ `--with @scope/pkg@^2` |
| Never touch your `package.json` | ✅ | ❌ | ✅ |
| Never break your `node_modules` | ❌ often leaves a mess | ⚠️ | ✅ (restored) |
| Cache reused across runs | ⚠️ | ❌ | ✅ `~/.cache/ntsx` |

**Flag order**: everything **before** the script is for the runner, everything **after** goes to the
script (same as tsx):

```bash
ntsx run --tsx-args "--tsconfig=tsconfig.custom.json" src/main.ts --verbose
#                       ↑ runner flags                    ↑ script flags
```

**Eval args with `-e`**: inline code uses the classic `node -e` / `tsx -e` convention — script
arguments go **after** a `--` separator (flags like `-h` or `--name=x` are otherwise claimed by the
CLI or by node itself):

```bash
ntsx run --with argv2object -e "import a from 'argv2object'; console.log(a())" -- -h --name=Kreisler --is-admin
#                                                                          ↑ script args
```

## Real examples (tested ✅)

```bash
# 🕷️ Scraper with axios + jsdom
ntsx run --with axios --with jsdom examples/scrape.ts https://example.com
# title:  Example Domain
# h1:     Example Domain
# links:  1

# 📟 Scanable QR straight in your terminal
ntsx run --with qrcode examples/qr.ts "https://npmjs.com/package/@kreisler/ntsx"

# 🚀 Express API
ntsx run --with express examples/express-api.ts

# ⚡ Hono API (+ native node server)
ntsx run --with @hono/node-server --with hono examples/hono-api.ts

# 🛠️ Complex stacks (Express + Axios + CORS + Multer + Zod)
ntsx run --with express --with axios --with cors --with multer --with zod examples/21-express-stack.ts

# 🔐 Hono + JOSE JWT authentication
ntsx run --with hono --with @hono/node-server --with jose examples/22-hono-jwt.ts

# 🔑 TOTP + QR Code generator (Axios + OTPAuth + QRCode)
ntsx run --with axios --with otpauth --with qrcode examples/23-otpauth-qr.ts

# 🎯 Script argument pass-through
ntsx run --with argv2object examples/24-argv.ts --name=Kreisler archivo.txt --debug

# 🎯 Inline eval + script args (use -- to separate)
ntsx run --with argv2object -e "import a from 'argv2object'; console.log(a(true))" -- -h --help --name=Kreisler --is-admin
```

### Long-running servers: `ntsx` + pm2

`ntsx` runs the runner in an async `spawn` and **restores `node_modules` even when killed** by
`SIGINT`/`SIGTERM` (Ctrl+C or `pm2 stop`). So your server lives 24/7 and your project stays clean:

```bash
pm2 start node --name api -- dist/ntsx.js run --with express examples/express-api.ts
pm2 list
curl http://localhost:3000/
pm2 stop api       # → the original node_modules comes back
```

## How it works

```
ntsx run --with chalk -e "..."
        │
        ▼
┌─ 1. hash the workspace + deps ────────────────┐
│   ~/.cache/ntsx/<workspaceHash>/<depsHash>/  │
├─ 2. already installed? ──► yes → skip npm i ─┤
│   no → package.json + npm install (isolated)  │
├─ 3. stash YOUR node_modules (temporary `.bak`)┤
│   and symlink the ephemeral deps in place     │
├─ 4. run: .ts→tsx · .js→node · eval→tsx ──────┤
│   (or `--eval-runtime node` for plain node)   │
└─ 5. ALWAYS restore YOUR node_modules! ────────┘
```

**Guaranteed integrity**: your real `node_modules` is stashed as `.ntsx-<ts>.bak`, the cache is
symlinked in, and when the run ends (signals included) it is restored. It is never destroyed.
**Orphaned symlinks from a crash self-heal** on the next run.

> From the second run on it's **instant** (the cache already has the deps).

## Cache management

```bash
ntsx cache stats            # workspaces + size
ntsx cache dir              # print absolute cache path
ntsx cache clean            # asks for confirmation
ntsx cache clean --force    # nukes it mercilessly
ntsx cache prune            # clean up orphaned cache items
```

```
~/.cache/ntsx/                # on Windows: %USERPROFILE%\.cache\ntsx
  <workspaceHash>/            # isolated per project (never mixes projects)
    <depsHash>/               # isolated per dep set
      node_modules/
```

## Options

| Flag | Description |
|------|-------------|
| `-w, --with <pkg>` | Ephemeral dep (`pkg`, `pkg@version`, `@scope/pkg@version`). Repeatable |
| `-e, --eval <code>` | Inline code (like `node -e` / `tsx -e`) |
| `--eval-runtime <tsx\|node>` | Eval runner (default: `tsx`) |
| `--tsx-args <flags>` | Flags for `tsx` before the script (`.ts`/eval). Repeatable |
| `--node-args <flags>` | Flags for `node` before the script (`.js`/`.mjs`). Repeatable |
| `--npm-args <flags>` | Flags for the cache's `npm install`. Repeatable |
| `-q, --quiet` | Silence `npm install` output |
| `-d, --debug` | Trace the flow: cache paths, commands, symlink, restore |
| `--node <version>` | Pin Node version (downloads version to `~/.cache/ntsx/node/`) |

## Script Metadata

Scripts can declare dependencies and Node version requirements directly in an inline header:

```typescript
// /// ntsx
// dependencies = [
//   "axios",
//   "chalk"
// ]
// node = "24"
// ///

import chalk from 'chalk'
import axios from 'axios'
```

Now run simply: `ntsx run script.ts`

## When NOT to use ntsx

`ntsx` shines for **à-la-carte utilities**, not for build frameworks with their own scaffolding
(Astro, Vite, Angular, Next, Nuxt...). Use their official toolkit (`npm create <x>`) for those.

> ✨ ntsx = zero friction for the **99% of scripts**: paste it in snippets, ship it in production.

## Install

```bash
npm install -g @kreisler/ntsx   # 🚀 direct use: `ntsx` lands in your PATH
```

Or, from this repo:

```bash
npm install                 # dev deps
npm run build               # tsup → dist/ntsx.js (single-file, shebang)
npm link                    # optional: `ntsx` in your PATH
```

**Requirements:** Node ≥ 22 · `tsx` (falls back to `npx -y tsx` if missing).

## Stack

- TypeScript + Commander (CLI) + zod (validation)
- `tsup` → self-contained bundle (`commander`, `zod` included in `dist`)
- Tests with `node:test` (63/63 ✅)

---

<div align="center">

MIT · made with ❤️ for people in a hurry

</div>