'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), net = require('node:net'), { randomUUID } = require('node:crypto');
const load = require('./load-ts.cjs');
const { hookSocketPath, prepareHookSocketDirectory } = load('src/main/hookSocket.ts');
const { HookServer } = load('src/main/hooks.ts');
const { HiveManager } = load('src/main/hive.ts');
const posix = {skip:process.platform==='win32',timeout:10000};
function fixture(t) {
  const hive = new HiveManager(() => '/a/very/long/'+ 'nested-project/'.repeat(20)+randomHome);
  const randomHome = randomUUID();
  const socket = hive.sockPath();
  const server = new HookServer(hive, () => null, () => ({notifications:false}));
  t.after(() => server.stop());
  return {hive,socket,server};
}
const connect = path => new Promise((resolve,reject) => {
  const socket=net.createConnection(path);socket.once('error',reject);socket.once('connect',()=>resolve(socket));
});
const listen = (server,path) => new Promise((resolve,reject)=>{server.once('error',reject);server.listen(path,resolve);});
const close = server => new Promise(resolve=>server.close(resolve));
test('deep and multibyte homes get short endpoints stable only within their Hive instance',posix,()=>{
  const root='/deep/'+'é'.repeat(200),hive=new HiveManager(()=>root),other=new HiveManager(()=>root);
  assert.equal(hive.sockPath(),hive.sockPath());assert.notEqual(hive.sockPath(),other.sockPath());
  assert.ok(Buffer.byteLength(hive.sockPath())<=100);
  assert.notEqual(hookSocketPath(root,'one'),hookSocketPath(root+'other','one'));
  assert.equal(hookSocketPath(root,'one','win32'),hookSocketPath(root,'two','win32'));
  assert.match(hookSocketPath(root,'one','win32'),/^\\\\\.\\pipe\\operatus-/);
  assert.throws(()=>prepareHookSocketDirectory('/tmp/not-our-hook.sock'),/Invalid/);
});
test('actual Unix listener handles requests and survives repeated serialized starts/stops',posix,async t=>{
  const {socket,server}=fixture(t);
  for(let i=0;i<3;i++) {
    await Promise.all([server.start(),server.start()]);
    assert.ok(fs.lstatSync(socket).isSocket());
    const client=await connect(socket);client.end('{}\n');
    const reply=await new Promise((resolve,reject)=>{let body='';client.on('data',x=>body+=x);client.once('error',reject);client.once('close',()=>resolve(body));});
    assert.deepEqual(JSON.parse(reply),{});
    await server.stop();assert.equal(fs.existsSync(socket),false);
  }
});
test('a competing listener is not removed on failed start or stop; retry works after its owner closes',posix,async t=>{
  const {socket,server}=fixture(t);prepareHookSocketDirectory(socket);
  const peer=net.createServer(client=>client.end('peer'));
  await listen(peer,socket);t.after(()=>close(peer));
  await assert.rejects(server.start(),/EADDRINUSE/);await server.stop();
  assert.ok(fs.lstatSync(socket).isSocket());
  const client=await connect(socket);await new Promise(resolve=>{client.resume();client.once('close',resolve);});
  await close(peer);await server.start();await server.stop();
});
test('foreign regular files and symlinks survive failed binding and shutdown',posix,async t=>{
  const {socket,server}=fixture(t);prepareHookSocketDirectory(socket);
  fs.writeFileSync(socket,'keep me',{flag:'wx'});t.after(()=>{if(fs.existsSync(socket))fs.unlinkSync(socket);});
  await assert.rejects(server.start(),/EADDRINUSE/);await server.stop();assert.equal(fs.readFileSync(socket,'utf8'),'keep me');
  fs.unlinkSync(socket);fs.symlinkSync('/nonexistent-operatus-test-target',socket);
  await assert.rejects(server.start());await server.stop();assert.equal(fs.readlinkSync(socket),'/nonexistent-operatus-test-target');
  fs.unlinkSync(socket);
});
test('partial clients cannot stall shutdown and home changes cannot unlink a different endpoint',posix,async t=>{
  const {socket,server,hive}=fixture(t);await server.start();
  const client=await connect(socket);client.on('error',()=>{});client.write('{');
  const closed=new Promise(resolve=>client.once('close',resolve));
  const next=hookSocketPath('/next-home',randomUUID());fs.writeFileSync(next,'unrelated',{flag:'wx'});t.after(()=>fs.unlinkSync(next));
  hive.sockPath=()=>next;
  await assert.rejects(server.start(),/Stop the hook server/);
  await server.stop();await closed;
  assert.equal(fs.existsSync(socket),false);assert.equal(fs.readFileSync(next,'utf8'),'unrelated');
});
test('immediate stop and restart serialize behind in-flight listen',posix,async t=>{
  const {socket,server}=fixture(t);
  await Promise.all([server.start(),server.stop(),server.start()]);
  const client=await connect(socket);client.destroy();await server.stop();
  assert.equal(fs.existsSync(socket),false);
});
