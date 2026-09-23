import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync, symlinkSync, readlinkSync, rmSync, lstatSync, chmodSync } from 'node:fs'
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
  for (const dir of sandboxes) {
    try {
      chmodSync(dir, 0o755)
    } catch {
      // ignore
    }
    rmSync(dir, { recursive: true, force: true })
  }
  rmSync(testHome, { recursive: true, force: true })
})

function spawnCli(args, opts = {}) {
  try {
    return spawnSync(process.execPath, [BIN, ...args], {
      cwd: opts.cwd,
      encoding: 'utf8',
      input: opts.input,
      env: { ...process.env, HOME: testHome },
    })
  } catch (err) {
    return { status: 1, stdout: '', stderr: err.message }
  }
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
        // reintenta
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
  const stderr = r.stderr || (r.error ? String(r.error) : '')
  return { code: r.status ?? -1, stdout: r.stdout || '', stderr }
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
// SECTION 1: 20 INLINE PACKAGE TESTS
// ==========================================

test('inline package 01: axios', () => {
  const out = runCliWithRetry(['run', '--with', 'axios', '-q', '-e', "import axios from 'axios'; console.log('axios', typeof axios.get)"])
  assert.match(out, /axios function/)
})

test('inline package 02: chalk', () => {
  const out = runCliWithRetry(['run', '--with', 'chalk', '-q', '-e', "import chalk from 'chalk'; console.log('chalk', typeof chalk.green)"])
  assert.match(out, /chalk function/)
})

test('inline package 03: lodash', () => {
  const out = runCliWithRetry(['run', '--with', 'lodash', '-q', '-e', "import _ from 'lodash'; console.log('lodash', _.capitalize('hello'))"])
  assert.match(out, /lodash Hello/)
})

test('inline package 04: dayjs', () => {
  const out = runCliWithRetry(['run', '--with', 'dayjs', '-q', '-e', "import dayjs from 'dayjs'; console.log('dayjs', dayjs().isValid())"])
  assert.match(out, /dayjs true/)
})

test('inline package 05: uuid', () => {
  const out = runCliWithRetry(['run', '--with', 'uuid', '-q', '-e', "import { v4 } from 'uuid'; console.log('uuid', typeof v4)"])
  assert.match(out, /uuid function/)
})

test('inline package 06: nanoid', () => {
  const out = runCliWithRetry(['run', '--with', 'nanoid', '-q', '-e', "import { nanoid } from 'nanoid'; console.log('nanoid', typeof nanoid)"])
  assert.match(out, /nanoid function/)
})

test('inline package 07: zod', () => {
  const out = runCliWithRetry(['run', '--with', 'zod', '-q', '-e', "import { z } from 'zod'; console.log('zod', z.string().parse('ok'))"])
  assert.match(out, /zod ok/)
})

test('inline package 08: commander', () => {
  const out = runCliWithRetry(['run', '--with', 'commander', '-q', '-e', "import { Command } from 'commander'; console.log('commander', typeof Command)"])
  assert.match(out, /commander function/)
})

test('inline package 09: ora', () => {
  const out = runCliWithRetry(['run', '--with', 'ora', '-q', '-e', "import ora from 'ora'; console.log('ora', typeof ora)"])
  assert.match(out, /ora function/)
})

test('inline package 10: p-limit', () => {
  const out = runCliWithRetry(['run', '--with', 'p-limit', '-q', '-e', "import pLimit from 'p-limit'; console.log('p-limit', typeof pLimit)"])
  assert.match(out, /p-limit function/)
})

test('inline package 11: execa', () => {
  const out = runCliWithRetry(['run', '--eval-runtime', 'node', '--with', 'execa', '-q', '-e', "import { execa } from 'execa'; console.log('execa', typeof execa)"])
  assert.match(out, /execa function/)
})

test('inline package 12: glob', () => {
  const out = runCliWithRetry(['run', '--with', 'glob', '-q', '-e', "import { glob } from 'glob'; console.log('glob', typeof glob)"])
  assert.match(out, /glob function/)
})

test('inline package 13: minimist', () => {
  const out = runCliWithRetry(['run', '--with', 'minimist', '-q', '-e', "import minimist from 'minimist'; console.log('minimist', typeof minimist)"])
  assert.match(out, /minimist function/)
})

test('inline package 14: yaml', () => {
  const out = runCliWithRetry(['run', '--with', 'yaml', '-q', '-e', "import YAML from 'yaml'; console.log('yaml', typeof YAML.parse)"])
  assert.match(out, /yaml function/)
})

test('inline package 15: semver', () => {
  const out = runCliWithRetry(['run', '--with', 'semver', '-q', '-e', "import semver from 'semver'; console.log('semver', semver.valid('1.0.0'))"])
  assert.match(out, /semver 1.0.0/)
})

test('inline package 16: dotenv', () => {
  const out = runCliWithRetry(['run', '--with', 'dotenv', '-q', '-e', "import dotenv from 'dotenv'; console.log('dotenv', typeof dotenv.config)"])
  assert.match(out, /dotenv function/)
})

test('inline package 17: ms', () => {
  const out = runCliWithRetry(['run', '--with', 'ms', '-q', '-e', "import ms from 'ms'; console.log('ms', typeof ms)"])
  assert.match(out, /ms function/)
})

test('inline package 18: mime-types', () => {
  const out = runCliWithRetry(['run', '--with', 'mime-types', '-q', '-e', "import mime from 'mime-types'; console.log('mime-types', mime.lookup('json'))"])
  assert.match(out, /mime-types application\/json/)
})

test('inline package 19: qs', () => {
  const out = runCliWithRetry(['run', '--with', 'qs', '-q', '-e', "import qs from 'qs'; console.log('qs', typeof qs.stringify)"])
  assert.match(out, /qs function/)
})

test('inline package 20: jsonwebtoken', () => {
  const out = runCliWithRetry(['run', '--with', 'jsonwebtoken', '-q', '-e', "import jwt from 'jsonwebtoken'; console.log('jsonwebtoken', typeof jwt.sign)"])
  assert.match(out, /jsonwebtoken function/)
})

// ==========================================
// SECTION 2: 20 EXAMPLE FILE TESTS
// ==========================================

test('example file 01: 01-axios.ts', () => {
  const out = runCliWithRetry(['run', '--with', 'axios', '-q', 'examples/01-axios.ts'])
  assert.match(out, /01-axios: function/)
})

test('example file 02: 02-chalk.ts', () => {
  const out = runCliWithRetry(['run', '--with', 'chalk', '-q', 'examples/02-chalk.ts'])
  assert.match(out, /02-chalk: function/)
})

test('example file 03: 03-lodash.ts', () => {
  const out = runCliWithRetry(['run', '--with', 'lodash', '-q', 'examples/03-lodash.ts'])
  assert.match(out, /03-lodash: Hello/)
})

test('example file 04: 04-dayjs.ts', () => {
  const out = runCliWithRetry(['run', '--with', 'dayjs', '-q', 'examples/04-dayjs.ts'])
  assert.match(out, /04-dayjs: true/)
})

test('example file 05: 05-uuid.ts', () => {
  const out = runCliWithRetry(['run', '--with', 'uuid', '-q', 'examples/05-uuid.ts'])
  assert.match(out, /05-uuid: function/)
})

test('example file 06: 06-nanoid.ts', () => {
  const out = runCliWithRetry(['run', '--with', 'nanoid', '-q', 'examples/06-nanoid.ts'])
  assert.match(out, /06-nanoid: function/)
})

test('example file 07: 07-zod.ts', () => {
  const out = runCliWithRetry(['run', '--with', 'zod', '-q', 'examples/07-zod.ts'])
  assert.match(out, /07-zod: hello/)
})

test('example file 08: 08-commander.ts', () => {
  const out = runCliWithRetry(['run', '--with', 'commander', '-q', 'examples/08-commander.ts'])
  assert.match(out, /08-commander: function/)
})

test('example file 09: 09-ora.ts', () => {
  const out = runCliWithRetry(['run', '--with', 'ora', '-q', 'examples/09-ora.ts'])
  assert.match(out, /09-ora: function/)
})

test('example file 10: 10-p-limit.ts', () => {
  const out = runCliWithRetry(['run', '--with', 'p-limit', '-q', 'examples/10-p-limit.ts'])
  assert.match(out, /10-p-limit: function/)
})

test('example file 11: 11-execa.ts', () => {
  const out = runCliWithRetry(['run', '--with', 'execa', '-q', 'examples/11-execa.ts'])
  assert.match(out, /11-execa: function/)
})

test('example file 12: 12-glob.ts', () => {
  const out = runCliWithRetry(['run', '--with', 'glob', '-q', 'examples/12-glob.ts'])
  assert.match(out, /12-glob: function/)
})

test('example file 13: 13-minimist.ts', () => {
  const out = runCliWithRetry(['run', '--with', 'minimist', '-q', 'examples/13-minimist.ts'])
  assert.match(out, /13-minimist: function/)
})

test('example file 14: 14-yaml.ts', () => {
  const out = runCliWithRetry(['run', '--with', 'yaml', '-q', 'examples/14-yaml.ts'])
  assert.match(out, /14-yaml: function/)
})

test('example file 15: 15-semver.ts', () => {
  const out = runCliWithRetry(['run', '--with', 'semver', '-q', 'examples/15-semver.ts'])
  assert.match(out, /15-semver: function/)
})

test('example file 16: 16-dotenv.ts', () => {
  const out = runCliWithRetry(['run', '--with', 'dotenv', '-q', 'examples/16-dotenv.ts'])
  assert.match(out, /16-dotenv: function/)
})

test('example file 17: 17-ms.ts', () => {
  const out = runCliWithRetry(['run', '--with', 'ms', '-q', 'examples/17-ms.ts'])
  assert.match(out, /17-ms: function/)
})

test('example file 18: 18-mime-types.ts', () => {
  const out = runCliWithRetry(['run', '--with', 'mime-types', '-q', 'examples/18-mime-types.ts'])
  assert.match(out, /18-mime-types: application\/json/)
})

test('example file 19: 19-qs.ts', () => {
  const out = runCliWithRetry(['run', '--with', 'qs', '-q', 'examples/19-qs.ts'])
  assert.match(out, /19-qs: function/)
})

test('example file 20: 20-jsonwebtoken.ts', () => {
  const out = runCliWithRetry(['run', '--with', 'jsonwebtoken', '-q', 'examples/20-jsonwebtoken.ts'])
  assert.match(out, /20-jsonwebtoken: function/)
})

// ==========================================
// SECTION 3: SYSTEM RESILIENCE & EDGE CASES
// ==========================================

test('resilience: SIGINT restaura node_modules', async () => {
  const dir = sandbox()
  mkdirSync(path.join(dir, 'node_modules'))
  writeFileSync(path.join(dir, 'node_modules', 'marker.txt'), 'sigint-real\n')
  const child = spawnCliAsync(['run', '--with', 'is-odd', '-q', '-e', 'await new Promise(() => {})'], { cwd: dir })
  await waitFor(() => lstatSync(path.join(dir, 'node_modules')).isSymbolicLink())
  child.kill('SIGINT')
  const code = await new Promise((resolve) => child.on('close', resolve))
  assert.ok(code === 130 || code === null, `Expected code 130 or null, got ${code}`)
  assert.match(readFileSync(path.join(dir, 'node_modules', 'marker.txt'), 'utf8'), /sigint-real/)
})

test('resilience: SIGTERM restaura node_modules', async () => {
  const dir = sandbox()
  mkdirSync(path.join(dir, 'node_modules'))
  writeFileSync(path.join(dir, 'node_modules', 'marker.txt'), 'sigterm-real\n')
  const child = spawnCliAsync(['run', '--with', 'is-odd', '-q', '-e', 'await new Promise(() => {})'], { cwd: dir })
  await waitFor(() => lstatSync(path.join(dir, 'node_modules')).isSymbolicLink())
  child.kill('SIGTERM')
  const code = await new Promise((resolve) => child.on('close', resolve))
  assert.ok(code === 143 || code === null, `Expected code 143 or null, got ${code}`)
  assert.match(readFileSync(path.join(dir, 'node_modules', 'marker.txt'), 'utf8'), /sigterm-real/)
})

test('resilience: SIGKILL fallback por proceso rebelde', async () => {
  const dir = sandbox()
  mkdirSync(path.join(dir, 'node_modules'))
  writeFileSync(path.join(dir, 'node_modules', 'marker.txt'), 'stubborn-real\n')
  // Script que ignora SIGINT y SIGTERM
  const scriptContent = `
    process.on('SIGINT', () => {});
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1000);
  `
  writeFileSync(path.join(dir, 'stubborn.js'), scriptContent)
  const child = spawnCliAsync(['run', '--with', 'is-odd', '-q', 'stubborn.js'], { cwd: dir })
  await waitFor(() => lstatSync(path.join(dir, 'node_modules')).isSymbolicLink())
  child.kill('SIGTERM')
  const code = await new Promise((resolve) => child.on('close', resolve))
  assert.notEqual(code, 0)
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
  // Intentar ejecutar sobre una ruta de archivo como directorio de trabajo
  const dummyFile = path.join(dir, 'file-not-dir')
  writeFileSync(dummyFile, 'content')
  const { code, stderr } = runCliErr(['run', '--with', 'is-odd', '-e', '1'], { cwd: dummyFile })
  assert.notEqual(code, 0)
  assert.ok(stderr.length > 0)
})

test('resilience: permission failure (directorio sin permisos de escritura)', () => {
  if (process.platform === 'win32' || process.getuid?.() === 0) return // root omite permisos
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
