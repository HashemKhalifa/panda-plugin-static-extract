import { describe, expect, it } from 'vitest'
import { extractPropsFromContent } from '../src/scanner/ast-extractor'
import { buildBreakpointSet } from '../src/scanner/breakpoints'

describe('ast extractor', () => {
  it('extracts literals, conditionals, identifiers, and useMemo responsive values', () => {
    const code = `
      import { useMemo } from 'react'
      const dynamicOrder = -2
      const getGap = () => (isLarge ? 'lg' : 'sm')
      export const Demo = () => {
        const memoFlex = useMemo(() => ({ base: 'none', md: '1 0 auto' }), [])
        return (
          <>
            <FlexBox gap={{ base: 'sm', md: 'lg' }} order={dynamicOrder} flex={memoFlex} />
            <FlexBox gap={getGap()} />
            <FlexBox flex={\`1 1 auto\`} />
          </>
        )
      }
    `

    const componentMap = {
      FlexBox: {
        gap: 'gap',
        order: 'order',
        flex: 'flex',
      },
    }

    const collected = extractPropsFromContent(
      code,
      componentMap,
      new Set(['FlexBox']),
      buildBreakpointSet(['sm', 'md', 'lg'])
    )

    expect([...collected.responsive.get('gap') ?? []]).toEqual(['sm', 'lg'])
    expect([...collected.responsive.get('flex') ?? []]).toEqual(['none', '1 0 auto'])
    expect([...collected.nonResponsive.get('order') ?? []]).toEqual(['-2'])
    expect(new Set(collected.nonResponsive.get('gap'))).toEqual(new Set(['sm', 'lg']))
    expect([...collected.nonResponsive.get('flex') ?? []]).toEqual(['1 1 auto'])
  })
})
