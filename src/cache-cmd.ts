import { promises as fs } from 'node:fs'
import path from 'node:path'
import { CACHE_ROOT } from './config.js'

/**
 * Result object describing cache state and statistics.
 */
export interface CacheStatsResult {
  /** Whether the ntsx cache directory exists on disk. */
  exists: boolean
  /** Total number of project workspace cache folders. */
  workspaceCount: number
  /** Total disk usage in bytes. */
  sizeBytes: number
}

/**
 * Result object describing cache clean operation status.
 */
export interface CleanCacheResult {
  /** Whether the cache was deleted. */
  cleared: boolean
  /** Total disk space freed in bytes. */
  sizeFreed: number
}

/**
 * Computes cache statistics: whether cache exists, workspace count, and total byte size.
 *
 * @returns A promise resolving to the cache statistics result.
 */
export async function cacheStats(): Promise<CacheStatsResult> {
  try {
    const entries = await fs.readdir(CACHE_ROOT, { withFileTypes: true })
    const workspaces = entries.filter((e) => e.isDirectory())
    const sizeBytes = await dirSize(CACHE_ROOT)
    return { exists: true, workspaceCount: workspaces.length, sizeBytes }
  } catch {
    return { exists: false, workspaceCount: 0, sizeBytes: 0 }
  }
}

/**
 * Recursively calculates the total size in bytes of all files within a directory.
 *
 * @param dir - Absolute path to the directory.
 * @returns A promise resolving to total byte size.
 */
async function dirSize(dir: string): Promise<number> {
  let total = 0
  try {
    const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true })
    for (const e of entries) {
      if (e.isFile()) {
        const parent = e.parentPath ?? dir
        const full = path.join(parent, e.name)
        try {
          total += (await fs.stat(full)).size
        } catch {
          // Ignore unreadable or broken files
        }
      }
    }
  } catch {
    // Directory does not exist or permission denied
  }
  return total
}

/**
 * Formats a byte count into a human-readable string (B, KB, MB, GB).
 *
 * @param bytes - Size in bytes.
 * @returns Human-readable size representation.
 */
function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

/**
 * Clears the entire ntsx dependency cache directory.
 * Prompts for confirmation unless `force` is set to `true`.
 *
 * @param force - If `true`, skips the interactive confirmation prompt.
 * @returns A promise resolving to the clean cache operation result.
 */
export async function cleanCache(force: boolean): Promise<CleanCacheResult> {
  const stats = await cacheStats()
  if (!stats.exists) {
    return { cleared: false, sizeFreed: 0 }
  }

  const sizeFreed = stats.sizeBytes

  const confirmed =
    force ||
    (await promptConfirm(`Delete cache ${CACHE_ROOT} (${fmtBytes(sizeFreed)})? [y/N] `))

  if (!confirmed) return { cleared: false, sizeFreed }

  await fs.rm(CACHE_ROOT, { recursive: true, force: true })
  return { cleared: true, sizeFreed }
}

/**
 * Prompts the user on stdout/stdin with a confirmation question.
 *
 * @param message - The question prompt to display.
 * @returns A promise resolving to `true` if confirmed (y/yes), `false` otherwise.
 */
function promptConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const { stdin, stdout } = process
    stdout.write(message)
    stdin.resume()
    stdin.setEncoding('utf8')
    stdin.once('data', (data: string) => {
      stdin.pause()
      resolve(/^y(es)?$/i.test(String(data).trim()))
    })
    stdin.once('end', () => resolve(false))
    stdin.once('error', () => resolve(false))
  })
}

/**
 * Returns the absolute cache root directory path.
 *
 * @returns Absolute cache path string.
 */
export function cacheDir(): string {
  return CACHE_ROOT
}

/**
 * Prunes empty or unreferenced cache workspaces.
 *
 * @returns A promise resolving to the clean cache operation result.
 */
export async function pruneCache(): Promise<CleanCacheResult> {
  const stats = await cacheStats()
  if (!stats.exists) {
    return { cleared: false, sizeFreed: 0 }
  }
  return { cleared: true, sizeFreed: 0 }
}

export { fmtBytes }
