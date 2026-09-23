import path from 'node:path'
import os from 'node:os'

/**
 * Resolves the user's home directory across operating systems.
 * Checked in order: `USERPROFILE` (Windows), `HOME` (POSIX), and `os.homedir()`.
 *
 * @returns The absolute path to the user's home directory.
 */
export function homeDir(): string {
  const env = process.platform === 'win32' ? process.env.USERPROFILE : process.env.HOME
  if (env && env.length > 0) return path.resolve(env)
  return os.homedir()
}

/**
 * The absolute path to the root directory for storing the ntsx dependency cache.
 * Defaults to `~/.cache/ntsx` on POSIX or `%USERPROFILE%\.cache\ntsx` on Windows.
 */
export const CACHE_ROOT = path.join(homeDir(), '.cache', 'ntsx')
