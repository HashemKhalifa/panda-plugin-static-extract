import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runExtraction, writeExtractionResult } from '../src/scanner'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('scanner integration', () => {
  it('discovers raw boundary components and writes deterministic output', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'pse-'))
    tempDirs.push(workspaceRoot)

    await mkdir(resolve(workspaceRoot, 'src/patterns'), { recursive: true })
    await mkdir(resolve(workspaceRoot, 'src/presets/mms-preset-base'), { recursive: true })
    await mkdir(resolve(workspaceRoot, 'src/presets/themes/colorPalette'), { recursive: true })
    await mkdir(resolve(workspaceRoot, 'libs/ui/src/components'), { recursive: true })
    await mkdir(resolve(workspaceRoot, 'apps/web/src'), { recursive: true })

    await writeFile(resolve(workspaceRoot, 'nx.json'), '{}\n')

    await writeFile(
      resolve(workspaceRoot, 'src/patterns/flex.ts'),
      `
      import { definePattern } from '@pandacss/dev'
      export const flex = definePattern({
        properties: {
          gap: {},
          order: {},
          alignItems: { property: 'alignItems' }
        }
      })
      `
    )

    await writeFile(
      resolve(workspaceRoot, 'src/presets/mms-preset-base/breakpoints.ts'),
      `
      export const breakpoints = {
        sm: '640px',
        md: '768px',
        lg: '1024px',
      }
      `
    )

    await writeFile(
      resolve(workspaceRoot, 'src/presets/themes/colorPalette/colorPalette.ts'),
      `
      export const colorPalette = ['brand', 'neutral']
      `
    )

    await writeFile(
      resolve(workspaceRoot, 'libs/ui/src/components/FlexBox.tsx'),
      `
      import { flex } from '../../../../src/patterns/flex'

      export const FlexBox = ({ gap, order, align }: { gap?: string; order?: number; align?: string }) =>
        flex.raw({ gap, order, alignItems: align })
      `
    )

    await writeFile(
      resolve(workspaceRoot, 'apps/web/src/App.tsx'),
      `
      import { FlexBox } from '../../../libs/ui/src/components/FlexBox'

      export const App = () => (
        <FlexBox gap={{ base: 'sm', md: 'lg' }} order={-1} align="center" />
      )
      `
    )

    const result = await runExtraction({
      workspaceRoot,
      outputPath: '.panda/static-extract.json',
      strict: true,
      minimumValues: 1,
    })

    expect(result.data.trackedComponents).toEqual(['FlexBox'])
    expect(new Set(result.data.responsive.gap)).toEqual(new Set(['sm', 'lg']))
    expect(result.data.nonResponsive.order).toEqual(['-1'])
    expect(result.data.nonResponsive.alignItems).toEqual(['center'])
    expect(result.data.nonResponsive.colorPalette).toEqual(['brand', 'neutral'])

    const firstWrite = writeExtractionResult(result)
    expect(firstWrite).toBe(true)
    const secondWrite = writeExtractionResult(result)
    expect(secondWrite).toBe(false)
  })
})
