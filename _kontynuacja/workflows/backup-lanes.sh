#!/usr/bin/env bash
# Kopia zapasowa torów huba na origin, BEZ force: (1) commity gałęzi roboczej
# (rosną liniowo -> fast-forward), (2) migawka drzewa roboczego z plikami
# nieśledzonymi przez osobny indeks tymczasowy (indeks agentów nietknięty),
# łańcuchowana rodzicem poprzedniej migawki -> też fast-forward.
set -u
SP=/tmp/claude-0/-home-user-neweustrategies-dc633fb5/10bcbd04-63c3-589b-b672-98ad826d5b2d/scratchpad
LOG=$SP/backup.log
STATE=$SP/backup-state
backup() {
  local wt=$1 br=$2
  cd "$wt" 2>/dev/null || return 0
  git push -q origin "HEAD:refs/heads/$br" >>"$LOG" 2>&1 || echo "$(date -u +%FT%TZ) push $br FAIL" >>"$LOG"
  local idx; idx=$(mktemp)
  cp "$(git rev-parse --git-path index)" "$idx"
  GIT_INDEX_FILE="$idx" git add -A . >/dev/null 2>&1
  local tree; tree=$(GIT_INDEX_FILE="$idx" git write-tree)
  rm -f "$idx"
  local prevf="$STATE/$(echo "$br" | tr / _)"
  local prev=""; [ -f "$prevf" ] && prev=$(cat "$prevf")
  if [ -n "$prev" ] && [ "$(git rev-parse "$prev^{tree}" 2>/dev/null)" = "$tree" ]; then return 0; fi
  local head; head=$(git rev-parse HEAD)
  local parents=(-p "$head"); [ -n "$prev" ] && parents+=(-p "$prev")
  local c; c=$(git commit-tree "$tree" "${parents[@]}" -m "WIP kopia zapasowa $br ($(date -u +%FT%TZ)) - migawka drzewa roboczego, nie do scalania")
  if git push -q origin "$c:refs/heads/$br-wip" >>"$LOG" 2>&1; then
    echo "$c" > "$prevf"; echo "$(date -u +%FT%TZ) $br-wip $c (HEAD $head)" >>"$LOG"
  else
    echo "$(date -u +%FT%TZ) push $br-wip FAIL" >>"$LOG"
  fi
}
while true; do
  backup /home/user/wt/S8 hub/s8-sciezki-panel-c
  backup /home/user/wt/S7 hub/s7-zakladki-diagnostyka-c
  [ -n "${ONCE:-}" ] && break
  sleep 900
done
