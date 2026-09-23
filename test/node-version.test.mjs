import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runCli } from './helpers.mjs'

test('node version: --node flag executes script', () => {
  const out = runCli(['run', '--node', '22', '-e', 'console.log("node-version-ok")'])
  assert.equal(out.trim(), 'node-version-ok')
})
