# P3.2b: recenzja adwersaryjna (fala 3, partia 3b)

Recenzowany commit: `46e09026` w `$SCRATCH/wt3/P3.2b`, diff `d5bd11fb...HEAD` (16 plików, +1472/−198).
Werdykt: **approve**. Nie ma ustaleń blokujących. Jedno ustalenie `major` dotyczy zakresu: nowy plik spoza listy
§3, wymaga potwierdzenia orkiestratora, kod nie musi się zmieniać. Pozostałe ustalenia są `minor`. Dowody na buildzie
(Prove) są jeszcze otwarte, lista w §5.

`$SCRATCH` = `/tmp/claude-0/-home-user-neweustrategies-dc633fb5/57088803-e7ea-5e89-8c05-954276daf4ba/scratchpad`.
Logi recenzji: `$SCRATCH/phase3/wave3/P3.2b/review/`.

## 1. Bramki uruchomione w worktree

| Bramka                                                                                                                  | Wynik                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `light.sh bunx eslint` (12 dotkniętych plików TS)                                                                       | exit 0, 0 błędów; 2 ostrzeżenia `react-refresh` w `__root.tsx:483,1360`, które są już na bazie, poza liniami P3.2b (`review/eslint.log`) |
| `light.sh bunx vitest run` (`fontGlyphCoverage`, `themeDesignFontStack`, `fontPreload`, `rootHead`, `platformPreloads`) | 5/5 plików, 63 testy zielone + 1 oczekiwany fail (istniejący `it.fails`) (`review/vitest.log`)                                           |
| `light.sh bun run verify:static`                                                                                        | 15/15 bramek OK w 225 s, w tym `prettier --check .`, kontrakt TS↔SQL i świeżość typów (`review/verify-static.log`)                       |
| Typecheck, build, Lighthouse, e2e                                                                                       | nie uruchamiane, zgodnie z zakazem dla recenzji                                                                                          |

## 2. Niezależna weryfikacja pliku fontu

- sha256 pliku w repo: `efaa4dc4…a6a75c7`. To ten sam hash co w raporcie i w dwóch przebiegach r1/r2 wykonawcy, więc
  plik jest odtwarzalny (`SOURCE_DATE_EPOCH`).
- fontTools (venv planisty, `python -I`, `review/fc.py`): `fvar wght` 400/400/900, 6 instancji, `hhea` 1018/−305
  w każdej wadze 400–900, MVAR obecny. Porównałem z dawnym `latin.woff2` z `d5bd11fb`: 1380 par (znak, waga), 0 różnic
  szerokości. Mają wszystkie 18 polskich liter, cmap 252 kody.
- Produkcja: RSS PL i EN (2 żądania, 18 + 18 wpisów). Ani jeden tytuł ani opis nie zawiera znaku, który kierowałby
  do latin-ext (`review/rsscheck.py`).

## 3. Co sprawdziłem i jest poprawne

- **Zakres plików.** `__root.tsx` zmienia tylko import fontu, `ROOT_ASSETS`, dwa wywołania i komentarz nad
  `rootLinkHeaderValues`. Regiony P3.8 i P3.6b są nietknięte, więc scalenie będzie czysto tekstowe. `styles.css`
  zmienia tylko blok `@font-face` RHD i fallback (dawne `:31-94`). `themeDesign.ts` ma nową funkcję i dwie linie
  emisji. `documentWeight.ts` dostaje `fontPreloadCount` addytywnie obok `inlineCssCommentBytes`. `budgets.json` ma
  wyłącznie nowy klucz i akapit kroniki; istniejące progi są nietknięte. `package.json` się nie zmienia.
- **`unicode-range`.** Latin-ext to dawny zakres minus PL litery, U+0131, U+0152-0153 i U+2020; sprawdziłem ręcznie
  segment po segmencie i nie ma luk ani nakładek z literami PL. Twarz główna jest zadeklarowana ostatnia. Nakładki
  obu twarzy (U+0304, U+0308, U+0329) są takie same jak przed zmianą.
- **Fallback per waga i synteza.** Blink (`CSSSegmentedFontFace`) syntetyzuje bold tylko wtedy, gdy
  `capabilities.weight.maximum < 600` i żądana waga ≥ 600. Twarze 550–1000 mają max ≥ 649, więc syntezy nie ma.
  Zakresy są ciągłe 1–1000. Iloczyn override × size-adjust daje 101,8 / 30,5 w każdej twarzy. `font-style: normal`
  działa jak dawny domyślny deskryptor.
- **SSR i hydratacja.** `rootDocumentLinks` i `rootLinkHeaderValues` nie zależą już od języka, więc zestaw `<link>`
  jest identyczny na serwerze i na kliencie. To usuwa nawet teoretyczne ryzyko rozjazdu. `withRedHatDisplayFallback`
  jest deterministyczna i działa po obu stronach w tym samym module, a hash bloku Theme Design jest liczony
  z wejścia, więc klient nie regeneruje bloku. Tożsamość cache dokumentu jest bez zmian: klucze zawierają build,
  a nagłówek `Link` jest teraz nawet mniej zależny od języka.
- **Domknięcie bootu.** Inwentarz `base-w3d/reports/chunk-inventory.json` pokazuje, że `themeDesign.ts` jest tylko
  w `themeDesignCss-*.js` (`isDynamicEntry`), a nie w wejściu. W wejściu `fontPreload` i `rootHead` tracą kod.
  Nie ma nowej statycznej krawędzi importu w kliencie: `woff2Tables.ts` importują wyłącznie testy.
- **Bramka CI.** `fontPreloadCount` liczy unikalne pliki (`anyAssetName`), tak jak `modulepreloadCount`.
  `GATED_METRICS` ma nowy wpis, a próg wynosi 1. Test jednostkowy ma kontrolę negatywną (2 dla dawnego zestawu).
  Spec `single-font.boot-home.spec.ts` łapie wzorzec `testMatch` artefaktu, a `playwright.config.ts` (dev) go
  ignoruje przez `testIgnore`. Na bazie daje 2/2 czerwone (kontrola negatywna w logu wykonawcy).
- **Kontrole negatywne testów.** Test pokrycia uruchomiony na dawnym `latin.woff2` daje 5/15 czerwonych. Na dawnym
  bloku CSS też 5/15 czerwonych. `font-swap-cls` na bazie daje desktop 0,0021 (PL) i 0,0212 (EN), czyli czerwone.
  Mentalne cofnięcie poszczególnych zmian kończy się czerwonym testem.
- **Komentarze i commit.** Po polsku. Stopka commitu dokładnie jak wymagana (`Co-Authored-By` + `Claude-Session`).
  Nie ma zbędnych plików w drzewie: `reports/` i `test-results/` są ignorowane przez `.gitignore`.

## 4. Ustalenia

### M1 [major, zakres, potwierdzenie orkiestratora] Nowy plik spoza listy §3 planu

- Plik: `e2e/single-font.boot-home.spec.ts` (nowy, 107 linii).
- Dowód: lista zatwierdzona w notatkach to §3 pkt 1–10 plus `documentWeight.ts` i `budgets.json` z pkt (4). Tego
  pliku tam nie ma. Wykonawca podaje powód (odstępstwo 6): pkt (4) notatek wymaga „testu jednego żądania woff2”
  w bramce CI. `e2e-performance/font-swap-cls.spec.ts` z listy nie jedzie w CI na PR, bo `run-first-visit.mjs` ma
  zamkniętą listę zestawów. Jedyny wariant bez nowego pliku wymagałby edycji `run-first-visit.mjs`, która też jest
  spoza listy. Konwencja `*.boot-home.spec.ts` ma precedens (`legal-links`, `motion-gate`).
- Ocena: to wymagany element notatek, który nie miał w liście żadnego pliku-gospodarza, a nie samowola. Kod jest
  poprawny.
- Naprawa: orkiestrator potwierdza plik jawnie przy scaleniu. Alternatywa: przenieść asercje do `font-swap-cls` i
  dopisać zestaw w `run-first-visit.mjs`. Wtedy jednak test nie jedzie na PR, czyli słabsza bramka.

### m1 [minor, testy] Testy źródła tekstowego wbrew zasadzie sesji „tylko testy behawioralne”

- Plik: `src/lib/ci/__tests__/fontGlyphCoverage.test.ts:332-337`. Regex importu `?url` w źródle `__root.tsx` to
  test tekstu źródłowego. Do tego `:302-311`: tabela `SIZE_ADJUST` powtarza literały z CSS, więc jest detektorem
  zmian, a nie inwariantem.
- Dowód: notatki środowiska mówią „Behavioural tests only (no CSS-class-list or source-text tests)”. Plan §9.2
  pkt 6–8 przepisuje jednak te testy wprost, więc wykonawca trzymał się specyfikacji.
- Naprawa (opcjonalna, do decyzji orkiestratora): usunąć test regex `__root.tsx`, bo ten sam kontrakt sprawdza
  behawioralnie `single-font.boot-home.spec.ts` (preload == jedyne żądane woff2). Tabelę `SIZE_ADJUST` można
  zostawić jako stałą receptury albo zastąpić przedziałem (np. 93–101 %). Inwarianty (ciągłość wag, iloczyn
  metryk, Bold ≥ 550, litery PL poza latin-ext) zostają.

### m2 [minor, dokumentacja w kodzie] Nieaktualny komentarz w `head()` korzenia

- Plik: `src/routes/__root.tsx:645-650`. Komentarz mówi „so the branded meta, **the font preload** and the
  `<html lang>` are always derived from this request's URL”. Preload fontu nie zależy już od języka.
- Naprawa: usunąć „the font preload”. Linia leży tuż nad wywołaniem `rootDocumentLinks`, więc mieści się w
  dopuszczonym regionie. Można też zrobić to przy ręcznym scaleniu z P3.8.

### m3 [minor, CLS poza `/`] `size-adjust(800)` = 99,71 % dostrojone do etykiet WIELKIMI literami na `/`

- Plik: `src/styles.css`, twarz `750 849`.
- Dowód: na stronach publicznych waga 800 występuje też w tekście mieszanej wielkości liter.
  `EventModuleHero.tsx:144` ma `h1 … font-extrabold text-3xl sm:text-5xl`, czyli tytuł strony wydarzenia i
  prawdopodobny element LCP tekstowy. Dla takiego tekstu krój zastępczy jest ok. 2 % szerszy niż RHD 800 (korpus
  mieszany daje 97,75 %), więc długi tytuł może przed podmianą zawinąć się o linię więcej. Baza była ok. 9 % węższa,
  więc to nadal poprawa co do wielkości, nie regresja. Odstępstwo jest opisane w raporcie z pomiarem.
- Naprawa: brak wymaganej. W Prove lub fali 4 warto jednorazowo uruchomić `font-swap-cls` na stronie wydarzenia
  (jeśli fixture ją ma) albo zapisać ryzyko w STAN-FALI-3.

### m4 [minor, ryzyko treści] Diakrytyki spoza PL (š, č, ž, ő, ă, ș …) na stronie PL ładują latin-ext późno

- Dowód: dawniej PL preloadował latin-ext, więc nazwiska z Europy Środkowej renderowały się RHD od razu. Teraz
  znak z zakresu latin-ext uruchamia nieprzeładowane żądanie po parsowaniu CSS i podmianę pojedynczych glifów
  (z kroju zastępczego, więc przesunięcie jest małe). EN zachowuje się tak jak przed zmianą. Sprawdziłem RSS
  produkcji PL i EN (36 wpisów): 0 takich znaków. Fixture CI też ich nie ma. To decyzja właściciela („jeden
  font”), nie defekt.
- Naprawa: brak. Zapisać w STAN-FALI-3 jako ryzyko zależne od treści. Gdyby się zmaterializowało, rozważyć
  dołożenie do podzbioru najczęstszych liter Latin Extended-A (koszt kilku KB).

### m5 [minor, ryzyko środowiska] System z Regular, ale bez Bold któregokolwiek kandydata

- Plik: `src/styles.css`, twarze 550–1000.
- Dowód: gdy żadne `local()` Bold się nie rozwiąże, Blink nie spada do innej twarzy tej samej rodziny, tylko do
  następnej rodziny stosu (`system-ui`). Dla wag ≥ 600 to gorzej niż baza, gdzie był syntetyczny bold z Regular.
  Pakiety Arial, Liberation i Arimo zawierają Bold, a plan §12 to ryzyko przyjmuje. `font-swap-cls` ma strażnika
  dla 700.
- Naprawa: brak. Informacyjnie.

### m6 [minor, P3.10] `src/lib/ci/woff2Tables.ts` jest modułem tylko testowym

- Knip w P3.10 uzna go za kandydata do usunięcia (KRYTYKA L12).
- Naprawa: P3.10 S0 musi go jawnie wykluczyć. Przekazać orkiestratorowi.

## 5. Dowody otwarte (Prove, na buildzie worktree), bez nich nie scalać

1. `check-document-weight` A = `base-w3d`, B = worktree. Oczekiwane: `fontPreloadCount` 2 → 1 (próg 1),
   `linkHeaderEntries` 5 → 4, `preloadDuplicates` 3 → 2, `preLcpTransferBytes` ok. −20 KB, `bootClosure*` bez
   wzrostu (raw, gzip, burst).
2. `check:bundle`: suma CSS (KRYTYKA L2). Emulacja daje +256 B gz przy zapasie ok. 0,6 KB. Trzeba potwierdzić na
   prawdziwym buildzie, razem z public CSS i overall.
3. `test:e2e:artifact` z env CI. To pierwszy przebieg `single-font.boot-home.spec.ts` na kandydacie; dotąd był
   tylko na bazie, jako kontrola negatywna.
4. `font-swap-cls.spec.ts` na prawdziwym buildzie kandydata (dotąd na emulacji), 4/4 ≤ 0,001.
5. Lighthouse `--compare base-w3d <wt> --runs 5 --forms mobile,desktop`: jedno żądanie woff2 na PL i EN, CLS 0 w
   5/5, ΔFCP ≈ 0, ΔLCP mobile ≤ 0.

## 6. Realizm Lantern i SI

- Mniej bajtów przed LCP: PL −20,4 KB i jedno żądanie mniej, EN −6,3 KB. W modelu Lantern to krótsza rywalizacja
  o łącze z obrazem LCP przy 1,6 Mb/s, czyli realny, mały zysk LCP na mobile. Zadań CPU to nie zmienia.
- SI: podmiana fontu nadal daje jedną zmianę wizualną (glify), tak jak dziś. Krój zastępczy per waga zmniejsza
  przesunięcie układu przy podmianie, więc w SI opartym na układzie nie ma nowej późnej zmiany. Nie powstaje też
  nowa późna zmiana wizualna: latin-ext nie jest pobierany na PL i EN przy obecnej treści.
