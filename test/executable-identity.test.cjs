'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {join}=require('node:path'),{tmpdir}=require('node:os'),{createHash}=require('node:crypto');
const {copyPinnedNativeExecutable,hashExecutable}=require('./load-ts.cjs')('src/main/executableIdentity.ts');
test('bounded native copy retains identity and exclusive destination errors',async()=>{
 const root=fs.mkdtempSync(join(tmpdir(),'op-copy-identity-')),source=join(root,'source'),destination=join(root,'copy');
 // Native magic is enough for identity handling; these bytes are never executed.
 const bytes=Buffer.concat([Buffer.from('cffaedfe','hex'),Buffer.alloc(65536,42)]);
 fs.writeFileSync(source,bytes);const digest=createHash('sha256').update(bytes).digest('hex');
 await copyPinnedNativeExecutable(source,destination,digest);
 assert.equal(await hashExecutable(destination),digest);
 assert.equal(fs.statSync(destination).mode&0o777,0o500);
 for(let n=0;n<3;n++) await assert.rejects(copyPinnedNativeExecutable(source,destination,digest),{code:'EEXIST'});
 assert.deepEqual(fs.readFileSync(destination),bytes);
 await assert.rejects(copyPinnedNativeExecutable(source,join(root,'bad-digest'),'0'.repeat(64)),{status:'identity-changed'});
 assert.equal(await hashExecutable(source),digest);
});
