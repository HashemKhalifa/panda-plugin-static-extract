export interface StaticExtractOptions {
  scanRoots?: string[]
  include?: string[]
  exclude?: string[]
  components?: Record<string, Record<string, string>>
  unconditionalProperties?: string[]
  outputPath?: string
  minimumValues?: number
  strict?: boolean
  verbose?: boolean
  breakpoints?: string[]
  debounceMs?: number
  poll?: boolean
  workspaceRoot?: string
}

export interface GeneratedStaticExtract {
  schemaVersion: number
  generatedBy: string
  trackedComponents: string[]
  breakpointKeys: string[]
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
}

export interface ScanResult {
  data: GeneratedStaticExtract
  summary: ScanSummary
}
