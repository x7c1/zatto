---
status: completed
pipeline_phase: null
plan: null
base_ref: null
perspectives: null
max_refine_rounds: 3
retries_remaining: 1
check_command: "npm run build && npm run check:strict && npm run test:run && for t in .github/scripts/*.test.sh; do bash \"$t\" || exit 1; done"
assignee: null
branch: task/1017-1645-track-clones-before-adding
created_at: 2026-10-17T16:45:00Z
updated_at: 2026-10-17T17:06:28Z
---

# fix(overlay): track each clone before attaching it so a failed mount cleans it up

## Overview

`GnomeWindowMirror.mount()` in `src/ui/overlay/gnome-window-mirror.ts`
builds, for each window, a `Clutter.Actor` group holding the window's
clone and its transients' clones, attaches the group to the container
(`container.add_child(group)`), and only then pushes the entry into
`this.clones`. When `mount()` throws, the overlay controller rolls back
by unmounting, and unmount tears down what `this.clones` holds. A throw
after the group is created but before the push (`add_child` failing, or
anything between them) therefore leaves that group, its clones and their
`button-press-event` handlers alive and unreachable.

Make every actor `mount()` creates reachable from the state unmount
tears down before any call that can throw: record the entry as soon as
its group exists (or destroy the group in a local `try`/`catch` that
rethrows), whichever keeps the code clearer. The same applies to the
strip or any other actor `mount()` creates, if the same gap exists
there.

If the teardown logic can be expressed as a pure function over the
mirror's bookkeeping, add a unit test for the failure case; otherwise
keep the change minimal and say so in the report.

## Acceptance criteria

### Automated (pipeline-verified)

- [x] The project builds, lints and its existing tests pass with the
      change.

### Before merge (verified outside the check command)

- [x] Reading the diff confirms that, in `mount()`, every actor created
      for a window is reachable from the state `unmount()` tears down
      before the first call after its creation that can throw.
