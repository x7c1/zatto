---
status: completed
pipeline_phase: null
plan: null
base_ref: null
perspectives: [completeness, clarity, user-experience]
max_refine_rounds: 3
retries_remaining: 1
check_command: "npm run build && npm run check:strict && npm run test:run && for t in .github/scripts/*.test.sh; do bash \"$t\" || exit 1; done && grep -rq 'foreach_transient\\|get_transient_for' src/ui/overlay/"
assignee: null
branch: task/1017-0100-draw-dialogs-with-their-parent
created_at: 2026-10-16T16:00:49Z
updated_at: 2026-10-16T16:17:20Z
---

# feat(overlay): draw dialogs with their parent window in the depth view

## Overview

The depth view mirrors only windows of type `NORMAL`
(`GnomeWindowMirror.collectEligible()` in
`src/ui/overlay/gnome-window-mirror.ts`), but opening it hides the whole
`window_group` (`GnomeRealWindows`, `src/ui/overlay/gnome-real-windows.ts`).
A dialog that belongs to a window, such as a text editor's "Save
changes?" prompt or a browser's "Save as" file chooser, therefore
disappears as soon as the overlay opens. When the overlay closes, it pops
back in without any transition once the clones have landed. The
Activities Overview instead draws such dialogs on top of their parent's
preview, and they move with it.

Do the same in the depth view. A window's transient windows (dialogs,
modal dialogs and utility windows whose transient parent is that window,
recursively, that are not minimized and are on the current workspace)
are drawn with that window's clone. They sit at their real offset from
the parent, follow the parent's position and scale through the opening
and closing eases, and use the parent's opacity, including when the
parent is the focused window while cycling. They are part of their
parent, not windows of their own:

- they do not take a depth slot, so the depth layout and the stacking
  depth of every other window are the same as without them;
- hit-testing (`groupAt()`, `cycleAt()`, `hoverAt()`, `activateAt()`)
  sees only the parent windows, so a dialog never becomes its own cycle
  step or strip thumbnail;
- clicking a dialog's clone acts like clicking its parent's clone; and
  activating a parent that has a modal transient activates that modal
  transient, so the window the user ends up in is the one that holds
  the keyboard;
- a transient window whose parent is not eligible (minimized, on another
  workspace) is not drawn, the same as today.

On close, the dialog clones land with their parent, so the real dialog
reappears under its clone exactly like the parent does.

Use the Activities Overview's approach as a reference
(`js/ui/windowPreview.js` in GNOME Shell 50 attaches transient windows to
a `WindowPreview` via `foreach_transient`). Keep the decision of which
windows are attached to which parent in a pure function over plain window
descriptions (id, type, transient parent id, minimized, workspace), with
unit tests, so it is tested without GNOME Shell. How the dialog clones
are parented in the Clutter scene (children of a per-window group,
siblings eased in lockstep, or another way) is the implementer's choice.
Pick what keeps the eases and the focus raising (raising the focused
clone to the top of the container) correct for the dialogs too.

Out of scope: drawing dialogs in the cycle strip's thumbnails, override-
redirect popups and menus, and transient windows on secondary monitors.

## Acceptance criteria

### Automated (pipeline-verified)

- [x] A unit test of the pure attachment function covers: a parent with
      one dialog; a modal dialog; a dialog of a dialog (recursion); a
      minimized dialog (not drawn); a dialog whose parent is minimized
      (not drawn); a dialog on another workspace (not drawn); and a
      `NORMAL` window with a transient parent (attached, not a depth slot
      of its own).
- [x] A test shows that attached dialogs do not change the depth layout:
      the layout computed for the parents is the same with and without
      their dialogs.
- [x] The mirror uses Mutter's transient relation (`foreach_transient` or
      `get_transient_for`) under `src/ui/overlay/` (gate in
      `check_command`).

### Before merge (verified outside the check command)

- [ ] With gnome-text-editor showing its "Save changes?" dialog, and with
      a browser's "Save as" dialog open, the depth view draws each dialog
      on its parent, it moves and fades with the parent while opening,
      cycling and closing, and it no longer pops in after the close —
      needs a person: it is a visual and timing check on the live session.
- [ ] Clicking the parent's clone or the dialog's clone closes the overlay
      with the dialog focused — needs a person: it needs pointer input on
      the live session.
