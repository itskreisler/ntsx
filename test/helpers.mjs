import { after } from 'node:test'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, chmodSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const RUST_BIN = path.resolve('rust/bin/ntsx')
export const BIN = path.resolve('dist/ntsx.js')

const useRust = process.env.USE_RUST_BIN === '1' && existsSync(RUST_BIN)

// HOME aislado compartido entre tests: reusa el caché de npm/ntsx para velocidad instantánea.
const sharedHome = path.join(os.tmpdir(), 'ntsx-shared-test-home')
if (!existsSync(sharedHome)) {
  mkdirSync(sharedHome, { recursive: true })
}
export const testHome = sharedHome

export const sandboxes = []
export function sandbox() {
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
})

export function spawnCli(args, opts = {}) {
  try {
    const binToRun = useRust ? RUST_BIN : process.execPath
    const cmdArgs = useRust ? args : [BIN, ...args]
    return spawnSync(binToRun, cmdArgs, {
      cwd: opts.cwd,
      encoding: 'utf8',
      input: opts.input,
      env: { ...process.env, HOME: testHome },
    })
  } catch (err) {
    return { status: 1, stdout: '', stderr: err.message }
  }
}

export function spawnCliAsync(args, opts = {}) {
  const binToRun = useRust ? RUST_BIN : process.execPath
  const cmdArgs = useRust ? args : [BIN, ...args]
  return spawn(binToRun, cmdArgs, {
    cwd: opts.cwd,
    env: { ...process.env, HOME: testHome },
  })
}

export function waitFor(fn, timeoutMs = 60000, stepMs = 100) {
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

export function runCli(args, opts = {}) {
  const r = spawnCli(args, opts)
  if (r.status !== 0) {
    throw new Error(`ntsx exit ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`)
  }
  return r.stdout
}

export function runCliErr(args, opts = {}) {
  const r = spawnCli(args, opts)
  const stderr = r.stderr || (r.error ? String(r.error) : '')
  return { code: r.status ?? -1, stdout: r.stdout || '', stderr }
}

export function runCliWithRetry(args, opts = {}) {
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
