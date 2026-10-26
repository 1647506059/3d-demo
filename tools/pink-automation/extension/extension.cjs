'use strict';
const vscode = require('vscode');
const pink = require('pink');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const catalog = require('./catalog.json');
const { normalize, digest, readOnly, assertJson, validateArgs, snapshot, Tickets } = require('./core.cjs');

const tools = [];
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const string = { type: 'string' };
const operationSchema = object({ kind: { enum: ['api', 'sceneMethod', 'sceneInvoke', 'preview'] }, path: string, args: { type: 'array', items: {} }, bindingId: string, target: string, method: string, params: {}, action: string, scene: string }, ['kind']);
function tool(name, description, schema, readOnlyHint = false) { tools.push({ name, description, inputSchema: schema, annotations: { readOnlyHint, openWorldHint: false } }); }
tool('pink_status', 'Query this bridge, active project, engine, server, and opened scene Runtime references.', object({}), true);
tool('pink_capabilities', 'List installed PinK SDK methods, Scene commands, and all 103 native-tool workflows. Filter by keyword or domain.', object({ query: string, domain: string }), true);
tool('pink_describe', 'Read exact installed API signatures, Scene invoke parameters, or TypeScript type declarations before invoking. Examples: assets.queryAssetInfo, scene.node.create-by-type, scene.SceneInstance, _cli.IAnimationOperationOptions.', object({ name: string }), true);
tool('pink_call', 'Run a read-only operation. Writes require pink_prepare then pink_commit. Use kind=api with SDK path and positional args, sceneMethod with bindingId/path/args, or sceneInvoke with bindingId/target/method/params.', operationSchema, true);
tool('pink_prepare', 'Prepare one exact mutation authorized by the user. Captures project, Runtime generation, scene revision, file/meta revisions and operation arguments. Returns a one-use ticket. Does not execute the mutation.', object({ operation: operationSchema }, ['operation']), true);
tool('pink_commit', 'Execute exactly the operation held by a pink_prepare ticket. Rejects changed Runtime/project/files. Tickets are single-use; after an uncertain outcome query before retrying.', object({ ticket: string }, ['ticket']));
tool('pink_scene_bind', 'Open or focus an explicit Scene/Prefab in this project and return a bindingId tied to its exact Runtime generation. Never follows active-editor changes.', object({ urlOrUUID: string }, ['urlOrUUID']));
tool('pink_scene_unbind', 'Release this bridge binding without saving or closing the user editor.', object({ bindingId: string }, ['bindingId']));
tool('pink_scene_screenshot', 'Capture the exact bound scene viewport using the Pink Runtime screenshot command.', object({ bindingId: string }, ['bindingId']), true);
tool('pink_preview_state', 'Query Pink editor-preview running/paused state and server URL.', object({}), true);
tool('pink_diagnostics', 'Read VS Code diagnostics in this project and recent bridge events. This is not proof of runtime rendering.', object({ limit: { type: 'integer', minimum: 1, maximum: 200 } }), true);

let service;
class Bridge {
  constructor(context) { this.context = context; this.bindings = new Map(); this.tickets = new Tickets(); this.events = []; this.running = false; this.epoch = 0; }
  log(event, details) { this.events.push({ time: new Date().toISOString(), event, details }); if (this.events.length > 100) this.events.shift(); }
  async project() {
    const project = await pink.workspace.getActiveProject();
    if (!project?.path || normalize(project.path) !== normalize(this.projectPath)) throw new Error('The active Pink project changed; reconnect the bridge for the intended project');
    return project;
  }
  async start() {
    const project = await pink.workspace.getActiveProject();
    if (!project?.path) throw new Error('Open a Pink project before starting the automation bridge');
    this.projectPath = project.path;
    this.token = crypto.randomBytes(32).toString('hex');
    this.id = crypto.randomUUID();
    this.registry = path.join(os.homedir(), '.pink-automation', 'instances', `${digest(normalize(project.path)).slice(0, 16)}-${process.pid}.json`);
    this.context.subscriptions.push(pink.workspace.onDidChangeActiveProject(() => { this.epoch++; this.tickets.items.clear(); }));
    this.context.subscriptions.push(pink.workspace.onDidChangeProject(() => { this.epoch++; this.tickets.items.clear(); }));
    this.server = http.createServer((req, res) => this.handleHttp(req, res));
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(0, '127.0.0.1', resolve); });
    await fs.mkdir(path.dirname(this.registry), { recursive: true });
    const entry = { id: this.id, pid: process.pid, projectPath: this.projectPath, url: `http://127.0.0.1:${this.server.address().port}/mcp`, token: this.token, version: '0.1.0', updatedAt: new Date().toISOString() };
    await fs.writeFile(this.registry, JSON.stringify(entry, null, 2), { mode: 0o600 });
    this.log('ready', { projectPath: this.projectPath, apiMethods: Object.values(catalog.namespaces).reduce((n, v) => n + Object.keys(v).length, 0) });
    this.context.subscriptions.push({ dispose: () => this.dispose() });
    console.log(`[pink-automation] ready for ${this.projectPath} on port ${this.server.address().port}`);
  }
  async dispose() {
    for (const b of this.bindings.values()) b.subscription?.dispose();
    this.bindings.clear(); this.tickets.items.clear(); this.server?.close();
    if (this.registry) await fs.unlink(this.registry).catch(() => {});
  }
  binding(id) {
    const binding = this.bindings.get(id);
    if (!binding) throw new Error('Unknown bindingId; call pink_scene_bind');
    const instance = pink.scene.resolveSceneInstance(binding.runtimeRef);
    if (!instance || digest(instance.runtimeRef) !== digest(binding.runtimeRef)) throw new Error('The scene Runtime changed; bind again before continuing');
    return { binding, instance };
  }
  meta(op) {
    assertJson(op);
    if (!op || !['api', 'sceneMethod', 'sceneInvoke', 'preview'].includes(op.kind)) throw new Error('Invalid operation kind');
    if (op.kind === 'api') {
      const [ns, name, extra] = String(op.path).split('.');
      const meta = !extra && catalog.namespaces[ns]?.[name];
      if (!meta || typeof pink[ns]?.[name] !== 'function') throw new Error('API is not in the installed automation catalog');
      validateArgs(meta, op.args || []);
      return { readOnly: readOnly(name), meta, call: () => pink[ns][name](...(op.args || [])) };
    }
    if (op.kind === 'preview') {
      if (!['start', 'stop', 'pause', 'resume', 'step'].includes(op.action)) throw new Error('Unsupported preview action');
      return { readOnly: false, call: () => this.preview(op) };
    }
    const { binding, instance } = this.binding(op.bindingId);
    if (op.kind === 'sceneMethod') {
      const meta = catalog.sceneMethods[op.path];
      if (!meta || typeof instance[op.path] !== 'function') throw new Error('Unknown SceneInstance method');
      validateArgs(meta, op.args || []);
      return { binding, readOnly: readOnly(op.path), meta, call: () => instance[op.path](...(op.args || [])) };
    }
    const meta = catalog.invokes[op.target]?.[op.method];
    if (!meta) throw new Error('Unknown Scene invoke target or command; use pink_describe');
    if (meta.params !== 'void' && !meta.params.includes('undefined') && op.params === undefined) throw new Error(`Scene command requires params of type ${meta.params}`);
    return { binding, readOnly: readOnly(op.method), meta, call: () => instance.invoke(op.target, op.method, op.params) };
  }
  async value(result) {
    result = await result;
    if (result?.[Symbol.asyncIterator]) { const items = []; for await (const item of result) items.push(item); return items; }
    return result === undefined ? null : result;
  }
  async guards(op) {
    await this.project();
    const files = new Map();
    const addFile = (f, shallow = false) => { if (typeof f === 'string' && path.isAbsolute(f)) { files.set(f, shallow); files.set(`${f}.meta`, false); } };
    const scan = async (v, shallow = false) => {
      if (typeof v === 'string') {
        if (path.isAbsolute(v)) addFile(v, shallow);
        else if (v.startsWith('db://') || /^[\da-f-]{32,36}$/i.test(v)) {
          const info = await pink.assets.queryAssetInfo(v);
          if (info?.readonly) throw new Error(`Resource is read-only: ${v}`);
          if (info?.file) addFile(info.file, shallow);
          else if (v.startsWith('db://assets/')) addFile(path.join(this.projectPath, 'assets', v.slice(12)));
        }
      } else if (Array.isArray(v)) { for (const x of v) await scan(x); }
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'content' && k !== 'data' && k !== 'declaration') await scan(x);
    };
    if (op.kind === 'api') {
      if (op.path.startsWith('assets.') && !['assets.refresh', 'assets.createAssetByType'].includes(op.path)) {
        const roots = await pink.assets.queryAssetDBInfos();
        for (const arg of op.args || []) if (typeof arg === 'string') {
          if (/^db:\/\/[^/]+\/?$/.test(arg) || Object.values(roots).some(r => path.isAbsolute(arg) && normalize(arg) === normalize(r.target))) throw new Error('Asset mutations cannot target an asset database root; refresh is the supported exception');
          if (arg.toLowerCase().endsWith('.meta')) throw new Error('Asset mutations must target the main resource, not its .meta directly');
        }
      }
      for (let i = 0; i < (op.args || []).length; i++) {
        const p = this.meta(op).meta.params[i];
        if (!/^(data|content|text|material|patch|userData)$/.test(p?.name || '')) await scan(op.args[i], op.path === 'assets.createAssetByType' && i === 1);
      }
      if (op.path.startsWith('configuration.')) {
        files.set(path.join(this.projectPath, 'settings'), false);
        files.set(path.join(this.projectPath, 'profiles'), false);
      }
      if (op.path === 'assets.updateDefaultUserData') files.set(path.join(this.projectPath, '.creator/default-meta.json'), false);
    }
    const result = { epoch: this.epoch, projectPath: normalize(this.projectPath), files: {}, binding: null };
    for (const [f, shallow] of files) {
      const dirtyText = vscode.workspace.textDocuments.some(d => d.isDirty && normalize(d.uri.fsPath) === normalize(f));
      const dirtyTab = vscode.window.tabGroups.all.some(g => g.tabs.some(t => t.isDirty && t.input?.uri?.fsPath && normalize(t.input.uri.fsPath) === normalize(f)));
      if (dirtyText || dirtyTab) throw new Error(`The resource has an unsaved editor draft: ${f}`);
      result.files[f] = await snapshot(f, shallow);
    }
    if (op.bindingId) {
      const { binding, instance } = this.binding(op.bindingId);
      result.binding = { id: op.bindingId, runtimeRef: binding.runtimeRef, revision: binding.revision };
      if (op.target === 'particle') result.selection = await instance.getSelection();
      if (op.target === 'animation') result.animationSession = await instance.invoke('animation', 'query-session');
      if (op.target === 'reference-image') result.referenceImage = await instance.invoke('reference-image', 'query');
      if (['node', 'component', 'prefab'].includes(op.target)) {
        const params = op.params || {};
        const paths = [...(params.paths || []), ...[params.nodePath, params.nodePath ? undefined : params.path, params.parentPath].filter(p => typeof p === 'string')];
        for (const p of paths) {
          if (op.target === 'node' && ['delete', 'cut', 'duplicate'].includes(op.method) && ['', '/'].includes(p)) throw new Error('This command cannot target the scene root');
          if (!(await instance.query({ path: p, kind: 'auto' }))) throw new Error(`Scene target does not exist: ${p}`);
        }
      }
    }
    if (op.kind === 'preview') result.preview = await this.previewState();
    return result;
  }
  async validateGuards(op, saved) {
    const current = await this.guards(op);
    if (digest(saved) !== digest(current)) throw new Error('The prepared target, revision, project, or preview state changed; query current state and prepare again');
  }
  async previewState() {
    const [active, paused, server] = await Promise.all([vscode.commands.executeCommand('pink.scene.preview.isActive'), vscode.commands.executeCommand('pink.scene.preview.isPaused'), pink.server.getInfo()]);
    return { active: !!active, paused: !!paused, server: server || null };
  }
  async preview(op) {
    const state = await this.previewState();
    if (op.action === 'start' && !state.active) {
      if (op.scene) await vscode.commands.executeCommand('pink.scene.preview.play', op.scene);
      else await vscode.commands.executeCommand('pink.titleToolbar.preview.editorPreview');
    } else if (op.action === 'stop' && state.active) await vscode.commands.executeCommand('pink.scene.preview.stop');
    else if (op.action === 'pause' && state.active && !state.paused || op.action === 'resume' && state.active && state.paused) await vscode.commands.executeCommand('pink.scene.preview.pauseToggle');
    else if (op.action === 'step') await vscode.commands.executeCommand('pink.scene.preview.step', op.scene);
    return this.previewState();
  }
  async execute(name, input) {
    await this.project();
    if (name === 'pink_status') {
      const [project, engine, server, scenes] = await Promise.all([this.project(), pink.engine.getInfo(), pink.server.getInfo(), pink.scene.queryOpenedScenes()]);
      return { bridgeId: this.id, project, engine, server, pinkVersion: catalog.pinkVersion, openedScenes: scenes.map(s => s.runtimeRef), bindings: [...this.bindings].map(([id, b]) => ({ bindingId: id, runtimeRef: b.runtimeRef, revision: b.revision })) };
    }
    if (name === 'pink_capabilities') {
      const q = (input.query || '').toLowerCase();
      const entries = [];
      for (const [ns, methods] of Object.entries(catalog.namespaces)) for (const [n, m] of Object.entries(methods)) entries.push({ kind: 'api', name: `${ns}.${n}`, domain: ns, readOnly: readOnly(n), description: m.description.slice(0, 200) });
      for (const [target, methods] of Object.entries(catalog.invokes)) for (const [method, m] of Object.entries(methods)) entries.push({ kind: 'sceneInvoke', name: `scene.${target}.${method}`, domain: target, readOnly: readOnly(method), description: m.description.slice(0, 200) });
      for (const [n, m] of Object.entries(catalog.sceneMethods)) entries.push({ kind: 'sceneMethod', name: `scene.${n}`, domain: 'scene', readOnly: readOnly(n), description: m.description.slice(0, 200) });
      return { pinkVersion: catalog.pinkVersion, sourceSha256: catalog.sourceSha256, counts: { api: Object.values(catalog.namespaces).reduce((n, x) => n + Object.keys(x).length, 0), sceneMethods: Object.keys(catalog.sceneMethods).length, sceneCommands: Object.values(catalog.invokes).reduce((n, x) => n + Object.keys(x).length, 0), nativeWorkflows: catalog.nativeTools.length }, entries: entries.filter(e => (!input.domain || e.domain === input.domain) && (!q || `${e.name} ${e.description}`.toLowerCase().includes(q))), nativeWorkflows: catalog.nativeTools.filter(e => !q || `${e.name} ${e.documentation}`.toLowerCase().includes(q)) };
    }
    if (name === 'pink_describe') {
      const p = input.name.split('.');
      const meta = catalog.types[input.name] || catalog.nativeTools.find(t => t.name === input.name) || (p.length === 2 && catalog.namespaces[p[0]]?.[p[1]]) || (p[0] === 'scene' && p.length === 2 && catalog.sceneMethods[p[1]]) || (p[0] === 'scene' && catalog.invokes[p[1]]?.[p[2]]);
      if (!meta) throw new Error('Unknown installed type/API/workflow');
      return meta;
    }
    if (name === 'pink_call') {
      const meta = this.meta(input);
      if (!meta.readOnly) throw new Error('This is a mutation; use pink_prepare then pink_commit');
      const result = await this.value(meta.call());
      return meta.binding ? { runtimeRef: meta.binding.runtimeRef, revision: meta.binding.revision, result } : result;
    }
    if (name === 'pink_prepare') {
      const op = input.operation;
      const meta = this.meta(op);
      if (meta.readOnly) throw new Error('Read-only operation; call pink_call directly');
      if (this.running) throw new Error('A mutation is still running; inspect status before preparing another');
      const guards = await this.guards(op);
      return { ticket: this.tickets.issue(op, guards), expiresInSeconds: 600, operation: op, guards, savesScene: op.kind === 'sceneMethod' && op.path === 'save', note: 'Preparation does not grant user authorization. Commit only within the user-authorized task.' };
    }
    if (name === 'pink_commit') {
      if (this.running) throw new Error('Another mutation is running');
      const item = this.tickets.consume(input.ticket);
      const op = item.operation;
      this.running = true;
      let dispatched = false;
      try {
        await this.validateGuards(op, item.guards);
        const meta = this.meta(op);
        dispatched = true;
        const result = await this.value(meta.call());
        if (meta.binding) meta.binding.revision++;
        this.log('mutation-completed', { kind: op.kind, path: op.path, target: op.target, method: op.method, action: op.action });
        return { status: 'completed', result, ...(meta.binding ? { runtimeRef: meta.binding.runtimeRef, revision: meta.binding.revision } : {}) };
      } catch (e) {
        this.log(dispatched ? 'mutation-unconfirmed' : 'mutation-rejected', { message: e.message });
        if (dispatched) throw new Error(`Operation was dispatched; outcome is unconfirmed. Query before retrying. ${e.message}`);
        throw e;
      } finally { this.running = false; }
    }
    if (name === 'pink_scene_bind') {
      if (typeof input.urlOrUUID !== 'string' || !input.urlOrUUID.trim()) throw new Error('A specific Scene URL or UUID is required');
      const instance = await pink.scene.open(input.urlOrUUID, { openEditor: true });
      await this.project();
      const bindingId = crypto.randomUUID();
      const binding = { runtimeRef: instance.runtimeRef, revision: 0 };
      binding.subscription = instance.onDidChange(() => { binding.revision++; });
      this.bindings.set(bindingId, binding);
      return { bindingId, runtimeRef: binding.runtimeRef, revision: binding.revision };
    }
    if (name === 'pink_scene_unbind') { const b = this.bindings.get(input.bindingId); b?.subscription?.dispose(); this.bindings.delete(input.bindingId); return { unbound: !!b }; }
    if (name === 'pink_scene_screenshot') {
      const { binding } = this.binding(input.bindingId);
      const image = await vscode.commands.executeCommand('pink.scene.captureScreenshotByRuntime', binding.runtimeRef);
      if (!image || image.mimeType !== 'image/png' || typeof image.data !== 'string' || !Buffer.from(image.data, 'base64').subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Pink did not return a valid PNG screenshot');
      return image;
    }
    if (name === 'pink_preview_state') return this.previewState();
    if (name === 'pink_diagnostics') {
      const limit = Math.min(200, Math.max(1, input.limit || 100));
      const items = vscode.languages.getDiagnostics().filter(([uri]) => normalize(uri.fsPath).startsWith(`${normalize(this.projectPath)}/`)).flatMap(([uri, values]) => values.map(d => ({ file: uri.fsPath, line: d.range.start.line + 1, column: d.range.start.character + 1, severity: d.severity, source: d.source, code: d.code, message: d.message })));
      return { total: items.length, items: items.slice(0, limit), recentEvents: this.events.slice(-20) };
    }
    throw new Error('Unknown bridge tool');
  }
  async rpc(message) {
    if (message.method?.startsWith('notifications/')) return null;
    if (message.method === 'initialize') return { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'pink-automation', version: '0.1.0' } };
    if (message.method === 'ping') return {};
    if (message.method === 'tools/list') return { tools };
    if (message.method === 'tools/call') {
      try {
        const result = await this.execute(message.params.name, message.params.arguments || {});
        const content = result?.mimeType === 'image/png' && result.data ? [{ type: 'image', mimeType: result.mimeType, data: result.data }] : [{ type: 'text', text: JSON.stringify(result) }];
        return { content, ...(content[0].type === 'text' && result && typeof result === 'object' && !Array.isArray(result) ? { structuredContent: result } : {}) };
      } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
    }
    throw new Error('Unknown JSON-RPC method');
  }
  async handleHttp(req, res) {
    const token = req.headers.authorization?.replace(/^Bearer /, '') || '';
    const expected = Buffer.from(this.token), actual = Buffer.from(token);
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected) || req.headers.origin) { res.writeHead(403); res.end(); return; }
    if (req.method !== 'POST' || req.url !== '/mcp') { res.writeHead(404); res.end(); return; }
    let chunks = [], size = 0;
    try {
      for await (const chunk of req) { size += chunk.length; if (size > 32 * 1024 * 1024) throw new Error('Request too large'); chunks.push(chunk); }
      const message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const result = await this.rpc(message);
      if (result === null) { res.writeHead(202); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
    } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: e.message } })); }
  }
}
async function activate(context) { service = new Bridge(context); try { await service.start(); } catch (e) { console.error('[pink-automation] startup failed:', e); throw e; } }
async function deactivate() { await service?.dispose(); }
module.exports = { activate, deactivate };
