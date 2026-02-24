# Release Guide

## Overview

This repository uses `semantic-release` with conventional commits.

Release pipeline:

1. run verification (`pnpm run verify`)
2. analyze commit history
3. compute semver bump
4. generate release notes + update `CHANGELOG.md`
5. publish npm package
6. create GitHub release/tag

## Required configuration

1. GitHub Actions secret: `NPM_TOKEN`
2. Default `GITHUB_TOKEN` is used automatically in workflow
3. Workflow file: `.github/workflows/release.yml`
4. Semantic config: `.releaserc.json`

## Commit rules

Use conventional commits:

1. `fix: ...` for patch releases
2. `feat: ...` for minor releases
3. `feat!: ...` or footer `BREAKING CHANGE:` for major releases

## Manual dry run

```bash
pnpm run verify
pnpm run release -- --dry-run
```
