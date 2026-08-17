# Wdrożenie: cięcie TTFB dokumentu (2026-08-14)

## Diagnoza (nagranie ekranu, 2026-08-14 13:10, incognito)

Objaw: po Enterze ~3,5 s bez malowania, potem strona pojawia się CAŁA naraz
(łącznie z obrazami). To sygnatura długiego **TTFB dokumentu**, nie wolnych
zasobów: preloady LCP z wdrożenia 2026-08-13 działają dopiero PO pierwszym
bajcie HTML, więc nie mogły skrócić tego czekania. Gdy dokument w końcu
dociera, obrazy (już preloadowane z nagłówków `Link`) malują się razem z nim -
dokładnie tak wygląda kadr pierwszego malowania na nagraniu.

Skąd sekundy TTFB przy zimnej ścieżce:

1. **Middleware przekierowań stoi PRZED cache dokumentów** i blokował żądanie
   na odświeżeniu katalogu tenantów (TTL 60 s) i indeksu przekierowań
   (TTL 30 s) - 1-2 pełne round-tripy do bazy, ZANIM NES Edge Cache mógł
   w ogóle odpowiedzieć, powtarzane co TTL na każdym izolacie.
2. **Pełny MISS renderuje całą stronę główną** (rozgrzewka roota: ustawienia,
   tokeny, menu, ticker + wszystkie zapytania widgetów buildera) - to celowo
   koszt płacony "raz na rewalidację", ale przy niskim ruchu okno stale
   (dotąd maks. 6 h) wygasało między wizytami i MISS płacił realny czytelnik.
3. Zimny start izolatu Workers po deployu/rotacji dokłada swoje.

## Zmiany

1. **SWR katalogu tenantów** (`lib/server/tenant.server.ts`): po TTL nieświeży
   katalog serwuje natychmiast, odświeżenie biegnie w tle pod `waitUntil`
   (single-flight). Zimny izolat nadal blokuje jednorazowo (poprawność
   kluczowania cache per host ponad szybkość).
2. **SWR indeksu przekierowań** (`lib/seo/redirects.server.ts`): ta sama
   mechanika per tenant. Nowa reguła 301 może obowiązywać o sekundy później -
   świadomy kompromis; zimna ścieżka nadal blokuje, więc 301-ki są poprawne
   od pierwszego żądania izolatu.
3. **Okno stale NES Edge Cache 6 h -> 24 h** (`lib/http/documentCache.ts`):
   pełne okno `stale-while-revalidate` polityki treści. Pierwszy czytelnik
   kolonii po nocnej ciszy dostaje STALE w milisekundach (a rewalidacja
   biegnie za odpowiedzią) zamiast pełnego renderu. Bezpieczne z konstrukcji:
   publikacja robi purge przez bump wersji L2 (wpis nieosiągalny natychmiast
   w całej kolonii).
4. **Warmer dokumentów** (`scripts/warm-edge-cache.mjs` + krok w
   `.github/workflows/scheduler.yml`): istniejący cron (co 5 min) odpytuje
   `/`, `/en`, `/blog`, `/en/blog` (2 ticki co 2 min). HIT nic nie kosztuje,
   STALE uruchamia rewalidację w tle, a rzadki MISS płaci warmer - nie
   czytelnik. Best-effort: zawsze kod wyjścia 0, bez sekretów (anonimowe
   GET-y), nie zapala crona doręczeń.

## Czego TU nie zmieniono (i dlaczego)

- **Równoległość redirect middleware z renderem**: zwrócenie z middleware innej
  odpowiedzi niż koperta renderu to klasa incydentu ~61 s (tożsamość body -
  patrz documentCache.server.ts). SWR daje większość zysku bez tego ryzyka.
- **Streaming strony głównej**: celowo wyłączony (rozjazd hydratacji przy
  odrzuconym boundary w trakcie flusha - komentarz w routes/index.tsx).
- **Rozmiar bundla serwera / zimny start Workers**: osobna, większa praca
  (patrz kronika check-bundle-size.ts).

## Weryfikacja po deployu

1. Drugie i kolejne wejścia na `/` w ciągu dnia: `x-nes-cache: HIT|STALE`
   (nagłówek widoczny wewnętrznie; na brzegu patrz karta /admin/performance -
   hit-rate powinien wyraźnie wzrosnąć po włączeniu warmera).
2. Skonfiguruj `vars.APP_BASE_URL` w repo (jeśli brak) - bez tego krok
   warmera loguje ostrzeżenie i nic nie robi.
3. Test ręczny warmera: `WARM_BASE_URL=https://... WARM_TICKS=1 node
scripts/warm-edge-cache.mjs` - log `[warm] / -> 200 nes=HIT ...ms`.
