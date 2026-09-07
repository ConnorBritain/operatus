'use strict';
// Invoked with the real Electron binary, WITHOUT inspector/CDP or Playwright.
const {app}=require('electron');
const fs=require('node:fs');const {join,resolve,basename}=require('node:path');
const root=process.env.OPERATUS_QUIT_FIXTURE_ROOT;
if(!root||!basename(root).startsWith('operatus-quit-smoke-')||!fs.statSync(root).isDirectory())throw Error('Disposable root required');
const profile=join(root,'profile');fs.mkdirSync(profile,{recursive:true});
if(process.env.OPERATUS_QUIT_FIXTURE_INITIALIZED==='1') {
  const home=join(root,'harness');fs.mkdirSync(home);
  fs.writeFileSync(join(profile,'config.json'),JSON.stringify({
    onboardingComplete:true,harnessHome:home,recentHives:[home],registeredRepos:[],
    missions:[],opsStandupSeeded:true,heartbeatSeeded:true,semanticMemory:false,
    reflectEnabled:false,notifications:false,telemetryEnabled:false,autoUpdate:false,
    freeflowEnabled:false,realtimeVoiceEnabled:false
  }));
}
const log=(kind,details={})=>console.log('QUIT_SMOKE '+JSON.stringify({kind,at:Date.now(),...details}));
const nativeQuit=app.quit.bind(app);
app.quit=()=>{log('quit-call');nativeQuit();};
app.setPath('userData',profile);app.setAppPath(resolve(__dirname,'../..'));
// Do not replace the user's operatus:// association with a disposable launcher.
app.setAsDefaultProtocolClient=()=>false;
let requested=false;
app.on('browser-window-created',(_event,win)=>{
  win.webContents.once('did-finish-load',()=>{
    setTimeout(async()=>{
      if(requested)return;requested=true;
      try {
        const ptys=await win.webContents.executeJavaScript('window.cth.listPtys()');
        log('ready',{ptyCount:ptys.length});
        if(ptys.length)throw Error('Unexpected PTYs in empty fixture');
        if(process.env.OPERATUS_QUIT_FIXTURE_INITIALIZED==='1') {
          const socket=require('node:net').createConnection(join(profile,'control','gauntlet.sock'));
          socket.on('error',error=>log('socket-error',{message:error.message}));
          await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
          socket.once('close',()=>log('control-client-closed'));
          socket.write('{"action":');
          log('control-client-connected');
        }
        log('request',{mode:process.env.OPERATUS_QUIT_FIXTURE_MODE??'app-quit'});
        setTimeout(()=>log('still-alive',{windows:require('electron').BrowserWindow.getAllWindows().length}),6000).unref();
        if(process.env.OPERATUS_QUIT_FIXTURE_MODE==='confirmed')void win.webContents.executeJavaScript('window.cth.confirmClose()').catch(()=>{});
        else app.quit();
      }catch(error){log('error',{message:error.message});}
    },1000);
  });
});
require('../../out/main/index.js');
app.on('before-quit',event=>log('before-quit',{prevented:event.defaultPrevented}));
app.on('will-quit',event=>log('will-quit',{prevented:event.defaultPrevented}));
app.on('quit',(_event,exitCode)=>log('quit',{exitCode}));
process.on('exit',exitCode=>log('process-exit',{exitCode}));
