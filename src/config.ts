import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { StaticExtractOptions } from './types'

const WORKSPACE_MARKERS = ['pnpm-workspace.yaml', 'nx.json', 'turbo.json', 'lerna.json', '.git']

export interface ResolvedOptions extends Required<Omit<StaticExtractOptions, 'workspaceRoot'>> {
  workspaceRoot: string
}

export function detectWorkspaceRoot(startDir: string): string {
  let current = resolve(startDir)

  for (;;) {
    for (const marker of WORKSPACE_MARKERS) {
      if (existsSync(resolve(current, marker))) return current
    }

    const parent = dirname(current)
    if (parent === current) return resolve(startDir)
    current = parent
  }
}

export function detectScanRoots(workspaceRoot: string): string[] {
  const candidates = [
    ['libs', 'apps'],
    ['packages', 'apps'],
    ['packages'],
    ['src'],
  ]

  for (const candidate of candidates) {
    const existing = candidate.filter(path => existsSync(resolve(workspaceRoot, path)))
    if (existing.length > 0) return existing
  }

  return ['src']
}

export function resolveOptions(options: StaticExtractOptions = {}, startDir = process.cwd()): ResolvedOptions {
  const workspaceRoot = options.workspaceRoot
    ? resolve(options.workspaceRoot)
    : detectWorkspaceRoot(startDir)

  return {
    workspaceRoot,
    scanRoots: options.scanRoots ?? detectScanRoots(workspaceRoot),
    include: options.include ?? ['**/*.tsx', '**/*.jsx'],
    exclude:
      options.exclude ??
      [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/.git/**',
        '**/.nx/**',
        '**/.next/**',
        '**/coverage/**',
        '**/*.test.*',
        '**/*.spec.*',
      ],
    components: options.components ?? {},
    unconditionalProperties: options.unconditionalProperties ?? [],
    outputPath: options.outputPath ?? '.panda/static-extract.json',
    minimumValues: options.minimumValues ?? 0,
    strict: options.strict ?? process.env.CI === 'true',
    verbose: options.verbose ?? false,
    breakpoints: options.breakpoints ?? ['base', 'sm', 'md', 'lg', 'xl', '2xl'],
    debounceMs: options.debounceMs ?? 300,
    poll: options.poll ?? false,
  }
}
