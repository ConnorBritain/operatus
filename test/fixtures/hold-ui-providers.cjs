'use strict';
// Test-process-only transform. Never writes the compiled application or adds a
// production environment switch. Synthetic UI profiles must not run providers.
module.exports = function holdUiProviders(source) {
  const gate = /function isolatedGauntletLaunchError\(platform\) \{\n  return platform === "darwin" \? null : "Isolated subscription Gauntlets currently require macOS\.";\n\}/g;
  if ([...source.matchAll(gate)].length !== 1) throw Error('Compiled UI fixture launch gate changed; refuse to start');
  return source.replace(gate, 'function isolatedGauntletLaunchError(platform) { return "Synthetic UI fixture: providers are disabled."; }');
};
