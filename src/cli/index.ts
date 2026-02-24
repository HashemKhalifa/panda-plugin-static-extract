#!/usr/bin/env node
import { watch as fsWatch } from 'node:fs'
import { resolve } from 'node:path'
import { resolveOptions } from '../config'
import { runExtraction, writeExtractionResult } from '../scanner'
import type { StaticExtractOptions } from '../types'

function parseArgs(argv: string[]): { command: string; options: StaticExtractOptions } {
  const [command = 'scan', ...flags] = argv
  const options: StaticExtractOptions = {}

  for (let i = 0; i < flags.length; i += 1) {
    const flag = flags[i]
    if (flag === '--verbose') options.verbose = true
    if (flag === '--strict') options.strict = true
    if (flag === '--poll') options.poll = true
    if (flag === '--output') options.outputPath = flags[i + 1]
    if (flag === '--debounce') options.debounceMs = Number(flags[i + 1])
  }

  return { command, options }
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

async function executeWatch(options: StaticExtractOptions): Promise<void> {
  const resolved = resolveOptions(options)
  console.log(`[panda-static-extract] watch mode enabled (debounce: ${resolved.debounceMs}ms)`)

  await executeScan(options, true)

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
      await executeScan(options, true)
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
    fsWatch(resolve(resolved.workspaceRoot, root), { recursive: !resolved.poll }, () => {
      schedule()
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
  const { command, options } = parseArgs(process.argv.slice(2))

  if (command === 'scan') return executeScan(options, true)
  if (command === 'audit') return executeScan(options, false)
  if (command === 'watch') return executeWatch(options)

  console.error('[panda-static-extract] Unknown command. Use: scan | audit | watch')
  process.exit(1)
}

main().catch(error => {
  console.error('[panda-static-extract] Fatal:', error)
  process.exit(1)
})
