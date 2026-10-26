'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const app = process.argv[2];
if (!app) throw new Error('Usage: node build-catalog.cjs <PinK resources/app>');
const ts = require(path.join(app, 'extensions/node_modules/typescript/lib/typescript.js'));
const dtsPath = path.join(app, 'out/pink-dts/pink.internal-automation.d.ts');
const text = fs.readFileSync(dtsPath, 'utf8');
const source = ts.createSourceFile(dtsPath, text, ts.ScriptTarget.Latest, true);
const namespaces = {};
const types = {};
const invokes = {};
const sceneMethods = {};
const docs = node => (node.jsDoc || []).map(d => typeof d.comment === 'string' ? d.comment : '').join('\n');
const param = p => ({ name: p.name.getText(source), type: p.type?.getText(source) || 'unknown', optional: !!p.questionToken || !!p.initializer, rest: !!p.dotDotDotToken });
const excluded = /^(?:register|contribute|on[A-Z]|getToolSet|createToolSet|createWebview|createBatch|executeBatch|applyBatch|reconcileLocalization|generateThumbnail|exportAssetPackage)/;
const allowedNamespaces = new Set(['engine', 'assets', 'configuration', 'system', 'builder', 'server', 'workspace', 'clipboard', 'lifecycle']);
function walk(node, ns = []) {
  if (ts.isModuleDeclaration(node)) {
    const name = node.name.text;
    ts.forEachChild(node, c => walk(c, name === 'pink' ? ns : [...ns, name]));
    return;
  }
  const namespace = ns.join('.');
  if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
    const name = `${namespace}.${node.name.text}`;
    types[name] = { name, description: docs(node), declaration: node.getText(source) };
    if (name === 'scene.InvokeAPIMap') {
      for (const group of node.members) {
        const target = group.name.text;
        invokes[target] = {};
        for (const m of group.type.members) {
          if (!m.type?.typeArguments) continue;
          invokes[target][m.name.text] = { target, method: m.name.text, params: m.type.typeArguments[0].getText(source), returns: m.type.typeArguments[1].getText(source), description: docs(m) };
        }
      }
    }
    if (name === 'scene.SceneInstance') {
      for (const m of node.members) {
        if (!ts.isMethodSignature(m) || m.name.text === 'invoke') continue;
        const name = m.name.text;
        if (!sceneMethods[name]) sceneMethods[name] = { name, params: m.parameters.map(param), returns: m.type?.getText(source), description: docs(m) };
      }
    }
  }
  if (ts.isFunctionDeclaration(node) && allowedNamespaces.has(namespace) && !excluded.test(node.name.text)) {
    const name = node.name.text;
    if (namespace === 'workspace' && !/^(get|query)/.test(name)) return;
    if (namespace === 'system' && name === 'restart') return;
    if (namespace === 'lifecycle' && name !== 'getModuleState') return;
    if (node.parameters.some(p => /=>|Callback|Provider/.test(p.type?.getText(source) || ''))) return;
    (namespaces[namespace] ||= {})[name] = { path: `${namespace}.${name}`, params: node.parameters.map(param), returns: node.type?.getText(source), description: docs(node) };
  }
  ts.forEachChild(node, c => walk(c, ns));
}
walk(source);
const manifest = JSON.parse(fs.readFileSync(path.join(app, 'package.json')));
const nativeReadme = fs.readFileSync(path.join(app, 'extensions/@pink-agent-tools/README.md'), 'utf8');
const nativeTools = [...nativeReadme.matchAll(/^#### \[(pink_[^\]]+)\][^\n]*\n([\s\S]*?)(?=^#### |^### |^## |$(?![\s\S]))/gm)].map(m => ({ name: m[1], documentation: m[2].trim() }));
const catalog = { generatedFrom: 'Installed PinK declarations; regenerate after upgrading PinK.', pinkVersion: manifest.version, sourceSha256: crypto.createHash('sha256').update(text).digest('hex'), namespaces, sceneMethods, invokes, types, nativeTools };
fs.writeFileSync(path.join(__dirname, 'extension/catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
console.log(JSON.stringify({ pinkVersion: catalog.pinkVersion, apiMethods: Object.values(namespaces).reduce((n, x) => n + Object.keys(x).length, 0), sceneMethods: Object.keys(sceneMethods).length, sceneCommands: Object.values(invokes).reduce((n, x) => n + Object.keys(x).length, 0), types: Object.keys(types).length, nativeTools: nativeTools.length }));
