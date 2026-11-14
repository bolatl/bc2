#!/usr/bin/env bash
# Full golden path via curl: onboarding -> session (ChatGPT turns) -> demo payment -> result.
# Usage: scripts/curl_flow.sh [base-url]   (server must be running, e.g. `make run-env`)
# Needs only bash, curl and python3. Prints every request and response.
set -euo pipefail

BASE="${1:-http://localhost:8080}/api/v1"
JAR="$(mktemp)"; trap 'rm -f "$JAR"' EXIT
H='Content-Type: application/json'

call() { # method path [body] -> prints response, sets $OUT
  local m=$1 p=$2 b=${3:-}
  echo ">>> $m $p ${b}" >&2
  if [ -n "$b" ]; then OUT=$(curl -sS -c "$JAR" -b "$JAR" -H "$H" -X "$m" "$BASE$p" -d "$b")
  else OUT=$(curl -sS -c "$JAR" -b "$JAR" -H "$H" -X "$m" "$BASE$p"); fi
  echo "$OUT" | python3 -m json.tool >&2 2>/dev/null || echo "$OUT" >&2
  echo >&2
}
field() { python3 -c "import sys,json; d=json.load(sys.stdin)
for k in sys.argv[1].split('.'): d=d[k]
print(d)" "$1" <<<"$OUT"; }

answer_for() {
  case $1 in
    thermometer_start) echo 8 ;;
    facts) echo "We argued about doing the dishes again." ;;
    feelings) echo "I felt alone with all the chores." ;;
    needs) echo "I wanted us to agree on a plan." ;;
    partner_view) echo "Maybe they were tired too." ;;
    rehearsal) echo "Could we agree on one small thing to do differently?" ;;
    thermometer_end) echo 3 ;;
    ready) echo "I am ready to talk" ;;
    *) echo "ok" ;;
  esac
}

call POST /couples '{"age":"30-34","relationshipStatus":"married","togetherDuration":"3-7","hasKids":"no","conflictStyle":"talk_now","repairNeed":"plan","fightTopics":["chores"],"goal":"understand_each_other"}'
call POST /personality-tests '{"answers":[3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3]}'
call POST /fight-sessions '{}'
SID=$(field sessionId)

for _ in $(seq 1 20); do
  call GET "/fight-sessions/$SID"
  TYPE=$(field currentTurn.type)
  case $TYPE in
    next_turn)
      IDX=$(field currentTurn.turnIndex); STAGE=$(field currentTurn.stage)
      TEXT=$(answer_for "$STAGE")
      BODY=$(python3 -c "import json,sys; print(json.dumps({'turnIndex':int(sys.argv[1]),'answerSource':'free_text','answerText':sys.argv[2]}))" "$IDX" "$TEXT")
      call POST "/fight-sessions/$SID/turns" "$BODY" ;;
    paywall_required)
      echo "=== paywall: demo checkout (mock payment) ===" >&2
      call POST /subscriptions/checkout '{"plan":"monthly"}'
      CID=$(field checkoutSessionId)
      call POST /subscriptions/confirm "{\"checkoutSessionId\":\"$CID\"}" ;;
    *) break ;;
  esac
done

echo "=== result ===" >&2
call GET "/fight-sessions/$SID/result"
