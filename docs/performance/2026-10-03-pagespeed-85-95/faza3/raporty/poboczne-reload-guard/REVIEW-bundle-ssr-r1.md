# Recenzja, runda 1: paczka, SSR i bezpieczeństwo integracji (strażnik przeładowania)

Zmiana: `56da8d23..d67e1734` w `scratchpad/wt3/reload-guard`, czyli commity `24ece2e9` i `d67e1734`.
Pliki: `src/lib/cacheBusting.ts` i `src/lib/__tests__/cacheBusting.test.ts`. `__root.tsx` nie
został zmieniony. Worktree był tylko czytany. Niczego nie budowałem: liczby paczki pochodzą
z artefaktu `wt3/reload-guard/.output` i z `reports/chunk-inventory.json`, które zbudował
implementer (`build-fix1.log`, exit 0).

Zgodność artefaktu z HEAD sprawdziłem tak: `src/lib/cacheBusting.ts` ma mtime 00:33, build
powstał o 00:45, commit o 01:07, a `git status` jest czysty. Zminifikowany chunk zawiera kotwicę
(`a=e-r-o;if(a>=-2e3&&a<p&&r<h||l(o,e)||l(w(i),e))return`) i zatrzask na cały dokument
(`let g=!1` … `g=!0`). Artefakt odpowiada więc kodowi z commita `d67e1734`.

## Werdykt

**approve.** Nie znalazłem regresji paczki, SSR ani integracji. Uwagi z rundy 0 (przesłanka
COOP w komentarzu, zdanie o sprawdzaniu hosta chunku) zostały wprowadzone. Zostały tylko dwie
drobne uwagi do komentarzy.

## 1. Rozmiar i położenie modułu

| Plik                                             | Baza (`base-w3b`) | Runda 1   | Delta  |
| ------------------------------------------------ | ----------------- | --------- | ------ |
| `tag._slug-*.js` (host `cacheBusting.ts`), raw   | 2095 B            | 2430 B    | +335 B |
| ten sam chunk, gzip -6 (CLI, z nagłówkiem nazwy) | 1045 B            | 1208 B    | +163 B |
| `cacheBusting.ts` renderedLength w inwentarzu    | 2984 B            | 3687 B    | +703 B |
| `index-*.js` (wejście), raw                      | 863 586 B         | 863 586 B | 0      |

- Wzrost minifikatu wynosi +335 B raw / ~+160 B gzip i w całości pochodzi z kodu modułu.
  Współlokatorzy chunku są bajt w bajt ci sami: `web-stories.$slug?tsr-shared=1` (60 B)
  i `tag.$slug?tsr-split=notFoundComponent` (46 B). Kształt eksportu też się nie zmienił
  (`export{O as C,R as c,I as t}`).
- **Wejście jest identyczne z bazą po znormalizowaniu hashy nazw plików** (`diff` pusty). Oba
  `import("./tag._slug-….js")` mają nadal pustą listę preloadów `[]`. Zbiór plików, które
  odwołują się do chunku, jest ten sam co w bazie: wejście, oba `web-stories._slug-*`,
  `EmptyContainerPickerBox`, `RichTextView`, `admin.analytics.bi` i `admin.index`. Nie
  przybył żaden import statyczny, żadna krawędź do vendorów i żaden nowy import w samym module.
- `document-weight-fix1.json` wobec `w3/base-b` (mediana z 5 próbek, uruchomienie przez
  `node`): `bootClosureRawBytes` 1 636 946 -> 1 636 946 (0, zapas 812 B bez zmian),
  `bootClosureGzipBytes` 496 041 -> 496 060 (+19, entropia hashy w nazwach przy identycznym
  raw), `preLcpTransferBytes` +8, `bootBurstGzipBytes` +28. Wszystkie 30 metryk mieszczą się
  w progach. `tag._slug` nie występuje w raporcie wagi, więc chunk leży poza zamknięciem
  bootu i poza boot-burstem.
- Ryzyko przegrupowania: renderedLength modułu rośnie o ~0,7 KB, więc trzymanie dwóch
  drobnych modułów w tym chunku kosztuje teraz ~3,7 KB. W tym buildzie Rollup ich nie
  przeniósł. Nagłówek modułu każe sprawdzać hosta w `reports/chunk-inventory.json` po każdej
  zmianie kodu, a flaga `BUNDLE_INVENTORY` istnieje (`vite.config.ts:112`).
- `check:bundle` sprawdza budżety sum (PUBLIC/OVERALL, zapas OVERALL ~17,6 KB). +0,33 KB
  w leniwym chunku to pomijalny wzrost. Per chunk liczy się tylko raport ruchów, a nie bramka.

## 2. SSR i czystość modułu

- Na najwyższym poziomie modułu przybył tylko stan `let reloadIssued = false` i stałe
  liczbowe. Nic nie czyta `window`, `sessionStorage`, `performance` ani `location` przy
  ewaluacji. W minifikacie chunk zaczyna się od stałych i deklaracji funkcji. Na serwerze
  moduł jest ewaluowany przez wspólny chunk `notFoundComponent`, więc ma to znaczenie, i jest
  spełnione.
- `performance.getEntriesByType`, `performance.now` i `sessionStorage` są używane wyłącznie
  w `safeReloadOnce`. Prowadzą do niej tylko `handleChunkLoadFailure` (strażnik
  `typeof window`) i nasłuchy z `startCacheBusting` (ten sam strażnik). `loadedMark` ma
  własny `try`, więc wpis nawigacji z `name: "document"` (nieparsowalny URL) daje `NaN`, a nie
  wyjątek. `markTime(href)` poza `try` parsuje `window.location.href`, który zawsze jest
  poprawnym URL-em. Stary kod robił to samo (`new URL(window.location.href)`).
- Brak nowych zależności, `package.json` i lockfile bez zmian. Prettier `--check` na obu
  plikach przechodzi (sprawdziłem przez `light.sh`).

## 3. Integracja

- **Parytet z korzeniem.** `looksLikeChunkLoadError`, `handleChunkLoadFailure` (sygnatura)
  i `startCacheBusting` się nie zmieniły. `__root.tsx` (`armCacheBusting`,
  `EARLY_CHUNK_LOAD_ERROR`) jest nietknięty, więc test parytetu i bufor wczesnych błędów
  działają bez zmian. Do `index-*` nie trafia żaden bajt.
- **Jedna instancja modułu.** Moduł żyje w jednym chunku. Korzeń, wydzielony
  `notFoundComponent` i `web-stories` dostają ten sam rekord modułu, więc zatrzask
  `reloadIssued` jest wspólny dla pętli `earlyErrors.splice(0)` i dla nasłuchów. W jednym
  dokumencie wychodzi najwyżej jedno `replace`.
- **`_v` ma jednego pisarza i jednego czytelnika.** Grep po `src`, `scripts`, `e2e`
  i `public` znajduje tylko `cacheBusting.ts`. Heartbeat podglądu używa `_pv`, a watchdog
  nie dotyka `_v`. Nic poza tym modułem nie wytwarza świeżego `_v`, który mógłby fałszywie
  włączyć kotwicę.
- **Mieszane wersje podczas wdrożenia.** Klucz `__lov_cb_reload`, format wartości (ms
  dziesiętnie) i format `_v` (`Date.now().toString(36)`) są bez zmian. Stary dokument przy
  zablokowanym magazynie dokleja świeży `_v`, który nowy kod respektuje (warstwy b i c).
- **`window.name`.** Kod go nie używa. Ryzyko nadpisania cudzej nazwy, wycieku czy zepsucia
  `target=` więc nie istnieje. Uzasadnienie w nagłówku sprawdziłem w kodzie i jest trafne.
  COOP `same-origin` ustawia tylko gałąź `text/html` w `securityHeadersMiddleware`
  (`src/start.ts:455-490`). 302 z `homepageLangMiddleware` (`new Response(null, {status: 302})`,
  bez `Content-Type`) nie dostaje COOP, więc zdanie „nasz własny 302 `/` -> `/en` też jest bez
  COOP” jest prawdziwe.
- **`stop()` nie zeruje `reloadIssued`.** W produkcji to poprawne: zatrzask dotyczy
  dokumentu, a nie cyklu startu nasłuchów. Testy izolują stan przez `vi.resetModules()`.

## 4. Uwagi

1. **nit, komentarz (`cacheBusting.ts:33-34`):** zdanie „Nie używamy `performance.timeOrigin`,
   bo nie ma go w Safari < 16” jest najpewniej nieścisłe. Według tabel zgodności MDN
   `Performance.timeOrigin` jest w Safari od 15, czyli od tej samej wersji co wpis
   `PerformanceNavigationTiming`, o którym linia 41 mówi „Safari < 15”. Nie zweryfikowałem
   tego lokalnie (brak `@mdn/browser-compat-data` w `node_modules`). Drugi argument, czyli
   rozjazd `timeOrigin` z `Date.now()` po uśpieniu systemu w Chromium, jest trafny i sam
   wystarcza. Poprawka: usunąć wzmiankę o Safari albo zmienić ją na „< 15”. To tylko
   komentarz, więc nie wpływa na zachowanie ani na bajty.
2. **nit, kruchość grupowania (bez zmian od rundy 0, tylko odnotowanie):** po tej zmianie
   koszt trzymania w chunku dwóch drobnych modułów tras wzrósł do ~3,7 KB renderedLength.
   Kolejna rozbudowa modułu może skłonić Rollupa do przeniesienia ich do innego czystego
   chunku. Zmieni się wtedy nazwa hosta, a w wejściu dziesiątki bajtów, wobec 812 B zapasu
   zamknięcia bootu. Nagłówek już to opisuje. Do zrobienia nic poza pomiarem w etapie Prove.

Nic blokującego. Moduł zostaje leniwy, poza zamknięciem bootu i bez dostępu do API
przeglądarki przy imporcie. Wejście jest bajt w bajt takie samo (modulo hashe), a parytet
z korzeniem jest nienaruszony.
