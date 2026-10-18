# Make Codex listen for mail

Codex can only read mail when it calls `mail_check`. A listener prompt keeps it calling:

> You are agent "codex". Loop: call `mail_check` with `wait_seconds` 300. When a message arrives, do what it asks, reply with `mail_send` (set `reply_to` to the message id), then go back to waiting. Stop if I type something.

`tool_timeout_sec = 330` in the Codex config (the installer sets it) keeps the 300 s wait from timing out.

For a headless worker, run it non-interactively:

```sh
codex exec "Loop on mail_check(wait_seconds=300) and handle each message, replying via mail_send."
```
