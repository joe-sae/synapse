// Build script: compile server TS → dist/server.cjs using esbuild API
import * as esbuild from './node_modules/esbuild/lib/main.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const result = await esbuild.build({
  entryPoints: ['server/_core/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/server.cjs',
  sourcemap: false,
  // Keep these as externals so native addons load correctly at runtime
  external: [
    'mysql2',
    'drizzle-orm',
    'better-sqlite3',
    '@node-rs/argon2',
    'argon2',
    'bcrypt',
    'sharp',
    'canvas',
  ],
  // Path aliases matching tsconfig
  alias: {
    '@shared': path.join(__dirname, 'shared'),
  },
  logLevel: 'info',
});

if (result.errors.length) {
  console.error('Build errors:', result.errors);
  process.exit(1);
}
console.log('✅ Server built to dist/server.cjs');
