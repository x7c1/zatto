---
status: completed
pipeline_phase: null
plan: null
base_ref: null
perspectives: [completeness, clarity]
max_refine_rounds: 3
retries_remaining: 1
check_command: "npm run build && npm run check:strict && npm run test:run && [ \"$(jq -r '.overrides[\"@girs/pango-1.0\"]' package.json)\" = '1.57.1-4.0.0-rc.15' ] && [ \"$(jq -r '.packages[\"node_modules/@girs/pango-1.0\"].version' package-lock.json)\" = '1.57.1-4.0.0-rc.15' ]"
assignee: null
branch: task/1016-2355-pin-pango-typings
created_at: 2026-10-16T14:54:12Z
updated_at: 2026-10-16T15:39:22Z
---

# build(deps): pin @girs/pango-1.0 through overrides like the other GIR typings

## Overview

The cycle strip imports `gi://Pango`, so the build type-checks against
`@girs/pango-1.0`. That package is neither a direct dependency nor listed
in `package.json`'s `overrides`, unlike the other `@girs/*` typings
pulled in transitively (`@girs/cogl-2.0`, `@girs/glib-2.0`, ...). It is
held at `1.57.1-4.0.0-rc.15` only by the current `package-lock.json`
hoist, so regenerating the lockfile could pick a different version that
no longer matches the rest of the `rc.15` set.

Add `"@girs/pango-1.0": "1.57.1-4.0.0-rc.15"` to `overrides`, keeping the
list's existing order convention, and refresh `package-lock.json` with
`npm install` so the lockfile records the override. The resolved version
must stay `1.57.1-4.0.0-rc.15`; no other package version may change
(compare `package-lock.json` before and after).

## Acceptance criteria

### Automated (pipeline-verified)

- [x] `package.json`'s `overrides` pins `@girs/pango-1.0` to
      `1.57.1-4.0.0-rc.15`, and `package-lock.json` still resolves it to
      that version (gates in `check_command`).
