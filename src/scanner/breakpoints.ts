import { readFileSync } from 'node:fs'
import { parseSync } from '@swc/core'
import { unwrapExpression, walkNodes } from './ast-utils'

export function buildBreakpointSet(breakpoints: string[]): Set<string> {
  const normalized = new Set(['base', ...breakpoints])

  const names = [...normalized].filter(value => value !== 'base')
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      const from = names[i]
      const to = names[j]
      normalized.add(`${from}To${to.charAt(0).toUpperCase() + to.slice(1)}`)
    }
  }

  return normalized
}

export function loadBreakpointsFromFile(filePath: string, variableName: string): string[] {
  const content = readFileSync(filePath, 'utf-8')
  const ast = parseSync(content, { syntax: 'typescript', tsx: true, target: 'es2022' })

  for (const node of walkNodes(ast)) {
    if (node.type !== 'VariableDeclarator') continue
    if (node.id?.value !== variableName) continue

    const initializer = unwrapExpression(node.init)
    if (!initializer || initializer.type !== 'ObjectExpression') continue

    const keys: string[] = []
    for (const prop of initializer.properties ?? []) {
      if (prop.type !== 'KeyValueProperty' && prop.type !== 'Property') continue
      const key = prop.key?.value ?? prop.key?.raw
      if (key) keys.push(key)
    }

    if (keys.length > 0) return keys
  }

  throw new Error(`[panda-static-extract] Failed to read breakpoints from ${filePath}`)
}

export function loadArrayLiteralStrings(filePath: string, variableName: string): string[] {
  const content = readFileSync(filePath, 'utf-8')
  const ast = parseSync(content, { syntax: 'typescript', tsx: true, target: 'es2022' })

  for (const node of walkNodes(ast)) {
    if (node.type !== 'VariableDeclarator') continue
    if (node.id?.value !== variableName) continue

    const initializer = unwrapExpression(node.init)
    if (!initializer || initializer.type !== 'ArrayExpression') continue

    const values: string[] = []
    for (const element of initializer.elements ?? []) {
      const expression = unwrapExpression(element?.expression)
      if (expression?.type === 'StringLiteral') values.push(expression.value)
    }

    if (values.length > 0) return values
  }

  throw new Error(
    `[panda-static-extract] Failed to read string array '${variableName}' from ${filePath}`
  )
}
