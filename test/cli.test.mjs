import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync, symlinkSync, readlinkSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const BIN = path.resolve('dist/ntsx.js')

const sandboxes = []
function sandbox() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ntsx-test-'))
  sandboxes.push(dir)
  return dir
}

after(() => {
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true })
})

function spawnCli(args, opts = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: opts.cwd,
    encoding: 'utf8',
    input: opts.input,
    env: { ...process.env },
  })
}

function runCli(args, opts = {}) {
  const r = spawnCli(args, opts)
  if (r.status !== 0) {
    throw new Error(`ntsx exit ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`)
  }
  return r.stdout
}

function runCliErr(args, opts = {}) {
  const r = spawnCli(args, opts)
  return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr }
}

// Los tests que instalan deps bajan de la red: reintenta ante fallos transitorios.
function runCliWithRetry(args, opts = {}) {
  let lastErr
  for (let i = 0; i < 3; i++) {
    try {
      return runCli(args, opts)
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr
}

// ---------- evaluación ----------

test('eval por default usa tsx (soporta TS inline)', () => {
  const out = runCli(['run', '-e', "type X = { a: number }; const o: X = { a: 42 }; console.log('t-ok', o.a)"])
  assert.match(out, /t-ok 42/)
})

test('--eval-runtime node ejecuta con node nativo (top-level await)', () => {
  const out = runCli(['run', '--eval-runtime', 'node', '-e', 'await Promise.resolve(); console.log("node-ok")'])
  assert.match(out, /node-ok/)
})

test('--eval-runtime inválido devuelve error limpio y exit != 0', () => {
  const { code, stderr } = runCliErr(['run', '--eval-runtime', 'bun', '-e', '1'])
  assert.notEqual(code, 0)
  assert.match(stderr, /ntsx: /)
  assert.match(stderr, /tsx.*\|.*node/)
})

// ---------- archivos ----------

test('run .js pasa los argumentos al script', () => {
  const dir = sandbox()
  writeFileSync(path.join(dir, 'a.js'), 'console.log(JSON.stringify(process.argv.slice(2)))\n')
  const out = runCli(['run', 'a.js', 'uno', 'dos'], { cwd: dir })
  assert.deepEqual(JSON.parse(out.trim()), ['uno', 'dos'])
})

test('run .ts funciona con tsx', () => {
  const dir = sandbox()
  writeFileSync(path.join(dir, 't.ts'), 'console.log("ts-ok")\n')
  const out = runCli(['run', 't.ts'], { cwd: dir })
  assert.match(out, /ts-ok/)
})

// passThroughOptions: flags después del script van al script, no a ntsx
test('flags del script después del archivo no se secuestran', () => {
  const dir = sandbox()
  writeFileSync(path.join(dir, 'app.ts'), 'console.log(JSON.stringify(process.argv.slice(2)))\n')
  const out = runCli(['run', 'app.ts', '--verbose', '--with', 'x'], { cwd: dir })
  assert.deepEqual(JSON.parse(out.trim()), ['--verbose', '--with', 'x'])
})

// ---------- errors ----------

test('sin script ni eval → error limpio', () => {
  const { code, stderr } = runCliErr(['run'])
  assert.notEqual(code, 0)
  assert.match(stderr, /ntsx: .*required/i)
})

test('script inexistente → error limpio', () => {
  const dir = sandbox()
  const { code, stderr } = runCliErr(['run', 'no-existe.ts'], { cwd: dir })
  assert.notEqual(code, 0)
  assert.match(stderr, /ntsx: Script not found/)
})

test('--with con spec inválido → error limpio', () => {
  const dir = sandbox()
  const { code, stderr } = runCliErr(['run', '--with', 'BAD SPEC!', '-e', '1'], { cwd: dir })
  assert.notEqual(code, 0)
  assert.match(stderr, /Invalid package spec/)
})

test('--node reservado avisa por stderr', () => {
  const { stderr } = runCliErr(['run', '--node', '20', '-e', 'console.log("x")'])
  assert.match(stderr, /reserved/)
})

// ---------- deps efímeras (requieren red npm la 1a vez, luego caché) ----------

test('--with resuelve la dep efímera (chalk)', () => {
  const out = runCliWithRetry(['run', '--with', 'chalk', '-q', '-e', "import c from 'chalk'; console.log(c.green('x'))"])
  assert.equal(out.trim(), 'x')
})

test('--tsx-args reenvía =--env-file= a tsx', () => {
  const dir = sandbox()
  writeFileSync(path.join(dir, '.env'), 'FOO=desde_env\n')
  writeFileSync(path.join(dir, 't.ts'), 'console.log("FOO:", process.env.FOO)\n')
  const out = runCli(['run', '--tsx-args', '--env-file=.env', 't.ts'], { cwd: dir })
  assert.match(out, /FOO: desde_env/)
})

test('--node-args reenvía a node en .js', () => {
  const dir = sandbox()
  writeFileSync(path.join(dir, '.env'), 'BAR=js_env\n')
  writeFileSync(path.join(dir, 'j.js'), 'console.log("BAR:", process.env.BAR)\n')
  const out = runCli(['run', '--node-args', '--env-file=.env', 'j.js'], { cwd: dir })
  assert.match(out, /BAR: js_env/)
})

test('--npm-args llega al npm install (registry inválido falla rápido)', () => {
  const dir = sandbox()
  const { code, stderr } = runCliErr(
    ['run', '--with', 'is-odd', '--npm-args', '--registry=https://invalid.localhost --fetch-retries=0 --fetch-timeout=1500', '-e', '1'],
    { cwd: dir }
  )
  assert.notEqual(code, 0)
  assert.match(stderr, /npm install failed/)
})

// ---------- integridad del node_modules (regresión del bug crítico) ----------

test('--with NO destruye el node_modules real del target', () => {
  const dir = sandbox()
  mkdirSync(path.join(dir, 'node_modules'))
  writeFileSync(path.join(dir, 'node_modules', 'marcador.txt'), 'soy-real\n')
  runCliWithRetry(['run', '--with', 'left-pad', '-q', '-e', 'console.log("ok")'], { cwd: dir })
  const marker = readFileSync(path.join(dir, 'node_modules', 'marcador.txt'), 'utf8')
  assert.match(marker, /soy-real/)
  const backups = readdirSync(dir).filter((f) => f.endsWith('.bak'))
  assert.deepEqual(backups, [])
})

test('--with NO deja symlink huerfano si no había node_modules', () => {
  const dir = sandbox()
  runCliWithRetry(['run', '--with', 'is-odd', '-q', '-e', 'console.log("ok")'], { cwd: dir })
  assert.ok(!existsSync(path.join(dir, 'node_modules')), 'node_modules no debería existir tras el run')
})

test('--with respeta un node_modules que ya era symlink (sin EEXIST)', () => {
  const dir = sandbox()
  const realDir = path.join(dir, 'real-deps')
  mkdirSync(realDir)
  const linkPath = path.join(dir, 'node_modules')
  symlinkSync('real-deps', linkPath, 'dir')
  runCliWithRetry(['run', '--with', 'left-pad', '-q', '-e', 'console.log("ok")'], { cwd: dir })
  assert.equal(readlinkSync(linkPath), 'real-deps', 'el symlink original debe restaurarse')
})

// ---------- cache (destructivo al final) ----------

test('cache stats funciona', () => {
  const out = runCli(['cache', 'stats'])
  assert.match(out, /Cache:.*\.cache[\\/]ntsx/)
})

test('cache clean pide confirmación (n aborta)', () => {
  const out = runCli(['cache', 'clean'], { input: 'n\n' })
  assert.match(out, /Aborted/)
})

test('cache clean --force vacía el caché', () => {
  const out = runCli(['cache', 'clean', '--force'])
  assert.match(out, /Cache cleared|does not exist or is empty/)
})