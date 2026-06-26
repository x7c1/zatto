# Claude AI Guidelines

## Documentation

**DRY Principle**: Write each piece of information in ONE place only. Never duplicate content across files.

## Language

This repository is published as OSS. Documentation, code comments, commit messages, and pull request descriptions are written in English by default. Do not include links or references to private/internal repositories.

## Code Quality

After making code changes, always run:

```bash
npm run build && npm run check && npm run test:run
```

Fix any issues before considering the task complete.

## Development loop

`npm run dev` chains three steps for fast iteration on a real GNOME Shell session:

1. `npm run build` — TypeScript + esbuild bundle into `dist/` (development mode, `__DEV__ === true`).
2. `npm run copy-files` — copies `dist/*` into `~/.local/share/gnome-shell/extensions/zatto@x7c1.github.io/`.
3. `npm run reload` — sends a D-Bus `Reload` call to the running extension, which copies itself to `/tmp` under a new UUID and re-enables.

Prerequisites:

- The extension must already be installed and enabled at least once (so the D-Bus interface at `/io/github/x7c1/Zatto` is registered).
- The session must be a logged-in GNOME Shell (Wayland or X11).
- The reloader is gated by `__DEV__` and is absent from release builds (`npm run build:release`).

## Inspect endpoint

A read-only D-Bus sibling of the reloader (same `__DEV__` gate, same registration pattern) exposes the live controller state for manual debugging:

```bash
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /io/github/x7c1/Zatto/Inspect \
  --method io.github.x7c1.Zatto.Inspect.GetState
```

Returns a JSON snapshot (`{ overlay: { state, visible }, hotCorner: { lastEnterAt } }`). Intended for ad-hoc inspection during `npm run dev` and, later, for assertions from a nested-shell e2e harness.
