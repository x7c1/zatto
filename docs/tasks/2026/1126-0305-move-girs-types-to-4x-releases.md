---
status: completed
pipeline_phase: null
plan: null
base_ref: null
perspectives: null
retries_remaining: 1
check_command: "npm run build && npm run check:strict && npm run test:run && for t in .github/scripts/*.test.sh; do bash \"$t\" || exit 1; done && ! grep -qE '\"@girs/[^\"]+\": \"[^\"]*rc\\.[0-9]+\"' package.json && grep -q '\"@girs/gnome-shell\": \"50.0.4\"' package.json && ! grep -qE '\"version\": \"[^\"]*-rc\\.' package-lock.json"
assignee: null
branch: task/1126-0305-move-girs-types-to-4x-releases
created_at: 2026-11-25T18:05:53Z
updated_at: 2026-11-25T18:10:46Z
---

# build(deps): move the @girs type packages from 4.0.0-rc.15 to the 4.x releases

## Overview

zatto targets GNOME Shell 50 (`"shell-version": ["50"]` in
`dist/metadata.json`). Its TypeScript types for the Shell come from the
`@girs/*` packages, which are pinned in `package.json` (`devDependencies` and
`overrides`) at the release candidate `4.0.0-rc.15` (for example
`@girs/clutter-18` `18.0.0-4.0.0-rc.15`, `@girs/gjs` `4.0.0-rc.15`), with
`@girs/gnome-shell` at `50.0.0`. Final 4.x releases exist now: the `@girs/*`
packages publish plain versions up to `4.9.0`, and `@girs/gnome-shell`
`50.0.4` depends on `^4.1.0` of them. The 5.x line of `@girs/*` (and
`@girs/gnome-shell` 51) types GNOME Shell 51; the types must follow the Shell
version the extension targets, or code that calls an API absent from Shell 50
would still compile. So zatto stays on 4.x until it moves to Shell 51.

Make these changes:

1. **Pin the 4.x releases.** In `package.json`, set every `@girs/*` entry of
   `devDependencies` except `@girs/gnome-shell` to `4.9.0`, set
   `@girs/gnome-shell` to `50.0.4`, and set every `@girs/*` entry of
   `overrides` to `4.9.0`. Then run `npm install` to update
   `package-lock.json` (the `@haco-studio` registry is GitHub Packages, read
   through `.npmrc` with `NODE_AUTH_TOKEN`).
2. **Override the licensing client's peers.**
   `@haco-studio/gnome-licensing` `0.1.0-next.1` declares exact peer
   dependencies on the rc.15 versions of `@girs/adw-1`, `@girs/gio-2.0`,
   `@girs/gjs`, `@girs/glib-2.0` and `@girs/gtk-4.0`, so `npm ci` fails with
   `ERESOLVE` once the project is on 4.9.0. Add `@girs/adw-1`,
   `@girs/gtk-4.0` and `@girs/gdk-4.0` to `overrides` at `4.9.0` too (the
   others are already there), so every `@girs/*` package resolves to one
   version. Keep `overrides` sorted by key. A clean `npm ci` must succeed.
   The packages are types only, so this changes nothing at run time.
3. **Fix what the new types reject.** If `tsc --build` reports errors with
   the 4.x types, fix the source so it compiles. A trial migration compiled
   without errors, so none are expected.

## Acceptance criteria

### Automated (pipeline-verified)

- [x] No `@girs/*` entry of `package.json` is a release candidate (`rc.`),
      and `@girs/gnome-shell` is `50.0.4` (grep gates in `check_command`).
- [x] No `@girs/*` package in `package-lock.json` resolves to a release
      candidate version (grep gate in `check_command`).
- [x] The project builds (including `tsc --build`), passes
      `biome check --error-on-warnings`, and the unit tests and the release
      script tests pass (`check_command`).

### Before merge (verified outside the check command)

- [x] `npm ci` from a clean `node_modules` succeeds with the committed
      `package-lock.json`.
- [x] The release bundle is unchanged: `npm run build:release` on this branch
      and on `main` (each from a clean `npm ci`) produce `dist/extension.js`
      and `dist/prefs.js` that are byte-identical except for the
      `buildTimestamp` line. If anything else differs, stop and report the
      diff instead of committing.

## Out of scope

- Moving to the `@girs` 5.x line or GNOME Shell 51.
- Anything under `.github/`, including making Dependabot ignore the `@girs`
  major 5; that is a separate change.
- Changing `@haco-studio/gnome-licensing` or its peer dependencies.
- Other dependency updates (biome, esbuild, vitest).
