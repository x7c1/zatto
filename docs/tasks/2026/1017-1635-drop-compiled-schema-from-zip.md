---
status: completed
pipeline_phase: null
plan: null
base_ref: null
perspectives: null
max_refine_rounds: 3
retries_remaining: 1
check_command: "npm run build && npm run check:strict && npm run test:run && for t in .github/scripts/*.test.sh; do bash \"$t\" || exit 1; done && ! grep -q 'schemas/gschemas.compiled; do' .github/scripts/package-extension.test.sh"
assignee: null
branch: task/1017-1635-drop-compiled-schema-from-zip
created_at: 2026-10-17T16:35:00Z
updated_at: 2026-10-17T16:58:36Z
---

# fix(release): leave the compiled GSettings schema out of the release zip

## Overview

The release zip built by `.github/scripts/package-extension.sh` packs
everything in `dist/`, including `schemas/gschemas.compiled`, which the
build produces with `glib-compile-schemas`. The extension supports only
GNOME Shell 50 (`shell-version` in `metadata.json`). Since GNOME 44,
`gnome-extensions install` and extensions.gnome.org compile an
extension's schemas on install, so the compiled file in the zip is never
used, and the extensions.gnome.org review guidelines ask extensions that
support only 44 and later not to ship it. The installation guide
(`docs/guides/installation.md`) installs with `gnome-extensions install`.

Leave `schemas/gschemas.compiled` out of the zip, keeping the schema XML.
Keep compiling the schema in the build: it validates the schema
(`--strict`) and the development loop (`npm run dev`) copies `dist/`
into the extensions directory, where the compiled file is needed.

Update `.github/scripts/package-extension.test.sh` so that it asserts the
zip contains the schema XML and does not contain
`schemas/gschemas.compiled`, and update any documentation that says the
zip carries the compiled schema (for example `docs/guides/release.md`).

## Acceptance criteria

### Automated (pipeline-verified)

- [x] `package-extension.test.sh` builds a release zip and asserts it
      contains `metadata.json`, `extension.js`, `prefs.js` and the
      schema XML, and does not contain `schemas/gschemas.compiled`
      (the test runs in `check_command`; a gate checks the old assertion
      list is gone).
- [x] The build still compiles the schema with `--strict`.
