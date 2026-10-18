# Changelog

All notable changes to this project. Versions follow [semver](https://semver.org).

## [Unreleased]

### Added
- Contributor guide for new agents (`docs/adding-an-agent.md`), code of conduct, Dependabot for CI actions, and a Contributing section in the README.

## [0.2.2] - 2026-10-18

No code changes; the package now ships the new README and the changelog.

### Added
- README artwork: animated hero, terminal demo and push diagram (`scripts/build-assets.py` rebuilds them).
- CI on macOS and Linux with Node 20 and 22, plus a release workflow that publishes to GitHub Packages and npm.
- CHANGELOG, CONTRIBUTING, SECURITY, and issue and pull request templates.
- Also published to GitHub Packages as `@iambashar/agent-intercom`.

## [0.2.1] - 2026-10-18

First public release, published as `agent-intercom` on npm.

### Added
- MCP mailbox server with `mail_send`, `mail_check` and `mail_peers`, shared by any MCP client through `~/.agent-mail`.
- `install` / `uninstall` for Claude Code, Codex CLI and Antigravity (`agy`).
- Live push daemon (`pushd.js`): new mail is injected into the open session through Claude Code's peer socket, the Codex app-server daemon (`turn/start` / `turn/steer`) or `agy agentapi send-message`.
- `agy-register.sh` hook so Antigravity sessions register themselves for push.
- `push install|uninstall|run` with launchd on macOS and `systemd --user` on Linux.
- `bridge.sh`: rsync-over-SSH bridge for agents on another machine.
- Routing to a specific session (`claude.<name>`, `codex.<thread>`, `gemini.<conversation>`) and defaults in `routes.json`.

### Fixed (from two code reviews before release)
- A message could be delivered twice when `mail_check` ran during a push. Mail is now claimed by rename first, by both the daemon and `mail_check`.
- Codex delivery could hang forever if its daemon restarted mid-request; calls now time out and fail when the connection drops.
- Fragmented WebSocket frames from the Codex daemon are reassembled.
- A missing Codex daemon caused an endless retry loop instead of leaving mail queued.
- `npx` installs wrote a temporary path into the agy hook; the hook is now copied to `~/.agent-mail/bin`.
- Recipient names such as `..` could write outside the mailbox.
- `agy-register.sh` needed zsh; it is POSIX `sh` now, with quoted paths.

[Unreleased]: https://github.com/iambashar/agent-intercom/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/iambashar/agent-intercom/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/iambashar/agent-intercom/releases/tag/v0.2.1
