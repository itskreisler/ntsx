import { z } from 'zod'
import { statSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { prepareCache, restoreNodeModules, type NodeModulesStash } from './cache.js'

export interface RunOptions {
  withList: string[]
  script: string | null
  evalCode?: string
  evalRuntime?: 'tsx' | 'node'
  scriptArgs: string[]
  quiet?: boolean
  tsxArgs?: string[]
  nodeArgs?: string[]
  npmArgs?: string[]
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
  debug: z.boolean().default(false),
})

/** Divide cada string de args (puede traer espacios) en tokens sueltos. */
function splitArgs(raws: string[]): string[] {
  const out: string[] = []
  for (const raw of raws) out.push(...raw.split(/\s+/).filter(Boolean))
  return out
}

function isTsFile(p: string): boolean {
  return /\.(ts|mts|cts|tsx)$/.test(p)
}

function resolveScript(script: string): string {
  const abs = path.resolve(script)
  try {
    const st = statSync(abs)
    if (st.isFile()) return abs
  } catch {
    // no existe directo
  }
  throw new Error(`Script not found: ${script}`)
}

/** Resuelve el binario en el PATH (en Windows prueba .cmd/.exe). */
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
        // no encontrado, continúa
      }
    }
  }
  return null
}

/** Lanza el script o eval con runtime adecuado; propaga exit code. */
export async function run(opts: RunOptions): Promise<number> {
  const parsed = runOptionsSchema.parse(opts)

  // Modo eval: no hay archivo, targetDir = cwd
  const isEval = parsed.evalCode !== undefined
  if (!isEval && (parsed.script === null || parsed.script === '')) {
    throw new Error('A script path or --eval code is required')
  }

  const scriptPath = isEval ? null : resolveScript(parsed.script as string)
  const targetDir = scriptPath ? path.dirname(scriptPath) : process.cwd()

  // Acciones temporales sobre el node_modules del target (restaurar al salir)
  let stash: NodeModulesStash | null = null

  try {
    // 1. Bajar deps efímeras + symlink (solo si hay --with)
    if (parsed.withList.length > 0) {
      const prepped = await prepareCache(parsed.withList, targetDir, {
        quiet: parsed.quiet,
        npmArgs: splitArgs(parsed.npmArgs),
        debug: parsed.debug,
      })
      stash = prepped.stash
    }

    // 2. Elegir runtime y flags que le tocan (antes del script)
    //    archivo → por extensión (.ts→tsx, .js→node); eval → --eval-runtime
    const isTs = scriptPath !== null ? isTsFile(scriptPath) : parsed.evalRuntime === 'tsx'
    let cmd: string
    let args: string[]

    if (isTs) {
      const runnerFlags = splitArgs(parsed.tsxArgs)
      const tsxBin = which('tsx')
      if (tsxBin) {
        cmd = tsxBin
        args = isEval
          ? [...runnerFlags, '-e', parsed.evalCode as string, ...parsed.scriptArgs]
          : [...runnerFlags, scriptPath as string, ...parsed.scriptArgs]
      } else {
        // npx -y tsx como fallback (descarga al vuelo)
        cmd = which('npx') ?? 'npx'
        args = isEval
          ? ['-y', 'tsx', ...runnerFlags, '-e', parsed.evalCode as string, ...parsed.scriptArgs]
          : ['-y', 'tsx', ...runnerFlags, scriptPath as string, ...parsed.scriptArgs]
      }
    } else {
      const runnerFlags = splitArgs(parsed.nodeArgs)
      cmd = process.execPath
      args = isEval
        ? [...runnerFlags, '--input-type=module', '-e', parsed.evalCode as string, ...parsed.scriptArgs]
        : [...runnerFlags, scriptPath as string, ...parsed.scriptArgs]
    }

    if (parsed.debug) {
      const shownArgs = args.map((a) => (a.includes(' ') ? JSON.stringify(a) : a)).join(' ')
      process.stderr.write(`ntsx: [debug] exec: ${cmd} ${shownArgs}\n`)
    }

    // spawn asíncrono: permite reaccionar a SIGINT/SIGTERM mientras el runner
    // (p. ej. un servidor) sigue vivo, reenviar la señal y restaurar node_modules.
    // En Windows un .cmd necesita shell (los bins de npm son .cmd).
    const spawnOpts: { stdio: 'inherit'; env: NodeJS.ProcessEnv; shell?: boolean } = {
      stdio: 'inherit',
      env: process.env,
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
    const onSignal = (sig: NodeJS.Signals): void => {
      if (gotSignal) return
      gotSignal = sig
      if (parsed.debug) process.stderr.write(`ntsx: [debug] ${sig} recibida, restaurando node_modules\n`)
      child.kill(sig)
    }
    process.on('SIGINT', onSignal)
    process.on('SIGTERM', onSignal)

    let code: number
    try {
      const result = await closed
      if (spawnErrMsg) process.stderr.write(`ntsx: failed to spawn ${cmd}: ${spawnErrMsg}\n`)
      code = result === null ? (gotSignal ? (gotSignal === 'SIGINT' ? 130 : 143) : 1) : result
    } finally {
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
  }
}