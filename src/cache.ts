import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { CACHE_ROOT } from './config.js'

/**
 * Result returned after preparing an ephemeral dependency cache workspace.
 */
export interface CacheResult {
  /** Path to the workspace cache directory. */
  workspaceCacheDir: string
  /** Path to the specific dependency set cache directory. */
  cacheDir: string
  /** Path to the node_modules directory within cache. */
  nodeModulesPath: string
  /** Whether a new npm install was triggered. */
  created: boolean
  /** Stash metadata for restoring original node_modules. */
  stash: NodeModulesStash
}

/**
 * Metadata capturing the state of target node_modules before symlinking.
 */
export interface NodeModulesStash {
  /** 'fresh' if node_modules didn't exist, 'link' if it was a symlink, 'dir' if real directory. */
  kind: 'fresh' | 'link' | 'dir'
  /** Original symlink target if kind === 'link'. */
  originalTarget?: string
  /** Backup directory path if kind === 'dir'. */
  backupPath?: string
}

/**
 * Options for cache preparation.
 */
export interface PrepareCacheOptions {
  /** If true, suppresses npm install stdout output. */
  quiet?: boolean
  /** Extra flags passed to npm install. */
  npmArgs?: string[]
  /** If true, prints internal step logs to stderr. */
  debug?: boolean
}

/**
 * Generates a short 16-character SHA-256 hex digest.
 *
 * @param s - Input string to hash.
 * @returns 16-character hex hash string.
 */
function shortHash(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16)
}

/**
 * Hashes absolute path of workspace directory to isolate caches per project.
 *
 * @param workspaceDir - Directory path of the workspace.
 * @returns 16-character workspace hash.
 */
export function workspaceHash(workspaceDir: string): string {
  return shortHash(path.resolve(workspaceDir))
}

/**
 * Hashes a list of package specifiers deterministically.
 *
 * @param withList - List of package specifiers.
 * @returns 16-character dependencies hash.
 */
export function depsHash(withList: string[]): string {
  return shortHash([...withList].sort().join('\u0000'))
}

/**
 * Generates a cache key partitioning dependencies and npm flags.
 *
 * @param withList - Package specifiers.
 * @param npmArgs - Extra npm flags.
 * @returns 16-character cache key.
 */
export function cacheKey(withList: string[], npmArgs: string[]): string {
  return shortHash([depsHash(withList), ...npmArgs].join('\u0000'))
}

/**
 * Computes path to run lock file for target directory.
 *
 * @param targetDir - Target directory path.
 * @returns Lock file path inside cache.
 */
function lockPathFor(targetDir: string): string {
  return path.join(CACHE_ROOT, workspaceHash(targetDir), 'run.lock')
}

/**
 * Acquires a non-blocking execution lock for target directory.
 * Recovers stale locks if process PID is dead.
 *
 * @param targetDir - Directory path to lock.
 * @returns A promise resolving to a release function.
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

/**
 * Checks if process with given PID is alive.
 *
 * @param pid - Process ID.
 * @returns True if process is alive, false otherwise.
 */
function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Computes cache directory path for a workspace and dependency set.
 *
 * @param workspaceDir - Project directory.
 * @param withList - Package specifiers.
 * @param npmArgs - Optional npm flags.
 * @returns Absolute cache path.
 */
export function cacheDirFor(workspaceDir: string, withList: string[], npmArgs: string[] = []): string {
  return path.join(CACHE_ROOT, workspaceHash(workspaceDir), cacheKey(withList, npmArgs))
}

/**
 * Prepares dependency cache workspace and symlinks node_modules into target.
 *
 * @param withList - Package specifiers.
 * @param targetDir - Workspace directory.
 * @param opts - Preparation options.
 * @returns Cache setup result and stash state.
 */
export async function prepareCache(
  withList: string[],
  targetDir: string,
  opts: PrepareCacheOptions = {}
): Promise<CacheResult> {
  const wsHash = workspaceHash(targetDir)
  const workspaceCacheDir = path.join(CACHE_ROOT, wsHash)
  const cacheDir = path.join(workspaceCacheDir, cacheKey(withList, opts.npmArgs ?? []))
  const cacheNodeModules = path.join(cacheDir, 'node_modules')

  debugLog(opts.debug, `workspace cache: ${workspaceCacheDir}`)
  debugLog(opts.debug, `deps cache: ${cacheDir}`)
  await fs.mkdir(workspaceCacheDir, { recursive: true })
  await fs.mkdir(cacheDir, { recursive: true })

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

  const nodeModulesPath = path.join(targetDir, 'node_modules')
  const stash = await stashNodeModules(nodeModulesPath)
  debugLog(
    opts.debug,
    `node_modules en ${targetDir}: ${
      stash.kind === 'fresh'
        ? 'no existía (fresh)'
        : stash.kind === 'link'
        ? `symlink → ${stash.originalTarget}`
        : `apartado en ${stash.backupPath}`
    }`
  )
  try {
    await fs.symlink(cacheNodeModules, nodeModulesPath, 'dir')
  } catch (err) {
    await restoreNodeModules(nodeModulesPath, stash)
    throw err
  }
  debugLog(opts.debug, `symlink ${nodeModulesPath} → ${cacheNodeModules}`)

  return { workspaceCacheDir, cacheDir, nodeModulesPath: cacheNodeModules, created, stash }
}

/**
 * Helper to write debug logs to stderr when debug mode is enabled.
 *
 * @param enabled - Debug flag.
 * @param msg - Debug log message.
 */
function debugLog(enabled: boolean | undefined, msg: string): void {
  if (enabled) process.stderr.write(`ntsx: [debug] ${msg}\n`)
}

/**
 * Stashes target node_modules before symlinking ephemeral dependencies.
 *
 * @param p - Absolute path to node_modules in target directory.
 * @returns Stash state description.
 */
async function stashNodeModules(p: string): Promise<NodeModulesStash> {
  try {
    const st = await fs.lstat(p)
    if (st.isSymbolicLink()) {
      const originalTarget = await fs.readlink(p)
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
    // File does not exist
  }
  return { kind: 'fresh' }
}

/**
 * Restores original target node_modules from stash state.
 *
 * @param p - Path to target node_modules.
 * @param stash - Stash metadata.
 */
export async function restoreNodeModules(p: string, stash: NodeModulesStash): Promise<void> {
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
    await fs.unlink(p).catch(() => {})
  }
}

/**
 * Prints warning message to stderr.
 *
 * @param msg - Warning message.
 */
function warn(msg: string): void {
  process.stderr.write(`ntsx: warning: ${msg}\n`)
}

/**
 * Formats unknown error value to string error message.
 *
 * @param err - Unknown thrown error.
 * @returns Error message string.
 */
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Parses package specifier into [name, version].
 *
 * @param spec - Package specifier string.
 * @returns Tuple of [package name, version requirement].
 */
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

/**
 * Writes package.json in cache directory with specified dependencies.
 *
 * @param dir - Cache directory path.
 * @param withList - List of package specifiers.
 */
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

/**
 * Executes npm install in isolated cache directory.
 *
 * @param dir - Cache directory path.
 * @param quiet - If true, suppresses stdout.
 * @param npmArgs - Extra npm flags.
 * @param debug - Debug mode flag.
 */
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
 * Sanitizes environment variables to prevent inheriting npm_config_* variables.
 *
 * @param base - Process environment variables object.
 * @returns Cleaned process environment object.
 */
function cleanNpmEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base }
  for (const key of Object.keys(env)) {
    if (/^npm_config_/i.test(key)) delete env[key]
  }
  return env
}
