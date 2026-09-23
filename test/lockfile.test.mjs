import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { runCliWithRetry, sandbox } from './helpers.mjs'

test('lockfile: ntsx lock creates lockfile and run reads it', () => {
  const dir = sandbox()
  const scriptPath = path.join(dir, 'app.ts')
  const lockPath = path.join(dir, 'app.ts.lock')
  const code = `
import chalk from 'chalk';
console.log(chalk.blue('lock-ok'));
`
  writeFileSync(scriptPath, code, 'utf8')
  try {
    const lockOut = runCliWithRetry(['lock', '--with', 'chalk', scriptPath], { cwd: dir })
    assert.match(lockOut, /Lockfile generated at/)
    assert.equal(existsSync(lockPath), true)

    const lockContent = JSON.parse(readFileSync(lockPath, 'utf8'))
    assert.equal(lockContent.version, 1)
    assert.ok(lockContent.dependencies.chalk)

    const runOut = runCliWithRetry(['run', '-q', scriptPath], { cwd: dir })
    assert.match(runOut, /lock-ok/)
  } finally {
    try { unlinkSync(scriptPath) } catch {}
    try { unlinkSync(lockPath) } catch {}
  }
})
