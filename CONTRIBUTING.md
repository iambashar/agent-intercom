# Contributing

Thanks for helping. agent-intercom stays small on purpose: zero runtime dependencies, Node 20+, plain files.

## Ways to help

- **Pick up a starter issue.** [Good first issues](https://github.com/iambashar/agent-intercom/labels/good%20first%20issue) are small and come with pointers to the code. [Help wanted](https://github.com/iambashar/agent-intercom/labels/help%20wanted) issues are bigger.
- **Add an agent.** Support for another CLI is the most useful contribution. Follow [docs/adding-an-agent.md](docs/adding-an-agent.md).
- **Report a broken push.** CLI updates can change the internals push relies on. Say which CLI and version broke it.
- **Ask or suggest** in [Discussions](https://github.com/iambashar/agent-intercom/discussions).

Comment on an issue before you start, so two people don't build the same thing.

## Setup

```bash
git clone https://github.com/iambashar/agent-intercom && cd agent-intercom
npm test
```

To try your checkout with real agents, install it pinned to the checkout:

```bash
node cli.js install --local
node cli.js push run      # push daemon in the foreground, logs to the terminal
```

## Where things live

| File | What it does |
| --- | --- |
| `server.js` | The MCP stdio server (`mail_send`, `mail_check`, `mail_peers`) |
| `cli.js` | `install`, `uninstall`, `push`, `status`, `watch`, `serve` |
| `pushd.js` | Watches the mailbox and pushes into live sessions |
| `codex-ws.js` | JSON-RPC client for the Codex app-server daemon |
| `agy-register.sh` | Antigravity session hook and self-registration |
| `bridge.sh` | rsync-over-SSH bridge between machines |
| `scripts/build-assets.py` | Rebuilds the SVG artwork in `docs/assets/` |

## Pull requests

1. Fork, then branch from `main`.
2. Keep each PR to one change, with a test.
3. `npm test` must pass. CI runs it on macOS and Linux with Node 20 and 22.
4. Describe how you tested it, especially against a live session if push delivery changed.

## Guidelines

- **No new dependencies.** If something needs a library, open an issue first.
- **Add a test** for every bug fix and behavior change (`test/*.test.js`, `node:test`).
- **Push routes use undocumented CLI internals.** When one breaks after a CLI update, say which CLI version broke it and which version your fix was tested against.
- **Mail must never be lost or delivered twice.** Any change to delivery has to keep the claim-by-rename rule from `docs/live-push.md`.

## Releasing (maintainers)

1. Bump `version` in `package.json` and move the `Unreleased` notes in `CHANGELOG.md` under the new version.
2. Commit, then create a GitHub release with tag `vX.Y.Z`.
3. The release workflow tests, publishes `@iambashar/agent-intercom` to GitHub Packages, and publishes `agent-intercom` to npm when the `NPM_TOKEN` secret is set.
