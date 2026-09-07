import { createServer, type Server, type Socket } from 'node:net';
import { chmodSync, constants, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { join, isAbsolute } from 'node:path';
import type { OperatorPolicy } from './operatorService';

export const OPERATOR_MAX_RESPONSE = 2 * 1024 * 1024;
function privateDirectory(path: string) {
  const s=lstatSync(path);
  if(!s.isDirectory() || s.isSymbolicLink() || (s.mode&0o077)!==0 || s.uid!==process.getuid?.())throw Error('Operator directory must be owner-only (0700)');
}
export function readOperatorPolicy(profile: string): OperatorPolicy | null {
  const root=join(profile,'operator-mcp'),path=join(root,'config.json');
  if(!existsSync(path))return null;
  privateDirectory(root);
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const s=fstatSync(fd);
    if(!s.isFile() || s.size>16384 || (s.mode&0o077)!==0 || s.uid!==process.getuid?.())throw Error('Operator config must be an owner-only regular file');
    const p=JSON.parse(readFileSync(fd,'utf8'));
    if(p.enabled===false)return null;
    if(p.enabled!==true || Object.keys(p).some(k=>!['enabled','repositoryRoots'].includes(k)) || !Array.isArray(p.repositoryRoots) ||
      p.repositoryRoots.length>64 || p.repositoryRoots.some((r:unknown)=>typeof r!=='string'||!isAbsolute(r)))throw Error('Invalid operator policy');
    return p;
  }finally{closeSync(fd);}
}

/** Operator authority is deliberately separate from the agent control socket.
 * No TCP listener; token and socket are private to this OS account and app life. */
export class OperatorServer {
  private server: Server | null=null;
  private directory='';
  private token=randomBytes(32).toString('hex');
  private sockets=new Set<Socket>();
  private endpointFile: string;
  constructor(private profile:string,private dispatch:(method:string,args:unknown)=>unknown){
    this.endpointFile=join(profile,'operator-mcp','endpoint.json');
  }
  async start() {
    if(process.platform!=='darwin')throw Error('Local operator MCP execution currently supports macOS only');
    const root=join(this.profile,'operator-mcp');mkdirSync(root,{recursive:true,mode:0o700});privateDirectory(root);
    if(existsSync(this.endpointFile)) {
      const s=lstatSync(this.endpointFile);
      if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid?.()||s.size>4096)throw Error('Unsafe previous operator endpoint');
      const previous=JSON.parse(readFileSync(this.endpointFile,'utf8'));
      if(Number.isSafeInteger(previous.pid)&&previous.pid>1) {
        let alive=true;
        try{process.kill(previous.pid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')alive=false;}
        if(alive)throw Error('An operator endpoint may already be active for this profile');
      }
    }
    this.directory=realpathSync(mkdtempSync('/tmp/op-o-'));chmodSync(this.directory,0o700);
    const socketPath=join(this.directory,'s');
    this.server=createServer(socket=>{
      if(this.sockets.size>=16){socket.destroy();return;}
      this.sockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>this.sockets.delete(socket));
      socket.setTimeout(5000,()=>socket.destroy());
      let bytes=Buffer.alloc(0),handled=false;
      socket.on('data',chunk=>{
        if(handled){socket.destroy();return;}
        bytes=Buffer.concat([bytes,chunk]);if(bytes.length>65536){socket.destroy();return;}
        const end=bytes.indexOf(10);if(end<0)return;
        handled=true;
        let response:unknown;
        try {
          if(end!==bytes.length-1)throw Error('One request per connection required');
          const r=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,end)));
          if(!r || typeof r!=='object' || Array.isArray(r) || Object.keys(r).some(k=>!['token','method','args'].includes(k)))throw Error('Invalid operator request');
          if(typeof r.token!=='string' || r.token.length!==64 || !timingSafeEqual(Buffer.from(r.token),Buffer.from(this.token)))throw Error('Invalid operator authentication');
          if(typeof r.method!=='string')throw Error('Invalid operator method');
          response={ok:true,result:this.dispatch(r.method,r.args)};
        }catch(error){response={ok:false,error:error instanceof Error?error.message:'Operator request failed'};}
        let output=JSON.stringify(response);
        if(Buffer.byteLength(output)>OPERATOR_MAX_RESPONSE)output=JSON.stringify({ok:false,error:'Evidence exceeds the 2 MiB response limit; inspect the desktop or request evidence:false. Nothing was truncated into a success.'});
        socket.end(output+'\n');
      });
    });
    await new Promise<void>((resolve,reject)=>{this.server!.once('error',reject);this.server!.listen(socketPath,()=>{this.server!.off('error',reject);resolve();});});
    chmodSync(socketPath,0o600);
    // A stale file is not trusted; replace only a regular owner-owned endpoint.
    if(existsSync(this.endpointFile)) {
      const s=lstatSync(this.endpointFile);
      if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid?.())throw Error('Unsafe previous operator endpoint');
      unlinkSync(this.endpointFile);
    }
    writeFileSync(this.endpointFile,JSON.stringify({schema:1,pid:process.pid,socketPath,token:this.token}),{flag:'wx',mode:0o600});
  }
  async stop() {
    const server=this.server;this.server=null;
    if(existsSync(this.endpointFile)) {
      try {const e=JSON.parse(readFileSync(this.endpointFile,'utf8'));if(e.token===this.token)unlinkSync(this.endpointFile);}catch{/* retain unrecognized data */}
    }
    for(const s of this.sockets)s.destroy();
    if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));
    if(this.directory)try{rmdirSync(this.directory);}catch{/* retain unexpected contents */}
  }
}
