/**
 * Tests para el binario Rust de ntsx en entorno Windows (ntsx.exe, cmd.exe, PowerShell, %USERPROFILE%)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { sandbox, runCliWithRetry, runCliErr, createFile, createEnvFile, stripAnsi, parseJsonSafe } from './helpers.mjs'

// ============================================================
// Tests básicos de funcionamiento
// ============================================================

test('ntsx windows: ejecuta código JavaScript simple con -e', () => {
    const dir = sandbox()
    const out = runCliWithRetry([
        'run', '-e', 'console.log("hello world")',
    ], { cwd: dir })
    assert.equal(out.trim(), 'hello world')
})

test('ntsx windows: ejecuta código TypeScript simple con -e', () => {
    const dir = sandbox()
    const out = runCliWithRetry([
        'run', '-e', 'const x: number = 42; console.log(x)',
    ], { cwd: dir })
    assert.equal(stripAnsi(out.trim()), '42')
})

test('ntsx windows: ejecuta archivo .mjs', () => {
    const dir = sandbox()
    const scriptPath = createFile(dir, 'test.mjs', 'console.log("from mjs")')
    const out = runCliWithRetry([
        'run', scriptPath,
    ], { cwd: dir })
    assert.equal(out.trim(), 'from mjs')
})

test('ntsx windows: ejecuta archivo .ts', () => {
    const dir = sandbox()
    const scriptPath = createFile(dir, 'test.ts', 'const x: string = "from ts"; console.log(x)')
    const out = runCliWithRetry([
        'run', scriptPath,
    ], { cwd: dir })
    assert.equal(out.trim(), 'from ts')
})

// ============================================================
// Tests de dependencias con --with
// ============================================================

test('ntsx windows: instala y usa chalk con --with', () => {
    const dir = sandbox()
    const out = runCliWithRetry([
        'run', '--with', 'chalk', '-q', '-e',
        "import chalk from 'chalk'; console.log(typeof chalk.green)",
    ], { cwd: dir })
    assert.equal(out.trim(), 'function')
})

test('ntsx windows: instala y usa zod con --with', () => {
    const dir = sandbox()
    const out = runCliWithRetry([
        'run', '--with', 'zod', '-q', '-e',
        "import { z } from 'zod'; console.log(typeof z.string)",
    ], { cwd: dir })
    assert.equal(out.trim(), 'function')
})

// ============================================================
// Tests de passthrough de argumentos
// ============================================================

test('ntsx windows: pasa argumentos después de -- a scripts JS', () => {
    const dir = sandbox()
    const scriptPath = createFile(dir, 'args.mjs', `
console.log(JSON.stringify(process.argv.slice(2)))
`)
    const out = runCliWithRetry([
        'run', scriptPath, '--', '--name', 'Kreisler', '--admin',
    ], { cwd: dir })
    assert.deepEqual(parseJsonSafe(out), ['--name', 'Kreisler', '--admin'])
})

test('ntsx windows: pasa argumentos después de -- a scripts TS', () => {
    const dir = sandbox()
    const scriptPath = createFile(dir, 'args.ts', `
console.log(JSON.stringify(process.argv.slice(2)))
`)
    const out = runCliWithRetry([
        'run', scriptPath, '--', '--name', 'Kreisler', '--admin',
    ], { cwd: dir })
    assert.deepEqual(parseJsonSafe(out), ['--name', 'Kreisler', '--admin'])
})

// ============================================================
// Tests de .env y node-args
// ============================================================

test('ntsx windows: carga .env con --node-args --env-file', () => {
    const dir = sandbox()
    const envPath = createEnvFile(dir, { NTSX_TEST_USER_ID: '12345' })
    const out = runCliWithRetry([
        'run', '--node-args', `--env-file=${envPath}`,
        '-e', "import { loadEnvFile } from 'node:process'; loadEnvFile(); console.log(process.env.NTSX_TEST_USER_ID)",
    ], { cwd: dir })
    assert.equal(stripAnsi(out.trim()), '12345')
})

// ============================================================
// Tests de debug y cache
// ============================================================

test('ntsx windows: --debug muestra información de depuración', () => {
    const dir = sandbox()
    const { stderr } = runCliErr([
        'run', '--debug', '-e', 'console.log("test")',
    ], { cwd: dir })
    assert.ok(stderr.includes('[ntsx:debug]'))
})

test('ntsx windows: cache dir muestra la ruta del caché', () => {
    const dir = sandbox()
    const out = runCliWithRetry([
        'cache', 'dir',
    ], { cwd: dir })
    assert.ok(out.includes('.cache') || out.includes('ntsx'))
})
