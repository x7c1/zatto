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
branch: task/1021-1356-close-button-shell-look
created_at: 2026-10-21T04:56:41Z
updated_at: 2026-10-21T14:31:11Z
---

# feat(overlay): restyle the depth view's close button and show it on the window in front of the pointer

## Overview

The close button on the frontmost window's clone (`src/ui/overlay/depth-close-button.ts`, placed by `closeButtonRect()` and carried by the window `closeButtonCarrier()` picks, both in `depth-close.ts`) was a 28 px dark circle with a 16 px icon, styled inline, inset 8 px inside the clone's top-right corner, drawn in the chrome container above every clone, and kept on the focused window once the wheel had focused one. Using it showed three problems: it did not look like the Activities Overview's button for the same action, it showed through a window drawn in front of its own, and after a wheel step it stopped following the pointer. This task fixes all three; the look and placement were tuned on hardware with the author.

What GNOME Shell 50 (the only version zatto supports) does, in `js/ui/windowPreview.js` and the theme's `.window-close` rule:

- `new St.Button({ style_class: 'window-close', icon_name: 'preview-close-symbolic' })`.
- The theme gives it a 32 px content box, 3 px padding, a 2 px transparent border (42 px across in all), `border-radius: 999px`, a 24 px icon, a faint box shadow, and its own `:hover` and `:active` backgrounds; the dark, light and high-contrast stylesheets each define it.
- Its centre sits on the preview's top corner: the top-right one, or the top-left one when the window button layout (`Meta.prefs_get_button_layout()`) puts the close button among the left buttons.

The change:

- **Look**: build the button with the `window-close` style class and the `preview-close-symbolic` icon, and drop zatto's inline colours, the icon size knob and the `notify::hover` style swap, so the theme supplies the size, colours and hover/active states and follows the user's colour scheme. Override only the shadow, with a stronger one (`box-shadow: 0 2px 8px 0 rgba(0, 0, 0, 0.6)`): the theme's is too faint to set the button apart from the window content under it. Keep the pointer cursor, `can_focus: false`, the `accessible_name` and the press handling as they are.
- **Size**: the button's size comes from the theme, not from `DEPTH_VIEW_TUNING`; take it from the actor (its preferred size once styled) and pass it to the pure placement code. Remove `closeButtonSizePx` and `closeButtonIconSizePx`.
- **Placement**: put the button at the clone's top-right corner of its visible (frame) rect, or its top-left one when the button layout puts close among the left buttons (read when the button is placed, so a change made while zatto runs applies to the next depth view), `closeButtonInsetPx` from the frame's top edge and the corner's side edge. The knob is -8 px: the button reaches 8 px past the corner on both sides, covering the window's own title bar close button while standing slightly out of the window. Tried on hardware and rejected: the overview's centring on the corner (half the button outside, next to the window's own close button it read as a half-overlapping duplicate, since the depth view draws windows near their real size), and +8 px or 0 px inside the frame (the window's own close button showed past it). Do not clamp the button into the work area: on a maximized window it reaches past the top bar's edge like on any other, which reads more naturally. Keep the rule that on a frame too small for the button it does not leave the frame's far side.
- **Stacking**: parent the button to the clone container, stacked directly above its carrier's group (a sibling, not a child, so it keeps its own opacity; scaled by the inverse of the container's scale, so it keeps its size), and restack it whenever the mirror restacks the groups (a focus change). A clone drawn in front of the carrier then covers the button as it covers the carrier. The cycle strip, in the chrome container, stays above it. Drop the mirror's chrome-container parameter, which only hosted the button.
- **Carrier**: the window drawn frontmost under the pointer carries the button, whether the focus came from the wheel or not. The focused window, drawn on top of everything, carries it wherever it is under the pointer; with no window under the pointer (empty desktop, the cycle strip), the focused window keeps it, and with no focus either, none does. While the pointer is within the button's rect the button stays on its carrier (it may reach past the carrier's frame onto a window drawn behind it), except where a window drawn in front of the carrier covers it: the pointer is then on that window.
- **Overlap lookup**: `GnomeWindowMirror.overlapOf()` uses the button's centre to find the windows drawn where a focused window was closed. That point must lie inside the closed window's drawn frame (inside the half-open hit test of `windowsUnder()`), so the lookup still finds that window, including on a frame smaller than the button or with the button reaching past the frame.
- **Docs**: update the descriptions of the button's look, position and carrier wherever they are (`docs/guides/usage.md`, module doc comments).

## Acceptance criteria

### Automated (pipeline-verified)

- [x] Unit tests cover the button's placement: the top-right corner, the top-left corner when close is on the left, a negative inset reaching past the frame and past the screen edge, and the small-frame case.
- [x] Unit tests cover the carrier: the focused window under the pointer, another window under the pointer after a focus, no window under the pointer with and without a focus, the pointer on the button, and a window drawn in front of the carrier covering the button.
- [x] Unit tests show that closing a focused window while the pointer is elsewhere still finds that window's overlap.

### Before merge (verified outside the check command)

- [x] After `npm run dev`, the button looks like the Activities Overview's with a stronger shadow and stands slightly out of the clone's top-right corner, covering the window's own close button; it follows the pointer after a wheel step; a window drawn in front of its carrier covers it; pressing it closes the window; GNOME Shell's journal shows no error from zatto.
