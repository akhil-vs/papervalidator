'use strict';

/**
 * Angular 9 builds with webpack 4, which hashes with MD4.
 * Node 17+ ships OpenSSL 3 and rejects MD4 unless the legacy provider is on.
 * Child processes (Terser, differential loading) inherit NODE_OPTIONS.
 */
const { spawn } = require('child_process');
const path = require('path');

const env = Object.assign({}, process.env);
const nodeMajor = Number(process.versions.node.split('.')[0]);

if (nodeMajor >= 17) {
  const flag = '--openssl-legacy-provider';
  const parts = (env.NODE_OPTIONS || '').split(/\s+/).filter(Boolean);
  if (!parts.includes(flag)) {
    parts.push(flag);
  }
  env.NODE_OPTIONS = parts.join(' ');
}

const ngBin = path.join(__dirname, '..', 'node_modules', '@angular', 'cli', 'bin', 'ng');

const child = spawn(process.execPath, [ngBin, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
});

child.on('exit', (code) => {
  process.exit(code == null ? 1 : code);
});
