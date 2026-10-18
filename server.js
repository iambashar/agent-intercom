#!/usr/bin/env node
// agent-intercom: tiny file-backed mailbox exposed as an MCP stdio server.
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
  console.error(`agent-intercom: invalid AGENT_NAME "${process.env.AGENT_NAME}"`);
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
    title: 'Send a message to another agent',
    description:
      `Deliver a text message from you ("${ME}") to another coding agent's inbox, for example to hand off a task, ask a question or report a result. ` +
      'Call mail_peers first if you are unsure of the recipient name. To answer a message you received from mail_check, pass its id as reply_to. ' +
      'Each call writes one new message and never edits or removes existing mail. If the recipient has not started yet, the message waits in its inbox. ' +
      'Returns "sent <id> to <name>"; keep the id if you expect a reply that references it.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', pattern: '^[\\w-]+(\\.[\\w-]+)*$', description: 'Recipient agent name as listed by mail_peers, e.g. "codex", "claude" or "gemini". Letters, digits, _ and -, with optional .suffix segments.' },
        body: { type: 'string', minLength: 1, description: 'Message text, in plain text or Markdown. Include everything the recipient needs, since it cannot see your conversation.' },
        reply_to: { type: 'string', description: 'Optional. The id of the message you are answering (the value in [brackets] from mail_check), so the recipient can match the reply to its question.' },
      },
      required: ['to', 'body'],
      additionalProperties: false,
    },
    annotations: { title: 'Send a message to another agent', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'mail_check',
    title: 'Read new messages',
    description:
      `Fetch the unread messages addressed to you ("${ME}"), oldest first. Use it when you expect a reply or want to see if another agent wrote to you. ` +
      'Reading consumes the messages: each one is moved to your read folder and is not returned again, so act on or note what you need. ' +
      'With wait_seconds above 0 the call blocks until at least one message arrives or the time runs out. ' +
      'Returns each message as "[<id>] from <sender> (re <id>) at <time>:" followed by its body, or "no new messages". ' +
      'When live push is installed, new mail may already appear in your session without calling this tool.',
    inputSchema: {
      type: 'object',
      properties: {
        wait_seconds: { type: 'number', minimum: 0, maximum: 300, default: 0, description: 'How long to wait for a message if the inbox is empty, in seconds (0 to 300). 0 returns immediately.' },
      },
      additionalProperties: false,
    },
    annotations: { title: 'Read new messages', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'mail_peers',
    title: 'List agents on the mailbox',
    description:
      'List every agent name that has a mailbox here, so you know valid recipients for mail_send. ' +
      'Read-only: it changes nothing. ' +
      'Returns one line per agent: "<name> - last started <ISO time>", or "never started" for an agent that has mail waiting but has not run yet. Your own name is marked "(you)". ' +
      'A recent start time suggests the agent is active, but it does not guarantee a session is open right now.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'List agents on the mailbox', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
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
    // Rename first: whoever wins the rename (this or the push daemon's claim) is the one that delivers it.
    const dest = path.join(dir(ME, 'read'), f);
    try { fs.renameSync(path.join(inbox, f), dest); } catch { continue; }
    try { msgs.push(JSON.parse(fs.readFileSync(dest, 'utf8'))); } catch {}
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
  // Only agent folders (they have an inbox); skips helpers like bin/.
  const rows = fs.readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(ROOT, d.name, 'inbox'))).map((d) => {
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
        serverInfo: { name: 'agent-intercom', version: require('./package.json').version },
        instructions: `You are agent "${ME}" on a mailbox shared with other coding agents. Use mail_peers to see who is there, mail_send to message one, and mail_check to read replies.`,
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
