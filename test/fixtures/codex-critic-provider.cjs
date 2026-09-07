'use strict';
const {Readable}=require('node:stream');
const {join}=require('node:path');
const load=require('../load-ts.cjs');
const {CodexAccountAdmission}=load('src/main/codexAccountAdmission.ts');
const {openCodexSubscriptionGateway}=load('src/main/codexSubscriptionGateway.ts');
const quote=value=>`'${value.replaceAll("'","'\\''")}'`;
// Only provider responses/account metadata are scripted. Native tools, control
// socket authentication, exact-artifact validation and lead decisions are real.
module.exports=function codexCriticProvider({backend,requests,results,requireSkills=true,beforeRequest}) {
  const accountId='fixture-codex';
  const token=`e30.${Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600,
    'https://api.openai.com/auth':{chatgpt_account_id:accountId}})).toString('base64url')}.synthetic`;
  const account=new CodexAccountAdmission({now:Date.now,readCredential:async()=>({auth_mode:'chatgpt',OPENAI_API_KEY:null,
    tokens:{account_id:accountId,access_token:token}}),metadata:async()=>({account_id:accountId,plan_type:'pro',
      credits:{has_credits:false,unlimited:false,balance:'0'},rate_limit:{allowed:true,limit_reached:false}})});
  return {account,inspect:async()=>({executables:[{path:process.env.OPERATUS_CODEX_PROBE_PATH,
    sha256:process.env.OPERATUS_CODEX_PROBE_SHA256,versionObservation:{status:'reported',version:'0.153.4'}}]}),
    gateway:async(config,prepared)=>{
      const launch=prepared.launch;let script,count=0;
      const respond=body=>{
        if(++count>20)throw Error('Bounded Codex fixture requests exceeded');
        requests.push({at:Date.now(),runId:launch.runId,launchId:launch.id,role:'critic',provider:'codex',sessionId:launch.sessionId});
        for(const item of body.input??[]) if(item.type==='custom_tool_call_output') {
          const text=typeof item.output==='string'?item.output:item.output.map(part=>part.text??'').join('\n');
          results.set(item.call_id,{text:text.slice(0,2000),error:/"exit_code"\s*:\s*[1-9]/.test(text)});
        }
        if(!script && body.generate!==false) {
          const snapshot=backend.status(launch.runId),revise=snapshot.run.repairRound===0;
          const skillPath=JSON.stringify(body).match(/\/[^"\s]+\/skills\/fixture-guide\/SKILL\.md/)?.[0];
          if(requireSkills && !skillPath)throw Error('Codex was not given locked skill guidance');
          const payload={artifactSha:launch.expectedSha,contractDigest:snapshot.run.contract.digest,verdict:revise?'REVISE':'PASS',
            summary:'Scripted independent-provider review',findings:revise?[{id:'wrong',severity:'major',title:'Wrong value',evidence:'value.txt is changed',criterionIds:['value']}]:[]};
          script=[...(skillPath?[
            [`skill-read-${launch.id}`,`/bin/cat ${quote(skillPath)}`],
            [`skill-support-${launch.id}`,`/bin/cat ${quote(join(skillPath,'..','support.md'))}`],
            [`skill-deny-${launch.id}`,`chmod u+w ${quote(skillPath)} && printf tampered > ${quote(skillPath)}`]
            ]:[]),
            [`read-${launch.id}`,`/bin/cat ${quote(join(launch.worktreePath,'value.txt'))}`],
            [`evidence-${launch.id}`,`/bin/cat ${quote(join(launch.reviewEvidence.directory,'manifest.json'))}`],
            [`report-${launch.id}`,`"$HIVE_NODE" "$OPERATUS_GAUNTLET_HELPER" critic --run ${launch.runId} --launch ${launch.id} --json ${quote(JSON.stringify(payload))}`]
          ];
        }
        const next=body.generate===false?null:script.find(([id])=>!results.has(id));
        const final='Scripted native transport, not live judgment.';
        const item=next?{id:`ct_${next[0]}`,type:'custom_tool_call',call_id:next[0],namespace:'functions',name:'exec',status:'completed',
          input:`text(await tools.exec_command(${JSON.stringify({cmd:next[1],shell:'/bin/sh',login:false,yield_time_ms:1000})}));`}:
          {id:`msg_${count}`,type:'message',role:'assistant',phase:'final_answer',status:'completed',content:[{type:'output_text',text:final,annotations:[]}]};
        const response={id:`resp_${launch.id}_${count}`,object:'response',created_at:Math.floor(Date.now()/1000),model:config.model,status:'completed',
          output:[item],usage:{input_tokens:10,output_tokens:10,total_tokens:20}};
        return [{type:'response.created',response:{...response,status:'in_progress',output:[]}},
          {type:'response.output_item.added',output_index:0,item:{...item,status:'in_progress',content:[]}},
          ...(next?[]:[{type:'response.output_text.delta',item_id:item.id,output_index:0,content_index:0,delta:final}]),
          {type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}];
      };
      return openCodexSubscriptionGateway({...config,transport:{
        http:async request=>{await beforeRequest?.(launch,request.signal);return {status:200,contentType:'text/event-stream',body:Readable.from(respond(JSON.parse(request.body)).map(event=>Buffer.from(`data: ${JSON.stringify(event)}\n\n`)))};},
        websocket:async()=>({async *exchange(bytes,signal){await beforeRequest?.(launch,signal);for(const event of respond(JSON.parse(bytes)))yield Buffer.from(JSON.stringify(event));},close(){}})
      }});
    }};
};
