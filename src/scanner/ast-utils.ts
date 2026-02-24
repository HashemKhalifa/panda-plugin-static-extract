export function* walkNodes(node: unknown): Generator<Record<string, unknown>> {
  if (!node || typeof node !== 'object') return

  const record = node as Record<string, unknown>
  if (typeof record.type === 'string') yield record

  for (const value of Object.values(record)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object') {
          yield* walkNodes(item)
        }
      }
      continue
    }

    if (value && typeof value === 'object') {
      yield* walkNodes(value)
    }
  }
}

export function unwrapExpression(node: unknown): unknown {
  let current = node as Record<string, unknown> | undefined

  while (current && typeof current === 'object') {
    const type = current.type
    if (type === 'JSXExpressionContainer' || type === 'ParenthesisExpression') {
      current = current.expression as Record<string, unknown> | undefined
      continue
    }

    if (
      type === 'TsAsExpression' ||
      type === 'TsTypeAssertion' ||
      type === 'TsConstAssertion' ||
      type === 'TsNonNullExpression'
    ) {
      current = current.expression as Record<string, unknown> | undefined
      continue
    }

    break
  }

  return current
}

export function getKeyName(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null
  const key = node as Record<string, unknown>
  return (key.value as string) ?? (key.name as string) ?? null
}
