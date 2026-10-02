# zatto

A GNOME Shell extension that lifts a window sitting one or two layers behind the active one, without moving anything on screen.

Switching to a window that is already visible on screen, just partially hidden behind the active one, should not require a full re-arranged overview. You already know where the window is. zatto keeps every window at its own position and lets you bring the one you want to the front.

## Status

Proof of concept. Entering the bottom-left hot corner opens an overlay that mirrors the open windows in place; clicking one raises it, and Esc or re-entering the corner closes the overlay. The overlay now renders the stacking order as an oblique, translucent depth view, with deeper windows offset towards the top-left; cycling the windows under the cursor with the scroll wheel is the next step.

## License

GPL-3.0 — see [LICENSE](LICENSE).
