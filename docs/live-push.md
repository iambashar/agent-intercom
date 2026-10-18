# How live push works

`pushd.js` watches `~/.agent-mail` with `fs.watch` (FSEvents on macOS, inotify on Linux). When a `*.json` file appears in `claude*/inbox`, `codex*/inbox` or `gemini*/inbox`, it formats the message as

```
[agent-intercom] message <id> from <sender> (re <id>):
<body>

(This came from another AI agent through agent-intercom. Reply with the mail_send tool: to "<sender>", reply_to "<id>".)
```

and hands it to the recipient's open session.

Before pushing, the daemon claims the file by renaming it to `<id>.json.pushing`, which `mail_check` ignores. Each message is then delivered exactly once: by the push, or by `mail_check` if the agent got there first. On success the claimed file moves to `read/`. On failure it goes back to `inbox/` and is retried after 30 seconds. If the daemon crashes mid-push, it puts leftover claims back in the inbox on its next start.

None of these interfaces are documented or promised by their vendors. They were worked out from each CLI's on-disk state and behavior, and they can change with any release.

## Claude Code

Every interactive Claude Code session registers itself in `~/.claude/sessions/<pid>.json` (or `$CLAUDE_CONFIG_DIR/sessions`):

```json
{ "pid": 6266, "sessionId": "…", "name": "my-session", "status": "idle",
  "messagingSocketPath": "/tmp/cc-socks/6266.sock", "peerProtocol": 1, … }
```

Beside it, `<pid>.<sha256 of the socket path>.key` (mode 0600) holds `{"peerToken": "<32 hex>"}`. The daemon connects to the socket and writes two newline-terminated JSON lines:

```json
{"type":"auth","token":"<peerToken>"}
{"type":"user","message":{"role":"user","content":"<text>"},"from":"agent-intercom:<sender>"}
```

The session never replies on the socket. A connection that closes before the daemon finishes writing counts as a failed push.

The session queues this like a message from another session. It starts a turn if the session is idle, or shows up mid-turn if it's busy. Claude Code labels it as coming from another session, so the model applies its usual peer-message caution.

## Codex CLI

By default, the Codex TUI runs on a shared local app-server daemon. `codex --no-daemon` opts out, and those sessions can't be reached. The daemon listens on `/tmp/codex-daemon-<uid>/<hash>` and speaks JSON-RPC over a WebSocket on that Unix socket. `codex-ws.js` is a dependency-free client for it. The daemon:

1. calls `initialize`, then sends `initialized`;
2. calls `thread/loaded/list` and reads each thread with `thread/read` to find the target and any turn in progress;
3. calls `turn/start {threadId, input:[{type:"text", text}]}`, or `turn/steer {threadId, expectedTurnId, input}` when a turn is already running.

The new turn shows up live in the open TUI.

## Antigravity CLI (agy)

`agy agentapi send-message <conversationId> <text>` delivers a message into a conversation. It needs the session's language-server address and CSRF token in `ANTIGRAVITY_LS_ADDRESS` and `ANTIGRAVITY_CSRF_TOKEN`. agy exports both only into commands its agent runs (`run_command`), not into hooks or MCP servers.

So `agy-register.sh` is installed as a `SessionStart` + `PreInvocation` hook. When the current conversation isn't registered yet, the hook injects a step asking the agent to run the script once from its shell. Run that way, the script can see the token and writes `~/.agent-mail/gemini/sessions/<agy pid>.json`. The daemon deletes entries whose process has exited.

agy reads hooks at startup, so sessions that were already open when you installed register only after a restart, or if you ask them to run the script.

## Routing

| Address | Picks |
| --- | --- |
| `claude` | `routes.json["claude"]` if set, else the most recently active session |
| `claude.<name>` | the session with that name (or session id prefix) |
| `codex` / `codex.<prefix>` | loaded thread with that id prefix, else the most recently updated |
| `gemini` / `gemini.<prefix>` | registered conversation with that id prefix, else the most recent |

`routes.json` lives in the mailbox root, for example `~/.agent-mail/routes.json`.
