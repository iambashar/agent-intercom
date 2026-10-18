const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { session } = require('../codex-ws.js');

const tmp = fs.mkdtempSync('/tmp/am-ws-');
let n = 0;

// A fake codex daemon: completes the WebSocket upgrade, decodes masked client frames,
// and hands each JSON-RPC request to `reply(msg, socket)`.
function fakeDaemon(reply) {
  const sock = path.join(tmp, `d${++n}.sock`);
  const server = net.createServer((c) => {
    let buf = Buffer.alloc(0), open = false;
    c.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!open) {
        const i = buf.indexOf('\r\n\r\n');
        if (i < 0) return;
        open = true;
        buf = buf.slice(i + 4);
        c.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
      }
      while (buf.length >= 6) {
        let len = buf[1] & 127, off = 2;
        if (len === 126) { len = buf.readUInt16BE(2); off = 4; }
        if (buf.length < off + 4 + len) return;
        const mask = buf.slice(off, off + 4);
        const pl = Buffer.from(buf.slice(off + 4, off + 4 + len));
        for (let i = 0; i < pl.length; i++) pl[i] ^= mask[i & 3];
        const op = buf[0] & 15;
        buf = buf.slice(off + 4 + len);
        if (op === 1) reply(JSON.parse(pl.toString()), c);
      }
    });
  }).listen(sock);
  return { sock, close: () => server.close() };
}

// Unmasked server frame; fin=false for the leading fragments of a split message.
const frame = (op, text, fin = true) => {
  const p = Buffer.from(text);
  const h = p.length < 126 ? Buffer.from([(fin ? 0x80 : 0) | op, p.length])
    : Buffer.from([(fin ? 0x80 : 0) | op, 126, p.length >> 8, p.length & 255]);
  return Buffer.concat([h, p]);
};
const send = (c, obj) => c.write(frame(1, JSON.stringify(obj)));

test('reassembles a reply split across WebSocket fragments', async () => {
  const d = fakeDaemon((m, c) => {
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
  const d = fakeDaemon((m, c) => {
    if (m.method === 'initialize') return send(c, { id: m.id, result: {} });
    c.destroy(); // daemon restarts mid-request
  });
  const s = await session({ sock: d.sock });
  await assert.rejects(s.call('thread/loaded/list', {}), /closed/);
  d.close();
});

test('a call with no reply times out', async () => {
  const d = fakeDaemon((m, c) => { if (m.method === 'initialize') send(c, { id: m.id, result: {} }); });
  const s = await session({ sock: d.sock, timeoutMs: 200 });
  await assert.rejects(s.call('thread/loaded/list', {}), /timed out/);
  s.close();
  d.close();
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
