import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { extname, isAbsolute, resolve } from 'node:path'

const MAX_BUFFER = 20 * 1024 * 1024

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.nx',
  '.git',
  'coverage',
  'tmp',
  'out-tsc',
  '__tests__',
  'test',
  'e2e',
  '.storybook',
  '.panda-cache',
])

interface RipgrepOptions {
  include: string[]
  exclude: string[]
}

interface PatternSearchOptions extends RipgrepOptions {
  fixed?: boolean
}

export async function listWorkspaceSourceFiles(
  workspaceRoot: string,
  scanRoots: string[],
  include: string[],
  exclude: string[]
): Promise<string[]> {
  const rgFiles = findWithRipgrep(workspaceRoot, scanRoots, include, exclude)
  if (rgFiles) return rgFiles

  const extensions = getExtensionsFromGlobs(include)
  const files: string[] = []

  for (const root of scanRoots) {
    const absoluteRoot = resolve(workspaceRoot, root)
    if (!existsSync(absoluteRoot)) continue
    files.push(...(await findFilesRecursive(absoluteRoot, extensions)))
  }

  return files.sort((a, b) => a.localeCompare(b))
}

export function findSourceFilesByPattern(
  workspaceRoot: string,
  scanRoots: string[],
  patterns: string | string[],
  options: PatternSearchOptions
): string[] | null {
  const values = Array.isArray(patterns) ? patterns.filter(Boolean) : [patterns].filter(Boolean)
  if (values.length === 0) return []

  const patternArgs: string[] = []
  if (options.fixed) patternArgs.push('-F')
  for (const pattern of values) patternArgs.push('-e', pattern)

  const args = [
    '--files-with-matches',
    '--no-heading',
    '--color',
    'never',
    ...patternArgs,
    ...toRipgrepGlobArgs(options.include, options.exclude),
    ...scanRoots,
  ]

  const result = spawnSync('rg', args, {
    cwd: workspaceRoot,
    encoding: 'utf-8',
    maxBuffer: MAX_BUFFER,
  })

  if (result.error) return null
  if (result.status !== 0 && result.status !== 1) return null
  if (result.status === 1 || !result.stdout) return []

  return parseRipgrepOutput(result.stdout, workspaceRoot)
}

export function shouldTriggerOnFile(filename: string | null): boolean {
  if (!filename) return true

  const normalized = filename.replace(/\\/g, '/')
  if (
    normalized.includes('/node_modules/') ||
    normalized.includes('/dist/') ||
    normalized.includes('/build/') ||
    normalized.includes('/coverage/') ||
    normalized.includes('/.git/') ||
    normalized.includes('/.nx/')
  ) {
    return false
  }

  return (
    normalized.endsWith('.tsx') ||
    normalized.endsWith('.jsx') ||
    normalized.endsWith('/colorPalette.ts') ||
    normalized.includes('/patterns/')
  )
}

function findWithRipgrep(
  workspaceRoot: string,
  scanRoots: string[],
  include: string[],
  exclude: string[]
): string[] | null {
  const args = ['--files', '--color', 'never', ...toRipgrepGlobArgs(include, exclude), ...scanRoots]

  const result = spawnSync('rg', args, {
    cwd: workspaceRoot,
    encoding: 'utf-8',
    maxBuffer: MAX_BUFFER,
  })

  if (result.error || (result.status !== 0 && result.status !== 1)) return null
  if (!result.stdout) return []

  return parseRipgrepOutput(result.stdout, workspaceRoot)
}

function parseRipgrepOutput(stdout: string, workspaceRoot: string): string[] {
  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(path => (isAbsolute(path) ? path : resolve(workspaceRoot, path)))
    .sort((a, b) => a.localeCompare(b))
}

function getExtensionsFromGlobs(include: string[]): Set<string> {
  const extensions = new Set<string>()
  for (const pattern of include) {
    const match = pattern.match(/\*\.([a-z0-9]+)$/i)
    if (!match) continue
    extensions.add(`.${match[1]}`)
  }

  if (extensions.size === 0) {
    extensions.add('.tsx')
    extensions.add('.jsx')
  }

  return extensions
}

function toRipgrepGlobArgs(include: string[], exclude: string[]): string[] {
  const args: string[] = []

  for (const pattern of include) {
    args.push('--glob', pattern)
  }

  const uniqueExcludes = new Set<string>([
    ...exclude,
    '!**/node_modules/**',
    '!**/dist/**',
    '!**/build/**',
    '!**/.nx/**',
    '!**/.git/**',
    '!**/coverage/**',
    '!**/tmp/**',
    '!**/out-tsc/**',
    '!**/__tests__/**',
    '!**/test/**',
    '!**/e2e/**',
    '!**/.storybook/**',
  ])

  for (const pattern of uniqueExcludes) {
    args.push('--glob', pattern.startsWith('!') ? pattern : `!${pattern}`)
  }

  return args
}

async function findFilesRecursive(dir: string, extensions: Set<string>): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const entryPath = resolve(dir, entry.name)

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      files.push(...(await findFilesRecursive(entryPath, extensions)))
      continue
    }

    if (entry.isFile() && extensions.has(extname(entry.name))) {
      files.push(entryPath)
    }
  }

  return files
}
