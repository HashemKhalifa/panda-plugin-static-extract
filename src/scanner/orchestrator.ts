import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  addValue,
  countMappedValues,
  createCollected,
  extractPropsFromContent,
  mapToObject,
  mergeCollected,
} from './ast-extractor'
import { buildBreakpointSet, loadArrayLiteralStrings, loadBreakpointsFromFile } from './breakpoints'
import { buildComponentPropMap } from './discovery'
import { containsAnyMarker, createComponentPattern } from './ast-utils'
import { findSourceFilesByPattern, listWorkspaceSourceFiles } from './file-finder'
import { resolveOptions } from '../config'
import type { GeneratedStaticExtract, ScanResult, StaticExtractOptions } from '../types'

const SCHEMA_VERSION = 1

export async function runExtraction(options: StaticExtractOptions = {}): Promise<ScanResult> {
  const startTime = Date.now()
  const resolved = resolveOptions(options)
  const log = resolved.verbose ? (message: string) => console.log(`[panda-static-extract] ${message}`) : () => {}

  const allFiles = await listWorkspaceSourceFiles(
    resolved.workspaceRoot,
    resolved.scanRoots,
    resolved.include,
    resolved.exclude
  )

  const componentMap = await buildComponentPropMap({
    workspaceRoot: resolved.workspaceRoot,
    scanRoots: resolved.scanRoots,
    include: resolved.include,
    exclude: resolved.exclude,
    allFiles,
    patternsDir: resolved.patternsDir,
    manualComponents: resolved.components,
  })

  const trackedComponents = Object.keys(componentMap).sort()
  const trackedSet = new Set(trackedComponents)
  const componentMarkers = trackedComponents.map(name => `<${name}`)
  const componentPattern = createComponentPattern(trackedComponents)

  const candidates = await loadCandidateFiles({
    workspaceRoot: resolved.workspaceRoot,
    scanRoots: resolved.scanRoots,
    include: resolved.include,
    exclude: resolved.exclude,
    allFiles,
    componentPattern,
    componentMarkers,
  })

  const breakpoints = loadBreakpoints(resolved)
  const breakpointKeys = [...breakpoints].sort()

  const collected = createCollected()
  for (const candidate of candidates) {
    const fileCollected = extractPropsFromContent(
      candidate.content,
      componentMap,
      trackedSet,
      breakpoints
    )
    mergeCollected(collected, fileCollected)
  }

  const unconditionalProperties = new Set(resolved.unconditionalProperties)
  injectUnconditionalValues(collected, resolved.unconditionalValues, unconditionalProperties)
  injectColorPalettes(collected, resolved, unconditionalProperties)
  ensureUnconditionalPropertiesExist(collected, unconditionalProperties)

  const data: GeneratedStaticExtract = {
    schemaVersion: SCHEMA_VERSION,
    generatedBy: 'panda-plugin-static-extract',
    trackedComponents,
    breakpointKeys,
    filesScanned: allFiles.length,
    filesMatched: candidates.length,
    unconditionalProperties: [...unconditionalProperties].sort(),
    responsive: mapToObject(collected.responsive),
    nonResponsive: mapToObject(collected.nonResponsive),
  }

  const responsiveValues = countMappedValues(data.responsive)
  const nonResponsiveValues = countMappedValues(data.nonResponsive)
  const totalValues = responsiveValues + nonResponsiveValues

  const summary = {
    outputPath: resolve(resolved.workspaceRoot, resolved.outputPath),
    filesScanned: allFiles.length,
    filesMatched: candidates.length,
    responsiveValues,
    nonResponsiveValues,
    trackedComponents,
    elapsedMs: Date.now() - startTime,
  }

  if (resolved.minimumValues > 0 && totalValues < resolved.minimumValues) {
    const message =
      `[panda-static-extract] minimumValues check failed: ` +
      `${totalValues} < ${resolved.minimumValues}`

    if (resolved.strict) throw new Error(message)
    console.warn(message)
  }

  log(
    `Done in ${summary.elapsedMs}ms — ${summary.responsiveValues} responsive + ` +
      `${summary.nonResponsiveValues} static values from ${summary.filesMatched}/${summary.filesScanned} files`
  )

  return {
    data,
    summary,
    watchState: {
      candidateFiles: new Set(candidates.map(candidate => candidate.path)),
      componentMarkers,
    },
  }
}

export function writeExtractionResult(result: ScanResult): boolean {
  const output = result.summary.outputPath
  const serialized = JSON.stringify(result.data, null, 2) + '\n'

  let changed = true
  if (existsSync(output)) {
    try {
      changed = readFileSync(output, 'utf-8') !== serialized
    } catch {
      changed = true
    }
  }

  if (!changed) return false

  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, serialized)
  return true
}

interface CandidateFile {
  path: string
  content: string
}

async function loadCandidateFiles(params: {
  workspaceRoot: string
  scanRoots: string[]
  include: string[]
  exclude: string[]
  allFiles: string[]
  componentPattern: RegExp | null
  componentMarkers: string[]
}): Promise<CandidateFile[]> {
  const componentPattern = params.componentPattern
  if (!componentPattern || params.componentMarkers.length === 0) return []

  const candidatePathsFromRg = findSourceFilesByPattern(
    params.workspaceRoot,
    params.scanRoots,
    params.componentMarkers,
    {
      fixed: true,
      include: params.include,
      exclude: params.exclude,
    }
  )

  const candidatePaths = candidatePathsFromRg ?? params.allFiles
  const candidates: CandidateFile[] = []

  await Promise.all(
    candidatePaths.map(async filePath => {
      let content: string
      try {
        content = await readFile(filePath, 'utf-8')
      } catch {
        return
      }

      if (candidatePathsFromRg || containsAnyMarker(content, params.componentMarkers)) {
        candidates.push({ path: filePath, content })
      } else if (componentPattern.test(content)) {
        candidates.push({ path: filePath, content })
      }
    })
  )

  candidates.sort((a, b) => a.path.localeCompare(b.path))
  return candidates
}

function loadBreakpoints(resolved: ReturnType<typeof resolveOptions>): Set<string> {
  let names = resolved.breakpoints

  if (resolved.breakpointsFile) {
    try {
      names = loadBreakpointsFromFile(resolved.breakpointsFile, resolved.breakpointsVariable)
    } catch (error) {
      if (resolved.strict) throw error
      console.warn(
        `[panda-static-extract] Failed to load breakpoints from ${resolved.breakpointsFile}. ` +
          `Using configured defaults.`
      )
    }
  }

  return buildBreakpointSet(names)
}

function injectUnconditionalValues(
  collected: ReturnType<typeof createCollected>,
  unconditionalValues: Record<string, Array<string | number>>,
  unconditionalProperties: Set<string>
): void {
  for (const [property, values] of Object.entries(unconditionalValues)) {
    unconditionalProperties.add(property)
    for (const value of values) addValue(collected.nonResponsive, property, value)
  }
}

function injectColorPalettes(
  collected: ReturnType<typeof createCollected>,
  resolved: ReturnType<typeof resolveOptions>,
  unconditionalProperties: Set<string>
): void {
  if (!resolved.colorPaletteFile) return

  try {
    const palettes = loadArrayLiteralStrings(resolved.colorPaletteFile, resolved.colorPaletteVariable)
    if (palettes.length === 0) return
    unconditionalProperties.add('colorPalette')
    for (const palette of palettes) addValue(collected.nonResponsive, 'colorPalette', palette)
  } catch (error) {
    if (resolved.strict) throw error
    console.warn(
      `[panda-static-extract] Failed to load color palettes from ${resolved.colorPaletteFile}.`
    )
  }
}

function ensureUnconditionalPropertiesExist(
  collected: ReturnType<typeof createCollected>,
  unconditionalProperties: Set<string>
): void {
  for (const property of unconditionalProperties) {
    if (!collected.nonResponsive.has(property)) {
      collected.nonResponsive.set(property, new Set())
    }
  }
}
