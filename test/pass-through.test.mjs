import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { sandbox, runCliWithRetry } from './helpers.mjs'

function runInSandbox(scriptName, args, opts = {}) {
  const dir = sandbox()
  const scriptPath = path.join(dir, path.basename(scriptName))
  writeFileSync(scriptPath, readFileSync(scriptName, 'utf8'))
  return runCliWithRetry(['run', ...args, scriptPath, ...opts.scriptArgs], { cwd: dir })
}

test('argv2object pass-through 01: --name=Kreisler archivo.txt --debug', () => {
  const out = runInSandbox('examples/24-argv.ts', ['--with', 'argv2object', '-q'], {
    scriptArgs: ['--name=Kreisler', 'archivo.txt', '--debug'],
  })
  const parsed = JSON.parse(out.trim())
  assert.match(parsed.error, /Unix-style format/)
})

test('argv2object pass-through 02: -h --help --name=Kreisler --is-admin', () => {
  const out = runInSandbox('examples/24-argv.ts', ['--with', 'argv2object', '-q'], {
    scriptArgs: ['-h', '--help', '--name=Kreisler', '--is-admin'],
  })
  const parsed = JSON.parse(out.trim())
  assert.equal(parsed.name, 'Kreisler')
  assert.equal(parsed.is_admin, true)
  assert.equal(parsed.h, true)
  assert.equal(parsed.help, true)
})

test('argv2object pass-through 03: --name=Kreisler', () => {
  const out = runInSandbox('examples/24-argv.ts', ['--with', 'argv2object', '-q'], {
    scriptArgs: ['--name=Kreisler'],
  })
  const parsed = JSON.parse(out.trim())
  assert.equal(parsed.name, 'Kreisler')
})

test('argv2object pass-through 04: sin argumentos extras', () => {
  const out = runInSandbox('examples/24-argv.ts', ['--with', 'argv2object', '-q'], {
    scriptArgs: [],
  })
  const parsed = JSON.parse(out.trim())
  assert.match(parsed.error, /No command-line arguments/)
})

test('argv2object pass-through 05: --name=Kreisler --age=25 --debug', () => {
  const out = runInSandbox('examples/24-argv.ts', ['--with', 'argv2object', '-q'], {
    scriptArgs: ['--name=Kreisler', '--age=25', '--debug'],
  })
  const parsed = JSON.parse(out.trim())
  assert.equal(parsed.name, 'Kreisler')
  assert.equal(parsed.age, 25)
  assert.equal(parsed.debug, true)
})

test('argv2object + chalk inline multi-package pass-through', () => {
  const out = runInSandbox('examples/24-argv.ts', ['--with', 'argv2object', '--with', 'chalk', '-q'], {
    scriptArgs: ['-h', '--help', '--name=Kreisler', '--is-admin'],
  })
  const parsed = JSON.parse(out.trim())
  assert.equal(parsed.name, 'Kreisler')
  assert.equal(parsed.is_admin, true)
  assert.equal(parsed.h, true)
  assert.equal(parsed.help, true)
})
