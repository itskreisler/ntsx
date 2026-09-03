#!/usr/bin/env node
import { Command } from 'commander'
import { run } from './run.js'

/** Acumula valores de opciones repetidas: --with a --with b → ['a','b'] */
function collect(value: string, previous: string[]): string[] {
  return previous.concat([value])
}

const program = new Command()

program
  .name('ntx')
  .description('Run Node/TS scripts with ephemeral dependencies (uv-style --with)')
  .version('0.1.0')

program
  .command('run')
  .description('Run a script or inline code with ephemeral dependencies')
  .option('-w, --with <pkg>', 'ephemeral dependency (pkg, pkg@version, @scope/pkg@version). Repeatable', collect, [])
  .option('-c, --eval <code>', 'evaluate inline code (like node -e)')
  .option('-q, --quiet', 'suppress ntx output')
  .option('--node <version>', 'pin Node version (reserved for a future version)')
  .argument('[script]', 'script path (js, ts, mts, cts, tsx). Omit with --eval')
  .argument('[scriptArgs...]', 'arguments passed to the script')
  .action(async (script: string | undefined, scriptArgs: string[], options: { with?: string[]; eval?: string; node?: string; quiet?: boolean }) => {
    const exitCode = await run({
      withList: options.with ?? [],
      script: script ?? null,
      evalCode: options.eval,
      scriptArgs,
      quiet: options.quiet ?? false,
    })
    if (exitCode !== 0) process.exitCode = exitCode
  })

program.addHelpText(
  'after',
  `
Examples:
  ntx run --with axios --with jsdom script.ts
  ntx run --with chalk@^4 script.js arg1
  ntx run -c "import { JSDOM } from 'jsdom'; console.log(typeof JSDOM)"

Dependencies are installed to ~/.cache/ntx and linked via a node_modules symlink.
`
)

program.parse(process.argv)