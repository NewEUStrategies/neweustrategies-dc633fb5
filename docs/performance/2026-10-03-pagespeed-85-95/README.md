# PageSpeed 85 (mobile) / 95 (desktop) - pakiet dowodowy i narzędzia (2026-10-03)

Gałąź: `perf/pagespeed-mobile85-desktop95` (od `origin/main` 6a4215db). Cel zlecenia: PSI mobile ≥ 85, desktop ≥ 95 na `/`.

- `EVIDENCE.md` - wszystkie pomiary (produkcja, lokalny artefakt), rozbicie HTML/JS/CSS, cache, LCP, synteza przyczyn (§8), reprodukcja lokalna (§10).
- `lighthouse/` - pełne raporty Lighthouse 13.5 z produkcji (`prod-*.json.gz`) i ich streszczenia, mediany lokalnego artefaktu, HTML produkcyjny `/` z nagłówkami.
- `narzedzia/` - `lh-summary.py` (czytelne streszczenie raportu LH), `br-proxy.mjs` (brotli przed Nitro), `measure-local.sh` (serwer + proxy + LH mobile/desktop + mediany).
- `faza1/` - skrypt workflow fazy 1 (10 strumieni diagnozy + weryfikacja kontradyktoryjna + synteza) i częściowe artefakty agentów; faza przerwana przy przeniesieniu sesji do chmury - do ponownego uruchomienia.

Uwaga środowiskowa: artefakt `build:smoke` z realnymi danymi wymaga `.env` z publiczną konfiguracją Supabase (wartości są w `window.__SUPABASE_CONFIG__` w `lighthouse/home-production-2026-10-03.html.gz`); bez egressu do produkcji używaj fixture (`scripts/performance/replayFetch.mjs`).
