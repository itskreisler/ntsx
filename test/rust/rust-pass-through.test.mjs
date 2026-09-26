import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { sandbox, runCliWithRetry } from '../helpers.mjs'

test('rust cli pass-through: -h --name=Kreisler --is-admin forwarded after --', () => {
  const dir = sandbox()
  const out = runCliWithRetry([
    'run', '-e',
    'console.log(process.argv.slice(1))',
    '--', '-h', '--name=Kreisler', '--is-admin',
  ], { cwd: dir })
  assert.equal(out.trim(), "[ '-h', '--name=Kreisler', '--is-admin' ]")
})

test('rust cli pass-through: --with chalk -e process.argv.slice(1)', () => {
  const dir = sandbox()
  const out = runCliWithRetry([
    'run', '--with', 'chalk', '-q', '-e',
    "import chalk from 'chalk'; console.log(chalk.green(JSON.stringify(process.argv.slice(1))))",
    '--', '--name=Kreisler', '-h', '--help',
  ], { cwd: dir })
  assert.deepEqual(JSON.parse(out.trim()), ['--name=Kreisler', '-h', '--help'])
})
