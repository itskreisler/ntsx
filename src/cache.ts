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

/** Cache aisla por workspace (proyecto) y por conjunto de deps */
export function cacheDirFor(workspaceDir: string, withList: string[]): string {
  return path.join(CACHE_ROOT, workspaceHash(workspaceDir), depsHash(withList))
}

/** Prepara cache aislado por workspace + deps, y symlink hacia targetDir. */
export async function prepareCache(
  withList: string[],
  targetDir: string,
  opts: { quiet?: boolean; npmArgs?: string[]; debug?: boolean } = {}
): Promise<CacheResult> {
  const wsHash = workspaceHash(targetDir)
  const workspaceCacheDir = path.join(CACHE_ROOT, wsHash)
  const cacheDir = path.join(workspaceCacheDir, depsHash(withList))
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
      const backupPath = path.join(path.dirname(p), `.ntsx-${Date.now()}.bak`)
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
    await fs.symlink(stash.originalTarget, p, 'dir').catch(() => {})
  } else if (stash.kind === 'dir' && stash.backupPath) {
    await fs.unlink(p).catch(() => {})
    await fs.rename(stash.backupPath, p).catch(() => {})
  } else {
    // kind 'fresh': solo eliminamos el symlink que creamos
    await fs.unlink(p).catch(() => {})
  }
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
    if (key.startsWith('npm_config_')) delete env[key]
  }
  return env
}