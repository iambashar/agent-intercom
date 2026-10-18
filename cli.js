#!/usr/bin/env node
// agent-mail CLI: install/uninstall the MCP server into Claude Code, Codex and Antigravity (agy),
// run or install the push daemon, watch an inbox.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = process.env.AGENT_MAIL_DIR || path.join(os.homedir(), '.agent-mail');
const CODEX_CONFIG = path.join(os.homedir(), '.codex', 'config.toml');
const AGY_HOOKS = path.join(os.homedir(), '.gemini', 'config', 'hooks.json');
const HOOK_NAME = 'agent-mail-register';
const PUSH_LABEL = 'dev.agent-mail.pushd';
const LAUNCHD_PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${PUSH_LABEL}.plist`);
const SYSTEMD_UNIT = path.join(os.homedir(), '.config', 'systemd', 'user', 'agent-mail-pushd.service');
const BEGIN = '# >>> agent-mail (managed) >>>';
const END = '# <<< agent-mail (managed) <<<';
const [cmd, ...rest] = process.argv.slice(2);
const flag = (f) => rest.includes(f);
const opt = (f, d) => (rest.includes(f) ? rest[rest.indexOf(f) + 1] : d);

// `npx @basharmk/agent-mail serve` is the stable command; --local pins this checkout instead.
function serverCommand() {
  return flag('--local')
    ? { command: 'node', args: [path.join(__dirname, 'server.js')] }
    : { command: 'npx', args: ['-y', '@basharmk/agent-mail', 'serve'] };
}

const has = (bin) => spawnSync('which', [bin]).status === 0;

function installClaude(name) {
  if (!has('claude')) return console.log('claude: CLI not found, skipped');
  const { command, args } = serverCommand();
  spawnSync('claude', ['mcp', 'remove', '-s', 'user', 'agent-mail'], { stdio: 'ignore' });
  const r = spawnSync('claude', ['mcp', 'add', '-s', 'user', 'agent-mail', '-e', `AGENT_NAME=${name}`, '--', command, ...args], { encoding: 'utf8' });
  console.log(r.status === 0 ? `claude: registered as "${name}" (user scope). Restart Claude Code.` : `claude: failed\n${r.stderr}`);
}

function stripBlock(text) {
  const re = new RegExp(`\\n?${BEGIN.replace(/[>()]/g, '\\$&')}[\\s\\S]*?${END.replace(/[<()]/g, '\\$&')}\\n?`);
  return text.replace(re, '\n');
}

function installCodex(name) {
  if (!fs.existsSync(path.dirname(CODEX_CONFIG))) return console.log('codex: ~/.codex not found, skipped');
  const { command, args } = serverCommand();
  const cur = fs.existsSync(CODEX_CONFIG) ? fs.readFileSync(CODEX_CONFIG, 'utf8') : '';
  if (/\[mcp_servers\.agent-mail\]/.test(stripBlock(cur))) {
    return console.log('codex: an unmanaged [mcp_servers.agent-mail] block already exists, left alone');
  }
  if (cur) fs.copyFileSync(CODEX_CONFIG, `${CODEX_CONFIG}.bak-agentmail`);
  const block = [
    BEGIN,
    '[mcp_servers.agent-mail]',
    `command = ${JSON.stringify(command)}`,
    `args = ${JSON.stringify(args)}`,
    'tool_timeout_sec = 330',
    '',
    '[mcp_servers.agent-mail.env]',
    `AGENT_NAME = ${JSON.stringify(name)}`,
    END,
    '',
  ].join('\n');
  fs.writeFileSync(CODEX_CONFIG, stripBlock(cur).replace(/\s*$/, '\n\n') + block);
  console.log(`codex: registered as "${name}" in ${CODEX_CONFIG}. Restart Codex.`);
}

function installGemini(name) {
  if (!has('agy')) return console.log('gemini: agy (Antigravity CLI) not found, skipped');
  const { command, args } = serverCommand();
  spawnSync('agy', ['mcp', 'remove', 'agent-mail'], { stdio: 'ignore' });
  const r = spawnSync('agy', ['mcp', 'add', '-e', `AGENT_NAME=${name}`, 'agent-mail', '--', command, ...args], { encoding: 'utf8' });
  if (r.status !== 0) return console.log(`gemini: failed\n${r.stderr}`);
  // The hook lets each live agy session register itself so the push daemon can reach it. It is copied into the
  // mailbox because __dirname may be npx's cache, which npm can delete at any time.
  const script = path.join(ROOT, 'bin', 'agy-register.sh');
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'agy-register.sh'), script);
  fs.chmodSync(script, 0o755);
  const hooks = fs.existsSync(AGY_HOOKS) ? JSON.parse(fs.readFileSync(AGY_HOOKS, 'utf8')) : {};
  const hook = [{ type: 'command', command: script, timeout: 10 }];
  hooks[HOOK_NAME] = { SessionStart: hook, PreInvocation: hook };
  fs.mkdirSync(path.dirname(AGY_HOOKS), { recursive: true });
  fs.writeFileSync(AGY_HOOKS, JSON.stringify(hooks, null, 2) + '\n');
  console.log(`gemini: registered as "${name}" in agy, session hook in ${AGY_HOOKS}. Restart agy.`);
}

function uninstallGemini() {
  if (has('agy')) spawnSync('agy', ['mcp', 'remove', 'agent-mail'], { stdio: 'inherit' });
  if (!fs.existsSync(AGY_HOOKS)) return;
  const hooks = JSON.parse(fs.readFileSync(AGY_HOOKS, 'utf8'));
  if (!(HOOK_NAME in hooks)) return;
  delete hooks[HOOK_NAME];
  fs.writeFileSync(AGY_HOOKS, JSON.stringify(hooks, null, 2) + '\n');
  console.log('gemini: removed session hook');
}

// The push daemon has to outlive npx's cache, so it runs from a stable checkout or global install.
function pushInstall() {
  if (__dirname.includes(`${path.sep}_npx${path.sep}`)) {
    console.error('push: run this from a global install (npm i -g @basharmk/agent-mail) or a git checkout, not npx');
    process.exit(1);
  }
  const node = process.execPath;
  const script = path.join(__dirname, 'pushd.js');
  const envPath = [path.dirname(node), path.join(os.homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].join(':');
  if (process.platform === 'darwin') {
    const log = path.join(os.homedir(), 'Library', 'Logs', 'agent-mail-pushd.log');
    fs.mkdirSync(path.dirname(LAUNCHD_PLIST), { recursive: true });
    fs.writeFileSync(LAUNCHD_PLIST, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${PUSH_LABEL}</string>
  <key>ProgramArguments</key><array><string>${node}</string><string>${script}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${envPath}</string></dict>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict></plist>
`);
    const uid = process.getuid();
    spawnSync('launchctl', ['bootout', `gui/${uid}`, LAUNCHD_PLIST], { stdio: 'ignore' });
    const r = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, LAUNCHD_PLIST], { encoding: 'utf8' });
    console.log(r.status === 0 ? `push: daemon running (launchd ${PUSH_LABEL}), log ${log}` : `push: launchctl failed\n${r.stderr}`);
  } else if (process.platform === 'linux') {
    fs.mkdirSync(path.dirname(SYSTEMD_UNIT), { recursive: true });
    fs.writeFileSync(SYSTEMD_UNIT, `[Unit]
Description=agent-mail push daemon

[Service]
ExecStart=${node} ${script}
Environment=PATH=${envPath}
Restart=always

[Install]
WantedBy=default.target
`);
    const r = spawnSync('systemctl', ['--user', 'enable', '--now', 'agent-mail-pushd.service'], { encoding: 'utf8' });
    console.log(r.status === 0 ? 'push: daemon running (systemd --user agent-mail-pushd)' : `push: systemctl failed\n${r.stderr}`);
  } else console.log(`push: no service manager support for ${process.platform}; run "agent-mail push run" yourself`);
}

function pushUninstall() {
  if (fs.existsSync(LAUNCHD_PLIST)) {
    spawnSync('launchctl', ['bootout', `gui/${process.getuid()}`, LAUNCHD_PLIST], { stdio: 'ignore' });
    fs.unlinkSync(LAUNCHD_PLIST);
    console.log('push: launchd daemon removed');
  }
  if (fs.existsSync(SYSTEMD_UNIT)) {
    spawnSync('systemctl', ['--user', 'disable', '--now', 'agent-mail-pushd.service'], { stdio: 'ignore' });
    fs.unlinkSync(SYSTEMD_UNIT);
    console.log('push: systemd unit removed');
  }
}

function uninstall() {
  if (has('claude')) spawnSync('claude', ['mcp', 'remove', '-s', 'user', 'agent-mail'], { stdio: 'inherit' });
  if (fs.existsSync(CODEX_CONFIG)) {
    const cur = fs.readFileSync(CODEX_CONFIG, 'utf8');
    if (cur.includes(BEGIN)) {
      fs.writeFileSync(CODEX_CONFIG, stripBlock(cur));
      console.log('codex: removed managed block');
    } else console.log('codex: no managed block found (remove [mcp_servers.agent-mail] by hand if you added it yourself)');
  }
  uninstallGemini();
  pushUninstall();
}

function status() {
  if (!fs.existsSync(ROOT)) return console.log(`no mailbox yet at ${ROOT}`);
  for (const d of fs.readdirSync(ROOT, { withFileTypes: true }).filter((x) => x.isDirectory())) {
    const n = (s) => (fs.existsSync(path.join(ROOT, d.name, s)) ? fs.readdirSync(path.join(ROOT, d.name, s)).filter((f) => f.endsWith('.json')).length : 0);
    console.log(`${d.name}: ${n('inbox')} unread, ${n('read')} read`);
  }
}

// Prints one line per new message and does NOT consume it, so it is safe to run
// under Claude Code's Monitor tool: each line wakes the session, which then calls mail_check.
function watch(name) {
  const inbox = path.join(ROOT, name, 'inbox');
  fs.mkdirSync(inbox, { recursive: true });
  const seen = new Set();
  const tick = () => {
    for (const f of fs.readdirSync(inbox).filter((x) => x.endsWith('.json')).sort()) {
      if (seen.has(f)) continue;
      seen.add(f);
      try {
        const m = JSON.parse(fs.readFileSync(path.join(inbox, f), 'utf8'));
        console.log(`new mail for ${name} from ${m.from}: ${m.body.replace(/\s+/g, ' ').slice(0, 120)}`);
      } catch {}
    }
  };
  tick();
  setInterval(tick, 1000);
}

switch (cmd) {
  case 'serve':
    require('./server.js');
    break;
  case 'install': {
    const only = opt('--only');
    if (!only || only === 'claude') installClaude(opt('--claude-name', 'claude'));
    if (!only || only === 'codex') installCodex(opt('--codex-name', 'codex'));
    if (!only || only === 'gemini') installGemini(opt('--gemini-name', 'gemini'));
    if (flag('--push')) pushInstall();
    break;
  }
  case 'push':
    if (rest[0] === 'install') pushInstall();
    else if (rest[0] === 'uninstall') pushUninstall();
    else if (rest[0] === 'run') require('./pushd.js').main();
    else { console.error('usage: agent-mail push install|uninstall|run'); process.exit(1); }
    break;
  case 'uninstall':
    uninstall();
    break;
  case 'status':
    status();
    break;
  case 'watch':
    if (!rest[0]) { console.error('usage: agent-mail watch <name>'); process.exit(1); }
    watch(rest[0]);
    break;
  default:
    console.log(`agent-mail <command>

  install [--only claude|codex|gemini] [--claude-name N] [--codex-name N] [--gemini-name N] [--local] [--push]
  uninstall        remove the MCP entries, the agy hook and the push daemon
  push install     run the push daemon as a login service (launchd / systemd --user)
  push uninstall
  push run         run the push daemon in the foreground
  status
  watch <name>     print a line per new message (for Claude Code's Monitor)
  serve            run the MCP server on stdio (what the clients launch)`);
}
