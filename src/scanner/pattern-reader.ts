import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { parseSync } from '@swc/core'
import {
  asStringLiteral,
  getKeyName,
  getObjectPropertyValue,
  unwrapExpression,
  walkNodes,
} from './ast-utils'

const TS_EXTENSIONS = new Set(['.ts'])

export async function loadPatternPropertyMaps(
  patternsDir: string | null
): Promise<Record<string, Record<string, string>>> {
  if (!patternsDir || !existsSync(patternsDir)) return {}

  const patternFiles = await findFiles(patternsDir, TS_EXTENSIONS)
  const patternMaps: Record<string, Record<string, string>> = {}

  for (const filePath of patternFiles) {
    let content: string
    try {
      content = await readFile(filePath, 'utf-8')
    } catch {
      continue
    }

    let ast: Record<string, unknown>
    try {
      ast = parseSync(content, { syntax: 'typescript', tsx: true, target: 'es2022' }) as unknown as Record<
        string,
        unknown
      >
    } catch {
      continue
    }

    for (const node of walkNodes(ast)) {
      if (node.type !== 'VariableDeclarator') continue
      if (node.id?.type !== 'Identifier') continue
      if (node.init?.type !== 'CallExpression') continue
      if (node.init.callee?.type !== 'Identifier') continue
      if (node.init.callee.value !== 'definePattern') continue

      const patternName = node.id.value
      if (!patternName) continue

      const configExpression = unwrapExpression(node.init.arguments?.[0]?.expression)
      const propertiesExpression = unwrapExpression(
        getObjectPropertyValue(configExpression, 'properties')
      )
      if (!propertiesExpression || propertiesExpression.type !== 'ObjectExpression') continue

      const propMap: Record<string, string> = {}

      for (const prop of propertiesExpression.properties ?? []) {
        if (prop.type !== 'KeyValueProperty' && prop.type !== 'Property') continue
        const patternProp = getKeyName(prop.key)
        if (!patternProp) continue

        const definition = unwrapExpression(prop.value)
        let cssProperty = patternProp

        if (definition?.type === 'ObjectExpression') {
          const explicitProperty = asStringLiteral(getObjectPropertyValue(definition, 'property'))
          const typeValue = asStringLiteral(getObjectPropertyValue(definition, 'type'))
          const mappedValue = asStringLiteral(getObjectPropertyValue(definition, 'value'))

          if (explicitProperty) cssProperty = explicitProperty
          else if (typeValue === 'property' && mappedValue) cssProperty = mappedValue
        }

        propMap[patternProp] = cssProperty
      }

      if (Object.keys(propMap).length > 0) {
        patternMaps[patternName] = propMap
      }
    }
  }

  return patternMaps
}

async function findFiles(dir: string, extensions: Set<string>): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const filePath = resolve(dir, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await findFiles(filePath, extensions)))
      continue
    }

    if (entry.isFile() && extensions.has(extname(entry.name))) {
      files.push(filePath)
    }
  }

  return files
}
