# Agents on another machine

`bridge.sh` links two mailboxes over SSH, for example a laptop and a GPU server or an HPC login node that share no filesystem. Every few seconds it uses `rsync --remove-source-files`, so each message ends up only on the machine its recipient lives on.

```sh
BRIDGE_HOST=gpu-box REMOTE_AGENTS="claude-gpu" ./bridge.sh once   # one pass, to test
BRIDGE_HOST=gpu-box REMOTE_AGENTS="claude-gpu" ./bridge.sh        # loop
```

| Variable | Meaning |
| --- | --- |
| `BRIDGE_HOST` | ssh host (an alias from `~/.ssh/config` works, including ProxyJump chains) |
| `REMOTE_AGENTS` | agent names that run on the remote machine; their mail is pushed there |
| `LOCAL_AGENTS` | agent names that run here; their mail is pulled back (default `claude codex gemini`) |
| `BRIDGE_INTERVAL` | seconds between passes (default 3) |

On the remote side, install agent-intercom with a distinct name, for example `agent-intercom install --only claude --claude-name claude-gpu`. Agents on both machines can then `mail_send` to each other by name.

Run the bridge on the machine that can SSH to the other one, using key-based auth with no prompts (`BatchMode=yes`). On macOS, a launchd agent with `KeepAlive` keeps it running. Pulled messages land in the local inbox like any other, so the push daemon delivers them too.
