const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { session } = require('../codex-ws.js');
const { fakeDaemon, frame, send } = require('./fake-codex.js');

const tmp = fs.mkdtempSync('/tmp/am-ws-');
let n = 0;

const dsock = () => path.join(tmp, `d${++n}.sock`);

test('reassembles a reply split across WebSocket fragments', async () => {
  const d = fakeDaemon(dsock(), (m, c) => {
    if (m.method === 'initialize') return send(c, { id: m.id, result: {} });
    if (m.method !== 'thread/loaded/list') return;
    const text = JSON.stringify({ id: m.id, result: { data: ['t'.repeat(300)] } });
    c.write(frame(1, text.slice(0, 100), false));
    c.write(frame(9, 'ping')); // control frames may arrive between fragments
    c.write(frame(0, text.slice(100, 200), false));
    c.write(frame(0, text.slice(200), true));
  });
  const s = await session({ sock: d.sock });
  const r = await s.call('thread/loaded/list', {});
  assert.strictEqual(r.result.data[0].length, 300);
  s.close();
  d.close();
});

test('a dropped connection rejects pending calls instead of hanging', async () => {
  const d = fakeDaemon(dsock(), (m, c) => {
    if (m.method === 'initialize') return send(c, { id: m.id, result: {} });
    c.destroy(); // daemon restarts mid-request
  });
  const s = await session({ sock: d.sock });
  await assert.rejects(s.call('thread/loaded/list', {}), /closed/);
  d.close();
});

test('a call with no reply times out', async () => {
  const d = fakeDaemon(dsock(), (m, c) => { if (m.method === 'initialize') send(c, { id: m.id, result: {} }); });
  const s = await session({ sock: d.sock, timeoutMs: 200 });
  await assert.rejects(s.call('thread/loaded/list', {}), /timed out/);
  s.close();
  d.close();
});

test('session() skips daemon sockets that close the connection', async () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'dd-'));
  // Tried first because it has the lock file, but drops every connection like a stale or helper socket.
  const stale = net.createServer((c) => c.destroy()).listen(path.join(dir, 'a'));
  fs.writeFileSync(path.join(dir, 'a.lock'), '');
  const live = fakeDaemon(path.join(dir, 'b'), (m, c) => { if (m.id != null) send(c, { id: m.id, result: { data: ['ok'] } }); });
  process.env.CODEX_DAEMON_DIR = dir;
  try {
    const s = await session();
    assert.deepStrictEqual((await s.call('thread/loaded/list', {})).result.data, ['ok']);
    s.close();
  } finally {
    delete process.env.CODEX_DAEMON_DIR;
    stale.close();
    live.close();
  }
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
