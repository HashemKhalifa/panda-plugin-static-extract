import { parseSync } from '@swc/core'
import { AstNode, collectReturnExpressions, getKeyName, unwrapExpression, walkNodes } from './ast-utils'

export interface CollectedProps {
  responsive: Map<string, Set<string>>
  nonResponsive: Map<string, Set<string>>
}

interface FileContext {
  variables: Map<string, AstNode>
  functions: Map<string, AstNode>
}

interface ExtractionResult {
  values: Array<string | number>
  responsive: boolean
}

export function createCollected(): CollectedProps {
  return {
    responsive: new Map(),
    nonResponsive: new Map(),
  }
}

export function addValue(map: Map<string, Set<string>>, property: string, value: string | number): void {
  const serializedValue = String(value)
  let values = map.get(property)
  if (!values) {
    values = new Set()
    map.set(property, values)
  }
  values.add(serializedValue)
}

export function mergeCollected(target: CollectedProps, source: CollectedProps): void {
  for (const [prop, values] of source.responsive) {
    for (const value of values) addValue(target.responsive, prop, value)
  }

  for (const [prop, values] of source.nonResponsive) {
    for (const value of values) addValue(target.nonResponsive, prop, value)
  }
}

export function mapToObject(map: Map<string, Set<string>>): Record<string, string[]> {
  const output: Record<string, string[]> = {}
  for (const [prop, values] of map) {
    output[prop] = [...values].sort()
  }
  return output
}

export function countMappedValues(values: Record<string, string[]>): number {
  return Object.values(values).reduce((sum, entries) => sum + entries.length, 0)
}

export function extractPropsFromContent(
  content: string,
  componentPropMap: Record<string, Record<string, string>>,
  trackedComponents: Set<string>,
  breakpoints: Set<string>
): CollectedProps {
  const collected = createCollected()

  if (trackedComponents.size === 0) return collected

  let ast: AstNode
  try {
    ast = parseSync(content, { syntax: 'typescript', tsx: true, target: 'es2022' }) as AstNode
  } catch {
    return collected
  }

  const context = buildFileContext(ast)

  for (const node of walkNodes(ast)) {
    if (node.type !== 'JSXOpeningElement') continue

    const elementName = node.name?.value
    if (!elementName || !trackedComponents.has(elementName)) continue

    const propMap = componentPropMap[elementName]
    if (!propMap) continue

    for (const attr of node.attributes ?? []) {
      if (attr.type !== 'JSXAttribute') continue
      const attrName = attr.name?.value
      if (!attrName) continue

      const cssProperty = propMap[attrName]
      if (!cssProperty) continue

      const extractedValues = extractValues(attr.value, context, breakpoints)
      if (!extractedValues) continue

      const target = extractedValues.responsive ? collected.responsive : collected.nonResponsive
      for (const value of extractedValues.values) addValue(target, cssProperty, value)
    }
  }

  return collected
}

function buildFileContext(ast: AstNode): FileContext {
  const variables = new Map<string, AstNode>()
  const functions = new Map<string, AstNode>()

  for (const node of walkNodes(ast)) {
    if (node.type === 'FunctionDeclaration' && node.identifier?.value) {
      functions.set(node.identifier.value, node)
      continue
    }

    if (node.type !== 'VariableDeclarator') continue
    const varName = node.id?.value
    if (!varName || !node.init) continue

    if (node.init.type === 'ArrowFunctionExpression' || node.init.type === 'FunctionExpression') {
      functions.set(varName, node.init)
    } else {
      variables.set(varName, node.init)
    }
  }

  return { variables, functions }
}

function extractValuesFromFunction(
  fnNode: AstNode | null,
  context: FileContext,
  breakpoints: Set<string>,
  seen: Set<string>
): ExtractionResult | null {
  if (!fnNode || typeof fnNode !== 'object') return null
  const body = fnNode.body
  if (!body) return null

  if (body.type !== 'BlockStatement') {
    return extractValues(body, context, breakpoints, seen)
  }

  const returnExpressions: AstNode[] = []
  for (const statement of body.stmts ?? []) {
    collectReturnExpressions(statement, returnExpressions)
  }

  const values: Array<string | number> = []
  let responsive = false

  for (const expression of returnExpressions) {
    const extracted = extractValues(expression, context, breakpoints, seen)
    if (!extracted) continue
    values.push(...extracted.values)
    if (extracted.responsive) responsive = true
  }

  if (values.length === 0) return null
  return { values, responsive }
}

function extractValues(
  node: unknown,
  context: FileContext,
  breakpoints: Set<string>,
  seen: Set<string> = new Set()
): ExtractionResult | null {
  const expression = unwrapExpression(node)
  if (!expression) return null

  switch (expression.type) {
    case 'StringLiteral':
      return { values: [expression.value], responsive: false }

    case 'NumericLiteral':
      return { values: [expression.value], responsive: false }

    case 'UnaryExpression':
      if (expression.operator === '-' && expression.argument?.type === 'NumericLiteral') {
        return { values: [-expression.argument.value], responsive: false }
      }
      return null

    case 'TemplateLiteral':
      if (!expression.expressions?.length) {
        const raw = (expression.quasis ?? [])
          .map((q: AstNode) => q.value?.raw ?? q.raw ?? '')
          .join('')
        return raw ? { values: [raw], responsive: false } : null
      }
      return null

    case 'ConditionalExpression': {
      const values: Array<string | number> = []
      let responsive = false

      const consequent = extractValues(expression.consequent, context, breakpoints, seen)
      if (consequent) {
        values.push(...consequent.values)
        if (consequent.responsive) responsive = true
      }

      const alternate = extractValues(expression.alternate, context, breakpoints, seen)
      if (alternate) {
        values.push(...alternate.values)
        if (alternate.responsive) responsive = true
      }

      return values.length > 0 ? { values, responsive } : null
    }

    case 'Identifier': {
      const name = expression.value
      if (!name || seen.has(name)) return null

      const referenced = context.variables.get(name)
      if (!referenced) return null

      const nextSeen = new Set(seen)
      nextSeen.add(name)
      return extractValues(referenced, context, breakpoints, nextSeen)
    }

    case 'CallExpression': {
      const calleeName = expression.callee?.value
      if (!calleeName) return null

      if (calleeName === 'useMemo') {
        const memoFn = expression.arguments?.[0]?.expression
        return extractValuesFromFunction(
          unwrapExpression(memoFn),
          context,
          breakpoints,
          new Set(seen)
        )
      }

      const functionNode = context.functions.get(calleeName)
      if (!functionNode) return null

      return extractValuesFromFunction(functionNode, context, breakpoints, new Set(seen))
    }

    case 'ObjectExpression': {
      const values: Array<string | number> = []
      let hasBreakpoint = false

      for (const prop of expression.properties ?? []) {
        if (prop.type !== 'KeyValueProperty' && prop.type !== 'Property') continue

        const keyName = getKeyName(prop.key)
        if (keyName && breakpoints.has(keyName)) hasBreakpoint = true

        const nested = extractValues(prop.value, context, breakpoints, seen)
        if (nested) values.push(...nested.values)
      }

      if (hasBreakpoint && values.length > 0) {
        return { values, responsive: true }
      }

      return null
    }

    default:
      return null
  }
}
