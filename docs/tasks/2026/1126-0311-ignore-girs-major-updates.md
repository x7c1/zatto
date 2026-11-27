---
status: completed
pipeline_phase: null
plan: null
base_ref: null
perspectives: null
retries_remaining: 1
check_command: "npm run build && npm run check:strict && npm run test:run && python3 -c \"import yaml,sys; d=yaml.safe_load(open('.github/dependabot.yml')); npm=[u for u in d['updates'] if u['package-ecosystem']=='npm'][0]; sys.exit(0 if any(i.get('dependency-name')=='@girs/*' and i.get('update-types')==['version-update:semver-major'] and 'versions' not in i for i in npm.get('ignore',[])) else 1)\""
assignee: null
branch: task/1126-0311-ignore-girs-major-updates
created_at: 2026-11-25T18:11:22Z
updated_at: 2026-11-25T18:14:39Z
---

# ci(dependabot): ignore major updates of the @girs type packages

## Overview

zatto targets GNOME Shell 50 (`"shell-version": ["50"]` in
`dist/metadata.json`) and takes its TypeScript types for the Shell from the
`@girs/*` packages, on their 4.x line (`@girs/gnome-shell` 50.x). The 5.x line
of `@girs/*`, and `@girs/gnome-shell` 51, type GNOME Shell 51. Types for a
newer Shell than the one the extension targets let code that calls an API
missing from Shell 50 compile, so the `@girs` major has to move together with
`shell-version`, by hand, in the change that moves the extension to the next
Shell. Dependabot keeps proposing the major 5 instead (for example a pull
request bumping `@girs/gdk-4.0` to `5.6.0`).

In `.github/dependabot.yml`, add to the npm entry's `ignore` list a rule

```yaml
- dependency-name: "@girs/*"
  update-types: ["version-update:semver-major"]
```

with a comment, in the style of the existing `@haco-studio/*` rule, saying
that the `@girs` major follows the GNOME Shell version the extension targets
(`shell-version` in `dist/metadata.json`), so a major update is made by hand
together with that change. Use `update-types`, not a `versions` range:
`@girs/gnome-shell` is numbered after the Shell (50.x), so a range such as
`>=5` would ignore every update of it. Minor and patch updates of `@girs/*`
keep arriving in the grouped pull request.

## Acceptance criteria

### Automated (pipeline-verified)

- [x] The npm entry of `.github/dependabot.yml` ignores `@girs/*` for
      `version-update:semver-major` only, with no `versions` range (YAML gate
      in `check_command`).
- [x] The project still builds and its checks and tests pass
      (`check_command`).

## Out of scope

- Changing any `@girs/*` version.
- Any other Dependabot rule or schedule.
