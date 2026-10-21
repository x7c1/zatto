---
status: completed
pipeline_phase: null
plan: null
base_ref: null
perspectives: [completeness, clarity, user-experience]
max_refine_rounds: 3
retries_remaining: 1
check_command: "npm run build && npm run check:strict && npm run test:run"
assignee: null
branch: task/1022-0222-close-button-on-release
created_at: 2026-10-21T17:22:15Z
updated_at: 2026-10-21T17:46:04Z
---

# feat(overlay): close a window when the depth view's close button is released, as the Activities Overview does

## Overview

The depth view's close button (`src/ui/overlay/depth-close-button.ts`) closes its window as soon as a mouse button goes down on it: its `button-press-event` handler runs `onPress` and returns `Clutter.EVENT_STOP`. That stops St.Button's own press handling, so the button never shows the theme's `:active` (pressed) background, and a press cannot be taken back. The Activities Overview's close button (`js/ui/windowPreview.js` in GNOME Shell 50) closes on St.Button's `clicked` signal instead, emitted when the primary button is released over the button: while it is held the button shows its pressed background, and moving the pointer off the button before releasing cancels the close.

The change:

- **Close on release**: close the window on the button's `clicked` signal, not on the press. Let St.Button handle the press itself, so the theme's `:active` background shows while the button is held and a release off the button closes nothing. Rename `onPress` (and the doc comments that speak of a press closing the window) to match.
- **Other buttons**: only the primary button (St.Button's default `button_mask`) closes the window. A press of another mouse button on the close button does nothing: it must not reach the clone beneath it (whose press handler activates the window and closes the depth view), so stop it on the button.
- **Modal grab**: a press on the button must still not count as a press on nothing for `GnomeModalGrab` (which closes the overlay when the press's event actor is the overlay itself or the press lands outside it). The button stays the press's event actor, so this holds; check it, and keep the doc comment that says why accurate.
- **Carrier while held**: while the button is held down it stays on its carrier, wherever the pointer moves and whatever else changes the carrier (the focus, the window under the pointer), so the release always acts on the window the press was made on and the button does not move away from under the pointer mid-click. If the carrier window goes while the button is held (it closed by itself), the button goes with it as now, and nothing is closed on the release. Once released, the carrier follows the usual rules again from the current pointer position.
- **Docs**: `docs/guides/usage.md` ("Closing a window") says clicking the button closes the window; say that the window closes when the button is released over it, and that releasing elsewhere cancels. Update the module doc comments of `depth-close-button.ts`, `depth-close.ts` and `gnome-window-mirror.ts` where they describe the press.

## Acceptance criteria

### Automated (pipeline-verified)

- [x] The close button closes its window on `clicked`, not on `button-press-event`; no handler on the button runs the close on a press.
- [x] A press of a non-primary mouse button on the close button is stopped on the button.
- [x] While the button is held down, the mirror keeps the carrier unchanged; the logic that decides this is covered by a unit test if it lives in pure code.

### Before merge (verified outside the check command)

- [x] After `npm run dev`: holding the primary button on the close button shows the theme's pressed background and does not close the window; releasing over the button closes it; pressing, moving off the button and releasing closes nothing and leaves the depth view open; a right-click on the button neither closes the window nor the depth view; GNOME Shell's journal shows no error from zatto.
