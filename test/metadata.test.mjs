import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { runCliWithRetry, sandbox } from './helpers.mjs'

test('script metadata: parses /// ntsx header block and loads declared dependencies', () => {
  const dir = sandbox()
  const scriptPath = path.join(dir, 'meta.ts')
  const code = `
// /// ntsx
// dependencies = [
//   "chalk"
// ]
// ///
import chalk from 'chalk';
console.log(chalk.green('metadata-chalk-ok'));
`
  writeFileSync(scriptPath, code, 'utf8')
  try {
    const out = runCliWithRetry(['run', '-q', scriptPath], { cwd: dir })
    assert.match(out, /metadata-chalk-ok/)
  } finally {
    try { unlinkSync(scriptPath) } catch {}
  }
})
