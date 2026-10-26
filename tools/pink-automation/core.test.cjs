'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Tickets, snapshot, validateArgs, readOnly } = require('./extension/core.cjs');

test('preparations capture exact input, expire, and can only be committed once', () => {
  let now = 0;
  const tickets = new Tickets(() => now);
  const op = { kind: 'api', args: [{ value: 1 }] };
  const id = tickets.issue(op, { revision: 1 });
  op.args[0].value = 2;
  assert.equal(tickets.consume(id).operation.args[0].value, 1);
  assert.throws(() => tickets.consume(id), /already consumed/);
  const expired = tickets.issue(op, {});
  now = 600001;
  assert.throws(() => tickets.consume(expired), /expired/);
});
test('file guards detect content, metadata, nested tree and missing-target changes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pink-guard-test-'));
  try {
    const file = path.join(dir, 'target');
    const missing = await snapshot(file);
    await fs.writeFile(file, 'one');
    assert.notEqual(await snapshot(file), missing);
    const original = await snapshot(dir);
    await fs.writeFile(file + '.meta', 'metadata');
    assert.notEqual(await snapshot(dir), original);
    const before = await snapshot(file);
    await fs.writeFile(file, 'two');
    assert.notEqual(await snapshot(file), before);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('pink-guard-test-'));
    await fs.rm(dir, { recursive: true });
  }
});
test('write paths stay out of read-only dispatch and positional types are checked', () => {
  for (const name of ['saveAsset', 'setProperty', 'apply-operations', 'clear', 'refresh', 'update']) assert.equal(readOnly(name), false);
  for (const name of ['queryAssetInfo', 'getSelection', 'query-state', 'is-dirty']) assert.equal(readOnly(name), true);
  assert.throws(() => validateArgs({ params: [{ name: 'uuid', type: 'string', optional: false }] }, []), /Missing/);
  assert.throws(() => validateArgs({ params: [{ name: 'uuid', type: 'string' }] }, [42]), /Invalid type/);
});
