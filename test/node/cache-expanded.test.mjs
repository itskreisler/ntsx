import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runCli } from '../helpers.mjs'

test('cache expanded: ntsx cache dir prints cache directory', () => {
  const out = runCli(['cache', 'dir'])
  assert.match(out.trim(), /\.cache[\\/]ntsx/)
})

test('cache expanded: ntsx cache prune runs cleanly', () => {
  const out = runCli(['cache', 'prune'])
  assert.match(out.trim(), /Cache pruned|does not exist/)
})
