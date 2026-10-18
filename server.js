#!/usr/bin/env node
// agent-mail: tiny file-backed mailbox exposed as an MCP stdio server.
// Any MCP client (Claude Code, Codex CLI) sets AGENT_NAME and gets the same three tools.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = process.env.AGENT_MAIL_DIR || path.join(os.homedir(), '.agent-mail');
// Names become directory names under ROOT: dot-separated segments of [A-Za-z0-9_-], so "." and ".." can't escape it.
const NAME = /^[\w-]+(\.[\w-]+)*$/;
const ME = (process.env.AGENT_NAME || 'agent').replace(/[^\w.-]/g, '');
if (!NAME.test(ME)) {
  console.error(`agent-mail: invalid AGENT_NAME "${process.env.AGENT_NAME}"`);
  process.exit(1);
}
const dir = (name, sub) => path.join(ROOT, name, sub);
const ensure = (p) => fs.mkdirSync(p, { recursive: true });
ensure(dir(ME, 'inbox'));
ensure(dir(ME, 'read'));
fs.writeFileSync(path.join(ROOT, ME, 'alive'), String(Date.now()));

const TOOLS = [
  {
    name: 'mail_send',
    description: `Send a message to another agent (you are "${ME}"). Use mail_peers to see names. Set reply_to to a message id when answering one.`,
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient agent name, e.g. "codex" or "claude"' },
        body: { type: 'string' },
        reply_to: { type: 'string', description: 'Id of the message you are replying to' },
      },
      required: ['to', 'body'],
    },
  },
  {
    name: 'mail_check',
    description: `Read and consume new messages addressed to "${ME}". With wait_seconds > 0, blocks until a message arrives or the time runs out (max 300).`,
    inputSchema: {
      type: 'object',
      properties: { wait_seconds: { type: 'number', description: 'Block up to this long for a message' } },
    },
  },
  {
    name: 'mail_peers',
    description: 'List known agent names and when each last started.',
    inputSchema: { type: 'object', properties: {} },
  },
];

function send({ to, body, reply_to }) {
  to = String(to || '').replace(/[^\w.-]/g, '');
  if (!to || !body) throw new Error('to and body are required');
  if (!NAME.test(to)) throw new Error(`invalid recipient "${to}": use letters, digits, _ and -, with optional .session suffixes`);
  ensure(dir(to, 'inbox'));
  const id = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const msg = { id, from: ME, to, body, reply_to: reply_to || null, sent: new Date().toISOString() };
  const tmp = path.join(dir(to, 'inbox'), `.${id}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(msg));
  fs.renameSync(tmp, path.join(dir(to, 'inbox'), `${id}.json`)); // atomic: reader never sees half a file
  const alive = path.join(ROOT, to, 'alive');
  const note = fs.existsSync(alive) ? '' : ` (no agent named "${to}" has started yet; it will see this when it does)`;
  return `sent ${id} to ${to}${note}`;
}

function drain() {
  const inbox = dir(ME, 'inbox');
  const files = fs.readdirSync(inbox).filter((f) => f.endsWith('.json')).sort();
  const msgs = [];
  for (const f of files) {
    const p = path.join(inbox, f);
    try {
      msgs.push(JSON.parse(fs.readFileSync(p, 'utf8')));
      fs.renameSync(p, path.join(dir(ME, 'read'), f));
    } catch {}
  }
  return msgs;
}

const fmt = (msgs) =>
  msgs.length
    ? msgs.map((m) => `[${m.id}] from ${m.from}${m.reply_to ? ` (re ${m.reply_to})` : ''} at ${m.sent}:\n${m.body}`).join('\n\n---\n\n')
    : 'no new messages';

async function check({ wait_seconds = 0 }) {
  const end = Date.now() + Math.min(Number(wait_seconds) || 0, 300) * 1000;
  for (;;) {
    const msgs = drain();
    if (msgs.length || Date.now() >= end) return fmt(msgs);
    await new Promise((r) => setTimeout(r, 400));
  }
}

function peers() {
  const rows = fs.readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => {
    const a = path.join(ROOT, d.name, 'alive');
    const t = fs.existsSync(a) ? new Date(Number(fs.readFileSync(a, 'utf8'))).toISOString() : 'never started';
    return `${d.name}${d.name === ME ? ' (you)' : ''} - last started ${t}`;
  });
  return rows.join('\n');
}

const text = (s) => ({ content: [{ type: 'text', text: s }] });

async function handle(req) {
  switch (req.method) {
    case 'initialize':
      return {
        protocolVersion: req.params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'agent-mail', version: '0.1.0' },
        instructions: `You are agent "${ME}" on a shared mailbox. Use mail_send / mail_check to talk to other agents.`,
      };
    case 'tools/list':
      return { tools: TOOLS };
    case 'tools/call': {
      const { name, arguments: a = {} } = req.params;
      try {
        if (name === 'mail_send') return text(send(a));
        if (name === 'mail_check') return text(await check(a));
        if (name === 'mail_peers') return text(peers());
        throw new Error(`unknown tool ${name}`);
      } catch (e) {
        return { ...text(`error: ${e.message}`), isError: true };
      }
    }
    case 'ping':
      return {};
    default:
      if (req.method?.startsWith('notifications/')) return undefined;
      throw Object.assign(new Error(`method not found: ${req.method}`), { code: -32601 });
  }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let req;
    try { req = JSON.parse(line); } catch { continue; }
    handle(req).then(
      (result) => { if (req.id !== undefined && result !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }) + '\n'); },
      (e) => { if (req.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, error: { code: e.code || -32603, message: e.message } }) + '\n'); },
    );
  }
});
process.stdin.on('end', () => process.exit(0));
