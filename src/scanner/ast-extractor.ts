import { readFile } from 'node:fs/promises'
import { parseSync } from '@swc/core'
import { walkNodes, unwrapExpression } from './ast-utils'

export interface ExtractedValues {
  responsive: Record<string, Set<string>>
  nonResponsive: Record<string, Set<string>>
  matched: boolean
}

export async function extractFromFile(
  filePath: string,
  componentMap: Record<string, Record<string, string>>,
  breakpoints: Set<string>
): Promise<ExtractedValues> {
  const extracted: ExtractedValues = {
    responsive: {},
    nonResponsive: {},
    matched: false,
  }

  if (Object.keys(componentMap).length === 0) return extracted

  const content = await readFile(filePath, 'utf-8')
  const ast = parseSync(content, { syntax: 'typescript', tsx: true, target: 'es2022' })

  const trackedComponents = new Set(Object.keys(componentMap))

  for (const node of walkNodes(ast)) {
    if (node.type !== 'JSXOpeningElement') continue

    const elementName = (node.name as { value?: string } | undefined)?.value
    if (!elementName || !trackedComponents.has(elementName)) continue
    extracted.matched = true

    const propMap = componentMap[elementName]
    const attrs = (node.attributes as Array<Record<string, unknown>> | undefined) ?? []

    for (const attr of attrs) {
      if (attr.type !== 'JSXAttribute') continue
      const attrName = (attr.name as { value?: string } | undefined)?.value
      if (!attrName) continue

      const cssProperty = propMap[attrName]
      if (!cssProperty) continue

      const valueNode = unwrapExpression(attr.value)
      const values = literalValues(valueNode)
      if (values.length === 0) continue

      const isResponsive = isResponsiveObject(valueNode, breakpoints)
      const target = isResponsive ? extracted.responsive : extracted.nonResponsive
      target[cssProperty] ??= new Set<string>()

      for (const value of values) {
        target[cssProperty]!.add(value)
      }
    }
  }

  return extracted
}

function literalValues(node: unknown): string[] {
  if (!node || typeof node !== 'object') return []
  const expr = node as Record<string, unknown>

  if (expr.type === 'StringLiteral') return [String(expr.value)]
  if (expr.type === 'NumericLiteral') return [String(expr.value)]

  if (expr.type === 'ConditionalExpression') {
    const consequent = literalValues(expr.consequent)
    const alternate = literalValues(expr.alternate)
    return [...consequent, ...alternate]
  }

  if (expr.type === 'ObjectExpression') {
    const values: string[] = []
    const props = (expr.properties as Array<Record<string, unknown>> | undefined) ?? []
    for (const prop of props) {
      if (prop.type !== 'KeyValueProperty' && prop.type !== 'Property') continue
      values.push(...literalValues(prop.value))
    }
    return values
  }

  return []
}

function isResponsiveObject(node: unknown, breakpoints: Set<string>): boolean {
  if (!node || typeof node !== 'object') return false
  const expr = node as Record<string, unknown>
  if (expr.type !== 'ObjectExpression') return false

  const props = (expr.properties as Array<Record<string, unknown>> | undefined) ?? []
  for (const prop of props) {
    if (prop.type !== 'KeyValueProperty' && prop.type !== 'Property') continue
    const key = prop.key as { value?: string; name?: string } | undefined
    const keyName = key?.value ?? key?.name
    if (keyName && breakpoints.has(keyName)) return true
  }

  return false
}
