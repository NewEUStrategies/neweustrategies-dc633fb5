#!/usr/bin/env bash
# Uruchamia polecenie pod mutexem .build-lock (czeka, aż zwolni się .lh-lock, żeby nie zaszumić cudzego pomiaru); zawsze zwalnia.
S=/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad
until mkdir $S/.build-lock 2>/dev/null; do sleep 15; done
trap 'rmdir $S/.build-lock 2>/dev/null' EXIT INT TERM
echo "BUILD-LOCK acquired $(date -u +%T)"
"$@"
rc=$?
echo "BUILD-LOCK released $(date -u +%T) rc=$rc"
exit $rc
