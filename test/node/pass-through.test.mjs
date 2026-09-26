import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { sandbox, runCliWithRetry } from '../helpers.mjs'

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

test('eval pass-through 01: flags con -- (--name=Kreisler -h --help --is-admin)', () => {
  const dir = sandbox()
  const out = runCliWithRetry([
    'run', '--with', 'chalk', '-q', '-e',
    "import chalk from 'chalk'; console.log(chalk.green(JSON.stringify(process.argv.slice(1))))",
    '--', '--name=Kreisler', '-h', '--help', '--is-admin',
  ], { cwd: dir })
  assert.deepEqual(JSON.parse(out.trim()), ['--name=Kreisler', '-h', '--help', '--is-admin'])
})

test('eval pass-through 02: argv2object con -- + flags', () => {
  const dir = sandbox()
  const out = runCliWithRetry([
    'run', '--with', 'argv2object', '-q', '-e',
    "import a from 'argv2object'; console.log(JSON.stringify({ argv: process.argv.slice(1), parsed: a(true) }))",
    '--', '-h', '--help', '--name=Kreisler', '--is-admin',
  ], { cwd: dir })
  const { argv, parsed } = JSON.parse(out.trim())
  assert.deepEqual(argv, ['-h', '--help', '--name=Kreisler', '--is-admin'])
  assert.equal(parsed.name, 'Kreisler')
  assert.equal(parsed.is_admin, true)
  assert.equal(parsed.help, true)
  assert.match(out.trim(), /"help":true/)
})

test('eval pass-through 03: args simples sin -- (arg1 archivo.txt)', () => {
  const dir = sandbox()
  const out = runCliWithRetry([
    'run', '--with', 'chalk', '-q', '-e',
    "import chalk from 'chalk'; console.log(chalk.cyan(JSON.stringify(process.argv.slice(1))))",
    'arg1', 'archivo.txt',
  ], { cwd: dir })
  assert.deepEqual(JSON.parse(out.trim()), ['arg1', 'archivo.txt'])
})

test('eval pass-through 04: node runtime con -- + flags (-h --name=Kreisler)', () => {
  const dir = sandbox()
  const out = runCliWithRetry([
    'run', '--with', 'chalk', '-q', '--eval-runtime', 'node', '-e',
    "import chalk from 'chalk'; console.log(chalk.blue(JSON.stringify(process.argv.slice(1))))",
    '--', '-h', '--name=Kreisler',
  ], { cwd: dir })
  assert.deepEqual(JSON.parse(out.trim()), ['-h', '--name=Kreisler'])
})

test('eval pass-through 05: sin args extra (argv vacío)', () => {
  const dir = sandbox()
  const out = runCliWithRetry([
    'run', '--with', 'chalk', '-q', '-e',
    "import chalk from 'chalk'; console.log(chalk.yellow(JSON.stringify(process.argv.slice(1))))",
  ], { cwd: dir })
  assert.deepEqual(JSON.parse(out.trim()), [])
})

test('acceptance criteria: argument forwarding with -- (-h --name=Kreisler --is-admin)', () => {
  const dir = sandbox()
  const out = runCliWithRetry([
    'run', '-e',
    'console.log(process.argv.slice(1))',
    '--', '-h', '--name=Kreisler', '--is-admin',
  ], { cwd: dir })
  assert.equal(out.trim(), "[ '-h', '--name=Kreisler', '--is-admin' ]")
})
