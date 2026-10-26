#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { discover, request } = require('./pink-automation/client.cjs');

async function main() {
    if (process.argv.slice(2).some(arg => arg !== '--url-only')) throw new Error('Usage: node tools/preview-game.cjs [--url-only]');
    const project = path.resolve(__dirname, '..');
    const entry = await discover(project);
    const response = await request(entry, { jsonrpc: '2.0', id: 'game-preview', method: 'tools/call', params: { name: 'pink_preview_state', arguments: {} } });
    if (response.error || response.result?.isError) throw new Error('Cannot query the Pink preview server. Open this project in Pink first.');
    const state = response.result.structuredContent ?? JSON.parse(response.result.content[0].text);
    if (!state.server?.url) throw new Error('Pink preview server is not running. Open this project in Pink first.');
    const url = new URL(state.server.url);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Expected a local Pink preview server.');
    const scene = JSON.parse(await fs.readFile(path.join(project, 'assets/main.scene.meta'), 'utf8'));
    if (!scene.uuid) throw new Error('The main scene is not imported. Wait for Pink to finish importing it.');
    url.searchParams.set('scene', scene.uuid);
    console.log(url.href);
    if (process.argv.includes('--url-only')) return;

    // The browser owns this game session; switching Pink editors cannot dispose it.
    const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url.href] : [url.href];
    await new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: 'ignore', windowsHide: true });
        child.once('error', reject);
        child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Browser launch failed (${code}). Open the URL above manually.`)));
    });
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
