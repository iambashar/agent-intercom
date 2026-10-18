#!/bin/zsh
# Registers a live agy (Antigravity CLI) conversation so agent-mail can push messages into it
# with `agy agentapi send-message`. That call needs the session's language-server address and CSRF token,
# which agy only puts in its run_command environment (not in hook or MCP server environments). Two modes:
#  - as an agy hook (SessionStart/PreInvocation; stdin JSON, no token in env): if this conversation is not
#    registered yet, inject a step asking the agent to run this script once from its shell tool.
#  - from agy's run_command (ANTIGRAVITY_CSRF_TOKEN set): write <mailbox>/<agent>/sessions/<agy pid>.json
SELF=${0:A}
AGENT=${AGENT_MAIL_AGY_NAME:-gemini}
d=${AGENT_MAIL_DIR:-$HOME/.agent-mail}/$AGENT/sessions
mkdir -p $d; umask 077
p=$$; agy_pid=""
while [[ $p -gt 1 ]]; do
  [[ "$(ps -o comm= -p $p)" == *agy ]] && { agy_pid=$p; break; }
  p=$(ps -o ppid= -p $p | tr -d ' ')
done
if [[ -n $ANTIGRAVITY_CSRF_TOKEN && -n $ANTIGRAVITY_CONVERSATION_ID && -n $agy_pid ]]; then
  PID=$agy_pid CWD=$PWD /usr/bin/env python3 -c 'import json,os,time
e=os.environ
print(json.dumps({"pid":int(e["PID"]),"conversationId":e["ANTIGRAVITY_CONVERSATION_ID"],"cwd":e["CWD"],
"lsAddress":e["ANTIGRAVITY_LS_ADDRESS"],"csrfToken":e["ANTIGRAVITY_CSRF_TOKEN"],"updatedAt":int(time.time()*1000)}))' > $d/$agy_pid.json.tmp && mv $d/$agy_pid.json.tmp $d/$agy_pid.json
  echo "registered agy pid $agy_pid conversation $ANTIGRAVITY_CONVERSATION_ID for agent-mail push"
  exit 0
fi
# hook mode
conv=$(/usr/bin/env python3 -c 'import json,sys;print(json.load(sys.stdin).get("conversationId",""))' 2>/dev/null)
reg=$d/$agy_pid.json
if [[ -n $conv && -f $reg ]] && grep -q "\"conversationId\": \"$conv\"" $reg; then echo '{}'; exit 0; fi
cat <<JSON
{"injectSteps":[{"systemMessage":{"systemMessage":"agent-mail: before anything else, silently run the shell command $SELF once (it registers this session so other agents can message it live). Do not mention it unless it fails. Messages that later arrive prefixed with [agent-mail] come from other AI agents: handle them and reply with the mail_send tool (reply_to = the message id)."}}]}
JSON
