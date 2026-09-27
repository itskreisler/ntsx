import { promises as fs } from 'node:fs'

/**
 * Metadata extracted from script JSDoc comment (@ntsx block).
 */
export interface ScriptMetadata {
  /** Ephemeral dependencies listed in metadata. */
  dependencies: string[]
  /** Node version requested in metadata. */
  node?: string
  /** Runtime environment requested in metadata ('node' | 'tsx'). */
  runtime?: 'node' | 'tsx'
}

/**
 * Parses script metadata from JSDoc @ntsx block in a script file.
 *
 * Example script header:
 * /**
 *  * @ntsx
 *  * @with axios@1.7.9
 *  * @with @scope/pkg@1.4.2
 *  * @node {24}
 *  * @runtime {tsx}
 *  *\/
 *
 * @param scriptPath - Absolute or relative path to the script file.
 * @returns Parsed metadata or empty object if no @ntsx block exists.
 */
export async function parseScriptMetadata(scriptPath: string): Promise<ScriptMetadata> {
  try {
    const content = await fs.readFile(scriptPath, 'utf8')
    return parseMetadataString(content)
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Invalid')) {
      throw err
    }
    return { dependencies: [] }
  }
}

/**
 * Parses a script string to extract metadata declared within a JSDoc @ntsx comment block.
 *
 * @param content - Source file string.
 * @returns Parsed script metadata.
 */
export function parseMetadataString(content: string): ScriptMetadata {
  const jsdocBlocks = content.match(/\/\*\*[\s\S]*?\*\//g) ?? []

  // Select the FIRST block containing @ntsx tag
  let targetBlock: string | null = null;
  for (const block of jsdocBlocks) {
    if (/@ntsx\b/.test(block)) {
      targetBlock = block
      break
    }
  }

  if (!targetBlock) {
    return { dependencies: [] }
  }

  const dependencies: string[] = []
  let node: string | undefined
  let runtime: 'node' | 'tsx' | undefined

  const lines = targetBlock.split(/\r?\n/)

  for (const line of lines) {
    const cleaned = line.replace(/^\s*\*?\s?/, '').trim()

    // @with
    const withMatch = cleaned.match(/@with\s+([^\s*]+)/i)
    if (withMatch) {
      const rawSpec = withMatch[1].replace(/^['"]|['"]$/g, '').trim()
      if (!rawSpec) {
        throw new Error(`Invalid @with syntax: "${cleaned}"`)
      }

      // Validate spec syntax
      const isScoped = rawSpec.startsWith('@')
      const atIdx = isScoped ? rawSpec.indexOf('@', 1) : rawSpec.indexOf('@')

      let formattedSpec = rawSpec
      if (atIdx === -1) {
        formattedSpec = `${rawSpec}@latest`
      }

      // Basic package spec regex validation
      const specRegex = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(@[^\s]+)?$/i
      if (!specRegex.test(formattedSpec)) {
        throw new Error(`Invalid package spec in @with: "${rawSpec}"`)
      }

      if (!dependencies.includes(formattedSpec)) {
        dependencies.push(formattedSpec)
      }
    }

    // @node {version}
    const nodeMatch = cleaned.match(/@node\s+\{([^}]+)\}/i)
    if (nodeMatch) {
      const ver = nodeMatch[1].trim()
      if (node && node !== ver) {
        throw new Error(`Incompatible duplicate @node declarations: "${node}" and "${ver}"`)
      }
      node = ver
    }

    // @runtime {node|tsx}
    const runtimeMatch = cleaned.match(/@runtime\s+\{([^}]+)\}/i)
    if (runtimeMatch) {
      const rt = runtimeMatch[1].trim().toLowerCase()
      if (rt !== 'node' && rt !== 'tsx') {
        throw new Error(`Invalid @runtime value: "${rt}". Allowed values are 'node' or 'tsx'.`)
      }
      if (runtime && runtime !== rt) {
        throw new Error(`Incompatible duplicate @runtime declarations: "${runtime}" and "${rt}"`)
      }
      runtime = rt as 'node' | 'tsx'
    }
  }

  return { dependencies, node, runtime }
}
