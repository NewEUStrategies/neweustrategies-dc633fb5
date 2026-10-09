# Recenzja: paczka, SSR i bezpieczeństwo integracji (strażnik przeładowania)

Zmiana: `feat/w3-reload-guard`, commit `24ece2e9` na bazie `56da8d23`. Pliki:
`src/lib/cacheBusting.ts` (+99/-30, z czego większość to komentarz nagłówka) i
`src/lib/__tests__/cacheBusting.test.ts`. Worktree tylko czytany, nic nie budowałem; liczby
paczki pochodzą z artefaktu `wt3/reload-guard/.output`, który zbudował implementer.
Sprawdziłem, że ten artefakt zawiera dokładnie końcowy kod (`markTime`, `isFresh`,
`loadedMark`, zatrzask `lastReload`), a nie pierwszą wersję z `window.name`.

## Werdykt

**approve.** Nie znalazłem regresji paczki, SSR ani integracji. Dwie uwagi drobne
(dokładność komentarza i kruchość grupowania chunków na przyszłość), bez wpływu na wdrożenie.

## 1. Rozmiar i położenie modułu

| Plik                                           | Baza (`base-w3b`) | Po zmianie | Delta  |
| ---------------------------------------------- | ----------------- | ---------- | ------ |
| `tag._slug-*.js` (host `cacheBusting.ts`), raw | 2095 B            | 2367 B     | +272 B |
| ten sam chunk, zlib poziom 6                   | 1011 B            | 1138 B     | +127 B |
| `index-*.js` (wejście), raw                    | 863 586 B         | 863 586 B  | 0      |

- Moduł zostaje w tym samym chunku `tag._slug-*.js` z tymi samymi współlokatorami
  (`web-stories.$slug?tsr-shared` 60 B, `tag.$slug?tsr-split=notFoundComponent` 46 B).
  Eksport `export{N as C,k as c,R as t}` ma ten sam kształt.
- Zbiór plików, które odwołują się do chunku, jest identyczny z bazą: wejście, oba
  `web-stories._slug-*`, `EmptyContainerPickerBox`, `RichTextView`, `admin.analytics.bi`,
  `admin.index` (mapDeps). W wejściu oba `import("./tag._slug-….js")` mają nadal pustą listę
  preloadów `[]`. Nie przybył żaden import statyczny ani nowa krawędź do vendorów.
- `document-weight.json` (mediana z 5 próbek) wobec `w3/base-b`:
  `bootClosureRawBytes` 1 636 946 -> 1 636 946 (0, zapas 812 B bez zmian),
  `bootClosureGzipBytes` 496 041 -> 496 071 (+30), `preLcpTransferBytes` +5,
  `bootBurstGzipBytes` +35. Raw jest identyczne bajt w bajt, więc delta gzip to wyłącznie
  entropia innych hashy w nazwach plików w wejściu (każda zmiana dowolnego chunku daje taki
  szum), nie kod tej zmiany. `tag._slug` nie występuje w `document-weight.json`, czyli chunk
  jest poza zamknięciem bootu i poza boot-burstem.
- `__root.tsx` (`armCacheBusting`, `EARLY_CHUNK_LOAD_ERROR`) nietknięty: do `index-*` nie
  trafia żaden bajt kodu.

## 2. SSR i czystość modułu

- Nowy stan na najwyższym poziomie to tylko `let lastReload = NaN`. Brak dostępu do `window`,
  `sessionStorage`, `performance` ani `location` przy ewaluacji modułu; w buildzie chunk nadal
  zaczyna się od stałych i deklaracji funkcji (sprawdzone w zminifikowanym pliku).
- `performance.getEntriesByType` i `sessionStorage` są czytane wyłącznie w `safeReloadOnce`,
  do którego prowadzą tylko `handleChunkLoadFailure` (strażnik `typeof window`) i nasłuchy
  `startCacheBusting` (ten sam strażnik). `loadedMark` ma własny `try`.
- Brak nowych zależności (`package.json` nietknięty), brak nowych importów w module.

## 3. Integracja

- **Parytet z korzeniem.** `looksLikeChunkLoadError` bez zmian, więc test parytetu
  w `rootRoute.test.tsx` i filtr `EARLY_CHUNK_LOAD_ERROR` nie wymagają zmian.
- **Jedna instancja modułu.** Moduł żyje w jednym chunku; korzeń (`load`), wydzielony
  `notFoundComponent` i `web-stories` dostają ten sam rekord modułu, więc zatrzask
  `lastReload` jest wspólny dla bufora wczesnych błędów i nasłuchów. Pętla
  `for (const reason of earlyErrors.splice(0)) m.handleChunkLoadFailure(reason)` daje teraz
  jedno `replace` także przy zablokowanym magazynie.
- **`_v` ma jednego pisarza.** Grep po `src`, `public`, `scripts`, `e2e`: tylko
  `cacheBusting.ts` zapisuje i czyta `_v`. Żaden inny mechanizm przeładowania (watchdog,
  heartbeat używa `_pv`) nie wytwarza świeżego `_v`, który mógłby fałszywie wstrzymać odzysk.
- **Mieszane wersje podczas wdrożenia.** Klucz `__lov_cb_reload`, format wartości (ms
  dziesiętnie) i format `_v` (`Date.now().toString(36)`) są bez zmian, więc karta ze starym
  bundlem i dokument z nowym czytają nawzajem swoje znaczniki. Stary dokument przy zablokowanym
  magazynie i tak dokleja świeży `_v`, który nowy kod respektuje: pętla kończy się na pierwszym
  nowym dokumencie.
- **`window.name`.** Końcowy kod go nie używa (warstwa została zmierzona i usunięta), więc
  ryzyko nadpisania cudzej nazwy, wycieku czy zepsucia `target=` nie istnieje.
- **Performance API.** `entry.name` wpisu nawigacji to końcowy adres dokumentu (po
  przekierowaniach); `clearResourceTimings`/limity bufora nie dotyczą wpisu nawigacji.
  Brak wpisu (stare Safari) albo wyjątek daje `NaN`, czyli brak warstwy, a nie błąd.
- **Dowód w przeglądarce** (`pw/results-before.json` vs `pw/results-after.json`): tryby
  blocked/quota/blocked-replacestate spadają z 22/16/21 przeładowań do 1, kontrola bez zmian
  (1), `otherErrors` puste, `windowName` puste.

## 4. Uwagi

1. **minor, komentarz:** akapit o `window.name` w nagłówku (`cacheBusting.ts`, sekcja „Czego
   strażnik NIE chroni”) mówi, że „odpowiedź 3xx bez nagłówka COOP przełącza w Chromium grupę
   kontekstów”. Pomija przesłankę: dzieje się tak, bo nasze dokumenty wysyłają
   `Cross-Origin-Opener-Policy: same-origin` (`src/start.ts:490`), a odpowiedź 3xx go nie ma,
   więc polityki się różnią. Bez tej przesłanki czytelnik może uznać, że każdy 3xx zeruje nazwę.
   Poprawka: dopisać „(nasze dokumenty mają COOP same-origin, `start.ts`)”.
2. **nit, kruchość grupowania:** host modułu zależy od heurystyki `experimentalMinChunkSize`
   (2048) Rollupa. Pierwsza wersja (+~0,5 KB kodu) przeniosła moduł do `admin.users-*` razem ze
   statycznymi importami vendorów. Obecna wersja tego nie robi, ale kolejna rozbudowa modułu
   może. Komentarze są darmowe, więc warto dopisać w nagłówku jedno zdanie: każda zmiana kodu
   tego modułu wymaga sprawdzenia hosta w `reports/chunk-inventory.json`.

Nic blokującego: pętla przy zablokowanym lub pełnym magazynie jest zamknięta, pierwszy odzysk po
deployu nadal się odbywa, a paczka, SSR i boot pozostają bez zmian.
