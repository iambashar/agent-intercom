#!/usr/bin/env node
// agent-mail push daemon: when a message lands in ~/.agent-mail/<name>/inbox, push it straight into the
// recipient's live session instead of waiting for it to poll mail_check.
//   claude[.<session-name>]  -> Claude Code peer socket (/tmp/cc-socks/<pid>.sock, same path SendMessage uses)
//   codex[.<thread-id-prefix>] -> codex app-server daemon, turn/start (or turn/steer if a turn is running)
//   gemini[.<conversation-prefix>] -> agy `agentapi send-message` (sessions self-register via agy-register.sh)
// No live session -> the file stays in the inbox and the agent reads it with mail_check as before.
// Default session per agent: <mailbox>/routes.json, e.g. {"claude": "my-session"}; else most recently active.
// These are undocumented internals of each CLI, so a CLI update can break a route; failures fall back to the inbox.
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const ROOT = process.env.AGENT_MAIL_DIR || path.join(os.homedir(), '.agent-mail');
const CLAUDE_SESSIONS = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'sessions');
const AGY = process.env.AGY_BIN || 'agy';
const log = (...a) => console.log(new Date().toISOString(), ...a);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const routes = () => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'routes.json'), 'utf8')); } catch { return {}; } };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

function pick(list, want, match) {
  if (want) return list.find((s) => match(s, want));
  return list.sort((a, b) => b.t - a.t)[0];
}

function render(m) {
  return `[agent-mail] message ${m.id} from ${m.from}${m.reply_to ? ` (re ${m.reply_to})` : ''}:\n${m.body}\n\n` +
    `(This came from another AI agent through agent-mail. Reply with the mail_send tool: to "${m.from}", reply_to "${m.id}".)`;
}

// ---- Claude Code: peer messaging socket ----
function claudeSessions() {
  let files = [];
  try { files = fs.readdirSync(CLAUDE_SESSIONS); } catch { return []; }
  return files.filter((f) => /^\d+\.json$/.test(f)).map((f) => readJson(path.join(CLAUDE_SESSIONS, f)))
    .filter((r) => r && r.messagingSocketPath && alive(r.pid) && fs.existsSync(r.messagingSocketPath))
    .map((r) => ({ ...r, t: r.statusUpdatedAt || r.updatedAt || 0 }));
}

function claudePush(sess, m) {
  const hash = crypto.createHash('sha256').update(path.resolve(sess.messagingSocketPath)).digest('hex');
  const key = readJson(path.join(CLAUDE_SESSIONS, `${sess.pid}.${hash}.key`));
  if (!key?.peerToken) throw new Error(`no peer key for claude pid ${sess.pid}`);
  return new Promise((resolve, reject) => {
    const c = net.createConnection({ path: sess.messagingSocketPath }, () => {
      c.write(JSON.stringify({ type: 'auth', token: key.peerToken }) + '\n');
      c.write(JSON.stringify({ type: 'user', message: { role: 'user', content: render(m) }, from: `agent-mail:${m.from}` }) + '\n');
      setTimeout(() => { c.end(); resolve(`claude session ${sess.name} (pid ${sess.pid})`); }, 300);
    });
    c.setTimeout(5000, () => { c.destroy(); reject(new Error('claude socket timeout')); });
    c.on('error', reject);
  });
}

// ---- Codex: app-server daemon ----
async function codexPush(want, m) {
  const { session } = require('./codex-ws.js');
  const s = await session();
  try {
    const loaded = (await s.call('thread/loaded/list', {})).result?.data || [];
    const threads = [];
    for (const id of loaded) {
      const t = (await s.call('thread/read', { threadId: id, includeTurns: true })).result?.thread;
      if (t && !t.ephemeral) threads.push({ ...t, t: t.updatedAt || 0 });
    }
    const th = pick(threads, want, (t, w) => t.id.startsWith(w));
    if (!th) return null;
    const input = [{ type: 'text', text: render(m) }];
    const active = (th.turns || []).find((x) => x.status === 'inProgress');
    const r = active
      ? await s.call('turn/steer', { threadId: th.id, expectedTurnId: active.id, input })
      : await s.call('turn/start', { threadId: th.id, input });
    if (r.error) throw new Error(`codex ${active ? 'turn/steer' : 'turn/start'}: ${r.error.message}`);
    return `codex thread ${th.id} (${active ? 'steered running turn' : 'new turn'})`;
  } finally { s.close(); }
}

// ---- Antigravity (agy): agentapi send-message ----
function agySessions() {
  const d = path.join(ROOT, 'gemini', 'sessions');
  let files = [];
  try { files = fs.readdirSync(d); } catch { return []; }
  return files.filter((f) => f.endsWith('.json')).map((f) => {
    const r = readJson(path.join(d, f));
    if (r && !alive(r.pid)) { try { fs.unlinkSync(path.join(d, f)); } catch {} return null; }
    return r && { ...r, t: r.updatedAt || 0 };
  }).filter(Boolean);
}

function agyPush(sess, m) {
  return new Promise((resolve, reject) => {
    execFile(AGY, ['agentapi', 'send-message', sess.conversationId, render(m)], {
      env: { ...process.env, ANTIGRAVITY_LS_ADDRESS: sess.lsAddress, ANTIGRAVITY_CSRF_TOKEN: sess.csrfToken },
      timeout: 20000,
    }, (err, out) => {
      if (err) return reject(err);
      if (/"error"/.test(out)) return reject(new Error(out.trim()));
      resolve(`agy conversation ${sess.conversationId} (pid ${sess.pid})`);
    });
  });
}

async function deliver(name, file) {
  const [kind, ...rest] = name.split('.');
  const want = rest.join('.') || routes()[name] || routes()[kind];
  const m = readJson(file);
  if (!m) return;
  let where = null;
  if (kind === 'claude') {
    const s = pick(claudeSessions(), want, (x, w) => x.name === w || x.sessionId?.startsWith(w));
    if (s) where = await claudePush(s, m);
  } else if (kind === 'codex') {
    where = await codexPush(want, m);
  } else if (kind === 'gemini') {
    const s = pick(agySessions(), want, (x, w) => x.conversationId.startsWith(w));
    if (s) where = await agyPush(s, m);
  } else return;
  if (!where) return log(`${m.id} -> ${name}: no live session, left in inbox`);
  const read = path.join(ROOT, name, 'read');
  fs.mkdirSync(read, { recursive: true });
  try { fs.renameSync(file, path.join(read, path.basename(file))); } catch {}
  log(`${m.id} ${m.from} -> ${name}: pushed into ${where}`);
}

const busy = new Set();
async function scan(name) {
  if (busy.has(name)) return;
  busy.add(name);
  try {
    const inbox = path.join(ROOT, name, 'inbox');
    let files = [];
    try { files = fs.readdirSync(inbox).filter((f) => f.endsWith('.json')).sort(); } catch {}
    for (const f of files) {
      try { await deliver(name, path.join(inbox, f)); } catch (e) { log(`${f} -> ${name}: push failed: ${e.message}`); }
    }
  } finally { busy.delete(name); }
}

function main() {
  fs.mkdirSync(ROOT, { recursive: true });
  const local = (n) => /^(claude|codex|gemini)(\.|$)/.test(n);
  fs.watch(ROOT, { recursive: true }, (_ev, rel) => {
    if (!rel) return;
    const parts = rel.split(path.sep);
    if (parts[1] === 'inbox' && rel.endsWith('.json') && local(parts[0])) setTimeout(() => scan(parts[0]), 150);
    // An agy session just registered: flush gemini mail that was waiting for one.
    if (parts[0] === 'gemini' && parts[1] === 'sessions' && rel.endsWith('.json')) setTimeout(() => scan('gemini'), 150);
  });
  // Mail that arrived while the daemon was down.
  for (const n of fs.readdirSync(ROOT)) if (local(n)) scan(n);
  log(`agent-mail pushd watching ${ROOT}`);
}

if (require.main === module) main();

module.exports = { deliver, scan, render, main };
