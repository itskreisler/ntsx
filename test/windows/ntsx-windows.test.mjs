/**
 * Tests para el binario Rust de ntsx en entorno Windows (ntsx.exe, cmd.exe, PowerShell, %USERPROFILE%)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { sandbox, runCliWithRetry, runCliErr, createFile, createEnvFile, stripAnsi, parseJsonSafe, spawnCli } from './helpers.mjs'

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
// 1. ntsx lock - Genera lockfile para scripts y dependencias
// ============================================================

test('ntsx windows lock: genera lockfile para script sin dependencias', () => {
    const dir = sandbox()
    const scriptPath = createFile(dir, 'test-simple.js', 'console.log("simple")')
    const r = spawnCli(['lock', scriptPath], { cwd: dir })
    assert.equal(r.status, 0)
    const lockPath = `${scriptPath}.lock`
    assert.equal(existsSync(lockPath), true)
    const lockJson = JSON.parse(readFileSync(lockPath, 'utf8'))
    assert.equal(lockJson.version, 1)
    assert.equal(lockJson.script, 'test-simple.js')
    assert.ok(lockJson.runtime)
})

test('ntsx windows lock: genera lockfile con dependencias (--with)', () => {
    const dir = sandbox()
    const scriptPath = createFile(dir, 'test-deps.js', 'import chalk from "chalk"; console.log(chalk.green("ok"))')
    const r = spawnCli(['lock', '--with', 'chalk', scriptPath], { cwd: dir })
    assert.equal(r.status, 0)
    const lockPath = `${scriptPath}.lock`
    assert.equal(existsSync(lockPath), true)
    const lockJson = JSON.parse(readFileSync(lockPath, 'utf8'))
    assert.ok(lockJson.dependencies.chalk)
    assert.ok(lockJson.dependencies.chalk.version)
    assert.match(lockJson.dependencies.chalk.integrity, /^sha256-/)
})

test('ntsx windows lock: ntsx run usa el lockfile si existe', () => {
    const dir = sandbox()
    const scriptPath = createFile(dir, 'test-lock-use.js', 'import chalk from "chalk"; console.log(typeof chalk.green)')
    spawnCli(['lock', '--with', 'chalk', scriptPath], { cwd: dir })
    const out = runCliWithRetry(['run', '-q', scriptPath], { cwd: dir })
    assert.equal(out.trim(), 'function')
})

// ============================================================
// 2. ntsx tool run - Herramientas efímeras
// ============================================================

test('ntsx windows tool: ayuda del subcomando', () => {
    const r = spawnCli(['tool', '--help'])
    assert.equal(r.status, 0)
    assert.match(r.stdout, /tool/i)
})

test('ntsx windows tool: ejecuta typescript con argumentos', () => {
    const dir = sandbox()
    const r = spawnCli(['tool', 'typescript', '--version'], { cwd: dir })
    assert.equal(r.status, 0)
    assert.match(r.stdout, /Version/i)
})

test('ntsx windows tool: subcomando ntsx tool run', () => {
    const dir = sandbox()
    const r = spawnCli(['tool', 'run', 'typescript', '--version'], { cwd: dir })
    assert.equal(r.status, 0)
    assert.match(r.stdout, /Version/i)
})

test('ntsx windows tool: ntsx tool con --node 24.21.0', () => {
    const dir = sandbox()
    const r = spawnCli(['tool', '--node', '24.21.0', 'typescript', '--version'], { cwd: dir })
    assert.equal(r.status, 0)
    assert.match(r.stdout, /Version/i)
})

test('ntsx windows tool: ejecuta paquete cowsay y pasa argumentos', () => {
    const dir = sandbox()
    const r = spawnCli(['tool', 'cowsay', 'hello-win-ntsx'], { cwd: dir })
    assert.equal(r.status, 0)
    assert.match(r.stdout, /hello-win-ntsx/)
})

// ============================================================
// 3. Script Metadata (JSDoc @ntsx)
// ============================================================

test('ntsx windows metadata JSDoc: @with y @node {24.21.0}', () => {
    const dir = sandbox()
    const scriptPath = createFile(dir, 'jsdoc-test.ts', `/**
 * @ntsx
 * @with chalk
 * @node {24.21.0}
 * @runtime {tsx}
 */
import chalk from 'chalk';
console.log(process.version, typeof chalk.green);
`)
    const out = runCliWithRetry(['run', '-q', scriptPath], { cwd: dir })
    assert.match(out.trim(), /v24\.21\.0 function/)
})

test('ntsx windows metadata JSDoc: @node {26.10.0}', () => {
    const dir = sandbox()
    const scriptPath = createFile(dir, 'jsdoc-26.ts', `/**
 * @ntsx
 * @node {26.10.0}
 */
console.log(process.version);
`)
    const out = runCliWithRetry(['run', '-q', scriptPath], { cwd: dir })
    assert.equal(out.trim(), 'v26.10.0')
})

test('ntsx windows metadata JSDoc: @runtime {node}', () => {
    const dir = sandbox()
    const scriptPath = createFile(dir, 'jsdoc-runtime.js', `/**
 * @ntsx
 * @runtime {node}
 */
console.log("runtime-node-win-ok");
`)
    const out = runCliWithRetry(['run', scriptPath], { cwd: dir })
    assert.equal(out.trim(), 'runtime-node-win-ok')
})

test('ntsx windows metadata: --node 24.21.0 ejecuta script y valida process.version', () => {
    const dir = sandbox()
    const out = runCliWithRetry([
        'run', '--node', '24.21.0', '-q', '-e', 'console.log(process.version)',
    ], { cwd: dir })
    assert.equal(out.trim(), 'v24.21.0')
})

test('ntsx windows metadata: --node 26.10.0 ejecuta script y valida process.version', () => {
    const dir = sandbox()
    const out = runCliWithRetry([
        'run', '--node', '26.10.0', '-q', '-e', 'console.log(process.version)',
    ], { cwd: dir })
    assert.equal(out.trim(), 'v26.10.0')
})

test('ntsx windows metadata: script sin header funciona normalmente', () => {
    const dir = sandbox()
    const scriptPath = createFile(dir, 'no-meta.ts', 'console.log("no header ok")')
    const out = runCliWithRetry(['run', scriptPath], { cwd: dir })
    assert.equal(out.trim(), 'no header ok')
})

// ============================================================
// 4. Manejo de errores y casos edge
// ============================================================

test('ntsx windows error: node no instalado en PATH sugiere --node', () => {
    const dir = sandbox()
    const r = spawnCli(['run', '-e', 'console.log("x")'], { cwd: dir, env: { ...process.env, PATH: '' } })
    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /Recommendation: run with '--node 22' or '--node 24'/i)
})

test('ntsx windows error: script que no existe', () => {
    const dir = sandbox()
    const { code, stderr } = runCliErr(['run', 'non-existent-file.ts'], { cwd: dir })
    assert.notEqual(code, 0)
    assert.match(stderr, /not found/i)
})

test('ntsx windows error: sintaxis inválida', () => {
    const dir = sandbox()
    const scriptPath = createFile(dir, 'invalid.ts', 'const = ;;;;')
    const { code } = runCliErr(['run', scriptPath], { cwd: dir })
    assert.notEqual(code, 0)
})

test('ntsx windows error: dependencia inexistente', () => {
    const dir = sandbox()
    const { code, stderr } = runCliErr(['run', '--with', 'pkg-does-not-exist-123456789', '-e', 'console.log("x")'], { cwd: dir })
    assert.notEqual(code, 0)
    assert.match(stderr, /Invalid package spec|ERR!|failed/i)
})

// ============================================================
// Tests de dependencias con --with y passthrough
// ============================================================

test('ntsx windows: instala y usa chalk con --with', () => {
    const dir = sandbox()
    const out = runCliWithRetry([
        'run', '--with', 'chalk', '-q', '-e',
        "import chalk from 'chalk'; console.log(typeof chalk.green)",
    ], { cwd: dir })
    assert.equal(out.trim(), 'function')
})

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
