import { promises as fs, createWriteStream } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { CACHE_ROOT } from './config.js'

/**
 * Directory for storing downloaded Node binaries: ~/.cache/ntsx/node
 */
export const NODE_CACHE_ROOT = path.join(CACHE_ROOT, 'node')

/**
 * Maps Node process platform to nodejs.org dist platform strings.
 *
 * @returns Node release platform string ('darwin' | 'linux' | 'win')
 */
export function getDistPlatform(): string {
  const p = os.platform()
  if (p === 'win32') return 'win'
  if (p === 'darwin') return 'darwin'
  if (p === 'linux') return 'linux'
  return p
}

/**
 * Maps Node process arch to nodejs.org dist architecture strings.
 *
 * @returns Node release architecture string ('x64' | 'arm64' | 'x86' | 'armv7l')
 */
export function getDistArch(): string {
  const a = os.arch()
  if (a === 'ia32') return 'x86'
  if (a === 'arm') return 'armv7l'
  return a
}

export interface NodeRelease {
  version: string
  files: string[]
}

/**
 * Checks local cache (~/.cache/ntsx/node) for an existing downloaded binary matching the requested version.
 *
 * @param requested - Requested version string (e.g. "22", "v22.14.0")
 * @returns Absolute path to cached Node binary or null if not cached
 */
export async function getCachedNodeBinary(requested: string): Promise<string | null> {
  const clean = requested.trim().replace(/^v/i, '')
  const binName = getDistPlatform() === 'win' ? 'node.exe' : 'bin/node'

  try {
    const entries = await fs.readdir(NODE_CACHE_ROOT, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const folderName = entry.name
      if (folderName === clean || folderName === `v${clean}` || folderName.startsWith(`${clean}.`)) {
        const candidateBin = path.join(NODE_CACHE_ROOT, folderName, binName)
        try {
          await fs.access(candidateBin)
          return candidateBin
        } catch {
          // Bin not present in this folder
        }
      }
    }
  } catch {
    // Cache directory does not exist or read error
  }
  return null
}

/**
 * Fetches the list of official Node.js releases from nodejs.org.
 *
 * @returns Array of release metadata objects.
 */
export async function fetchNodeReleases(): Promise<NodeRelease[]> {
  try {
    const res = await fetch('https://nodejs.org/dist/index.json')
    if (!res.ok) return []
    return (await res.json()) as NodeRelease[]
  } catch {
    return []
  }
}

/**
 * Resolves a requested version string (e.g. "22", "24", "v22.14.0") to the latest matching version.
 *
 * @param requested - Requested version string
 * @returns Full version string with leading 'v' (e.g. "v22.14.0") or null
 */
export async function resolveLatestNodeVersion(requested: string): Promise<string | null> {
  const clean = requested.trim().replace(/^v/i, '')
  const releases = await fetchNodeReleases()
  if (releases.length === 0) return null

  // If exact match exists (e.g. "v22.14.0")
  const exact = releases.find((r) => r.version.toLowerCase() === `v${clean}`.toLowerCase())
  if (exact) return exact.version

  // Match by major version (e.g. "22" -> latest v22.x.x)
  const majorMatch = releases.find((r) => {
    const verNum = r.version.replace(/^v/, '')
    return verNum.startsWith(`${clean}.`) || verNum === clean
  })

  return majorMatch ? majorMatch.version : null
}

/**
 * Downloads and extracts a Node.js release for the current platform and architecture into cache.
 *
 * @param fullVersion - Full version string (e.g. "v22.14.0")
 * @returns Absolute path to downloaded Node executable
 */
export async function downloadNodeRelease(fullVersion: string): Promise<string> {
  const versionNoV = fullVersion.replace(/^v/i, '')
  const plat = getDistPlatform()
  const arch = getDistArch()

  const verDir = path.join(NODE_CACHE_ROOT, versionNoV)
  const binRelativePath = plat === 'win' ? 'node.exe' : 'bin/node'
  const expectedBin = path.join(verDir, binRelativePath)

  try {
    await fs.access(expectedBin)
    return expectedBin
  } catch {
    // Needs download
  }

  await fs.mkdir(verDir, { recursive: true })

  const archiveExt = plat === 'win' ? 'zip' : 'tar.gz'
  const archiveName = `node-${fullVersion}-${plat}-${arch}.${archiveExt}`
  const archiveUrl = `https://nodejs.org/dist/${fullVersion}/${archiveName}`
  const archivePath = path.join(NODE_CACHE_ROOT, archiveName)

  try {
    process.stderr.write(`ntsx: downloading Node.js ${fullVersion} (${plat}-${arch})...\n`)
    const res = await fetch(archiveUrl)
    if (!res.ok) {
      throw new Error(`Failed to fetch ${archiveUrl}: HTTP ${res.status}`)
    }

    const fileStream = createWriteStream(archivePath)
    if (!res.body) throw new Error('Empty response body')

    // Stream download response to file
    const reader = res.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      fileStream.write(value)
    }
    await new Promise<void>((resolve) => fileStream.end(resolve))

    // Unpack archive
    if (plat === 'win') {
      const psCmd = `Expand-Archive -Path "${archivePath}" -DestinationPath "${NODE_CACHE_ROOT}" -Force`
      spawnSync('powershell', ['-Command', psCmd], { stdio: 'ignore' })
    } else {
      spawnSync('tar', ['-xzf', archivePath, '-C', NODE_CACHE_ROOT], { stdio: 'ignore' })
    }

    // Extracted directory name
    const extractedFolder = path.join(NODE_CACHE_ROOT, `node-${fullVersion}-${plat}-${arch}`)
    try {
      await fs.access(extractedFolder)
      // Move contents or rename
      const files = await fs.readdir(extractedFolder)
      for (const file of files) {
        await fs.rename(path.join(extractedFolder, file), path.join(verDir, file)).catch(() => {})
      }
      await fs.rm(extractedFolder, { recursive: true, force: true }).catch(() => {})
    } catch {
      // Direct extraction fallback
    }

    await fs.chmod(expectedBin, 0o755).catch(() => {})
    return expectedBin
  } finally {
    await fs.unlink(archivePath).catch(() => {})
  }
}

/**
 * Resolves or downloads the Node.js binary for a target version string.
 * First checks local cache before attempting network resolution.
 *
 * @param version - Node version string (e.g. "22", "24", "v22.14.0", "current")
 * @returns Absolute path to executable Node binary
 */
export async function resolveNodeBinary(version?: string): Promise<string> {
  if (!version || version === 'current' || version === process.versions.node) {
    return process.execPath
  }

  // Check local cache first (works offline and avoids unnecessary network requests)
  const cachedBin = await getCachedNodeBinary(version)
  if (cachedBin) {
    return cachedBin
  }

  try {
    const fullVer = await resolveLatestNodeVersion(version)
    if (fullVer) {
      return await downloadNodeRelease(fullVer)
    }
  } catch {
    // Network or download error fallback
  }

  return process.execPath
}
