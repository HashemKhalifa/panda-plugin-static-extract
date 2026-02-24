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
