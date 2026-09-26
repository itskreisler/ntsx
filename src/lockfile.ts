import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { prepareCache, restoreNodeModules } from './cache.js'

export interface LockfileDependency {
  version: string
  integrity?: string
  resolved?: string
}

export interface LockfileData {
  version: number
  script?: string
  runtime: {
    name: string
    version: string
  }
  dependencies: Record<string, LockfileDependency>
}

/**
 * Computes lockfile path for a script.
 *
 * @param scriptPath - Path to the script file.
 * @returns Path ending in .lock
 */
export function lockfilePathFor(scriptPath: string): string {
  return `${scriptPath}.lock`
}

/**
 * Generates and writes a <script>.lock lockfile for a script and its dependencies.
 *
 * @param scriptPath - Path to the target script file.
 * @param withList - List of requested dependency package specifications.
 */
export async function generateLockfile(scriptPath: string, withList: string[]): Promise<string> {
  const absScript = path.resolve(scriptPath)
  const targetDir = path.dirname(absScript)

  const prepped = await prepareCache(withList, targetDir, { quiet: true })
  const lockfileData: LockfileData = {
    version: 1,
    script: path.basename(absScript),
    runtime: {
      name: 'node',
      version: process.versions.node,
    },
    dependencies: {},
  }

  try {
    const installedNodeModules = prepped.nodeModulesPath
    for (const spec of withList) {
      let pkgName = spec
      if (spec.startsWith('@')) {
        const at = spec.indexOf('@', 1)
        if (at !== -1) pkgName = spec.slice(0, at)
      } else {
        const at = spec.indexOf('@')
        if (at !== -1) pkgName = spec.slice(0, at)
      }

      const pkgJsonPath = path.join(installedNodeModules, pkgName, 'package.json')
      try {
        const rawPkg = await fs.readFile(pkgJsonPath, 'utf8')
        const parsedPkg = JSON.parse(rawPkg)
        const integrity = createHash('sha256').update(rawPkg).digest('hex')

        lockfileData.dependencies[pkgName] = {
          version: parsedPkg.version || 'unknown',
          integrity: `sha256-${integrity}`,
        }
      } catch {
        lockfileData.dependencies[pkgName] = { version: 'unknown' }
      }
    }
  } finally {
    await restoreNodeModules(path.join(targetDir, 'node_modules'), prepped.stash)
  }

  const lockPath = lockfilePathFor(absScript)
  await fs.writeFile(lockPath, JSON.stringify(lockfileData, null, 2) + '\n', 'utf8')
  return lockPath
}

/**
 * Reads and parses a script's lockfile if present.
 *
 * @param scriptPath - Path to the script.
 * @returns LockfileData or null if file doesn't exist.
 */
export async function readLockfile(scriptPath: string): Promise<LockfileData | null> {
  const lockPath = lockfilePathFor(path.resolve(scriptPath))
  try {
    const content = await fs.readFile(lockPath, 'utf8')
    return JSON.parse(content) as LockfileData
  } catch {
    return null
  }
}
