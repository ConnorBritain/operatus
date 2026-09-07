'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  canAutomateTerminal,
  opensInteractiveTerminalUi,
  shouldFollowTerminalOutput,
  terminalAutomationBlock
} = loadTs('src/renderer/src/components/terminalAutomation.ts');

test('interactive provider commands pause queue automation', () => {
  assert.equal(opensInteractiveTerminalUi('/model'), true);
  assert.equal(opensInteractiveTerminalUi(' /provider '), true);
  assert.equal(opensInteractiveTerminalUi('/compact'), false);
  assert.equal(opensInteractiveTerminalUi('implement this'), false);
});

test('a command with an argument opens no picker to wait for', () => {
  // Only the BARE command opens a picker. `/model sonnet` applies the argument
  // and returns to the prompt, leaving no UI to close — but the picker latch is
  // cleared only by an Enter/Escape/Ctrl-C in that terminal, so latching here
  // wedged the agent's message queue permanently. Matching on the first token
  // alone is what caused it.
  assert.equal(opensInteractiveTerminalUi('/model sonnet'), false);
  assert.equal(opensInteractiveTerminalUi('/permissions allow'), false);
  assert.equal(opensInteractiveTerminalUi(' /provider anthropic '), false);
});

test('terminal automation waits for user drafts and interactive states', () => {
  const ready = { exited: false, pickerOpen: false, inputDirty: false, settleUntil: 0 };
  assert.equal(canAutomateTerminal(ready, 100), true);
  assert.equal(canAutomateTerminal({ ...ready, inputDirty: true }, 100), false);
  assert.equal(canAutomateTerminal({ ...ready, pickerOpen: true }, 100), false);
  assert.equal(canAutomateTerminal({ ...ready, exited: true }, 100), false);
  assert.equal(canAutomateTerminal({ ...ready, settleUntil: 101 }, 100), false);
});

test('an untouched draft keeps ownership after time away or sleep', () => {
  const typedAt = 1_000_000;
  const draft = {
    exited: false, pickerOpen: false, inputDirty: true,
    settleUntil: 0, inputDirtyAt: typedAt
  };
  // Fresh draft: the user is mid-sentence, automation must not type over it.
  assert.equal(canAutomateTerminal(draft, typedAt + 1), false);
  for (const elapsed of [1_800_000,86_400_000,1e9]) {
    assert.equal(canAutomateTerminal(draft, typedAt + elapsed), false);
    assert.equal(terminalAutomationBlock(draft, typedAt + elapsed), 'draft');
  }
  // Unknown timestamps do not grant ownership either.
  assert.equal(canAutomateTerminal({ ...draft, inputDirtyAt: undefined }, typedAt + 1e9), false);
});

test('an untouched picker remains held until an explicit release', () => {
  const openedAt = 1_000_000;
  const picker = {
    exited: false, pickerOpen: true, inputDirty: false,
    settleUntil: 0, pickerOpenedAt: openedAt
  };
  // While it is plausibly still open, automation must not type into the menu.
  assert.equal(canAutomateTerminal(picker, openedAt + 1), false);
  for (const elapsed of [1_800_000,86_400_000,1e9]) {
    assert.equal(canAutomateTerminal(picker, openedAt + elapsed), false);
    assert.equal(terminalAutomationBlock(picker, openedAt + elapsed), 'picker');
  }
  assert.equal(canAutomateTerminal({ ...picker, pickerOpenedAt: undefined }, openedAt + 1e9), false);
});

test('automation block reports why delivery is held', () => {
  const ready = { exited: false, pickerOpen: false, inputDirty: false, settleUntil: 0 };
  assert.equal(terminalAutomationBlock(ready, 100), null);
  assert.equal(terminalAutomationBlock({ ...ready, exited: true }, 100), 'exited');
  assert.equal(terminalAutomationBlock({ ...ready, pickerOpen: true }, 100), 'picker');
  assert.equal(terminalAutomationBlock({ ...ready, inputDirty: true }, 100), 'draft');
  assert.equal(terminalAutomationBlock({ ...ready, settleUntil: 101 }, 100), 'settling');
  // A picker outranks a draft: both are true while a slash menu is open.
  assert.equal(
    terminalAutomationBlock({ ...ready, pickerOpen: true, inputDirty: true }, 100),
    'picker'
  );
});

test('explicit release permits delivery after settling, never by elapsed ownership timeout', () => {
  const at = 1_000_000;
  const ready = { exited: false, pickerOpen: false, inputDirty: false, settleUntil: 0 };
  const draft = { ...ready, inputDirty: true, inputDirtyAt: at };
  const picker = { ...ready, pickerOpen: true, pickerOpenedAt: at };

  // Ten minutes in, both still belong to the user.
  assert.equal(canAutomateTerminal(draft, at + 600_000), false);
  assert.equal(canAutomateTerminal(picker, at + 600_000), false);

  const now=at+86_400_000;
  assert.equal(canAutomateTerminal({...draft,inputDirty:false,settleUntil:now+300},now),false);
  assert.equal(canAutomateTerminal({...draft,inputDirty:false,settleUntil:now+300},now+300),true);
  assert.equal(canAutomateTerminal({...picker,pickerOpen:false,settleUntil:now+500},now+500),true);
});

test('terminal output follows only when already at the bottom', () => {
  assert.equal(shouldFollowTerminalOutput(100, 100), true);
  assert.equal(shouldFollowTerminalOutput(99, 100), true);
  assert.equal(shouldFollowTerminalOutput(80, 100), false);
});

function recoveryFixture(write) {
  const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
  const file=path.join(__dirname,'../src/renderer/src/components/terminalPool.ts');
  const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
  const names=new Set(['recoverTerminalInput','clearTerminalDraft','dismissTerminalPicker','releasePickerBlock','automationStateOf','terminalAutomationBlockFor','resetTerminal']);
  const functions=source.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.has(node.name?.text));
  assert.equal(functions.length,names.size);
  const output=ts.transpileModule(functions.map(node=>node.getText(source)).join('\n'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={},pool=new Map(),entry={exited:false,generation:0,inputRevision:0,recoveryPending:false,
    inputDirty:true,inputDirtyAt:100,lineBuf:'original draft',automationBlocked:true,automationBlockedAt:100,automationSettleUntil:0};
  pool.set('fixture',entry);
  new Function('exports','pool','window','terminalAutomationBlock',output)(exports,pool,{cth:{writePty:write}},terminalAutomationBlock);
  return{...exports,entry,pool};
}

test('recovery keeps ownership until a successful write receipt and rejects duplicate recovery',async()=>{
  let resolve;const writes=[];
  const f=recoveryFixture((id,key)=>{writes.push([id,key]);return new Promise(r=>{resolve=r;});});
  const pending=f.clearTerminalDraft('fixture');
  assert.equal(f.terminalAutomationBlockFor('fixture'),'recovering');
  assert.equal(f.entry.lineBuf,'original draft');
  assert.equal((await f.dismissTerminalPicker('fixture')).ok,false);
  assert.deepEqual(writes,[['fixture','\x15']]);
  resolve({ok:true});
  assert.deepEqual(await pending,{ok:true,recoveredText:'original draft'});
  assert.equal(f.entry.inputDirty,false);assert.equal(f.entry.lineBuf,'');
  assert.equal(f.entry.automationBlocked,true,'Ctrl-U never releases the separate picker');
  assert.equal(f.entry.recoveryPending,false);
});

test('recovery rejection or transport exception preserves the prompt and menu',async()=>{
  for(const kind of ['clearTerminalDraft','dismissTerminalPicker'])for(const failure of ['rejection','exception']){
    const f=recoveryFixture(async()=>{if(failure==='exception')throw Error('transport lost');return{ok:false};});
    const before={...f.entry};
    const result=await f[kind]('fixture');
    assert.equal(result.ok,false);assert.ok(result.error);assert.equal(result.recoveredText,'');
    assert.deepEqual(f.entry,before);
    assert.equal(f.terminalAutomationBlockFor('fixture'),'picker');
  }
});

test('late recovery receipts cannot clear newer input or replacement terminal state',async()=>{
  for(const kind of ['clearTerminalDraft','dismissTerminalPicker'])for(const change of ['typing','same-text-new-revision','exit','respawn','replacement']){
    let resolve;const f=recoveryFixture(()=>new Promise(r=>{resolve=r;}));
    const pending=f[kind]('fixture');
    if(change==='typing'){f.entry.lineBuf+=' new input';f.entry.inputRevision++;}
    if(change==='same-text-new-revision')f.entry.inputRevision++;
    if(change==='exit')f.entry.exited=true;
    if(change==='respawn'){f.resetTerminal('fixture');f.entry.lineBuf='replacement draft';f.entry.inputDirty=true;}
    if(change==='replacement')f.pool.set('fixture',{...f.entry,recoveryPending:false,lineBuf:'replacement draft'});
    const before={...f.pool.get('fixture'),recoveryPending:false};
    resolve({ok:true});const result=await pending;
    assert.equal(result.ok,false,`${kind}: ${change}`);
    assert.equal(result.recoveredText,kind==='clearTerminalDraft'?'original draft':'');
    assert.deepEqual(f.pool.get('fixture'),before);
  }
});

test('picker acknowledgment releases only the picker and stale recovery makes no write',async()=>{
  const writes=[];const f=recoveryFixture(async(id,key)=>{writes.push(key);return{ok:true};});
  assert.equal((await f.dismissTerminalPicker('fixture')).ok,true);
  assert.deepEqual(writes,['\x1b']);
  assert.equal(f.entry.inputDirty,true);assert.equal(f.entry.lineBuf,'original draft');
  assert.equal(f.entry.automationBlocked,false);assert.ok(f.entry.automationSettleUntil>Date.now());
  assert.equal((await f.dismissTerminalPicker('fixture')).ok,false);
  f.entry.exited=true;assert.equal((await f.clearTerminalDraft('fixture')).ok,false);
  assert.equal((await f.clearTerminalDraft('missing')).ok,false);
  assert.deepEqual(writes,['\x1b']);
});

test('actual terminal pool never treats a blank cursor row or hidden view as surrender of a draft',()=>{
  const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
  const file=path.join(__dirname,'../src/renderer/src/components/terminalPool.ts');
  const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
  const names=new Set(['automationStateOf','hasTerminalDraft','isTerminalAutomationSafe','terminalAutomationBlockFor']);
  const functions=source.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.has(node.name?.text));
  assert.equal(functions.length,names.size);
  const output=ts.transpileModule(functions.map(node=>node.getText(source)).join('\n'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={},pool=new Map();let screenReads=0;
  new Function('exports','pool','canAutomateTerminal','terminalAutomationBlock',output)(exports,pool,canAutomateTerminal,terminalAutomationBlock);
  const entry={exited:false,inputDirty:true,inputDirtyAt:100,automationBlocked:false,automationBlockedAt:0,automationSettleUntil:0,
    term:{buffer:{active:{baseY:0,cursorY:0,getLine(){screenReads++;return{translateToString:()=>''};}}}}};
  pool.set('fixture',entry);
  for(const opened of [true,false])for(const now of [2_000,1_800_100,86_400_100]){
    entry.opened=opened;
    assert.equal(exports.hasTerminalDraft('fixture'),true);
    assert.equal(exports.isTerminalAutomationSafe('fixture',now),false);
    assert.equal(exports.terminalAutomationBlockFor('fixture',now),'draft');
  }
  assert.equal(screenReads,0,'cursor-row rendering is not input-ownership evidence');
  entry.inputDirty=false;entry.automationBlocked=true;entry.automationBlockedAt=100;
  assert.equal(exports.terminalAutomationBlockFor('fixture',86_400_100),'picker');
  entry.automationBlocked=false;assert.equal(exports.isTerminalAutomationSafe('fixture',86_400_100),true);
});
