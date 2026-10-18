const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

// Unix socket paths are capped near 104 bytes on macOS, so keep the fixture under /tmp.
const tmp = fs.mkdtempSync('/tmp/am-');
const MAIL = path.join(tmp, 'mail');
const CLAUDE = path.join(tmp, 'claude');
fs.mkdirSync(path.join(CLAUDE, 'sessions'), { recursive: true });

// Fake agy: records its argv and the two env vars agentapi needs, answers like `agy agentapi send-message`.
const AGY_LOG = path.join(tmp, 'agy.log');
const AGY = path.join(tmp, 'agy');
fs.writeFileSync(AGY, `#!/bin/sh\nprintf '%s\\n' "$ANTIGRAVITY_LS_ADDRESS" "$ANTIGRAVITY_CSRF_TOKEN" "$@" > ${AGY_LOG}\necho '{"response":{}}'\n`, { mode: 0o755 });

process.env.AGENT_MAIL_DIR = MAIL;
process.env.CLAUDE_CONFIG_DIR = CLAUDE;
process.env.AGY_BIN = AGY;
process.env.CODEX_DAEMON_DIR = path.join(tmp, 'no-codex-daemon');
const { deliver, scan } = require('../pushd.js');

function drop(to, body) {
  const id = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const dir = path.join(MAIL, to, 'inbox');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify({ id, from: 'tester', to, body, reply_to: null, sent: new Date().toISOString() }));
  return { id, file, read: path.join(MAIL, to, 'read', `${id}.json`) };
}

// A fake Claude Code session: registry entry, key file and a socket that records each JSON line it gets.
function fakeClaude(name, updatedAt) {
  const sock = path.join(tmp, `${name}.sock`);
  const token = crypto.randomBytes(16).toString('hex');
  const lines = [];
  const server = net.createServer((c) => {
    let buf = '';
    c.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); }
    });
  }).listen(sock);
  const pid = process.pid;
  const reg = { pid, sessionId: crypto.randomUUID(), name, messagingSocketPath: sock, statusUpdatedAt: updatedAt };
  // Registry files are keyed by pid, so each fake session gets its own sessions dir entry name via a fake pid file.
  const fakePid = pid + Math.floor(Math.random() * 1000) + 1;
  const hash = crypto.createHash('sha256').update(path.resolve(sock)).digest('hex');
  fs.writeFileSync(path.join(CLAUDE, 'sessions', `${fakePid}.json`), JSON.stringify(reg));
  fs.writeFileSync(path.join(CLAUDE, 'sessions', `${pid}.${hash}.key`), JSON.stringify({ peerToken: token }));
  return { lines, token, close: () => server.close() };
}

const settle = () => new Promise((r) => setTimeout(r, 400));

test('pushes mail into a live Claude session over its peer socket', async () => {
  const a = fakeClaude('alpha', 1);
  const b = fakeClaude('beta', 2);
  const m = drop('claude', 'hello claude');
  await deliver('claude', m.file);
  await settle();
  // No route given: the most recently active session (beta) gets it.
  assert.strictEqual(a.lines.length, 0);
  assert.deepStrictEqual(b.lines[0], { type: 'auth', token: b.token });
  assert.strictEqual(b.lines[1].type, 'user');
  assert.match(b.lines[1].message.content, /\[agent-mail\] message .* from tester:\nhello claude/);
  assert.ok(fs.existsSync(m.read) && !fs.existsSync(m.file), 'delivered mail moves to read/');

  // claude.<session-name> addresses one session explicitly.
  const m2 = drop('claude.alpha', 'just alpha');
  await deliver('claude.alpha', m2.file);
  await settle();
  assert.match(a.lines[1].message.content, /just alpha/);
  a.close();
  b.close();
});

test('pushes mail into a registered agy session with agentapi', async () => {
  const sessions = path.join(MAIL, 'gemini', 'sessions');
  fs.mkdirSync(sessions, { recursive: true });
  fs.writeFileSync(path.join(sessions, `${process.pid}.json`), JSON.stringify({
    pid: process.pid, conversationId: 'conv-123', lsAddress: 'localhost:9', csrfToken: 'tok', updatedAt: 1,
  }));
  const m = drop('gemini', 'hello gemini');
  await deliver('gemini', m.file);
  const [addr, token, ...args] = fs.readFileSync(AGY_LOG, 'utf8').trim().split('\n');
  assert.strictEqual(addr, 'localhost:9');
  assert.strictEqual(token, 'tok');
  assert.deepStrictEqual(args.slice(0, 3), ['agentapi', 'send-message', 'conv-123']);
  assert.ok(fs.existsSync(m.read));
  fs.rmSync(sessions, { recursive: true });
});

test('leaves mail in the inbox when no live session can take it', async () => {
  const g = drop('gemini', 'nobody home');
  await scan('gemini');
  assert.ok(fs.existsSync(g.file), 'no agy session registered');
  const c = drop('codex', 'no daemon');
  await scan('codex');
  assert.ok(fs.existsSync(c.file), 'codex daemon missing');
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
