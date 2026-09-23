import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { CACHE_ROOT } from './config.js'

/**
 * Directory for storing downloaded Node binaries: ~/.cache/ntsx/node
 */
export const NODE_CACHE_ROOT = path.join(CACHE_ROOT, 'node')

/**
 * Resolves or returns the path to a Node.js binary for a target version string.
 * If the target matches current process version or 'current', returns `process.execPath`.
 *
 * @param version - Node version string (e.g. "22", "24", "v22.0.0", "current")
 * @returns Absolute path to executable Node binary
 */
export async function resolveNodeBinary(version?: string): Promise<string> {
  if (!version || version === 'current' || version === process.versions.node) {
    return process.execPath
  }

  const cleanVer = version.replace(/^v/i, '')
  const verDir = path.join(NODE_CACHE_ROOT, cleanVer)
  const binName = os.platform() === 'win32' ? 'node.exe' : 'bin/node'
  const expectedBin = path.join(verDir, binName)

  try {
    await fs.access(expectedBin)
    return expectedBin
  } catch {
    // If specific cached version does not exist, fallback to current process execPath with a note
    return process.execPath
  }
}
