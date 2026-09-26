import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, chmodSync, lstatSync } from 'node:fs'
import path from 'node:path'
import { BIN, testHome, sandbox, spawnCliAsync, runCli, runCliErr, runCliWithRetry, waitFor } from '../helpers.mjs'

test('resilience: SIGINT restaura node_modules', async () => {
  const dir = sandbox()
  mkdirSync(path.join(dir, 'node_modules'))
  writeFileSync(path.join(dir, 'node_modules', 'marker.txt'), 'sigint-real\n')
  runCliWithRetry(['run', '--with', 'is-odd', '-q', '-e', '1'], { cwd: dir })

  const child = spawnCliAsync(['run', '--with', 'is-odd', '-q', '-e', 'await new Promise(() => {})'], { cwd: dir })
  await waitFor(() => {
    try {
      return lstatSync(path.join(dir, 'node_modules')).isSymbolicLink()
    } catch {
      return false
    }
  })
  child.kill('SIGINT')
  const code = await new Promise((resolve) => child.on('close', resolve))
  assert.ok(code !== 0, `Expected non-zero exit code, got ${code}`)
  await waitFor(() => {
    try {
      return !lstatSync(path.join(dir, 'node_modules')).isSymbolicLink()
    } catch {
      return false
    }
  })
  assert.match(readFileSync(path.join(dir, 'node_modules', 'marker.txt'), 'utf8'), /sigint-real/)
})

test('resilience: SIGTERM restaura node_modules', async () => {
  const dir = sandbox()
  mkdirSync(path.join(dir, 'node_modules'))
  writeFileSync(path.join(dir, 'node_modules', 'marker.txt'), 'sigterm-real\n')
  runCliWithRetry(['run', '--with', 'is-odd', '-q', '-e', '1'], { cwd: dir })

  const child = spawnCliAsync(['run', '--with', 'is-odd', '-q', '-e', 'await new Promise(() => {})'], { cwd: dir })
  await waitFor(() => {
    try {
      return lstatSync(path.join(dir, 'node_modules')).isSymbolicLink()
    } catch {
      return false
    }
  })
  child.kill('SIGTERM')
  const code = await new Promise((resolve) => child.on('close', resolve))
  assert.ok(code !== 0, `Expected non-zero exit code, got ${code}`)
  await waitFor(() => {
    try {
      return !lstatSync(path.join(dir, 'node_modules')).isSymbolicLink()
    } catch {
      return false
    }
  })
  assert.match(readFileSync(path.join(dir, 'node_modules', 'marker.txt'), 'utf8'), /sigterm-real/)
})

test('resilience: SIGKILL fallback por proceso rebelde', async () => {
  const dir = sandbox()
  mkdirSync(path.join(dir, 'node_modules'))
  writeFileSync(path.join(dir, 'node_modules', 'marker.txt'), 'stubborn-real\n')
  runCliWithRetry(['run', '--with', 'is-odd', '-q', '-e', '1'], { cwd: dir })

  const scriptContent = `
    process.on('SIGINT', () => {});
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1000);
  `
  writeFileSync(path.join(dir, 'stubborn.js'), scriptContent)
  const child = spawnCliAsync(['run', '--with', 'is-odd', '-q', 'stubborn.js'], { cwd: dir })
  await waitFor(() => {
    try {
      return lstatSync(path.join(dir, 'node_modules')).isSymbolicLink()
    } catch {
      return false
    }
  })
  child.kill('SIGTERM')
  const code = await new Promise((resolve) => child.on('close', resolve))
  assert.notEqual(code, 0)
  await waitFor(() => {
    try {
      return !lstatSync(path.join(dir, 'node_modules')).isSymbolicLink()
    } catch {
      return false
    }
  })
  assert.match(readFileSync(path.join(dir, 'node_modules', 'marker.txt'), 'utf8'), /stubborn-real/)
})

test('resilience: crash (unhandled exception) restaura node_modules y propaga error', () => {
  const dir = sandbox()
  mkdirSync(path.join(dir, 'node_modules'))
  writeFileSync(path.join(dir, 'node_modules', 'marker.txt'), 'crash-real\n')
  writeFileSync(path.join(dir, 'crash.js'), 'throw new Error("fatal_crash")\n')
  const { code, stderr } = runCliErr(['run', '--with', 'is-odd', '-q', 'crash.js'], { cwd: dir })
  assert.notEqual(code, 0)
  assert.match(stderr, /fatal_crash/)
  assert.match(readFileSync(path.join(dir, 'node_modules', 'marker.txt'), 'utf8'), /crash-real/)
})

test('resilience: npm install failure es manejado limpiamente', () => {
  const dir = sandbox()
  const { code, stderr } = runCliErr(
    ['run', '--with', 'is-odd', '--npm-args', '--registry=https://invalid.localhost --fetch-retries=0 --fetch-timeout=1000', '-e', '1'],
    { cwd: dir }
  )
  assert.notEqual(code, 0)
  assert.match(stderr, /npm install failed/)
})

test('resilience: disk full / write failure manejo de error', () => {
  const dir = sandbox()
  const dummyFile = path.join(dir, 'file-not-dir')
  writeFileSync(dummyFile, 'content')
  const { code, stderr } = runCliErr(['run', '--with', 'is-odd', '-e', '1'], { cwd: dummyFile })
  assert.notEqual(code, 0)
  assert.ok(stderr.length > 0)
})

test('resilience: permission failure (directorio sin permisos de escritura)', () => {
  if (process.platform === 'win32' || process.getuid?.() === 0) return
  const dir = sandbox()
  const readonlyDir = path.join(dir, 'readonly')
  mkdirSync(readonlyDir)
  chmodSync(readonlyDir, 0o555)
  const { code, stderr } = runCliErr(['run', '--with', 'is-odd', '-e', '1'], { cwd: readonlyDir })
  assert.notEqual(code, 0)
  assert.match(stderr, /EACCES|permission/i)
})

test('resilience: nested execution (ntsx ejecuta ntsx)', () => {
  const dir = sandbox()
  writeFileSync(path.join(dir, 'inner.js'), 'console.log("nested-inner-ok")\n')
  const out = runCli(
    ['run', '-e', `import { execSync } from 'child_process'; console.log(execSync('${process.execPath} ${BIN} run inner.js', { cwd: '${dir}', encoding: 'utf8' }).trim())`],
    { cwd: dir }
  )
  assert.match(out, /nested-inner-ok/)
})

test('resilience: parallel execution y multiple ntsx processes en workspaces distintos', async () => {
  const dirA = sandbox()
  const dirB = sandbox()
  writeFileSync(path.join(dirA, 'a.js'), 'console.log("parallel-A")\n')
  writeFileSync(path.join(dirB, 'b.js'), 'console.log("parallel-B")\n')

  const childA = spawnCliAsync(['run', '--with', 'is-odd', '-q', 'a.js'], { cwd: dirA })
  const childB = spawnCliAsync(['run', '--with', 'left-pad', '-q', 'b.js'], { cwd: dirB })

  let outA = '', outB = ''
  childA.stdout?.on('data', (d) => { outA += d })
  childB.stdout?.on('data', (d) => { outB += d })

  const [codeA, codeB] = await Promise.all([
    new Promise((res) => childA.on('close', res)),
    new Promise((res) => childB.on('close', res)),
  ])

  assert.equal(codeA, 0)
  assert.equal(codeB, 0)
  assert.match(outA, /parallel-A/)
  assert.match(outB, /parallel-B/)
})

test('resilience: existing broken symlink es limpiado e instalado correctamente', () => {
  const dir = sandbox()
  const linkPath = path.join(dir, 'node_modules')
  symlinkSync(path.join(testHome, '.cache', 'ntsx', 'non-existent-target'), linkPath, 'dir')
  const out = runCliWithRetry(['run', '--with', 'left-pad', '-q', '-e', "import leftPad from 'left-pad'; console.log('broken-symlink-healed')"], { cwd: dir })
  assert.match(out, /broken-symlink-healed/)
})

test('resilience: existing .bak de ejecución interrumpida previa', () => {
  const dir = sandbox()
  mkdirSync(path.join(dir, 'node_modules'))
  writeFileSync(path.join(dir, 'node_modules', 'current.txt'), 'current-nm\n')
  writeFileSync(path.join(dir, '.ntsx-old.bak'), 'old-bak-data')
  runCliWithRetry(['run', '--with', 'is-odd', '-q', '-e', 'console.log("bak-test")'], { cwd: dir })
  assert.match(readFileSync(path.join(dir, 'node_modules', 'current.txt'), 'utf8'), /current-nm/)
  assert.ok(existsSync(path.join(dir, '.ntsx-old.bak')))
})

test('resilience: --tsx-args con múltiples flags (--tsconfig y --env-file)', () => {
  const dir = sandbox()
  writeFileSync(path.join(dir, '.env'), 'MULTIFLAG_VAR=multiflag_ok\n')
  writeFileSync(path.join(dir, 'tsconfig.custom.json'), JSON.stringify({ compilerOptions: { target: 'ES2022' } }))
  writeFileSync(path.join(dir, 'main.ts'), 'console.log("env:", process.env.MULTIFLAG_VAR)\n')

  const out = runCli(
    ['run', '--tsx-args', '--tsconfig=tsconfig.custom.json --env-file=.env', 'main.ts'],
    { cwd: dir }
  )
  assert.match(out, /env: multiflag_ok/)
})
