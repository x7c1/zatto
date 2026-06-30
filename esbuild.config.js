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

    await esbuild.build({
      entryPoints: ['src/extension.ts'],
      bundle: true,
      outfile: 'dist/extension.js',
      platform: 'neutral',
      target: 'es2022',
      format: 'esm',
      treeShaking: false,
      external: ['gi://*', 'resource://*'],
      banner: {
        js: '// GNOME Shell Extension - Bundled with esbuild',
      },
      logLevel: 'info',
      define: {
        __DEV__: JSON.stringify(isDev),
        __BUILD_COMMIT_SHA__: JSON.stringify(commitSha),
        __BUILD_TIMESTAMP__: JSON.stringify(buildTimestamp),
      },
    });

    console.log('✓ Build complete!');
  } catch (error) {
    console.error('✗ Build failed:', error);
    process.exit(1);
  }
}

build();
