'use strict';

const { spawn } = require('child_process');
const path = require('path');

const env = Object.assign({}, process.env);
const legacy = '--openssl-legacy-provider';
env.NODE_OPTIONS = [env.NODE_OPTIONS, legacy].filter(Boolean).join(' ');
env.PORT = env.PORT || '3333';
env.HOST = env.HOST || '0.0.0.0';

const api = spawn(process.execPath, [path.join('server', 'index.js')], { stdio: 'inherit', env });
const ui = spawn(process.execPath, [
  path.join('node_modules', '@angular', 'cli', 'bin', 'ng.js'),
  'serve',
  '--port', '4200'
], { stdio: 'inherit', env });

function shutdown() {
  api.kill('SIGTERM');
  ui.kill('SIGTERM');
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

api.on('exit', code => {
  if (code) {
    shutdown();
    process.exit(code);
  }
});
