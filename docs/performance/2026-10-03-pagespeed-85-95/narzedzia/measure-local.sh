#!/usr/bin/env bash
# WYCOFANE (P0.1, 2026-10-04) - stub z kodem 1, żeby nikt nie zmierzył zmiany
# starym instrumentem. Dawna wersja tego skryptu (historia: git log -p -- ten plik)
# miała trzy znane błędy pomiaru:
#   1. pętla gotowości `curl -sf` z UA bota zapisywała w cache dokumentu wariant
#      buforowany (382 KB / 14 skryptów zamiast strumieniowego 391 KB / 22),
#   2. HTTP/1.1 i obrazy na osobnym originie (produkcja: h2 z jednego originu;
#      mobile LCP +0,30 s, desktop FCP +0,28 s),
#   3. rozgrzewka raz na serię - wpis cache przechodził w STALE w trakcie serii
#      i serwer renderował SSR w trakcie przebiegów (werdykt M1 #1).
# Kanoniczny harness (POMIAR.md):
#   node scripts/performance/lighthouse-local.mjs --root <worktree> --runs 5 --forms mobile,desktop4x
echo "measure-local.sh jest wycofany - użyj scripts/performance/lighthouse-local.mjs (docs/performance/2026-10-03-pagespeed-85-95/POMIAR.md)." >&2
exit 1
