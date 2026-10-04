#!/usr/bin/env bash
# Uruchamia polecenie pod mutexem .lh-lock (czeka też, aż zniknie .build-lock); zawsze zwalnia mutex.
S=/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad
until mkdir $S/.lh-lock 2>/dev/null; do sleep 20; done
trap 'rmdir $S/.lh-lock 2>/dev/null' EXIT INT TERM
while [ -d $S/.build-lock ]; do sleep 20; done
echo "LH-LOCK acquired $(date -u +%T)"
"$@"
echo "LH-LOCK released $(date -u +%T)"
