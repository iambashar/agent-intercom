# agent-intercom

**Let Claude Code, Codex CLI and Antigravity (Gemini) message each other.**

A tiny MCP server that gives any coding agent an inbox. One agent calls `mail_send`, the other calls `mail_check`, and they can go back and forth: ask for a review, hand off a task, answer a question. No cloud, no dependencies.

With the optional push daemon, a message is delivered straight into the recipient's open session as a new turn, the same way Claude Code's own cross-session messages arrive. Nobody has to poll.

```
Claude Code session          Codex CLI session          agy (Antigravity) session
  └─ server.js                 └─ server.js               └─ server.js
     AGENT_NAME=claude            AGENT_NAME=codex           AGENT_NAME=gemini
            │                           │                          │
            └──────────►   ~/.agent-mail/<name>/inbox   ◄──────────┘
                                        │
                        pushd (optional) watches the inbox and
                        injects each message into the live session
```

Each client launches its own copy of the server. The copies share a folder, and messages are atomic JSON files. Any MCP client works.

## Install

```sh
npx agent-intercom install
```

This registers the server with every CLI it finds, then you restart them:

- **Claude Code:** `claude mcp add`, user scope.
- **Codex:** a managed block in `~/.codex/config.toml` (backed up first).
- **Antigravity CLI (`agy`):** `agy mcp add`, plus a session hook in `~/.gemini/config/hooks.json` used by push.

Use `--only claude|codex|gemini` to do one, and `--local` to pin a git checkout instead of npx. Remove everything with `npx agent-intercom uninstall`.

> The old `gemini` CLI no longer accepts personal Google AI Pro sign-ins; Google moved those users to the Antigravity CLI (`agy`). Its agent is called `gemini` here by default.

## Use

Tell any agent what you want in plain words:

> Ask codex to review the diff in `src/parser.ts` and wait for its answer.

| Tool | What it does |
| --- | --- |
| `mail_send(to, body, reply_to?)` | Drop a message in another agent's inbox |
| `mail_check(wait_seconds?)` | Read and consume your messages. With `wait_seconds` (max 300) it blocks until one arrives |
| `mail_peers()` | List known agents |

## Live push

MCP servers are passive: a message sits in the inbox until the agent calls `mail_check`. The push daemon closes that gap without polling. It watches the mailbox and, when a message lands, injects it into the recipient's open session:

| Recipient | How it is delivered |
| --- | --- |
| Claude Code | The session's local peer-messaging socket, the channel `SendMessage` uses between sessions |
| Codex CLI | The shared app-server daemon the Codex TUI connects to: a new turn, or added to the running one |
| agy | `agy agentapi send-message` into the registered conversation |

```sh
npm i -g agent-intercom          # the daemon needs a stable path, so not npx
agent-intercom install --push    # or: agent-intercom push install
```

It runs as a launchd agent on macOS or a `systemd --user` service on Linux. Address one session with `claude.<session-name>`, `codex.<thread-id-prefix>` or `gemini.<conversation-prefix>`. Otherwise the most recently active session gets it, or the one named in `~/.agent-mail/routes.json`:

```json
{ "claude": "api-server", "codex": "019f018a" }
```

If no session is open, the message stays in the inbox and `mail_check` still works.

**Push relies on undocumented internals of all three CLIs.** An update can change them without notice. When a push fails, the daemon logs it and leaves the message in the inbox. Details: [docs/live-push.md](docs/live-push.md).

### Without the daemon

- **Claude Code:** [docs/claude-monitor.md](docs/claude-monitor.md). `agent-intercom watch claude` under the Monitor tool wakes the session when mail arrives.
- **Codex:** [docs/codex-listen.md](docs/codex-listen.md). A listener prompt that loops on `mail_check(wait_seconds=300)`.

## More than two agents

Names are just `AGENT_NAME`. Give each session its own, for example `claude-api` and `claude-web`:

```sh
npx agent-intercom install --only claude --claude-name claude-api
```

## Another machine

Agents on a machine with no shared filesystem, such as a GPU server or HPC cluster, can join over SSH with [bridge.sh](bridge.sh). It moves each message to the machine its recipient lives on. See [docs/remote-bridge.md](docs/remote-bridge.md).

## CLI

```
agent-intercom install [--only claude|codex|gemini] [--claude-name N] [--codex-name N] [--gemini-name N] [--local] [--push]
agent-intercom uninstall        MCP entries, agy hook and push daemon
agent-intercom push install     push daemon as a login service
agent-intercom push uninstall
agent-intercom push run         push daemon in the foreground
agent-intercom status           unread/read counts per agent
agent-intercom watch <name>     one line per new message, without consuming it
agent-intercom serve            the MCP server on stdio
```

## Security

This is a local mailbox with no authentication. Any process running as you can write to `~/.agent-mail/*/inbox`, and **an agent treats a message as input to act on**. With push enabled, that input arrives in your open sessions without you typing anything.

- Treat inbox contents as untrusted text. Do not let one agent auto-approve destructive actions because a message told it to.
- Pushed messages are labeled `[agent-intercom] message <id> from <sender>`. Claude Code also marks them as coming from another session, not from you.
- Push reads tokens that only your user can read (`~/.claude/sessions/*.key`, the agy session token) and only talks to local sockets. It never sends anything off the machine.
- Claude Code's session socket accepts any process running as your user (it checks the connecting process, not just the token), so agent-intercom doesn't open anything that wasn't already reachable.

Set `AGENT_MAIL_DIR` to move the mailbox, for example to a project folder.

## Develop

```sh
npm test
```

Zero runtime dependencies; Node 20+.

## License

MIT
