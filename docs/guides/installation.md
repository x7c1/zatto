# Installation

How to install, update and remove a zatto release. zatto runs on GNOME
Shell 50.

## Install

1. Download `zatto@x7c1.github.io.v<N>.shell-extension.zip` from the
   [GitHub Releases page](https://github.com/x7c1/zatto/releases), where
   `<N>` is the release number.
2. Install it:

   ```bash
   gnome-extensions install --force zatto@x7c1.github.io.v<N>.shell-extension.zip
   ```

3. Log out and back in. GNOME Shell on Wayland only loads a newly installed
   extension at login.
4. Enable zatto in the Extensions app, or run:

   ```bash
   gnome-extensions enable zatto@x7c1.github.io
   ```

Then see [Usage](usage.md).

## Update

Install the newer zip the same way: download it, run
`gnome-extensions install --force` on it, and log out and back in.

## Remove

```bash
gnome-extensions uninstall zatto@x7c1.github.io
```

## Development

To run zatto from a working tree instead of a release, install it once:

```bash
npm install
npm run build && npm run copy-files
```

then log out and back in and enable it as in [Install](#install). After
that, iterate with the development loop (`npm run dev`) described in
[CLAUDE.md](../../CLAUDE.md#development-loop).
