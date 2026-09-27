import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { RUST_BIN, sandbox, runCliWithRetry, runCliErr } from '../helpers.mjs'

// ============================================================
// Basic Binary & Help Tests
// ============================================================

test('rust cli linux: release binary exists and reports version 0.1.8', () => {
  assert.equal(existsSync(RUST_BIN), true, 'rust/bin/linux-x86_64/ntsx release binary must exist')
  const r = spawnSync(RUST_BIN, ['--version'], { encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.match(r.stdout.trim(), /0\.1\.8/)
})

test('rust cli linux: help command shows uv-style description', () => {
  const r = spawnSync(RUST_BIN, ['--help'], { encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.match(r.stdout, /Run Node\/TS scripts with ephemeral dependencies/)
})

test('rust cli linux: cache dir command', () => {
  const r = spawnSync(RUST_BIN, ['cache', 'dir'], { encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.match(r.stdout.trim(), /\.cache\/ntsx/)
})

// ============================================================
// 1. ntsx lock - Lockfile Generation and Reading
// ============================================================

test('rust cli linux lock: script sin dependencias', () => {
  const dir = sandbox()
  const scriptPath = path.join(dir, 'test-simple.js')
  writeFileSync(scriptPath, 'console.log("hello simple")')
  const r = spawnSync(RUST_BIN, ['lock', scriptPath], { cwd: dir, encoding: 'utf8' })
  assert.equal(r.status, 0)
  const lockPath = `${scriptPath}.lock`
  assert.equal(existsSync(lockPath), true)
  const lockJson = JSON.parse(readFileSync(lockPath, 'utf8'))
  assert.equal(lockJson.version, 1)
  assert.equal(lockJson.script, 'test-simple.js')
  assert.ok(lockJson.runtime)
})

test('rust cli linux lock: script con dependencias (--with)', () => {
  const dir = sandbox()
  const scriptPath = path.join(dir, 'test-deps.js')
  writeFileSync(scriptPath, 'import chalk from "chalk"; console.log(chalk.green("ok"))')
  const r = spawnSync(RUST_BIN, ['lock', '--with', 'chalk', scriptPath], { cwd: dir, encoding: 'utf8' })
  assert.equal(r.status, 0)
  const lockPath = `${scriptPath}.lock`
  assert.equal(existsSync(lockPath), true)
  const lockJson = JSON.parse(readFileSync(lockPath, 'utf8'))
  assert.ok(lockJson.dependencies.chalk)
  assert.ok(lockJson.dependencies.chalk.version)
  assert.match(lockJson.dependencies.chalk.integrity, /^sha256-/)
})

test('rust cli linux lock: ntsx run usa el lockfile si existe', () => {
  const dir = sandbox()
  const scriptPath = path.join(dir, 'test-lock-use.js')
  writeFileSync(scriptPath, 'import chalk from "chalk"; console.log(typeof chalk.green)')

  // Crear lockfile para chalk
  spawnSync(RUST_BIN, ['lock', '--with', 'chalk', scriptPath], { cwd: dir })

  // Ejecutar sin pasar --with (debe usar el lockfile)
  const out = runCliWithRetry(['run', '-q', scriptPath], { cwd: dir })
  assert.equal(out.trim(), 'function')
})

// ============================================================
// 2. ntsx tool run - Herramientas Efímeras
// ============================================================

test('rust cli linux tool: ayuda del subcomando', () => {
  const r = spawnSync(RUST_BIN, ['tool', '--help'], { encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.match(r.stdout, /tool/i)
})

test('rust cli linux tool: ejecuta typescript con argumentos', () => {
  const dir = sandbox()
  const r = spawnSync(RUST_BIN, ['tool', 'typescript', '--version'], { cwd: dir, encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.match(r.stdout, /Version/i)
})

test('rust cli linux tool: subcomando ntsx tool run', () => {
  const dir = sandbox()
  const r = spawnSync(RUST_BIN, ['tool', 'run', 'typescript', '--version'], { cwd: dir, encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.match(r.stdout, /Version/i)
})

// ============================================================
// 3. Script Metadata JSDoc (@ntsx)
// ============================================================

test('rust cli linux metadata JSDoc: @ntsx con @with y @node {24.21.0}', () => {
  const dir = sandbox()
  const scriptPath = path.join(dir, 'jsdoc-test.ts')
  writeFileSync(scriptPath, `/**
 * @ntsx
 * @with chalk
 * @node {24.21.0}
 * @runtime {tsx}
 */
import chalk from 'chalk';
console.log(process.version, typeof chalk.green);
`)
  const out = runCliWithRetry(['run', '-q', scriptPath], { cwd: dir })
  assert.match(out.trim(), /v24\.21\.0 function/)
})

test('rust cli linux metadata JSDoc: @ntsx con @node {26.10.0}', () => {
  const dir = sandbox()
  const scriptPath = path.join(dir, 'jsdoc-26.ts')
  writeFileSync(scriptPath, `/**
 * @ntsx
 * @node {26.10.0}
 */
console.log(process.version);
`)
  const out = runCliWithRetry(['run', '-q', scriptPath], { cwd: dir })
  assert.equal(out.trim(), 'v26.10.0')
})

test('rust cli linux metadata JSDoc: @ntsx con @runtime {node}', () => {
  const dir = sandbox()
  const scriptPath = path.join(dir, 'jsdoc-runtime.js')
  writeFileSync(scriptPath, `/**
 * @ntsx
 * @runtime {node}
 */
console.log("runtime-node-ok");
`)
  const out = runCliWithRetry(['run', scriptPath], { cwd: dir })
  assert.equal(out.trim(), 'runtime-node-ok')
})

test('rust cli linux metadata: JSDoc normal no activa metadata @ntsx', () => {
  const dir = sandbox()
  const scriptPath = path.join(dir, 'normal-jsdoc.ts')
  writeFileSync(scriptPath, `/**
 * @param {string} name
 * @returns {string}
 */
console.log("normal-jsdoc-ok");
`)
  const out = runCliWithRetry(['run', scriptPath], { cwd: dir })
  assert.equal(out.trim(), 'normal-jsdoc-ok')
})

test('rust cli linux metadata: --node 24.21.0 valida process.version', () => {
  const dir = sandbox()
  const out = runCliWithRetry(['run', '--node', '24.21.0', '-q', '-e', 'console.log(process.version)'], { cwd: dir })
  assert.equal(out.trim(), 'v24.21.0')
})

test('rust cli linux metadata: --node 26.10.0 valida process.version', () => {
  const dir = sandbox()
  const out = runCliWithRetry(['run', '--node', '26.10.0', '-q', '-e', 'console.log(process.version)'], { cwd: dir })
  assert.equal(out.trim(), 'v26.10.0')
})

// ============================================================
// 4. Manejo de errores y casos edge
// ============================================================

test('rust cli linux error: script que no existe', () => {
  const dir = sandbox()
  const { code, stderr } = runCliErr(['run', 'non-existent-file.ts'], { cwd: dir })
  assert.notEqual(code, 0)
  assert.match(stderr, /not found/i)
})

test('rust cli linux error: sintaxis inválida', () => {
  const dir = sandbox()
  const scriptPath = path.join(dir, 'invalid.ts')
  writeFileSync(scriptPath, 'const = ;;;;')
  const { code } = runCliErr(['run', scriptPath], { cwd: dir })
  assert.notEqual(code, 0)
})

test('rust cli linux error: dependencia inexistente', () => {
  const dir = sandbox()
  const { code, stderr } = runCliErr(['run', '--with', 'pkg-does-not-exist-123456789', '-e', 'console.log("x")'], { cwd: dir })
  assert.notEqual(code, 0)
  assert.match(stderr, /Invalid package spec|ERR!|failed/i)
})
