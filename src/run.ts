import { z } from 'zod'
import { statSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { prepareCache, restoreNodeModules, acquireRunLock, type NodeModulesStash } from './cache.js'
import { parseScriptMetadata } from './metadata.js'
import { readLockfile } from './lockfile.js'
import { resolveNodeBinary } from './node-version.js'

/**
 * Options for running a script or evaluating inline code.
 */
export interface RunOptions {
  /** List of ephemeral package specifiers (`pkg`, `pkg@version`, `@scope/pkg@version`). */
  withList: string[]
  /** Relative or absolute script file path. Null when using eval. */
  script: string | null
  /** Inline code string to evaluate. */
  evalCode?: string
  /** Runtime environment for inline code evaluation (`tsx` or `node`). */
  evalRuntime?: 'tsx' | 'node'
  /** Arguments forwarded directly to the script. */
  scriptArgs: string[]
  /** If true, suppresses npm install stdout. */
  quiet?: boolean
  /** Flags forwarded to tsx before script execution. */
  tsxArgs?: string[]
  /** Flags forwarded to node before script execution. */
  nodeArgs?: string[]
  /** Flags forwarded to npm install. */
  npmArgs?: string[]
  /** Pin Node.js version. */
  nodeVersion?: string
  /** If true, outputs internal execution step traces to stderr. */
  debug?: boolean
}

const pkgSpecSchema = z
  .string()
  .min(1)
  .regex(
    /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(@[^\s]+)?$/i,
    'Invalid package spec (expected pkg, pkg@version, @scope/pkg, or @scope/pkg@version)'
  )

const runOptionsSchema = z.object({
  withList: z.array(pkgSpecSchema).default([]),
  script: z.string().min(1, 'script path required').nullable(),
  evalCode: z.string().optional(),
  evalRuntime: z.enum(['tsx', 'node']).default('tsx'),
  scriptArgs: z.array(z.string()).default([]),
  quiet: z.boolean().default(false),
  tsxArgs: z.array(z.string().min(1)).default([]),
  nodeArgs: z.array(z.string().min(1)).default([]),
  npmArgs: z.array(z.string().min(1)).default([]),
  nodeVersion: z.string().optional(),
  debug: z.boolean().default(false),
})

/**
 * Splits argument flag strings into tokens while preserving quoted substrings.
 *
 * @param raws - Array of raw argument flag strings.
 * @returns Tokenized argument flags.
 */
function splitArgs(raws: string[]): string[] {
  const out: string[] = []
  for (const raw of raws) {
    const matches = raw.match(/"[^"]*"|'[^']*'|\S+/g) ?? []
    out.push(...matches.map((m) => m.replace(/^(['"])(.*)\1$/, '$2')))
  }
  return out
}

/**
 * Checks if file path extension corresponds to TypeScript (.ts, .mts, .cts, .tsx).
 *
 * @param p - File path.
 * @returns True if path is a TypeScript file.
 */
function isTsFile(p: string): boolean {
  return /\.(ts|mts|cts|tsx)$/.test(p)
}

/**
 * Resolves script path to absolute file path or throws if script does not exist.
 *
 * @param script - Script file path string.
 * @returns Resolved absolute path.
 */
function resolveScript(script: string): string {
  const abs = path.resolve(script)
  try {
    const st = statSync(abs)
    if (st.isFile()) return abs
  } catch {
    // File not found
  }
  throw new Error(`Script not found: ${script}`)
}

/**
 * Resolves binary executable path in environment PATH variable.
 *
 * @param bin - Binary executable name.
 * @returns Absolute path to binary executable or null if not found.
 */
function which(bin: string): string | null {
  const pathEnv = process.env.PATH ?? ''
  const candidates = process.platform === 'win32' ? [bin, `${bin}.cmd`, `${bin}.exe`] : [bin]
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue
    for (const candidate of candidates) {
      try {
        const full = path.join(dir, candidate)
        if (statSync(full).isFile()) return full
      } catch {
        // Not found in this PATH entry
      }
    }
  }
  return null
}

/**
 * Executes target script or inline code with ephemeral dependencies and options.
 *
 * @param opts - Execution options.
 * @returns Promise resolving to exit status code.
 */
export async function run(opts: RunOptions): Promise<number> {
  const parsed = runOptionsSchema.parse(opts)

  const isEval = parsed.evalCode !== undefined
  if (!isEval && (parsed.script === null || parsed.script === '')) {
    throw new Error('A script path or --eval code is required')
  }

  const scriptPath = isEval ? null : resolveScript(parsed.script as string)
  const targetDir = scriptPath ? path.dirname(scriptPath) : process.cwd()

  // Extract metadata from script comments if scriptPath is present
  let metadataDeps: string[] = []
  let metadataNodeVersion: string | undefined
  if (scriptPath) {
    const meta = await parseScriptMetadata(scriptPath)
    metadataDeps = meta.dependencies
    metadataNodeVersion = meta.node
  }

  const effectiveNodeVersion = parsed.nodeVersion || metadataNodeVersion

  // Extract dependencies from lockfile if scriptPath is present and lockfile exists
  let lockedDeps: string[] = []
  if (scriptPath) {
    const lock = await readLockfile(scriptPath)
    if (lock) {
      lockedDeps = Object.entries(lock.dependencies).map(([pkg, info]) => `${pkg}@${info.version}`)
    }
  }

  const effectiveWithList = Array.from(new Set([...lockedDeps, ...metadataDeps, ...parsed.withList]))

  let stash: NodeModulesStash | null = null
  let releaseLock: (() => Promise<void>) | null = null

  try {
    if (effectiveWithList.length > 0) {
      releaseLock = await acquireRunLock(targetDir)
      if (parsed.debug) process.stderr.write(`ntsx: [debug] run lock adquirido en ${targetDir}\n`)
      const prepped = await prepareCache(effectiveWithList, targetDir, {
        quiet: parsed.quiet,
        npmArgs: splitArgs(parsed.npmArgs),
        debug: parsed.debug,
      })
      stash = prepped.stash
    }

    const isTs = scriptPath !== null ? isTsFile(scriptPath) : parsed.evalRuntime === 'tsx'
    let cmd: string
    let args: string[]

    if (isTs) {
      const runnerFlags = splitArgs(parsed.tsxArgs)
      const withEval = (base: string[]): string[] =>
        base.concat(parsed.scriptArgs.length > 0 ? ['--', ...parsed.scriptArgs] : parsed.scriptArgs)
      const tsxBin = which('tsx')
      if (tsxBin) {
        cmd = tsxBin
        args = isEval
          ? withEval([...runnerFlags, '-e', parsed.evalCode as string])
          : [...runnerFlags, scriptPath as string, ...parsed.scriptArgs]
      } else {
        cmd = which('npx') ?? 'npx'
        args = isEval
          ? withEval(['-y', 'tsx', ...runnerFlags, '-e', parsed.evalCode as string])
          : ['-y', 'tsx', ...runnerFlags, scriptPath as string, ...parsed.scriptArgs]
      }
    } else {
      const runnerFlags = splitArgs(parsed.nodeArgs)
      cmd = await resolveNodeBinary(effectiveNodeVersion, { quiet: parsed.quiet })
      args = isEval
        ? [
            ...runnerFlags,
            '--input-type=module',
            '-e',
            parsed.evalCode as string,
            ...(parsed.scriptArgs.length > 0 ? ['--', ...parsed.scriptArgs] : []),
          ]
        : [...runnerFlags, scriptPath as string, ...parsed.scriptArgs]
    }

    if (parsed.debug) {
      const shownArgs = args.map((a) => (a.includes(' ') ? JSON.stringify(a) : a)).join(' ')
      process.stderr.write(`ntsx: [debug] exec: ${cmd} ${shownArgs}\n`)
    }

    const nodeBin = await resolveNodeBinary(effectiveNodeVersion, { quiet: parsed.quiet })
    const customNodeDir = effectiveNodeVersion && nodeBin !== process.execPath ? path.dirname(nodeBin) : null

    if (!isTs) {
      cmd = nodeBin
    }

    const spawnEnv: NodeJS.ProcessEnv = { ...process.env }
    if (customNodeDir) {
      spawnEnv.PATH = `${customNodeDir}${path.delimiter}${spawnEnv.PATH ?? ''}`
    }

    const spawnOpts: { stdio: 'inherit'; env: NodeJS.ProcessEnv; shell?: boolean } = {
      stdio: 'inherit',
      env: spawnEnv,
    }
    if (process.platform === 'win32' && /\.cmd$/i.test(cmd)) spawnOpts.shell = true
    const child = spawn(cmd, args, spawnOpts)
    let spawnErrMsg: string | null = null
    const closed = new Promise<number | null>((resolve) => {
      child.on('close', (code) => resolve(code))
      child.on('error', (err: Error) => {
        spawnErrMsg = err.message
        resolve(null)
      })
    })

    let gotSignal: NodeJS.Signals | null = null
    let graceTimer: NodeJS.Timeout | null = null
    const onSignal = (sig: NodeJS.Signals): void => {
      if (gotSignal) return
      gotSignal = sig
      if (parsed.debug) process.stderr.write(`ntsx: [debug] ${sig} recibida, restaurando node_modules\n`)
      child.kill(sig)
      graceTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL')
      }, 3000)
    }
    process.on('SIGINT', onSignal)
    process.on('SIGTERM', onSignal)

    let code: number
    try {
      const result = await closed
      if (graceTimer) clearTimeout(graceTimer)
      if (spawnErrMsg) process.stderr.write(`ntsx: failed to spawn ${cmd}: ${spawnErrMsg}\n`)
      code = result === null ? (gotSignal ? (gotSignal === 'SIGINT' ? 130 : 143) : 1) : result
    } finally {
      if (graceTimer) clearTimeout(graceTimer)
      process.removeListener('SIGINT', onSignal)
      process.removeListener('SIGTERM', onSignal)
    }
    if (code !== 0 && gotSignal && parsed.debug) {
      process.stderr.write(`ntsx: [debug] runner terminó por ${gotSignal} → node_modules restaurado\n`)
    }
    return code
  } finally {
    if (stash) {
      if (parsed.debug) process.stderr.write(`ntsx: [debug] restore node_modules (${stash.kind})\n`)
      await restoreNodeModules(path.join(targetDir, 'node_modules'), stash)
    }
    await releaseLock?.()
  }
}
