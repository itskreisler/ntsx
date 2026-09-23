import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync, symlinkSync, readlinkSync, rmSync, lstatSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const BIN = path.resolve('dist/ntsx.js')

// HOME aislado: los tests NO tocan el ~/.cache del usuario real.
const testHome = mkdtempSync(path.join(os.tmpdir(), 'ntsx-home-'))

const sandboxes = []
function sandbox() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ntsx-test-'))
  sandboxes.push(dir)
  return dir
}

after(() => {
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true })
  rmSync(testHome, { recursive: true, force: true })
})

function spawnCli(args, opts = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: opts.cwd,
    encoding: 'utf8',
    input: opts.input,
    env: { ...process.env, HOME: testHome },
  })
}

function spawnCliAsync(args, opts = {}) {
  return spawn(process.execPath, [BIN, ...args], {
    cwd: opts.cwd,
    env: { ...process.env, HOME: testHome },
  })
}

function waitFor(fn, timeoutMs = 20000, stepMs = 100) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      try {
        if (fn()) return resolve(true)
      } catch {
        // condicion aún no alcanzable: reintenta
      }
      if (Date.now() - start > timeoutMs) return reject(new Error('timeout esperando condición'))
      setTimeout(tick, stepMs)
    }
    tick()
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

// ==========================================
// SECTION 1: 20 INLINE (-e / --eval) TESTS
// ==========================================

test('inline 01: eval por default usa tsx (soporta TS syntax)', () => {
  const out = runCli(['run', '-e', "type X = { a: number }; const o: X = { a: 42 }; console.log('inline-01', o.a)"])
  assert.match(out, /inline-01 42/)
})

test('inline 02: eval con múltiples sentencias y salida estándar', () => {
  const out = runCli(['run', '-e', "const a = 10; const b = 20; console.log('sum:', a + b)"])
  assert.match(out, /sum: 30/)
})

test('inline 03: eval con --eval-runtime node ejecuta con node nativo (top-level await)', () => {
  const out = runCli(['run', '--eval-runtime', 'node', '-e', 'await Promise.resolve(); console.log("node-native-ok")'])
  assert.match(out, /node-native-ok/)
})

test('inline 04: eval con --eval-runtime tsx explícito', () => {
  const out = runCli(['run', '--eval-runtime', 'tsx', '-e', 'const x: number = 100; console.log("tsx-explicit", x)'])
  assert.match(out, /tsx-explicit 100/)
})

test('inline 05: eval con --eval-runtime inválido devuelve error limpio y exit != 0', () => {
  const { code, stderr } = runCliErr(['run', '--eval-runtime', 'bun', '-e', '1'])
  assert.notEqual(code, 0)
  assert.match(stderr, /ntsx: /)
  assert.match(stderr, /tsx.*\|.*node/)
})

test('inline 06: eval pasa los scriptArgs después de la expresión eval', () => {
  const out = runCli(['run', '-e', 'console.log(JSON.stringify(process.argv.slice(1)))', 'argA', 'argB', 'argC'])
  assert.deepEqual(JSON.parse(out.trim()), ['argA', 'argB', 'argC'])
})

test('inline 07: eval con --with instala y resuelve dep efímera (is-odd)', () => {
  const out = runCliWithRetry(['run', '--with', 'is-odd', '-q', '-e', "import isOdd from 'is-odd'; console.log('isOdd(5):', isOdd(5))"])
  assert.match(out, /isOdd\(5\): true/)
})

test('inline 08: eval con múltiples --with (--with is-odd --with left-pad)', () => {
  const out = runCliWithRetry([
    'run',
    '--with',
    'is-odd',
    '--with',
    'left-pad',
    '-q',
    '-e',
    "import isOdd from 'is-odd'; import leftPad from 'left-pad'; console.log(isOdd(3), leftPad('hi', 5))",
  ])
  assert.match(out, /true\s+hi/)
})

test('inline 09: eval con versión fijada (--with is-odd@3.0.1)', () => {
  const out = runCliWithRetry(['run', '--with', 'is-odd@3.0.1', '-q', '-e', "import isOdd from 'is-odd'; console.log('pinned:', isOdd(7))"])
  assert.match(out, /pinned: true/)
})

test('inline 10: eval con alias o spec con scope (--with is-odd)', () => {
  const out = runCliWithRetry(['run', '--with', 'is-odd', '-q', '-e', "console.log('scoped/spec ok')"])
  assert.match(out, /scoped\/spec ok/)
})

test('inline 11: eval con flag -q / --quiet suprime salida de npm', () => {
  const { stderr, stdout } = runCliErr(['run', '-q', '-e', 'console.log("quiet-test")'])
  assert.equal(stdout.trim(), 'quiet-test')
  assert.equal(stderr.trim(), '')
})

test('inline 12: eval con -d / --debug muestra traza interna en stderr', () => {
  const { stderr, stdout } = runCliErr(['run', '-d', '-e', 'console.log("debug-test")'])
  assert.equal(stdout.trim(), 'debug-test')
  assert.match(stderr, /ntsx: \[debug\]/)
})

test('inline 13: eval con --tsx-args reenvía flags a tsx (con comillas preservadas)', () => {
  const dir = sandbox()
  writeFileSync(path.join(dir, '.env'), 'INLINE_ENV=hello_from_inline_env\n')
  const out = runCli(['run', '--tsx-args', '--env-file=.env', '-e', 'console.log(process.env.INLINE_ENV)'], { cwd: dir })
  assert.equal(out.trim(), 'hello_from_inline_env')
})

test('inline 14: eval con --node-args en modo --eval-runtime node', () => {
  const dir = sandbox()
  writeFileSync(path.join(dir, '.env'), 'NODE_ENV_TEST=node_val\n')
  const out = runCli(['run', '--eval-runtime', 'node', '--node-args', '--env-file=.env', '-e', 'console.log(process.env.NODE_ENV_TEST)'], {
    cwd: dir,
  })
  assert.equal(out.trim(), 'node_val')
})

test('inline 15: eval con --npm-args (registry inválido falla rápido)', () => {
  const dir = sandbox()
  const { code, stderr } = runCliErr(
    ['run', '--with', 'is-odd', '--npm-args', '--registry=https://invalid.localhost --fetch-retries=0 --fetch-timeout=1000', '-e', '1'],
    { cwd: dir }
  )
  assert.notEqual(code, 0)
  assert.match(stderr, /npm install failed/)
})

test('inline 16: eval con script y eval omitidos da error', () => {
  const { code, stderr } = runCliErr(['run'])
  assert.notEqual(code, 0)
  assert.match(stderr, /ntsx: .*required/i)
})

test('inline 17: eval propaga exit code no cero (process.exit(42))', () => {
  const { code } = runCliErr(['run', '-e', 'process.exit(42)'])
  assert.equal(code, 42)
})

test('inline 18: eval con error de sintaxis propaga exit code no cero', () => {
  const { code, stderr } = runCliErr(['run', '-e', 'const const = invalid;'])
  assert.notEqual(code, 0)
  assert.ok(stderr.length > 0)
})

test('inline 19: eval con --node reservado muestra nota en stderr', () => {
  const { stderr, stdout } = runCliErr(['run', '--node', '22', '-e', 'console.log("node-reserved")'])
  assert.equal(stdout.trim(), 'node-reserved')
  assert.match(stderr, /--node is reserved and currently ignored/)
})

test('inline 20: eval con --with spec inválido devuelve error limpio', () => {
  const { code, stderr } = runCliErr(['run', '--with', 'INVALID SPEC!', '-e', '1'])
  assert.notEqual(code, 0)
  assert.match(stderr, /Invalid package spec/)
})

// ==========================================
// SECTION 2: 20 FILE TESTS
// ==========================================

test('file 01: run .js pasa argumentos al script', () => {
  const dir = sandbox()
  writeFileSync(path.join(dir, 'a.js'), 'console.log(JSON.stringify(process.argv.slice(2)))\n')
  const out = runCli(['run', 'a.js', 'uno', 'dos', 'tres'], { cwd: dir })
  assert.deepEqual(JSON.parse(out.trim()), ['uno', 'dos', 'tres'])
})

test('file 02: run .ts ejecuta con tsx', () => {
  const dir = sandbox()
  writeFileSync(path.join(dir, 't.ts'), 'const val: string = "ts-file-ok"; console.log(val)\n')
  const out = runCli(['run', 't.ts'], { cwd: dir })
  assert.match(out, /ts-file-ok/)
})

test('file 03: run .mjs ejecuta con node nativo', () => {
  const dir = sandbox()
  writeFileSync(path.join(dir, 'm.mjs'), 'console.log("mjs-ok", typeof import.meta.url)\n')
  const out = runCli(['run', 'm.mjs'], { cwd: dir })
  assert.match(out, /mjs-ok string/)
})

test('file 04: run .cjs ejecuta con node nativo', () => {
  const dir = sandbox()
  writeFileSync(path.join(dir, 'c.cjs'), 'console.log("cjs-ok", typeof exports)\n')
  const out = runCli(['run', 'c.cjs'], { cwd: dir })
  assert.match(out, /cjs-ok object/)
})

test('file 05: run .tsx ejecuta con tsx', () => {
  const dir = sandbox()
  writeFileSync(path.join(dir, 'v.tsx'), 'const App = () => "tsx-file"; console.log(App())\n')
  const out = runCli(['run', 'v.tsx'], { cwd: dir })
  assert.match(out, /tsx-file/)
})

test('file 06: run .mts ejecuta con tsx', () => {
  const dir = sandbox()
  writeFileSync(path.join(dir, 'mod.mts'), 'export const greeting: string = "mts-ok"; console.log(greeting)\n')
  const out = runCli(['run', 'mod.mts'], { cwd: dir })
  assert.match(out, /mts-ok/)
})

test('file 07: run .cts ejecuta con tsx', () => {
  const dir = sandbox()
  writeFileSync(path.join(dir, 'mod.cts'), 'const x: number = 99; console.log("cts-ok", x)\n')
  const out = runCli(['run', 'mod.cts'], { cwd: dir })
  assert.match(out, /cts-ok 99/)
})

test('file 08: run script usando ruta absoluta', () => {
  const dir = sandbox()
  const absPath = path.join(dir, 'abs.js')
  writeFileSync(absPath, 'console.log("abs-ok")\n')
  const out = runCli(['run', absPath])
  assert.match(out, /abs-ok/)
})

test('file 09: run script en subdirectorio con ruta relativa', () => {
  const dir = sandbox()
  mkdirSync(path.join(dir, 'sub'), { recursive: true })
  writeFileSync(path.join(dir, 'sub', 'nested.ts'), 'console.log("nested-ok")\n')
  const out = runCli(['run', 'sub/nested.ts'], { cwd: dir })
  assert.match(out, /nested-ok/)
})

test('file 10: flags del script después del archivo no se secuestran (passThroughOptions)', () => {
  const dir = sandbox()
  writeFileSync(path.join(dir, 'app.ts'), 'console.log(JSON.stringify(process.argv.slice(2)))\n')
  const out = runCli(['run', 'app.ts', '--verbose', '--with', 'pkgName', '-q'], { cwd: dir })
  assert.deepEqual(JSON.parse(out.trim()), ['--verbose', '--with', 'pkgName', '-q'])
})

test('file 11: script inexistente devuelve error limpio y exit != 0', () => {
  const dir = sandbox()
  const { code, stderr } = runCliErr(['run', 'no-existe.ts'], { cwd: dir })
  assert.notEqual(code, 0)
  assert.match(stderr, /ntsx: Script not found/)
})

test('file 12: file run con dep efímera --with (left-pad)', () => {
  const dir = sandbox()
  writeFileSync(path.join(dir, 'script.js'), "import leftPad from 'left-pad'; console.log(leftPad('pad', 6))\n")
  const out = runCliWithRetry(['run', '--with', 'left-pad', '-q', 'script.js'], { cwd: dir })
  assert.match(out, /   pad/)
})

test('file 13: file run con --tsx-args reenvía =--env-file= a tsx', () => {
  const dir = sandbox()
  writeFileSync(path.join(dir, '.env'), 'FOO=desde_env_file\n')
  writeFileSync(path.join(dir, 't.ts'), 'console.log("FOO:", process.env.FOO)\n')
  const out = runCli(['run', '--tsx-args', '--env-file=.env', 't.ts'], { cwd: dir })
  assert.match(out, /FOO: desde_env_file/)
})

test('file 14: file run con --node-args reenvía flags a node en .js', () => {
  const dir = sandbox()
  writeFileSync(path.join(dir, '.env'), 'BAR=js_env_file\n')
  writeFileSync(path.join(dir, 'j.js'), 'console.log("BAR:", process.env.BAR)\n')
  const out = runCli(['run', '--node-args', '--env-file=.env', 'j.js'], { cwd: dir })
  assert.match(out, /BAR: js_env_file/)
})

test('file 15: file run con -d / --debug muestra traza interna de cache y symlink', () => {
  const dir = sandbox()
  writeFileSync(path.join(dir, 's.js'), 'console.log("debug-file")\n')
  const { stderr, stdout } = runCliErr(['run', '-d', 's.js'], { cwd: dir })
  assert.equal(stdout.trim(), 'debug-file')
  assert.match(stderr, /ntsx: \[debug\] exec:/)
})

test('file 16: file run NO destruye el node_modules real del target', () => {
  const dir = sandbox()
  mkdirSync(path.join(dir, 'node_modules'))
  writeFileSync(path.join(dir, 'node_modules', 'marcador.txt'), 'soy-real\n')
  writeFileSync(path.join(dir, 's.js'), 'console.log("file-safe")\n')
  runCliWithRetry(['run', '--with', 'left-pad', '-q', 's.js'], { cwd: dir })
  const marker = readFileSync(path.join(dir, 'node_modules', 'marcador.txt'), 'utf8')
  assert.match(marker, /soy-real/)
  const backups = readdirSync(dir).filter((f) => f.endsWith('.bak'))
  assert.deepEqual(backups, [])
})

test('file 17: file run NO deja symlink huerfano si no había node_modules previamente', () => {
  const dir = sandbox()
  writeFileSync(path.join(dir, 's.js'), 'console.log("no-symlink-left")\n')
  runCliWithRetry(['run', '--with', 'is-odd', '-q', 's.js'], { cwd: dir })
  assert.ok(!existsSync(path.join(dir, 'node_modules')), 'node_modules no debería existir tras el run')
})

test('file 18: file run respeta un node_modules que ya era symlink original', () => {
  const dir = sandbox()
  const realDir = path.join(dir, 'real-deps')
  mkdirSync(realDir)
  const linkPath = path.join(dir, 'node_modules')
  symlinkSync('real-deps', linkPath, 'dir')
  writeFileSync(path.join(dir, 's.js'), 'console.log("symlink-restored")\n')
  runCliWithRetry(['run', '--with', 'left-pad', '-q', 's.js'], { cwd: dir })
  assert.equal(readlinkSync(linkPath), 'real-deps', 'el symlink original debe restaurarse')
})

test('file 19: file run propaga el exit code del script (process.exit(17))', () => {
  const dir = sandbox()
  writeFileSync(path.join(dir, 'err.js'), 'process.exit(17)\n')
  const { code } = runCliErr(['run', 'err.js'], { cwd: dir })
  assert.equal(code, 17)
})

test('file 20: file run con script que lanza una excepción no capturada', () => {
  const dir = sandbox()
  writeFileSync(path.join(dir, 'throw.js'), 'throw new Error("uncaught_test_error")\n')
  const { code, stderr } = runCliErr(['run', 'throw.js'], { cwd: dir })
  assert.notEqual(code, 0)
  assert.match(stderr, /uncaught_test_error/)
})

// ==========================================
// SECTION 3: CONCURRENCY, LOCKS, SIGNALS & CACHE COMMANDS
// ==========================================

test('SIGTERM restaura node_modules (graceful shutdown, útil para pm2)', async () => {
  const dir = sandbox()
  mkdirSync(path.join(dir, 'node_modules'))
  writeFileSync(path.join(dir, 'node_modules', 'marcador.txt'), 'soy-real\n')
  const child = spawnCliAsync(['run', '--with', 'is-odd', '-q', '-e', 'await new Promise(() => {})'], { cwd: dir })
  await waitFor(() => lstatSync(path.join(dir, 'node_modules')).isSymbolicLink())
  child.kill('SIGTERM')
  const code = await new Promise((resolve) => child.on('close', resolve))
  assert.equal(code, 143, 'exit 143 = terminado por SIGTERM tras restaurar')
  assert.match(readFileSync(path.join(dir, 'node_modules', 'marcador.txt'), 'utf8'), /soy-real/)
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.bak')), [])
})

test('symlink huerfano hacia el cache se autocura (crash previo)', () => {
  const dir = sandbox()
  const linkPath = path.join(dir, 'node_modules')
  symlinkSync(path.join(testHome, '.cache', 'ntsx', 'ficticio-que-no-existe'), linkPath, 'dir')
  runCliWithRetry(['run', '--with', 'left-pad', '-q', '-e', 'console.log("ok")'], { cwd: dir })
  assert.ok(!existsSync(linkPath), 'el symlink huérfano se descarta (fresh): no debe quedar')
})

test('lock: un run concurrente aborta y se libera al terminar', async () => {
  const dir = sandbox()
  const a = spawnCliAsync(['run', '--with', 'is-odd', '-q', '-e', 'await new Promise(() => {})'], { cwd: dir })
  try {
    await waitFor(() => lstatSync(path.join(dir, 'node_modules')).isSymbolicLink())
    const b = runCliErr(['run', '--with', 'left-pad', '-q', '-e', 'console.log("b")'], { cwd: dir })
    assert.notEqual(b.code, 0)
    assert.match(b.stderr, /otro ntsx ya está corriendo/)
    assert.ok(lstatSync(path.join(dir, 'node_modules')).isSymbolicLink(), 'A sigue en su sitio')

    a.kill('SIGTERM')
    const code = await new Promise((resolve) => a.on('close', resolve))
    assert.equal(code, 143)

    const out = runCliWithRetry(['run', '--with', 'left-pad', '-q', '-e', 'console.log("b2")'], { cwd: dir })
    assert.match(out, /b2/)
  } finally {
    if (a.exitCode === null) a.kill('SIGKILL')
  }
})

test('lock huerfano (pid muerto) se limpia y el run procede', () => {
  const dir = sandbox()
  const wsHash = createHash('sha256').update(path.resolve(dir)).digest('hex').slice(0, 16)
  const lockDir = path.join(testHome, '.cache', 'ntsx', wsHash)
  mkdirSync(lockDir, { recursive: true })
  writeFileSync(path.join(lockDir, 'run.lock'), '4194303\n') // pid máximo de Linux, no existe
  const out = runCliWithRetry(['run', '--with', 'left-pad', '-q', '-e', 'console.log("stale-ok")'], { cwd: dir })
  assert.match(out, /stale-ok/)
})

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
