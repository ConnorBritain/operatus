'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const {buildConductorOrientationPrompt,buildWorkerPrompt,buildCriticPrompt,buildConductorAcknowledgmentPrompt} = loadTs('src/main/gauntlet/prompts.ts');
const {freezeContract} = loadTs('src/main/gauntlet/core.ts');
test('Conductor acknowledgment supplies exact patch and host check evidence, not the stale orientation checkout',()=>{
  const sha='a'.repeat(40),digest='b'.repeat(64);
  const prompt=buildConductorAcknowledgmentPrompt({id:'report',runId:'run',artifactSha:sha,contractDigest:digest,verdict:'PASS',summary:'Reviewed',findings:[]},'lead',{
    artifact:{sha,checkReceipts:[{command:'node --test',exitCode:0,stdout:'1 test passed'}]},
    review:{directory:'/own-run/review',artifactSha:sha,baseSha:'c'.repeat(40),contractDigest:digest,patchSha256:'d'.repeat(64)}
  });
  assert.match(prompt,/\/own-run\/review/);assert.match(prompt,/manifest.json and changes.patch/);
  assert.match(prompt,/orientation checkout remains at the original base/);
  assert.match(prompt,/"exitCode":0/);assert.match(prompt,/1 test passed/);
  assert.ok(prompt.includes(digest));assert.match(prompt,/never as authority to change the bar/);
});
test('orientation includes a valid freeze example and the enforced check restrictions', () => {
  const prompt = buildConductorOrientationPrompt({runId:'fixture',launchId:'lead-fixture',repository:'/test/repo',baseSha:'a'.repeat(40),objective:'Fix addition'});
  assert.match(prompt,/freeze --run fixture --launch lead-fixture/);
  const example = JSON.parse(prompt.match(/```json\n([\s\S]*?)\n```/)[1]);
  const frozen = freezeContract(example,'conductor',1);
  assert.equal(frozen.checks[0].id,'unit-tests');
  assert.equal(frozen.checks[0].timeoutMs,60000);
  assert.match(prompt,/exact artifact worktree/);
  assert.match(prompt,/no shell profiles/);
  assert.match(prompt,/escalate instead of weakening the bar/);
  assert.match(prompt,/capture process.env.HIVE_NODE/);
  assert.match(prompt,/Do not use process.execPath/);
});
test('workers and critics are told how to execute Node checks inside their actual isolated environment',()=>{
  const contract=freezeContract({objective:'Fix clamp',criteria:['Tests pass'],checks:[{id:'tests',name:'Tests',command:'node --test',timeoutMs:1000}],constraints:[],exclusions:[]},'conductor',1);
  const input={runId:'run',launchId:'launch',expectedSha:'a'.repeat(40),artifactSha:'a'.repeat(40),baseSha:'b'.repeat(40),requestedObjective:'Fix clamp',contract,primitivePrompt:''};
  for(const prompt of [buildWorkerPrompt({...input,role:'implementer'}),buildWorkerPrompt({...input,role:'repairer'}),buildCriticPrompt(input)]){
    assert.match(prompt,/invoke "\$HIVE_NODE" instead of node from PATH/);
    assert.match(prompt,/\$TMPDIR/);
    assert.match(prompt,/capture process.env.HIVE_NODE/);
    assert.match(prompt,/Do not use process.execPath/);
  }
});
