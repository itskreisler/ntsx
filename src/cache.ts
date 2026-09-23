import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { CACHE_ROOT } from './config.js'

export interface CacheResult {
  workspaceCacheDir: string
  cacheDir: string
  nodeModulesPath: string
  created: boolean
  stash: NodeModulesStash
}

export interface NodeModulesStash {
  kind: 'fresh' | 'link' | 'dir'
  originalTarget?: string
  backupPath?: string
}

function shortHash(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16)
}

/** Hash del directorio de trabajo → aisla deps por proyecto (evita mezclar workspaces) */
export function workspaceHash(workspaceDir: string): string {
  return shortHash(path.resolve(workspaceDir))
}

/** Hash de la lista de deps */
export function depsHash(withList: string[]): string {
  return shortHash([...withList].sort().join('\u0000'))
}

/**
 * Clave de caché: deps + flags de npm. Als args de install afectan el contenido
 * (p. ej. `--registry=espejo` vs registry por defecto), deben particionar el caché.
 */
export function cacheKey(withList: string[], npmArgs: string[]): string {
  return shortHash([depsHash(withList), ...npmArgs].join('\u0000'))
}

/** Ruta del lock de run para un targetDir (dentro del caché, no ensucia el proyecto). */
function lockPathFor(targetDir: string): string {
  return path.join(CACHE_ROOT, workspaceHash(targetDir), 'run.lock')
}

/**
 * Lock no-bloqueante por targetDir: dos ntsx run concurrentes sobre el mismo
 * directorio compiten por el stash/symlink/restore y se rompen; aquí el segundo
 * aborta con mensaje claro. Locks huérfanos (PID muerto) se recuperan.
 * Devuelve una función de liberación idempotente.
 */
export async function acquireRunLock(targetDir: string): Promise<() => Promise<void>> {
  const lockPath = lockPathFor(targetDir)
  await fs.mkdir(path.dirname(lockPath), { recursive: true })

  for (let attempt = 0; attempt < 2; attempt++) {
    let fd: fs.FileHandle | null = null
    try {
      fd = await fs.open(lockPath, 'wx')
      await fd.writeFile(`${process.pid}\n`)
      let closed = false
      return async () => {
        if (closed) return
        closed = true
        await fd?.close().catch(() => {})
        await fs.unlink(lockPath).catch(() => {})
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'EEXIST') throw err
      // Hay un lock: si su dueño sigue vivo → aborta; si no → stale, limpiar y reintentar
      const owner = (await fs.readFile(lockPath, 'utf8').catch(() => '')).trim()
      if (isPidAlive(Number(owner))) {
        throw new Error(
          `otro ntsx ya está corriendo en este directorio (pid ${owner}). Espera a que termine o elimina ${lockPath}`
        )
      }
      await fs.unlink(lockPath).catch(() => {})
    }
  }
  throw new Error(`no se pudo adquirir el run lock: ${lockPath}`)
}

/** ¿El PID corresponde a un proceso vivo? (ESRCH=muerto, EPERM=vivo sin permiso de señal) */
function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Cache aisla por workspace (proyecto) y por conjunto de deps + flags npm */
export function cacheDirFor(workspaceDir: string, withList: string[], npmArgs: string[] = []): string {
  return path.join(CACHE_ROOT, workspaceHash(workspaceDir), cacheKey(withList, npmArgs))
}

/** Prepara cache aislado por workspace + deps, y symlink hacia targetDir. */
export async function prepareCache(
  withList: string[],
  targetDir: string,
  opts: { quiet?: boolean; npmArgs?: string[]; debug?: boolean } = {}
): Promise<CacheResult> {
  const wsHash = workspaceHash(targetDir)
  const workspaceCacheDir = path.join(CACHE_ROOT, wsHash)
  const cacheDir = path.join(workspaceCacheDir, cacheKey(withList, opts.npmArgs ?? []))
  const cacheNodeModules = path.join(cacheDir, 'node_modules')

  debugLog(opts.debug, `workspace cache: ${workspaceCacheDir}`)
  debugLog(opts.debug, `deps cache: ${cacheDir}`)
  await fs.mkdir(workspaceCacheDir, { recursive: true })
  await fs.mkdir(cacheDir, { recursive: true })

  // ¿ya instalado? → skip npm install
  let installed = false
  try {
    await fs.access(path.join(cacheDir, 'package.json'))
    await fs.access(cacheNodeModules)
    installed = true
  } catch {
    installed = false
  }

  let created = false
  if (!installed) {
    debugLog(opts.debug, `npm install: ${withList.join(', ')} (${cacheDir})`)
    await writePackageJson(cacheDir, withList)
    runNpmInstall(cacheDir, opts.quiet ?? false, opts.npmArgs ?? [], opts.debug ?? false)
    created = true
  } else {
    debugLog(opts.debug, 'deps already installed in cache (skipping npm install)')
  }

  // Symlink node_modules en targetDir, preservando el node_modules real
  const nodeModulesPath = path.join(targetDir, 'node_modules')
  const stash = await stashNodeModules(nodeModulesPath)
  debugLog(opts.debug, `node_modules en ${targetDir}: ${stash.kind === 'fresh' ? 'no existía (fresh)' : stash.kind === 'link' ? `symlink → ${stash.originalTarget}` : `apartado en ${stash.backupPath}`}`)
  try {
    await fs.symlink(cacheNodeModules, nodeModulesPath, 'dir')
  } catch (err) {
    await restoreNodeModules(nodeModulesPath, stash)
    throw err
  }
  debugLog(opts.debug, `symlink ${nodeModulesPath} → ${cacheNodeModules}`)

  return { workspaceCacheDir, cacheDir, nodeModulesPath: cacheNodeModules, created, stash }
}

function debugLog(enabled: boolean | undefined, msg: string): void {
  if (enabled) process.stderr.write(`ntsx: [debug] ${msg}\n`)
}

/** Aparta el node_modules existente del target para no pisarlo con el symlink. */
async function stashNodeModules(p: string): Promise<NodeModulesStash> {
  try {
    const st = await fs.lstat(p)
    if (st.isSymbolicLink()) {
      const originalTarget = await fs.readlink(p)
      // Un symlink apuntando a un cache ntsx es un artefacto de un run abortado:
      // se descarta sin restaurar.
      if (originalTarget.startsWith(CACHE_ROOT)) {
        await fs.unlink(p).catch(() => {})
        return { kind: 'fresh' }
      }
      await fs.unlink(p)
      return { kind: 'link', originalTarget }
    }
    if (st.isDirectory()) {
      const backupPath = path.join(path.dirname(p), `.ntsx-${process.pid}-${Date.now()}.bak`)
      await fs.rename(p, backupPath)
      return { kind: 'dir', backupPath }
    }
  } catch {
    // no existe → como si no hubiera nada
  }
  return { kind: 'fresh' }
}

export async function restoreNodeModules(p: string, stash: NodeModulesStash): Promise<void> {
  // Importante: en algunos kernels/filesystems renombrar un directorio encima de un
  // symlink activo produce ENOTDIR; siempre desenlazamos el symlink temporal primero.
  if (stash.kind === 'link' && stash.originalTarget) {
    await fs.unlink(p).catch(() => {})
    try {
      await fs.symlink(stash.originalTarget, p, 'dir')
    } catch (err) {
      warn(`no se pudo restaurar el symlink original ${stash.originalTarget} en ${p}: ${errMsg(err)}`)
    }
  } else if (stash.kind === 'dir' && stash.backupPath) {
    await fs.unlink(p).catch(() => {})
    try {
      await fs.rename(stash.backupPath, p)
    } catch (err) {
      warn(`no se pudo restaurar tu node_modules real desde ${stash.backupPath}: ${errMsg(err)}`)
    }
  } else {
    // kind 'fresh': solo eliminamos el symlink que creamos
    await fs.unlink(p).catch(() => {})
  }
}

function warn(msg: string): void {
  process.stderr.write(`ntsx: warning: ${msg}\n`)
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Divide "pkg" | "pkg@1.2.3" | "@scope/pkg" | "@scope/pkg@1.2.3" en [name, version] */
function parseSpec(spec: string): [string, string] {
  if (spec.startsWith('@')) {
    const at = spec.indexOf('@', 1)
    if (at === -1) return [spec, '*']
    return [spec.slice(0, at), spec.slice(at + 1)]
  }
  const at = spec.indexOf('@')
  if (at === -1) return [spec, '*']
  return [spec.slice(0, at), spec.slice(at + 1)]
}

async function writePackageJson(dir: string, withList: string[]): Promise<void> {
  const dependencies: Record<string, string> = {}
  for (const spec of withList) {
    const [name, version] = parseSpec(spec)
    dependencies[name] = version
  }
  const packageJson = {
    name: 'ntsx-cache-' + depsHash(withList),
    type: 'module',
    private: true,
    dependencies,
  }
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n')
}

function runNpmInstall(dir: string, quiet: boolean, npmArgs: string[], debug = false): void {
  const flags = [...npmArgs]
  const cmd = ['npm', 'install', '--no-audit', '--no-fund', ...flags]
  debugLog(debug, `exec: ${cmd.join(' ')}`)
  const res = spawnSync(cmd[0], cmd.slice(1), {
    cwd: dir,
    stdio: ['pipe', debug || !quiet ? 'inherit' : 'ignore', 'pipe'],
    env: cleanNpmEnv(process.env),
    encoding: 'utf8',
  })
  if (res.status !== 0) {
    const detail = (res.stderr || '').trim().split('\n').slice(0, 8).join('\n')
    throw new Error(`npm install failed (exit ${res.status ?? 'unknown'}) in ${dir}\n${detail}`)
  }
  debugLog(debug, 'npm install ok')
}

/**
 * La instalación efímera corre aislada en el caché: no debe heredar la config del
 * npm que nos invocó (p. ej. npm_config_allow_scripts o npm configs del proyecto
 * padre), solo las variables de entorno generales (PATH, HOME, etc.).
 */
function cleanNpmEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base }
  for (const key of Object.keys(env)) {
    // npm lee las dos formas (npm_config_x y NPM_CONFIG_X); taparlas todas
    if (/^npm_config_/i.test(key)) delete env[key]
  }
  return env
}