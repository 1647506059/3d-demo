#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');
const { normalize } = require('./extension/core.cjs');

async function discover(projectPath) {
  const dir = path.join(os.homedir(), '.pink-automation', 'instances');
  const candidates = [];
  for (const name of await fs.readdir(dir).catch(() => [])) {
    if (!name.endsWith('.json')) continue;
    try {
      const entry = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
      if (normalize(entry.projectPath) !== normalize(projectPath)) continue;
      const url = new URL(entry.url);
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') continue;
      process.kill(entry.pid, 0);
      candidates.push(entry);
    } catch {}
  }
  candidates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const entry of candidates) {
    try { await request(entry, { jsonrpc: '2.0', id: 'probe', method: 'ping' }, 3000); return entry; } catch {}
  }
  throw new Error('No live Pink automation bridge for this project. Open this project in Pink with SUD.pink-automation-bridge enabled; if just installed, reload the Pink window.');
}
async function request(entry, message, timeout = 120000) {
  const response = await fetch(entry.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${entry.token}` }, body: JSON.stringify(message), signal: AbortSignal.timeout(timeout) });
  if (message.id === undefined && response.status === 202) return null;
  if (!response.ok) throw new Error(`Bridge HTTP ${response.status}. Do not retry a dispatched mutation without checking its result.`);
  return response.json();
}
async function main(argv) {
  const at = argv.indexOf('--project');
  const project = at < 0 ? process.cwd() : argv.splice(at, 2)[1];
  if (argv.includes('--stdio')) {
    const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
        const entry = await discover(project);
        const response = await request(entry, message);
        if (response) process.stdout.write(JSON.stringify(response) + '\n');
      } catch (e) {
        if (message?.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: e.message } }) + '\n');
      }
    }
    return;
  }
  const command = argv[0] || 'status';
  let name, input = {};
  if (command === 'status') name = 'pink_status';
  else if (command === 'list') { const result = await request(await discover(project), { jsonrpc: '2.0', id: 1, method: 'tools/list' }); console.log(JSON.stringify(result.result, null, 2)); return; }
  else if (command === 'capabilities') { name = 'pink_capabilities'; if (argv[1]) input.query = argv[1]; }
  else if (command === 'describe') { name = 'pink_describe'; input.name = argv[1]; }
  else if (command === 'call') {
    name = argv[1];
    const index = argv.indexOf('--input-file');
    if (index >= 0) input = JSON.parse(await fs.readFile(argv[index + 1], 'utf8'));
    else if (argv[2]) throw new Error('Pass JSON arguments using --input-file <file>');
  } else throw new Error('Commands: status, list, capabilities [filter], describe <name>, call <tool> --input-file <file>, --stdio');
  const response = await request(await discover(project), { jsonrpc: '2.0', id: crypto.randomUUID(), method: 'tools/call', params: { name, arguments: input } });
  if (response.error) throw new Error(response.error.message);
  if (response.result.isError) throw new Error(response.result.content.map(c => c.text || '').join('\n'));
  const result = response.result.structuredContent;
  if (result) console.log(JSON.stringify(result, null, 2));
  else if (response.result.content[0]?.type === 'text') { const value = JSON.parse(response.result.content[0].text); console.log(JSON.stringify(value, null, 2)); }
  else console.log(JSON.stringify(response.result, null, 2));
}
if (require.main === module) main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { discover, request };
