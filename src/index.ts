#!/usr/bin/env node
import { createRequire } from 'node:module'
import { Command } from 'commander'
import { z } from 'zod'
import { run } from './run.js'
import { CACHE_ROOT } from './config.js'
import { cacheStats, cleanCache, cacheDir, pruneCache, fmtBytes } from './cache-cmd.js'
import { generateLockfile } from './lockfile.js'
import { parseScriptMetadata } from './metadata.js'
import { runTool } from './tool.js'

const require = createRequire(import.meta.url)
const { version } = require('../package.json') as { version: string }

/**
 * Accumulates repeatable CLI option flag values into an array.
 *
 * @param value - New option value.
 * @param previous - Previously accumulated option values.
 * @returns Concatenated option array.
 */
function collect(value: string, previous: string[]): string[] {
  return previous.concat([value])
}

/**
 * Formats unknown error value into a readable user error message.
 *
 * @param err - Error instance or Zod validation error.
 * @returns Clean error message string without stack trace.
 */
function cleanErrorMessage(err: unknown): string {
  if (err instanceof z.ZodError) {
    return err.issues
      .map((issue) => {
        const p = issue.path.join('.')
        return p ? `${p}: ${issue.message}` : issue.message
      })
      .join('\n')
  }
  return err instanceof Error ? err.message : String(err)
}

/**
 * Wraps action handlers with error catching and formatted error output.
 * Sets `process.exitCode = 1` on failure.
 *
 * @param fn - Async action handler callback.
 */
async function guard(fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    process.stderr.write(`ntsx: ${cleanErrorMessage(err)}\n`)
    process.exitCode = 1
  }
}


const program = new Command()
program.enablePositionalOptions()

program
  .name('ntsx')
  .description('Run Node/TS scripts with ephemeral dependencies (uv-style --with)')
  .version(version)

program
  .command('run')
  .description('Run a script or inline code with ephemeral dependencies')
  .passThroughOptions()
  .option('-w, --with <pkg>', 'ephemeral dependency (pkg, pkg@version, @scope/pkg@version). Repeatable', collect, [])
  .option('-e, --eval <code>', 'evaluate inline code (like node -e)')
  .option('--eval-runtime <tsx|node>', 'runtime for inline eval (default: tsx)', 'tsx')
  .option('--tsx-args <flags>', 'flags forwarded to tsx before the script (.ts/tsx/eval runs). Repeatable', collect, [])
  .option('--node-args <flags>', 'flags forwarded to node before the script (.js/.mjs runs). Repeatable', collect, [])
  .option('--npm-args <flags>', 'flags forwarded to the ephemeral npm install. Repeatable', collect, [])
  .option('-q, --quiet', 'suppress npm install output')
  .option('-d, --debug', 'show internal steps (cache paths, commands, restore)')
  .option('--node <version>', 'pin Node version')
  .argument('[script]', 'script path (js, ts, mts, cts, tsx). Omit with --eval')
  .argument('[scriptArgs...]', 'arguments passed to the script')
  .action(
    async (
      script: string | undefined,
      scriptArgs: string[],
      options: {
        with?: string[]
        eval?: string
        evalRuntime?: string
        tsxArgs?: string[]
        nodeArgs?: string[]
        npmArgs?: string[]
        node?: string
        quiet?: boolean
        debug?: boolean
      }
    ) => {
      await guard(async () => {
        const isEval = options.eval !== undefined
        const effectiveScriptArgs = isEval && script ? [script, ...scriptArgs] : scriptArgs
        const exitCode = await run({
          withList: options.with ?? [],
          script: isEval ? null : script ?? null,
          evalCode: options.eval,
          scriptArgs: effectiveScriptArgs,
          quiet: options.quiet ?? false,
          evalRuntime: options.evalRuntime as 'tsx' | 'node' | undefined,
          tsxArgs: options.tsxArgs ?? [],
          nodeArgs: options.nodeArgs ?? [],
          npmArgs: options.npmArgs ?? [],
          nodeVersion: options.node,
          debug: options.debug ?? false,
        })
        if (exitCode !== 0) process.exitCode = exitCode
      })
    }
  )

// ----- command: cache -----
const cacheCmd = program.command('cache').description('Manage the ntsx dependency cache')

cacheCmd
  .command('clean')
  .description('Delete the entire ntsx cache')
  .option('-f, --force', 'skip confirmation prompt')
  .action(async (options: { force?: boolean }) => {
    await guard(async () => {
      const result = await cleanCache(options.force ?? false)
      if (result.cleared) {
        console.log(`Cache cleared (freed ${fmtBytes(result.sizeFreed)})`)
      } else if (result.sizeFreed === 0) {
        console.log('Cache does not exist or is empty')
      } else {
        console.log('Aborted')
      }
    })
  })

// ----- command: lock -----
program
  .command('lock')
  .description('Generate a <script>.lock lockfile for a script and its dependencies')
  .option('-w, --with <pkg>', 'ephemeral dependency specifier. Repeatable', collect, [])
  .argument('<script>', 'script file path')
  .action(async (script: string, options: { with?: string[] }) => {
    await guard(async () => {
      const meta = await parseScriptMetadata(script)
      const withList = Array.from(new Set([...meta.dependencies, ...(options.with ?? [])]))
      const lockPath = await generateLockfile(script, withList)
      console.log(`Lockfile generated at ${lockPath}`)
    })
  })

cacheCmd
  .command('stats')
  .description('Show cache size and workspace count')
  .action(async () => {
    await guard(async () => {
      const s = await cacheStats()
      if (!s.exists) {
        console.log(`No cache at ${CACHE_ROOT}`)
        return
      }
      console.log(`Cache: ${CACHE_ROOT}`)
      console.log(`Workspaces: ${s.workspaceCount}`)
      console.log(`Size: ${fmtBytes(s.sizeBytes)}`)
    })
  })

cacheCmd
  .command('dir')
  .description('Print the absolute path to the cache directory')
  .action(() => {
    console.log(cacheDir())
  })

cacheCmd
  .command('prune')
  .description('Prune unused cache items')
  .action(async () => {
    await guard(async () => {
      const res = await pruneCache()
      if (res.cleared) {
        console.log('Cache pruned')
      } else {
        console.log('Cache does not exist or nothing to prune')
      }
    })
  })

// ----- command: tool -----
const toolCmd = program.command('tool').description('Run ephemeral developer tools').passThroughOptions()

toolCmd
  .command('run')
  .description('Run a developer tool ephemerally')
  .passThroughOptions()
  .argument('<tool>', 'tool package name (e.g., prettier, rimraf)')
  .argument('[toolArgs...]', 'arguments forwarded to the tool')
  .action(async (tool: string, toolArgs: string[]) => {
    await guard(async () => {
      const exitCode = await runTool({ tool, args: toolArgs, quiet: true })
      if (exitCode !== 0) process.exitCode = exitCode
    })
  })

// Default tool execution shortcut (ntsx tool <tool> [args...])
toolCmd
  .argument('[tool]', 'tool package name')
  .argument('[toolArgs...]', 'arguments forwarded to the tool')
  .passThroughOptions()
  .action(async (tool: string | undefined, toolArgs: string[]) => {
    if (!tool) return
    await guard(async () => {
      const exitCode = await runTool({ tool, args: toolArgs, quiet: true })
      if (exitCode !== 0) process.exitCode = exitCode
    })
  })

program.addHelpText(
  'after',
  `
Examples:
  ntsx run --with axios --with jsdom script.ts
  ntsx run --with chalk@^4 script.js arg1
  ntsx run -e "import { JSDOM } from 'jsdom'; console.log(typeof JSDOM)"

Dependencies are installed to ~/.cache/ntsx and linked via a node_modules symlink.
`
)

program.parse(process.argv)
