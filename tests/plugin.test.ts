import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { staticExtractPlugin } from '../src/plugin'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('plugin', () => {
  it('injects generated rules into staticCss', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'pse-plugin-'))
    tempDirs.push(workspaceRoot)

    await mkdir(resolve(workspaceRoot, '.panda'), { recursive: true })
    await writeFile(
      resolve(workspaceRoot, '.panda/static-extract.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          generatedBy: 'panda-plugin-static-extract',
          trackedComponents: ['FlexBox'],
          breakpointKeys: ['base', 'md'],
          filesScanned: 10,
          filesMatched: 2,
          unconditionalProperties: ['colorPalette'],
          responsive: { gap: ['sm', 'lg'] },
          nonResponsive: { colorPalette: ['brand', 'neutral'] },
        },
        null,
        2
      )
    )

    const plugin = staticExtractPlugin({
      workspaceRoot,
      strict: true,
      outputPath: '.panda/static-extract.json',
    }) as unknown as {
      hooks?: {
        'config:resolved'?: (args: { config: Record<string, unknown>; path: string }) => unknown
      }
    }

    const hook = plugin.hooks?.['config:resolved']
    expect(hook).toBeTypeOf('function')

    const updated = hook?.({
      config: {
        staticCss: {
          css: [{ properties: { display: ['flex'] } }],
        },
      },
      path: resolve(workspaceRoot, 'panda.config.ts'),
    }) as {
      staticCss: {
        css: Array<Record<string, unknown>>
      }
    }

    expect(updated.staticCss.css).toHaveLength(3)
    expect(updated.staticCss.css[1]).toEqual({
      responsive: true,
      properties: { gap: ['sm', 'lg'] },
    })
    expect(updated.staticCss.css[2]).toEqual({
      properties: { colorPalette: ['brand', 'neutral'] },
    })
  })
})
