'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AGENT_MODELS, CODEX_MODELS, modelsForProvider } = require('./load-ts.cjs')('src/renderer/src/store/config.ts');
const { DEFAULT_CONDUCTOR_PROVIDER, DEFAULT_CONDUCTOR_MODEL, providerPreset } = require('./load-ts.cjs')('src/shared/agentProvider.ts');
const { subscriptionLaunchError } = require('./load-ts.cjs')('src/shared/billingPolicy.ts');

test('Claude catalog includes exact Fable 5.1 ID and retains pinned Fable 5', () => {
  assert.equal(AGENT_MODELS.find(model => model.id === 'claude-fable-5-1')?.label, 'Fable 5.1');
  assert.ok(AGENT_MODELS.some(model => model.id === 'claude-fable-5'));
  const ids = AGENT_MODELS.map(model => model.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('new model catalog entries cannot release subscription startup hold', () => {
  assert.ok(subscriptionLaunchError('claude'));
  assert.ok(subscriptionLaunchError('codex'));
});

test('Codex catalog includes all seven visible models inspected locally on 2026-09-07', () => {
  assert.deepEqual(CODEX_MODELS.filter(m => m.id).map(m => m.id), [
    'gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna',
    'gpt-5.5', 'gpt-5.4-mini', 'gpt-5.3-codex-spark',
  ]);
  assert.equal(new Set(CODEX_MODELS.map(m => m.id)).size, CODEX_MODELS.length);
});

test('Conductor default and provider-switch recommendation resolve to selectable Astra', () => {
  assert.equal(DEFAULT_CONDUCTOR_PROVIDER, 'codex');
  assert.equal(DEFAULT_CONDUCTOR_MODEL, 'gpt-6-astra');
  assert.equal(providerPreset('codex').recommendedOrchestratorModel, DEFAULT_CONDUCTOR_MODEL);
  for (const provider of ['codex', 'claude']) {
    assert.ok(modelsForProvider(provider).some(m => m.id === providerPreset(provider).recommendedOrchestratorModel));
  }
});

test('onboarding saves selected Conductor settings and labels subscription admission', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(require('node:path').join(__dirname, '../src/renderer/src/components/OnboardingWizard.tsx'), 'utf8');
  assert.match(source, /useState<AgentProvider>\(DEFAULT_CONDUCTOR_PROVIDER\)/);
  assert.match(source, /godProvider,\s+godModel,/);
  assert.match(source, /Every launch still requires subscription admission/);
  assert.doesNotMatch(source, /Opus 4\.8|TEN ENGINES/);
});
