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
// Prints AGY_OUT instead when that file exists, to simulate agentapi errors.
const AGY_LOG = path.join(tmp, 'agy.log');
const AGY_OUT = path.join(tmp, 'agy.out');
const AGY = path.join(tmp, 'agy');
fs.writeFileSync(AGY, `#!/bin/sh\nprintf '%s\\n' "$ANTIGRAVITY_LS_ADDRESS" "$ANTIGRAVITY_CSRF_TOKEN" "$@" > ${AGY_LOG}\nif [ -f ${AGY_OUT} ]; then cat ${AGY_OUT}; else echo '{"response":{}}'; fi\n`, { mode: 0o755 });

process.env.AGENT_MAIL_DIR = MAIL;
process.env.CLAUDE_CONFIG_DIR = CLAUDE;
process.env.AGY_BIN = AGY;
process.env.CODEX_DAEMON_DIR = path.join(tmp, 'no-codex-daemon');
const { deliver, scan, recoverClaims } = require('../pushd.js');
const { codexDaemon } = require('./fake-codex.js');

function drop(to, body) {
  const id = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const dir = path.join(MAIL, to, 'inbox');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify({ id, from: 'tester', to, body, reply_to: null, sent: new Date().toISOString() }));
  return { id, file, read: path.join(MAIL, to, 'read', `${id}.json`) };
}

// A fake Claude Code session: registry entry, key file and a socket that records each JSON line it gets.
function fakeClaude(name, updatedAt, { hangUp = false } = {}) {
  const sock = path.join(tmp, `${name}.sock`);
  const token = crypto.randomBytes(16).toString('hex');
  const lines = [];
  const server = net.createServer((c) => {
    if (hangUp) return c.destroy();
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
  assert.match(b.lines[1].message.content, /\[agent-intercom\] message .* from tester:\nhello claude/);
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

test('a session that drops the connection is a failed push and the mail stays queued', async () => {
  const g = fakeClaude('gamma', 0, { hangUp: true });
  const m = drop('claude.gamma', 'will bounce');
  await assert.rejects(deliver('claude.gamma', m.file), /closed the connection|ECONNRESET|EPIPE/);
  assert.ok(fs.existsSync(m.file) && !fs.existsSync(m.read) && !fs.existsSync(`${m.file}.pushing`));
  g.close();
});

test('agentapi output is parsed as JSON, not pattern-matched', async () => {
  const sessions = path.join(MAIL, 'gemini', 'sessions');
  fs.mkdirSync(sessions, { recursive: true });
  fs.writeFileSync(path.join(sessions, `${process.pid}.json`), JSON.stringify({
    pid: process.pid, conversationId: 'conv-9', lsAddress: 'localhost:9', csrfToken: 'tok', updatedAt: 1,
  }));
  // A body that talks about "error" is still a successful send.
  fs.writeFileSync(AGY_OUT, JSON.stringify({ response: { sendMessage: { content: 'the "error" was a typo' } } }));
  const ok = drop('gemini', 'the "error" was a typo');
  await deliver('gemini', ok.file);
  assert.ok(fs.existsSync(ok.read));
  // A real agentapi error keeps the mail queued.
  fs.writeFileSync(AGY_OUT, JSON.stringify({ error: 'missing CSRF token' }));
  const bad = drop('gemini', 'should stay');
  await assert.rejects(deliver('gemini', bad.file), /missing CSRF token/);
  assert.ok(fs.existsSync(bad.file));
  fs.rmSync(AGY_OUT);
  fs.rmSync(sessions, { recursive: true });
});

// ---- Codex ----
// Some threads reject turn listing on Codex 0.163+ (issue #12).
const LIST_TURNS = { error: { code: -32601, message: 'list_turns is not supported yet' } };
const thread = (id, extra) => ({ result: { thread: { id, ephemeral: false, updatedAt: 1, turns: [], ...extra } } });

// Runs `fn` with a fake codex daemon as the only live socket in CODEX_DAEMON_DIR, next to a stale socket that
// drops every connection (listed first, but without the lock file the live socket has).
let codexN = 0;
async function withCodex(handlers, fn) {
  const dir = path.join(tmp, `codex${++codexN}`);
  fs.mkdirSync(dir);
  const stale = net.createServer((c) => c.destroy()).listen(path.join(dir, 'aaa'));
  const d = codexDaemon(path.join(dir, 'zzz'), handlers);
  fs.writeFileSync(path.join(dir, 'zzz.lock'), '');
  const before = process.env.CODEX_DAEMON_DIR;
  process.env.CODEX_DAEMON_DIR = dir;
  try { await fn(d.calls); } finally {
    process.env.CODEX_DAEMON_DIR = before;
    stale.close();
    d.close();
  }
}
const called = (calls, method) => calls.filter((c) => c.method === method).map((c) => c.params);

test('pushes into an idle Codex thread whose turns cannot be listed (#12)', async () => {
  await withCodex({
    'thread/loaded/list': () => ({ result: { data: ['thr-1'] } }),
    'thread/read': (p) => (p.includeTurns ? LIST_TURNS : thread('thr-1', { status: { type: 'idle' } })),
    'thread/turns/list': () => LIST_TURNS,
    'turn/start': () => ({ result: { turn: { id: 'turn-1', status: 'inProgress' } } }),
  }, async (calls) => {
    const m = drop('codex', 'hello codex');
    await deliver('codex', m.file);
    const [start] = called(calls, 'turn/start');
    assert.strictEqual(start.threadId, 'thr-1');
    assert.match(start.input[0].text, /from tester:\nhello codex/);
    assert.strictEqual(called(calls, 'turn/steer').length, 0);
    assert.ok(!called(calls, 'thread/read').some((p) => p.includeTurns), 'idle thread: no turn lookup');
    assert.ok(fs.existsSync(m.read));
  });
});

test('steers the running turn of a busy Codex thread', async () => {
  await withCodex({
    'thread/loaded/list': () => ({ result: { data: ['thr-2'] } }),
    'thread/read': () => thread('thr-2', { status: { type: 'active', activeFlags: [] } }),
    'thread/turns/list': () => ({ result: { data: [{ id: 'turn-7', status: 'inProgress' }] } }),
    'turn/steer': () => ({ result: { turnId: 'turn-7' } }),
  }, async (calls) => {
    const m = drop('codex', 'mid-turn note');
    await deliver('codex', m.file);
    assert.deepStrictEqual(called(calls, 'turn/steer').map((p) => [p.threadId, p.expectedTurnId]), [['thr-2', 'turn-7']]);
    assert.strictEqual(called(calls, 'turn/start').length, 0);
    assert.ok(fs.existsSync(m.read));
  });
});

test('finds the running turn with includeTurns on daemons without status or thread/turns/list', async () => {
  await withCodex({
    'thread/loaded/list': () => ({ result: { data: ['thr-3'] } }),
    'thread/read': (p) => thread('thr-3', p.includeTurns
      ? { turns: [{ id: 'turn-3', status: 'completed' }, { id: 'turn-4', status: 'inProgress' }] } : {}),
    'turn/steer': () => ({ result: { turnId: 'turn-4' } }),
  }, async (calls) => {
    const m = drop('codex', 'old daemon');
    await deliver('codex', m.file);
    assert.deepStrictEqual(called(calls, 'turn/steer').map((p) => p.expectedTurnId), ['turn-4']);
    assert.ok(fs.existsSync(m.read));
  });
});

test('falls back to turn/start when the turn ends before it can be steered', async () => {
  await withCodex({
    'thread/loaded/list': () => ({ result: { data: ['thr-4'] } }),
    'thread/read': () => thread('thr-4', { status: { type: 'active', activeFlags: [] } }),
    'thread/turns/list': () => ({ result: { data: [{ id: 'turn-9', status: 'inProgress' }] } }),
    'turn/steer': () => ({ error: { code: -32600, message: 'expected active turn id `turn-9` but found none' } }),
    'turn/start': () => ({ result: { turn: { id: 'turn-10', status: 'inProgress' } } }),
  }, async (calls) => {
    const m = drop('codex', 'just missed it');
    await deliver('codex', m.file);
    assert.strictEqual(called(calls, 'turn/steer').length, 1);
    assert.strictEqual(called(calls, 'turn/start').length, 1);
    assert.ok(fs.existsSync(m.read));
  });
});

test('logs a Codex thread it cannot read and pushes to the next one', async () => {
  const logged = [];
  const orig = console.log;
  console.log = (...a) => logged.push(a.join(' '));
  try {
    await withCodex({
      'thread/loaded/list': () => ({ result: { data: ['thr-bad', 'thr-ok'] } }),
      'thread/read': (p) => (p.threadId === 'thr-bad' ? { error: { code: -32603, message: 'boom' } } : thread('thr-ok', { status: { type: 'idle' } })),
      'turn/start': () => ({ result: { turn: { id: 'turn-1', status: 'inProgress' } } }),
    }, async (calls) => {
      const m = drop('codex', 'to the readable one');
      await deliver('codex', m.file);
      assert.deepStrictEqual(called(calls, 'turn/start').map((p) => p.threadId), ['thr-ok']);
      assert.ok(fs.existsSync(m.read));
    });
  } finally { console.log = orig; }
  assert.ok(logged.some((l) => /codex thread\/read thr-bad failed: boom/.test(l)), logged.join('\n'));
});

test('claims left by a crash are put back in the inbox', () => {
  const m = drop('codex', 'interrupted');
  fs.renameSync(m.file, `${m.file}.pushing`);
  recoverClaims('codex');
  assert.ok(fs.existsSync(m.file) && !fs.existsSync(`${m.file}.pushing`));
});

test('leaves mail in the inbox when no live session can take it', async () => {
  const g = drop('gemini', 'nobody home');
  await scan('gemini');
  assert.ok(fs.existsSync(g.file), 'no agy session registered');
  // A missing codex daemon means nobody to push to, not a failed push to retry.
  const c = drop('codex', 'no daemon');
  await deliver('codex', c.file);
  assert.ok(fs.existsSync(c.file), 'codex daemon missing');
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
