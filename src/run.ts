import { z } from 'zod'
import { statSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { prepareCache } from './cache.js'

export interface RunOptions {
  withList: string[]
  script: string | null
  evalCode?: string
  scriptArgs: string[]
  quiet?: boolean
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
  scriptArgs: z.array(z.string()).default([]),
  quiet: z.boolean().default(false),
})

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

/** Resuelve el binario en el PATH */
function which(bin: string): string | null {
  const pathEnv = process.env.PATH ?? ''
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue
    try {
      const full = path.join(dir, bin)
      if (statSync(full).isFile()) return full
    } catch {
      // no encontrado, continúa
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

  // 1. Bajar deps efímeras + symlink (solo si hay --with)
  if (parsed.withList.length > 0) {
    await prepareCache(parsed.withList, targetDir)
  }

  // 2. Elegir runtime
  const isTs = isEval || (scriptPath !== null && isTsFile(scriptPath))
  let cmd: string
  let args: string[]

  if (isTs) {
    const tsxBin = which('tsx')
    if (tsxBin) {
      cmd = tsxBin
      args = isEval
        ? ['-e', parsed.evalCode as string, ...parsed.scriptArgs]
        : [scriptPath as string, ...parsed.scriptArgs]
    } else {
      // npx -y tsx como fallback (descarga al vuelo)
      cmd = which('npx') ?? 'npx'
      args = isEval
        ? ['-y', 'tsx', '-e', parsed.evalCode as string, ...parsed.scriptArgs]
        : ['-y', 'tsx', scriptPath as string, ...parsed.scriptArgs]
    }
  } else {
    cmd = process.execPath
    args = isEval
      ? ['-e', parsed.evalCode as string, ...parsed.scriptArgs]
      : [scriptPath as string, ...parsed.scriptArgs]
  }

  const res = spawnSync(cmd, args, { stdio: 'inherit', env: process.env })
  if (res.status === null) {
    return 1
  }
  return res.status
}