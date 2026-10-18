#!/usr/bin/env node
// agent-intercom push daemon: when a message lands in ~/.agent-mail/<name>/inbox, push it straight into the
// recipient's live session instead of waiting for it to poll mail_check.
//   claude[.<session-name>]  -> Claude Code peer socket (/tmp/cc-socks/<pid>.sock, same path SendMessage uses)
//   codex[.<thread-id-prefix>] -> codex app-server daemon, turn/start (or turn/steer if a turn is running)
//   gemini[.<conversation-prefix>] -> agy `agentapi send-message` (sessions self-register via agy-register.sh)
// No live session -> the file stays in the inbox and the agent reads it with mail_check as before.
// A message is claimed (renamed to <id>.json.pushing, which mail_check ignores) before it is pushed, so it is
// delivered once: either by the push or by mail_check, never both.
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
  return `[agent-intercom] message ${m.id} from ${m.from}${m.reply_to ? ` (re ${m.reply_to})` : ''}:\n${m.body}\n\n` +
    `(This came from another AI agent through agent-intercom. Reply with the mail_send tool: to "${m.from}", reply_to "${m.id}".)`;
}

// ---- Claude Code: peer messaging socket ----
function claudeSessions() {
  let files = [];
  try { files = fs.readdirSync(CLAUDE_SESSIONS); } catch { return []; }
  return files.filter((f) => /^\d+\.json$/.test(f)).map((f) => readJson(path.join(CLAUDE_SESSIONS, f)))
    .filter((r) => r && r.messagingSocketPath && alive(r.pid) && fs.existsSync(r.messagingSocketPath))
    .map((r) => ({ ...r, t: r.statusUpdatedAt || r.updatedAt || 0 }));
}

// The socket never acknowledges a message, so the best available check is that the session kept the
// connection open after reading both lines; one that drops or errors instead counts as a failed push.
function claudePush(sess, m) {
  const hash = crypto.createHash('sha256').update(path.resolve(sess.messagingSocketPath)).digest('hex');
  const key = readJson(path.join(CLAUDE_SESSIONS, `${sess.pid}.${hash}.key`));
  if (!key?.peerToken) throw new Error(`no peer key for claude pid ${sess.pid}`);
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      c.destroy();
      err ? reject(err) : resolve(`claude session ${sess.name} (pid ${sess.pid})`);
    };
    const c = net.createConnection({ path: sess.messagingSocketPath }, () => {
      c.write(JSON.stringify({ type: 'auth', token: key.peerToken }) + '\n');
      c.write(JSON.stringify({ type: 'user', message: { role: 'user', content: render(m) }, from: `agent-intercom:${m.from}` }) + '\n',
        () => { setTimeout(() => { c.end(); finish(); }, 300); });
    });
    const timer = setTimeout(() => finish(new Error('claude socket timeout')), 5000);
    c.on('error', finish);
    c.on('close', () => finish(new Error('claude session closed the connection before accepting the message')));
  });
}

// ---- Codex: app-server daemon ----
// Returns a target with push()/close(), or null when no loaded thread matches.
async function codexTarget(want) {
  const { session } = require('./codex-ws.js');
  let s;
  try { s = await session(); } catch { return null; } // no codex daemon running: nobody to push to
  try {
    const loaded = (await s.call('thread/loaded/list', {})).result?.data || [];
    const threads = [];
    for (const id of loaded) {
      const t = (await s.call('thread/read', { threadId: id, includeTurns: true })).result?.thread;
      if (t && !t.ephemeral) threads.push({ ...t, t: t.updatedAt || 0 });
    }
    const th = pick(threads, want, (t, w) => t.id.startsWith(w));
    if (!th) { s.close(); return null; }
    return {
      close: s.close,
      async push(m) {
        const input = [{ type: 'text', text: render(m) }];
        const active = (th.turns || []).find((x) => x.status === 'inProgress');
        const r = active
          ? await s.call('turn/steer', { threadId: th.id, expectedTurnId: active.id, input })
          : await s.call('turn/start', { threadId: th.id, input });
        if (r.error) throw new Error(`codex ${active ? 'turn/steer' : 'turn/start'}: ${r.error.message}`);
        return `codex thread ${th.id} (${active ? 'steered running turn' : 'new turn'})`;
      },
    };
  } catch (e) { s.close(); throw e; }
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
      let res;
      try { res = JSON.parse(out); } catch { return reject(new Error(`agentapi: unexpected output: ${out.trim().slice(0, 200)}`)); }
      if (res.error) return reject(new Error(`agentapi: ${res.error}`));
      resolve(`agy conversation ${sess.conversationId} (pid ${sess.pid})`);
    });
  });
}

async function target(kind, want) {
  if (kind === 'claude') {
    const s = pick(claudeSessions(), want, (x, w) => x.name === w || x.sessionId?.startsWith(w));
    return s && { push: (m) => claudePush(s, m) };
  }
  if (kind === 'codex') return codexTarget(want);
  if (kind === 'gemini') {
    const s = pick(agySessions(), want, (x, w) => x.conversationId.startsWith(w));
    return s && { push: (m) => agyPush(s, m) };
  }
  return null;
}

// Push one inbox file. Throws on a failed push, after putting the file back in the inbox.
async function deliver(name, file) {
  const [kind, ...rest] = name.split('.');
  const want = rest.join('.') || routes()[name] || routes()[kind];
  const m = readJson(file);
  if (!m) return;
  const t = await target(kind, want);
  if (!t) return log(`${m.id} -> ${name}: no live session, left in inbox`);
  const claimed = `${file}.pushing`;
  try {
    try { fs.renameSync(file, claimed); } catch { return; } // mail_check took it first
    let where;
    try { where = await t.push(m); } catch (e) { try { fs.renameSync(claimed, file); } catch {} throw e; }
    const read = path.join(ROOT, name, 'read');
    fs.mkdirSync(read, { recursive: true });
    fs.renameSync(claimed, path.join(read, path.basename(file)));
    log(`${m.id} ${m.from} -> ${name}: pushed into ${where}`);
  } finally { t.close?.(); }
}

const RETRY_MS = Number(process.env.AGENT_MAIL_RETRY_MS) || 30000;
const busy = new Set();
const again = new Set();
const backoff = new Map(); // file -> time before which a failed push is not retried
async function scan(name) {
  if (busy.has(name)) { again.add(name); return; }
  busy.add(name);
  try {
    do {
      again.delete(name);
      const inbox = path.join(ROOT, name, 'inbox');
      let files = [];
      try { files = fs.readdirSync(inbox).filter((f) => f.endsWith('.json')).sort(); } catch {}
      for (const f of files) {
        const file = path.join(inbox, f);
        if ((backoff.get(file) || 0) > Date.now()) continue;
        try {
          await deliver(name, file);
          backoff.delete(file);
        } catch (e) {
          log(`${f} -> ${name}: push failed, retry in ${RETRY_MS / 1000}s: ${e.message}`);
          backoff.set(file, Date.now() + RETRY_MS);
          setTimeout(() => scan(name), RETRY_MS + 50).unref?.();
        }
      }
    } while (again.has(name));
  } finally { busy.delete(name); }
}

// A crash mid-push leaves <id>.json.pushing behind; put those back so they are delivered once.
function recoverClaims(name) {
  const inbox = path.join(ROOT, name, 'inbox');
  let files = [];
  try { files = fs.readdirSync(inbox).filter((f) => f.endsWith('.json.pushing')); } catch {}
  for (const f of files) try { fs.renameSync(path.join(inbox, f), path.join(inbox, f.slice(0, -'.pushing'.length))); } catch {}
}

function main() {
  fs.mkdirSync(ROOT, { recursive: true });
  const local = (n) => /^(claude|codex|gemini)(\.|$)/.test(n);
  for (const n of fs.readdirSync(ROOT)) if (local(n)) recoverClaims(n);
  let watcher;
  try {
    watcher = fs.watch(ROOT, { recursive: true }, (_ev, rel) => {
      if (!rel) return;
      const parts = rel.split(path.sep);
      if (parts[1] === 'inbox' && rel.endsWith('.json') && local(parts[0])) setTimeout(() => scan(parts[0]), 150);
      // An agy session just registered: flush gemini mail that was waiting for one.
      if (parts[0] === 'gemini' && parts[1] === 'sessions' && rel.endsWith('.json')) setTimeout(() => scan('gemini'), 150);
    });
  } catch (e) {
    // Recursive fs.watch needs Node 20+ on Linux.
    console.error(`agent-intercom pushd: cannot watch ${ROOT} recursively (${e.code || e.message}); Node 20 or newer is required`);
    process.exit(1);
  }
  watcher.on('error', (e) => { console.error(`agent-intercom pushd: watch failed: ${e.message}`); process.exit(1); });
  // Mail that arrived while the daemon was down.
  for (const n of fs.readdirSync(ROOT)) if (local(n)) scan(n);
  log(`agent-intercom pushd watching ${ROOT}`);
}

if (require.main === module) main();

module.exports = { deliver, scan, render, main, recoverClaims };
