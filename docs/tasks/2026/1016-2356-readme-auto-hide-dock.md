---
status: completed
pipeline_phase: null
plan: null
base_ref: null
perspectives: [completeness, clarity]
max_refine_rounds: 3
retries_remaining: 1
check_command: "npm run build && npm run check:strict && npm run test:run && grep -qi 'auto-hide' README.md"
assignee: null
branch: task/1016-2356-readme-auto-hide-dock
created_at: 2026-10-16T14:54:12Z
updated_at: 2026-10-16T15:47:39Z
---

# docs(readme): say what happens to an auto-hiding dock while the depth view is open

## Overview

The Status section of `README.md` says the depth view "is drawn in the
work area, between the top bar and the dock, which stay visible and
usable". That holds for a fixed dock, which reserves a strut and so is
excluded from the work area. An auto-hiding (intellihide) dock reserves
no strut: the work area extends under it, the depth view is drawn there
too, and the dock does not appear while the overlay is open (Ubuntu Dock
reveals itself only for the Activities Overview, and zatto does not ask it
to). A reader with an auto-hiding dock is told something that does not
happen.

Correct the sentence so it is true for both dock modes: with a fixed dock
the top bar and the dock stay visible and usable; with an auto-hiding dock
the depth view also covers the dock's area and the dock stays hidden
while the overlay is open. Keep it short; it is a status note, not a
guide.

## Acceptance criteria

### Automated (pipeline-verified)

- [x] `README.md` mentions the auto-hiding dock case (gate in
      `check_command`).
