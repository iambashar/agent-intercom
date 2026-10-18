#!/bin/bash
# agent-mail bridge between this machine and a remote one over SSH (no shared filesystem needed).
#   here -> remote : messages addressed to REMOTE_AGENTS are moved to the remote mailbox.
#   remote -> here : messages addressed to LOCAL_AGENTS are moved to this mailbox.
# rsync writes a temp file and renames, so a reader never sees a half-written message.
# Usage: BRIDGE_HOST=myserver REMOTE_AGENTS="claude-gpu" bridge.sh        loop forever (launchd/systemd)
#        ... bridge.sh once                                               one pass, then exit (testing)
# The remote mailbox is ~/.agent-mail on BRIDGE_HOST; any ssh config alias or ProxyJump works.
set -u
HOST=${BRIDGE_HOST:?set BRIDGE_HOST to the ssh host of the other machine}
REMOTE_AGENTS=${REMOTE_AGENTS:?set REMOTE_AGENTS to the agent names that live on BRIDGE_HOST}
LOCAL_AGENTS=${LOCAL_AGENTS:-claude codex gemini}
INTERVAL=${BRIDGE_INTERVAL:-3}
LOCAL=${AGENT_MAIL_DIR:-$HOME/.agent-mail}
# Agent names end up in remote shell commands and paths, so only allow plain names.
for a in $REMOTE_AGENTS $LOCAL_AGENTS; do
  case "$a" in
    *[!A-Za-z0-9._-]*|.*|*..*) echo "bridge: invalid agent name '$a'" >&2; exit 1 ;;
  esac
done
# ssh expands ~ in ControlPath itself, so a $HOME containing spaces cannot split this command string.
SSH="ssh -o BatchMode=yes -o ConnectTimeout=20 -o ServerAliveInterval=30 -o ControlMaster=auto -o ControlPath=~/.ssh/cm-agent-mail-%C -o ControlPersist=900"
log() { printf '%s %s\n' "$(date '+%F %T')" "$*"; }

ensure_remote() {
  local dirs=""
  for a in $REMOTE_AGENTS $LOCAL_AGENTS; do dirs="$dirs .agent-mail/$a/inbox .agent-mail/$a/read"; done
  $SSH "$HOST" "mkdir -p $dirs" 2>/dev/null
}

pass() {
  local a n
  for a in $REMOTE_AGENTS; do
    mkdir -p "$LOCAL/$a/inbox" "$LOCAL/$a/read"
    [ -z "$(ls "$LOCAL/$a/inbox"/*.json 2>/dev/null)" ] && continue
    n=$(ls "$LOCAL/$a/inbox"/*.json | wc -l | tr -d ' ')
    if rsync -a --remove-source-files --include='*.json' --exclude='*' -e "$SSH" "$LOCAL/$a/inbox/" "$HOST:.agent-mail/$a/inbox/"; then
      log "pushed $n message(s) -> $a@$HOST"
    else
      log "push to $a@$HOST failed (will retry)"
    fi
  done
  for a in $LOCAL_AGENTS; do
    mkdir -p "$LOCAL/$a/inbox" "$LOCAL/$a/read"
    local before after
    before=$(ls "$LOCAL/$a/inbox"/*.json 2>/dev/null | wc -l | tr -d ' ')
    if rsync -a --remove-source-files --include='*.json' --exclude='*' -e "$SSH" "$HOST:.agent-mail/$a/inbox/" "$LOCAL/$a/inbox/"; then
      after=$(ls "$LOCAL/$a/inbox"/*.json 2>/dev/null | wc -l | tr -d ' ')
      [ "$after" -gt "$before" ] && log "pulled $((after-before)) message(s) <- $HOST for $a"
    else
      log "pull for $a from $HOST failed (will retry)"
    fi
  done
}

ensure_remote || log "warning: could not reach $HOST yet"
for a in $REMOTE_AGENTS; do mkdir -p "$LOCAL/$a/inbox" "$LOCAL/$a/read"; date +%s000 > "$LOCAL/$a/alive"; done
if [ "${1:-}" = once ]; then pass; exit 0; fi
log "bridge up: $HOST remote=[$REMOTE_AGENTS] local=[$LOCAL_AGENTS] every ${INTERVAL}s"
while true; do pass; sleep "$INTERVAL"; done
