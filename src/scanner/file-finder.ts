import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.nx', '.next', 'coverage'])

export async function findSourceFiles(
  workspaceRoot: string,
  scanRoots: string[],
  extensions: string[]
): Promise<string[]> {
  const rgFiles = tryFindWithRipgrep(workspaceRoot, scanRoots, extensions)
  if (rgFiles) return rgFiles

  const ext = new Set(extensions)
  const files: string[] = []

  for (const root of scanRoots) {
    const abs = resolve(workspaceRoot, root)
    if (!existsSync(abs)) continue
    files.push(...(await findFilesRecursive(abs, ext)))
  }

  return files.sort((a, b) => a.localeCompare(b))
}

function tryFindWithRipgrep(workspaceRoot: string, scanRoots: string[], extensions: string[]): string[] | null {
  const args = ['--files', '--color', 'never']

  for (const extension of extensions) {
    args.push('--glob', `*${extension}`)
  }

  args.push('--glob', '!**/node_modules/**', '--glob', '!**/dist/**', '--glob', '!**/build/**')
  args.push(...scanRoots)

  const result = spawnSync('rg', args, {
    cwd: workspaceRoot,
    encoding: 'utf-8',
    maxBuffer: 20 * 1024 * 1024,
  })

  if (result.error || (result.status !== 0 && result.status !== 1)) return null
  if (!result.stdout) return []

  return result.stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(path => resolve(workspaceRoot, path))
    .sort((a, b) => a.localeCompare(b))
}

async function findFilesRecursive(dir: string, extensions: Set<string>): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const absolutePath = resolve(dir, entry.name)

    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        files.push(...(await findFilesRecursive(absolutePath, extensions)))
      }
      continue
    }

    if (entry.isFile() && extensions.has(extname(entry.name))) {
      files.push(absolutePath)
    }
  }

  return files
}
