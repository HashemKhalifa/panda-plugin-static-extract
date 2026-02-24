import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { StaticExtractOptions } from './types'

const WORKSPACE_MARKERS = ['pnpm-workspace.yaml', 'nx.json', 'turbo.json', 'lerna.json', '.git']

const DEFAULT_INCLUDE = ['**/*.tsx', '**/*.jsx']
const DEFAULT_EXCLUDE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/.nx/**',
  '**/.next/**',
  '**/coverage/**',
  '**/tmp/**',
  '**/out-tsc/**',
  '**/__tests__/**',
  '**/test/**',
  '**/e2e/**',
  '**/*.test.*',
  '**/*.spec.*',
]

const DEFAULT_BREAKPOINTS = ['sm', 'md', 'lg', 'xl', '2xl']

const BREAKPOINT_FILE_CANDIDATES = [
  'src/presets/mms-preset-base/breakpoints.ts',
  'src/theme/breakpoints.ts',
  'src/breakpoints.ts',
]

const COLOR_PALETTE_FILE_CANDIDATES = [
  'src/presets/themes/colorPalette/colorPalette.ts',
  'src/theme/colorPalette.ts',
  'src/colorPalette.ts',
]

const PATTERNS_DIR_CANDIDATES = ['src/patterns']

export interface ResolvedOptions
  extends Required<
    Omit<
      StaticExtractOptions,
      'workspaceRoot' | 'breakpointsFile' | 'patternsDir' | 'colorPaletteFile'
    >
  > {
  workspaceRoot: string
  breakpointsFile: string | null
  patternsDir: string | null
  colorPaletteFile: string | null
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

function findFirstExisting(workspaceRoot: string, candidates: string[]): string | null {
  for (const candidate of candidates) {
    const absolutePath = resolve(workspaceRoot, candidate)
    if (existsSync(absolutePath)) return absolutePath
  }
  return null
}

export function resolveOptions(
  options: StaticExtractOptions = {},
  startDir = process.cwd()
): ResolvedOptions {
  const workspaceRoot = options.workspaceRoot
    ? resolve(options.workspaceRoot)
    : detectWorkspaceRoot(startDir)

  const strictDefault = process.env.CI === 'true'

  return {
    workspaceRoot,
    scanRoots: options.scanRoots ?? detectScanRoots(workspaceRoot),
    include: options.include ?? DEFAULT_INCLUDE,
    exclude: options.exclude ?? DEFAULT_EXCLUDE,
    components: options.components ?? {},
    unconditionalProperties: options.unconditionalProperties ?? [],
    unconditionalValues: options.unconditionalValues ?? {},
    outputPath: options.outputPath ?? '.panda/static-extract.json',
    minimumValues: options.minimumValues ?? 0,
    strict: options.strict ?? strictDefault,
    verbose: options.verbose ?? false,
    breakpoints: options.breakpoints ?? DEFAULT_BREAKPOINTS,
    breakpointsFile:
      options.breakpointsFile !== undefined
        ? resolve(workspaceRoot, options.breakpointsFile)
        : findFirstExisting(workspaceRoot, BREAKPOINT_FILE_CANDIDATES),
    breakpointsVariable: options.breakpointsVariable ?? 'breakpoints',
    patternsDir:
      options.patternsDir !== undefined
        ? resolve(workspaceRoot, options.patternsDir)
        : findFirstExisting(workspaceRoot, PATTERNS_DIR_CANDIDATES),
    colorPaletteFile:
      options.colorPaletteFile !== undefined
        ? resolve(workspaceRoot, options.colorPaletteFile)
        : findFirstExisting(workspaceRoot, COLOR_PALETTE_FILE_CANDIDATES),
    colorPaletteVariable: options.colorPaletteVariable ?? 'colorPalette',
    debounceMs: clampDebounce(options.debounceMs ?? 300),
    poll: options.poll ?? false,
  }
}

function clampDebounce(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 300
  return Math.max(50, Math.min(2000, Math.round(value)))
}

