'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const transform=require('./fixtures/hold-ui-providers.cjs');
const source='function isolatedGauntletLaunchError(platform) {\n  return platform === "darwin" ? null : "Isolated subscription Gauntlets currently require macOS.";\n}';
test('synthetic desktop fixture always denies live launches without changing production output',()=>{
  const held=transform(source);
  const gate=new Function(held+';return isolatedGauntletLaunchError;')();
  for(const platform of ['darwin','linux','win32'])assert.match(gate(platform),/providers are disabled/);
  assert.match(source,/\? null/);
});
test('missing, duplicated or changed compiled gate refuses fixture startup',()=>{
  for(const sourceText of ['',source+source,source.replace('darwin','other')])assert.throws(()=>transform(sourceText),/refuse to start/);
});
