# zatto

A GNOME Shell extension that lifts a window sitting one or two layers behind the active one, without moving anything on screen.

Switching to a window that is already visible on screen, just partially hidden behind the active one, should not require a full re-arranged overview. You already know where the window is. zatto keeps every window at its own position and lets you bring the one you want to the front.

## Status

Proof of concept. Entering the bottom-left hot corner opens an overlay: the real windows are hidden and their clones slide from the windows' positions into an oblique, translucent depth view of the stacking order, with deeper windows offset towards the top-left. The depth view is drawn in the work area, between the top bar and the dock, which stay visible and usable. Clicking a clone raises its window, and Esc, re-entering the corner or clicking outside the depth view (on the top bar or the dock, for example) closes the overlay; closing slides the clones back onto the windows before the real windows reappear. Cycling the windows under the cursor with the scroll wheel is the next step.

## License

GPL-3.0 — see [LICENSE](LICENSE).
