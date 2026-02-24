import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { discoverBoundaryComponents } from './discovery'
import { extractFromFile } from './ast-extractor'
import { findSourceFiles } from './file-finder'
import { buildBreakpointSet } from './breakpoints'
import { resolveOptions } from '../config'
import type { GeneratedStaticExtract, ScanResult, StaticExtractOptions } from '../types'

const SCHEMA_VERSION = 1

export async function runExtraction(options: StaticExtractOptions = {}): Promise<ScanResult> {
  const resolved = resolveOptions(options)
  const files = await findSourceFiles(resolved.workspaceRoot, resolved.scanRoots, ['.tsx', '.jsx'])
  const componentMap = await discoverBoundaryComponents(resolved.components)
  const trackedComponents = Object.keys(componentMap).sort()
  const breakpointKeys = [...buildBreakpointSet(resolved.breakpoints)].sort()
  const breakpoints = new Set(breakpointKeys)

  const responsive = new Map<string, Set<string>>()
  const nonResponsive = new Map<string, Set<string>>()

  let filesMatched = 0

  for (const file of files) {
    const result = await extractFromFile(file, componentMap, breakpoints)
    if (!result.matched) continue
    filesMatched += 1

    mergeInto(responsive, result.responsive)
    mergeInto(nonResponsive, result.nonResponsive)
  }

  for (const prop of resolved.unconditionalProperties) {
    nonResponsive.set(prop, nonResponsive.get(prop) ?? new Set())
  }

  const data: GeneratedStaticExtract = {
    schemaVersion: SCHEMA_VERSION,
    generatedBy: 'panda-plugin-static-extract',
    trackedComponents,
    breakpointKeys,
    responsive: mapToObject(responsive),
    nonResponsive: mapToObject(nonResponsive),
  }

  const summary = {
    outputPath: resolve(resolved.workspaceRoot, resolved.outputPath),
    filesScanned: files.length,
    filesMatched,
    responsiveValues: countValues(data.responsive),
    nonResponsiveValues: countValues(data.nonResponsive),
    trackedComponents,
  }

  if (
    resolved.minimumValues > 0 &&
    summary.responsiveValues + summary.nonResponsiveValues < resolved.minimumValues
  ) {
    const message =
      `[panda-static-extract] minimumValues check failed: ` +
      `${summary.responsiveValues + summary.nonResponsiveValues} < ${resolved.minimumValues}`

    if (resolved.strict) throw new Error(message)
    console.warn(message)
  }

  return { data, summary }
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

function mapToObject(map: Map<string, Set<string>>): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [key, values] of map) {
    out[key] = [...values].sort()
  }
  return out
}

function mergeInto(target: Map<string, Set<string>>, source: Record<string, Set<string>>): void {
  for (const [prop, values] of Object.entries(source)) {
    const set = target.get(prop) ?? new Set<string>()
    for (const value of values) set.add(value)
    target.set(prop, set)
  }
}

function countValues(values: Record<string, string[]>): number {
  return Object.values(values).reduce((sum, list) => sum + list.length, 0)
}

