export interface StaticExtractOptions {
  scanRoots?: string[]
  include?: string[]
  exclude?: string[]
  components?: Record<string, Record<string, string>>
  unconditionalProperties?: string[]
  unconditionalValues?: Record<string, Array<string | number>>
  outputPath?: string
  minimumValues?: number
  strict?: boolean
  verbose?: boolean
  breakpoints?: string[]
  breakpointsFile?: string
  breakpointsVariable?: string
  patternsDir?: string
  colorPaletteFile?: string
  colorPaletteVariable?: string
  debounceMs?: number
  poll?: boolean
  workspaceRoot?: string
}

export interface GeneratedStaticExtract {
  schemaVersion: number
  generatedBy: string
  trackedComponents: string[]
  breakpointKeys: string[]
  filesScanned: number
  filesMatched: number
  unconditionalProperties: string[]
  responsive: Record<string, string[]>
  nonResponsive: Record<string, string[]>
}

export interface ScanSummary {
  outputPath: string
  filesScanned: number
  filesMatched: number
  responsiveValues: number
  nonResponsiveValues: number
  trackedComponents: string[]
  elapsedMs: number
}

export interface ScanResult {
  data: GeneratedStaticExtract
  summary: ScanSummary
  watchState: {
    candidateFiles: Set<string>
    componentMarkers: string[]
  }
}
