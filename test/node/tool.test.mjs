import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runCliWithRetry, sandbox } from '../helpers.mjs'

test('tool: ntsx tool executes CLI tool ephemerally', () => {
  const dir = sandbox()
  const out = runCliWithRetry(['tool', 'rimraf', '--version'], { cwd: dir })
  assert.match(out.trim(), /^\d+\.\d+\.\d+/)
})
