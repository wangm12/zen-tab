#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const distDir = path.join(root, 'dist');
const zipName = `zen-tab-${pkg.version}.zip`;
const zipPath = path.join(distDir, zipName);

// Always ensure a clean, fresh build
console.log('Running build...');
const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
if (build.status !== 0) throw new Error('Build failed');

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

console.log(`Creating ${zipName}...`);
const packed = spawnSync('zip', ['-r', zipPath, '.', '-x', '*.DS_Store', '*.zip'], {
  cwd: distDir,
  stdio: 'inherit',
});
if (packed.status !== 0) {
  throw new Error(`zip failed with status ${packed.status}`);
}

const listed = spawnSync('unzip', ['-l', zipPath], { encoding: 'utf8' });
if (listed.status !== 0) throw new Error('unzip -l failed');

const names = listed.stdout.split('\n').map((line) => line.trim().split(/\s+/).pop() || '');
if (!names.includes('manifest.json')) {
  throw new Error('zip root must contain manifest.json');
}

console.log(`\n✅ Package created successfully: ${zipPath}`);
