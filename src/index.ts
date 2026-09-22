#!/usr/bin/env node
import { createRequire } from 'node:module'
import { Command } from 'commander'
import { z } from 'zod'
import { run } from './run.js'
import { CACHE_ROOT } from './config.js'
import { cacheStats, cleanCache, fmtBytes } from './cache-cmd.js'

// Fuente única de versión: package.json (el bundle queda con la versión real)
const require = createRequire(import.meta.url)
const { version } = require('../package.json') as { version: string }

/** Acumula valores de opciones repetidas: --with a --with b → ['a','b'] */
function collect(value: string, previous: string[]): string[] {
  return previous.concat([value])
}

/** Convierte cualquier error en un mensaje legible (sin stack trace). */
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

/** Ejecuta un handler y traduce los errores a mensaje limpio + exit 1. */
async function guard(fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    process.stderr.write(`ntsx: ${cleanErrorMessage(err)}\n`)
    process.exitCode = 1
  }
}

function noteReservedFlags(options: { node?: string }): void {
  if (options.node) {
    process.stderr.write(`ntsx: note: --node is reserved and currently ignored\n`)
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
  .option('--eval-runtime <tsx|node>', 'runtime for inline eval (default: tsx)')
  .option('--tsx-args <flags>', 'flags forwarded to tsx before the script (.ts/tsx/eval runs). Repeatable', collect, [])
  .option('--node-args <flags>', 'flags forwarded to node before the script (.js/.mjs runs). Repeatable', collect, [])
  .option('--npm-args <flags>', 'flags forwarded to the ephemeral npm install. Repeatable', collect, [])
  .option('-q, --quiet', 'suppress npm install output')
  .option('-d, --debug', 'show internal steps (cache paths, commands, restore)')
  .option('--node <version>', 'pin Node version (reserved for a future version)')
  .argument('[script]', 'script path (js, ts, mts, cts, tsx). Omit with --eval')
  .argument('[scriptArgs...]', 'arguments passed to the script')
  .action(async (script: string | undefined, scriptArgs: string[], options: { with?: string[]; eval?: string; evalRuntime?: string; tsxArgs?: string[]; nodeArgs?: string[]; npmArgs?: string[]; node?: string; quiet?: boolean; debug?: boolean }) => {
    noteReservedFlags(options)
    await guard(async () => {
      const exitCode = await run({
        withList: options.with ?? [],
        script: script ?? null,
        evalCode: options.eval,
        scriptArgs,
        quiet: options.quiet ?? false,
        evalRuntime: options.evalRuntime as 'tsx' | 'node' | undefined,
        tsxArgs: options.tsxArgs ?? [],
        nodeArgs: options.nodeArgs ?? [],
        npmArgs: options.npmArgs ?? [],
        debug: options.debug ?? false,
      })
      if (exitCode !== 0) process.exitCode = exitCode
    })
  })

// ----- comando: cache -----
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