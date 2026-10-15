<div align="center">

# ⚡ ntsx

*Run Node/TS scripts with ephemeral dependencies — no `npm install`, no project pollution.*

[![CI](https://github.com/itskreisler/ntsx/actions/workflows/ci.yml/badge.svg)](https://github.com/itskreisler/ntsx/actions)
[![npm version](https://img.shields.io/npm/v/@kreisler/ntsx?style=flat-square)](https://www.npmjs.com/package/@kreisler/ntsx)
![Node version](https://img.shields.io/badge/Node.js->=22-3c873a?style=flat-square)
[![TypeScript](https://img.shields.io/badge/TypeScript-blue?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

⭐ If you like this project, star it on GitHub!

[Overview](#overview) • [Features](#features) • [Installation](#installation) • [Quick Start](#quick-start) • [Commands & Options](#commands--options) • [Script Metadata](#script-metadata) • [How It Works](#how-it-works) • [Cache Management](#cache-management)

</div>

---

## Overview

`ntsx` is a CLI runner for Node.js and TypeScript that brings `uv --with` capabilities to the JavaScript ecosystem. It allows you to run any script (`.js`, `.ts`, `.tsx`, `.mjs`, `.cjs`) or inline code block with **ephemeral dependencies** — installing requested packages on the fly into an isolated cache, linking them into your workspace, and restoring your real `node_modules` when execution finishes.

Whether you are running throwaway scrapers, CLI utilities, single-file microservices, or terminal tools, `ntsx` keeps your repository clean and your `package.json` untouched.

> [!NOTE]
> `ntsx` requires Node.js >= 22. It automatically uses `tsx` for TypeScript files and falls back to `npx tsx` if not installed globally.

### Why `ntsx`?

| Capability | `npx` | `tsx` | `ntsx` |
|---|:---:|:---:|:---:|
| Run TypeScript directly | ❌ | ✅ | ✅ |
| Ad-hoc dependencies without `npm i` | ⚠️ (`npx -p pkg`) | ❌ | ✅ (`--with pkg`) |
| Zero changes to `package.json` | ✅ | ❌ | ✅ |
| Guaranteed `node_modules` integrity | ❌ | ⚠️ | ✅ (Auto-restored) |
| Shared persistent cache across runs | ⚠️ | ❌ | ✅ (`~/.cache/ntsx`) |
| Declarative JSDoc metadata | ❌ | ❌ | ✅ (`/** @ntsx */`) |
| Pin Node.js version on the fly | ❌ | ❌ | ✅ (`--node 24`) |

---

## Features

- 📦 **Ephemeral Dependencies** – Supply dependencies on demand via `--with <pkg>` without adding them to `package.json`.
- ⚡ **Zero Project Pollution** – Stashes existing `node_modules` during execution and restores them automatically upon exit or signal interruptions (`SIGINT`, `SIGTERM`).
- 📁 **Isolated Caching** – Caches downloaded dependencies in `~/.cache/ntsx/` by workspace and dependency hash for instant subsequent runs.
- 📝 **Inline Script Metadata** – Declare required packages, Node.js versions, and runtimes inside JSDoc comment blocks directly in your scripts.
- 📌 **Node.js Version Pinning** – Automatically download and execute scripts under specific Node.js release versions with `--node <version>`.
- 🛠️ **Ephemeral Tool Execution** – Run CLI utilities (e.g. `prettier`, `rimraf`) on-demand with `ntsx tool <tool>`.
- 🔒 **Lockfile Support** – Lock exact script dependencies into a `<script>.lock` file for reproducible execution across environments.

---

## Installation

Install globally via `npm`:

```bash
npm install -g @kreisler/ntsx
```

Or execute on-demand without installing using `npx`:

```bash
npx @kreisler/ntsx run --with chalk -e "import c from 'chalk'; console.log(c.green('hello world'))"
```

---

## Quick Start

### 1. Run a script with ephemeral dependencies

Run a TypeScript script requiring packages you haven't installed in your project:

```bash
ntsx run --with axios --with jsdom examples/scrape.ts https://example.com
```

> [!TIP]
> When passing option flags to your script or inline code (e.g. `--fecha` or `-h`), use the `--` separator so the flags are passed directly to your target script rather than intercepted by `ntsx`:
> ```bash
> ntsx run --with axios diario.ts -- --fecha hoy
> ```

### 2. Execute inline code with `-e`

Evaluate TypeScript or JavaScript directly in your terminal:

```bash
ntsx run --with qrcode -e "import QR from 'qrcode'; QR.toString('https://npmjs.com', { type: 'terminal', small: true }).then(console.log)"
```

Forward arguments and flags to inline code:

```bash
ntsx run --with argv2object -e "import a from 'argv2object'; console.log(a(true))" -- -h --name=Kreisler --is-admin
```

### 3. Pin Node.js version

Execute a script against a specific Node.js release (downloaded into `~/.cache/ntsx/node/`):

```bash
ntsx run --node 24.1.0 -e "console.log(process.version)"
```

### 4. Ephemeral developer tools

Run CLI utilities without adding them to your project's `devDependencies`:

```bash
ntsx tool prettier --write src/**/*.ts
```

### 5. Generate a lockfile

Generate a lockfile (`script.ts.lock`) to pin exact versions for a standalone script:

```bash
ntsx lock --with axios@1.7.9 script.ts
```

---

## Commands & Options

### `ntsx run`

Runs a script or inline code snippet with ephemeral dependencies.

```
ntsx run [options] [script] [-- scriptArgs...]
```

| Flag | Description |
|---|---|
| `-w, --with <pkg>` | Add ephemeral dependency (`pkg`, `pkg@version`, `@scope/pkg@version`). Repeatable |
| `-e, --eval <code>` | Evaluate inline code string |
| `--eval-runtime <tsx\|node>` | Runtime used for inline eval (default: `tsx`) |
| `--tsx-args <flags>` | Flags forwarded to `tsx` before script execution. Repeatable |
| `--node-args <flags>` | Flags forwarded to `node` before script execution. Repeatable |
| `--npm-args <flags>` | Flags forwarded to `npm install` when populating cache. Repeatable |
| `-q, --quiet` | Suppress `npm install` stdout output |
| `-d, --debug` | Display detailed execution trace and cache internal steps |
| `--node <version>` | Pin Node.js version |
| `-- <args...>` | Forward flags and arguments directly to the target script |

### `ntsx tool`

Runs a developer tool ephemerally.

```bash
ntsx tool [--node <version>] <tool> [toolArgs...]
```

### `ntsx lock`

Generates a `<script>.lock` file capturing resolved package versions.

```bash
ntsx lock [--with <pkg>] <script>
```

### `ntsx cache`

Manage the local `ntsx` dependency cache.

```bash
ntsx cache stats       # Display total cache size and workspace count
ntsx cache dir         # Output absolute path to cache directory
ntsx cache prune       # Prune unused cache entries
ntsx cache clean       # Interactively delete entire cache (-f to bypass prompt)
```

---

## Script Metadata

Scripts can declare their dependencies, Node.js version, and runtime directly within a JSDoc block using `@ntsx`:

```typescript
/**
 * @ntsx
 * @with axios@1.7.9
 * @with chalk@5.3.0
 * @node {24}
 * @runtime {tsx}
 */

import axios from 'axios'
import chalk from 'chalk'

console.log(chalk.blue('Metadata-driven script execution'))
```

Executing the script automatically installs required packages and sets up the environment:

```bash
ntsx run script.ts
```

---

## How It Works

```
ntsx run --with chalk script.ts
        │
        ▼
┌────────────────────────────────────────────────────────┐
│ 1. Compute workspace hash & sorted dependency hash     │
│    Cache path: ~/.cache/ntsx/<workspace>/<deps>/      │
├────────────────────────────────────────────────────────┤
│ 2. Check cache:                                        │
│    • Hit  ──► Skip download                            │
│    • Miss ──► Create package.json & run `npm install`  │
├────────────────────────────────────────────────────────┤
│ 3. Stash project `node_modules` to `.ntsx-<time>.bak`  │
│    and symlink cached `node_modules` into project      │
├────────────────────────────────────────────────────────┤
│ 4. Execute target script via `tsx` or `node`           │
├────────────────────────────────────────────────────────┤
│ 5. Guaranteed Cleanup:                                 │
│    Remove symlink and restore original `node_modules`  │
└────────────────────────────────────────────────────────┘
```

> [!IMPORTANT]
> Your original `node_modules` directory is safely stashed during execution and guaranteed to be restored on completion, even if the script crashes or is terminated by `SIGINT` / `SIGTERM`. If an unexpected crash occurs, orphan symlinks auto-heal on the next run.

---

## Cache Management

Downloaded dependencies are stored in `~/.cache/ntsx/` (or `%USERPROFILE%\.cache\ntsx` on Windows) categorized by workspace and dependency set:

```
~/.cache/ntsx/
  ├── node/                  # Downloaded Node.js releases
  └── <workspaceHash>/       # Isolated workspace folder
      └── <depsHash>/        # Isolated dependency cache
          └── node_modules/
```

Use `ntsx cache stats`, `ntsx cache clean`, and `ntsx cache prune` to inspect and manage disk usage.
