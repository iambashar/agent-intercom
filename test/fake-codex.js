// A fake codex app-server daemon for the tests (not a test file itself: `npm test` runs test/*.test.js).
const net = require('node:net');

// Completes the WebSocket upgrade, decodes masked client frames, and hands each JSON-RPC message to `reply(msg, socket)`.
function fakeDaemon(sock, reply) {
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

// A daemon that answers each request from `handlers[method](params)` and records the calls.
// Methods without a handler get the error Codex returns for an unknown method.
function codexDaemon(sock, handlers) {
  const calls = [];
  const d = fakeDaemon(sock, (m, c) => {
    if (m.id == null) return; // notifications such as `initialized`
    calls.push({ method: m.method, params: m.params });
    const h = m.method === 'initialize' ? () => ({ result: {} }) : handlers[m.method];
    send(c, { id: m.id, ...(h ? h(m.params) : { error: { code: -32600, message: `unknown variant \`${m.method}\`` } }) });
  });
  return { calls, close: d.close };
}

module.exports = { fakeDaemon, frame, send, codexDaemon };
