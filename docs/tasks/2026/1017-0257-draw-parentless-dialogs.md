---
status: completed
pipeline_phase: null
plan: null
base_ref: null
perspectives: [completeness, clarity, user-experience]
max_refine_rounds: 3
retries_remaining: 1
check_command: "npm run build && npm run check:strict && npm run test:run && for t in .github/scripts/*.test.sh; do bash \"$t\" || exit 1; done && grep -q 'windows:' CLAUDE.md"
assignee: null
branch: task/1017-0257-draw-parentless-dialogs
created_at: 2026-10-16T17:57:50Z
updated_at: 2026-10-16T18:10:40Z
---

# fix(overlay): draw dialogs and utility windows that have no parent window

## Overview

An extension's preferences window (the one GNOME Shell's extension
preferences service opens for `gnome-extensions prefs <uuid>`, an
`Adw.PreferencesWindow`) is missing from the depth view, for zatto's own
preferences as well as for other extensions'. It stays hidden while the
overlay is open and reappears when it closes.

The likely cause is the eligibility rule in
`src/ui/overlay/transient-attachment.ts`: a window is drawn on its own
only if its type is `normal` and it has no (described) transient parent;
a dialog, modal dialog or utility window is drawn only attached to a
parent. A dialog-type window with no parent is therefore never drawn.
Nothing outside the shell can confirm the window's type
(`org.gnome.Shell.Introspect.GetWindows` is denied), so this task first
makes the cause visible and then fixes it.

### Design

- **Diagnostic.** Add the windows the mirror considered at its last
  `mount()` to the Inspect snapshot (development builds only, like the
  rest of the Inspect endpoint): one entry per window with its title,
  `wm_class`, type (`WindowKind`), transient parent id, minimized,
  on-current-workspace, and the outcome: drawn as a root, attached to
  which root, or not drawn and why. Keep it a plain data structure
  produced by the pure attachment code, so the reasons are unit-tested.
  Document the new field in `CLAUDE.md`'s Inspect section.
- **Fix.** A window whose type is `dialog`, `modal-dialog` or `utility`
  and that has no transient parent (or whose parent is not among the
  windows described) is drawn as a root of its own, like a `normal` one:
  it takes a depth slot, can be cycled to, appears in the strip, and
  activating it activates it. This matches how the Activities Overview
  lists such windows. Transients of such a window attach to it as usual.
  Everything else in the eligibility rules stays as it is (minimized and
  other-workspace windows are not drawn; menus, tooltips, docks and other
  types are not drawn).
- If the diagnostic shows a different cause for the preferences window
  than the one above, fix that cause instead, and say so in the report.

Out of scope: windows on secondary monitors.

## Acceptance criteria

### Automated (pipeline-verified)

- [x] Unit tests of the attachment function cover: a parentless dialog, a
      parentless modal dialog and a parentless utility window are each
      drawn as a root; a dialog whose parent is not described is drawn as
      a root; a dialog with a drawn parent is still attached to it; a
      parentless dialog's own dialog attaches to it.
- [x] Unit tests cover the diagnostic outcomes (root, attached to a root,
      and each not-drawn reason).
- [x] The Inspect snapshot carries the window list and `CLAUDE.md` documents it as a `windows:` field of the snapshot
      shape (gate in `check_command`).

### Before merge (verified outside the check command)

- [x] After `npm run dev`, with an extension's preferences window open,
      opening the depth view and then reading the Inspect snapshot shows
      that window as drawn (a root), with its type.
- [x] The preferences window appears in the depth view and can be cycled
      to and raised like any other window — needs a person: it is a
      visual and pointer check on the live session.
