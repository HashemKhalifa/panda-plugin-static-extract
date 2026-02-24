# panda-plugin-static-extract

Auto-generate Panda CSS `staticCss` values by scanning component-boundary usage (like wrappers using `.raw()`), then inject them at Panda `config:resolved` time.

## Why this exists

Panda can miss values across component boundaries. Example: a wrapper component calls `flex.raw({ ...props })` internally, and consumers pass dynamic/conditional/responsive JSX props. This plugin adds a pre-scan that resolves those values before Panda CSS generation.

## What it does

1. Discovers boundary components automatically by finding `.raw()` calls.
2. Reads pattern definitions (`definePattern`) to map component props to CSS properties.
3. Scans consumers (`.tsx/.jsx`) with SWC and extracts supported values:
   - literals
   - negative numbers
   - ternaries
   - responsive objects (`{ base, md, ... }` and ranges)
   - identifier indirection
   - local helper functions
   - `useMemo(() => ...)`
4. Injects unconditional token sets (for example `colorPalette`) from source of truth files.
5. Writes deterministic JSON output (write-on-change only).
6. Panda plugin reads JSON and injects generated rules into `staticCss.css`.

## Install

```bash
pnpm add -D panda-plugin-static-extract
```

## Quick start

### 1) Add plugin in `panda.config.ts`

```ts
import { defineConfig } from '@pandacss/dev'
import { staticExtractPlugin } from 'panda-plugin-static-extract'

export default defineConfig({
  plugins: [staticExtractPlugin()],
})
```

### 2) Add scanner step before `panda cssgen`

```bash
panda-static-extract scan
panda cssgen
```

For Nx/Turbo, wire `scan` as a dependency of CSS generation.

## CLI

```bash
panda-static-extract scan
panda-static-extract audit
panda-static-extract watch
```

Common flags:

- `--output <path>`
- `--workspace-root <path>`
- `--scan-root <path>` (repeatable)
- `--minimum-values <n>`
- `--strict` / `--no-strict`
- `--verbose`
- `--debounce <ms>` (default `300`)
- `--poll` (watch fallback mode)
- `--skip-initial` (watch mode)

## Watch behavior

- Debounce is built in and defaults to `300ms`.
- Re-runs are queued (no overlapping scans).
- Fast-path trigger:
  - if changed file is an already-known consumer, rescan immediately
  - else check if changed source now contains tracked component markers
- Non-TSX changes to relevant sources (patterns/color palette) also trigger scan.

## Config

```ts
staticExtractPlugin({
  scanRoots: ['libs', 'apps'],
  outputPath: '.panda/static-extract.json',
  minimumValues: 5,
  strict: true,
  verbose: false,
})
```

Auto-detection defaults:

- workspace root markers: `pnpm-workspace.yaml`, `nx.json`, `turbo.json`, `lerna.json`, `.git`
- scan roots: `libs/apps`, then `packages/apps`, then `packages`, then `src`
- breakpoints file candidates:
  - `src/presets/breakpoints.ts`
  - `src/theme/breakpoints.ts`
  - `src/breakpoints.ts`
- color palette file candidates:
  - `src/presets/themes/colorPalette/colorPalette.ts`
  - `src/theme/colorPalette.ts`
  - `src/colorPalette.ts`

## Output format

Generated JSON example:

```json
{
  "schemaVersion": 1,
  "generatedBy": "panda-plugin-static-extract",
  "trackedComponents": ["FlexBox", "FlexItem"],
  "breakpointKeys": ["base", "md", "sm", "smToMd"],
  "filesScanned": 1909,
  "filesMatched": 853,
  "unconditionalProperties": ["colorPalette"],
  "responsive": { "gap": ["sm", "lg"] },
  "nonResponsive": { "colorPalette": ["brand", "neutral"] }
}
```

## Benchmark snapshot

Manual staticCss vs auto-extraction (same include paths; only staticCss strategy changed):

| Metric | Manual staticCss | Auto extraction |
| --- | --- | --- |
| CSS size | 732KB | 171KB |
| CSS lines | 24,853 | 3,874 |
| Cold build time | 26.7s | 11.2s |
| Panda extraction stage | 2353ms | 141ms |

Main gain came from removing wildcard over-generation and generating only observed values.

## Current status

Implemented end-to-end:

- scanner modules fully implemented
- plugin injection with schema checks
- CLI `scan/audit/watch`
- deterministic write behavior
- integration tests for scanner and plugin

Validation:

- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

## CI and release

GitHub Actions workflows included:

- `CI`: `.github/workflows/ci.yml`
- `Release`: `.github/workflows/release.yml`

Release strategy uses `semantic-release` on `main`:

1. analyze conventional commits
2. compute next semver version
3. update `CHANGELOG.md`
4. publish to npm with provenance
5. create GitHub release and tag

Required repository secret:

- `NPM_TOKEN`

## Commit format for releases

Use conventional commits so `semantic-release` can decide the next version:

- `fix: ...` => patch
- `feat: ...` => minor
- `feat!: ...` or `BREAKING CHANGE:` => major

## Local release dry run

```bash
pnpm run verify
pnpm run release -- --dry-run
```
