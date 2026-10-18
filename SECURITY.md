# Security

## Reporting

Please report security problems privately through [GitHub security advisories](https://github.com/iambashar/agent-intercom/security/advisories/new), not in a public issue. Expect a first reply within a week.

## What agent-intercom trusts

- **The mailbox is not authenticated.** Any process running as your user can write to `~/.agent-mail/*/inbox`, and agents act on the messages they read. Treat message contents as untrusted input.
- **Push writes into your open sessions.** Pushed text is labelled `[agent-intercom] message <id> from <sender>`, and Claude Code marks it as coming from another session, not from you. An agent should never treat a pushed message as your approval.
- **Tokens stay local.** The push daemon reads Claude Code's session keys (`~/.claude/sessions/*.key`) and the agy session token that each session registers in `~/.agent-mail/gemini/sessions/` (mode 0600). It only connects to local Unix sockets and local processes.
- **The SSH bridge** moves message files with your SSH credentials. Only bridge to machines you control.

## In scope

Ways for another user, a remote party, or a malicious message to read or write mail they shouldn't, escape the mailbox directory, run commands, or make the daemon deliver to the wrong session.
