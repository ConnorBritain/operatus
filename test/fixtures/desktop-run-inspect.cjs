'use strict';
const { app } = require('electron');
const fs = require('node:fs');
const { join, basename, resolve } = require('node:path');
const root = process.env.OPERATUS_RUN_INSPECT_ROOT;
if (!root || !basename(root).startsWith('operatus-run-control-') || !fs.existsSync(join(root, 'receipt.json'))) {
  throw Error('Disposable run-control fixture required');
}
app.setPath('userData', join(root, 'profile'));
app.setAppPath(resolve(__dirname, '../..'));
app.setAsDefaultProtocolClient = () => false;
const Module = require('node:module');
const entry = require.resolve('../../out/main/index.js');
const previous = Module._extensions['.js'];
Module._extensions['.js'] = (mod, filename) => {
  if (filename !== entry) return previous(mod, filename);
  mod._compile(require('./hold-ui-providers.cjs')(fs.readFileSync(filename, 'utf8')), filename);
};
try { require(entry); } finally { Module._extensions['.js'] = previous; }
