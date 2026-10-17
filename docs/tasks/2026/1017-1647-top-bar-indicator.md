---
status: completed
pipeline_phase: null
plan: null
base_ref: null
perspectives: [completeness, clarity, user-experience]
max_refine_rounds: 3
retries_remaining: 1
check_command: "npm run build && npm run check:strict && npm run test:run && for t in .github/scripts/*.test.sh; do bash \"$t\" || exit 1; done && grep -q 'show-top-bar-indicator' dist/schemas/org.gnome.shell.extensions.zatto.gschema.xml"
assignee: null
branch: task/1017-1647-top-bar-indicator
created_at: 2026-10-17T16:45:00Z
updated_at: 2026-10-17T17:26:06Z
---

# feat(indicator): add a top bar indicator that opens the depth view and the preferences

## Overview

The preferences window is now reachable only through the Extensions app
or `gnome-extensions prefs`. Add a top bar indicator, as the author's
other GNOME Shell extension sutto does, and a preference to show or hide
it.

Reference implementation: the author's sutto extension
(https://github.com/x7c1/sutto, GPL-3.0-or-later; read only) —
`src/ui/top-bar-indicator/` (the indicator and its unit-tested menu
model), `src/composition/indicator/top-bar-indicator-manager.ts`
(adds/removes the indicator as the preference changes, without
restarting the Shell), and the `show-top-bar-indicator` key and its
switch row in `src/prefs/keyboard-shortcuts.ts`. Do not copy anything
license-related.

- **Menu**: "Open Depth View", which opens the depth view as the hot
  corner does, and "Preferences…", which opens the preferences window.
  Keep the menu built from a pure, unit-tested model so later items (a
  license status row) can be added there.
- **Icon**: a stock symbolic icon from the Adwaita theme that suggests
  stacked windows, named in one constant.
- **Setting**: a boolean `show-top-bar-indicator` key in the schema
  (`dist/schemas/org.gnome.shell.extensions.zatto.gschema.xml`, the
  tracked schema source), default `true`. The indicator appears and
  disappears as the key changes, immediately.
- **Preferences**: a switch row for the key. The preferences window has
  one page today (`src/prefs/hot-corners-page.ts`); add the row where it
  reads naturally, adding a general page if that is clearer.
- Opening the depth view from the menu must leave the overlay in the
  same state as opening it from the hot corner; closing it returns to the
  desktop as usual.
- Document the indicator in the user guide (`docs/guides/usage.md`) and
  the README's Features if it lists entry points.

## Acceptance criteria

### Automated (pipeline-verified)

- [x] The schema defines `show-top-bar-indicator` (boolean, default
      `true`) (gate in `check_command`).
- [x] Unit tests cover the menu model: it lists "Open Depth View" and
      "Preferences…", and each item invokes its action.
- [x] Unit tests cover the manager's behavior through a fake settings
      port: the indicator is added when the key is true at enable, removed
      when the key turns false, added again when it turns true, and
      removed on disable.

### Before merge (verified outside the check command)

- [x] After `npm run dev`, toggling `show-top-bar-indicator` with
      `gsettings` (pointing at the extension's schema directory) adds and
      removes the indicator; GNOME Shell's journal shows no error from
      zatto while doing so.
