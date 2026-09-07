'use strict';
// Isolate application data, not production provider behavior.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.OPERATUS_LIVE_CONCURRENCY_ROOT;
if (process.env.OPERATUS_LIVE_CONCURRENCY !== '1' || !root ||
    !path.basename(root).startsWith('op-live-concurrency-') ||
    !fs.existsSync(path.join(root, 'fixture.json'))) throw Error('Explicit disposable live fixture required');
app.setPath('userData', path.join(root, 'profile'));
app.setAppPath(path.resolve(__dirname, '../..'));
// Do not register a test instance as the user's protocol handler.
app.setAsDefaultProtocolClient = () => false;
require('../../out/main/index.js');
