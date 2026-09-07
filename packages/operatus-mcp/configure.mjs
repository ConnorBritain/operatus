#!/usr/bin/env node
import { existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { defaultProfile } from './client.mjs';
const args=process.argv.slice(2),roots=[];let profile=defaultProfile();
for(let i=0;i<args.length;i+=2){
  if(!args[i+1]||!isAbsolute(args[i+1]))throw Error('Usage: node configure.mjs [--profile /absolute/profile] [--allow-repository /absolute/repo-or-parent] ...');
  if(args[i]==='--profile')profile=args[i+1];
  else if(args[i]==='--allow-repository')roots.push(realpathSync(args[i+1]));
  else throw Error('Unknown setup argument');
}
if(process.platform!=='darwin')throw Error('Current runtime supports macOS only');
if(roots.length>64)throw Error('At most 64 repository roots');
if(!existsSync(profile))throw Error('Open Operatus once to create its profile before enabling MCP');
const root=join(profile,'operator-mcp');mkdirSync(root,{recursive:true,mode:0o700});
const s=lstatSync(root);if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o077)!==0||s.uid!==process.getuid())throw Error('Unsafe operator config directory');
writeFileSync(join(root,'config.json'),JSON.stringify({enabled:true,repositoryRoots:roots},null,2)+'\n',{flag:'wx',mode:0o600});
console.log(`Enabled local operator MCP. Restart Operatus. Allowed roots: ${roots.join(', ')||'(none; observation only)'}. Existing configuration is never overwritten.`);
