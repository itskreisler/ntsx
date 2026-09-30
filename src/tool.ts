import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { CACHE_ROOT } from './config.js'
import { prepareCache, restoreNodeModules } from './cache.js'
import { resolveNodeBinary } from './node-version.js'

export const TOOLS_CACHE_ROOT = path.join(CACHE_ROOT, 'tools')

/**
 * Options for running a tool ephemerally.
 */
export interface ToolRunOptions {
  /** Name of the tool or package spec (e.g. "prettier", "rimraf@^5", "opencode-ai"). */
  tool: string
  /** Arguments forwarded directly to the tool binary. */
  args: string[]
  /** Pin Node version. */
  nodeVersion?: string
  /** If true, suppresses npm install output. */
  quiet?: boolean
}

/**
 * Runs an ephemeral tool binary from cache.
 *
 * @param opts - Tool run options.
 * @returns Exit status code.
 */
export async function runTool(opts: ToolRunOptions): Promise<number> {
  const { tool, args, nodeVersion, quiet } = opts
  const targetDir = process.cwd()

  // Ephemeral installation of tool package
  const prepped = await prepareCache([tool], targetDir, { quiet })

  let pkgName = tool
  if (tool.startsWith('@')) {
    const at = tool.indexOf('@', 1)
    if (at !== -1) pkgName = tool.slice(0, at)
  } else {
    const at = tool.indexOf('@')
    if (at !== -1) pkgName = tool.slice(0, at)
  }

  const possibleBinNames: string[] = []

  // Read installed package.json to resolve actual binary executables
  const pkgJsonPath = path.join(prepped.nodeModulesPath, pkgName, 'package.json')
  try {
    const rawPkg = await fs.readFile(pkgJsonPath, 'utf8')
    const parsedPkg = JSON.parse(rawPkg)
    if (parsedPkg.bin) {
      if (typeof parsedPkg.bin === 'string') {
        const defaultBin = pkgName.includes('/') ? pkgName.split('/')[1] : pkgName
        possibleBinNames.push(defaultBin)
      } else if (typeof parsedPkg.bin === 'object') {
        possibleBinNames.push(...Object.keys(parsedPkg.bin))
      }
    }
  } catch {
    // Ignore error
  }

  const defaultBin = pkgName.includes('/') ? pkgName.split('/')[1] : pkgName
  if (!possibleBinNames.includes(defaultBin)) {
    possibleBinNames.unshift(defaultBin)
  }

  let foundBinPath: string | null = null
  for (const bName of possibleBinNames) {
    const candidate = path.join(prepped.nodeModulesPath, '.bin', bName)
    try {
      await fs.access(candidate)
      foundBinPath = candidate
      break
    } catch {
      if (process.platform === 'win32') {
        try {
          const candCmd = `${candidate}.cmd`
          await fs.access(candCmd)
          foundBinPath = candCmd
          break
        } catch {}
        try {
          const candExe = `${candidate}.exe`
          await fs.access(candExe)
          foundBinPath = candExe
          break
        } catch {}
      }
    }
  }

  const cmd = foundBinPath ?? 'npx'
  if (!foundBinPath) {
    args.unshift(tool)
  }

  try {
    const spawnEnv: NodeJS.ProcessEnv = { ...process.env }
    if (nodeVersion) {
      const nodeBin = await resolveNodeBinary(nodeVersion, { quiet })
      const customNodeDir = path.dirname(nodeBin)
      spawnEnv.PATH = `${customNodeDir}${path.delimiter}${spawnEnv.PATH ?? ''}`
    }

    const spawnOpts: { stdio: 'inherit'; env: NodeJS.ProcessEnv; shell?: boolean } = {
      stdio: 'inherit',
      env: spawnEnv,
    }
    if (process.platform === 'win32' && /\.cmd$/i.test(cmd)) spawnOpts.shell = true

    const child = spawn(cmd, args, spawnOpts)
    const exitCode = await new Promise<number>((resolve) => {
      child.on('close', (code) => resolve(code ?? 0))
      child.on('error', () => resolve(1))
    })
    return exitCode
  } finally {
    await restoreNodeModules(path.join(targetDir, 'node_modules'), prepped.stash)
  }
}
