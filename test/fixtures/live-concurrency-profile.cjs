'use strict';
// Already-onboarded disposable workspace. No run, auth, or scheduling state.
module.exports = (home, repositories) => ({
  onboardingComplete:true, harnessHome:home, recentHives:[home], registeredRepos:repositories,
  missions:[], opsStandupSeeded:true, heartbeatSeeded:true, semanticMemory:false,
  reflectEnabled:false, notifications:false, telemetryEnabled:false, autoUpdate:false,
  freeflowEnabled:false, realtimeVoiceEnabled:false
});
