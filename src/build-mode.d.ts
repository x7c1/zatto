/**
 * Build mode global constant
 *
 * This constant is replaced by esbuild during build time via the `define`
 * option in esbuild.config.js:
 * - Development build: __DEV__ = true
 * - Release build (BUILD_MODE=release): __DEV__ = false
 *
 * Use it to gate dev-only code paths (e.g. the D-Bus reloader) so they are
 * tree-shaken out of release builds.
 */
declare const __DEV__: boolean;
