import { describe, expect, it } from 'vitest'
import { detectScanRoots } from '../src/config'

describe('config smoke', () => {
  it('returns fallback scan roots when none exist', () => {
    const roots = detectScanRoots('/tmp/does-not-exist-123')
    expect(roots.length).toBeGreaterThan(0)
  })
})
