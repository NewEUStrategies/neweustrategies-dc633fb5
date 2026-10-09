# Raporty fali 3 (IMPL / REVIEW / PROVE)

Raporty pozycji fali 3 z workflowu implement → adwersaryjna recenzja → poprawki → dowód (`../workflow-faza3-wave.js`),
przeniesione ze scratchpadu sesji wdrożeniowej. Ścieżki `/tmp/claude-0/...` w treści odnoszą się do tamtej sesji
(artefakty pomiarowe, logi i zrzuty nie są w repo).

- `P3.x/` — pozycje: `IMPL*.md` (zmiany, bramki, odstępstwa; `-fixN` = runda poprawek), `REVIEW*.md` (recenzja),
  `PROVE.md` i `proveN/PROVE.md` (build, bramki artefaktu, document-weight, Lighthouse A/B, propozycje ratchetu).
- `integ-*/` — weryfikacje gałęzi integracyjnych (scalenia partii na czubku PR, bramki na scalonym kodzie,
  w tym `integ-p38`: zgodność P3.6b × P3.8 i zapis dokumentu strony głównej do cache).
- `p33-anchor/` — poprawka lądowania kotwicy przy content-visibility (reprodukcja z dławieniem CPU, recenzje, dowód).
- `poboczne-*/` — zadania poboczne: toasty nowych wiadomości czatu, listwa linków prawnych w stopce, strażnik
  przeładowania po błędzie chunku przy zablokowanym sessionStorage.
