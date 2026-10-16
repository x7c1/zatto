---
status: completed
pipeline_phase: null
plan: null
base_ref: null
perspectives: [completeness, clarity, user-experience]
max_refine_rounds: 3
retries_remaining: 1
check_command: "npm run build && npm run check:strict && npm run test:run && for t in .github/scripts/*.test.sh; do bash \"$t\" || exit 1; done && test -f dist/schemas/org.gnome.shell.extensions.zatto.gschema.xml && glib-compile-schemas --strict --dry-run dist/schemas/ && [ \"$(jq -r '.\"settings-schema\"' dist/metadata.json)\" = org.gnome.shell.extensions.zatto ] && test -f dist/prefs.js && grep -q 'hot-corners' dist/schemas/org.gnome.shell.extensions.zatto.gschema.xml && ! grep -rq 'ACTIVE_HOT_CORNERS' src/ && git check-ignore -q dist/schemas/gschemas.compiled && ! git check-ignore -q dist/schemas/org.gnome.shell.extensions.zatto.gschema.xml"
assignee: null
branch: task/1017-0048-preferences-hot-corners
created_at: 2026-10-16T15:48:35Z
updated_at: 2026-10-16T16:48:50Z
---

# feat(prefs): add a preferences page to choose which corners open the depth view

## Overview

zatto has no settings: the corners that open the depth view are a constant,
`ACTIVE_HOT_CORNERS = ['bottom-left', 'bottom-right']` in `src/extension.ts`,
passed to `HotCornerTrigger` (`src/ui/overlay/hot-corner-trigger.ts`), which
already takes a corner list and installs one actor per corner. This task
adds the extension's first GSettings key and a preferences window, so the
user picks the corners themselves, and the change applies without logging
out or reloading the extension.

The sibling extension x7c1/sutto (public, same author, same GNOME Shell 50
target) already has this setup; read its sources and follow its approach
where it fits: `src/prefs.ts`, `src/prefs/`, `src/infra/glib/preferences-repository.ts`
(loading the schema in the extension, including when the development
reloader runs a copy under `/tmp/<uuid>/`), `esbuild.config.js` (bundling
`prefs.js` and running `glib-compile-schemas`), `.gitignore` (keeping
`dist/schemas/*.gschema.xml` tracked and `gschemas.compiled` ignored), and
`dist/metadata.json` (`settings-schema`).

### Design

- **Schema.** Add `dist/schemas/org.gnome.shell.extensions.zatto.gschema.xml`
  with schema id `org.gnome.shell.extensions.zatto`, path
  `/org/gnome/shell/extensions/zatto/`, and one key `hot-corners` of type
  `as`, default `['bottom-left', 'bottom-right']` (today's behaviour), with
  a summary and description. Set `settings-schema` in `dist/metadata.json`.
  The build compiles the schema into `dist/schemas/gschemas.compiled`; the
  compiled file is ignored by git, the XML is tracked. The release zip
  (`.github/scripts/package-extension.sh` zips `dist/`) must therefore
  contain `schemas/` with the compiled file; make sure the release build
  path produces it and that CI has `glib-compile-schemas` (it is in
  `libglib2.0-bin`; install it in the workflow if `ubuntu-latest` does not
  ship it).
- **Values.** The corner names are the existing `HotCorner` values
  (`src/ui/overlay/hot-corner-geometry.ts`). Parse the setting with a pure,
  unit-tested function: keep known corner names in a fixed order, drop
  duplicates, and ignore unknown strings with one warning each. An empty
  list is valid and means no corner opens the view.
- **Live update.** The extension reads `hot-corners` at enable, passes the
  parsed list to the trigger, and listens to `changed::hot-corners`. On a
  change the trigger replaces its actors with the new set (add a method
  for this to `HotCornerTrigger`; the controller and `HotCornerPort` do not
  change). Disconnect the signal and drop the settings object in
  `disable()`. Remove the `ACTIVE_HOT_CORNERS` constant.
- **Preferences window.** `src/prefs.ts` (bundled to `dist/prefs.js`) shows
  one Adw preferences page with a group "Hot corners" and one switch row
  per offered corner: bottom-left, bottom-right and top-right. The top-left
  corner is not offered, because GNOME Shell's own Activities hot corner
  lives there. Each switch writes the full list back to `hot-corners`,
  keeping any top-left value that was set by other means. When every
  switch is off, the group shows that no corner opens the depth view.
- **Inspect.** Add the trigger's active corners to the Inspect snapshot
  (`hotCorner.corners`, in the controller snapshot or via the trigger), so
  a changed setting can be confirmed with the existing `gdbus` call. Update
  the snapshot shape in `CLAUDE.md` accordingly.
- **Docs.** In `README.md`, say that the corners are chosen in the
  extension's preferences (and how to open them:
  `gnome-extensions prefs zatto@x7c1.github.io`), replacing wording that
  says both bottom corners always open the view.

Operation x state: a change of `hot-corners` can arrive while the overlay
is closed, opening, open, or closing. Replacing the corner actors must not
touch the overlay itself in any of these states; an open overlay stays open
and is closed as usual (Esc, a click, or a remaining corner). Out of scope:
other settings (tuning knobs), keyboard shortcuts, and corners on secondary
monitors.

## Acceptance criteria

### Automated (pipeline-verified)

- [x] The schema file exists, compiles with `glib-compile-schemas --strict`,
      defines `hot-corners`, and `dist/metadata.json` names it as
      `settings-schema` (gates in `check_command`).
- [x] The build produces `dist/prefs.js` (gate in `check_command`).
- [x] `gschemas.compiled` is ignored by git and the schema XML is not
      (gates in `check_command`).
- [x] `ACTIVE_HOT_CORNERS` no longer exists under `src/` (gate in
      `check_command`).
- [x] A unit test covers parsing the setting: the default, a subset, an
      empty list, duplicates, and an unknown name (ignored).
- [x] A test asserts that the release package script's zip would include
      `schemas/gschemas.compiled` when `dist/` is built (for example a
      `*.test.sh` that runs the build and the packaging into a temporary
      directory and lists the zip).

### Before merge (verified outside the check command)

- [ ] After `npm run dev`, `gsettings --schemadir <installed extension>/schemas
      set org.gnome.shell.extensions.zatto hot-corners "['top-right']"`
      changes the Inspect snapshot's `hotCorner.corners` to `['top-right']`
      without a reload, and setting it back restores both bottom corners.
- [ ] `gnome-extensions prefs zatto@x7c1.github.io` opens the preferences
      window; toggling the switches changes which corners open the depth
      view, live, and the window reads well — needs a person: it is a
      visual and pointer check on the live session.
