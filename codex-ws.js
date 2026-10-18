// Minimal JSON-RPC client for the codex app-server daemon (WebSocket over a Unix socket in /tmp/codex-daemon-<uid>).
const net = require('net');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Client frames must be masked (RFC 6455 5.3).
function frame(op, payload) {
  const p = Buffer.from(payload);
  let h;
  if (p.length < 126) h = Buffer.from([0x80 | op, 0x80 | p.length]);
  else if (p.length < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 0x80 | 126; h.writeUInt16BE(p.length, 2); }
  else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 0x80 | 127; h.writeBigUInt64BE(BigInt(p.length), 2); }
  const m = crypto.randomBytes(4);
  for (let i = 0; i < p.length; i++) p[i] ^= m[i & 3];
  return Buffer.concat([h, m, p]);
}

function connect(sock) {
  return new Promise((res, rej) => {
    const c = net.createConnection(sock);
    let buf = Buffer.alloc(0), open = false, parts = null, closed = false;
    const handlers = [], closers = [];
    const shut = (err) => {
      if (closed) return;
      closed = true;
      if (!open) rej(err);
      for (const f of closers) f(err);
      c.destroy();
    };
    const api = {
      send: (o) => { if (!closed) c.write(frame(1, JSON.stringify(o))); },
      on: (f) => handlers.push(f),
      onClose: (f) => closers.push(f),
      close: () => { if (!closed) { c.write(frame(8, '')); c.end(); } closed = true; },
    };
    c.on('connect', () => c.write(`GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`));
    c.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!open) {
        const i = buf.indexOf('\r\n\r\n');
        if (i < 0) return;
        if (!/^HTTP\/1\.1 101/.test(buf.slice(0, i).toString())) return shut(new Error('codex daemon refused the WebSocket upgrade'));
        open = true;
        buf = buf.slice(i + 4);
        res(api);
      }
      for (;;) {
        if (buf.length < 2) return;
        let len = buf[1] & 127, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf[1] & 0x80) off += 4; // servers should not mask, but tolerate it
        if (buf.length < off + len) return;
        const fin = buf[0] & 0x80, op = buf[0] & 15;
        let pl = buf.slice(off, off + len);
        if (buf[1] & 0x80) { const m = buf.slice(off - 4, off); pl = Buffer.from(pl); for (let i = 0; i < pl.length; i++) pl[i] ^= m[i & 3]; }
        buf = buf.slice(off + len);
        if (op === 9) { c.write(frame(10, pl)); continue; } // ping -> pong
        if (op === 8) return shut(new Error('codex daemon closed the connection'));
        if (op === 1) parts = [pl];
        else if (op === 0 && parts) parts.push(pl);
        else continue;
        if (!fin) continue; // wait for the rest of a fragmented message
        const text = Buffer.concat(parts).toString();
        parts = null;
        let msg;
        try { msg = JSON.parse(text); } catch { continue; }
        for (const f of handlers) f(msg);
      }
    });
    c.on('error', shut);
    c.on('close', () => shut(new Error('codex daemon connection closed')));
  });
}

function daemonSock() {
  const d = process.env.CODEX_DAEMON_DIR || path.join('/tmp', `codex-daemon-${process.getuid()}`);
  const f = fs.readdirSync(d).find((x) => !x.endsWith('.lock'));
  if (!f) throw new Error(`no codex app-server daemon socket in ${d}`);
  return path.join(d, f);
}

// One JSON-RPC session. Every call settles: with the reply, on a timeout, or when the connection drops.
async function session({ sock = daemonSock(), timeoutMs = 15000 } = {}) {
  const ws = await connect(sock);
  let id = 0;
  const pend = new Map();
  ws.on((m) => { const p = pend.get(m.id); if (p) { pend.delete(m.id); clearTimeout(p.timer); p.resolve(m); } });
  ws.onClose((err) => { for (const p of pend.values()) { clearTimeout(p.timer); p.reject(err); } pend.clear(); });
  const call = (method, params) => new Promise((resolve, reject) => {
    const i = ++id;
    const timer = setTimeout(() => { pend.delete(i); reject(new Error(`codex ${method} timed out`)); }, timeoutMs);
    pend.set(i, { resolve, reject, timer });
    ws.send({ jsonrpc: '2.0', id: i, method, params });
  });
  try {
    await call('initialize', { clientInfo: { name: 'agent-mail', version: '0' } });
  } catch (e) { ws.close(); throw e; }
  ws.send({ jsonrpc: '2.0', method: 'initialized' });
  return { call, close: () => ws.close() };
}

module.exports = { connect, daemonSock, session };
