import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
test('stdio handshake works without desktop; unavailable app and invalid tools fail honestly',async()=>{
  const profile=mkdtempSync(join(tmpdir(),'op-mcp-offline-'));
  const client=new Client({name:'protocol-test',version:'1'});
  try {
    await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../server.mjs',import.meta.url)),'--profile',profile]}));
    const tools=await client.listTools();assert.equal(tools.tools.length,5);
    assert.equal(tools.tools.find(t=>t.name==='operatus_start').annotations.readOnlyHint,false);
    const offline=await client.callTool({name:'operatus_status',arguments:{}});assert.equal(offline.isError,true);assert.match(offline.content[0].text,/unavailable/);
    const invalid=await client.callTool({name:'operatus_start',arguments:{repository:'/tmp'}});assert.equal(invalid.isError,true);
    const authority=await client.callTool({name:'acknowledge',arguments:{}});assert.equal(authority.isError,true);
  }finally{await client.close();rmSync(profile,{recursive:true,force:true});}
});
