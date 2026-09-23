import { promises as fs } from 'node:fs'

/**
 * Metadata extracted from script inline comments (/// ntsx block).
 */
export interface ScriptMetadata {
  /** Ephemeral dependencies listed in metadata. */
  dependencies: string[]
  /** Node version requested in metadata. */
  node?: string
}

/**
 * Parses script metadata from inline /// ntsx comments in a script file.
 *
 * Example script header:
 * // /// ntsx
 * // dependencies = [
 * //   "axios",
 * //   "chalk"
 * // ]
 * // node = "24"
 * // ///
 *
 * @param scriptPath - Absolute or relative path to the script file.
 * @returns Parsed metadata or empty object if no metadata block exists.
 */
export async function parseScriptMetadata(scriptPath: string): Promise<ScriptMetadata> {
  try {
    const content = await fs.readFile(scriptPath, 'utf8')
    return parseMetadataString(content)
  } catch {
    return { dependencies: [] }
  }
}

/**
 * Parses a script string to extract metadata declared within /// ntsx comment blocks.
 *
 * @param content - Source file string.
 * @returns Parsed script metadata.
 */
export function parseMetadataString(content: string): ScriptMetadata {
  const lines = content.split(/\r?\n/)
  let inBlock = false
  const blockLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (/^\/\/\s*\/\/\/\s*ntsx\b/i.test(trimmed) || /^\/\/\/\s*ntsx\b/i.test(trimmed)) {
      inBlock = true
      continue
    }
    if (inBlock) {
      if (/^\/\/\s*\/\/\/\s*$/i.test(trimmed) || /^\/\/\/\s*$/i.test(trimmed)) {
        break
      }
      const commentContent = trimmed.replace(/^\/\/\s?/, '').replace(/^\/\/\/\s?/, '')
      blockLines.push(commentContent)
    }
  }

  if (blockLines.length === 0) {
    return { dependencies: [] }
  }

  const dependencies: string[] = []
  let node: string | undefined

  const fullBlock = blockLines.join('\n')

  // Parse dependencies = [ "dep1", "dep2" ]
  const depsMatch = fullBlock.match(/dependencies\s*=\s*\[([\s\S]*?)\]/i)
  if (depsMatch) {
    const rawDeps = depsMatch[1]
    const itemMatches = rawDeps.matchAll(/["']([^"']+)["']/g)
    for (const match of itemMatches) {
      dependencies.push(match[1].trim())
    }
  }

  // Parse node = "24"
  const nodeMatch = fullBlock.match(/node\s*=\s*["']([^"']+)["']/i)
  if (nodeMatch) {
    node = nodeMatch[1].trim()
  }

  return { dependencies, node }
}
