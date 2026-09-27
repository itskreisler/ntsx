/**
 * Helpers específicos para tests del binario Rust en Windows (entorno nvm / cmd / powershell / %USERPROFILE%)
 */
import { after } from 'node:test'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, chmodSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Plataforma
const platformDir = 'windows-x86_64'
const ext = '.exe'

// Rutas
export const RUST_BIN = path.resolve(`rust/bin/${platformDir}/ntsx${ext}`)

// HOME aislado para tests (%USERPROFILE% en Windows)
const sharedHome = path.join(os.tmpdir(), 'ntsx-windows-test-home')
if (!existsSync(sharedHome)) {
    mkdirSync(sharedHome, { recursive: true })
}
export const testHome = sharedHome

// Sandboxes
export const sandboxes = []
export function sandbox() {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ntsx-win-test-'))
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

/**
 * Ejecuta el CLI de ntsx con los argumentos dados (%USERPROFILE% y HOME simulado)
 */
export function spawnCli(args, opts = {}) {
    try {
        return spawnSync(RUST_BIN, args, {
            cwd: opts.cwd,
            encoding: 'utf8',
            input: opts.input,
            env: { ...process.env, HOME: testHome, USERPROFILE: testHome },
            timeout: opts.timeout || 60000,
        })
    } catch (err) {
        return { status: 1, stdout: '', stderr: err.message }
    }
}

/**
 * Ejecuta el CLI de ntsx de forma asíncrona
 */
export function spawnCliAsync(args, opts = {}) {
    return spawn(RUST_BIN, args, {
        cwd: opts.cwd,
        env: { ...process.env, HOME: testHome, USERPROFILE: testHome },
    })
}

/**
 * Espera hasta que se cumpla una condición
 */
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

/**
 * Ejecuta el CLI y lanza error si falla
 */
export function runCli(args, opts = {}) {
    const r = spawnCli(args, opts)
    if (r.status !== 0) {
        throw new Error(`ntsx exit ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`)
    }
    return r.stdout
}

/**
 * Ejecuta el CLI y retorna código, stdout y stderr sin lanzar error
 */
export function runCliErr(args, opts = {}) {
    const r = spawnCli(args, opts)
    const stderr = r.stderr || (r.error ? String(r.error) : '')
    return { code: r.status ?? -1, stdout: r.stdout || '', stderr }
}

/**
 * Ejecuta el CLI con reintentos
 */
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

/**
 * Crea un archivo en un sandbox y retorna su ruta absoluta
 */
export function createFile(dir, filename, content) {
    const filePath = path.join(dir, filename)
    writeFileSync(filePath, content, 'utf8')
    return filePath
}

/**
 * Crea un archivo .env en un sandbox
 */
export function createEnvFile(dir, vars = { USER_ID: '12345' }) {
    const envPath = path.join(dir, '.env')
    const content = Object.entries(vars)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n') + '\n'
    writeFileSync(envPath, content, 'utf8')
    return envPath
}

/**
 * Limpia códigos ANSI de una cadena
 */
export function stripAnsi(str) {
    return str.replace(/\x1B\[[0-9;]*m/g, '')
}

/**
 * Parsea JSON de forma segura, limpiando ANSI primero
 */
export function parseJsonSafe(str) {
    return JSON.parse(stripAnsi(str.trim()))
}
