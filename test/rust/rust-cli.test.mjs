import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { RUST_BIN, sandbox, runCliWithRetry } from '../helpers.mjs'

test('rust cli: release binary exists and reports version 0.1.8', () => {
  assert.equal(existsSync(RUST_BIN), true, 'rust/bin/ntsx release binary must exist')
  const r = spawnSync(RUST_BIN, ['--version'], { encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.match(r.stdout.trim(), /0\.1\.8/)
})

test('rust cli: help command shows uv-style description', () => {
  const r = spawnSync(RUST_BIN, ['--help'], { encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.match(r.stdout, /Run Node\/TS scripts with ephemeral dependencies/)
})

test('rust cli: cache dir command', () => {
  const r = spawnSync(RUST_BIN, ['cache', 'dir'], { encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.match(r.stdout.trim(), /\.cache\/ntsx/)
})

test('rust cli: lockfile generation', () => {
  const dir = sandbox()
  const scriptPath = path.join(dir, 'test-script.js')
  writeFileSync(scriptPath, 'console.log("hello")')
  const r = spawnSync(RUST_BIN, ['lock', scriptPath], { cwd: dir, encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.equal(existsSync(path.join(dir, 'test-script.js.lock')), true)
})
