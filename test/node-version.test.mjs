import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runCli } from './helpers.mjs'

test('node version: --node 22 flag executes script with major 22', () => {
  const out = runCli(['run', '--node', '22', '-e', 'console.log("node-22-ok", process.version.split(".")[0])'])
  assert.equal(out.trim(), 'node-22-ok v22')
})

test('node version: --node 22.14.0 flag executes script with exact version', () => {
  const out = runCli(['run', '--node', '22.14.0', '-e', 'console.log("node-22.14.0-ok", process.version)'])
  assert.equal(out.trim(), 'node-22.14.0-ok v22.14.0')
})

test('node version: --node 20.18.0 flag executes script with exact version', () => {
  const out = runCli(['run', '--node', '20.18.0', '-e', 'console.log("node-20.18.0-ok", process.version)'])
  assert.equal(out.trim(), 'node-20.18.0-ok v20.18.0')
})
