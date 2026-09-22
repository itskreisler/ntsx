import { promises as fs } from 'node:fs'
import path from 'node:path'
import { CACHE_ROOT } from './config.js'

/** Estado del cache: número de workspaces y tamaño total */
export async function cacheStats(): Promise<{ exists: boolean; workspaceCount: number; sizeBytes: number }> {
  try {
    const entries = await fs.readdir(CACHE_ROOT, { withFileTypes: true })
    const workspaces = entries.filter((e) => e.isDirectory())
    const sizeBytes = await dirSize(CACHE_ROOT)
    return { exists: true, workspaceCount: workspaces.length, sizeBytes }
  } catch {
    return { exists: false, workspaceCount: 0, sizeBytes: 0 }
  }
}

async function dirSize(dir: string): Promise<number> {
  let total = 0
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) total += await dirSize(full)
    else if (e.isFile()) {
      try {
        total += (await fs.stat(full)).size
      } catch {
        // sin permiso / roto
      }
    }
  }
  return total
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

/** Limpia el cache completo. `force` evita la confirmación interactiva. */
export async function cleanCache(force: boolean): Promise<{ cleared: boolean; sizeFreed: number }> {
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

export { fmtBytes }