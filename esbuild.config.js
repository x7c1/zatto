import esbuild from 'esbuild';
import fs from 'fs';

const isDev = process.env.BUILD_MODE !== 'release';
const buildMode = isDev ? 'development' : 'release';

console.log(`Building in ${buildMode} mode...`);

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
      },
    });

    console.log('✓ Build complete!');
  } catch (error) {
    console.error('✗ Build failed:', error);
    process.exit(1);
  }
}

build();
