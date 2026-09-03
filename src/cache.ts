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
export async function prepareCache(withList: string[], targetDir: string): Promise<CacheResult> {
  const wsHash = workspaceHash(targetDir)
  const workspaceCacheDir = path.join(CACHE_ROOT, wsHash)
  const cacheDir = path.join(workspaceCacheDir, depsHash(withList))
  const cacheNodeModules = path.join(cacheDir, 'node_modules')

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
    await writePackageJson(cacheDir, withList)
    runNpmInstall(cacheDir)
    created = true
  }

  // Symlink node_modules en targetDir
  await ensureSymlink(cacheNodeModules, path.join(targetDir, 'node_modules'))

  return { workspaceCacheDir, cacheDir, nodeModulesPath: cacheNodeModules, created }
}

async function ensureSymlink(target: string, link: string): Promise<void> {
  try {
    const st = await fs.lstat(link)
    if (st.isSymbolicLink()) await fs.unlink(link)
    else if (st.isDirectory()) await fs.rm(link, { recursive: true })
  } catch {
    // no existe → crear
  }
  await fs.symlink(target, link, 'dir')
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
    name: 'ntx-cache-' + depsHash(withList),
    private: true,
    dependencies,
  }
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n')
}

function runNpmInstall(dir: string): void {
  const res = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
    cwd: dir,
    stdio: 'inherit',
    env: process.env,
  })
  if (res.status !== 0) {
    throw new Error(`npm install failed (exit ${res.status ?? 'unknown'}) in ${dir}`)
  }
}