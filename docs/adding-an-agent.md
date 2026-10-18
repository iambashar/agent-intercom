# Adding a new agent

Any MCP client can already use agent-intercom: register `npx -y agent-intercom serve` with an `AGENT_NAME`, and the agent can `mail_send` and `mail_check`. This guide covers the two optional extras a new agent can get: **one-command install** and **live push**.

## 1. Install support (`cli.js`)

Add an `install<Agent>(name)` function next to `installClaude`, `installCodex` and `installGemini`. Make sure it:

- registers the MCP server under the name `agent-intercom` with `AGENT_NAME=<name>`, using `serverCommand()` so `--local` works
- backs up any config file it edits, and edits only a block it can find again (see the `BEGIN`/`END` markers for Codex)
- skips quietly when the CLI isn't installed (`has('<binary>')`)
- has a matching removal step in `uninstall()`

Then wire it into the `install` switch and `--only`, and list it in the usage text and the README table.

## 2. Live push (`pushd.js`)

Push needs a way to hand text to the agent's **open** session. Look for one of these in the CLI:

| What to look for | Example in this repo |
| --- | --- |
| A local socket or named pipe the session listens on | Claude Code: `/tmp/cc-socks/<pid>.sock` |
| A local daemon with an RPC API that owns the sessions | Codex: app-server daemon, `turn/start` |
| A CLI subcommand that sends to a running conversation | Antigravity: `agy agentapi send-message` |

If none exists, the agent can still use `mail_check(wait_seconds=300)` or a watcher, and push isn't possible yet.

When you find one, add a case to `target(kind, want)`:

```js
if (kind === 'myagent') {
  const s = pick(mySessions(), want, (x, w) => x.id.startsWith(w));
  return s && { push: (m) => myPush(s, m) };
}
```

- `mySessions()` lists the **live** sessions, each with `t` (last-active time) so the most recent wins by default.
- `myPush(s, m)` delivers `render(m)` and **resolves only when delivery succeeded**. Throw on failure: the daemon then puts the mail back in the inbox and retries in 30 s.
- Return `null` when there's nowhere to deliver. Don't throw; the mail just waits for `mail_check`.
- If the target holds a connection open, return `close()` as well (see `codexTarget`).

Finally, add the name to the `local` regex in `main()` so the daemon watches that inbox.

## 3. Tests

Add a test in `test/pushd.test.js` with a **fake** of the agent's endpoint (see `fakeClaude` and the fake `agy` script). It should cover:

- delivery into the right session, with the message moved to `read/`
- a failed push leaving the message in `inbox/`
- no live session leaving the message in `inbox/` without an error

## 4. Document it

- Add a row to "Supported agents" in the README and a section to `docs/live-push.md` describing the protocol.
- Note the CLI version you tested against. These interfaces are usually undocumented and change between releases.
