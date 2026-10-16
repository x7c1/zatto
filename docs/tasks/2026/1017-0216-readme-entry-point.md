---
status: completed
pipeline_phase: null
plan: null
base_ref: task/1017-0215-pick-corners-on-a-display-picture
perspectives: [completeness, clarity, user-experience]
max_refine_rounds: 3
retries_remaining: 1
check_command: "npm run build && npm run check:strict && npm run test:run && grep -q '^## Features' README.md && grep -q '^## Documentation' README.md && grep -qF '**Reach the window behind**' README.md && grep -qF '**Nothing gets rearranged**' README.md && grep -qF '**Only what is under the cursor**' README.md && test -f docs/guides/installation.md && test -f docs/guides/usage.md && grep -q 'docs/guides/installation.md' README.md && grep -q 'docs/guides/usage.md' README.md && grep -q 'docs/guides/release.md' README.md && [ \"$(awk '/^## Status/{f=1;next} /^## /{f=0} f' README.md | wc -w)\" -lt 120 ]"
assignee: null
branch: task/1017-0216-readme-entry-point
created_at: 2026-10-16T17:15:51Z
updated_at: 2026-10-16T17:39:11Z
---

# docs(readme): turn the README into an entry point with features, status and links to guides

## Overview

The README is the product's entry point, but today it is a one-line
introduction, a motivation paragraph, and a `## Status` section that holds
one long paragraph describing every interaction of the depth view, the
dock modes and the preferences. A reader cannot tell at a glance what
zatto is for, how to install it, or where the details live, and there is
no `## Features` or `## Documentation` section.

Restructure it as an entry point, in this order:

1. `# zatto` and the existing one-line introduction under it, unchanged
   ("A GNOME Shell extension that lifts a window sitting one or two layers
   behind the active one, without moving anything on screen."). Remove
   the motivation paragraph that follows it; the Features below say the
   same thing.
2. `## Features`, exactly these three bullets (the wording is the
   author's, keep it verbatim):

   ```markdown
   - **Reach the window behind** — On a large screen you know where a window is, even when another one covers it. Point there and bring it to the front.
   - **Nothing gets rearranged** — Windows stay where they are. Instead of shuffling every window into a grid, zatto tilts the stack so you can see what lies beneath.
   - **Only what is under the cursor** — Scroll through the few windows stacked at that spot, not through every window you have open.
   ```
3. `## Status`, short: the development stage (early; the first release is
   v1), the supported platform (GNOME Shell 50 only, as `dist/metadata.json`
   declares; the primary monitor only), and the compatibility policy
   (behaviour and settings may still change between releases). No
   description of interactions here.
4. `## Documentation`, links to the guides: installation, usage, and the
   release process (`docs/guides/release.md`, for maintainers). There is no
   `## Getting started` section: installing an extension from a zip is a
   procedure to read, so the README links to it instead.
5. `## License`, unchanged.

Move the content that leaves the README into guides, without losing any
of it:

- **`docs/guides/usage.md`** (new): how the depth view is opened and
  closed, what it shows (the oblique, translucent depth view in the work
  area, fixed versus auto-hide dock), cycling with the wheel or Tab and
  Shift+Tab, the thumbnail strip, raising a window, dialogs drawn with
  their parent, and choosing the corners in the preferences (the Extensions
  app or `gnome-extensions prefs zatto@x7c1.github.io`; top-left is not
  offered). Rewrite the current Status paragraph into sections a reader
  can scan, but keep every fact it states. If the preferences page has
  changed since (corner toggles on a picture of the display instead of
  switch rows), describe what `src/prefs/` actually shows.
- **`docs/guides/installation.md`** (new): installing a release, i.e.
  download `zatto@x7c1.github.io.v<N>.shell-extension.zip` from the
  GitHub Releases page, run `gnome-extensions install --force <zip>`, log
  out and back in (GNOME Shell on Wayland only loads a newly installed
  extension at login), and enable it in the Extensions app or with
  `gnome-extensions enable zatto@x7c1.github.io`. Also say how to update
  (install the newer zip the same way) and remove it
  (`gnome-extensions uninstall zatto@x7c1.github.io`), and point developers
  to the development loop instead (`CLAUDE.md` documents `npm run dev`;
  link to it or move that part into a guide if a guide is the better
  home, keeping one source).

Follow the repository's existing conventions: English, DRY (each fact in
one place; the README links rather than repeats).

## Acceptance criteria

### Automated (pipeline-verified)

- [x] `README.md` has `## Features` with the three bullets verbatim and a
      `## Documentation` section (gates in `check_command`).
- [x] `docs/guides/installation.md` and `docs/guides/usage.md` exist and
      the README links to them and to `docs/guides/release.md` (gates in
      `check_command`).
- [x] The README's `## Status` section is short: under 120 words (gate in
      `check_command`).

### Before merge (verified outside the check command)

- [ ] Every fact of the old Status paragraph is present in
      `docs/guides/usage.md` — verified by comparing the two texts in the
      PR diff.
- [ ] The README reads well as the product's front page — needs a person:
      it is the author's judgement of tone and emphasis.
