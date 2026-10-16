---
status: completed
pipeline_phase: null
plan: null
base_ref: null
perspectives: [completeness, clarity, user-experience]
max_refine_rounds: 3
retries_remaining: 1
check_command: "npm run build && npm run check:strict && npm run test:run && for t in .github/scripts/*.test.sh; do bash \"$t\" || exit 1; done && ! grep -rq 'SwitchRow' src/prefs/ && grep -rq 'Gtk.ToggleButton\\|ToggleButton' src/prefs/"
assignee: null
branch: task/1017-0215-pick-corners-on-a-display-picture
created_at: 2026-10-16T17:15:01Z
updated_at: 2026-10-16T17:26:59Z
---

# feat(prefs): pick hot corners on a picture of the display

## Overview

The preferences page (`src/prefs/hot-corners-page.ts`) lists the offered
corners as three switch rows: "Bottom left", "Bottom right", "Top right".
The setting works, but the author found the list hard to map to the
screen: a corner is a place, and a row of labels makes the user translate
each label back into a position. Replace the rows with a small picture of
the display whose corners are the controls themselves.

### Design

- **The picture.** Inside the "Hot corners" group, draw a rounded
  rectangle standing for the primary monitor, with the primary monitor's
  aspect ratio (read in the prefs process through `Gdk.Display`; fall back
  to 16:9 when it cannot be read), at a fixed width that fits the
  preferences window. A thin bar along its top edge stands for the top
  bar, so the picture reads as a screen and its orientation is obvious.
  The sibling extension x7c1/sutto (public, same author) draws a display
  miniature in its preferences (`src/prefs/gtk-miniature-display.ts`);
  follow its approach (a `Gtk.DrawingArea` with Cairo, or composed
  widgets) where it fits.
- **The corners.** Place a toggle button (`Gtk.ToggleButton`) at each
  offered corner of the picture: bottom-left, bottom-right and top-right.
  A toggle's active state is that corner's membership in `hot-corners`;
  toggling writes the whole list back, as the switch rows do today
  (`withHotCorner`, keeping a top-left value set by other means). An
  active corner is clearly marked (for example filled with the accent
  colour); an inactive one is a visible outline, so the user sees all
  three places that can be switched on. Each toggle has a tooltip and an
  accessible label naming its corner ("Bottom left corner", ...), so the
  control is not pictures only.
- **The top-left corner.** Show a non-interactive marker at the top-left
  corner, labelled or with a tooltip such as "Activities", so the user
  sees why that corner cannot be chosen.
- **Description.** Keep the group description below the picture, as
  produced by `describe()` today.
- **Live update.** The toggles follow outside changes of the setting
  while the window is open, as the rows do now, without writing back in
  response to their own update (no feedback loop).
- **Docs.** Update the README sentence that describes the preferences if
  it names switches.

Keep the corner placement logic (which corner goes where, which ones are
interactive) in a small pure function or table with a unit test, so the
mapping from `HotCorner` values to picture positions is tested without
GTK. Out of scope: secondary monitors, and other settings.

## Acceptance criteria

### Automated (pipeline-verified)

- [x] The switch rows are gone from `src/prefs/` and the corners are
      toggle buttons (gates in `check_command`).
- [x] A unit test covers the placement table: each offered corner maps to
      its picture position and is interactive, and top-left maps to the
      top-left position and is not interactive.
- [x] The existing setting tests still pass (`hot-corner-setting.test.ts`).

### Before merge (verified outside the check command)

- [ ] In the preferences window the picture reads as the screen, the
      three corner toggles sit at the matching corners, the top-left marker
      explains the missing corner, and toggling a corner changes which
      corner opens the depth view, live — needs a person: it is a visual
      and pointer check on the live session.
