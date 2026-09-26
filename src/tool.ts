import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { CACHE_ROOT } from './config.js'
import { prepareCache, restoreNodeModules } from './cache.js'

export const TOOLS_CACHE_ROOT = path.join(CACHE_ROOT, 'tools')

/**
 * Options for running a tool ephemerally.
 */
export interface ToolRunOptions {
  /** Name of the tool or package spec (e.g. "prettier", "rimraf@^5"). */
  tool: string
  /** Arguments forwarded directly to the tool binary. */
  args: string[]
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
  const { tool, args, quiet } = opts
  const targetDir = process.cwd()

  // Ephemeral installation of tool package
  const prepped = await prepareCache([tool], targetDir, { quiet })

  let binName = tool
  if (tool.startsWith('@')) {
    const at = tool.indexOf('@', 1)
    if (at !== -1) binName = tool.slice(0, at)
  } else {
    const at = tool.indexOf('@')
    if (at !== -1) binName = tool.slice(0, at)
  }

  // Handle scoped package name binaries (e.g., @angular/cli -> ng or package name)
  if (binName.includes('/')) {
    binName = binName.split('/')[1]
  }

  const nodeModulesBin = path.join(prepped.nodeModulesPath, '.bin', binName)

  let cmd = nodeModulesBin
  try {
    await fs.access(cmd)
  } catch {
    // If exact binary name not found in .bin, fallback to npx
    cmd = 'npx'
    args.unshift(tool)
  }

  try {
    const spawnOpts: { stdio: 'inherit'; env: NodeJS.ProcessEnv; shell?: boolean } = {
      stdio: 'inherit',
      env: process.env,
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
