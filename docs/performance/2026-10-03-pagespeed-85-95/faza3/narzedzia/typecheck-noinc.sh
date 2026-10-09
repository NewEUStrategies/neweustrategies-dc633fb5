#!/usr/bin/env bash
# Typecheck jak `bun run typecheck`, ale bez współdzielonego tsBuildInfo (node_modules/.cache przez symlink = OOM
# przy równoległych worktree). Użycie: typecheck-noinc.sh <katalog-worktree>; uruchamiaj przez heavy.sh / heavy-bg.sh.
cd "${1:-.}" || exit 1
npx tsgo --noEmit --incremental false && npx tsc --project tsconfig.scripts.json --noEmit --incremental false && npx tsgo --noEmit --incremental false -p tsconfig.e2e.json
