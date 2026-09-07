'use strict';
const { spawn } = require('node:child_process');
// Keep the real Seatbelt policy and runtime executable, but substitute a small
// synthetic protocol-speaking root. Its child is a real OS process in that
// detached root's group, deliberately holding stdout and ignoring SIGTERM.
module.exports = function processTreeSpawner({ pidPath, tickPath, persistent = false, waitForStop = false }) {
  return (command, args, options) => {
    const id=args[args.indexOf('--session-id')+1], node=options.env.HIVE_NODE;
    const descendant=`const fs=require('node:fs');process.on('SIGTERM',()=>{});
      fs.writeFileSync(${JSON.stringify(pidPath)},String(process.pid));
      setInterval(()=>fs.appendFileSync(${JSON.stringify(tickPath)},'x'),25);setTimeout(()=>process.exit(0),5000);`;
    const code=`const fs=require('node:fs'),{spawn}=require('node:child_process');
      function work(){
        spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{env:process.env,stdio:['ignore',1,2]});
        const timer=setInterval(()=>{if(!fs.existsSync(${JSON.stringify(pidPath)}))return;clearInterval(timer);
          if(${waitForStop}){setInterval(()=>{},1000);return;}
          process.stdout.write(JSON.stringify({type:'result',session_id:${JSON.stringify(id)},is_error:false,result:'fixture'})+'\\n');
          ${persistent ? '' : 'process.exit(0);'}
        },10);
      }
      ${persistent ? "require('node:readline').createInterface({input:process.stdin}).once('line',work).on('close',()=>process.exit(0));" : "process.stdin.resume();process.stdin.once('end',work);"}`;
    return spawn(command,[...args.slice(0,2),node,'-e',code],options);
  };
};
