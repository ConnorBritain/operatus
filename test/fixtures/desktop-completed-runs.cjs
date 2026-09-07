'use strict';
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path');
const root=process.env.OPERATUS_COMPLETED_RUN_ROOT;
if(!root||!path.basename(root).startsWith('op-live-concurrency-'))throw Error('Disposable completed-run profile required');
const profile=path.join(root,'profile');
const db=new (require('better-sqlite3'))(path.join(profile,'gauntlet.db'),{readonly:true,fileMustExist:true});
try{
 const rows=db.prepare('SELECT status FROM gauntlet_runs').all();
 if(rows.length!==3||rows.some(r=>r.status!=='passed'))throw Error('Read-only UI verification requires three passed runs and no active work');
}finally{db.close();}
app.setPath('userData',profile);app.setAppPath(path.resolve(__dirname,'../..'));
app.setAsDefaultProtocolClient=()=>false;
require('../../out/main/index.js');
