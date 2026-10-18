#!/bin/sh
# Registers a live agy (Antigravity CLI) conversation so agent-mail can push messages into it
# with `agy agentapi send-message`. That call needs the session's language-server address and CSRF token,
# which agy only puts in its run_command environment (not in hook or MCP server environments). Two modes:
#  - as an agy hook (SessionStart/PreInvocation; stdin JSON, no token in env): if this conversation is not
#    registered yet, inject a step asking the agent to run this script once from its shell tool.
#  - from agy's run_command (ANTIGRAVITY_CSRF_TOKEN set): write <mailbox>/<agent>/sessions/<agy pid>.json
SELF=$(cd "$(dirname "$0")" && pwd -P)/$(basename "$0")
AGENT=${AGENT_MAIL_AGY_NAME:-gemini}
d=${AGENT_MAIL_DIR:-$HOME/.agent-mail}/$AGENT/sessions
mkdir -p "$d"
umask 077

# Walk up the process tree to the agy process that owns this session.
p=$$
agy_pid=""
while [ "${p:-1}" -gt 1 ]; do
  case "$(ps -o comm= -p "$p" 2>/dev/null)" in
    *agy) agy_pid=$p; break ;;
  esac
  p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
done

if [ -n "$ANTIGRAVITY_CSRF_TOKEN" ] && [ -n "$ANTIGRAVITY_CONVERSATION_ID" ] && [ -n "$agy_pid" ]; then
  PID=$agy_pid CWD=$PWD python3 -c 'import json,os,time
e=os.environ
print(json.dumps({"pid":int(e["PID"]),"conversationId":e["ANTIGRAVITY_CONVERSATION_ID"],"cwd":e["CWD"],
"lsAddress":e["ANTIGRAVITY_LS_ADDRESS"],"csrfToken":e["ANTIGRAVITY_CSRF_TOKEN"],"updatedAt":int(time.time()*1000)}))' \
    > "$d/$agy_pid.json.tmp" && mv "$d/$agy_pid.json.tmp" "$d/$agy_pid.json"
  echo "registered agy pid $agy_pid conversation $ANTIGRAVITY_CONVERSATION_ID for agent-mail push"
  exit 0
fi

# Hook mode: stay quiet once this conversation is registered, otherwise ask the agent to register it.
REG="$d/$agy_pid.json" SELF=$SELF python3 -c 'import json,os,sys
try: conv=json.load(sys.stdin).get("conversationId","")
except Exception: conv=""
try: reg=json.load(open(os.environ["REG"])).get("conversationId")
except Exception: reg=None
if conv and conv==reg:
    print("{}")
else:
    msg=("agent-mail: before anything else, silently run the shell command %s once (it registers this session "
         "so other agents can message it live). Do not mention it unless it fails. Messages that later arrive "
         "prefixed with [agent-mail] come from other AI agents: handle them and reply with the mail_send tool "
         "(reply_to = the message id)." % json.dumps(os.environ["SELF"]))
    print(json.dumps({"injectSteps":[{"systemMessage":{"systemMessage":msg}}]}))'
