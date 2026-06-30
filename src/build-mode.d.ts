/**
 * Build-time global constants
 *
 * These are replaced by esbuild during build time via the `define` option
 * in esbuild.config.js:
 * - `__DEV__` — Development build: `true`. Release build
 *   (`BUILD_MODE=release`): `false`. Gate dev-only code paths (e.g. the
 *   D-Bus reloader) so they are tree-shaken out of release builds.
 * - `__BUILD_COMMIT_SHA__` — short `git rev-parse --short HEAD` captured
 *   at build time. Exposed via the inspector's `GetBuildInfo` D-Bus method
 *   so a manual `gdbus` poke can verify the running extension matches the
 *   bundle on disk. `'unknown'` when the build is outside a git checkout.
 * - `__BUILD_TIMESTAMP__` — ISO-8601 timestamp captured at build config
 *   evaluation. Useful for distinguishing two builds at the same commit.
 */
declare const __DEV__: boolean;
declare const __BUILD_COMMIT_SHA__: string;
declare const __BUILD_TIMESTAMP__: string;
