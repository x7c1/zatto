import { execSync } from 'child_process';
import esbuild from 'esbuild';
import fs from 'fs';

const isDev = process.env.BUILD_MODE !== 'release';
const buildMode = isDev ? 'development' : 'release';

console.log(`Building in ${buildMode} mode...`);

/**
 * Capture a short commit SHA at build time. Surfaced via the inspector's
 * `GetBuildInfo` D-Bus method so a manual `gdbus` poke can verify the
 * running extension actually matches the bundle on disk — this is the
 * diagnostic that would have caught the reloader-wedged state during the
 * step-5d verify cycle in a single command. Falls back to `'unknown'`
 * outside a git checkout so the build never breaks for tarball consumers.
 */
function readCommitSha() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

const commitSha = readCommitSha();
const buildTimestamp = new Date().toISOString();

async function build() {
  try {
    if (!fs.existsSync('dist')) {
      fs.mkdirSync('dist', { recursive: true });
    }

    const define = {
      __DEV__: JSON.stringify(isDev),
      __BUILD_COMMIT_SHA__: JSON.stringify(commitSha),
      __BUILD_TIMESTAMP__: JSON.stringify(buildTimestamp),
    };
    const common = {
      bundle: true,
      platform: 'neutral',
      target: 'es2022',
      format: 'esm',
      treeShaking: false,
      external: ['gi://*', 'resource://*'],
      logLevel: 'info',
      define,
    };

    // extension.js runs inside GNOME Shell.
    await esbuild.build({
      ...common,
      entryPoints: ['src/extension.ts'],
      outfile: 'dist/extension.js',
      banner: {
        js: '// GNOME Shell Extension - Bundled with esbuild',
      },
    });

    // prefs.js runs in the separate GTK4 / libadwaita preferences process.
    await esbuild.build({
      ...common,
      entryPoints: ['src/prefs.ts'],
      outfile: 'dist/prefs.js',
      banner: {
        js: '// GNOME Shell Extension Preferences - Bundled with esbuild',
      },
    });

    // The extension and its preferences load the settings from
    // `schemas/gschemas.compiled` next to them. The release zip leaves it out
    // (see .github/scripts/package-extension.sh for why), but compiling here
    // makes a schema that does not compile fail the build, and gives
    // `npm run dev`, which copies dist/ into the extensions directory, the
    // compiled file.
    console.log('Compiling GSettings schema...');
    execSync('glib-compile-schemas --strict dist/schemas/', { stdio: 'inherit' });
    console.log('✓ Schema compiled');

    console.log('✓ Build complete!');
  } catch (error) {
    console.error('✗ Build failed:', error);
    process.exit(1);
  }
}

build();
