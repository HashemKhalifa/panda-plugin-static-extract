#!/usr/bin/env node
import { existsSync, readFileSync, watch as fsWatch } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { resolveOptions } from '../config'
import { runExtraction, writeExtractionResult } from '../scanner'
import { containsAnyMarker } from '../scanner/ast-utils'
import { findSourceFilesByPattern, shouldTriggerOnFile } from '../scanner/file-finder'
import type { GeneratedStaticExtract } from '../types'
import type { StaticExtractOptions } from '../types'

interface CliArgs {
  command: 'scan' | 'audit' | 'watch' | 'help'
  options: StaticExtractOptions
  skipInitial: boolean
}

function parseArgs(argv: string[]): CliArgs {
  const [command = 'scan', ...flags] = argv
  const options: StaticExtractOptions = {}
  let skipInitial = false

  for (let i = 0; i < flags.length; i += 1) {
    const flag = flags[i]
    const next = flags[i + 1]

    switch (flag) {
      case '--help':
      case '-h':
        return { command: 'help', options, skipInitial }
      case '--verbose':
        options.verbose = true
        break
      case '--strict':
        options.strict = true
        break
      case '--no-strict':
        options.strict = false
        break
      case '--poll':
        options.poll = true
        break
      case '--output':
        if (next) {
          options.outputPath = next
          i += 1
        }
        break
      case '--debounce':
        if (next) {
          options.debounceMs = Number(next)
          i += 1
        }
        break
      case '--workspace-root':
        if (next) {
          options.workspaceRoot = next
          i += 1
        }
        break
      case '--scan-root':
        if (next) {
          options.scanRoots = [...(options.scanRoots ?? []), next]
          i += 1
        }
        break
      case '--minimum-values':
        if (next) {
          options.minimumValues = Number(next)
          i += 1
        }
        break
      case '--skip-initial':
        skipInitial = true
        break
      default:
        break
    }
  }

  if (command !== 'scan' && command !== 'audit' && command !== 'watch') {
    return { command: 'help', options, skipInitial }
  }

  return { command, options, skipInitial }
}

async function executeScan(options: StaticExtractOptions, write = true): Promise<void> {
  const result = await runExtraction(options)
  const changed = write ? writeExtractionResult(result) : false

  const suffix = write ? (changed ? 'wrote file' : 'no changes') : 'dry run'
  console.log(
    `[panda-static-extract] scanned ${result.summary.filesMatched}/${result.summary.filesScanned} files, ` +
      `${result.summary.responsiveValues} responsive + ${result.summary.nonResponsiveValues} static (${suffix})`
  )
  if (write) {
    console.log(`[panda-static-extract] output: ${result.summary.outputPath}`)
  }
}

async function executeWatch(options: StaticExtractOptions, skipInitial = false): Promise<void> {
  const resolved = resolveOptions(options)
  console.log(`[panda-static-extract] watch mode enabled (debounce: ${resolved.debounceMs}ms)`)

  let watchState: {
    candidateFiles: Set<string>
    componentMarkers: string[]
  }

  if (skipInitial && existsSync(resolve(resolved.workspaceRoot, resolved.outputPath))) {
    watchState = loadWatchStateFromOutput(options)
    console.log(
      `[panda-static-extract] skipping initial scan (baseline: ${watchState.candidateFiles.size} candidates)`
    )
  } else {
    const initial = await runExtraction(options)
    writeExtractionResult(initial)
    watchState = initial.watchState
  }

  let timer: NodeJS.Timeout | null = null
  let running = false
  let queued = false

  const run = async () => {
    if (running) {
      queued = true
      return
    }

    running = true
    try {
      const result = await runExtraction(options)
      writeExtractionResult(result)
      watchState = result.watchState
      console.log(
        `[panda-static-extract] scanned ${result.summary.filesMatched}/${result.summary.filesScanned} files, ` +
          `${result.summary.responsiveValues} responsive + ${result.summary.nonResponsiveValues} static (watch)`
      )
    } catch (error) {
      console.error('[panda-static-extract] watch scan failed:', error)
    } finally {
      running = false
      if (queued) {
        queued = false
        void run()
      }
    }
  }

  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void run(), resolved.debounceMs)
  }

  const watchers = resolved.scanRoots.map(root =>
    fsWatch(resolve(resolved.workspaceRoot, root), { recursive: !resolved.poll }, (_, filename) => {
      const relativePath = String(filename ?? '')
      const filePath = filename ? resolve(resolved.workspaceRoot, root, relativePath) : ''
      if (!shouldTriggerOnFile(filePath || relativePath)) return

      const extension = extname(filePath)
      if (extension !== '.tsx' && extension !== '.jsx') {
        schedule()
        return
      }

      if (watchState.candidateFiles.has(filePath)) {
        schedule()
        return
      }

      void readFile(filePath, 'utf-8')
        .then(content => {
          if (containsAnyMarker(content, watchState.componentMarkers)) schedule()
        })
        .catch(() => {
          if (watchState.candidateFiles.has(filePath)) schedule()
        })
    })
  )

  const cleanup = () => {
    if (timer) clearTimeout(timer)
    for (const watcher of watchers) watcher.close()
    process.exit(0)
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
}

async function main(): Promise<void> {
  const { command, options, skipInitial } = parseArgs(process.argv.slice(2))

  if (command === 'scan') return executeScan(options, true)
  if (command === 'audit') return executeScan(options, false)
  if (command === 'watch') return executeWatch(options, skipInitial)

  printHelp()
  process.exit(0)
}

main().catch(error => {
  console.error('[panda-static-extract] Fatal:', error)
  process.exit(1)
})

function loadWatchStateFromOutput(options: StaticExtractOptions): {
  candidateFiles: Set<string>
  componentMarkers: string[]
} {
  const resolved = resolveOptions(options)
  const generatedPath = resolve(resolved.workspaceRoot, resolved.outputPath)

  try {
    const parsed = JSON.parse(readFileSync(generatedPath, 'utf-8')) as GeneratedStaticExtract
    const trackedComponents = Array.isArray(parsed.trackedComponents) ? parsed.trackedComponents : []
    const componentMarkers = trackedComponents.map(name => `<${name}`)

    const candidateFiles = componentMarkers.length
      ? new Set(
          findSourceFilesByPattern(
            resolved.workspaceRoot,
            resolved.scanRoots,
            componentMarkers,
            {
              fixed: true,
              include: resolved.include,
              exclude: resolved.exclude,
            }
          ) ?? []
        )
      : new Set<string>()

    return { candidateFiles, componentMarkers }
  } catch {
    return { candidateFiles: new Set<string>(), componentMarkers: [] }
  }
}

function printHelp(): void {
  console.log(
    [
      'Usage: panda-static-extract <command> [options]',
      '',
      'Commands:',
      '  scan                  Run extraction and write output file',
      '  audit                 Run extraction without writing',
      '  watch                 Watch for file changes and re-run extraction',
      '',
      'Options:',
      '  --output <path>       Output path (default: .panda/static-extract.json)',
      '  --workspace-root <p>  Explicit workspace root',
      '  --scan-root <path>    Add scan root (repeatable)',
      '  --minimum-values <n>  Safety threshold for extracted values',
      '  --debounce <ms>       Watch debounce (default: 300)',
      '  --poll                Disable recursive watch mode',
      '  --strict              Enable strict mode',
      '  --no-strict           Disable strict mode',
      '  --verbose             Verbose logs',
      '  --skip-initial        Watch: skip initial scan if output exists',
      '',
    ].join('\n')
  )
}
