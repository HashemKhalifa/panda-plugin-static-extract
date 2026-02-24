import { parseSync } from '@swc/core'
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { getKeyName, unwrapExpression, walkNodesDeep } from './ast-utils'
import { findSourceFilesByPattern } from './file-finder'
import { loadPatternPropertyMaps } from './pattern-reader'

export interface DiscoveryOptions {
  workspaceRoot: string
  scanRoots: string[]
  include: string[]
  exclude: string[]
  allFiles: string[]
  patternsDir: string | null
  manualComponents?: Record<string, Record<string, string>>
}

interface RawFile {
  path: string
  content: string
}

export async function buildComponentPropMap(
  options: DiscoveryOptions
): Promise<Record<string, Record<string, string>>> {
  const patternMaps = await loadPatternPropertyMaps(options.patternsDir)
  const rawFiles = await loadRawFiles(options)
  const discovered: Record<string, Record<string, string>> = {}

  for (const { path: filePath, content } of rawFiles) {
    let ast: Record<string, unknown>
    try {
      ast = parseSync(content, { syntax: 'typescript', tsx: true, target: 'es2022' }) as unknown as Record<
        string,
        unknown
      >
    } catch {
      continue
    }

    const componentName = detectComponentName(ast, filePath)
    if (!componentName) continue

    const aliases = buildAliasMap(ast)

    for (const node of walkNodesDeep(ast)) {
      if (node.type !== 'CallExpression') continue
      if (node.callee?.type !== 'MemberExpression') continue

      const memberProp = getKeyName(node.callee.property)
      if (memberProp !== 'raw') continue

      const patternName = getKeyName(node.callee.object)
      if (!patternName) continue

      const patternPropMap = patternMaps[patternName]
      if (!patternPropMap) continue

      const rawArgument = unwrapExpression(node.arguments?.[0]?.expression)
      if (!rawArgument || rawArgument.type !== 'ObjectExpression') continue

      discovered[componentName] ??= {}

      for (const rawProp of rawArgument.properties ?? []) {
        let patternProp: string | null = null
        let sourceIdentifier: string | null = null

        if (rawProp.type === 'Identifier') {
          patternProp = rawProp.value ?? null
          sourceIdentifier = rawProp.value ?? null
        } else if (rawProp.type === 'KeyValueProperty') {
          patternProp = getKeyName(rawProp.key)
          const valueExpression = unwrapExpression(rawProp.value)
          if (valueExpression?.type === 'Identifier') {
            sourceIdentifier = valueExpression.value ?? null
          }
        }

        if (!patternProp || !sourceIdentifier) continue

        const componentProp = aliases.get(sourceIdentifier) ?? sourceIdentifier
        const cssProperty = patternPropMap[patternProp] ?? patternProp
        discovered[componentName][componentProp] = cssProperty
      }
    }
  }

  for (const [componentName, props] of Object.entries(discovered)) {
    if (Object.keys(props).length === 0) delete discovered[componentName]
  }

  return mergeManualComponents(discovered, options.manualComponents ?? {})
}

async function loadRawFiles(options: DiscoveryOptions): Promise<RawFile[]> {
  const rawFiles: RawFile[] = []
  const rgPaths = findSourceFilesByPattern(options.workspaceRoot, options.scanRoots, '.raw(', {
    fixed: true,
    include: options.include,
    exclude: options.exclude,
  })

  if (rgPaths) {
    await Promise.all(
      rgPaths.map(async filePath => {
        try {
          rawFiles.push({ path: filePath, content: await readFile(filePath, 'utf-8') })
        } catch {
          // Ignore transient read failures while editors write files.
        }
      })
    )
  } else {
    await Promise.all(
      options.allFiles.map(async filePath => {
        try {
          const content = await readFile(filePath, 'utf-8')
          if (content.includes('.raw(')) {
            rawFiles.push({ path: filePath, content })
          }
        } catch {
          // Ignore transient read failures while editors write files.
        }
      })
    )
  }

  rawFiles.sort((a, b) => a.path.localeCompare(b.path))
  return rawFiles
}

function buildAliasMap(ast: Record<string, unknown>): Map<string, string> {
  const aliases = new Map<string, string>()

  for (const node of walkNodesDeep(ast)) {
    if (node.type !== 'ObjectPattern') continue

    for (const prop of node.properties ?? []) {
      if (prop.type === 'AssignmentPatternProperty') {
        const key = getKeyName(prop.key)
        if (key) aliases.set(key, key)
      } else if (prop.type === 'KeyValuePatternProperty') {
        const key = getKeyName(prop.key)
        const valueExpression = unwrapExpression(prop.value)
        if (key && valueExpression?.type === 'Identifier' && valueExpression.value) {
          aliases.set(valueExpression.value, key)
        }
      }
    }
  }

  return aliases
}

function detectComponentName(ast: Record<string, unknown>, filePath: string): string | null {
  const exportedNames = new Set<string>()

  for (const node of walkNodesDeep(ast)) {
    if (node.type !== 'ExportDeclaration' && node.type !== 'ExportNamedDeclaration') continue
    const declaration = node.declaration
    if (!declaration) continue

    if (declaration.type === 'VariableDeclaration') {
      for (const declarationNode of declaration.declarations ?? []) {
        if (declarationNode.id?.type === 'Identifier' && declarationNode.id.value) {
          exportedNames.add(declarationNode.id.value)
        }
      }
    } else if (
      (declaration.type === 'FunctionDeclaration' || declaration.type === 'ClassDeclaration') &&
      declaration.identifier?.value
    ) {
      exportedNames.add(declaration.identifier.value)
    }
  }

  const fileComponentName = basename(filePath, extname(filePath))
  if (exportedNames.has(fileComponentName) && /^[A-Z]/.test(fileComponentName)) {
    return fileComponentName
  }

  const pascalExports = [...exportedNames].filter(name => /^[A-Z]/.test(name))
  if (pascalExports.length === 1) return pascalExports[0]

  if (/^[A-Z]/.test(fileComponentName)) return fileComponentName
  return null
}

function mergeManualComponents(
  autoMap: Record<string, Record<string, string>>,
  manualMap: Record<string, Record<string, string>>
): Record<string, Record<string, string>> {
  const merged: Record<string, Record<string, string>> = {}

  for (const [componentName, props] of Object.entries(autoMap)) {
    merged[componentName] = { ...props }
  }

  for (const [componentName, props] of Object.entries(manualMap)) {
    merged[componentName] ??= {}
    merged[componentName] = { ...merged[componentName], ...props }
  }

  return merged
}
