'use strict';
const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const manifest=JSON.parse(fs.readFileSync('manifest.json','utf8'));
for(const [file,digest] of Object.entries(manifest.files))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),digest,`Evidence changed: ${file}`);
const text=fs.readFileSync('QA.md','utf8');assert.ok(text.length>=800&&text.length<=24000,'Bounded substantive report required');
for(const heading of ['Verdict','Verified behavior','Findings','Not proven','Next acceptance run'])assert.ok(text.toLowerCase().includes(heading.toLowerCase()),`Missing ${heading}`);
assert.ok(/synthetic/i.test(text)&&/concurren/i.test(text),'Evidence limitations must be explicit');
assert.ok(Object.keys(manifest.files).filter(file=>text.includes(file)).length>=4,'At least four concrete source/evidence citations required');
console.log('Evidence digests and report structure verified; factual and visual judgments still require the independent Critic.');
