export type AstNode = Record<string, any>

export function* walkNodes(node: unknown): Generator<AstNode> {
  if (!node || typeof node !== 'object') return
  const current = node as AstNode
  if (current.type) yield current

  for (const key of Object.keys(current)) {
    if (key === 'span') continue
    const child = current[key]
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === 'object' && (item as AstNode).type) {
          yield* walkNodes(item)
        }
      }
    } else if (child && typeof child === 'object' && (child as AstNode).type) {
      yield* walkNodes(child)
    }
  }
}

export function* walkNodesDeep(node: unknown): Generator<AstNode> {
  if (!node || typeof node !== 'object') return
  const current = node as AstNode
  if (current.type) yield current

  for (const key of Object.keys(current)) {
    if (key === 'span') continue
    const child = current[key]
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === 'object') yield* walkNodesDeep(item)
      }
    } else if (child && typeof child === 'object') {
      yield* walkNodesDeep(child)
    }
  }
}

export function unwrapExpression(node: unknown): AstNode | null {
  let current = node as AstNode | null | undefined
  while (current) {
    if (current.type === 'JSXExpressionContainer') {
      current = current.expression
      continue
    }
    if (current.type === 'ParenthesisExpression') {
      current = current.expression
      continue
    }
    if (
      current.type === 'TsAsExpression' ||
      current.type === 'TsTypeAssertion' ||
      current.type === 'TsConstAssertion' ||
      current.type === 'TsNonNullExpression'
    ) {
      current = current.expression
      continue
    }

    return current
  }

  return null
}

export function getKeyName(keyNode: unknown): string | null {
  if (!keyNode || typeof keyNode !== 'object') return null
  const key = keyNode as AstNode
  return key.value ?? key.name ?? null
}

export function collectReturnExpressions(statement: AstNode, out: AstNode[]): void {
  if (!statement || typeof statement !== 'object') return

  switch (statement.type) {
    case 'ReturnStatement':
      if (statement.argument) out.push(statement.argument)
      return
    case 'BlockStatement':
      for (const stmt of statement.stmts ?? []) collectReturnExpressions(stmt, out)
      return
    case 'IfStatement':
      if (statement.consequent) collectReturnExpressions(statement.consequent, out)
      if (statement.alternate) collectReturnExpressions(statement.alternate, out)
      return
    case 'SwitchStatement':
      for (const caze of statement.cases ?? []) {
        for (const cons of caze.consequent ?? []) collectReturnExpressions(cons, out)
      }
      return
    default:
      return
  }
}

export function getObjectPropertyValue(objectExpression: AstNode | null, keyName: string): AstNode | null {
  if (!objectExpression || objectExpression.type !== 'ObjectExpression') return null

  for (const prop of objectExpression.properties ?? []) {
    if (prop.type !== 'KeyValueProperty' && prop.type !== 'Property') continue
    const key = getKeyName(prop.key)
    if (key === keyName) return prop.value ?? null
  }

  return null
}

export function asStringLiteral(node: unknown): string | null {
  const expression = unwrapExpression(node)
  if (!expression) return null
  return expression.type === 'StringLiteral' ? expression.value : null
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function createComponentPattern(componentNames: string[]): RegExp | null {
  if (componentNames.length === 0) return null
  return new RegExp(`\\b(?:${componentNames.map(escapeRegex).join('|')})\\b`)
}

export function containsAnyMarker(content: string, markers: string[]): boolean {
  for (const marker of markers) {
    if (content.includes(marker)) return true
  }
  return false
}

