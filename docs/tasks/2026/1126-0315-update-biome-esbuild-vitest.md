---
status: completed
pipeline_phase: null
plan: null
base_ref: null
perspectives: null
retries_remaining: 1
check_command: "npm run build && npm run check:strict && npm run test:run && for t in .github/scripts/*.test.sh; do bash \"$t\" || exit 1; done && grep -q '\"esbuild\": \"^0.28' package.json && grep -q '\"@biomejs/biome\": \"^2.6' package.json && grep -q 'biomejs.dev/schemas/2.6' biome.json && grep -q '\"preset\": \"recommended\"' biome.json && node -e \"const v=require('./package-lock.json').packages['node_modules/esbuild'].version;process.exit(/^0\\.28\\./.test(v)?0:1)\""
assignee: null
branch: task/1126-0315-update-biome-esbuild-vitest
created_at: 2026-11-25T18:15:13Z
updated_at: 2026-11-25T18:18:01Z
---

# build(deps-dev): update biome to 2.6, esbuild to 0.28 and vitest to 5.1

## Overview

The dev tools are behind: `@biomejs/biome` resolves to 2.5.0, `esbuild` to
0.27.7 (`"esbuild": "^0.27.0"` in `package.json`), and `vitest` to 5.1.0.
Updating them as they arrive does not pass the checks as is, because biome 2.6
formats four test files differently and wants its configuration migrated.

Make these changes:

1. **Update the packages.** Set `@biomejs/biome` to `^2.6.9`, `esbuild` to
   `^0.28.2` and `vitest` to `^5.1.2` in `devDependencies`, and update
   `package-lock.json` with `npm install` (the `@haco-studio` registry is
   GitHub Packages, read through `.npmrc` with `NODE_AUTH_TOKEN`).
2. **Migrate the biome configuration.** Run `npx biome migrate --write`: it
   moves `$schema` in `biome.json` to the 2.6 schema and replaces the
   deprecated `"recommended": true` under `linter.rules` with
   `"preset": "recommended"`. Change nothing else in `biome.json`.
3. **Reformat with biome 2.6.** Run `npx biome format --write src`. The
   expected changes are formatting only, in
   `src/prefs/hot-corners-description.test.ts`,
   `src/prefs/license-page.test.ts`,
   `src/ui/overlay/transient-attachment.test.ts` and
   `src/ui/top-bar-indicator/menu-model.test.ts`. Do not change what any test
   asserts.

esbuild 0.28's breaking change is limited to an integrity check of the
binary it downloads at install time; the options `esbuild.config.js` uses are
unchanged. The shipped bundle must not change: the extension runs inside
GNOME Shell, where a difference could only be checked on a live session.

## Acceptance criteria

### Automated (pipeline-verified)

- [x] `package.json` asks for `esbuild` `^0.28` and `@biomejs/biome` `^2.6`,
      and `package-lock.json` resolves esbuild 0.28.x (gates in
      `check_command`).
- [x] `biome.json` points at the 2.6 schema and uses
      `"preset": "recommended"` (grep gates in `check_command`).
- [x] The project builds, passes `biome check --error-on-warnings`, and the
      unit tests and the release script tests pass (`check_command`).

### Before merge (verified outside the check command)

- [x] `npm ci` from a clean `node_modules` succeeds with the committed
      `package-lock.json`.
- [x] The release bundle is unchanged: `npm run build:release` on this branch
      and on `main` (each from a clean `npm ci`, both in clones where `git`
      works so `commitSha` is filled the same way) produce `dist/extension.js`
      and `dist/prefs.js` that are byte-identical except for the
      `buildTimestamp` and `commitSha` lines. If anything else differs, stop
      and report the diff instead of committing.

## Out of scope

- The `@girs/*` type packages and anything under `.github/`.
- Source changes other than the formatting biome 2.6 asks for.
