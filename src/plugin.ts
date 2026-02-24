import { definePlugin } from '@pandacss/dev'
import type { PandaPlugin } from '@pandacss/types'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { resolveOptions } from './config'
import type { GeneratedStaticExtract, StaticExtractOptions } from './types'
import type { CssRule } from '@pandacss/types'

const EXPECTED_SCHEMA_VERSION = 1

export const staticExtractPlugin = (options: StaticExtractOptions = {}): PandaPlugin =>
  definePlugin({
    name: 'panda-plugin-static-extract',
    hooks: {
      'config:resolved': ({ config, path: configPath }) => {
        const resolvedOptions = resolveOptions(options, dirname(configPath))
        const generatedPath = resolve(dirname(configPath), resolvedOptions.outputPath)

        if (!existsSync(generatedPath)) {
          const message =
            `[panda-static-extract] Generated file not found: ${generatedPath}\n` +
            '  Run: panda-static-extract scan'

          if (resolvedOptions.strict) {
            throw new Error(message)
          }

          console.warn(message)
          return
        }

        let data: GeneratedStaticExtract
        try {
          data = JSON.parse(readFileSync(generatedPath, 'utf-8')) as GeneratedStaticExtract
        } catch (error) {
          if (resolvedOptions.strict) throw error
          console.warn(`[panda-static-extract] Failed to parse generated file: ${generatedPath}`)
          return
        }

        if (data.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
          const message =
            `[panda-static-extract] Unsupported schemaVersion ${data.schemaVersion}. ` +
            `Expected ${EXPECTED_SCHEMA_VERSION}.`
          if (resolvedOptions.strict) throw new Error(message)
          console.warn(message)
          return
        }

        const responsiveProps = data.responsive ?? {}
        const nonResponsiveProps = data.nonResponsive ?? {}
        const existingCss = config.staticCss?.css ?? []
        const autoRules: CssRule[] = []
        const responsiveCount = Object.values(responsiveProps).reduce((sum, values) => sum + values.length, 0)
        const nonResponsiveCount = Object.values(nonResponsiveProps).reduce(
          (sum, values) => sum + values.length,
          0
        )

        if (responsiveCount === 0 && nonResponsiveCount === 0) {
          const message =
            '[panda-static-extract] Generated file contains zero staticCss values. ' +
            'Run scanner before Panda build.'
          if (resolvedOptions.strict) throw new Error(message)
          console.warn(message)
          return
        }

        if (Object.keys(responsiveProps).length > 0) {
          autoRules.push({ responsive: true, properties: responsiveProps })
        }

        if (Object.keys(nonResponsiveProps).length > 0) {
          autoRules.push({ properties: nonResponsiveProps })
        }

        if (autoRules.length === 0) return

        if (resolvedOptions.verbose) {
          console.log(
            `[panda-static-extract] Injecting ${responsiveCount} responsive + ` +
              `${nonResponsiveCount} static values`
          )
        }

        return {
          ...config,
          staticCss: {
            ...config.staticCss,
            css: [...existingCss, ...autoRules],
          },
        }
      },
    },
  })
