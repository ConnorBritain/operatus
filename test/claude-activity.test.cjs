'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const load=require('./load-ts.cjs');
const {claudeActivity}=load('src/main/claudeActivity.ts');
const message=(type,content,session_id='own')=>({type,session_id,message:{content}});
test('activity is correlated, deduplicated and never forwards tool IDs, names, inputs or output',()=>{
  const events=[],observe=claudeActivity('own',e=>events.push(e));
  const tool={type:'tool_use',id:'private-id',name:'Bash',input:{command:'private command and token'}};
  observe(message('assistant',[tool])); observe(message('assistant',[tool]));
  observe(message('user',[{type:'tool_result',tool_use_id:'unknown',content:'private output'}]));
  observe(message('user',[{type:'tool_result',tool_use_id:'private-id',is_error:true,content:'private output'}]));
  observe(message('user',[{type:'tool_result',tool_use_id:'private-id'}]));
  assert.deepEqual(events,[{type:'tool_activity',ordinal:1,activity:'executing',stage:'requested'},
    {type:'tool_activity',ordinal:2,activity:'executing',stage:'result',outcome:'error'}]);
  assert.equal(JSON.stringify(events).includes('private'),false);
});
test('foreign or unbound sessions and model prose cannot invent activity',()=>{
  const events=[],observe=claudeActivity('own',e=>events.push(e));
  for(const event of [null,{},message('assistant',[{type:'tool_use',id:'x',name:'Read'}],'peer'),
    {type:'assistant',message:{content:[{type:'tool_use',id:'x',name:'Read'}]}},message('assistant',[{type:'text',text:'I am editing'}]),
    message('system',[{type:'tool_use',id:'x',name:'Read'}])]) observe(event);
  assert.deepEqual(events,[]);
});
test('tool vocabulary is closed and each session has its own sequence',()=>{
  const events=[],observe=claudeActivity('own',e=>events.push(e));
  ['Read','Glob','Grep','Write','Edit','Bash','secret tool name'].forEach((name,n)=>observe(message('assistant',[{type:'tool_use',id:String(n),name}])));
  assert.deepEqual(events.map(e=>e.activity),['reading','searching','searching','editing','editing','executing','tool']);
  const next=[];claudeActivity('own',e=>next.push(e))(message('assistant',[{type:'tool_use',id:'0',name:'Read'}]));assert.equal(next[0].ordinal,1);
});
test('observer state is bounded and persistence failure is not swallowed',()=>{
  const observe=claudeActivity('own',()=>{});
  for(let n=0;n<1024;n++) observe(message('assistant',[{type:'tool_use',id:String(n),name:'Read'}]));
  assert.throws(()=>observe(message('assistant',[{type:'tool_use',id:'overflow',name:'Read'}])),/limit/);
  assert.throws(()=>claudeActivity('own',()=>{throw Error('journal failed')})(message('assistant',[{type:'tool_use',id:'x',name:'Read'}])),/journal failed/);
});
