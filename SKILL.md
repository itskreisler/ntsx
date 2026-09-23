# ⚡ ntsx Agent Skill Guide

This document describes the capabilities, internal architecture, usage patterns, and development guidelines for `@kreisler/ntsx`.

## 📌 Overview
`ntsx` is a zero-config, uv-style script runner for Node.js and TypeScript. It enables running scripts or inline evaluation with ephemeral dependencies (`--with <pkg>`) installed on the fly into an isolated cache directory (`~/.cache/ntsx`), without modifying the target workspace's `package.json` or polluting its real `node_modules`.

---

## 🛠️ CLI Commands & Options

### `ntsx run`
Executes a script file (`.js`, `.ts`, `.mts`, `.cts`, `.tsx`) or inline code (`-e <code>`).

```bash
ntsx run [options] [script] [scriptArgs...]
```

#### Flags:
- `-w, --with <pkg>`: Ephemeral dependency specifier (`pkg`, `pkg@version`, `@scope/pkg@version`). Repeatable.
- `-e, --eval <code>`: Evaluates inline code. Script arguments go **after** a `--` separator (like `node -e` / `tsx -e`), e.g. `ntsx run -e "<code>" -- -h --name=Kreisler`. Plain args (no leading `-`) can also be passed directly.
- `--eval-runtime <tsx|node>`: Runtime environment for inline code evaluation (default: `tsx`).
- `--tsx-args <flags>`: Options forwarded to `tsx` before script execution.
- `--node-args <flags>`: Options forwarded to `node` before script execution.
- `--npm-args <flags>`: Flags passed directly to the internal `npm install` call in cache.
- `-q, --quiet`: Suppresses `npm install` output.
- `-d, --debug`: Prints internal execution traces (workspace hash, cache paths, symlinks, signal interception).
- `--node <version>`: Reserved flag for future Node version pinning.

### `ntsx cache`
Manages the isolated dependency cache (`~/.cache/ntsx`).

- `ntsx cache stats`: Displays total workspace count and disk usage bytes.
- `ntsx cache clean`: Prompts for confirmation to remove the cache directory.
- `ntsx cache clean --force` / `-f`: Purges the cache directory without confirmation.

---

## ⚙️ Architecture & Life Cycle

1. **Workspace & Dependency Hashing**:
   - `workspaceHash(targetDir)`: SHA256 of absolute workspace path (16 chars). Isolates caches per project directory.
   - `depsHash(withList)`: Sorted null-separated hash of requested package specs.
   - `cacheKey(withList, npmArgs)`: Includes npm flags to partition caches by registry / npm options.

2. **Isolated Dependency Installation**:
   - Cache location: `~/.cache/ntsx/<workspaceHash>/<cacheKey>/`
   - Generated `package.json` includes `"type": "module"` and `"private": true` to support pure ESM packages (`execa`, `chalk`, `ora`, `glob`).
   - Runs `npm install --no-audit --no-fund` in isolation with `npm_config_*` environment variables stripped (`cleanNpmEnv`) to prevent config leaks from parent `npm run` calls.

3. **Target `node_modules` Stashing**:
   - Stashes existing `node_modules` directory into `.ntsx-<pid>-<timestamp>.bak`.
   - Stashes existing non-ntsx symlinks to restore them later.
   - Self-heals orphaned symlinks pointing to `CACHE_ROOT` left behind by prior crashes.
   - Creates directory symlink pointing from `<targetDir>/node_modules` to `<cacheDir>/node_modules`.

4. **Execution & Signal Interception**:
   - Spawns child runner process asynchronously (`tsx` or `node`).
   - Intercepts `SIGINT` and `SIGTERM` signals.
   - Forwards signals to child and sets a 3-second grace timer before fallback `SIGKILL`.
   - Executes cleanup in a `finally` block to guarantee `node_modules` is ALWAYS restored.

5. **Run Lock Mechanism**:
   - Acquires non-blocking run lock (`run.lock`) per `targetDir` in `CACHE_ROOT`.
   - Detects stale lock files left by dead process PIDs (`isPidAlive`) and automatically clears them.

---

## 🧪 Testing & Verification
- Unit & E2E CLI tests use native Node test runner with **pnpm**.
- Test command: `pnpm test` (compiles with `tsup` then executes test suite).
- CI runs the full suite on Node 22 and 24 (`.github/workflows/ci.yml`).
