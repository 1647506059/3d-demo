'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function normalize(value) { return path.resolve(value).replace(/\\/g, '/').replace(/\/$/, '').toLowerCase(); }
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function readOnly(name) { return /^(?:query|get|inspect|check|has|pinkVersion|toRef|is-|can-)/.test(name) || ['serialize', 'query', 'read'].includes(name); }
function assertJson(value) {
  if (value === undefined) return;
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite JSON number');
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Unsafe object key');
      assertJson(value[key]);
    }
  }
}
function validateArgs(meta, args) {
  if (!Array.isArray(args)) throw new Error('args must be an array of positional SDK arguments');
  const params = meta.params || [];
  if (args.length > params.length && !params.some(p => p.rest)) throw new Error('Too many SDK arguments');
  params.forEach((p, i) => {
    const v = args[i];
    if (v === undefined && !p.optional) throw new Error(`Missing SDK argument: ${p.name}`);
    if (v !== undefined && ['string', 'number', 'boolean'].includes(p.type) && typeof v !== p.type) throw new Error(`Invalid type for ${p.name}: expected ${p.type}`);
  });
  assertJson(args);
}
async function snapshot(file, shallow = false) {
  const hash = crypto.createHash('sha256');
  let entries = 0, bytes = 0;
  async function visit(target, relative, depth) {
    let stat;
    try { stat = await fs.lstat(target); } catch (e) { if (e.code === 'ENOENT') { hash.update(JSON.stringify([relative, 'missing'])); return; } throw e; }
    if (stat.isSymbolicLink()) throw new Error(`Cannot guard a symbolic link: ${target}`);
    if (++entries > 10000 || depth > 128) throw new Error('Guard target is too large');
    if (stat.isDirectory()) {
      const names = (await fs.readdir(target)).sort();
      hash.update(JSON.stringify([relative, 'directory', names]));
      hash.update(JSON.stringify([stat.dev, stat.ino]));
      if (!shallow) for (const name of names) await visit(path.join(target, name), `${relative}/${name}`, depth + 1);
    } else if (stat.isFile()) {
      bytes += stat.size;
      if (bytes > 512 * 1024 * 1024) throw new Error('Guard target exceeds 512 MiB');
      hash.update(JSON.stringify([relative, 'file', stat.size, stat.mtimeMs]));
      hash.update(await fs.readFile(target));
      const after = await fs.lstat(target);
      if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw new Error('Target changed during guard capture');
    } else throw new Error('Guard supports regular files and directories only');
  }
  await visit(file, '', 0);
  return hash.digest('hex');
}
class Tickets {
  constructor(now = Date.now) { this.items = new Map(); this.now = now; }
  issue(operation, guards) {
    for (const [id, item] of this.items) if (item.expires < this.now()) this.items.delete(id);
    if (this.items.size >= 128) throw new Error('Too many pending preparations');
    const ticket = crypto.randomUUID();
    this.items.set(ticket, { operation: structuredClone(operation), guards: structuredClone(guards), expires: this.now() + 600000 });
    return ticket;
  }
  consume(ticket) {
    const item = this.items.get(ticket);
    this.items.delete(ticket);
    if (!item || item.expires < this.now()) throw new Error('Preparation missing, expired, or already consumed; inspect the current state before preparing again');
    return item;
  }
}
module.exports = { normalize, digest, readOnly, assertJson, validateArgs, snapshot, Tickets };
