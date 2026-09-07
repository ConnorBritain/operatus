const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-ts.cjs');
const {defaultRunProviders}=load('src/renderer/src/gauntlet/providerDefaults.ts');
const {codexConductorModel,CODEX_CONDUCTOR_MODELS}=load('src/shared/codexConductor.ts');
test('new runs default to Astra, retain explicit preferences and keep builders independent',()=>{
  const defaults=defaultRunProviders();assert.deepEqual(defaults.conductor,{provider:'codex',model:'gpt-6-astra'});
  assert.equal(defaults.implementer.provider,'claude');assert.equal(defaults.repairer.provider,'claude');
  assert.equal(defaults.critic.provider,'codex');
  assert.deepEqual(defaultRunProviders({godProvider:'claude',godModel:'claude-fable-5-1'}).conductor,{provider:'claude',model:'claude-fable-5-1'});
  assert.equal(defaultRunProviders({godProvider:'codex',godModel:'gpt-5.6-sol'}).conductor.model,'gpt-5.6-sol');
});
test('Conductor model validation preserves exact choices and rejects fallback',()=>{
  assert.equal(codexConductorModel(),'gpt-6-astra');
  for(const model of CODEX_CONDUCTOR_MODELS) assert.equal(codexConductorModel(model),model);
  for(const model of ['','other','gpt-reserve','codex-auto-review'])assert.throws(()=>codexConductorModel(model),/no fallback/);
});
