const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', 'server.js');

// Minimal MCP stdio client: one server process per agent name.
function client(name, dir) {
  const p = spawn('node', [SERVER], { env: { ...process.env, AGENT_NAME: name, AGENT_MAIL_DIR: dir } });
  let buf = '';
  const waiting = new Map();
  p.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      waiting.get(msg.id)?.(msg);
    }
  });
  let id = 0;
  const rpc = (method, params) => new Promise((res) => {
    const myId = ++id;
    waiting.set(myId, res);
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: myId, method, params }) + '\n');
  });
  return {
    init: () => rpc('initialize', {}),
    list: () => rpc('tools/list', {}),
    call: async (tool, args = {}) => (await rpc('tools/call', { name: tool, arguments: args })).result,
    close: () => p.kill(),
  };
}

test('claude and codex exchange messages', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mail-'));
  const claude = client('claude', dir);
  const codex = client('codex', dir);
  await claude.init();
  await codex.init();

  const tools = (await claude.list()).result.tools.map((t) => t.name);
  assert.deepStrictEqual(tools, ['mail_send', 'mail_check', 'mail_peers']);

  await claude.call('mail_send', { to: 'codex', body: 'review foo.py' });
  const got = await codex.call('mail_check');
  assert.match(got.content[0].text, /from claude/);
  assert.match(got.content[0].text, /review foo\.py/);

  // consumed: second check is empty
  assert.match((await codex.call('mail_check')).content[0].text, /no new messages/);

  // blocking wait returns as soon as a reply lands
  const waiting = claude.call('mail_check', { wait_seconds: 5 });
  setTimeout(() => codex.call('mail_send', { to: 'claude', body: 'lgtm' }), 300);
  assert.match((await waiting).content[0].text, /lgtm/);

  claude.close();
  codex.close();
});

test('rejects send without body', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mail-'));
  const a = client('a', dir);
  await a.init();
  const r = await a.call('mail_send', { to: 'b' });
  assert.strictEqual(r.isError, true);
  a.close();
});
