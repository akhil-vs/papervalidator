'use strict';

const { spawn } = require('child_process');
const path = require('path');

const env = Object.assign({}, process.env, {
  PORT: process.env.PORT || '3333',
  HOST: process.env.HOST || '0.0.0.0'
});

const api = spawn(process.execPath, [path.join('server', 'index.js')], { stdio: 'inherit', env });
const ui = spawn(process.execPath, [
  path.join('scripts', 'with-openssl-legacy.js'),
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
