# Wdrożenie: nieblokujące stale-while-revalidate w NES Edge Cache — 2026-08-05

**Zakres:** ścieżka STALE cache'a dokumentów SSR (L1 + L2) — odświeżanie wpisu przeniesione
ZA odpowiedź czytelnika.

**Weryfikacja na tej sesji:** `tsc --noEmit` czysty · pełny `vitest run` **6050 passed /
0 failed / 50 skipped** (576 plików) · `vite build` (Nitro `cloudflare-module`) zielony ·
`check:chunks` zielony · `check:bundle` czerwony **identycznie jak na czystym HEAD**
(pomiar porównawczy niżej, §5).

---

## 1. Problem: „stale-while-revalidate", które kazało czekać

`handleDocumentRequest` obsługiwał okno STALE tak:

```
wpis nieświeży, brak rewalidacji w locie
  → revalidating.add(key)
  → await renderWithTiming()      ← ŻĄDANIE CZYTELNIKA CZEKA NA PEŁNY RENDER SSR
  → decorateMissAndDeferStore(...)
```

Dopiero **kolejni** czytelnicy, którzy trafili w to samo okno, dostawali natychmiastowy
replay z pamięci (gałąź `revalidating.has(key)`). Skutek: mimo kompletnego, gotowego do
podania dokumentu w pamięci, **jeden czytelnik na każdy cykl świeżości płacił pełny render
SSR** — z kompletem round-tripów do bazy. Przy `DOCUMENT_CACHE_MAX_FRESH_MS = 180 s` to
jeden „ukarany" czytelnik co 3 minuty na KAŻDĄ cache'owaną ścieżkę.

Na długim ogonie (kategorie, tagi, autorzy, archiwa — ścieżki z ruchem rzadszym niż co
3 min) trafiał w to nie „jeden na wielu", tylko **znaczna część odwiedzin**: jeśli kolejna
wizyta przychodzi po 10 minutach, wpis jest nieświeży, więc ta wizyta renderuje od zera —
i tak za każdym razem. Mechanizm nazywał się stale-while-revalidate, a zachowywał się jak
stale-**and**-revalidate-in-band.

Ten sam wzorzec występował w gałęzi L2 (wpis kolonii poza oknem świeżości).

## 2. Poprawka: odświeżenie jako osobny przebieg potoku

### 2.1 Dlaczego nie „render w tle z `next()`"

Naturalny odruch — zawołać `next()`, oddać czytelnikowi stary dokument i zapisać nowy
w tle — jest w tym frameworku **niebezpieczny**. Egzekutor request-middleware TanStack
Start przekazuje streamowaną odpowiedź SSR jako kopertę `{ response, serverSsrCleanup,
dispose }` i po przejściu łańcucha porównuje TOŻSAMOŚĆ `response.body` z ciałem koperty.
Zwrócenie innego body uruchamia `dispose()` → `serverSsr.cleanup()` **w trakcie
streamowania** — dokładnie mechanizm incydentu ~61 s opisanego w
`docs/WDROZENIE_SSR_STREAM_FIX_2026-07-30.md`. Render w tle domykałby się wtedy uciętym
dokumentem, a taki dokument trafiłby do cache'a.

### 2.2 Co zrobiono zamiast tego

Odświeżenie to **osobny, pełnoprawny przebieg potoku na syntetycznym żądaniu** — własny
cykl życia renderu, tożsamość body nienaruszona, zero ingerencji w ścieżkę czytelnika.

- **`src/lib/http/documentCache.server.ts`** decyduje KIEDY odświeżyć:
  - `setDocumentRevalidator(fn)` — wpięcie drivera; `scheduleRevalidation()` odpala go pod
    `runAfterResponse` (`ctx.waitUntil`) z single-flight po kluczu;
  - obie gałęzie STALE (L1 i L2) zwracają teraz `replay(entry, "STALE")` **natychmiast**;
  - `DOCUMENT_REVALIDATE_TIMEOUT_MS = 30 s` gwarantuje zwolnienie zamka single-flight
    czasem, a nie grzecznością drivera (render, który nigdy się nie domknie, nie może
    zablokować odświeżania klucza do końca życia izolatu). Sufit jest wyżej niż twardy
    budżet strażnika dokumentu (`DOC_GUARD_MAX_MS` = 20 s), więc normalna ścieżka nigdy
    tu nie dobija.
- **`src/server.ts`** wie JAK uruchomić render — tylko tam żyje komplet warstw (handler
  routera → normalizacja 500 → `applyDeferredDocumentStore`). `revalidateDocument()`
  buduje syntetyczne żądanie, przepuszcza je przez potok i konsumuje body, żeby tee
  dociągnął dokument do kolektora zapisu.
- **`applyDeferredDocumentStore(response, onStore?)`** — nowy, opcjonalny parametr.
  Domyślnie zapis jedzie pod `waitUntil` i nikt na niego nie czeka (ścieżka czytelnika,
  zachowanie bez zmian); driver rewalidacji przejmuje obietnicę, bo MUSI wiedzieć, kiedy
  wpis realnie wylądował w magazynie — inaczej zwalniałby single-flight przed zapisem.

### 2.3 Rekurencja i podszywanie się

Syntetyczne żądanie niesie nagłówek `x-nes-revalidate`, który każe pominąć serwowanie
z cache'a (inaczej odświeżenie odczytałoby własny nieświeży wpis i nic by nie odświeżyło)
i **nie planuje kolejnej rewalidacji** — rekurencja jest wykluczona z konstrukcji.

Wartością nagłówka jest **losowy nonce izolatu**, nie stała. Odświeżenie biegnie
w procesie (ten sam izolat woła ten sam handler), więc nonce nigdy nie opuszcza pamięci
workera. Żądanie z zewnątrz nie ma jak go odgadnąć, a bez trafienia w nonce nagłówek jest
ignorowany — inaczej byłby darmowym cache-busterem wymuszającym pełny render na każde
żądanie. Pokryte testem („podrobiony znacznik z zewnątrz jest ignorowany").

### 2.4 Nagłówki syntetycznego żądania

Świadomie wąska lista: `host` / `x-forwarded-host` / `x-forwarded-proto` (bez nich render
trafiłby w innego tenanta — klucz cache jest prefiksowany hostem), `accept` /
`accept-language` oraz **wyłącznie ciasteczko języka** — te trzy odtwarzają negocjację
języka, żeby odświeżenie skończyło się dokumentem, a nie redirectem.
`authorization` i ciasteczka sesji `sb-*` są wykluczone z definicji: dokument w cache'u
jest anonimową skorupą i taki musi pozostać.

## 3. Bezpieczeństwo degradacji

| Sytuacja                         | Zachowanie                                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Brak zarejestrowanego drivera    | Wariant blokujący sprzed zmiany (jedno żądanie płaci rewalidację). Tak działa suita jednostkowa.                |
| Odświeżenie rzuca / nie zapisuje | Wpis zostaje STALE **nietknięty**; kolejne żądanie próbuje ponownie. Nigdy nie nadpisujemy wpisu czymś gorszym. |
| Odświeżenie wisi                 | Zamek single-flight zwalniany po 30 s.                                                                          |
| Wpis wypada z okna SWR           | Zwykły MISS (ścieżka bez zmian).                                                                                |
| Publikacja treści                | Purge bez zmian: L1 bieżącego izolatu + bump wersji L2 (cała kolonia).                                          |

Żadna ścieżka błędu nie może zerwać odpowiedzi czytelnika — całość biegnie za odpowiedzią.

## 4. Efekty uboczne, które warto znać

- **Wpis STALE z L2 zasiewa teraz L1** (`setEntry(plan.key, staleEntry)`). Dotąd każde
  żądanie w oknie STALE wracało po ten sam nieświeży dokument do Cache API.
- **Render odświeżający nie jest liczony jako MISS.** Karta /admin/performance liczy
  `hitRatio = (hits + stale) / (hits + stale + misses)`; doliczanie odświeżeń zaniżałoby
  współczynnik o jeden render na każde serwowanie STALE (przy pełnym pokryciu z cache'a
  raportowałaby ~50 % zamiast ~100 %). Renders trafiają do pierścienia decyzji (`renderMs`)
  i do licznika `revalidations`. Zablokowane testem.
- **Dwa nowe kafelki** w karcie NES Edge Cache: „Odświeżenia w tle" / „Nieudane
  odświeżenia" (`revalidations`, `revalidationFailures`) — nieudane odświeżenia są
  jedynym sygnałem, że wpisy dożywają okna SWR zamiast się odnawiać.

## 5. Pomiar bundla (bramka `check:bundle`)

Bramka jest czerwona **przed zmianą i po zmianie**, na tych samych progach
(`511 / 1799 / 3005` KB gzip) — stan opisany w `AUDYT_BRUTALNY_REWIZJA_ZALOZEN_2026-08-05.md`
§4.5 („sam `main` przekracza wszystkie trzy floory niezależnie od gałęzi"). Pomiar
porównawczy na tej sesji, dwa pełne buildy:

| Pomiar           | Czysty HEAD | Po zmianie | Delta       |
| ---------------- | ----------- | ---------- | ----------- |
| public           | 1850,4 KB   | 1850,6 KB  | **+0,2 KB** |
| overall          | 3086,6 KB   | 3086,8 KB  | **+0,2 KB** |
| największy chunk | 533,9 KB    | 533,9 KB   | **0**       |

Delta to dwa kafelki `StatTile` i cztery stringi i18n w chunku **admina**. Rdzeń zmiany
jest server-only i nie dotyka bundla klienta. Spłata długu bundlowego pozostaje osobną
pozycją (§4.5 audytu) — ta zmiana jej nie pogłębia.

## 6. Zmienione pliki

- `src/lib/http/documentCache.ts` — `NES_REVALIDATE_HEADER`.
- `src/lib/http/documentCache.server.ts` — driver rewalidacji, nonce izolatu,
  nieblokujące gałęzie STALE (L1 + L2), zasiew L1 z L2, liczniki, `onStore`.
- `src/server.ts` — `revalidateDocument()` + rejestracja drivera.
- `src/lib/http/__tests__/documentCache.server.test.ts` — 6 nowych testów.
- `src/components/admin/performance/EdgeCacheCard.tsx`, `src/lib/i18n-admin-edge-cache.ts` —
  dwa kafelki + PL/EN.
