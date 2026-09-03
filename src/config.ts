import path from 'node:path'
import os from 'node:os'

/**
 * Rutas globales del cache. Fuente única: tanto el núcleo (prepareCache)
 * como los comandos de gestión (clean/stats) obtienen aquí sus rutas,
 * evitando dependencias circulares entre módulos.
 */
export function homeDir(): string {
  const env = process.platform === 'win32' ? process.env.USERPROFILE : process.env.HOME
  if (env && env.length > 0) return path.resolve(env)
  return os.homedir()
}

export const CACHE_ROOT = path.join(homeDir(), '.cache', 'ntx')