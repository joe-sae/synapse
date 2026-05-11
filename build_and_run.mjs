import esbuild from 'esbuild';
import { spawn } from 'child_process';
import path from 'path';

let child;

async function buildAndRun() {
  try {
    console.log("Building server...");
    await esbuild.build({
      entryPoints: ['server/_core/index.ts'],
      bundle: true,
      platform: 'node',
      format: 'esm',
      packages: 'external',
      outfile: 'dist/server.js',
    });
    console.log("Build successful. Starting server...");
    
    if (child) {
      child.kill();
    }
    
    child = spawn(process.execPath, ['dist/server.js'], { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development' } });
    
    child.on('error', (err) => {
      console.error("Failed to start child process:", err);
    });
  } catch (err) {
    console.error("Build failed:", err);
  }
}

buildAndRun();
