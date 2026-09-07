'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const fonts={
  'inter-latin-var.woff2':'c940764593d0fe5d596be327ca7558855e018039fb78509aa21921fd3644c3e4',
  'jetbrains-mono-latin-var.woff2':'2c32b9b3ee358c119e210f6f5195f9bd34894d78a785ff2e95d60e718e400af4',
  'press-start-2p-latin-400.woff2':'42144b97bd2942ea606e5d880684eae0f7be5c804bdd57b1faac5a8d7699ae6e'
};
const hash=b=>createHash('sha256').update(b).digest('hex');
test('all three local font binaries match the inspected stable upstream files',()=>{
  let bytes=0;
  for(const [name,digest]of Object.entries(fonts)) {
    const buffer=fs.readFileSync(path.join(root,'src/renderer/src/assets/fonts',name));
    assert.equal(buffer.subarray(0,4).toString(),'wOF2');assert.equal(hash(buffer),digest);bytes+=buffer.length;
  }
  assert.equal(bytes,84476);
});
test('entrypoint and typography use local fonts without Google font CSP permissions',()=>{
  const html=read('src/renderer/index.html'),css=read('src/renderer/src/design/fonts.css');
  assert.doesNotMatch(html,/fonts\.(googleapis|gstatic)\.com/);
  assert.match(html,/font-src 'self';/);assert.match(html,/style-src 'self' 'unsafe-inline';/);
  assert.match(html,/href="\.\/src\/design\/fonts\.css"/);
  assert.match(read('src/renderer/src/design/global.css'),/@import '\.\/fonts\.css'/);
  for(const name of Object.keys(fonts))assert.ok(css.includes(`../assets/fonts/${name}`));
  assert.equal((css.match(/@font-face/g)||[]).length,3);
  assert.equal((css.match(/font-weight: 400 700/g)||[]).length,2);
  assert.equal((css.match(/font-display: swap/g)||[]).length,3);
});
test('font attribution and complete OFL notice are supplied as a public build asset',()=>{
  const license=read('src/renderer/public/third-party-fonts.txt');
  for(const text of ['Cody "CodeMan38" Boisclair','The Inter Project Authors','The JetBrains Mono Project Authors',
    'SIL OPEN FONT LICENSE Version 1.1','PERMISSION & CONDITIONS','TERMINATION','DISCLAIMER','OTHER DEALINGS IN THE FONT SOFTWARE.'])assert.ok(license.includes(text));
  assert.match(read('src/renderer/index.html'),/rel="license" href="\.\/third-party-fonts\.txt"/);
  assert.match(read('electron-builder.yml'),/out\/\*\*/);
});
test('compiled CSS resolves all local font assets and the notice survives the production build',{
  skip:process.env.OPERATUS_VERIFY_FONT_BUILD!=='1'
},()=>{
  const output=path.join(root,'out/renderer'),files=fs.readdirSync(path.join(output,'assets'));
  const css=files.filter(name=>name.endsWith('.css')).map(name=>fs.readFileSync(path.join(output,'assets',name),'utf8')).join('\n');
  const html=fs.readFileSync(path.join(output,'index.html'),'utf8');
  assert.doesNotMatch(css+html,/https?:\/\/fonts\.(googleapis|gstatic)\.com/);
  const references=[...css.matchAll(/url\(["']?([^\)"']+\.woff2)["']?\)/g)].map(m=>m[1]);
  assert.equal(new Set(references).size,3);
  const observed=new Set(references.map(ref=>{
    assert.ok(!/^(?:[a-z]+:|\/\/)/i.test(ref),'font URL must be local');
    const file=ref.startsWith('/')?path.join(output,ref):path.resolve(output,'assets',ref);
    assert.ok(file.startsWith(output+path.sep));return hash(fs.readFileSync(file));
  }));
  assert.deepEqual(observed,new Set(Object.values(fonts)));
  assert.equal(fs.readFileSync(path.join(output,'third-party-fonts.txt'),'utf8'),read('src/renderer/public/third-party-fonts.txt'));
});
