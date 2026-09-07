import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
export const defaultProfile = () => join(homedir(),'Library/Application Support/operatus');
export function callOperator(profile,method,args) {
  if(!isAbsolute(profile))throw Error('Profile must be absolute');
  const path=join(profile,'operator-mcp','endpoint.json');
  const root=lstatSync(dirname(path));
  if(!root.isDirectory()||root.isSymbolicLink()||(root.mode&0o077)!==0||root.uid!==process.getuid?.())throw Error('Unsafe operator endpoint directory');
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  let endpoint;
  try {
    const s=fstatSync(fd);
    if(!s.isFile()||s.size>4096||(s.mode&0o077)!==0||s.uid!==process.getuid?.())throw Error('Unsafe operator endpoint file');
    endpoint=JSON.parse(readFileSync(fd,'utf8'));
  }finally{closeSync(fd);}
  if(endpoint.schema!==1||typeof endpoint.socketPath!=='string'||!isAbsolute(endpoint.socketPath)||
    !/^[a-f0-9]{64}$/.test(endpoint.token))throw Error('Unsupported operator endpoint');
  const socketInfo=lstatSync(endpoint.socketPath),parent=lstatSync(dirname(endpoint.socketPath));
  if(!socketInfo.isSocket()||socketInfo.uid!==process.getuid?.()||(socketInfo.mode&0o077)!==0||
    !parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==process.getuid?.()||(parent.mode&0o077)!==0)throw Error('Unsafe operator socket');
  return new Promise((resolve,reject)=>{
    const socket=connect(endpoint.socketPath);let bytes=Buffer.alloc(0),done=false;
    const finish=(error,result)=>{if(done)return;done=true;socket.destroy();error?reject(error):resolve(result);};
    socket.setTimeout(15000,()=>finish(Error('Operator request timed out. A start may have succeeded: retry only with the SAME requestId and parameters.')));
    socket.once('error',()=>finish(Error('Operatus is not reachable. Open the enabled local desktop.')));
    socket.once('connect',()=>socket.write(JSON.stringify({token:endpoint.token,method,args})+'\n'));
    socket.on('data',chunk=>{bytes=Buffer.concat([bytes,chunk]);if(bytes.length>2*1024*1024+1)finish(Error('Operator response exceeded limit'));});
    socket.once('end',()=>{
      try {const r=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(r.ok!==true)throw Error(r.error||'Operator request failed');finish(null,r.result);}
      catch(error){finish(error);}
    });
    socket.once('close',()=>{if(!done)finish(Error('Operator connection closed. Reconcile the same requestId before retrying a start.'));});
  });
}
