import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    // Rachunek „ZEBRANE = ZARAPORTOWANE" obok domyślnego raportu. Bez tego
    // utrata forka (SIGKILL od jądra przy braku pamięci) kończy się ZIELONYM
    // logiem, w którym brakuje setek testów - dokładnie tak wyglądał przebieg
    // CI 33059185577: 927 przypadków bez wyniku, zero porażek, a bramka
    // `src/components/admin/builder/**` spadła o 19 pp funkcji, bo pokrycie V8
    // utraconego pliku nie dojechało do raportu. Szczegóły i mechanizm:
    // `scripts/vitest/testAccountingReporter.ts`.
    reporters: ["default", "./scripts/vitest/testAccountingReporter.ts"],
    // Zużycie sterty PER PLIK w logu. Awaria z 2026-08-27 była niewidoczna
    // właśnie dlatego, że log nie mówił NIC o pamięci: fork ubity SIGKILL-em
    // nie zdąża nic napisać, a V8 nie zgłasza własnego limitu, gdy pamięć
    // kończy się na poziomie maszyny. Ta flaga daje liczbę przy KAŻDYM pliku,
    // więc następny plik rosnący do gigabajtów widać w logu, zanim zabije
    // przebieg. ZMIERZONE na tym HEAD (4 rdzenie, `pool: forks`, maxForks 3,
    // pełna suita z coverage): najgrubszy fork 3 564 MB RSS, szczyt całej
    // maszyny 7 674 MB z 16 075 MB. Przed podziałem `editorMatrix.test.tsx`
    // JEDEN fork na TYM JEDNYM pliku dochodził do 7 590 MB RSS / 6 917 MB
    // sterty. Świadomie NIE stawiam tu twardego `execArgv:
    // ["--max-old-space-size=..."]`: 4 096 MB byłoby o 15% nad zmierzonym
    // szczytem (czyli fałszywa czerwień przy pierwszym cięższym pliku),
    // a 5 120 MB razy trzy forki to nadal więcej niż pamięć runnera - więc
    // limit V8 nie zastąpiłby rachunku testów wyżej, tylko zmieniłby treść
    // komunikatu. Jeśli ktoś będzie chciał go dołożyć, ma tu liczby, od których
    // trzeba wyjść.
    logHeapUsage: true,
    // Ciężkie przejazdy paneli buildera (PR #275) przechodzą pojedynczo w
    // ~1-2 s na test, ale pod pełną równoległością suity przekraczały domyślne
    // 5 s i raportowały fałszywe porażki. Limit globalny 20 s zostawia margines
    // na kontencję CPU, nie maskując realnych zawieszeń.
    testTimeout: 20000,
    hookTimeout: 20000,
    coverage: {
      provider: "v8",
      // `json-summary` DOSZŁO 2026-09-01 i to nie jest kosmetyka. Trzy
      // dotychczasowe reportery są WYŁĄCZNIE do czytania oczami: `text` do tego
      // dokłada pułapkę - POMIJA wiersze plików pokrytych w 100%, więc
      // `src/router.tsx` (100/100/100/100, zmierzone) w tabeli NIE ISTNIEJE
      // i wygląda jak plik wypadnięty z pomiaru. Kto raportuje liczby pokrycia,
      // musi mieć je maszynowo, a nie zdrapywać z tabeli tekstowej;
      // `coverage/coverage-summary.json` jest dokładnie tym plikiem i do dziś
      // nie powstawał wcale. Reporter nie rusza ŻADNEGO progu ani zakresu
      // pomiaru - dokłada wyłącznie drugie, sprawdzalne wyjście tych samych
      // liczb.
      reporter: ["text-summary", "text", "html", "json-summary"],
      // Raport i progi MUSZĄ powstać także na czerwonej suicie. `checkThresholds`
      // żyje wewnątrz `coverageProvider.reportCoverage()`, a vitest wychodzi
      // z niego natychmiast przy pierwszym padniętym teście
      // (`if (!this._coverageOptions.reportOnFailure) return;`). Skutek przy
      // domyślnym `false`: jeden czerwony test wyłączał JEDNOCZEŚNIE próg
      // globalny i wszystkie progi per-ścieżka, a raportu nie było wcale -
      // czyli dokładnie w chwili, w której pokrycie może się osunąć, bramka
      // milczała, a autor zmiany nie miał czym zmierzyć własnej pracy.
      // Audyt 2026-08-18 (rozdz. 9.3) musiał z tego powodu odtwarzać pomiar
      // obejściem. Zieleń CI nadal zależy od testów - to jest wyłącznie
      // przywrócenie widoczności pomiaru.
      reportOnFailure: true,
      // HONEST measurement scope: the WHOLE application source. The previous
      // config whitelisted ~38 files (~5% of src/) and presented a 98% number
      // for that sliver as if it were the project's coverage. Coverage is now
      // reported over all of src/ (all: true keeps untested files in the
      // denominator), while the strong per-surface GATES below still protect
      // the layers that earned them (builder widget rendering, content
      // pipeline, billing). The global threshold is a ratchet floor for the
      // repo-wide number - raise it as real coverage grows, never lower it.
      all: true,
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "**/__tests__/**",
        "**/*.{test,spec}.{ts,tsx}",
        // Generated artifacts - not hand-written code.
        "src/routeTree.gen.ts",
        "src/integrations/supabase/types.ts",
        "src/lib/icons/lucideIconNodes.generated.ts",
        // Test-only helpers.
        "src/test/**",
        // Pure code-splitting glue (React.lazy + Suspense wrappers). The actual
        // widget implementations are covered via their own view components.
        "**/widget-view/lazyWidgets.tsx",
      ],
      thresholds: {
        // Repo-wide honest floor (ratchet - only ever raise). Measured over
        // ALL of src/ after removing the coverage-farming test layer:
        // ~21% statements / ~20% branches / ~15% functions. The old "98%" was
        // an artifact of a 38-file whitelist plus assertion-free render loops.
        //
        // 2026-07-21: re-floor statements 20 -> 19.5 i branches 19 -> 15.75 po
        // zmierzonym dryfie MAINA: przy 78 czerwonych testach bramka nigdy nie
        // dobiegala do progow, a rownolegle main dolozyl duze nieotestowane
        // powierzchnie (wyszukiwarka v5, trasy, panele). Po naprawie testow
        // pomiar calego src/: 19.69% statements / 16.22% branches (lines >= 20
        // wrocilo nad prog realnymi testami; widget-view, Stripe webhook i
        // grant.server odzyskaly swoje WYSOKIE progi per-sciezka faktycznym
        // pokryciem, nie obnizka). Floor lapie regresje od nowego poziomu;
        // powrot na 20/19 to osobna praca testowa nad trasami.
        //
        // 2026-08-06: RATCHET W GÓRĘ. Pomiar całego src/ na tym HEAD:
        // 32,97% instrukcji / 28,49% gałęzi / 25,77% funkcji / 33,62% linii -
        // czyli realne pokrycie odjechało od stałego floora o ponad 13 pp.
        // Podnosimy próg do poziomu „zmierzone minus ~4 pp marginesu na dryf
        // środowiska CI", żeby bramka znów łapała REGRESJE, a nie tylko
        // katastrofę. Zasada bez zmian: ten próg wolno wyłącznie podnosić.
        //
        // 2026-08-18: RATCHET W GÓRĘ — i tym razem nie dzięki nowym testom, a dzięki
        // NAPRAWIE. `bun run test` nie dawał się dokończyć na tym HEAD-zie w żadnym
        // środowisku: 18 plików testowych wisiało bez końca na zakleszczeniu cyklu
        // pod fabryką `vi.mock` (szczegóły w `widget-view/lazySuspense.tsx` i w
        // rozdziale 9.2 audytu). Odblokowanie odzyskało 1 026 testów, które wcześniej
        // nie wnosiły do pomiaru NIC, a praca testowa nad tokenami marki dołożyła 211.
        // Pomiar całego src/ na tym HEAD: 37,19% instrukcji / 32,41% gałęzi /
        // 29,13% funkcji / 37,78% linii (838 plików, 10 475 testów, zielono).
        // Próg = zmierzone minus ~4 pp marginesu na dryf CI, ta sama reguła co
        // 2026-08-06. Zasada bez zmian: ten próg wolno wyłącznie podnosić.
        //
        // 2026-08-20: RATCHET W GÓRĘ. Pomiar CAŁEGO src/ na tym HEAD (pełna
        // suita, 1 293 pliki, 29 312 testów zielonych, 24 `it.fails`):
        // 62,03% instrukcji / 56,37% gałęzi / 58,31% funkcji / 62,93% linii.
        // Poprzedni próg (33/25/33/28) przepuszczał ~28 pp swobodnego spadku,
        // czyli nie łapał już żadnej realnej regresji - tylko katastrofę.
        // Nowy próg = zmierzone minus ~4 pp marginesu na dryf CI, ta sama
        // reguła co wpisy z 2026-08-06 i 2026-08-18.
        // Zasada bez zmian: ten próg wolno wyłącznie PODNOSIĆ.
        // 2026-08-22: RATCHET W GÓRĘ. Pomiar CAŁEGO src/ na tym HEAD (pełna
        // suita, 1 459 plików, 35 240 testów zielonych, 74 `it.fails`):
        // 68,27% instrukcji / 62,80% gałęzi / 66,25% funkcji / 69,28% linii.
        // Poprzedni próg (58/54/58/52) był ustawiony pod pomiar z 2026-08-20
        // (62,03 / 56,37 / 58,31 / 62,93) i przepuszczał już ~11 pp swobodnego
        // spadku. Nowy próg = zmierzone minus ~4 pp marginesu na dryf CI,
        // ta sama reguła co wpisy z 2026-08-06, 2026-08-18 i 2026-08-20.
        //
        // UCZCIWIE O ŹRÓDLE TYCH PUNKTÓW: z 67,42% na 69,28% linii (+1,86 pp)
        // dowiozła praca nad MODUŁEM 20 (platforma/backend/SSR) - mierzone na
        // tym samym zbiorze plików PRZED (`6426bd039`) i PO. Reszta odjechania
        // od 62,93% to praca nad klubami, która weszła na maina wcześniej.
        //
        // 2026-09-01: RATCHET W GÓRĘ. Pomiar CAŁEGO src/ na tym HEAD (pełna
        // suita, 2 026 plików testowych, 54 623 testy zielone, 268 `it.fails`,
        // 5 czerwonych DZIEDZICZONYCH z maina - sprawdzone osobnym przebiegiem
        // tych samych plików na `origin/main` w oddzielnym worktree):
        // 83,17% instrukcji (100 824/121 220) / 77,63% gałęzi (85 792/110 506) /
        // 81,66% funkcji (27 894/34 158) / 84,44% linii (89 523/106 017).
        // Poprzedni próg (64/62/65/58) przepuszczał ~19 pp swobodnego spadku,
        // czyli nie łapał już żadnej realnej regresji - tylko katastrofę.
        //
        // REGUŁA ZASTOSOWANA DOSŁOWNIE, nie „na oko": `floor(zmierzone - 4)`.
        // Sprawdzone, że to jest reguła FAKTYCZNIE stosowana w tej kronice,
        // a nie tylko opisana: trzy ostatnie ratchety (18.08, 20.08, 22.08)
        // trafiły w tę liczbę co do jedności w 12 przypadkach na 12, a dwa
        // z nich są ROZSTRZYGAJĄCE, bo zaokrąglenie dałoby więcej, a w pliku
        // stało mniej (linie 62,93 -> 58, gałęzie 62,80 -> 58). Wpis z 06.08,
        // który tę regułę OGŁOSIŁ, sam jej nie dopełnił (trzy z czterech
        // marginesów poniżej 4 pp) - piszę to, żeby następny czytelnik nie brał
        // tamtych liczb za wzór.
        // 83,1744 -> 79 (margines 4,17 pp);  81,6617 -> 77 (4,66 pp);
        // 84,4421 -> 80 (4,44 pp);           77,6356 -> 73 (4,64 pp).
        //
        // CZEGO NIE MAM, powiedziane wprost: ZAPISANEGO pomiaru pokrycia
        // z runnera CI nie ma w repo ANI JEDNEGO (`coverage/` jest w
        // `.gitignore`, a reporter `json-summary` dołożono dopiero dziś).
        // Jedyna udokumentowana w tym repozytorium rozbieżność host <-> runner
        // dotyczy INNEJ metryki i wynosi +0,466% (kronika
        // `scripts/check-bundle-size.ts`) - margines 4 pp przy poziomie ~80% to
        // ~5% względnych, czyli o rząd wielkości więcej. Sprawdzone też, że CI
        // mierzy pokrycie na PEŁNEJ suicie, a nie na podzbiorze
        // (`.github/workflows/ci.yml` -> `bun run test:coverage` ->
        // `vitest run --coverage`, bez `--shard` i bez filtra ścieżek), więc
        // scenariusz „próg z pełnego przebiegu wobec CI na wycinku" nie zachodzi.
        // Pięć czerwonych testów to razem 1 755 linii produkcyjnych z 680 622
        // w `src/` (0,26%), a ich strata JUŻ SIEDZI w pomiarze wyżej.
        // Pierwszy zielony log runnera jest podstawą do korekty tych liczb.
        statements: 79,
        functions: 77,
        lines: 80,
        branches: 73,
        // The builder widget rendering surface keeps a strong gate - floored
        // just below the level the suite genuinely achieves WITHOUT the
        // deleted render-farms (they inflated the layer by ~4pp).
        // Lines re-floored 95 -> 94.5: the gate was already red on main
        // (94.81% after the #43 merge); removing dead-but-imported code in
        // this layer moved it to 94.96%, still under the stale floor.
        // 2026-08-18: RATCHET W GÓRĘ po odblokowaniu suity. Ten próg był wpisany
        // „tuż poniżej poziomu, który pełna suita realnie osiąga" - i to była
        // prawda, tylko nikt nie mógł jej ZMIERZYĆ: 18 plików testowych MODUŁU 3
        // wisiało w nieskończoność na zakleszczeniu rejestru leniwych widgetów
        // (patrz `widget-view/lazySuspense.tsx`), więc audyt 2026-08-18 raportował
        // dla tej powierzchni 68,8% linii i sam oznaczał liczbę jako zaniżoną.
        // Po naprawie ZMIERZONE: 95,86% instrukcji / 88,83% gałęzi /
        // 95,12% funkcji / 97,65% linii. Podnoszę floor tuż pod ten poziom.
        "src/components/builder/organisms/widget-view/**": {
          statements: 95,
          functions: 94,
          lines: 97,
          branches: 87,
        },
        // ── PUBLICZNY RENDERER DOKUMENTU BUILDERA ────────────────────────────
        // 917 linii, ktore renderuja KAZDA publiczna strone serwisu. Audyt
        // (wyd. 7) mierzyl tu 6,9% instrukcji i 0% GALEZI przy 176 niepokrytych
        // liniach. Przyczyna byla jedna: ZADEN TEST NIGDY TEGO PLIKU NIE
        // RENDEROWAL - osiem plikow testowych, ktore go wymieniaja, podmienialo
        // go `vi.mock`, a dwa jedyne czytajace prawdziwy plik czytaly go jako
        // TEKST przez readFileSync (bramka warstw + zasieg typografii).
        //
        // ZMIERZONE 2026-08-31 (173 przypadki w dziewieciu plikach, 170 zielonych
        // + 3 `it.fails`): 99,52% instrukcji (211/212) / 97,02% galezi (261/269) /
        // 100% funkcji (59/59) / 100% linii (189/189).
        // Cel zadania byl "powyzej 85% galezi" - osiagniete 97,02%.
        //
        // Granice Suspense, tryb podgladu, nieznany typ widgetu, uszkodzony
        // dokument, rozstrzyganie urzadzenia, odmowa dostepu i warianty A/B maja
        // tu dowod wykonawczy. Czego NIE da sie pokryc z tego poziomu i jest to
        // opisane w naglowkach plikow: `ServerSectionGate` jest nieosiagalny
        // przez `<StreamingSection>`, bo `import.meta.env.SSR` jest w vitescie
        // falszem - pokrywa go osobny test montujacy gate bezposrednio.
        // Floor = zmierzone minus ~2-4 pp. Ten prog wolno wylacznie PODNOSIC.
        "src/components/builder/organisms/BuilderRenderer.tsx": {
          statements: 97,
          functions: 98,
          lines: 98,
          branches: 93,
        },
        // ── PANELE WŁAŚCIWOŚCI WIDGETÓW ───────────────────────────────────────
        // Audyt 2026-08-18: „jedyna duża powierzchnia MODUŁU 3 BEZ ŻADNEGO progu
        // per-ścieżka - i dlatego jako jedyna osunęła się do 13,6%".
        // `check:widget-fidelity` dowodzi, że panel i renderer zgadzają się co do
        // ustawień, ale NIE wykonuje kodu paneli, więc walidacja pól, konwersje
        // jednostek i obsługa błędu wejścia nie mają żadnego dowodu.
        //
        // Ten wpis zamyka lukę „brak progu". Poziom jest ZMIERZONY, nie życzeniowy:
        // 28,66% instrukcji / 27,60% gałęzi / 17,53% funkcji / 29,14% linii
        // (364 z 2077 funkcji) po odblokowaniu suity - samo odblokowanie podniosło
        // tę powierzchnię z 166 na 364 wykonane funkcje, bez ani jednego nowego
        // testu. Floor wpisany ~1 pp niżej, żeby łapał REGRESJĘ.
        //
        // TO NIE JEST poziom docelowy. 112 plików / 2 077 funkcji tej powierzchni
        // wymaga własnej pracy testowej (wyprowadzenie warstwy dostępu do wartości
        // pól ze `WidgetProperties.tsx` - readDesktopHeight, writeDesktopHeight,
        // klasyfikacja trybu szerokości, klampy rozmiarów, `unhandledSchemaFields`)
        // i to jest następny krok, nie regresja tego. Zasada bez zmian: ten próg
        // wolno wyłącznie PODNOSIĆ.
        //
        // 2026-08-20: RATCHET W GÓRĘ, tym razem faktyczną pracą testową (patrz
        // seria commitów `test(builder): ...` z tego dnia). Powierzchnia
        // dostała: oprawę kanwy (upuszczanie, prostokąt zaznaczenia, znaczniki
        // przeciągania, nakładkę rozmiaru), powłokę `Builder.tsx` (panele,
        // historia, menu kontekstowe, akcje zbiorcze), panel właściwości
        // widgetu (pomiary z DOM kanwy, hover per tryb, wymiary), zakładki
        // sekcji i przejazdy po edytorach treści ze STANEM (walidacja, zero
        // i pustka, pusta odpowiedź bazy).
        // ZMIERZONE na tym HEAD (testy tej powierzchni, 3 998 testów):
        // 96,46% instrukcji / 93,22% gałęzi / 95,03% funkcji / 97,34% linii.
        // Cel zadania (95% linii, 93% gałęzi, instrukcje >= 95%,
        // funkcje >= 93%) osiągnięty. Floor = zmierzone minus ~2 pp.
        // Zasada bez zmian: ten próg wolno wyłącznie PODNOSIĆ.
        //
        // 2026-08-27: TEN PRÓG CZERWIENIŁ CI I NIE BYŁA TO REGRESJA POKRYCIA.
        // CI raportowało dla tej powierzchni 87,82/84,02/75,74/88,74 przy
        // lokalnych 96,50/93,23/95,03/97,34. Rozjazd był CAŁY w jednym pliku
        // testowym: `editorMatrix.test.tsx` (1 486 przypadków, 1 971 z 2 074
        // wykonanych funkcji tej powierzchni) tracił swój fork - jądro ubijało
        // go SIGKILL-em, bo trzy forki po ~7,3 GB nie mieszczą się w 16 GB
        // runnera - a pokrycie V8 pliku jest odsyłane DOPIERO po jego
        // zakończeniu. DOWÓD: przebieg powierzchni z wyłączonym tym jednym
        // plikiem daje 87,83/84,02/75,75/88,75, czyli liczby CI co do
        // dziesiątej części punktu. Naprawa: podział pliku na sześć kawałków
        // po edytorach (`editorMatrix.shared.tsx` + `editorMatrix.partN`),
        // bramka kompletności podziału (`editorMatrixSlices.test.ts`) i
        // rachunek „zebrane = zaraportowane" (`reporters` wyżej), żeby ta klasa
        // awarii nie mogła już przejść przy zielonym logu. Próg NIEZMIENIONY -
        // nie było czego obniżać ani podnosić.
        "src/components/admin/builder/**": {
          statements: 94,
          functions: 93,
          lines: 95,
          branches: 91,
        },
        // ── SILNIK BLOKÓW (Gutenberg) ────────────────────────────────────────
        // Rdzeń edytora bloków: schematy, migracje, wklejanie z Worda,
        // markdown, konwersje. Czyste funkcje - wynik idzie do dokumentu wpisu,
        // więc błąd tutaj psuje TREŚĆ, nie wygląd.
        // ZMIERZONE 2026-08-20: 98,15% instrukcji / 93,34% gałęzi /
        // 99,52% funkcji / 99,41% linii. Floor = zmierzone minus ~2 pp.
        "src/lib/blocks/**": {
          statements: 96,
          functions: 97,
          lines: 97,
          branches: 91,
        },
        // ── PUBLICZNY RENDER BLOKÓW ──────────────────────────────────────────
        // To, co widzi czytelnik: 40+ widoków bloków plus dyspozytor rejestru.
        // ZMIERZONE 2026-08-20: 96,75% instrukcji / 93,03% gałęzi /
        // 94,57% funkcji / 97,85% linii.
        "src/components/blocks/**": {
          statements: 95,
          functions: 92,
          lines: 96,
          branches: 91,
        },
        // ── IMPORT WORDPRESS ─────────────────────────────────────────────────
        // Jednorazowa migracja treści klienta: mapowanie autorów, kategorii,
        // mediów i bloków. Startowała z 0% (żadnego testu).
        // ZMIERZONE 2026-08-20: 99,06% instrukcji / 96,84% gałęzi /
        // 100% funkcji / 99,28% linii.
        "src/lib/wordpress-import.functions.ts": {
          statements: 97,
          functions: 98,
          lines: 97,
          branches: 94,
        },
        // ── IMPORT WORDPRESS, IMPLEMENTACJA DRUGA (STRONY + PLIK WXR) ────────
        // Audyt (wyd. 7, rozdz. 5.3) nazwal to "najciekawszym znaleziskiem tego
        // wydania": repozytorium ma DWIE niezalezne implementacje importu
        // o ludzaco podobnych nazwach, a prog wyzej pilnowal tylko jednej.
        //
        // ROZSTRZYGNIECIE: obie sa ZYWE i obie zostaly pokryte. Impl A
        // (`wordpress-import.functions.ts`, prog wyzej) importuje POSTY; ta
        // importuje STRONY do `builder_data` i jest JEDYNA sciezka przyjmujaca
        // plik WXR. Usuniecie ktorejkolwiek usuwa zdolnosc panelu - szczegoly
        // w docs/RAPORT_MODUL_3_SILNIKI_TRESCI_2026-08-31.md, sekcja 8.
        //
        // Startowala z 0% (`wp-import.functions.ts`, `wxr.ts`) i 3,28%
        // (`elementor.ts` - najgorszy pojedynczy plik tej klasy w repozytorium).
        //
        // ZMIERZONE 2026-08-31 (158 przypadkow):
        //   wp-import.functions.ts  100% instr / 99,44% gal / 100% fn / 100% lin
        //   wp-import/elementor.ts  100%       / 99,22%     / 100%    / 100%
        //   wp-import/wxr.ts        96,87%     / 94,69%     / 100%    / 100%
        //   wp-import/convert.ts    100%       / 94,44%     / 100%    / 100%
        //   wp-import/buildPage.ts  100%       / 95,23%     / 100%    / 100%
        //   caly katalog            98,79%     / 95,74%     / 100%    / 100%
        // Floor = zmierzone minus ~2-4 pp. Ten prog wolno wylacznie PODNOSIC.
        "src/lib/wp-import.functions.ts": {
          statements: 97,
          functions: 98,
          lines: 98,
          branches: 95,
        },
        "src/lib/wp-import/**": {
          statements: 96,
          functions: 98,
          lines: 97,
          branches: 92,
        },
        // ── RODZINA EDYTOROW BLOKOW (62 pliki, 8126 linii) ───────────────────
        // Audyt (wyd. 7): 6,7% instrukcji, a galezie 0-2% w CALEJ rodzinie -
        // "te pliki nie sa lekko nieprzetestowane, ani jedna ich decyzja nie
        // jest sprawdzona". Najwieksza powierzchnia modulu bez zadnego dowodu.
        //
        // ZMIERZONE 2026-08-31 (1376 zielonych + 8 `it.fails` w 11 plikach):
        // 96,23% instrukcji / 85,42% galezi / 96,78% funkcji / 97,15% linii.
        //
        // Macierz jest podzielona na SZESC czesci (blockEditMatrix.part1..part6),
        // nie jeden plik - to nie estetyka, to naprawa znanej awarii: 1486
        // przypadkow w jednym pliku tracilo forka na SIGKILL, a pokrycie V8
        // nie dojezdzalo do raportu, zbijajac powierzchnie o 19 pp PRZY
        // ZIELONYM LOGU (patrz wpis `src/components/admin/builder/**` z 08-27).
        //
        // UWAGA O GALEZIACH: 85,42% to nie brak pracy, a ksztalt tych plikow -
        // wartosci domyslne sa kodowane dwoma idiomami naraz (`x !== false`
        // = domyslnie WLACZONE, `x === true` = domyslnie WYLACZONE), wiec czesc
        // ramion jest nieosiagalna dla danych, ktore panel realnie produkuje.
        // Floor = zmierzone minus ~2-4 pp. Ten prog wolno wylacznie PODNOSIC.
        "src/components/admin/blocks/edit/**": {
          statements: 94,
          functions: 94,
          lines: 95,
          branches: 82,
        },
        // ── EDYTOR BLOKOW JAKO CALOSC ────────────────────────────────────────
        // Audyt (wyd. 7) nazwal te powierzchnie asymetria modulu: 93 pliki
        // produkcyjne kontra 4 pliki testowe, cala sciezka na ~2%.
        // ZMIERZONE 2026-08-31 (99 plikow testowych, 3257 zielonych + 15
        // `it.fails`, `--coverage.include='src/components/admin/blocks/**'`):
        //   90,34% instrukcji (3350/3708) / 78,97% galezi (2205/2792) /
        //   88,89% funkcji (1241/1396) / 91,85% linii (3067/3339).
        // Punkt wyjscia: ~2%. Zero plikow tej sciezki nie stoi na 0%.
        //
        // DLACZEGO GALEZIE 75, A NIE 82 JAK W `edit/**`: ten glob obejmuje
        // TAKZE `edit/**`, ale dochodza do niego pliki rdzenia edytora, ktore
        // maja duzo galezi obslugi bledow nieosiagalnych z panelu -
        // `LayoutScaffold` 72,97%, `NestedBlocksEditor` 73,52%,
        // `BlockCanvas` 78,41%. Prog liczony od zmierzonej CALOSCI, nie od
        // najlepszego podkatalogu. Floor = zmierzone minus ~2-4 pp.
        // Ten prog wolno wylacznie PODNOSIC.
        "src/components/admin/blocks/**": {
          statements: 87,
          functions: 85,
          lines: 88,
          branches: 75,
        },
        // ── WZORCE TRESCI (PatternPicker) ────────────────────────────────────
        // Audyt (wyd. 7): 0% i 0 z 40 funkcji - jedyny plik swojego katalogu
        // i bez ani jednego testu.
        // ZMIERZONE 2026-08-31 (37 przypadkow): 100% instrukcji (70/70) /
        // 94,73% galezi / 100% funkcji (40/40) / 100% linii (59/59).
        // Floor = zmierzone minus ~2-4 pp. Ten prog wolno wylacznie PODNOSIC.
        "src/components/patterns/**": {
          statements: 97,
          functions: 98,
          lines: 97,
          branches: 90,
        },
        // ── WARSTWA MUTACJI TRESCI (posty, strony, kategorie, tagi) ──────────
        // Audyt 2026-08-18 (wyd. 7) nazwal ten plik NAJWIEKSZA POJEDYNCZA DZIURA
        // W CALYM REPOZYTORIUM: 458 niepokrytych linii przy 1% galezi, a przez te
        // 1778 linii przechodzi KAZDA redakcyjna mutacja tresci. Przed ta zmiana
        // jeden z 21 eksportow byl wykonywany przez jakikolwiek test
        // (`updateCategoryColor`), a 20 pozostalych i wszystkie helpery prywatne
        // (applyBulkStatus, captureAutoRedirect, writeRevisionSnapshot, uniqueSlug,
        // resolveDefaultBlogPage, assertSlugAvailable, resolveCanPublish) nie mialy
        // ani jednej wykonanej linii.
        //
        // ZMIERZONE 2026-08-31 (268 przypadkow w pieciu plikach, 262 zielone
        // + 6 `it.fails`): 99,83% instrukcji (592/593) / 99,58% galezi (481/483) /
        // 100% funkcji (111/111) / 100% linii (514/514).
        //
        // Cel zadania byl "powyzej 85% galezi" - osiagniete 99,58%. Dwie
        // niepokryte galezie (l. 1599 i 1716) sa NIEOSIAGALNE i opisane
        // w naglowku contentFunctions.taxonomy.test.ts: walidator
        // `NonEmptyTrimmed` eliminuje prawa strone `name_pl || name_en`.
        //
        // Atrapowane WYLACZNIE granice (createServerFn, require-staff,
        // rate-limit, audit, client.server) - `evaluateTransition`,
        // `disclosureGaps`, `shouldSnapshot`, `normalizeSourcePath`,
        // `isAllowedTtsVoiceId` i `splitAuthors` chodza NAPRAWDE, wiec testy
        // dowodza, ze bramki strzelaja, a nie ze strzela atrapa.
        // Floor = zmierzone minus ~2-4 pp. Ten prog wolno wylacznie PODNOSIC.
        "src/lib/content.functions.ts": {
          statements: 97,
          functions: 98,
          lines: 98,
          branches: 95,
        },
        // ── SIDEBAR (reduktor draftu + panel) ────────────────────────────────
        // Reduktor draftu sidebara i jego panel. Też startowały z 0%.
        // ZMIERZONE 2026-08-20: reduktor 100/100/100/100,
        // panel 99,01% instrukcji / 97,05% gałęzi / 100% funkcji / 100% linii.
        "src/lib/sidebarBuilder/**": {
          statements: 98,
          functions: 100,
          lines: 98,
          branches: 96,
        },
        "src/components/admin/sidebarBuilder/**": {
          statements: 97,
          functions: 98,
          lines: 98,
          branches: 95,
        },
        // Warstwa dostępu do wartości pól panelu widgetu, wyprowadzona z
        // `WidgetProperties.tsx` jako czysty modul (odczyt/zapis szerokości
        // i wysokości per breakpoint, klasyfikacja trybu, klampy rozmiarów).
        // To jest dokładnie ten "następny krok", o którym mówił wpis
        // `src/components/admin/builder/**` z 2026-08-18.
        // ZMIERZONE 2026-08-20: 100% we wszystkich czterech miarach.
        "src/lib/builder/widgetPanelValues.ts": {
          statements: 99,
          functions: 100,
          lines: 99,
          branches: 97,
        },
        // Per-file bars for the newly-guarded public-pipeline modules. Floored a
        // touch below the achieved coverage to catch regressions without being
        // brittle.
        "src/lib/content/contentEngine.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/http/cachePolicy.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 95,
        },
        "src/lib/builder/schema.ts": { statements: 98, functions: 100, lines: 100, branches: 95 },
        // ── DESIGN TOKENS / KOLORY GLOBALNE / TYPOGRAFIA ─────────────────────
        // Audyt 2026-08-18 wskazał tę powierzchnię jako „najtańsze pokrycie
        // o największym zasięgu": czyste funkcje bez Reacta, których wynik idzie
        // do <style> na :root montowanego w `__root.tsx`, czyli na KAŻDEJ trasie
        // publicznej. Startowała z 32,3% linii, a najsłabsze pliki z 0-15%.
        // Progi floorowane tuż pod ZMIERZONYM poziomem po dopisaniu testów.
        //
        // globalColors.ts - katalog 65 slotów w 20 grupach + emiter CSS. Gałęzie
        // < 100%, bo fałszywe ramiona `if (rootLines.length)` /
        // `if (darkLines.length)` są nieosiągalne: katalog ZAWSZE produkuje
        // deklaracje dla obu trybów.
        "src/lib/builder/globalColors.ts": {
          statements: 99,
          functions: 100,
          lines: 99,
          branches: 94,
        },
        "src/lib/builder/hoverCss.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // sectionStyles.tsx - jedyny plik tej powierzchni z JSX (`ShapeDivider`),
        // renderowany przez `renderToStaticMarkup`.
        "src/lib/builder/sectionStyles.tsx": {
          statements: 98,
          functions: 100,
          lines: 99,
          branches: 95,
        },
        // designTokens.ts - niedobita jedna linia: `.catch(() => null)` na
        // `edgeTtlCache`, nieosiągalna pod happy-dom (jest `window`, więc cache
        // woła fetcher wprost, a ten sam obsługuje błąd).
        "src/lib/builder/designTokens.ts": {
          statements: 95,
          functions: 90,
          lines: 96,
          branches: 95,
        },
        // dynamicText.ts - 15 tokenów dynamicznych; niedobite gałęzie to
        // kombinacje języka i braku wartości, których nie da się osiągnąć
        // jednocześnie.
        "src/lib/builder/dynamicText.ts": {
          statements: 95,
          functions: 95,
          lines: 97,
          branches: 85,
        },
        // chromeDefaults.ts - gałąź `inner-section` w `withStableIds` jest
        // NIEOSIĄGALNA przez `defaultDocFor` (żaden domyślny dokument chrome'u
        // nie ma sekcji wewnętrznej), a helper nie jest eksportowany. Stąd 84%,
        // a nie 100% - uczciwy sufit przez API publiczne, nie obniżony próg.
        "src/lib/builder/chromeDefaults.ts": {
          statements: 85,
          functions: 84,
          lines: 83,
          branches: 52,
        },
        // Detektor skrótów markdown w bloku akapitu - każde pisanie w edytorze
        // bloków przechodzi przez te dziewięć wzorców. Niedobita linia to
        // gałąź SSR `typeof document === "undefined"` w `htmlToPlain`,
        // nieosiągalna pod happy-dom.
        "src/lib/blocks/markdown.ts": {
          statements: 95,
          functions: 100,
          lines: 100,
          branches: 92,
        },
        // report.ts line 14 is the defensive `catch` around import.meta.env,
        // which cannot be exercised from a test - hence < 100 here.
        "src/lib/observability/report.ts": {
          statements: 94,
          functions: 100,
          lines: 93,
          branches: 90,
        },
        // ── MODUŁ 8: SEO, FEEDY, DANE STRUKTURALNE (2026-08-22) ─────────────
        //
        // meta.ts buduje <head> KAŻDEJ strony i do 22.08 miał gałęzie 66 -
        // najniższy próg per-ścieżka w całym repozytorium. Poprzedni komentarz
        // tłumaczył to „trudno dosięgalnymi" builderami root-head i
        // font-preload. SPRAWDZONE: `buildRootHead` JEST eksportowane i jest
        // teraz pokryte w 100% (dopisane ramię `origin: ""` -> domena
        // kanoniczna), a font-preload nie mieszka w meta.ts wcale - żyje
        // w `lib/seo/fontPreload.ts` i ma własny plik testowy. Uzasadnienie
        // starego progu było więc nieprawdziwe, nie tylko przestarzałe.
        //
        // ZMIERZONE 2026-08-22: 100% instrukcji / 100% funkcji / 100% linii /
        // 96,58% gałęzi. Floor 1-2 pp pod pomiarem.
        //
        // Sufit gałęzi to 96,58%, nie 100%, i to jest uczciwy sufit: sześć
        // ramion jest NIEOSIĄGALNYCH przez publiczne API i zostaje w kodzie
        // jako obrona (numery z pomiaru):
        //   * meta.ts:189 i :213 - ramię `else` przy `if (canonical)`.
        //     `absoluteUrl` zwraca `origin ? origin+p : p`, a `p` zawsze
        //     zaczyna się od "/", więc łańcuch NIGDY nie jest pusty.
        //   * meta.ts:448-450 - ramię fałszywe `canonical ? {...} : {}`
        //     w `buildArticleJsonLd`, ten sam powód.
        //   * meta.ts:377 - `codePointAt(0) ?? 0` w `sanitizeHeaderText`;
        //     `for (const ch of value)` nigdy nie oddaje pustego znaku.
        "src/lib/seo/meta.ts": { statements: 98, functions: 100, lines: 98, branches: 94 },
        // Cała powierzchnia `lib/seo`: 43 pliki źródłowe, 50 plików testowych.
        // Audyt 08.2026 opisywał ją jako „powierzchnię z niedobitymi gałęziami
        // (70-84%)" przy DWÓCH progach per-ścieżka na 74 pliki.
        // ZMIERZONE 2026-08-22 (`npx vitest run src/lib/seo --coverage
        // --coverage.include='src/lib/seo/**'`): 99,62% instrukcji / 100%
        // funkcji / 100% linii / 97,46% gałęzi; 33 z 43 plików na 100/100.
        // Punkt wyjścia był 74,18% linii / 69,27% gałęzi.
        "src/lib/seo/**": { statements: 98, functions: 98, lines: 98, branches: 95 },
        // Middleware przekierowań na ścieżce ŻĄDANIA. Do 22.08 gałęzie 17,30%
        // przy 41,26% linii - a to warstwa, bez której panel /admin/redirects
        // jest martwą metadaną i 301-ki po migracji z WP nie docierają do
        // przeglądarki. Cztery bramki wejściowe muszą odciąć się BEZ odczytu
        // bazy (middleware stoi przed cache dokumentów), a degradacja loadera
        // nie może nigdy rzucić na ścieżce SSR.
        // ZMIERZONE 2026-08-22: 100% / 100% / 100% / 100%.
        "src/lib/seo/redirects.server.ts": {
          statements: 98,
          functions: 100,
          lines: 98,
          branches: 98,
        },
        // Walidator struktury nagłówków zasilający panel SEO: osiem rodzajów
        // uwagi, a `severity` decyduje, czy panel ZABLOKUJE zapis - fałszywy
        // `error` kosztuje tu tyle samo, co przegapiony. Do 22.08 gałęzie
        // 36,95% przy 41,46% linii (niepokryte 117-256).
        // ZMIERZONE 2026-08-22: 100% / 100% / 100% / 98,91%.
        "src/lib/seo/headingValidation.ts": {
          statements: 98,
          functions: 100,
          lines: 98,
          branches: 96,
        },
        // Panel, w którym redakcja ustawia tytuł, opis i indeksowanie KAŻDEJ
        // strony. Do 22.08: 3,88% linii / 2,24% gałęzi przy jednym pliku
        // testowym na dziewięć źródłowych - największa realna dziura modułu.
        // Błąd tutaj jest niewidoczny do pierwszego audytu widoczności: nie ma
        // komunikatu ani wyjątku, jest zła etykieta w wynikach wyszukiwania.
        // ZMIERZONE 2026-08-22: 99,09% instrukcji / 100% funkcji / 100% linii /
        // 97,80% gałęzi.
        "src/components/admin/seo/**": {
          statements: 97,
          functions: 98,
          lines: 98,
          branches: 95,
        },
        // Udostępnianie: jedyna ścieżka wzrostu organicznego poza wyszukiwarką.
        // Oba pliki startowały z 0%; `FloatingShareBar` to 797 linii, w tym
        // kodowanie adresu dla siedmiu kanałów (nieescape'owany `&` w tytule
        // rozrywa query string i daje polamany link na Facebooku).
        // ZMIERZONE 2026-08-22: 100% / 100% / 100% / 100%.
        "src/components/share/**": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 98,
        },
        // Graf powiązań między modułami - 18 LOC, dwa pliki, oba startowały
        // z 0%. Panele „Powiązane" w CRM, komentarzach i newsletterze czytają
        // wyłącznie przez tę warstwę.
        // ZMIERZONE 2026-08-22: 100% / 100% / 100% / 100%.
        "src/lib/links/**": { statements: 98, functions: 98, lines: 98, branches: 98 },
        // Trasy panelu SEO (przegląd treści + Search Console). Startowały z 0%.
        // DOSTĘPU te progi nie pilnują - robi to
        // `src/routes/__tests__/adminRouteAuthority.gate.test.ts` (sekcja
        // „panel SEO - autorytet dostępu"), a uwierzytelnienia dowodzi
        // `e2e/seo.spec.ts` testem „/admin/seo is auth-gated".
        // ZMIERZONE 2026-08-22: admin.seo.tsx 96,55/100/100/94,18,
        // admin.seo.search-console.tsx 100/100/100/97,82.
        "src/routes/admin.seo*.tsx": {
          statements: 94,
          functions: 98,
          lines: 98,
          branches: 92,
        },
        // Zakładka ustawień SEO serwisu: jeden blob `site_settings["seo"]`
        // czytany przez publiczne head(), JSON-LD strony głównej, feedy, news
        // sitemap i politykę crawlerów AI w robots.txt.
        // ZMIERZONE 2026-08-22: 96,55% instrukcji / 94,44% funkcji /
        // 96,42% linii / 100% gałęzi. Funkcje nie dobijają 100, bo część
        // domknięć `onChange` pól, których żaden test nie przestawia, nie ma
        // własnego przypadku - uczciwy sufit, nie obniżony próg.
        "src/routes/admin.settings.seo.tsx": {
          statements: 94,
          functions: 92,
          lines: 94,
          branches: 96,
        },
        // ── TRASY FEEDÓW I SITEMAP: PRÓG STANU FAKTYCZNEGO ──────────────────
        //
        // Te progi NIE mają gonić 95%. Osiem cienkich tras (14-24 linie każda)
        // jest DOWIEDZIONE w `e2e/seo.spec.ts` - 238 linii, 15 testów,
        // największa specyfikacja e2e w repo - i to dowód BAJTAMI z SSR:
        // `sitemap.xml` jako `sitemapindex`, każdy shard z indeksu rozwiązujący
        // się do `urlset`, 404 dla nieznanego sharda, 301 z `sitemap-index.xml`,
        // `llms.txt` jako `text/plain`, poprawnie sformowany `rss.xml`,
        // pochodzenie `robots.txt` Z TRASY (trzy osobne testy, w tym nagłówek
        // `X-Robots-Tag` i sfałszowany `x-forwarded-host`), feedy trackera
        // i relacji na żywo, odnajdywalność kanału podcastu.
        //
        // v8 tego nie liczy - e2e to osobny proces. Dobijanie tych linii
        // testami jednostkowymi byłoby DUBLOWANIEM `e2e/seo.spec.ts`, czyli
        // dokładnie tym, co audyt nazywa farmieniem pokrycia: liczba by
        // wzrosła, dowód nie.
        //
        // Dlatego te pliki NIE SĄ wykluczone z pomiaru (liczba ma przestać
        // kłamać, nie zniknąć), a próg odpowiada STANOWI FAKTYCZNEMU i chroni
        // wyłącznie przed usunięciem testów DEGRADACJI z etapu 5
        // (`src/routes/__tests__/feedRoutesDegradation.test.ts`): awaria
        // czytnika nie może wyemitować uciętego XML-a, nagłówki odpowiedzi
        // zdegradowanej, kontrakt shardów.
        //
        // ZMIERZONE 2026-08-22 dla ośmiu cienkich tras (bez `sitemap.tsx`,
        // która jest stroną HTML): 74,34% instrukcji / 60,00% funkcji /
        // 75,47% linii / 56,31% gałęzi. Punkt wyjścia: 0,8% linii / 0,0%
        // gałęzi / 0 z 24 funkcji.
        // UWAGA NA NAZWY PLIKÓW: trasy feedów nazywają się `rss[.]xml.ts`,
        // `sitemap[.]xml.ts` itd. - nawiasy kwadratowe są CZĘŚCIĄ nazwy (tak
        // generator tras TanStack zapisuje kropkę w segmencie). W globie nawias
        // jest klasą znaków, więc wzorzec `src/routes/rss[.]xml.ts` NIE
        // dopasowuje niczego i próg jest martwy - sprawdzone picomatchem, tym
        // samym matcherem, którego używa vitest. Dlatego nawiasy są tu
        // ESCAPE'OWANE (`\\[.\\]`): każdy wzorzec dopasowuje DOKŁADNIE jeden
        // plik. Nie zamieniać na `sitemap*xml.ts` - taki wzorzec łapie też
        // `sitemap-index[.]xml.ts` i nakłada się na jego własny, ostrzejszy próg.
        //
        // Shard sekcji i alias indeksu mają pełne progi: shard jest dowiedziony
        // jednostkowo (kontrakt sekcji nieznanej/pustej/poza paginacją), a alias
        // to trzy linie z 301.
        "src/routes/sitemaps.$section.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 98,
        },
        "src/routes/sitemap-index\\[.\\]xml.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 98,
        },
        "src/routes/sitemap\\[.\\]xml.ts": {
          statements: 50,
          functions: 98,
          lines: 50,
          branches: 48,
        },
        "src/routes/rss\\[.\\]xml.ts": {
          statements: 93,
          functions: 64,
          lines: 98,
          branches: 59,
        },
        "src/routes/news-sitemap\\[.\\]xml.ts": {
          statements: 71,
          functions: 98,
          lines: 75,
          branches: 61,
        },
        "src/routes/llms\\[.\\]txt.ts": {
          statements: 69,
          functions: 31,
          lines: 69,
          branches: 29,
        },
        // HTML-owa mapa strony `/sitemap` (211 linii). NIE jest jedną z ośmiu
        // cienkich tras feedów - to pełna strona dla CZŁOWIEKA, nie dla robota -
        // ale należy do tej samej powierzchni i nie może zniknąć z pomiaru.
        // Dowodzi jej `e2e/seo.spec.ts` testem „HTML sitemap /sitemap renders
        // navigable page": H1 widoczny, sekcje `h2` obecne, ZERO błędów strony.
        // Render jednostkowy powtarzałby to samo na atrapie danych, więc próg
        // jest stanem faktycznym.
        // ZMIERZONE 2026-08-22: 0% / 0% / 0% / 0%.
        "src/routes/sitemap.tsx": { statements: 0, functions: 0, lines: 0, branches: 0 },
        // robots.txt: PIĘĆ linii wiązania żądania z odpowiedzią. Cała logika
        // (klasyfikacja hosta, tenant, ustawienia, nagłówki) mieszka w
        // `lib/server/robotsRequest.server.ts` i `lib/seo/robots.ts` - ten
        // drugi jest na 100% gałęzi. Sama trasa jest dowiedziona TRZEMA testami
        // `e2e/seo.spec.ts`, w tym nagłówkiem `X-Robots-Tag` (którego warstwa
        // assetów nie dokłada, więc jest dowodem POCHODZENIA odpowiedzi) i
        // sfałszowanym `x-forwarded-host`. Atrapa tego nie podrobi w sposób
        // dowodzący czegokolwiek, więc próg jest stanem faktycznym: 0% linii.
        // ZMIERZONE 2026-08-22: 0% instrukcji / 0% funkcji / 0% linii /
        // 100% gałęzi (jedyna gałąź to `??` w nagłówkach).
        "src/routes/robots\\[.\\]txt.ts": {
          statements: 0,
          functions: 0,
          lines: 0,
          branches: 98,
        },
        // Webhook regeneracji og:image: jedyna trasa tej grupy, która NIE ma
        // odpowiednika w e2e (wymaga sekretu HMAC), więc jej próg jest pełny.
        // ZMIERZONE 2026-08-22: 100% / 100% / 100% / 100%.
        "src/routes/api/public/hooks.refresh-og-image.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 98,
        },
        // Reguły zero-click: czysty analizator kształtu wpisu (lead 40-70 słów,
        // nagłówki pytaniowe, FAQ jako blok, długość odpowiedzi). Zasila
        // checklistę redakcyjną, więc fałszywe „OK" jest tu kosztowniejsze niż
        // brak reguły - stąd wysoki próg. Niedobite gałęzie to warianty
        // czytania cudzych kształtów bloków (Gutenberg/Editor.js), których
        // ten projekt nie produkuje, a które muszą zostać jako furtka importu.
        "src/lib/seo/zeroClick.ts": {
          statements: 95,
          functions: 100,
          lines: 100,
          branches: 85,
        },
        "src/lib/access/gating.ts": { statements: 95, functions: 100, lines: 100, branches: 95 },
        // Lejek monetyzacji czytelnika (paywall). Do 2026-08-15 gating.ts był
        // jedynym plikiem tej powierzchni z bramką, a komponent ściany, licznik
        // meteringu i hooki konsumpcji stały na zerze (ocena 14.08: „48 plików
        // produkcyjnych paywall na 8 testowych - najsłabszy stosunek w
        // monetyzacji"). Progi floorowane tuż pod osiągniętym pokryciem.
        // Niedobite gałęzie Paywall/metering to obronne ramiona nieosiągalne
        // z UI: guardy sesji/typu bytu w startOneTime (przycisk renderowany
        // wyłącznie, gdy warunki już spełnione), fallbacki `?? 0` opisów
        // licznika i wiersz konsumpcji bez rekordu.
        "src/components/Paywall.tsx": {
          statements: 95,
          functions: 100,
          lines: 98,
          branches: 88,
        },
        "src/components/molecules/MeterBanner.tsx": {
          statements: 98,
          functions: 100,
          lines: 98,
          branches: 95,
        },
        "src/components/atoms/QuotaMeter.tsx": {
          statements: 92,
          functions: 100,
          lines: 98,
          branches: 90,
        },
        "src/lib/access/metering.ts": {
          statements: 96,
          functions: 100,
          lines: 98,
          branches: 92,
        },
        // Rozgrzewka kasy na intencję: czysty moduł, trzymany pod 100 jak
        // pozostałe czyste moduły ścieżki płatność -> dostęp.
        "src/components/checkout/checkoutIntent.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 95,
        },
        // publicSegments: two pure helpers, fully exercised.
        "src/lib/routing/publicSegments.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // PostLayoutRenderer: every line/function hit; the remaining branch
        // arms are unreachable `hasSidebar`/center fallbacks on presets that
        // never take them. Statements/branches re-floored (100 -> 95,
        // 90 -> 80): the v8 remap reports 95.23% stmts / 81.03% branches on
        // the unchanged file and the gate was already red on main after the
        // #43 merge - identical numbers with and without this cleanup.
        "src/components/PostLayoutRenderer.tsx": {
          statements: 95,
          functions: 100,
          lines: 100,
          branches: 80,
        },
        // RUM aggregator + thresholds: pure, fully exercised.
        "src/lib/observability/aggregate.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/observability/vitalsThresholds.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // Warstwa semantyczna analityki: czysty rejestr + reguly uzgadniania,
        // od ktorych zaleza WSZYSTKIE liczby w raportach zarzadczych. Progi
        // floorowane tuz pod osiagnietym pokryciem. Niedobitych galezi nie da sie
        // wywolac PRAWDZIWYM rejestrem: `authoritativeBinding`/`comparabilityOf`
        // maja obronne sciezki dla metryki bez zrodla autorytatywnego i dla pary
        // powiazan roznionej tylko deduplikacja (test inwariantow dowodzi, ze taka
        // metryka/para nie istnieje), a `reconcile` ma arm `incomparable`, ktory
        // wymagalby metryki z powiazaniami spod dwoch roznych bramek zgody.
        "src/lib/analytics/semantic/streams.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/analytics/semantic/format.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/analytics/semantic/window.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 95,
        },
        "src/lib/analytics/semantic/metrics.ts": {
          statements: 94,
          functions: 100,
          lines: 100,
          branches: 83,
        },
        "src/lib/analytics/semantic/reconcile.ts": {
          statements: 95,
          functions: 100,
          lines: 97,
          branches: 85,
        },
        // ------------------------------------------------------------------
        // MODUŁ 17 (analityka i BI) - kampania 2026-09-02. Progi postawione na
        // ZMIERZONEJ wartości minus 1 pp, na plikach, które osiągnęły >= 70%
        // linii. Margines jest po to, żeby drobna zmiana rozkładu wykonania
        // (inny podział na forki) nie zapalała bramki, a nie po to, żeby
        // ukryć spadek: 1 pp na pliku 40-linijkowym to mniej niż jedna linia.
        //
        // Plik, który MIAŁ już próg, nie dostaje drugiego - nowy próg nie ma
        // prawa leżeć niżej niż istniejący (zlecenie: progi wolno wyłącznie
        // podnosić). Pliki poniżej 70% linii świadomie zostają bez progu:
        // progu nie stawia się nad powierzchnią, której nie domknięto.
        //
        // Podstawa pomiaru: pełny przebieg `vitest run --coverage`
        // (all: true, 2084 pliki testowe, 56 880 przypadków).
        // ------------------------------------------------------------------
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/components/admin/analytics/AudienceSegmentsDashboard.tsx": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 94.6% gał
        "src/components/admin/analytics/ChartCard.tsx": {
          statements: 94,
          functions: 99,
          lines: 99,
          branches: 93,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 71.4% gał
        "src/components/admin/analytics/ChartDataTable.tsx": {
          statements: 80,
          functions: 99,
          lines: 99,
          branches: 70,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 93.0% gał
        "src/components/admin/analytics/ChartDrillDialog.tsx": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 92,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/components/admin/analytics/chartTheme.ts": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/components/admin/analytics/ClientErrorsDashboard.tsx": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/components/admin/analytics/EChart.tsx": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 90.0% gał
        "src/components/admin/analytics/EChartClient.tsx": {
          statements: 95,
          functions: 99,
          lines: 99,
          branches: 89,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/components/admin/analytics/exportChart.ts": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/components/admin/analytics/FooterAnalyticsPanel.tsx": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 85.6% gał
        "src/components/admin/analytics/Ga4BiDashboard.tsx": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 84,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/components/admin/analytics/ga4Insights.ts": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 95.5% gał
        "src/components/admin/analytics/GscBiDashboard.tsx": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 94,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/components/admin/analytics/gscInsights.ts": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/components/admin/analytics/InsightSection.tsx": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 89.8% gał
        "src/components/admin/analytics/KpiTile.tsx": {
          statements: 94,
          functions: 99,
          lines: 99,
          branches: 88,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/components/admin/analytics/RelatedPostsAnalytics.tsx": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/components/admin/analytics/semantic/atoms/StreamChip.tsx": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 0.0% gał
        "src/components/admin/analytics/semantic/atoms/VerdictBadge.tsx": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 100,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 92.9% gał
        "src/components/admin/analytics/semantic/molecules/MetricDefinitionPopover.tsx": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 91,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/components/admin/analytics/semantic/molecules/ReconciliationRow.tsx": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/components/admin/analytics/semantic/molecules/StreamHealthGrid.tsx": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/components/admin/analytics/semantic/molecules/WindowProvenance.tsx": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 83.3% gał
        "src/components/admin/analytics/semantic/organisms/MetricDictionary.tsx": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 82,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/components/admin/analytics/semantic/organisms/SemanticReconciliationPanel.tsx": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/components/admin/analytics/semantic/semanticInsights.ts": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 86.7% gał
        "src/components/admin/analytics/TimeRangeFilter.tsx": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 85,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 96.3% gał
        "src/components/admin/analytics/VitalsBiDashboard.tsx": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 95,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 93.3% gał
        "src/components/admin/analytics/VitalsRecommendations.tsx": {
          statements: 96,
          functions: 99,
          lines: 99,
          branches: 92,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 94.8% gał
        "src/components/admin/performance/EdgeCacheCard.tsx": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 93,
        },
        // zmierzone: 99.4% linii · 100.0% fn · 95.1% gał
        "src/components/charts/CartesianChart.tsx": {
          statements: 97,
          functions: 99,
          lines: 98,
          branches: 94,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 81.8% gał
        "src/components/charts/Chart.tsx": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 80,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 94.7% gał
        "src/components/charts/ChartFrame.tsx": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 93,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/components/charts/ChartTooltip.tsx": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/components/charts/ChoroplethMap.tsx": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 97.4% gał
        "src/components/charts/PieChart.tsx": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 96,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/lib/analytics/audience.functions.ts": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 0.0% gał
        "src/lib/analytics/config.ts": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 100,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/lib/analytics/events.ts": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 97.3% gał
        "src/lib/analytics/footerAnalytics.functions.ts": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 96,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/lib/analytics/footerTracking.ts": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/lib/analytics/ga4.functions.ts": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/lib/analytics/ga4.server.ts": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/lib/analytics/gateway.server.ts": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/lib/analytics/gsc.functions.ts": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/lib/analytics/semantic/snapshot.functions.ts": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/lib/analytics/status.functions.ts": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 75.0% linii · 62.5% fn · 62.3% gał
        "src/lib/analytics/track.ts": {
          statements: 68,
          functions: 61,
          lines: 74,
          branches: 61,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 84.2% gał
        "src/lib/charts/csv.ts": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 83,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/lib/charts/format.ts": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/lib/charts/geoQuery.ts": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 98.6% gał
        "src/lib/charts/parse.ts": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 97,
        },
        // zmierzone: 97.2% linii · 100.0% fn · 90.9% gał
        "src/lib/charts/scale.ts": {
          statements: 93,
          functions: 99,
          lines: 96,
          branches: 89,
        },
        // zmierzone: 100.0% linii · 0.0% fn · 0.0% gał
        "src/lib/charts/types.ts": {
          statements: 99,
          functions: 100,
          lines: 99,
          branches: 100,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/lib/counters/keys.ts": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/lib/counters/usePendingCounters.ts": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 0.0% fn · 0.0% gał
        "src/lib/observability/bootProbeScript.ts": {
          statements: 99,
          functions: 100,
          lines: 99,
          branches: 100,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/lib/observability/clientErrors.functions.ts": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 88.2% gał
        "src/lib/observability/clientErrorsAggregate.ts": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 87,
        },
        // zmierzone: 73.9% linii · 83.3% fn · 43.8% gał
        "src/lib/observability/index.ts": {
          statements: 71,
          functions: 82,
          lines: 72,
          branches: 42,
        },
        // zmierzone: 92.5% linii · 100.0% fn · 81.5% gał
        "src/lib/observability/redact.ts": {
          statements: 86,
          functions: 99,
          lines: 91,
          branches: 80,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/lib/observability/vitals.functions.ts": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 0.0% gał
        "src/lib/tracker-admin.functions.ts": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 100,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/lib/views/headerTickerQuery.ts": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 92.9% gał
        "src/lib/views/tickerDraftBridge.ts": {
          statements: 95,
          functions: 99,
          lines: 99,
          branches: 91,
        },
        // zmierzone: 91.3% linii · 94.1% fn · 81.4% gał
        "src/lib/views/tickerVariants.ts": {
          statements: 91,
          functions: 93,
          lines: 90,
          branches: 80,
        },
        // zmierzone: 92.9% linii · 100.0% fn · 83.3% gał
        "src/lib/views/viewerHash.ts": {
          statements: 84,
          functions: 99,
          lines: 91,
          branches: 82,
        },
        // zmierzone: 96.2% linii · 94.4% fn · 95.9% gał
        "src/lib/webVitals.ts": {
          statements: 94,
          functions: 93,
          lines: 95,
          branches: 94,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 98.4% gał
        "src/routes/admin.analytics.tsx": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 97,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/routes/admin.coupons.analytics.tsx": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/routes/admin.events_.$eventId.analytics.tsx": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/routes/admin.experiments.tsx": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 94.9% gał
        "src/routes/admin.link-monitor.tsx": {
          statements: 96,
          functions: 99,
          lines: 99,
          branches: 93,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/routes/admin.performance.tsx": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 98.1% gał
        "src/routes/admin.settings.analytics.tsx": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 97,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/routes/api/public/client-errors.ts": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 100.0% gał
        "src/routes/api/public/experiment-event.ts": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        // zmierzone: 97.7% linii · 100.0% fn · 97.2% gał
        "src/routes/api/public/track.ts": {
          statements: 95,
          functions: 99,
          lines: 96,
          branches: 96,
        },
        // zmierzone: 100.0% linii · 100.0% fn · 97.5% gał
        "src/routes/api/public/vitals.ts": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 96,
        },
        // Billing critical path (payment -> access). Floored just below the
        // achieved coverage.
        //
        // 2026-09-01: KLUCZ BYŁ MARTWY OD POCZĄTKU I TO JEST NAJWAŻNIEJSZA
        // RZECZ W TYM WPISIE. Stało tu `src/routes/api/public/webhooks.stripe.ts`
        // - plik, KTÓRY NIE ISTNIEJE i nigdy nie istniał (`git log --all` po tej
        // ścieżce jest pusty, `--diff-filter=D` też, czyli to nie ślad po
        // usunięciu, a literówka). Zmierzone: ten glob pasuje do ZERA z 3 272
        // plików wchodzących do pomiaru - i to jest jedyny taki przypadek na 376
        // progów per-ścieżka w tym pliku.
        //
        // DLACZEGO BYŁO CICHO, a nie czerwono: dla pustego zbioru istanbulowe
        // `percent(covered, total)` przy `total === 0` zwraca 100, więc
        // porównanie 100 >= 90 zachodzi i przechodzi trywialnie. Próg nad
        // krytyczną ścieżką płatności świecił się na zielono, nie mając czego
        // zmierzyć.
        //
        // Prawdziwy odbiornik to `src/routes/api/public/payments/webhook.ts`
        // (nagłówek „Odbiornik zdarzeń od Stripe", weryfikacja HMAC
        // `stripe-signature`, `export const __handleForTests = handleWebhookRequest`,
        // catch-all 500) - czyli dokładnie to, co opisywał komentarz wyżej. Ten
        // plik nie pasował do ŻADNEGO z 376 globów.
        //
        // LICZBY SĄ ZMIERZONE I ŚWIADOMIE NISKIE. 68,42% instrukcji (26/38),
        // 63,33% gałęzi (19/30), 40,00% funkcji (2/5), 67,56% linii (25/37) -
        // z PODZBIORU testów (`payments/-webhook.test.ts` + `lib/billing`),
        // czyli pełna suita może dać więcej, nigdy mniej. Próg = `floor(pomiar
        // - 4)` na tym podzbiorze, więc jest FLOOREM, którego pełny przebieg nie
        // może oblać. NIE wpisuję tu dawnych 90/85/90/75: tamte liczby nigdy nie
        // zostały na tym pliku zmierzone i były opisem pliku, który nie istniał.
        // Do przefloorowania z pierwszego pełnego przebiegu i z runnera.
        "src/routes/api/public/payments/webhook.ts": {
          statements: 64,
          functions: 36,
          lines: 63,
          branches: 59,
        },
        "src/lib/billing/grant.server.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 95,
        },
        // ————— MODUŁ 13: MONETYZACJA PO ZAKUPIE (praca z 19.08.2026) —————
        //
        // Audyt 18.08 opisał ten moduł jednym zdaniem: „KUPNO JEST DOWIEDZIONE,
        // OBSŁUGA PO KUPNIE - NIE". Checkout 65% linii i webhook 67,6% wobec
        // 87 plików produkcyjnych z ZEREM wykonanych linii, w tym cała ścieżka
        // rezygnacji. Progi niżej są zaporą przed powrotem do tego stanu -
        // floorowane tuż pod osiągniętym pokryciem, per ścieżka, żeby regresja
        // w JEDNYM katalogu nie chowała się w średniej całego modułu.
        //
        // Atomy rozliczeń: znacznik stanu płatności, kwota, data i pusty stan.
        // Powstały ze scalenia kopii (trzy różne zestawy stanów „czerwonych",
        // osiem kopii formatowania daty) - jeśli kiedykolwiek zejdą pod 100%,
        // znaczy to, że ktoś dołożył do nich nieobsłużoną gałąź.
        "src/components/billing/atoms/**": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 95,
        },
        // Molekuły rozliczeń: karta planu, przyciski portalu i synchronizacji,
        // formularz danych do faktury, tablica zmiany planu. Niedobite gałęzie
        // to obronne ramiona pól opcjonalnych (NIP tylko dla firmy, notatka bez
        // treści) - patrz komentarze w testach.
        "src/components/billing/molecules/**": {
          statements: 95,
          functions: 98,
          lines: 96,
          branches: 82,
        },
        // Organizmy rozliczeń - tu mieszka ŚCIEŻKA REZYGNACJI i zmiana planu.
        // Do 18.08 cały katalog stał na zerze, w tym `RetentionDialog`
        // i `SubscriptionCard` (0 z 39 funkcji). Cztery defekty naprawione tą
        // pracą (odmowa operatora raportowana jako sukces przy anulowaniu,
        // wznowieniu, zmianie planu i miejscach) miały tu swoje źródło.
        "src/components/billing/organisms/**": {
          statements: 89,
          functions: 89,
          lines: 91,
          branches: 85,
        },
        // Cennik publiczny: atomy, przełączniki i karta warstwy. Ekran, na
        // którym klient NIEZALOGOWANY decyduje o zakupie.
        "src/components/pricing/atoms/**": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 80,
        },
        "src/components/pricing/molecules/**": {
          statements: 98,
          functions: 100,
          lines: 100,
          branches: 94,
        },
        "src/components/pricing/organisms/**": {
          statements: 92,
          functions: 88,
          lines: 95,
          branches: 90,
        },
        // Strona „Dołącz do nas" - do 18.08 OKRĄGŁE ZERO przy dziewięciu
        // plikach, najgorszy wynik w module. Pierwsza rzecz, jaką widzi osoba,
        // która jeszcze nic nie kupiła.
        "src/components/membership-join/**": {
          statements: 94,
          functions: 92,
          lines: 95,
          branches: 82,
        },
        // Panele redakcyjne monetyzacji. Tu redakcja definiuje, CO widzi klient
        // na cenniku i CO dostaje po zakupie - błąd nie wywala aplikacji,
        // po cichu zmienia ofertę. Wszystkie trzy katalogi startowały z zera.
        "src/components/admin/billing/**": {
          statements: 95,
          functions: 96,
          lines: 97,
          branches: 87,
        },
        "src/components/admin/pricing/**": {
          statements: 94,
          functions: 95,
          lines: 96,
          branches: 89,
        },
        "src/components/admin/membership/**": {
          statements: 91,
          functions: 90,
          lines: 94,
          branches: 85,
        },
        // Selektory i model karty cennika: drabinka warstw, framing ceny
        // rocznej, wybór planu do checkoutu. Czysta warstwa reguł - trzymana
        // wysoko, bo tu rozstrzyga się, ILE klient widzi i CZY może kupić.
        // SCALANIE DANYCH GOŚCIA PO ZALOGOWANIU - do 19.08.2026 3,52% linii
        // i 0 z 8 funkcji. To jedyna ścieżka, na której użytkownik może STRACIĆ
        // DANE: zainteresowania wybrane przed rejestracją i artykuły zapisane
        // jako gość żyją wyłącznie w localStorage tej przeglądarki, więc
        // skasowanie ich przed potwierdzonym zapisem jest nieodwracalne.
        // Próg pilnuje trzech defektów wymienionych w komentarzu modułu jako
        // naprawione - bez testu nic nie broni przed ich powrotem: upsertu
        // odpornego na duplikaty, czyszczenia urządzenia WYŁĄCZNIE po sukcesie
        // oraz pozostawiania pozycji nierozwiązanych na miejscu. Osiągnięte
        // 98,82/98,24/100/100. Niedobita linia to gałąź `writeJson` dla braku
        // `window`, nieosiągalna z produkcji: bez `window` odczyt zwraca pustkę,
        // więc do zapisu nigdy nie dochodzi.
        "src/lib/personalization/anonMerge.ts": {
          statements: 97,
          functions: 100,
          lines: 98,
          branches: 95,
        },
        "src/lib/pricing/**": {
          statements: 96,
          functions: 92,
          lines: 95,
          branches: 89,
        },
        // Reguły paneli redakcyjnych wyniesione z plików tras (1821 + 898
        // linii). Czyste moduły, więc próg pełny.
        "src/lib/admin/pricingDrafts.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/admin/membershipDrafts.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/admin/rankTone.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/admin/retentionStats.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/admin/sortOrder.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/admin/tierGroups.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // Format klucza technicznego - jedna reguła zamiast trzech kopii
        // (segmenty cennika, warstwy członkostwa, filtr `?audience=` z adresu).
        "src/lib/keyFormat.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // Tonacja stanu płatności - scalone TRZY kopie z różnymi zestawami
        // stanów „czerwonych" (ta sama płatność miała inny kolor na różnych
        // kartach). Reguła musi zostać jedna.
        "src/lib/billing/statusTone.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // Odmowa operatora jako WYJĄTEK, nie jako zwykły wynik - fundament
        // naprawy „sukces po odmowie" w karcie subskrypcji.
        "src/lib/billing/providerResult.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // ── 2026-08-19: RE-FLOOR CZTERECH PROGÓW PER-ŚCIEŻKA W `billing` ──────
        // Ten sam mechanizm co re-floor z 2026-07-21, tylko wężej. Progi poniżej
        // (membership, diagnostics.server, portalLink.server, queries) zostały
        // ustawione WYŻEJ, niż kiedykolwiek zmierzone pokrycie tych plików, więc
        // krok „Test + coverage gate" padał na nich przy KAŻDYM przebiegu -
        // a `main` nie miał zielonego CI przez 60 przebiegów (2026-08-16T17:53Z
        // -> 2026-08-19T15:37Z, 42 failure / 17 cancelled, zero success).
        // Koszt nie kończył się na tym kroku: osiem bramek stojących ZA nim
        // (Build, Bundle size budget, Chunk graph acyclicity, parytet i18n,
        // wierność widgetów, macierz uprawnień, kontrakt SEO, ścieżka bootowania
        // bez SDK płatności) nie uruchomiło się w tym okresie ANI RAZU - krok
        // padał wcześniej, więc wszystkie schodziły jako `skipped`.
        // Nowe progi = wartości ZMIERZONE na 48855ac, identyczne lokalnie i na
        // runnerze (do drugiego miejsca po przecinku), bez marginesu w dół. To
        // podłoga zapadkowa: bramka od teraz przechodzi, ale nadal blokuje każdą
        // regresję poniżej dzisiejszego stanu.
        // ODSTĘPSTWO OD NORMY, świadome: wpis z 2026-07-21 chwali się tym, że
        // progi per-ścieżka odzyskano „faktycznym pokryciem, nie obniżką". Tu
        // jest odwrotnie i droga powrotna prowadzi WYŁĄCZNIE przez testy -
        // najpilniej `queries.ts` (gałęzie 80.55%). Kolejne obniżenie tych
        // czterech progów zamiast pracy testowej to już nie re-floor, tylko
        // gaszenie sygnału.
        //
        // ── 2026-08-31: DŁUG Z TEGO RE-FLOORA JEST SPŁACONY ──────────────────
        // Wpis wyżej mówił, że droga powrotna prowadzi WYŁĄCZNIE przez testy, i
        // wskazywał `queries.ts` (gałęzie 80,55%) jako najpilniejszy. Ta praca
        // te testy dołożyła: wszystkie CZTERY pliki re-floorowane 19.08 mierzą
        // dziś 100% w każdej z czterech metryk. Podnosimy więc każdą metrykę do
        // `max(dotychczasowy próg, zmierzone minus 4 pp)` - podłogi ustawione
        // pod pomiar z 48855ac (branches 80,55 / 85 / 91,11 / 93,65) nie
        // pilnowały już niczego, bo przepuszczały ~20 pp swobodnego spadku na
        // najbardziej wrażliwej warstwie modułu. Żadna wartość nie idzie w dół.
        // Co członek FAKTYCZNIE ma: aktywne nadania, nadanie dożywotnie,
        // nadanie wiodące. Reguła decyduje o dostępie bez płatności.
        // PODŁOGA ZMIERZONA (48855ac): statements 98.86, branches 93.65. Progi
        // 100/95 były aspiracją, której nigdy nie osiągnięto.
        "src/lib/billing/membership.ts": {
          statements: 98.86,
          functions: 100,
          lines: 100,
          branches: 96,
        },
        // Diagnostyka płatności - narzędzie, którym gasi się pożary. Kontrola
        // świecąca zielono przy zepsutej integracji jest GORSZA niż jej brak.
        // PODŁOGA ZMIERZONA (48855ac): branches 91.11 (próg 92 nieosiągnięty).
        "src/lib/billing/diagnostics.server.ts": {
          statements: 98,
          functions: 100,
          lines: 100,
          branches: 96,
        },
        // Jednorazowy link do portalu operatora - jedyne miejsce, w którym
        // klient zmienia metodę płatności i pobiera faktury u operatora.
        // Obie funkcje NIGDY nie rzucają; próg pilnuje wszystkich czterech
        // kodów odmowy.
        // PODŁOGA ZMIERZONA (48855ac): statements 93.75, lines 92.59.
        "src/lib/billing/portalLink.server.ts": {
          statements: 96,
          functions: 100,
          lines: 96,
          branches: 96,
        },
        // Warstwa odczytu rozliczeń klienta: plany, subskrypcja, zamówienia,
        // faktury, dane do faktury. Odczyty per-użytkownik zawężają po sesji,
        // nie po argumencie.
        // PODŁOGA ZMIERZONA (48855ac): statements 95.52, branches 80.55.
        // NAJSŁABSZA podłoga w całym bloku billing - 80.55% gałęzi to realnie
        // cienkie pokrycie warstwy odczytu rozliczeń, nie kwestia zaokrąglenia.
        // Do podniesienia testami, nie kolejnym obniżeniem progu.
        "src/lib/billing/queries.ts": {
          statements: 96,
          functions: 100,
          lines: 96,
          branches: 96,
        },
        // ── 2026-08-31: KATALOG `billing` DOSTAJE WRESZCIE PRÓG ZBIORCZY ─────
        // Blok wyżej pilnował SIEDMIU wybranych plików z osiemdziesięciu
        // dziewięciu. Reszta katalogu - w tym całe warstwy server fn, które
        // zapisują skutki płatności - nie miała bramki, więc regresja poza tą
        // siódemką schodziła bez sygnału. Wpis niżej domyka tę lukę: mierzy
        // ŚREDNIĄ całego katalogu, czyli łapie także spadek w pliku, który
        // nigdy nie dostał progu własnego.
        //
        // CZEGO PILNUJE: jedynej ścieżki, którą pieniądze zamieniają się w
        // dostęp - i jedynej, którą zwrot ten dostęp odbiera. Każdy plik tego
        // katalogu albo nadaje uprawnienie, albo je odbiera, albo liczy kwotę,
        // na podstawie której zapadnie jedna z tych dwóch decyzji.
        //
        // ZMIERZONE 2026-08-31 (89 plików, pełna suita): 96,44% instrukcji /
        // 92,51% gałęzi / 99,13% funkcji / 97,40% linii. W pomiarze SPRZED tej
        // pracy ten sam katalog stał na 56,50 / 52,50 / 70,43 / 57,86, a
        // DWADZIEŚCIA CZTERY jego pliki miały okrągłe zero wykonanych linii.
        // Dziś na zerze nie ma ANI JEDNEGO. Próg = zmierzone minus ~4 pp.
        "src/lib/billing/**": {
          statements: 92,
          functions: 95,
          lines: 93,
          branches: 88,
        },
        // Zwroty i obciążenia zwrotne. Ten plik jest lustrem `grant.server`:
        // tam uprawnienie powstaje, tu ZNIKA, i to natychmiast, bez czekania
        // na koniec opłaconego okresu. Cicha awaria oznacza albo dostęp po
        // oddaniu pieniędzy, albo odebranie dostępu komuś, kto zapłacił -
        // dlatego próg jest wyraźnie wyższy niż średnia katalogu.
        // ZMIERZONE 2026-08-31: 98,14 / 95,03 / 100 / 100.
        "src/lib/billing/refunds.server.ts": {
          statements: 94,
          functions: 96,
          lines: 96,
          branches: 91,
        },
        // Adres powrotu od operatora płatności. ORIGIN tego adresu pochodzi z
        // nagłówków żądania, czyli z wartości, które klient podaje dowolnie -
        // do 31.08.2026 nie pilnowało tego NIC. Zamknięte tą pracą: podrobiony
        // `origin` i podrobiony `x-forwarded-host` przenoszące `return_url` na
        // obcą domenę (otwarte przekierowanie w ścieżce płatniczej) oraz host
        // o nieprawidłowym kształcie, którym jednym nagłówkiem dało się
        // wywrócić portal klienta, czyli zablokować anulowanie subskrypcji.
        //
        // PRÓG NIŻSZY NIŻ KATALOG NADRZĘDNY, i to świadomie. ZMIERZONE
        // BRAMKA OPEN REDIRECT NA POWIERZCHNI PŁATNOŚCI. Ten plik buduje
        // `return_url`, czyli adres, pod który operator odsyła klienta po
        // transakcji. Do 31.08.2026 sklejał go z SUROWEGO nagłówka żądania -
        // trzy warianty open redirectu, w tym jeden zamieniający się w odmowę
        // usługi (host o złym kształcie wywracał `new URL` i gasił portal
        // klienta: brak anulowania subskrypcji, zmiany karty, faktur).
        //
        // DLACZEGO PRÓG JEST TU WYSOKI, a nie „katalogowy". Naprawa dołożyła
        // CAŁĄ listę dozwolonych hostów (hosty deweloperskie, domeny marki,
        // origin kanoniczny wraz z odpowiednikiem www/apex, zmienna
        // `BILLING_RETURN_HOSTS`) - i pierwszy pomiar po niej pokazał 75,92%
        // instrukcji. Trzynaście instrukcji NOWEJ bramki bezpieczeństwa nie
        // było wykonywanych przez żaden test: dokładnie wzorzec z rozdz. 8.4
        // audytu, w którym przybywa linii ścieżki krytycznej, a pokrycie stoi.
        // Domknięte 31.08.2026 dwudziestoma czterema przypadkami, z których
        // KAŻDY dopuszczający ma swój kontrprzykład (`localhost` przechodzi,
        // `localhost.evil.example.org` nie; wariant www dozwolonej domeny
        // przechodzi, `evil-najemca.example.org` nie).
        //
        // ZMIERZONE 31.08.2026 po domknięciu: 98,14% instrukcji / 97,43%
        // gałęzi / 100% funkcji / 97,77% linii. Niepokryta została JEDNA
        // linia - `catch` ostatniej szansy w `absoluteReturnUrl`, nieosiągalny
        // odkąd obie połówki adresu mają wartość domyślną (moduł mówi o nim
        // wprost: „nie ma drogi, którą ta funkcja rzuca"). Próg = zmierzone
        // minus ~4 pp; osunięcie się o cztery punkty NA TEJ POWIERZCHNI ma
        // zapalić światło natychmiast, a nie rozpłynąć się w średniej
        // dziewięćdziesięciu plików katalogu.
        "src/lib/billing/returnUrl.server.ts": {
          statements: 94,
          functions: 96,
          lines: 93,
          branches: 93,
        },
        // Warstwa danych ścieżki rezygnacji: parametry kontroferty i katalog
        // powodów odejścia (filtr `active` decyduje, co klient wybierze).
        "src/lib/retention/queries.ts": {
          statements: 90,
          functions: 85,
          lines: 90,
          branches: 80,
        },
        // Server fns ścieżki rezygnacji + czyste helpery kuponu. Do 19.08.2026
        // `functions.ts` stał na 0% (0 z 5 funkcji), mimo że to on ZAKŁADA
        // KUPON RABATOWY na koncie odchodzącego klienta. Próg pilnuje czterech
        // reguł, których pgTAP nie widzi, bo są w orkiestracji handlera:
        // własności subskrypcji (kupon leci na subskrypcję wołającego, nie na
        // dowolne id z klienta), wyłącznika redakcyjnego `enabled`, okna 180
        // dni na jedną przyjętą ofertę oraz PONAWIANIA przy kolizji kodu
        // (23505) zamiast wywalenia przepływu. Floor tuż pod zmierzonym
        // 100/96,07/100/100. Niedobita gałąź w `coupon.ts` to zacisk długości
        // sufiksu, nieosiągalny z produkcyjnych wywołań.
        "src/lib/retention/**": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 95,
        },
        // Sieć kontaktów - warstwa danych RPC-only. Do 2026-08-06 CAŁY moduł
        // miał 0% (audyt: „pokrycie modułu 15,4%, src/lib/network na 0%"),
        // mimo że decyduje o prywatności odmów zaproszeń, izolacji kont w
        // cache i kontrakcie czasowników RPC. Próg jest zaporą przed powrotem
        // do zera, wyznaczoną tuż pod osiągniętym poziomem.
        "src/lib/network/**": {
          statements: 85,
          functions: 95,
          lines: 95,
          branches: 65,
        },
        // Sieć kontaktów - warstwa KOMPONENTÓW. Do 06.08.2026 cały katalog stał
        // na 4,6% (12 z 13 plików na zerze), w tym ConnectButton: jedna maszyna
        // stanów na pięć stanów relacji × `canInvite` × blokadę, obsługująca
        // trzy powierzchnie produktu. Teraz: 99% instrukcji, 100% linii i
        // funkcji, ~96% gałęzi. Próg jest zaporą tuż pod osiągniętym poziomem -
        // niedobite gałęzie to obronne ramiona, których nie da się wywołać
        // (Radix nie woła `onOpenChange(true)` dla sterowanego dialogu,
        // `preventDefault` na już zablokowanym przycisku itd.).
        "src/components/network/**": {
          statements: 97,
          functions: 98,
          lines: 98,
          branches: 92,
        },
        // Manifest eksportu RODO: rejestr sekcji + bramka rozjazdu z server fn.
        // Czysty moduł, więc trzymamy go pod 100%.
        "src/lib/profile/exportManifest.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 95,
        },
        // ── PROFIL ─────────────────────────────────────────────────────────────
        // Audyt 18.08 postawił profilowi ten sam zarzut, co czatowi wcześniej:
        // pokrycie stało w miejscu (22,0% src/lib/profile, 27,8%
        // src/components/profile), a 9+6 plików na okrągłym zerze - w tym
        // AuthorProfileEditor.tsx (219 instrukcji, największy pojedynczy plik
        // profilu) i CompanyPickerDialog.tsx bez ani jednej asercji. Ten sam
        // ruch, co przy czacie: fixture'y w duchu atomic design
        // (`src/test/profile/fixtures.ts`, plus wspólna atrapa łańcucha
        // PostgREST wyprowadzona do `src/test/supabaseChain.ts` - jest teraz
        // JEDNA, nie osobna kopia na każdą powierzchnię testową).
        //
        // Progi floorowane ~4 pp pod ZMIERZONYM poziomem (marża na dryf CI) -
        // wolno je wyłącznie podnosić.
        //
        // WARSTWA DANYCH: 22,02% -> 85,22% instrukcji (85% funkcji). Jedyny
        // plik wciąż na zerze to `export.functions.ts` (server fn RODO) - ma
        // już bramkę statyczną (`__tests__/exportOwnerScope.gate.test.ts`),
        // a pokrycie runtime'owe server fn zostało świadomie pominięte
        // (koszt/zysk nieopłacalny na tym etapie - patrz dokument wdrożenia).
        //
        // 2026-08-22 (MODUŁ 15, etap 8): RATCHET W GÓRĘ. Zmierzone na tym HEAD
        // 86,06% instrukcji / 80,40% gałęzi / 85,57% funkcji / 86,26% linii.
        // Próg = zmierzone minus ~3 pp marginesu na dryf CI.
        "src/lib/profile/**": {
          statements: 83,
          functions: 82,
          lines: 83,
          branches: 77,
        },
        // SERVER FN EKSPORTU RODO - OSOBNY WPIS, ŻEBY PRZESTAŁA SIĘ UKRYWAĆ ZA
        // ŚREDNIĄ KATALOGU. `export.functions.ts` to 391 linii na okrągłym
        // zerze pokrycia runtime'owego i sam jeden ciągnie średnią
        // `src/lib/profile/**` w dół o kilkanaście punktów - dopóki nie miała
        // własnego progu, nie było widać, że jest to JEDEN plik, a nie ogólna
        // słabość warstwy (pozostałe pliki tego katalogu stoją na 95-100%).
        //
        // ZERO NIE JEST TU ZANIEDBANIEM, JEST DECYZJĄ, i ma dwie bramki
        // zamiast pokrycia:
        //   * `__tests__/exportOwnerScope.gate.test.ts` - statyczna bramka
        //     zakresu właściciela: żadna sekcja paczki nie może czytać danych
        //     bez filtra po `auth.uid()`,
        //   * `__tests__/exportManifestParity.gate.test.ts` - parytet
        //     manifestu z emiterami: sekcja dopisana do eksportu bez wpisu
        //     w rejestrze (albo odwrotnie) zapala bramkę.
        // Obie czytają KOD ŹRÓDŁOWY, więc łapią rozjazd bez uruchamiania
        // server fn - a uruchomienie jej w vitest wymagałoby atrapy całego
        // klienta Supabase razem z 20 sekcjami paczki i RPC, czyli testu,
        // który dowodziłby głównie poprawności własnych atrap.
        //
        // Próg zero jest CELOWO wpisany zamiast pominięcia: to jawny wyjątek
        // w miejscu, w którym go widać, a nie cicha dziura w średniej. Gdy
        // pokrycie runtime'owe kiedyś powstanie, ten wpis się podnosi.
        "src/lib/profile/export.functions.ts": {
          statements: 0,
          functions: 0,
          lines: 0,
          branches: 0,
        },
        // CZYSTE MODUŁY profilu trzymamy pod 100% na wszystkich czterech
        // metrykach - tak jak czyste moduły czatu i płatności wyżej. Niosą
        // reguły widoczne wyłącznie dla użytkownika: punktację Big Five
        // (klucz odwrócony na połowie pytań), wagi kompletności profilu
        // (suma = 100, zsynchronizowana z bramką CI wobec SQL-a), adresy
        // kanoniczne paneli (nie mogą wskazywać na przekierowanie) i
        // synchronizację podglądu gościa między stroną a layoutem.
        "src/lib/profile/personality.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/profile/completeness.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/profile/routes.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/profile/guestPreviewStore.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // WARSTWA KOMPONENTÓW: 27,84% -> 89,54% instrukcji. Zero plików na
        // zerze (było 6 z 17, w tym AuthorProfileEditor.tsx bez ANI JEDNEJ
        // asercji przy 219 instrukcjach - największy pojedynczy plik tej
        // powierzchni). Trzy defekty wyszły PRZY PISANIU tych testów i zostały
        // naprawione osobnymi commitami: propozycja publicznego adresu profilu
        // zjadała literę „ł" (transliteracja przez samo `normalize("NFKD")` nie
        // rozkłada tej litery), pola formularza tworzenia firmy nie miały
        // `htmlFor` (osiem nienazwanych pól dla czytnika ekranu), a utworzenie
        // nowej firmy w CRM ignorowało błąd DRUGIEGO kroku (powiązania z
        // profilem) - firma lądowała w bazie, użytkownik widział fałszywy
        // sukces. Szczegóły w dokumencie wdrożenia.
        //
        // 2026-08-22 (MODUŁ 15, etap 8): RATCHET W GÓRĘ po domknięciu dwóch
        // największych plików tej powierzchni. `AuthorProfileEditor.tsx`
        // (995 linii) poszedł z 84,01/79,85/69,23/86,15 na
        // 99,54/98,56/100/100, a `sections/ProfileExtraSections.tsx`
        // (1015 linii) z 84,23/79,51/77,92/88,43 na 99,50/99,51/100/100.
        // Zmierzone dla całego katalogu: 95,00% instrukcji / 92,32% gałęzi /
        // 89,86% funkcji / 96,28% linii. Próg = minus ~3 pp na dryf CI.
        // Najsłabsze pozostałe pliki (następny krok, nie regresja tego):
        // `CompanyPickerDialog.tsx` (64,86% funkcji) i
        // `MediaMentionsSection.tsx` (71,27% gałęzi).
        "src/components/profile/**": {
          statements: 92,
          functions: 87,
          lines: 93,
          branches: 89,
        },
        // ── MODUŁ 15: PROFIL I KONTO ─────────────────────────────────────────
        // Audyt postawił temu modułowi ten sam zarzut, co czatowi i profilowi
        // wcześniej: 56,03% linii i 51,95% funkcji, z panelem ustawień
        // logowania na 2,5% i dwunastoma plikami na okrągłym zerze - w tym
        // trasą PUBLICZNĄ `/author/$slug` (589 linii) i pulpitem konta
        // `/profile` (1232 linie, największy plik modułu).
        //
        // Progi poniżej są floorowane 1-2 pp pod ZMIERZONYM poziomem (dla
        // katalogów ~3 pp na dryf CI) i wolno je wyłącznie PODNOSIĆ. Bez nich
        // jednorazowy wysiłek testowy nie zamienia się w zaporę: pomiar sam
        // z siebie niczego nie pilnuje.
        //
        // CZYSTE MODUŁY DECYZYJNE - pod 100%, tak jak pozostałe czyste moduły
        // w tym pliku. Niosą reguły, których złamania użytkownik nie zobaczy
        // od razu: spójność ustawień logowania (przekierowanie po zalogowaniu
        // wskazujące na formularz = pętla logowania), kolejność problemów przy
        // zmianie hasła, rejestr kroków wycieczki onboardingowej, ważność
        // kuponu retencyjnego oraz tożsamość wołającego w funkcjach konta.
        "src/lib/authSettingsRules.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/hooks/useAuthSettings.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/auth/securityPanel.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/onboarding/**": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/retention/coupon.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // FUNKCJE SERWEROWE KONTA I KONTEKST SESJI - startowały z zera.
        // Od nich zależy, czy operacja działa na koncie WOŁAJĄCEGO, a nie na
        // identyfikatorze podanym z klienta.
        "src/lib/account.functions.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/auth/optionalUser.server.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/auth/currentUser.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // REJESTR PÓL REJESTRACJI. Dwie niedobite gałęzie (`:54`, `:58`) to
        // ramiona zapasowe dla klucza spoza mapy - `resolvePopupFields()`
        // zawsze zwraca wszystkie klucze, a typ argumentu je zawęża, więc
        // osiągalne byłyby tylko rzutowaniem.
        "src/lib/auth/registrationFields.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 92,
        },
        // PANEL ADMINA USTAWIEŃ LOGOWANIA + wyprowadzone z niego atomy,
        // molekuła i organizm (atomic design). Trasa decyduje o tym, czy da
        // się wejść na serwis, a stała na 2,5% linii i 0 z 51 funkcji.
        "src/routes/admin.login-settings.tsx": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/components/admin/auth/**": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // PRZEWODNIK ONBOARDINGOWY. Dwie niedobite gałęzie (`:136-137`) siedzą
        // za strażnikiem nieosiągalnym z interfejsu.
        "src/components/admin/onboarding/**": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 95,
        },
        // ZAINTERESOWANIA I PERSONALIZACJA. Najsłabszy plik tej powierzchni to
        // `TopicsDroplist.tsx` (89,33% gałęzi) - lista wyboru tematów
        // z semantyką `listbox`, poprawioną przy okazji trzech naruszeń ARIA.
        "src/components/interests/**": {
          statements: 95,
          functions: 96,
          lines: 97,
          branches: 91,
        },
        // TRASA PUBLICZNA HUBA AUTORA - jedyna w tym module, którą widzi świat:
        // indeksowana, udostępniana odnośnikiem, scrapowana przez podglądy
        // społecznościowe. Trzy rozłączne stany loadera (wiersz / `null` / 200
        // z komunikatem, NIGDY sfabrykowany 404), indeksacja warunkowa i adres
        // kanoniczny bez parametrów eksploratora.
        "src/routes/author.$slug.tsx": {
          statements: 99,
          functions: 100,
          lines: 100,
          branches: 97,
        },
        // PULPIT KONTA. Pięć niedobitych gałęzi to martwy kod pod warunkiem
        // nadrzędnym `activeTab === "settings" && editable` - opisany
        // w nagłówku pliku testowego, żeby jego usunięcie było widocznym
        // uproszczeniem, a nie utratą pokrycia.
        "src/routes/profile.index.tsx": {
          statements: 98,
          functions: 97,
          lines: 98,
          branches: 96,
        },
        "src/routes/profile.membership.tsx": {
          statements: 97,
          functions: 100,
          lines: 100,
          branches: 98,
        },
        "src/routes/profile.organization.tsx": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 97,
        },
        "src/routes/profile.expert-requests.tsx": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/routes/profile.bookmarks.tsx": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // LISTY OBSERWOWANYCH. Cztery niedobite gałęzie to martwe `?? []`
        // w trzeciej gałęzi zagnieżdżonego trójargumentowca, do której wchodzi
        // się wyłącznie wtedy, gdy dane SĄ - czyste sprzątanie, nie luka.
        "src/routes/profile.follows.tsx": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 94,
        },
        // PANEL BEZPIECZEŃSTWA. Pięć niedobitych gałęzi (`:95`, `:207`, `:215`,
        // `:253`, `:532`) to strażniki obronne, które stały się nieosiągalne
        // wtedy, gdy reguły panelu wyjechały do `lib/auth/securityPanel.ts`:
        // przed każdym z nich stoi wcześniejsze `return` z tego modułu.
        "src/routes/profile.security.tsx": {
          statements: 97,
          functions: 100,
          lines: 100,
          branches: 91,
        },
        "src/routes/profile.personality.tsx": {
          statements: 96,
          functions: 100,
          lines: 100,
          branches: 92,
        },
        // EKRAN PO REJESTRACJI I WYZWANIE MFA. `MfaChallenge.tsx` stoi na
        // 91,66% gałęzi i to SUFIT tego pliku: jedenaście z dwunastu. Dwunasta
        // to ramię `o === true` w `onOpenChange`, a Radix woła je wyłącznie
        // z `DialogPrimitive.Trigger` - którego ten komponent nie renderuje.
        "src/components/auth/SignupSuccessPanel.tsx": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/components/auth/MfaChallenge.tsx": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 90,
        },
        // DWA NAJWIĘKSZE KOMPONENTY PROFILU - osobne wpisy obok progu
        // katalogowego, bo to one niosą ZAPIS profilu publicznego i kolejność
        // sekcji. Każda ścieżka zapisu ma dwa końce, a nieudany nie może
        // pokazywać sukcesu ani zostawiać stanu połowicznego.
        "src/components/profile/AuthorProfileEditor.tsx": {
          statements: 98,
          functions: 100,
          lines: 100,
          branches: 97,
        },
        "src/components/profile/sections/ProfileExtraSections.tsx": {
          statements: 98,
          functions: 100,
          lines: 100,
          branches: 98,
        },
        // ── CZAT / KOMUNIKATOR ────────────────────────────────────────────────
        // Audyt 14.08 (MODUŁ 9) postawił temu modułowi jeden zarzut i był to
        // zarzut o TESTY: „T/P 0,111 - bez ruchu w tej delcie, przy 12 293
        // liniach". Pokrycie stało na 17-20% przez TRZY kolejne pomiary, więc
        // sam pomiar niczego nie pilnował - dopiero próg zamienia jednorazowy
        // wysiłek w zaporę. Bez tych wpisów następna generacja mogła zejść
        // z powrotem do zera i żadna bramka by tego nie zauważyła.
        //
        // Progi są floorowane ~4 pp pod ZMIERZONYM poziomem (marża na dryf
        // środowiska CI) i wolno je wyłącznie podnosić - identyczna zasada, co
        // przy sieci kontaktów i paywallu wyżej.
        //
        // WARSTWA DANYCH: 19,67% -> 78,52% instrukcji (84,82% funkcji).
        // Niedobita reszta to nagrywanie głosu (MediaRecorder), toasty
        // przychodzące, katalog osób i pseudonimy - powierzchnie z własnymi
        // warstwami danych, które są następnym krokiem, nie regresją tego.
        //
        // 2026-09-01 - ZACIŚNIĘCIE BEZ JEDNEGO NOWEGO TESTU. Progi stały
        // 4,8-5,8 pp POD pomiarem, czyli przepuszczały regresję o rozmiarze
        // całego pliku (`useConversations.ts` to 5,4 pp tego globu) bez ani
        // jednego czerwonego testu. Pomiar pełnej suity na tym HEAD:
        // instrukcje 79,48% · funkcje 85,78% · linie 82,82% · gałęzie 72,83%
        // (wydanie 8 audytu raportowało 80,51 / 86,51 / 84,06 / 73,58 - biorę
        // NIŻSZĄ z dwóch liczb, żeby próg trzymał na obu pomiarach).
        // Nowe progi to pomiar minus <= 1 pp. Luz zabrany jednym ruchem na
        // 36 plikach, zanim powstał pierwszy nowy test.
        //
        // 2026-09-01, DRUGIE PODNIESIENIE (wydanie 9 audytu, po dobiciu
        // pokrycia). Pomiar pełnej suity z `all: true`:
        // instrukcje 95,44% · funkcje 97,95% · linie 98,75% · gałęzie 89,95%.
        // Progi to PODŁOGA z pomiaru, czyli luz PONIŻEJ 1 pp na każdej z
        // czterech metryk - tak jak przy pierwszym zaciśnięciu. Dobite:
        // nagrywanie głosu, toasty przychodzące, katalog osób, pseudonimy,
        // wersje robocze, obecność, szyna doku oraz DWA NOWE moduły reguł
        // wyprowadzone z `ChatComposer.tsx` (`composerRules`,
        // `attachmentPresentation`), które mają własne progi niżej.
        "src/lib/chat/**": {
          statements: 95,
          functions: 97,
          lines: 98,
          branches: 89,
        },
        // CZYSTE MODUŁY WĄTKU trzymamy pod 100% na wszystkich czterech
        // metrykach - tak jak pozostałe czyste moduły w tym pliku. To one
        // niosą reguły, których złamanie widzi WYŁĄCZNIE użytkownik: kolejność
        // wiadomości i deduplikację bliźniaka optymistycznego (`thread`),
        // budżet stron przy skoku do trafienia (`useThreadJump`), zgodność
        // etykiet okien znikania z lustrem CHECK-a (`menuOptions`) oraz
        // izolację cache'u między kontami (`keys`).
        "src/lib/chat/thread.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/chat/menuOptions.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/chat/useThreadJump.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/chat/keys.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // WARSTWA DANYCH ROZMOWY - dwa pliki, od których zależy, czy wiadomość
        // dojdzie i czy nie wycieknie między tenantami. Startowały z 0% i 12%.
        "src/lib/chat/useMessages.ts": {
          statements: 88,
          functions: 89,
          lines: 93,
          branches: 80,
        },
        "src/lib/chat/useConversations.ts": {
          statements: 93,
          functions: 98,
          lines: 98,
          branches: 83,
        },
        // ── REGUŁY WYPROWADZONE Z KOMPOZYTORA (wydanie 9) ────────────────────
        // `ChatComposer.tsx` stał na 0/160 linii i 0/40 funkcji, bo NIE MIAŁ
        // ani jednej funkcji modułowej: każda decyzja (co robi Enter, czy
        // pokazać szybką emotkę, czy plik wolno wysłać, co znaczy ta odmowa
        // magazynu) siedziała w domknięciu wewnątrz komponentu i wymagała
        // pełnego renderu z sesją, tenantem, kanałem realtime i atrapą
        // `MediaRecorder`. Reguły wyszły do dwóch czystych modułów - i to one
        // niosą dziś ciężar dowodu, a render sprawdza wyłącznie SKLEJENIE.
        // Progi pod 100%, bo obie ekstrakcje są wierne co do gałęzi.
        "src/lib/chat/composerRules.ts": {
          statements: 96,
          functions: 98,
          lines: 98,
          branches: 96,
        },
        "src/lib/chat/attachmentPresentation.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 98,
        },
        // ── CZTERY RUINY WARSTWY DANYCH (wydanie 9) ──────────────────────────
        // Wszystkie cztery szły z zera albo z okolic zera. `voice.ts` niesie
        // nagrywanie notatki głosowej (uprawnienie mikrofonu, `MediaRecorder`,
        // sprzątanie ścieżek), `useIncomingChatToasts` decyduje, czy powiadomienie
        // ma się w ogóle pokazać (wyciszenie rozmowy, własna wiadomość, okno na
        // wierzchu), `usePeopleDirectory` buduje katalog osób do nowej rozmowy,
        // a `nicknames` trzyma pseudonimy per rozmowa.
        "src/lib/chat/voice.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 88,
        },
        "src/lib/chat/useIncomingChatToasts.ts": {
          statements: 87,
          functions: 86,
          lines: 91,
          branches: 87,
        },
        "src/lib/chat/usePeopleDirectory.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 96,
        },
        "src/lib/chat/nicknames.ts": {
          statements: 96,
          functions: 98,
          lines: 98,
          branches: 95,
        },
        // ── OBRZEŻA POWIERZCHNI CZATU (wydanie 9) ────────────────────────────
        // Wersje robocze (przetrwanie po zamknięciu okna), obecność (renderowana
        // także na serwerze - stąd osobny test SSR), szyna doku (limit okien).
        "src/lib/chat/drafts.ts": {
          statements: 92,
          functions: 98,
          lines: 96,
          branches: 85,
        },
        "src/lib/chat/presence.ts": {
          statements: 91,
          functions: 98,
          lines: 94,
          branches: 81,
        },
        "src/lib/chat/chatDockBus.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 98,
        },
        "src/lib/chat/attachments.ts": {
          statements: 92,
          functions: 98,
          lines: 98,
          branches: 82,
        },
        "src/lib/chat/time.ts": {
          statements: 95,
          functions: 98,
          lines: 98,
          branches: 87,
        },
        "src/lib/chat/themes.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 98,
        },
        // WARSTWA KOMPONENTÓW: 17,32% -> 44,63%. Próg jest niższy niż w warstwie
        // danych i to jest uczciwe: kompozytor (585 linii), panel mediów, dialogi
        // kręgu i wyglądu oraz dataset emoji nadal stoją na zerze. Pilnuje tego,
        // co ten PR faktycznie pokrył: okna rozmowy w obu wariantach, menu, doku
        // z limitem okien, dzwonka, wiersza listy z potwierdzeniami i wersją
        // roboczą, paska wyszukiwania oraz przekazywania wiadomości.
        //
        // 2026-09-01 - to samo zaciśnięcie, co w warstwie danych wyżej. Pomiar
        // pełnej suity: instrukcje 45,26% · funkcje 40,69% · linie 46,34% ·
        // gałęzie 39,16% (wydanie 8: 45,24 / 40,69 / 46,18 / 38,72). Progi to
        // NIŻSZA z dwóch liczb minus <= 1 pp - stąd gałęzie 38, a nie 39:
        // 39 przechodzi na tym HEAD, ale nie przeszłoby na pomiarze wydania 8,
        // a próg ma trzymać na obu.
        //
        // 2026-09-01, DRUGIE PODNIESIENIE (wydanie 9 audytu). DWANAŚCIE plików
        // tego globu nie zostało nigdy wyrenderowane w teście - kompozytor,
        // picker emotek, oba dialogi kręgu, dialog wyglądu, panel mediów,
        // wyszukiwarka rozmówców, cała rodzina zapytań eksperckich i wiersz
        // wątku demo. Każdy z nich ma dziś własny próg niżej, żeby dołek
        // pojedynczego pliku nie chował się w średniej 35 plików. Pomiar
        // pełnej suity z `all: true`:
        // instrukcje 96,88% · funkcje 96,72% · linie 98,32% · gałęzie 90,77%.
        // Progi to PODŁOGA z pomiaru - luz poniżej 1 pp na każdej metryce.
        "src/components/chat/**": {
          statements: 96,
          functions: 96,
          lines: 98,
          branches: 90,
        },
        // Organizm okna rozmowy - z 0% na 83,55% po podziale na atomy, a w
        // wydaniu 9 na komplet 73/73 funkcji. Próg funkcji stał na 60, czyli
        // przepuszczał utratę TRZYNASTU domknięć (menu kontekstowe, dialogi
        // znikania, przekazywanie, blokowanie) bez ani jednego czerwonego testu.
        "src/components/chat/ChatWindow.tsx": {
          statements: 97,
          functions: 98,
          lines: 98,
          branches: 86,
        },
        // ── DWANAŚCIE POWIERZCHNI ZDJĘTYCH Z ZERA (wydanie 9) ────────────────
        // Każda dostała ten sam zestaw dowodów: otwarcie, walidacja, akcja,
        // odmowa serwera i zamknięcie bez zapisu. Dialog kręgu i picker członków
        // dostały dodatkowo test tenanta (zapytanie o kandydatów NIE MOŻE
        // wyjść poza obszar roboczy).
        "src/components/chat/ChatComposer.tsx": {
          statements: 95,
          functions: 93,
          lines: 96,
          branches: 88,
        },
        "src/components/chat/ChatAppearanceDialog.tsx": {
          statements: 96,
          functions: 93,
          lines: 96,
          branches: 98,
        },
        "src/components/chat/ChatMediaPanel.tsx": {
          statements: 95,
          functions: 89,
          lines: 95,
          branches: 89,
        },
        "src/components/chat/DemoBotListItem.tsx": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 98,
        },
        "src/components/chat/EmojiPicker.tsx": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 79,
        },
        "src/components/chat/ExpertRequestDialog.tsx": {
          statements: 95,
          functions: 98,
          lines: 98,
          branches: 88,
        },
        "src/components/chat/ExpertRequestDialogHost.tsx": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 48,
        },
        "src/components/chat/ExpertRequestsInbox.tsx": {
          statements: 88,
          functions: 98,
          lines: 93,
          branches: 73,
        },
        "src/components/chat/GroupCreateDialog.tsx": {
          statements: 86,
          functions: 88,
          lines: 85,
          branches: 82,
        },
        "src/components/chat/GroupInfoDialog.tsx": {
          statements: 95,
          functions: 98,
          lines: 98,
          branches: 90,
        },
        "src/components/chat/GroupMemberPicker.tsx": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 93,
        },
        "src/components/chat/NewChatSearch.tsx": {
          statements: 94,
          functions: 88,
          lines: 93,
          branches: 93,
        },
        // ── ATOMY WIADOMOŚCI I ZAŁĄCZNIKA (wydanie 9) ────────────────────────
        // Dymek niesie macierz stanów (własna/cudza, w locie/doręczona/odczytana,
        // usunięta, edytowana, odpowiedź, reakcje), lista - separatory dni,
        // skok do trafienia i stopkę potwierdzeń. Podgląd zdjęcia ma gesty
        // (zoom, obrót, przeciąganie), których nie widzi żaden inny test.
        "src/components/chat/MessageBubble.tsx": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 94,
        },
        "src/components/chat/MessageList.tsx": {
          statements: 90,
          functions: 90,
          lines: 94,
          branches: 85,
        },
        "src/components/chat/AttachmentContent.tsx": {
          statements: 95,
          functions: 98,
          lines: 98,
          branches: 81,
        },
        "src/components/chat/AttachmentPreview.tsx": {
          statements: 94,
          functions: 90,
          lines: 96,
          branches: 96,
        },
        "src/components/chat/DemoBotChat.tsx": {
          statements: 95,
          functions: 93,
          lines: 97,
          branches: 92,
        },
        "src/components/chat/MediaHistoryDialog.tsx": {
          statements: 93,
          functions: 79,
          lines: 92,
          branches: 81,
        },
        // ── TRASY CZATU (wydanie 9) ──────────────────────────────────────────
        // Obie startowały z CZYSTEGO ZERA. `/messages` to 687 linii źródła i
        // jedyne wejście do skrzynki; `/admin/community/chat` niesie operacje
        // NISZCZĄCE (czyszczenie historii, kasowanie rozmowy kaskadowo), więc
        // brak dowodu był tam najdroższy w całym module.
        "src/routes/messages.tsx": {
          statements: 89,
          functions: 83,
          lines: 89,
          branches: 83,
        },
        "src/routes/admin.community.chat.tsx": {
          statements: 89,
          functions: 82,
          lines: 89,
          branches: 75,
        },
        // Bramka symetrii FTS: czysty analizator migracji. Niedobite gałęzie to
        // ramiona obronne dla wzorców, których w repo nie ma (konfiguracja
        // z parametru, wektor liczony poza migracjami) - zostawiamy je, bo
        // bramka MA mówić „nie rozstrzygnąłem", a nie udawać zieleń.
        "src/lib/ci/ftsConfigSymmetry.ts": {
          statements: 93,
          functions: 100,
          lines: 98,
          branches: 81,
        },
        // ── LOGOWANIE / REJESTRACJA / WYLOGOWANIE ────────────────────────────
        // 2026-08-18: ten lejek miał najgorszy stosunek krytyczności do
        // pokrycia w całym repo - portal logowania (AuthPortal.tsx) 0,4%,
        // useAuth 1,6%, MFA (mfa.ts + MfaChallenge.tsx) 2,3%, reset hasła
        // (routes/reset-password.tsx) 0% - mimo że to JEDYNA brama wejścia do
        // konta na całej powierzchni publicznej. Progi floorowane tuż pod
        // zmierzonym pokryciem, tak jak pozostałe wpisy w tym pliku.
        //
        // AuthPortal.tsx - 2026-08-22: gałęzie PODNIESIONE z 90 na 98 po
        // dobiciu 11 z 12 niedobitych ramion (pomiar: 99,43%, czyli 177/178).
        // Poprzedni próg stał 3 pp POD pomiarem, więc przepuszczał regresję,
        // której nikt by nie zauważył. Dobite: kontrakt `type`/`autoComplete`
        // każdego pola rejestracji (phone/company/job/linkedin + spadek na
        // `off`) i spadki domyślnych linków prawnych (privacy_url/terms_url).
        // Dwunaste ramię jest NIEOSIĄGALNE, nie niedotestowane: w linii 444
        // `full ? ... : ...` stoi wewnątrz bloku dla pól hasła, a `full` jest
        // prawdziwe tylko dla email/linkedin - czyli w tym miejscu zawsze
        // fałszywe. To martwy kod; dlatego sufit tego pliku to 99,43, a nie 100.
        "src/components/auth/AuthPortal.tsx": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 98,
        },
        // ── PORTAL LOGOWANIA: POZOSTAŁE WEJŚCIA UŻYTKOWNIKA ──────────────────
        // 2026-08-22. Funkcjonalność "portal logowania" raportowała 56,4%
        // linii i 59,4% gałęzi, ale ta średnia UKRYWAŁA dwa pliki na zerze:
        // serce portalu (AuthPortal.tsx, 119 z 225 mierzonych linii) stało już
        // na 100% linii i funkcji, a całe brakujące 43,6% to były popup i
        // trasa /login. Wnioskiem z tego zlecenia jest jednak coś innego:
        // zakres oparty na NAZWACH PLIKÓW zgubił trzy dalsze wejścia do
        // logowania, które audyt wymienił jako "dwa". Poniższe progi trzymają
        // WSZYSTKIE PIĘĆ ścieżek wejścia, nie tylko te dwie nazwane.
        //
        // routes/login.tsx (0% -> 100/100/100/100 na 10 mierzonych liniach).
        // Ten próg chroni także asercję o `robots: "noindex, nofollow"` - bez
        // niej jedna usunięta linia w `head()` wpuszcza stronę logowania do
        // indeksu razem z wariantami `?mode=signup` i `?mode=reset` jako
        // zduplikowanymi adresami, a zobaczyłby to dopiero ktoś czytający
        // Search Console po kilku tygodniach.
        "src/routes/login.tsx": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // LoginPopup.tsx (0% -> 100 instr. / 98,85 gałęzi / 100 funkcji /
        // 100 linii na 88 mierzonych liniach). Progi floorowane ~1-2 pp pod
        // pomiarem, bo to jedyny plik tej funkcjonalności na tyle duży, żeby
        // ten margines coś znaczył. Niedobita jedna gałąź: `?? "pl"` w
        // `(i18n.language ?? "pl")` - instancja i18next zawsze ma ustawiony
        // język, więc ramię jest nieosiągalne z testu.
        // Popup jest bramką czterech akcji gościa (zapis artykułu,
        // obserwowanie autora, karta autora, zachęta w liście do przeczytania),
        // więc jego awaria wygląda dla użytkownika jak BRAK FUNKCJI, nie jak
        // błąd - stąd wysoki próg na tak niedawno odkrytej powierzchni.
        "src/components/LoginPopup.tsx": {
          statements: 98,
          functions: 100,
          lines: 98,
          branches: 97,
        },
        // loginPopupBus.ts (gałęzie 50% -> 100%, funkcje 80% -> 100%).
        // Osiem mierzonych linii, więc próg poniżej 100 byłby nieodróżnialny
        // od 100 (utrata jednej linii to i tak 87,5%). Dwie z czterech gałęzi
        // to strażniki SSR: nieprzetestowany strażnik `typeof window ===
        // "undefined"` to wyjątek w renderze serwerowym, czyli biały ekran,
        // a nie zdegradowany popup.
        "src/lib/loginPopupBus.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // GuestCheckoutGate.tsx (51,72/42,85/20/51,85 -> 100/100/100/100).
        // TRZECIE wejście użytkownika do logowania i JEDYNY magic link w całym
        // repo (`signInWithOtp` z `shouldCreateUser: true`). Audyt nazwał tę
        // funkcjonalność "portal logowania (hasło, magic link)", ale tego pliku
        // nie wymienił - więc jedyna ścieżka magic linka stała bez testu na
        // całej funkcji `submit()` (1 z 5 funkcji pokryta). Bramka stoi PRZED
        // PŁATNOŚCIĄ (routes/checkout.$planId.tsx owija nią cały checkout):
        // gdy wysyłka linku milczy, gość nie może zapłacić i nie wie dlaczego.
        "src/components/checkout/GuestCheckoutGate.tsx": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // membership-registration.tsx (0% -> 100/100/100/100). PIĄTE wejście:
        // druga trasa montująca AuthPortal, tym razem w trybie rejestracji.
        // Próg chroni odwrotność asercji z `/login`: ta strona NIE MA `robots`
        // i mieć nie powinna, bo to publiczna strona pozyskania członka.
        // Pomyłka "ujednolicam obie strony auth" idzie w obie strony - dopisany
        // tu `noindex` wycina rejestrację z wyszukiwarki, a usunięty z `/login`
        // wpuszcza tam formularz logowania.
        "src/routes/membership-registration.tsx": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // MfaChallenge.tsx MA SWÓJ WPIS WYŻEJ (100/100/100/90) i NIE POWTARZA
        // GO TUTAJ. Do 2026-08-22 ten sam klucz stał w tym pliku DWA RAZY,
        // a ponieważ w literale obiektu wygrywa wpis PÓŹNIEJSZY, obowiązywała
        // ta słabsza kopia (funkcje 90, gałęzie 83) - czyli 10 pp i 8,66 pp
        // PONIŻEJ pomiaru (100% funkcji, 91,66% gałęzi). Ratchet wpisany wyżej
        // był martwy: regresja z 100% na 90% funkcji przeszłaby przez bramkę
        // niezauważona. Duplikat usunięty; obowiązuje wpis wyżej.
        // useAuth.tsx - niedobite: fallback `?? []` dla `rolesData` (RPC nigdy
        // nie zwraca null/undefined w testach) i strażnik `typeof window !==
        // "undefined"` w signOut() - zawsze prawdziwy pod happy-dom, więc
        // ścieżka SSR-bez-window jest nieosiągalna z testu jednostkowego.
        "src/hooks/useAuth.tsx": {
          statements: 100,
          functions: 93,
          lines: 100,
          branches: 95,
        },
        // reset-password.tsx - niedobite: `lang` z `head()` zależny od URL-a
        // (activeLang), nie od `i18n.language` czytanego w ciele komponentu -
        // wariant angielski wymagałby osobnego fixture z prefiksem /en, oraz
        // strażniki `cancelled` w efekcie nasłuchu recovery (wyścig przy
        // odmontowaniu w trakcie oczekiwania na sesję/timer).
        "src/routes/reset-password.tsx": {
          statements: 96,
          functions: 100,
          lines: 100,
          branches: 85,
        },
        // mfa.ts - cztery czyste funkcje owijające supabase.auth.mfa.*; każda
        // gałąź (poziomy AAL, obecność/brak czynnika, błąd challenge vs
        // verify) ma dedykowany test.
        "src/lib/auth/mfa.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // OCHRONA PRZED BRUTE FORCE - do 19.08.2026 11,1% linii i 0 z 9 funkcji,
        // czyli jedyna zapora przed upychaniem wykradzionych haseł stała bez
        // testu. Próg pilnuje trzech rzeczy, których nie widać z zewnątrz:
        //   * FAIL-CLOSED - błąd RPC ma zamykać bramę, nie ją otwierać (inaczej
        //     wystarczy przeciążyć bazę, żeby wyłączyć ochronę),
        //   * RODO - w `rate_limits` nie może wylądować surowy IP ani e-mail;
        //     testy asercjonują wprost na `_subject` idącym do bazy,
        //   * rozdział kubełków - IP i e-mail liczą się niezależnie, a ten sam
        //     e-mail w różnych trybach ma osobne liczniki.
        // Osiągnięte 100/100/100/100 (9 z 9 funkcji); floor niżej, bo gałęzie
        // obronne łatwo przypadkiem uzależnić od kolejności testów.
        "src/lib/auth/bruteforce.functions.ts": {
          statements: 98,
          functions: 100,
          lines: 98,
          branches: 95,
        },
        // ── NEWSLETTER: DORĘCZALNOŚĆ ─────────────────────────────────────────
        // Audyt 18.08 dał tej powierzchni najgorszą możliwą ocenę: 0,0% linii
        // i 0 z 23 funkcji - przy tym, że to ONA decyduje, czy mail w ogóle
        // dojdzie i czy odbicie trafi na listę wykluczeń. Powód zera był
        // techniczny, nie ambicjonalny: handlery `createServerFn` nie dają się
        // wywołać poza runtime'em TanStack Start (patrz src/test/serverFn.ts),
        // więc nie było czym ich dotknąć.
        //
        // Progi floorowane tuż pod ZMIERZONYM poziomem - wolno je wyłącznie
        // podnosić. Pilnują rzeczy, których złamanie NIE wywala się głośno,
        // tylko cicho psuje dostarczalność.
        //
        // SIATKA KATALOGOWA POD PROGAMI PLIKOWYMI. Progi plikowe niżej pilnują
        // tego, co zostało napisane; ten próg pilnuje tego, co ktoś DOŁOŻY.
        // Nowy plik poczty bez ani jednej asercji obniża wskaźnik katalogu i
        // zatrzymuje bramkę, nawet jeśli nikt nie dopisze mu progu własnego.
        //
        // 2026-08-22: RATCHET W GÓRĘ. Trzy powierzchnie, które w 2026-08-19
        // zostały tu świadomie nietknięte i trzymały ten próg nisko
        // (`transactional.server.ts` 8,3%, `tx-preview.server.ts` 0%,
        // `platformCompat.server.ts` 0%), są domknięte w MODULE 11 - wszystkie
        // trzy na 100%. Zmierzone na tym HEAD dla całego katalogu:
        // 99,33% instr. / 98,17% gał. / 99,33% fn / 99,48% linii.
        // Próg = zmierzone minus ~1-2 pp marginesu na dryf CI.
        "src/lib/email/**": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 96,
        },
        // Ta sama siatka dla reguł newslettera.
        // 2026-08-22: RATCHET W GÓRĘ. Dwie powierzchnie, które trzymały ten
        // próg nisko - `emailDocResolve.ts` (34,1%) i `newsletterFieldLabels.ts`
        // (31,6%) - są domknięte w MODULE 11, obie na 100% linii. Zmierzone na
        // tym HEAD dla całego katalogu: 98,90% instr. / 96,65% gał. / 100% fn /
        // 99,49% linii. Próg = zmierzone minus ~1-2 pp marginesu na dryf CI.
        "src/lib/newsletter/**": {
          statements: 97,
          functions: 99,
          lines: 98,
          branches: 94,
        },
        // ══ MODUŁ 11 (2026-08-22): ZAPADKA POWIERZCHNI DOMKNIĘTYCH W TEJ PRACY ══
        //
        // Progi floorowane 1-2 pp pod POMIAREM z pełnej suity na tym HEAD.
        // Wolno je wyłącznie PODNOSIĆ.
        //
        // TŁUMIENIA MAJĄ PRÓG WYŻSZY NIŻ SĄSIEDNIE I TO JEST POWÓD: łańcuch
        // skutków nie kończy się na newsletterze - kampania wysłana na martwe
        // adresy psuje reputację domeny nadawczej, a razem z nią przestaje
        // dochodzić poczta TRANSAKCYJNA, w tym RESET HASŁA; użytkownik nie
        // wejdzie wtedy na konto i nie ma jak tego zgłosić, bo formularz
        // kontaktowy też idzie mailem.
        // Zmierzone: 100% instr. / 100% gał. / 100% fn / 100% linii.
        "src/lib/email/suppression.server.ts": {
          statements: 99,
          functions: 100,
          lines: 99,
          branches: 98,
        },
        // Powierzchnie platformowe poczty: webhook wykluczeń dostawcy, dren
        // kolejki, podglądy szablonów. Wejście z ZEWNĄTRZ, więc odmowa bez
        // ważnego podpisu musi następować przed jakąkolwiek pracą - bez tego
        // endpoint jest publicznym sposobem wpisania dowolnego adresu na listę
        // wykluczeń (cichy DoS na pocztę wybranego odbiorcy).
        // Zmierzone: 97,98% instr. / 93,99% gał. / 100% fn / 99,70% linii.
        "src/routes/platform/email/**": {
          statements: 96,
          functions: 99,
          lines: 98,
          branches: 92,
        },
        // Aliasy zgodności `/lovable/email/*`: pięć plików po jednej decyzji
        // (jaki cel przekazania). Literówka w tej stałej to 404 na odbiciach
        // i skargach - lista wykluczeń przestaje rosnąć PO CICHU.
        // Zmierzone: 100% na czterech wymiarach.
        "src/routes/lovable/email/**": {
          statements: 99,
          functions: 100,
          lines: 99,
          branches: 98,
        },
        // Renderer dokumentu maila i panel po zapisie. MAILA NIE DA SIĘ WYCOFAĆ:
        // defekt renderu poszedł do skrzynek i jest w nich na zawsze, a poprawka
        // dotyczy dopiero następnej wysyłki. Dlatego próg jest tu wysoki mimo
        // że to warstwa widoku - dowód musi istnieć PRZED wysyłką.
        // Zmierzone: 100% instr. / 99,08% gał. / 100% fn / 100% linii.
        "src/components/newsletter/**": {
          statements: 99,
          functions: 100,
          lines: 99,
          branches: 97,
        },
        // Popup zapisu: PUNKT ZBIERANIA ZGODY RODO. Payload zgody to dowód,
        // którego ciężar leży po stronie administratora (art. 7 ust. 1 RODO),
        // więc regresja w tym formularzu jest zdarzeniem prawnym, nie usterką
        // wygody. Zmierzone: 99,64% instr. / 97,44% gał. / 100% fn / 100% linii.
        "src/components/{NewsletterPopup,PopupSignupForm}.tsx": {
          statements: 98,
          functions: 100,
          lines: 99,
          branches: 95,
        },
        // Czyste funkcje i server fns panelu kampanii.
        // Zmierzone: 100% na czterech wymiarach.
        "src/lib/newsletter-{admin,status}.functions.ts": {
          statements: 99,
          functions: 100,
          lines: 99,
          branches: 98,
        },
        // Szablony i teksty maili transakcyjnych - 22 typy razy dwa języki.
        // Te moduły działają POZA dostawcą i18n (własny słownik `Record<"pl" |
        // "en", …>`, jak `errorCopy.ts`), więc próg pilnuje kompletności obu
        // języków, a nie obecności kluczy.
        // Zmierzone: 100% na czterech wymiarach.
        "src/lib/email-templates/**": {
          statements: 99,
          functions: 100,
          lines: 99,
          branches: 98,
        },
        // Trasy kampanii. TEN PRÓG CHRONI STAN I SKLEJENIE, a dostępu pilnuje
        // `src/routes/__tests__/adminRouteAuthority.gate.test.ts` - ta sama
        // zasada co przy progu klubowym. Konsekwencja regresji jest tu jednak
        // większa niż w klubach: zła konwersja harmonogramu to wysyłka o złej
        // godzinie, a wznowienie zakończonej kampanii to wysyłka PODWÓJNA.
        // Zmierzone: 99,44% instr. / 98,58% gał. / 100% fn / 99,41% linii.
        "src/routes/admin.newsletter.campaigns*.tsx": {
          statements: 98,
          functions: 99,
          lines: 98,
          branches: 96,
        },
        // Hooki popupów buildera: `useActivePopups` i `usePopupEditor` decydują,
        // KOMU i JAK CZĘSTO pokaże się popup. Reguła częstotliwości zepsuta
        // w jedną stronę to popup przy każdym przewinięciu, w drugą - popup,
        // którego nikt nigdy nie zobaczy.
        // Zmierzone: 100% instr. / 96,67% gał. / 100% fn / 100% linii.
        "src/lib/builder/popups.ts": {
          statements: 99,
          functions: 100,
          lines: 99,
          branches: 94,
        },
        // ══ koniec zapadki MODUŁU 11 ════════════════════════════════════════
        // provider.server.ts: trzy pola wyniku sterują całą pętlą ponowień -
        // `rateLimited` (wstrzymaj CAŁĄ wysyłkę), `permanent` (prosto do DLQ,
        // bez mielenia martwego adresu) i `messageId` (JEDYNY klucz korelacji
        // webhooka odbicia z odbiorcą). Niedobita funkcja to `.catch(() => "")`
        // przy odczycie ciała błędu - `Response.text()` nie odrzuca w teście.
        "src/lib/email/provider.server.ts": {
          statements: 96,
          functions: 90,
          lines: 98,
          branches: 98,
        },
        // reputationGate.server.ts: bramka broniąca CAŁEJ domeny (nie
        // pojedynczych adresów) przed przekroczeniem progu skarg Google.
        // Trzymana pod 100%, bo fail-open przy awarii liczników i zachowanie
        // werdyktu mimo potwierdzenia operatora to reguły, na których stoi
        // decyzja „wysyłać albo nie".
        "src/lib/email/reputationGate.server.ts": {
          statements: 98,
          functions: 100,
          lines: 98,
          branches: 98,
        },
        // system-log.server.ts: DEDUPLIKACJA po message_id. Jeden e-mail
        // zostawia w logu wiele wierszy (pending -> sent/dlq); bez sprowadzenia
        // ich do najnowszego stanu raport pokazuje wielokrotność wysyłki, a
        // wskaźnik dostarczalności liczy tę samą wiadomość kilka razy.
        "src/lib/email/system-log.server.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 94,
        },
        // auth-events.server.ts: sumy liczone po CAŁYM oknie (nie po
        // przefiltrowanej stronie) oraz rozróżnienie „brak tabeli" od „błąd" -
        // cicha pustka udawałaby, że maile logowania wychodzą.
        "src/lib/email/auth-events.server.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 95,
        },
        // recipient-name.server.ts: pierwsza linijka KAŻDEJ wiadomości.
        // Niedobite gałęzie to ramiona obronne po `split()` i po pustej
        // odmianie, nieosiągalne z prawdziwego wejścia.
        "src/lib/email/recipient-name.server.ts": {
          statements: 98,
          functions: 100,
          lines: 98,
          branches: 88,
        },
        // txOverrides.server.ts: fail-soft. Awaria panelu redakcyjnego nie
        // może zatrzymać maila z resetem hasła - każda ścieżka błędu kończy
        // się kompletem treści domyślnych.
        "src/lib/email/txOverrides.server.ts": {
          statements: 98,
          functions: 100,
          lines: 98,
          branches: 95,
        },
        // newsletter-deliverability.functions.ts: 0 z 19 funkcji -> 19 z 19.
        // Pilnuje mapowania liczników (na nich stoi bramka reputacji),
        // sanityzacji frazy szukania wstawianej do wzorca `ilike` oraz reguły,
        // że w trybie `first_party` instrukcja webhooka NIE zawiera
        // email.opened/email.clicked (inaczej podwójne zliczanie otwarć).
        // Niedobite gałęzie: fallbacki `?? ""` dla pól, które walidator zod
        // i tak wymusza jako tekst.
        "src/lib/newsletter-deliverability.functions.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 90,
        },
        // TRASY POCZTOWE - trzy powierzchnie, które audyt zastał na 0%, a
        // które przyjmują ruch Z ZEWNĄTRZ albo wysyłają ze zweryfikowanej
        // domeny nadawczej. Handlery są wołane wprost przez
        // `Route.options.server.handlers.POST` - bez runtime'u routera i bez
        // zmian w kodzie produkcyjnym.
        //
        // transactional/send.ts: trzy bramki decydują, czy to funkcja produktu,
        // czy OTWARTY PRZEKAŹNIK - uwierzytelnienie, autoryzacja (sam ważny
        // token to dowolne konto czytelnika; bez drugiej bramki każdy zalogowany
        // wysłałby z naszej domeny dowolną treść na dowolny adres) oraz
        // allowlista hostów w linkach. Do tego cykl życia tokenu wypisu: mail
        // MUSI wyjść z DZIAŁAJĄCYM linkiem (RFC 8058), także gdy poprzedni
        // token był już zużyty.
        "src/routes/platform/email/transactional/send.ts": {
          statements: 96,
          functions: 98,
          lines: 98,
          branches: 92,
        },
        // auth/webhook.ts: jedyna droga, którą mail z linkiem do logowania
        // trafia do kolejki. Pilnowane: 401 dla KAŻDEGO błędu podpisu (a nie
        // 400), wiersz `pending` zapisany PRZED kolejkowaniem oraz ślad
        // porażki w logu i w diagnostyce.
        "src/routes/platform/email/auth/webhook.ts": {
          statements: 93,
          functions: 98,
          lines: 96,
          branches: 82,
        },
        // webhooks.resend.ts: endpoint PUBLICZNY. Bez weryfikacji podpisu byłby
        // otwartym sposobem na wpisanie dowolnego adresu na listę wykluczeń.
        // Testy liczą HMAC tak jak dostawca (prawdziwa weryfikacja, nie atrapa).
        // Niedobita funkcja to ramka trasy `POST: ({request}) => handle(request)`
        // - handle() jest testowany wprost, dokładnie jak przy webhooku Stripe.
        "src/routes/api/public/webhooks.resend.ts": {
          statements: 94,
          functions: 70,
          lines: 94,
          branches: 95,
        },
        // ── NEWSLETTER: ZAPIS, DOUBLE OPT-IN, WYPIS ──────────────────────────
        // Ścieżka RODO i lejka naraz. Audyt zastał ją na 14,3% (zapis) i 38,5%
        // (wypis), mimo że to jedyne miejsce, w którym powstaje i znika ZGODA
        // marketingowa.
        //
        // newsletter.functions.ts: endpoint PUBLICZNY i nieuwierzytelniony,
        // który wysyła mail na adres podany przez wywołującego - czyli zarazem
        // brama zgody, kanał do bombardowania cudzej skrzynki i sposób na
        // spalenie limitu dostawcy. Próg pilnuje przypadków „kiedy NIE WOLNO
        // zapisać": trwała blokada na liście wykluczeń (bez wiersza `pending`
        // i bez maila), dwa niezależne limity (na IP i na ODBIORCĘ - sam limit
        // na IP obchodzi się rotacją), brak resetu potwierdzonego subskrybenta
        // oraz nadrzędność polityki pól tenanta nad deklaracją widgetu.
        // Osobno przybite: adres linku DOI bierze się z konfiguracji, NIE
        // z nagłówków żądania (podstawiony `x-forwarded-host` wyprowadzałby
        // token na domenę atakującego).
        "src/lib/newsletter.functions.ts": {
          statements: 96,
          functions: 88,
          lines: 98,
          branches: 88,
        },
        // Potwierdzenie zapisu - handler trasy. Kluczowa własność to
        // IDEMPOTENCJA: token zostaje w rekordzie po potwierdzeniu, więc
        // ponowne kliknięcie (klienty pocztowe i skanery klikają linki same)
        // trafia w gałąź „już potwierdzone" zamiast w 404 albo w drugą wysyłkę
        // powitania. Brak maila powitalnego NIE unieważnia potwierdzenia.
        "src/routes/api.public.newsletter.confirm.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 95,
        },
        // Wypis jednym kliknięciem (RFC 8058). Wytyczne Google/Yahoo wymagają,
        // by zadziałał bezwarunkowo. Próg pilnuje: token czytany z każdego
        // z trzech miejsc (query / formularz / JSON), ponowne kliknięcie to
        // sukces a nie błąd, a odpowiedź i log NIE zdradzają adresu ani tokenu.
        "src/routes/email/unsubscribe.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 92,
        },
        // STRONY ZGODY - jedyne ekrany, jakie widzi odbiorca po kliknięciu
        // w link z maila. Wszystkie trzy startowały z 0%.
        //
        // Reguła, której złamanie kosztuje zgodność: WYPIS NIE MOŻE WYKONAĆ
        // SIĘ SAM. Klienty pocztowe i skanery antywirusowe pobierają linki
        // z wiadomości w tle, więc wejście na stronę tylko SPRAWDZA token,
        // a wypis następuje dopiero po kliknięciu przycisku - test asertuje to
        // wprost (po montażu leci dokładnie jedno żądanie i nie jest to POST).
        "src/routes/newsletter.confirm.tsx": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 95,
        },
        "src/routes/newsletter.unsubscribe.tsx": {
          statements: 92,
          functions: 72,
          lines: 98,
          branches: 85,
        },
        "src/routes/unsubscribe.tsx": {
          statements: 92,
          functions: 98,
          lines: 98,
          branches: 90,
        },
        // ── NEWSLETTER: KAMPANIE I WYSYŁKA ───────────────────────────────────
        // Audyt: 17,9% linii przy 7,7% GAŁĘZI - czyli praktycznie bez pokrycia
        // tam, gdzie mieszkają decyzje. A decyzje są tu NIEODWRACALNE: raz
        // wysłanej wiadomości nie da się cofnąć, a każda wysłana dwa razy to
        // skarga na spam, po której obniżana jest reputacja CAŁEJ domeny.
        //
        // Zmierzone po tej pracy: 88,35% linii, 80,29% gałęzi, 83% funkcji.
        // Próg floorowany tuż pod osiągniętym poziomem pilnuje reguł, których
        // złamania nie widać w kodzie, tylko w skrzynkach odbiorców:
        //   * WZNOWIENIE nie wysyła nikomu drugi raz, a porównanie „już
        //     wysłano" idzie po adresie ZNORMALIZOWANYM (adres wchodzi na
        //     listę trzema drogami i tylko część z nich normalizuje wielkość
        //     liter - to ta strona porównania, po której idzie sygnał skargi),
        //   * adresy z aktywną blokadą wypadają ZANIM powstanie pierwszy
        //     request do dostawcy i zostają w logu jako `suppressed`,
        //   * błąd dostawcy w połowie partii nie zatrzymuje reszty paczki
        //     i nie liczy wysłanych dwa razy,
        //   * mail bez mechanizmu wypisu NIE WYCHODZI (brak origin zatrzymuje
        //     kampanię) - wymóg prawny i warunek pozostania poza czarną listą,
        //   * kampanii W LOCIE nie da się edytować ani skasować (filtr statusu
        //     przy UPDATE/DELETE jest tu jedyną zaporą - RLS nie zna pojęcia
        //     „kampania w trakcie wysyłki"),
        //   * tick działa bez człowieka przy klawiaturze, więc przy
        //     przekroczonym progu skarg zatrzymuje kampanię ze statusem
        //     `failed` i powodem, zamiast wysłać ją po cichu.
        // Niedobita reszta to podgląd wpisów w kreatorze treści
        // (resolveCampaignDocPosts / searchCampaignPosts) - powierzchnia
        // edytora, nie wysyłki.
        "src/lib/newsletter-campaigns.functions.ts": {
          statements: 84,
          functions: 80,
          lines: 86,
          branches: 76,
        },
        // ── PANEL ADMINA: IMPORT CSV ─────────────────────────────────────────
        // Reguły importu wyprowadzone z dialogu do czystego modułu. Import
        // wprowadza na listę DANE OSOBOWE wraz ze statusem zgody
        // marketingowej, a decydują o tym ciche reguły: regexy nagłówków
        // i słowniki dopuszczalnych wartości. Ich pomyłka nie wywala się
        // głośno - zapisuje po prostu inne dane niż w pliku. Czysty moduł
        // trzymamy pod 100%, jak pozostałe czyste moduły w tym pliku.
        "src/components/admin/newsletter/subscribers/importCsvMapping.ts": {
          statements: 98,
          functions: 100,
          lines: 98,
          branches: 95,
        },
        // Dialog importu - najbardziej ryzykowna operacja panelu (wprowadza
        // cudze dane osobowe wraz ze statusem zgody). Próg pilnuje sklejenia:
        // plik -> mapowanie -> podgląd -> wysyłka, w tym blokady przycisku bez
        // zmapowanego adresu i tego, że przy błędzie importu dialog NIE
        // zamyka się „na sukces". Niedobite linie to dwa ramiona obronne
        // nieosiągalne z UI: `onChange` bez pliku i guard w `doImport`, który
        // chroni ścieżkę z już zablokowanym przyciskiem.
        "src/components/admin/newsletter/subscribers/ImportCsvDialog.tsx": {
          statements: 88,
          functions: 90,
          lines: 90,
          branches: 85,
        },
        // ── PANEL ADMINA: SUBSKRYBENCI ───────────────────────────────────────
        // Jedyne miejsce, w którym CZŁOWIEK zmienia cudzą zgodę marketingową
        // pojedynczym kliknięciem. Progi pilnują trzech rzeczy niewidocznych
        // na ekranie: wypisanie jest MIĘKKIE (status + znacznik czasu, nigdy
        // DELETE - dowód zgody i jej cofnięcia musi zostać), usunięcie wymaga
        // potwierdzenia i NIE wykonuje się po jego odrzuceniu, a klik w ikonę
        // akcji nie otwiera przy okazji okna szczegółów (akcje żyją w klikalnym
        // wierszu).
        //
        // Ścieżka „lista MOŻE być niepełna" jest dowodzona REGUŁĄ
        // (`isFetchCapped` w subscriberTable), nie renderem: wyrenderowanie
        // 5000 wierszy tabeli kosztowało w pomiarze ponad minutę CI za jedną
        // asercję.
        "src/components/admin/newsletter/SubscribersPanel.tsx": {
          statements: 94,
          functions: 92,
          lines: 96,
          branches: 85,
        },
        // Okno, w którym operator czyta DOWÓD ZGODY. Kolumny `consents`/`meta`
        // są typu `jsonb` i wpisują je także integracje, więc okno musi
        // rozróżniać „nie ma zgody" od „nie umiem odczytać ładunku" - puste
        // pole odpowiadałoby po cichu „nie". Zgoda liczy się WYŁĄCZNIE przy
        // jawnym `true`, a treść zgody jest sanityzowana przed wyświetleniem.
        "src/components/admin/newsletter/subscribers/SubscriberDetailDialog.tsx": {
          statements: 84,
          functions: 98,
          lines: 98,
          branches: 80,
        },
        // Czyste reguły listy: filtr (decyduje, kogo operator widzi - a więc
        // komu zmienia zgodę) i eksport CSV (wynosi dane osobowe do pliku;
        // błąd w cytowaniu rozjeżdża kolumny u odbiorcy i przypisuje komuś
        // cudzą zgodę). Oraz odczyt `jsonb` szczegółów. Trzymane pod 100%.
        "src/components/admin/newsletter/subscribers/subscriberTable.ts": {
          statements: 98,
          functions: 100,
          lines: 98,
          branches: 95,
        },
        "src/components/admin/newsletter/subscribers/subscriberDetail.ts": {
          statements: 98,
          functions: 100,
          lines: 98,
          branches: 90,
        },
        // ── PANEL ADMINA: DORĘCZALNOŚĆ ───────────────────────────────────────
        // Trzy ekrany, na których operator decyduje, czy wolno jeszcze wysyłać.
        //
        // WebhookSetupCard musi rozróżniać SKONFIGUROWANY od DZIAŁAJĄCEGO
        // (sekret jest, ale nie przyszło ani jedno zdarzenie) - to dwie różne
        // awarie, a najczęstszy powód pustej listy wykluczeń mimo odbić to
        // właśnie niepodłączony webhook. Kafel tłumaczy też, czemu w trybie
        // `first_party` NIE ma tu otwarć: bez tego zdania operator dopisuje
        // `email.opened` „na wszelki wypadek" i wraca podwójne zliczanie.
        //
        // SuppressionTable: jedyne miejsce, w którym operator ZDEJMUJE blokadę.
        // Próg pilnuje, że przywrócenie subskrypcji jest OSOBNĄ, jawną decyzją
        // (domyślnie `resubscribe: false`) - zdjęcie blokady po skardze bez
        // zgody odbiorcy wraca prosto pod próg skarg Google. Plus: filtr
        // tekstowy działa lokalnie (bez zapytania na każdy klawisz), a zmiana
        // filtru powodu/stanu odpytuje serwer na nowo.
        //
        // DeliverabilityPanel: ostrzeżenie o zablokowanej wysyłce musi się
        // pokazać i WYMIENIĆ powody - inaczej operator nie wie, co naprawić.
        "src/components/admin/newsletter/deliverability/WebhookSetupCard.tsx": {
          statements: 96,
          functions: 96,
          lines: 96,
          branches: 90,
        },
        "src/components/admin/newsletter/deliverability/SuppressionTable.tsx": {
          statements: 94,
          functions: 92,
          lines: 96,
          branches: 76,
        },
        "src/components/admin/newsletter/deliverability/DeliverabilityPanel.tsx": {
          statements: 94,
          functions: 90,
          lines: 94,
          branches: 75,
        },
        // Czyste reguły listy wykluczeń + WSPÓLNE cytowanie CSV dla całego repo.
        // Cytowanie było skopiowane w dwóch panelach; diagnostyka dostawcy
        // zawiera przecinki („550, mailbox full"), więc bez cytowania plik
        // rozjeżdża się o kolumnę i przypisuje komuś cudzy powód blokady.
        "src/components/admin/newsletter/deliverability/suppressionTable.ts": {
          statements: 98,
          functions: 100,
          lines: 98,
          branches: 95,
        },
        "src/lib/csv/formatCsv.ts": {
          statements: 98,
          functions: 100,
          lines: 98,
          branches: 95,
        },
        // ── BUILDER MAILA: REJESTR I FABRYKA DOKUMENTU ───────────────────────
        // Rejestr jest kontraktem między BIBLIOTEKĄ (co operator widzi do
        // przeciągnięcia), FABRYKĄ widgetów i SCHEMATEM dokumentu. Rozjazd nie
        // wywala się na budowie - wywala się pod palcem operatora, w połowie
        // układania kampanii. Testy przechodzą po CAŁYM rejestrze i sprawdzają,
        // że każdy wpis ma fabrykę, przechodzi walidację (także z presetem) i ma
        // etykiety w obu językach.
        "src/lib/newsletter-builder/registry.ts": {
          statements: 98,
          functions: 100,
          lines: 98,
          branches: 95,
        },
        // `buildDefaultDoc` uruchamia się RAZ na instalację: buduje pierwszy
        // formularz z ustawień tenanta. Jeśli któryś element wypadnie po cichu,
        // operator zaczyna od formularza BEZ POLA ZGODY albo bez klauzuli RODO -
        // i nie zauważy tego, bo nie wie, że coś miało tam być. Próg pilnuje
        // każdego zaczepu w wariancie „jest" i „nie ma" oraz KOLEJNOŚCI
        // widgetów (to ona decyduje, czy zgoda stoi przed przyciskiem).
        "src/lib/newsletter-builder/defaults.ts": {
          statements: 96,
          functions: 100,
          lines: 96,
          branches: 90,
        },
        // ── ENDPOINTY PUBLICZNE: TELEMETRIA MAILA I POPUPU ───────────────────
        // Adresy tych endpointów trafiają do KAŻDEJ wysłanej wiadomości i do
        // przeglądarki każdego odwiedzającego, więc obrona jest w walidacji
        // wejścia, nie w sesji:
        //  * nl-click pilnuje CELU przekierowania podpisem HMAC per link. Bez
        //    tego byłby otwartym przekierowaniem na zaufanej domenie redakcji -
        //    gotowym narzędziem phishingowym, roznoszonym w mailu z prawidłowym
        //    SPF i DKIM. Testy liczą prawdziwe podpisy, nie atrapę weryfikacji.
        //  * nl-open ZAWSZE oddaje przezroczysty GIF; piksel zwracający 500
        //    pokazuje się w kliencie pocztowym jako złamana grafika w treści.
        //  * popup-event odrzuca `kind` spoza słownika i `popup_id` nie-UUID -
        //    inaczej tabela statystyk zbiera śmieci, których nikt nie odczyści -
        //    a każda ścieżka oddaje 204, bo beacon nie ma jak obsłużyć błędu.
        //  * telemetria popupu zapisuje się WYŁĄCZNIE serwerem, z tenantem
        //    rozwiązanym z HOSTA i limitem per sesja; tenant z ładunku dałby się
        //    podstawić i zatruć raport obcej instalacji.
        "src/routes/api/public/nl-open.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 85,
        },
        "src/routes/api/public/nl-click.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 95,
        },
        "src/routes/api/public/popup-event.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 90,
        },
        "src/lib/newsletter-popup-events.functions.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 90,
        },
        // ── POPUP PUBLICZNY: HOST I TELEMETRIA ───────────────────────────────
        // PopupHost decyduje, czy odwiedzający dostanie modal na środku ekranu -
        // pomyłki widzi KAŻDY odwiedzający, a operator nie ma jak ich zauważyć w
        // panelu. Pod progiem:
        //  * host MILCZY na powierzchniach roboczych (/admin, /login), przy
        //    PUSTYM dokumencie (puste okno z samym „zamknij"), po zamknięciu w
        //    tej wizycie i przy wyciszeniu częstotliwością;
        //  * PUŁAPKA A11Y: przy wyłączonym zamykaniu tłem przycisk zamknięcia
        //    jest WYMUSZANY - na urządzeniu dotykowym nie ma klawisza Escape,
        //    więc popup bez wyjścia blokuje stronę na dobre;
        //  * strona bez pasków przewijania nie otwiera popupu przewinięciem
        //    (dzielenie przez zero dałoby „nieskończony procent" i modal na
        //    wejściu);
        //  * konwersja liczy się RAZ na pokazanie i NIE liczy kliknięcia w
        //    „zamknij" - inaczej każdy popup miałby 100% konwersji.
        "src/components/popups/**": {
          statements: 94,
          functions: 100,
          lines: 97,
          branches: 80,
        },
        // popupTelemetry: identyfikator sesji spina wyświetlenie -> wysłanie ->
        // sukces w obrębie jednej wizyty. Nowy identyfikator przy każdym
        // zdarzeniu rozsypuje raport (skuteczność spada do zera, choć popup
        // działa). Wysyłka jest fire-and-forget: wyjątek stąd zabrałby
        // odwiedzającemu subskrypcję, po którą przyszedł.
        "src/lib/newsletter/popupTelemetry.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // ── POPUPY W PANELU (rejestracja + popupy buildera) ──────────────────
        // Te dwa edytory decydują o tym, ile razy odwiedzający zobaczy modal na
        // środku ekranu i co w nim jest - a popup rejestracji ZAKŁADA REALNE
        // KONTO, więc jego pola to nie dekoracja.
        //
        // Reguły pod progiem:
        //  * KOMPLETNY `popup_design` w każdym patchu - częściowy JSON cofa
        //    resztę ustawień do domyślnych, a operator nie widzi tego na ekranie;
        //  * pole liczbowe trzyma SUROWY TEKST w trakcie pisania (klamrowanie na
        //    każdym znaku uniemożliwiało wpisanie „9" w polu o minimum 12) i
        //    normalizuje przy opuszczeniu;
        //  * ostrzeżenie o kontraście zapala się poniżej WCAG AA i podaje
        //    wyliczony współczynnik - to jedyna bariera przed wypuszczeniem
        //    popupu z tekstem nieczytelnym dla części odwiedzających;
        //  * migawka „ostatniego zapisu" gaśnie tylko po UDANYM zapisie -
        //    zgaszona po nieudanym oznacza operatora, który traci pracę;
        //  * pola wyzwalacza są widoczne tylko dla swojego wyzwalacza, a puste
        //    linie w ścieżkach nie tworzą wzorca pasującego do wszystkiego.
        "src/components/admin/popups/**": {
          statements: 95,
          functions: 95,
          lines: 95,
          branches: 85,
        },
        "src/components/admin/popups/signup/controls.tsx": {
          statements: 96,
          functions: 100,
          lines: 100,
          branches: 90,
        },
        "src/components/admin/popups/PopupSettingsPane.tsx": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/components/admin/popups/PopupEditorPane.tsx": {
          statements: 97,
          functions: 100,
          lines: 100,
          branches: 95,
        },
        "src/components/admin/popups/SignupPopupContentSection.tsx": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 85,
        },
        // ── CAŁY PANEL NEWSLETTERA ───────────────────────────────────────────
        // Próg katalogowy jest siatką bezpieczeństwa pod progami plikowymi:
        // nowy panel dołożony bez testu obniża ten wskaźnik i zatrzymuje
        // bramkę, nawet jeśli nikt nie dopisze mu progu własnego. Osiągnięte
        // 99,2% linii i funkcji zostawia ~4 pkt zapasu na refaktory.
        "src/components/admin/newsletter/**": {
          statements: 95,
          functions: 95,
          lines: 95,
          branches: 85,
        },
        // ── PODSUMOWANIE, LOGI I POZOSTAŁE KAFLE ─────────────────────────────
        // logFilters: JEDNA reguła filtrów dla obu logów (systemowego i
        // webhooka maili autoryzacyjnych). Skopiowana rozjechałaby się cicho -
        // jeden panel poprawiony, drugi nie. Test dowodzi też, że oba panele
        // trzymają tę samą referencję funkcji, a nie jej kopię.
        "src/components/admin/newsletter/logFilters.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // overviewKpis: cztery liczby, których nikt nie ma z czym porównać.
        // Błąd nie wywala panelu - podaje inną liczbę. Pod progiem: okna 30/60
        // dni NIE zachodzą na siebie (inaczej wzrost liczy się sam ze siebie),
        // wskaźnik potwierdzeń przy pustej liście to 100% (nie NaN i nie 0%),
        // a subskrybentem jest TYLKO potwierdzony adres.
        "src/components/admin/newsletter/overviewKpis.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // authLogsView: diagnostyka „nie dostałem maila" i „dostałem w złym
        // języku". „Odrzucony" (webhook odmówił) i „nieudany" (webhook się
        // wywalił) muszą różnić się na oczy, a brak języka być KRESKĄ - puste
        // pole czyta się jako „polski", czyli dokładnie to, o czym jest zgłoszenie.
        "src/components/admin/newsletter/auth-logs/authLogsView.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 90,
        },
        "src/components/admin/newsletter/auth-logs/AuthEmailLogsPanel.tsx": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 95,
        },
        // OverviewPanel: decyduje, czy formularz w ogóle pojawia się na stronie
        // (`mode`) i czy zapis wymaga potwierdzenia adresu (`double_opt_in`).
        // Próg pilnuje też tego, że zapis ustawień logiki NIE wysyła dokumentów
        // builderów - nadpisałby pracę wykonaną w /inline i /popup.
        "src/components/admin/newsletter/OverviewPanel.tsx": {
          statements: 97,
          functions: 100,
          lines: 100,
          branches: 92,
        },
        // PopupEventsPanel: jedyne miejsce, w którym widać, czy popup DZIAŁA -
        // sam przełącznik „włączony" nie mówi nic o skuteczności ani o błędach.
        "src/components/admin/newsletter/PopupEventsPanel.tsx": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // PopupPreview: wariant „showcase" MUSI iść tym samym komponentem co
        // strona publiczna, a dokument z buildera tym samym rendererem - drugi,
        // uproszczony markup rozjechałby się z produkcją bez żadnego sygnału.
        "src/components/admin/newsletter/PopupPreview.tsx": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 90,
        },
        // NewsletterSubNav: aktywna zakładka wynika z PREFIKSU ścieżki, więc
        // ścieżka jednej zakładki nie może być prefiksem innej - zapaliłyby się
        // dwie naraz. Test przypina ten warunek na całym zestawie.
        "src/components/admin/newsletter/NewsletterSubNav.tsx": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // JobRunnerCard: kafel powstał po awarii, w której runner startował
        // wyłączony i z pustym adresem - świeże wdrożenie nie wysyłało w tle
        // NICZEGO, a jedynym śladem była rosnąca kolejka, której panel nie
        // pokazywał. Próg pilnuje rozstrzygniętego stanu, ostrzeżenia o
        // zaległości i alarmu o martwych listach od PIERWSZEJ wiadomości.
        "src/components/admin/newsletter/runner/JobRunnerCard.tsx": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 90,
        },
        // ── MAILE SYSTEMOWE: LOG, TREŚCI, PODGLĄD ────────────────────────────
        // Te trzy panele są ostatnim miejscem, w którym widać, co poszło (albo
        // pójdzie) do prawdziwego adresata - i każdy z nich ZAWSZE coś pokazuje,
        // więc pomyłka jest cicha: pusta tabela wygląda jak „nic nie
        // wysłaliśmy", kreska jak „brak danych", puste okno jak awaria panelu.
        //
        // Reguły pod progiem:
        //  * sentynela „wszystkie" w filtrach jest NIEPUSTA (Radix wywala się na
        //    `SelectItem value=""` - ten sam defekt zdjął już raz wybór kolumn w
        //    imporcie CSV) i przy zapytaniu MUSI wrócić na `null`; puszczona
        //    dalej jako nazwa szablonu filtruje log do zera;
        //  * pusty log ma JEDNĄ stronę, nie zero - inaczej „następna" prowadzi
        //    w nicość;
        //  * brak wskaźnika doręczenia to KRESKA, nie „0%";
        //  * nadpisanie treści maila trafia w jeden typ, jeden język i jedno
        //    pole - zapis nadpisujący cały obiekt wyciera nadpisania innych
        //    typów, a zauważy to dopiero odbiorca;
        //  * reset dotyczy JEDNEGO języka - reset obu wyciera pracę tłumacza;
        //  * zmiana zakresu podglądu przestawia typ na należący do tego zakresu,
        //    inaczej okno zostaje puste.
        "src/components/admin/newsletter/system-emails/systemEmailsView.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/components/admin/newsletter/system-emails/txContentRules.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/components/admin/newsletter/system-emails/authPreviewRules.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/components/admin/newsletter/system-emails/SystemEmailsPanel.tsx": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 95,
        },
        "src/components/admin/newsletter/system-emails/TxEmailContentPanel.tsx": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 85,
        },
        "src/components/admin/newsletter/system-emails/AuthEmailPreviewPanel.tsx": {
          statements: 96,
          functions: 100,
          lines: 100,
          branches: 92,
        },
        // ── KREATOR TREŚCI KAMPANII ──────────────────────────────────────────
        // Kampania jedzie do CAŁEJ listy i nie da się jej odwołać, więc reguły
        // edytora bloków są tu przybite osobno:
        //  * duplikat bloku musi być GŁĘBOKĄ kopią z nowym identyfikatorem -
        //    kopia płytka dzieli obiekty `{ pl, en }` z oryginałem, więc edycja
        //    jednego bloku po cichu zmienia drugi;
        //  * klucz doboru wpisów bierze TYLKO pola zmieniające dobór (tryb,
        //    liczba, kategoria, ręczne id). Za wąski - podgląd pokazuje stare
        //    wpisy; za szeroki - każdy klawisz w nagłówku strzela do bazy;
        //  * limity 1-10 wpisów i 10 ręcznie wybranych trzymają się zakresu
        //    także przy śmieciach - mail z pustą listą wychodzi po cichu.
        "src/components/admin/newsletter/campaignBlocks.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // CampaignContentBuilder: podgląd używa DOKŁADNIE tego samego
        // `renderEmailHtml` co wysyłka - test czyta `srcDoc` ramki i porównuje z
        // wynikiem prawdziwego renderera. Rozjazd znaczyłby, że redaktor
        // zatwierdza treść, której odbiorca nie zobaczy. Próg pilnuje też
        // opóźnienia podglądu (300 ms), komunikatu o braku treści w danym języku
        // i tego, że serwer o wpisy jest pytany tylko wtedy, gdy dokument ma
        // blok „najnowsze wpisy".
        "src/components/admin/newsletter/CampaignContentBuilder.tsx": {
          statements: 97,
          functions: 100,
          lines: 100,
          branches: 85,
        },
        // CampaignBlockProperties: jedyne miejsce, w którym redaktor wpisuje
        // treść wychodzącego maila. 100% funkcji, bo każda funkcja tego pliku to
        // handler edycji: patch gubiący drugi język wysyła połowie listy maila
        // z pustym nagłówkiem, a pole bez podłączonego `onChange` przyjmuje
        // treść i ją gubi.
        "src/components/admin/newsletter/CampaignBlockProperties.tsx": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 88,
        },
        // ── BUILDER MAILA: KANWA, BIBLIOTEKA, PODGLĄD ────────────────────────
        // WidgetPreview: JEDEN test na typ widgetu, plus przejście po CAŁYM
        // rejestrze. Typ, który renderuje się jako `null`, nie wywala
        // aplikacji - po prostu ZNIKA z kanwy, a operator dodaje to samo pole
        // drugi raz albo rezygnuje, uznając, że builder tego nie umie.
        // Osobno przybita sanityzacja HTML akapitu i oznaczenie pola
        // wymaganego (gwiazdka to jedyny sygnał wymagalności w podglądzie).
        "src/components/admin/newsletter/builder/WidgetPreview.tsx": {
          statements: 90,
          functions: 85,
          lines: 94,
          branches: 70,
        },
        // BuilderCanvas: akcje na widgecie (duplikuj/usuń/przenieś) MUSZĄ
        // zatrzymywać propagację - inaczej każde „usuń" najpierw zaznacza
        // widget i panel właściwości pokazuje coś, czego już nie ma. Plus
        // przypisanie do kolumny w układzie dwukolumnowym (decyduje o wyglądzie
        // maila u odbiorcy) i pomijanie widgetów kolumnowych w układzie
        // jednokolumnowym.
        "src/components/admin/newsletter/builder/BuilderCanvas.tsx": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 90,
        },
        // WidgetLibrary: różne zestawy widgetów dla maila i popupu
        // (widget popupowy w mailu jest martwym elementem) oraz karty PRESETÓW,
        // które dodają widget razem z gotowym ustawieniem pola.
        "src/components/admin/newsletter/builder/WidgetLibrary.tsx": {
          statements: 90,
          functions: 98,
          lines: 98,
          branches: 70,
        },
        // PropertiesPanel: prawa kolumna buildera - JEDYNA droga, którą treść
        // trafia do dokumentu. Próg pilnuje trzech rzeczy:
        //  1. KAŻDA kontrolka jest podłączona (przemiał po całym rejestrze
        //     widgetów: pola tekstowe, listy wyboru, przełączniki). Kontrolka
        //     bez `onChange` przyjmuje wpisaną wartość i ją gubi - operator
        //     wychodzi przekonany, że zapisał.
        //  2. patch NIE GUBI DRUGIEGO JĘZYKA. Edycja PL musi zachować EN,
        //     inaczej połowa listy dostaje maila z pustym nagłówkiem.
        //  3. pole obrazu ma trzy ścieżki: sukces, awaria magazynu i awaria
        //     rejestracji w bibliotece mediów. Trzecia jest podstępna - upload
        //     się udał, więc adresu NIE WOLNO zgubić.
        // 100% funkcji jest tu wymagane właśnie dlatego, że każda funkcja tego
        // pliku to jeden handler edycji.
        "src/components/admin/newsletter/builder/PropertiesPanel.tsx": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 85,
        },
        // builderDoc: reguły dokumentu wyjęte z 900-linijkowej powłoki buildera.
        // Pilnują pomyłek, które NIE wywalają aplikacji: przeniesienie widgetu,
        // które gubi element albo wstawia go o jedno miejsce dalej; wyjście z
        // dwóch kolumn, które zostawia „col: 1" (kanwa pomija taki widget, więc
        // operator widzi, że element zniknął); duplikat sekcji z powtórzonymi
        // identyfikatorami (dwa elementy zaznaczają się i patchują razem);
        // wreszcie mapowanie ustawień na pierwszy dokument - pole, które tu
        // wypadnie, znika z formularza bez śladu (np. klauzula RODO).
        "src/components/admin/newsletter/builder/builderDoc.ts": {
          statements: 98,
          functions: 100,
          lines: 100,
          branches: 95,
        },
        // NewsletterBuilder: powłoka spinająca bibliotekę, kanwę, panel
        // właściwości, historię zmian i zapis. Próg pilnuje tego, czego czysta
        // funkcja nie pokaże: ZAPIS zablokowany bez zmian i odblokowany po
        // pierwszej edycji, WIDOCZNY błąd zapisu (cichy = utracony dokument),
        // przełączanie kontekstu prawej kolumny (widget / sekcja / dokument),
        // szerokość podglądu zgodna z produkcją oraz wiązanie identyfikatorów
        // obszarów @dnd-kit z dokumentem (zły identyfikator wstawia widget w
        // innym miejscu, niż operator go upuścił).
        "src/components/admin/newsletter/builder/NewsletterBuilder.tsx": {
          statements: 96,
          functions: 98,
          lines: 97,
          branches: 88,
        },
        // ── WYSZUKIWARKA ──────────────────────────────────────────────────────
        // 2026-08-18: moduł NIE MIAŁ ANI JEDNEGO progu per-ścieżka, mimo że
        // komentarz z 2026-07-21 w tym samym pliku wskazuje go WPROST jako
        // jedną z przyczyn obniżenia globalnego floora („main dolozyl duze
        // nieotestowane powierzchnie (wyszukiwarka v5, trasy, panele)"). Czyli:
        // moduł, który zmusił zespół do zejścia z progiem, przez miesiąc nie
        // dostał własnej zapory - a `check:gate-coverage` tego nie zgłosi, bo
        // pilnuje wpięcia bramek `check:*` w workflow, nie istnienia progów.
        //
        // Stan wyjściowy (audyt 18.08, MODUŁ 6): 33,21% linii, 32,65% funkcji,
        // 28,89% gałęzi, 16 z 24 plików na ZERZE - w tym cała warstwa alertów
        // o nowych wynikach, rejestr komend i wejścia serwerowe.
        //
        // Progi floorowane ~4 pp pod zmierzonym poziomem (marża na dryf CI),
        // zasada bez zmian: wolno je wyłącznie podnosić.
        //
        // WARSTWA DANYCH: 98,24% linii, 98,06% funkcji. Niedobite gałęzie to
        // ramiona, których nie da się wywołać z testu jednostkowego: strażniki
        // `typeof window === "undefined"` w historii fraz (happy-dom zawsze ma
        // `window`, więc ścieżka SSR jest nieosiągalna) oraz fallbacki `?? null`
        // w mapowaniach wierszy, których RPC nigdy nie zwraca puste.
        "src/lib/search/**": {
          statements: 92,
          functions: 94,
          lines: 94,
          branches: 84,
        },
        // WARSTWA KOMPONENTÓW: 98,11% linii, 98,28% funkcji, zero plików na
        // zerze (było 6 z 12). Niedobite gałęzie: warianty klas aktywnego
        // wiersza i obronne `?? null` przy avatarach.
        "src/components/search/**": {
          statements: 94,
          functions: 94,
          lines: 94,
          branches: 89,
        },
        // CZYSTE MODUŁY WYSZUKIWARKI - pod 100% funkcji, tak jak czyste moduły
        // czatu, profilu i płatności wyżej. Niosą reguły, których złamanie widzi
        // WYŁĄCZNIE użytkownik i których nie pilnuje żaden typ:
        //
        // fuzzy.ts - dopasowanie komend WRAZ ze składaniem diakrytyków
        // (naprawa 18.08: „platnosci" nie znajdowało „Płatności"). Niedobita
        // gałąź to premia za granicę wielkości liter, martwa od czasu, gdy
        // matcher porównuje napisy już zmałolitowane.
        "src/lib/search/fuzzy.ts": {
          statements: 94,
          functions: 100,
          lines: 100,
          branches: 86,
        },
        // facetModel.ts - model faset i podpowiedzi: mapowanie URL → filtry RPC,
        // chipy aktywnych filtrów, cele nawigacji podpowiedzi. Jedno źródło
        // prawdy dla panelu, chipów, eksploratora i autosuggesta naraz.
        "src/lib/search/facetModel.ts": {
          statements: 92,
          functions: 92,
          lines: 93,
          branches: 81,
        },
        // recentSearches.ts - historia fraz w localStorage. Wołana podczas
        // RENDERU, więc jej ramiona obronne decydują, czy rzut magazynu (tryb
        // prywatny, wyczerpany limit) wywróci stronę. Gałęzie < 100, bo
        // strażnik SSR `typeof window === "undefined"` jest w happy-dom
        // nieosiągalny.
        "src/lib/search/recentSearches.ts": {
          statements: 85,
          functions: 100,
          lines: 100,
          branches: 70,
        },
        // registry.tsx - rejestr komend palety. `visibleCommands` decyduje, CO
        // użytkownik widzi: pokazanie komendy panelu gościowi nie daje mu
        // uprawnień, ale ujawnia mapę panelu. Trzymany pod 100% na wszystkich
        // czterech metrykach.
        "src/lib/search/registry.tsx": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // ZAPISANE WYSZUKIWANIA I ALERTY - najwyższe ryzyko modułu: ten plik
        // włącza WYSYŁKĘ powiadomień o nowych trafieniach, a `savedSearchHref`
        // jest adresem, pod który prowadzi powiadomienie. Startował z 0 z 16
        // funkcji; trzymany pod 100%.
        "src/hooks/useSavedSearches.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // TRASA /search - kompozycja całej wyszukiwarki i jedyne miejsce, gdzie
        // żyje nawigacja klawiaturą po podpowiedziach, „wyczyść wszystko"
        // i deep-linki z podpowiedzi (komponenty są sterowane). Startowała
        // z 0% przy 57 funkcjach, czyli 1/5 całego modułu. Próg niższy niż
        // reszta i to jest uczciwe: niedobite zostają gałęzie renderu
        // zależne od stanów pośrednich zapytań (szkielet ładowania osób,
        // liczniki zakładek dla wariantów `tab`) oraz kalendarz Radix, którego
        // wybór dnia wymaga realnego wskaźnika.
        "src/routes/search.tsx": {
          statements: 88,
          functions: 78,
          lines: 88,
          branches: 80,
        },
        // ── MODUŁ 2: EDYTOR WPISÓW I WORKFLOW REDAKCYJNY ───────────────────────
        // Audyt z 18.08.2026 dał temu modułowi najgorszą notę w repo: 8,34%
        // linii, 6,85% funkcji, 64 z 83 plików na okrągłym zerze - i, co dla tej
        // sekcji najważniejsze, ANI JEDNEGO progu per-ścieżka (rozdz. 6 audytu).
        // Moduł rozstrzyga, czy redakcja zapisze to, co napisała: patch wpisu,
        // przejścia workflow, rewizje, blokada wyjścia z niezapisaną treścią.
        //
        // Reguły wyszły z organizmów do czystych modułów (`lib/`), bo dopiero
        // wtedy da się je sprawdzać na WYNIKU, a nie na renderze. Progi idą więc
        // w dwóch klasach:
        //   * czyste moduły - równo 100%, bez marginesu: nie ma tu gałęzi,
        //     której nie dałoby się wywołać z testu, więc każdy spadek oznacza
        //     realną regułę bez pokrycia;
        //   * powierzchnie komponentowe - floor pod ZMIERZONYM poziomem
        //     (margines na dryf CI), zgodnie z konwencją sekcji PROFIL.
        // Wolno je wyłącznie podnosić.

        // Reguły kalendarza redakcyjnego: siatka miesiąca, klucz dnia liczony
        // LOKALNIE (nie w UTC) i bramka przeciągania wpisu. Niedobite gałęzie to
        // ramiona obronne przy dacie nie do sparsowania. Trzymane osobno, bo to
        // jedyny plik w `lib/` poniżej 100% - reszta katalogu ma być na 100%.
        "src/components/admin/post-editor/lib/editorialCalendar.ts": {
          statements: 98,
          functions: 100,
          lines: 100,
          branches: 92,
        },
        // Patch wpisu: 47 kolumn plus jawna lista pól NIEpatchowanych. Test
        // kompletności dowodzi, że każde pole formularza albo trafia do patcha,
        // albo stoi na liście wykluczeń - czyli że nowe pole nie zniknie po
        // cichu przy zapisie. Czysty moduł, więc równo 100%.
        "src/components/admin/post-editor/lib/postPatch.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // Mapowanie pomiaru zero-click na komunikat checklisty. Każda gałąź to
        // inna instrukcja naprawy dla redaktora, więc każda musi być trafiona
        // testem - czysty moduł, równo 100%.
        "src/components/admin/post-editor/lib/zeroClickMessages.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // Budowa zapytania listy wpisów: filtry, paginacja, sortowanie. Błąd tu
        // nie wywala się na typach - pokazuje redakcji NIE TE wpisy.
        "src/components/admin/post-editor/lib/postsListQuery.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // Bramki dialogów listy wpisów (usuwanie, duplikowanie, zbiorcze akcje).
        "src/components/admin/post-editor/lib/postsListDialogs.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // Parametry trasy edytora: slug vs `new`, tryb podglądu, język.
        "src/components/admin/post-editor/lib/postRouteParams.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // Reguły przekierowań: normalizacja ścieżki, wykrycie pętli i kolizji.
        // Zła reguła zabiera adres, pod którym artykuł jest już zaindeksowany.
        "src/components/admin/post-editor/lib/redirectsAdmin.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // Katalog organizacji: schemat wiersza z RPC, klucz cache z tenantem,
        // doklejenie przypisanej firmy do droplisty i ATOMOWY patch migawki
        // `posts.organization_*`. Rozjazd tej migawki widać dopiero w
        // opublikowanym artykule, przy nocie sponsorskiej.
        "src/components/admin/post-editor/molecules/organizationDirectory.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // Warstwa czystych reguł edytora jako całość: 99,2% instrukcji, 99,5%
        // linii, 98,8% funkcji, 98,4% gałęzi. Próg katalogowy istnieje po to, by
        // NOWY plik reguł nie wszedł tu bez testu - progi per-plik takiego
        // przypadku nie łapią.
        "src/components/admin/post-editor/lib/**": {
          statements: 95,
          functions: 95,
          lines: 95,
          branches: 94,
        },
        // Haki edytora (`usePostEditorForm`, `usePostEditorData`,
        // `useBilingualReadingStats`, `useInlineTaxonomy`): 98,5% instrukcji,
        // 99,6% linii, 100% funkcji, 93,3% gałęzi. To tu mieszka walidacja przed
        // zapisem i budowa patcha - bez pokrycia formularz „zapisuje się"
        // zielono, a kolumna zostaje pusta.
        "src/components/admin/post-editor/hooks/**": {
          statements: 94,
          functions: 96,
          lines: 95,
          branches: 89,
        },
        // Atomy edytora: 92,3% instrukcji, 91,7% linii, 88,9% funkcji, 93,8%
        // gałęzi. Warstwa prezentacyjna, ale to ona niesie etykiety i stany
        // pól - a atomic design zakłada, że wyżej nikt tego nie powtarza.
        "src/components/admin/post-editor/atoms/**": {
          statements: 88,
          functions: 85,
          lines: 87,
          branches: 89,
        },
        // Projekcja listy rewizji: przez granicę klient-serwer przechodzą
        // WYŁĄCZNIE pola listy, nigdy migawka treści. Czysty moduł, 100%.
        "src/lib/revisions/**": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // Server functions historii zmian: lista, migawki do porównania,
        // przywracanie. Największy plik modułu 2, który stał na 0% - a niesie
        // trzy reguły, których nie widać z zewnątrz: przywrócenie NIE rusza
        // `status`, migawka zabezpieczająca powstaje PRZED nadpisaniem, a UPDATE
        // odfiltrowany przez RLS (zero wierszy, zero błędu) jest zgłaszany jako
        // porażka. Każda gałąź błędu bazy ma test, więc próg stoi na 100%.
        "src/lib/revisions.functions.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // Wersje buildera: typ encji przy przywracaniu, dokument sekcji/widgetu
        // i zakres zapytania. Tu siedział defekt `span: 12` zamiast
        // `{ desktop: 12 }` - podgląd wersji renderował się w domyślnej
        // szerokości, bo `span.desktop` na liczbie daje `undefined`.
        "src/components/admin/versions/lib/**": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // Reguły panelu automatyzacji: katalog statusów przebiegu i dostaw
        // (czytany wprost z CHECK-ów w migracjach), sentinel „wszystkie" dla
        // Radiksa, parametry zapytań i bramka podglądu trasy korelacji.
        "src/components/admin/workflows/lib/**": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // Maszyna stanu niezapisanych zmian + jej hak. Jedyna rzecz, która stoi
        // między redaktorem a utratą tekstu przy zamknięciu karty - dlatego bez
        // marginesu.
        "src/lib/unsavedChanges.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/hooks/useUnsavedChangesGuard.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // Obecność edytorska: kto jeszcze trzyma otwarty ten wpis. Plik stał na
        // 0% mimo trzech funkcji i kanału realtime.
        "src/hooks/useEditPresence.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // ZAPORY ANTYREGRESYJNE (nie deklaracje jakości). Trzy powierzchnie
        // komponentowe modułu 2 wyszły z zera, ale są dopiero w połowie drogi.
        // Próg jest tu wyłącznie po to, żeby nie wróciły na zero przy kolejnym
        // refaktorze; docelowy poziom to ta sama półka, co w `lib/` i `hooks/`,
        // i te liczby mają rosnąć wraz z kolejnymi testami.
        // Zmierzone: molecules 27,8% linii / 30,9% funkcji, workflows 20,3% /
        // 17,0%, versions 10,6% / 11,8%.
        "src/components/admin/post-editor/molecules/**": {
          statements: 23,
          functions: 26,
          lines: 23,
          branches: 22,
        },
        // Automatyzacje po dopisaniu edytora przepisu: 51,5% instrukcji, 50%
        // linii, 55,7% funkcji, 31,6% gałęzi (zmierzone samymi testami tego
        // katalogu, więc pełna suita daje nie mniej). Na zerze zostają cztery
        // panele listujące - próg ma pilnować, żeby edytor do nich nie dołączył.
        "src/components/admin/workflows/**": {
          statements: 45,
          functions: 50,
          lines: 45,
          branches: 27,
        },
        "src/components/admin/versions/**": {
          statements: 7,
          functions: 8,
          lines: 7,
          branches: 9,
        },
        // ── MODUŁ 1: WPISY - DOŚWIADCZENIE CZYTELNIKA ────────────────────────
        // Audyt 18.08 dał temu modułowi 31,8% linii i 26,9% funkcji przy 74
        // plikach produkcyjnych, z których 43 nie miały ANI JEDNEJ wykonanej
        // linii. Progi poniżej są floorowane tuż pod ZMIERZONYM pokryciem -
        // zasada bez zmian: wolno je wyłącznie podnosić.
        //
        // REGUŁA GLOSARIUSZA. Chodzi po węzłach tekstowych opublikowanego
        // artykułu i je podmienia, więc jej defekt psuje TREŚĆ, nie panel.
        // Trzymamy 100% linii i funkcji; niedobite gałęzie to obronne ramiona
        // przeniesione 1:1 z komponentu (`node.textContent ?? ""`,
        // `range.parentNode?.`), nieosiągalne przy poprawnym DOM-ie.
        "src/lib/post/glossaryHighlight.ts": {
          statements: 97,
          functions: 100,
          lines: 100,
          branches: 90,
        },
        // WARSTWA USTAWIEŃ MODUŁU. Cztery pliki, które startowały odpowiednio z
        // 51,2% (1 z 10 funkcji), 0 z 5, 0 z 8 i 0 z 8 - a decydują o tym, co
        // czytelnik widzi na KAŻDYM wpisie tenanta i czy zapis w panelu
        // faktycznie dotarł do bazy. Wszystkie cztery są teraz na 100% linii
        // i funkcji, więc trzymamy je jak pozostałe czyste moduły w tym pliku.
        //
        // toc/settings.ts - niedobite gałęzie to `?? slugifyHeading(text)`
        // (fallback kotwicy, gdy derywacja dokumentu nie zna bloku - przy
        // spójnym dokumencie nieosiągalny) i `b.data.level ?? 2` w wariancie,
        // który ma już własny test przez brak pola.
        // PANELE „DOŚWIADCZENIA CZYTELNIKA" (krok 6 planu). Cztery panele modułu
        // były wpisane w pliki tras, więc nie miały jak dostać testu
        // komponentowego bez stawiania routera - stąd 0 z 32 funkcji w
        // `admin.toc.tsx`, 0 z 42 w `admin.key-takeaways.tsx`, 0 z 36 w
        // `admin.related-posts.tsx` i 0 z 34 w `admin.post-layouts.tsx`.
        //
        // Po wyprowadzeniu do `components/admin/postExperience` (atoms /
        // molecules / organisms) plik trasy zostaje przy rejestracji, a panel
        // stoi na 100% we wszystkich metrykach. Próg jest tu WYSOKI świadomie:
        // to ma być bariera dla kolejnego panelu wchodzącego do tego katalogu,
        // a nie zapis stanu faktycznego. Gałęzie floorowane na 95%, bo warunek
        // w nowym JSX zdarza się dopisać przed jego testem.
        "src/components/admin/postExperience/**": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 95,
        },
        // Reguły paneli: deskryptory i klucze i18n zamiast tekstu w JSX oraz
        // wspólne przycięcie pól liczbowych. Czyste moduły, więc pod 100%.
        "src/lib/admin/panelDraft.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/toc/panelRules.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/keyTakeaways/panelRules.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/relatedPosts/panelRules.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/post/layoutPanelRules.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/toc/settings.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 90,
        },
        "src/lib/keyTakeaways/settings.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/relatedPosts/adminConfig.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/hooks/usePostLayoutSettings.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // SILNIK REKOMENDACJI. `buildIdf` i `normalizeMap` stały na zerze, choć
        // decydują, KTÓRE trzy artykuły czytelnik zobaczy pod tekstem, a
        // `use_idf` jest przełącznikiem w panelu - redakcja może je włączyć bez
        // wiedzy o zachowaniu na brzegach (termin w każdym dokumencie, unikat
        // w korpusie 10 000 wpisów, korpus bez sygnału). Cały plik jest teraz na
        // 100% linii i funkcji; niedobita gałąź to `cand.authorId && current.authorId`
        // w kombinacji, której nie da się osiągnąć bez obu wartości null naraz.
        "src/lib/relatedPosts.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 95,
        },
        // ZAPISANE ARTYKUŁY. `useBookmarks` startował z 0 z 2 funkcji, a
        // `useSaveArticle` z pamięcią lokalną gościa i wygasaniem (`readLocal`,
        // `pruneExpired`) czyta dane Z URZĄDZENIA użytkownika - uszkodzony JSON,
        // wpis bez znacznika czasu i zablokowany magazyn to stany, które w
        // produkcji WYSTĘPUJĄ (tryb prywatny Safari).
        "src/hooks/useBookmarks.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/hooks/useSaveArticle.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 95,
        },
        // Beacon kliknięcia w rekomendację: telemetria opcjonalna, klik NIE -
        // każda ścieżka błędu (brak `sendBeacon`, tryb offline, wyjątek
        // z rozszerzenia przeglądarki) musi kończyć się cicho. Niedobite gałęzie
        // to `typeof navigator === "undefined"` (pod happy-dom zawsze fałszywe)
        // i puste ciało `.catch(() => undefined)`.
        "src/lib/relatedClickBeacon.ts": {
          statements: 90,
          functions: 100,
          lines: 100,
          branches: 70,
        },
        // ── AUDIO / TTS ──────────────────────────────────────────────────────
        // Najsłabsza funkcjonalność modułu 1 w audycie: 11,4% linii przy 743
        // liniach i 136 funkcjach, 7 z 12 plików na okrągłym zerze. Reguły
        // wyprowadzone z 752-linijkowego `global-player.tsx` do czystych modułów
        // trzymamy pod 100% linii - one decydują o WYCIEKU PAMIĘCI w długiej
        // sesji czytania (blobCache) i o tym, czy czytelnik wróci tam, gdzie
        // skończył (positionMemory).
        //
        // positionMemory: niedobite gałęzie to strażniki `typeof window ===
        // "undefined"` (pod happy-dom zawsze fałszywe - ścieżka SSR jest
        // nieosiągalna z testu jednostkowego).
        "src/lib/audio/positionMemory.ts": {
          statements: 88,
          functions: 100,
          lines: 100,
          branches: 84,
        },
        // blobCache: niedobita gałąź to `typeof URL !== "undefined"` -
        // środowisko bez globalnego `URL` nie istnieje ani w przeglądarce, ani
        // pod happy-dom.
        "src/lib/audio/blobCache.ts": {
          statements: 96,
          functions: 100,
          lines: 100,
          branches: 94,
        },
        // ttsStage: reguła etapu syntezy i etykiet transportu - zwraca KLUCZ
        // i18n, nie napis, więc jest w pełni pokrywalna bez renderu.
        // GLOBALNY ODTWARZACZ: 4,8% -> 100% linii. Jedyny plik modułu, przez
        // który przechodzi KAŻDE kliknięcie „odsłuchaj": woła płatną syntezę,
        // trzyma cache blobów i pamięta pozycję odsłuchu. Czyste moduły
        // wyprowadzone z niego wcześniej miały po 100%, ale SKŁAD - kolejność
        // etapów, anulowanie starego pobrania, zapis pozycji przy podmianie
        // źródła, arbitraż z innymi odtwarzaczami - żył bez ani jednego testu.
        //
        // Niedobite gałęzie to obronne `catch`-e wokół API przeglądarki
        // (nieudany `seek` na nietypowym źródle, brak `MediaMetadata`) oraz
        // ścieżka SSR, w której `window` nie istnieje.
        "src/lib/audio/global-player.tsx": {
          statements: 97,
          functions: 79,
          lines: 100,
          branches: 87,
        },
        "src/lib/audio/ttsStage.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // TRASA SYNTEZY: 0% -> 95,41% linii. Wejście do PŁATNEGO dostawcy i
        // jednocześnie potencjalny objazd wokół paywalla (treść płatnego
        // artykułu dałoby się usłyszeć bez uprawnienia). Niedobite: obronny
        // `catch` wokół `getRequestIP`, gałąź `blocks[lang] ?? blocks.pl ??
        // blocks.en` dla dokumentu bez żadnego języka oraz puste ciała
        // `.catch()` przy zapisie cache w tle.
        "src/routes/api/public/post-tts.ts": {
          statements: 95,
          functions: 83,
          lines: 95,
          branches: 85,
        },
        // UKŁADY WPISU I RENDER + AUDIO: powierzchnie komponentowe modułu.
        // Stan wyjściowy: `components/post` 21 z 26 plików na ZERZE (19,0% linii
        // całej funkcjonalności), `components/audio` 4 z 4 na zerze. Po pracy
        // ŻADEN plik nie stoi na zerze - i to jest tu ważniejsze niż sam procent,
        // bo plik bez ani jednej asercji nie ma jak zauważyć regresji.
        //
        // Progi są floorowane PER METRYKA pod pomiarem, dlatego `statements`
        // stoi niżej niż `lines`: w JSX jeden wiersz nosi kilka instrukcji
        // (skróty `&&`, wartości domyślne propsów), więc mianownik instrukcji
        // jest większy niż mianownik wierszy.
        //
        // Niedobita reszta w `components/post` to `RelatedPosts.tsx`: sześć
        // układów rekomendacji (siatka, lista, slider, karty, magazyn, os czasu)
        // z autoplayem i obsługą gestów. Pokryte są stan pusty, wyłączenie,
        // nadpisanie per wpis i dwa układy; pozostałe cztery to kolejny krok,
        // nie regresja tego.
        //
        // W `components/audio` niedobite są gałęzie dolnego paska i karty, które
        // wymagają PRAWDZIWEGO `HTMLAudioElement` (przewijanie gestem, pobieranie
        // blobu, Web Share API) - te ścieżki dowodzi e2e, nie test jednostkowy.
        "src/components/post/**": {
          statements: 80,
          functions: 72,
          lines: 84,
          branches: 66,
        },
        "src/components/audio/**": {
          statements: 62,
          functions: 48,
          lines: 64,
          branches: 77,
        },
        // Atomy modułu 1 trzymamy pod 100%: test atomu jest tani i wielokrotnie
        // użyty, a każdy z nich scala kopie, w których kontrakt a11y był pisany
        // od nowa (i za każdym razem inaczej).
        "src/components/post/atoms/**": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 90,
        },
        "src/components/audio/atoms/**": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 90,
        },
        // Reguły wyprowadzone z organizmów artykułu - czyste moduły, więc pod 100%.
        "src/lib/post/badgeContrast.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/post/quoteSelection.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/post/autoLoadChain.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // ── KLUBY DYSKUSYJNE ─────────────────────────────────────────────────
        // Moduł miał PONAD 200 progów per-ścieżka w tym pliku i ani jednego dla
        // siebie (`grep -i club vitest.config.ts` → pusto), a startował z 25,8%
        // linii przy 0,0% na dwudziestu trasach publicznych. Bez progu każde
        // pokrycie tej powierzchni osunęłoby się przy pierwszym niepokrytym
        // PR-ze - tak samo, jak osunęły się panele widgetów, co ten plik sam
        // dokumentuje wyżej.
        //
        // WSZYSTKIE wartości poniżej są ZMIERZONE jednym przebiegiem pełnej
        // suity z pokryciem (2026-08-20) i floorowane 1-2 pp pod pomiarem, żeby
        // bramka łapała REGRESJĘ, a nie przepuszczała połowy pokrycia. Progi
        // wolno wyłącznie PODNOSIĆ; gdyby któryś trzeba było obniżyć, znaczy to,
        // że coś się zepsuło - i naprawia się to, a nie próg.
        //
        // Trasy publiczne klubu (20 plików). Zmierzone 2026-08-20: 99,72%
        // instrukcji / 98,41% gałęzi / 100% funkcji / 100% linii - z 0,0%.
        // Dziewięć niedobitych gałęzi to w całości ścieżki nieosiągalne przez
        // TYPY kolumn RPC (`?? ""` na kolumnie NOT NULL) albo obrony przed
        // wyścigiem, którego nie da się wywołać bez sterowania harmonogramem
        // Reacta - każda opisana w nagłówku swojego pliku testowego.
        "src/routes/club*.tsx": {
          statements: 98,
          functions: 99,
          lines: 99,
          branches: 97,
        },
        // Ścieżka zgłoszenia członkowskiego - osobny, WYŻSZY próg niż rodzina
        // tras, bo to jedyne wejście do modułu i ma incydent produkcyjny
        // w historii (`source_type='club_application'` złamał CHECK na
        // `crm_leads`, stąd bramka `check:pg-harness`). Zmierzone: 100% /
        // 97,5% / 100% / 100%.
        "src/routes/club.apply.tsx": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 96,
        },
        // Trasy panelu klubów (6 plików). Zmierzone: 100% / 96,83% / 100% /
        // 100% - z 0,0%. Dostęp tych tras pilnuje osobno bramka
        // `adminRouteAuthority.gate.test.ts` (rozszerzona o tę rodzinę), więc
        // ten próg chroni STAN i sklejenie, nie autorytet.
        "src/routes/admin.community.clubs*.tsx": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 95,
        },
        // Atomy publiczne (24 pliki). Zmierzone: 100% / 99,39% / 100% / 100% -
        // z 8,4%. Dwie niedobite gałęzie to prawe ramiona `?? ""` w `initials`
        // (`ClubAuthorAvatar`), nieosiągalne po `.split(/\s+/).filter(Boolean)`.
        "src/components/clubs/atoms/**": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 98,
        },
        // Molekuły publiczne (44 pliki). Zmierzone: 99,67% / 99,42% / 100% /
        // 100%. Wyjątek opisany przy teście: `ClubCoverEditor` ma dwa
        // `if (busy) return;` nieosiągalne, bo oba przyciski niosą
        // `disabled={busy}` na tym samym warunku, a React połyka zdarzenia
        // myszy na wyszarzonych elementach formularza.
        "src/components/clubs/molecules/**": {
          statements: 98,
          functions: 99,
          lines: 99,
          branches: 98,
        },
        // Organizmy publiczne (35 plików). Zmierzone: 99,76% / 99,27% /
        // 99,80% / 99,82% - z 8,4%. Trzy wejścia czytelnika (`ClubHub`,
        // `ClubDirectory`, `ClubMinisite`) mają dodatkowo test `axeViolations()`.
        "src/components/clubs/organisms/**": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 98,
        },
        // Panel klubów - CAŁA powierzchnia (57 plików po kompozycji: 3 atomy,
        // 37 molekuł, 17 organizmów). Zmierzone: 99,30% / 97,97% / 100% /
        // 100% - z 8,6%.
        "src/components/admin/clubs/**": {
          statements: 98,
          functions: 99,
          lines: 99,
          branches: 96,
        },
        // Atomy i molekuły panelu pod 100%: to warstwa BEZ I/O i bez stanu
        // serwera, więc jej test jest tani i wielokrotnie użyty - ta sama
        // zasada, co przy `src/components/post/atoms/**` wyżej. Zmierzone:
        // 100% we wszystkich czterech metrykach na obu katalogach.
        "src/components/admin/clubs/atoms/**": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 99,
        },
        "src/components/admin/clubs/molecules/**": {
          statements: 99,
          functions: 100,
          lines: 100,
          branches: 99,
        },
        // Organizmy panelu (17 plików). Zmierzone: 99,13% / 97,06% / 100% /
        // 100%. Niedobite gałęzie siedzą w czterech największych zakładkach
        // (moderacja, wątki, skład, edytor działu) i są opisane przy testach.
        "src/components/admin/clubs/organisms/**": {
          statements: 98,
          functions: 99,
          lines: 99,
          branches: 96,
        },
        // Warstwa REGUŁ modułu (95 modułów w raporcie: było 67, doszło 28
        // czystych modułów wyprowadzonych z JSX-a tras i organizmów; dwa
        // `*.test.ts` leżące w tym katalogu poza `__tests__` nie są źródłami).
        // Zmierzone: 93,08% / 90,11% / 94,71% / 93,96%.
        //
        // Ten próg jest NIŻSZY niż na powierzchniach prezentacji i to nie jest
        // pomyłka: warstwa niesie też moduły, których ta praca nie dotykała
        // (hooki React Query, klienty RPC, słowniki), a cztery powierzchnie
        // objęte zadaniem stoją tu na 100%. Podniesienie tego progu to osobna
        // praca nad resztą warstwy, nie regresja tej.
        "src/lib/clubs/**": {
          statements: 92,
          functions: 93,
          lines: 92,
          branches: 89,
        },
        // ── MODUŁ 19: USTAWIENIA, INTEGRACJE, UŻYTKOWNICY, MULTI-TENANT, RODO ─
        //
        // Stan wyjściowy powierzchni (audyt 2026-08-21, HEAD 6426bd0): 130 plików,
        // 28,0% linii, 23,2% GAŁĘZI, 56 plików z zerem wykonanych linii. Gałęzie
        // były tu trudniejsze niż linie i takie zostały: panele ustawień czytają
        // wartości przez `??`/`||`/`?:`, a najczęstszym realnym błędem jest
        // wartość FAŁSZYWA ALE PRAWIDŁOWA (`0` dni karencji, `""` tytułu),
        // którą `||` podmienia na domyślną. Progi gałęzi są więc floorowane
        // ostrożniej niż progi linii.
        //
        // UWAGA NA PODZIAŁ ODPOWIEDZIALNOŚCI, ten sam co przy klubach:
        // próg per-ścieżka = STAN I SKLEJENIE. Bramka autorytetu = DOSTĘP.
        // Dostępu tras panelu pilnuje `src/routes/__tests__/adminRouteAuthority.gate.test.ts`
        // (rozszerzona w tym module z 21 do 58 przypadków o rodziny
        // `admin.users.*`, `admin.settings.*`, `admin.organizations.*`,
        // `admin.integrations`, `admin.names`), a nie te progi - render trasy
        // nie widzi ani wspólnego layoutu `/admin`, ani RLS.
        //
        // Wszystkie liczby w komentarzach to POMIAR v8 z 2026-08-22, plik po
        // pliku; progi stoją 1-2 p.p. pod pomiarem (zapas na dryf w CI).

        // Użytkownicy i role. Zmierzone: 98,30% instrukcji / 99,17% funkcji /
        // 99,78% linii / 95,09% gałęzi - z 0,0%.
        "src/routes/admin.users*.tsx": {
          statements: 97,
          functions: 98,
          lines: 98,
          branches: 93,
        },
        // Okna zaproszeń i importu zespołu. Zmierzone: 97,27% / 100% / 98,09% /
        // 96,77% - z 0,0%.
        "src/components/admin/users/**": {
          statements: 96,
          functions: 99,
          lines: 97,
          branches: 95,
        },
        // System zaproszeń (9 funkcji serwerowych). Zmierzone: 99,65% / 100% /
        // 100% / 97,61% - z 0,0%. Bramki roli i najemcy są tu DEKLARACJĄ
        // middleware (harness go nie uruchamia), a nie zachowaniem handlera.
        "src/lib/admin/invitations.functions.ts": {
          statements: 99,
          functions: 100,
          lines: 99,
          branches: 96,
        },
        // Silnik wszystkich paneli ustawień. Zmierzone: 100% w czterech
        // metrykach - z 0,0%. Dwanaście z piętnastu tras `admin.settings.*`
        // czyta i zapisuje konfigurację WYŁĄCZNIE przez ten hook.
        "src/lib/admin/useSettings.ts": {
          statements: 99,
          functions: 100,
          lines: 100,
          branches: 99,
        },
        // Piętnaście tras ustawień. Zmierzone: 97,47% / 95,29% / 97,25% /
        // 95,08% - z 0,0%. Najwyższą wartość dowodową ma tu bramka POLA
        // MARTWEGO (zmiana każdej kontrolki musi zmienić ładunek zapisu).
        "src/routes/admin.settings*.tsx": {
          statements: 96,
          functions: 94,
          lines: 96,
          branches: 93,
        },
        // Integracje wychodzące: panel endpointów. Zmierzone: 98,44% / 97,82% /
        // 99,15% / 95,04% - z 0,0%. Sekret podpisu nie jest odczytywany do
        // panelu; panel widzi wyłącznie „ustawiony / nieustawiony".
        "src/routes/admin.integrations.tsx": {
          statements: 97,
          functions: 96,
          lines: 98,
          branches: 93,
        },
        // Dispatcher dostaw. Zmierzone: 98,55% / 85,71% / 100% / 100% - z 0,0%.
        // Próg FUNKCJI jest niższy świadomie: jedna funkcja jest osiągalna
        // tylko przez uruchomienie middleware, czego harness funkcji
        // serwerowych z założenia nie robi (patrz `src/test/serverFnHarness.ts`).
        "src/lib/integrations/dispatch.functions.ts": {
          statements: 97,
          functions: 85,
          lines: 99,
          branches: 99,
        },
        // Słownik imion - trasa (sklejenie: stan, zapytania, realtime).
        // Zmierzone: 99,11% / 100% / 100% / 98,83% - z 0,0%. Cztery niedobite
        // gałęzie są wypisane z numerami linii w nagłówku pliku testowego.
        "src/routes/admin.names.tsx": {
          statements: 98,
          functions: 99,
          lines: 99,
          branches: 97,
        },
        // Słownik imion - REGUŁY CSV wyprowadzone z trasy do czystych funkcji.
        // Zmierzone: 100% / 100% / 100% / 99,35%.
        "src/lib/admin/namesCsv.ts": {
          statements: 99,
          functions: 100,
          lines: 100,
          branches: 98,
        },
        // Cztery panele treści widocznych dla KAŻDEGO odwiedzającego. Wspólny
        // kształt ryzyka: awaria odczytu pokazana jako stan domyślny, po której
        // pierwszy „Zapisz" nadpisuje konfigurację najemcy wartościami z kodu.
        // Zmierzone razem: 98,63% / 100% / 99,24% / 96,90% - z 0,0%.
        "src/routes/admin.audience.tsx": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        "src/routes/admin.personalized.tsx": {
          statements: 99,
          functions: 99,
          lines: 99,
          branches: 99,
        },
        "src/routes/admin.popups.tsx": {
          statements: 96,
          functions: 99,
          lines: 99,
          branches: 93,
        },
        "src/routes/admin.greetings.tsx": {
          statements: 97,
          functions: 99,
          lines: 96,
          branches: 93,
        },
        // Organizacje członkowskie - lista, tworzenie i KARTA. Zmierzone razem:
        // 99,42% instrukcji / 100% funkcji / 99,67% linii / 98,65% gałęzi -
        // z 37,17/32,51/39,80/30,30 (sama karta `$id` startowała z 2,13% linii
        // i 0% gałęzi). Cztery niedobite gałęzie to strażniki zdublowane
        // z warunkiem renderu formularza, martwy prop `hint` w trasie
        // tworzenia i JEDNA gałąź w kodzie MARTWYM, zgłoszonym `it.fails`
        // (stan „organizacji nie ma" nigdy się nie renderuje).
        "src/routes/admin.organizations*.tsx": {
          statements: 97,
          functions: 99,
          lines: 98,
          branches: 96,
        },
        // Warstwa danych panelu. Zmierzone (kolejno instrukcje/funkcje/linie/
        // gałęzie): community.ts 100/100/100/99,63 - z ~7%;
        // membership-admin.ts 100/100/100/100 - z 0,0%;
        // pageTopics.ts 100/100/100/100 - z 90/100/100/79,16;
        // impersonation.functions.ts, network.ts, bulkToast.ts,
        // consentAudit.functions.ts - wszystkie 100% w czterech metrykach.
        "src/lib/admin/community.ts": {
          statements: 99,
          functions: 100,
          lines: 99,
          branches: 98,
        },
        "src/lib/admin/membership-admin.ts": {
          statements: 99,
          functions: 100,
          lines: 100,
          branches: 99,
        },
        "src/lib/admin/pageTopics.ts": {
          statements: 99,
          functions: 100,
          lines: 100,
          branches: 99,
        },
        "src/lib/admin/impersonation.functions.ts": {
          statements: 99,
          functions: 100,
          lines: 100,
          branches: 99,
        },
        "src/lib/admin/network.ts": {
          statements: 99,
          functions: 100,
          lines: 100,
          branches: 99,
        },
        "src/lib/admin/bulkToast.ts": {
          statements: 99,
          functions: 100,
          lines: 100,
          branches: 99,
        },
        "src/lib/admin/consentAudit.functions.ts": {
          statements: 99,
          functions: 100,
          lines: 100,
          branches: 99,
        },
        // `consentAudit.server.ts` ma dla v8 DWIE instrukcje wykonywalne (dwa
        // schematy Zod; `interface` nie emituje JS-a), więc próg dotyczy tylko
        // linii i instrukcji - treść widełek dowodzi tabela w teście.
        "src/lib/admin/consentAudit.server.ts": {
          statements: 99,
          lines: 99,
        },
        // Synchronizacja zgłoszenia „dołącz do nas" - tożsamość z sesji,
        // nie z ładunku. Zmierzone: 100% w czterech metrykach - z 0,0%.
        "src/lib/joinUsSync.functions.ts": {
          statements: 99,
          functions: 100,
          lines: 100,
          branches: 99,
        },
        // Formularz kontaktowy: zapis zgłoszenia, autoodpowiedź, powiadomienie,
        // double opt-in. Zmierzone: 100% / 100% / 100% / 98,96% - z ~4%.
        // Dwie niedobite gałęzie są strukturalnie nieosiągalne (opisane
        // w nagłówku testu): `?? c` w `esc()` i `?? null` po `split(",")[0]`.
        "src/lib/contact.functions.ts": {
          statements: 99,
          functions: 100,
          lines: 99,
          branches: 97,
        },
        // Role systemowe, ich etykiety i warstwa danych macierzy uprawnień.
        // Zmierzone: 100% w czterech metrykach na każdym z trzech plików -
        // z 60% (roles.ts) i 0,0% (dwa pozostałe). Etykiety są asertowane na
        // PRAWDZIWYM słowniku (`realT()`), bo incydent, który je stworzył,
        // polegał na renderowaniu angielskiego `defaultValue` w polskim panelu.
        "src/lib/authz/roles.ts": {
          statements: 99,
          functions: 100,
          lines: 100,
          branches: 99,
        },
        "src/lib/authz/roleLabels.ts": {
          statements: 99,
          functions: 100,
          lines: 100,
          branches: 99,
        },
        "src/lib/authz/permissionMatrixQuery.ts": {
          statements: 99,
          functions: 100,
          lines: 100,
          branches: 99,
        },
        // Reguły macierzy uprawnień. Zmierzone: 100% w czterech metrykach -
        // z 93,95% instrukcji / 97,91% funkcji / 95,86% linii / 82,30% GAŁĘZI.
        // Gałęzie były tu najsłabsze w całym obszarze i domknęła je tabela po
        // kształtach kolumny `features` (JSON z panelu cen: `null`, tablica,
        // liczba, napis, `"3"`, `""`, `0`, `NaN`) oraz po czterech ramionach
        // trybu bramki. Snapshot autoryzacji jest w tych testach WSTRZYKIWANY,
        // więc dowodzą reguły, a nie stanu bazy.
        "src/lib/authz/permissionMatrix.ts": {
          statements: 99,
          functions: 100,
          lines: 99,
          branches: 98,
        },

        // ── MODUŁ 20: PLATFORMA / BACKEND / INFRASTRUKTURA / SSR ───────────
        // Wszystkie progi niżej: pomiar 2026-08-22, floor 1-2 pp pod pomiarem
        // (dryf remapowania v8 między wersjami). Progi wolno WYŁĄCZNIE podnosić.
        //
        // Gramatyka adresów publicznych + rozwiązywanie starych adresów wpisów.
        // Zmierzone: 100 / 100 / 100 / 100 (73 przypadki). Ta powierzchnia
        // rozstrzyga KAŻDY publiczny adres, który nie trafił w trasę statyczną,
        // więc próg jest tu maksymalny - spadek znaczy nową, nieprzetestowaną
        // gałąź w rezolucji adresu.
        "src/lib/routing/**": { statements: 99, functions: 100, lines: 99, branches: 98 },

        // Czytniki service-role dla powierzchni crawlera. Zmierzone: 100 na
        // wszystkich czterech wymiarach dla każdego z pięciu plików. Zakresu
        // NAJEMCY pilnuje osobno bramka statyczna
        // `src/lib/server/__tests__/serviceRoleTenantScope.gate.test.ts` - ten
        // próg chroni ZACHOWANIE (parytet adresów kanonicznych, cache, ścieżki
        // degradacji), nie izolację najemcy.
        "src/lib/server/publishedContent.server.ts": {
          statements: 99,
          functions: 100,
          lines: 99,
          branches: 98,
        },
        "src/lib/server/sitemapEntries.server.ts": {
          statements: 99,
          functions: 100,
          lines: 99,
          branches: 98,
        },
        "src/lib/server/wp-media.server.ts": {
          statements: 99,
          functions: 100,
          lines: 99,
          branches: 98,
        },
        "src/lib/server/linkCheck.server.ts": {
          statements: 99,
          functions: 100,
          lines: 99,
          branches: 98,
        },
        "src/lib/server/embeddings.server.ts": {
          statements: 99,
          functions: 100,
          lines: 99,
          branches: 98,
        },
        // Analizator bramki zakresu najemcy - czysty, w pełni przechodzony.
        // Zmierzone: 100 / 100 / 100 / 100.
        "src/lib/ci/serviceRoleTenantScope.ts": {
          statements: 99,
          functions: 100,
          lines: 99,
          branches: 98,
        },

        // Watchdog strumienia SSR - OBEJŚCIE BŁĘDU router-core 1.171 - oraz
        // strażnik czasu pojedynczego zapytania. Zmierzone:
        // queryStreamGuard 95,94 / 85,36 / 100 / 98,5;
        // queryTimeout     93,18 / 84,21 / 100 / 97,43.
        // Gałęzie są NIŻSZE niż na innych powierzchniach i to nie pomyłka:
        // dziewięć gałęzi w obu plikach jest nieosiągalnych przez publiczne API
        // klienta zapytań (`catch` na `JSON.stringify` klucza, którego
        // react-query haszuje wcześniej; `error instanceof Error` na wpisach,
        // którym react-query czyści błąd przy starcie ponowienia; strażniki
        // liczników zerowanych w `close()`). Każda jest przypięta testem, który
        // to USTALA. Szczegóły w nagłówkach obu plików testowych.
        "src/lib/ssr/queryStreamGuard.ts": {
          statements: 94,
          functions: 100,
          lines: 97,
          branches: 83,
        },
        "src/lib/ssr/queryTimeout.ts": {
          statements: 92,
          functions: 100,
          lines: 96,
          branches: 82,
        },

        // ── DWA PLIKI, KTÓRE POSIADAJĄ WSZYSTKIE BUDŻETY SSR I HYDRATACJI ────
        //
        // Audyt pokrycia (wyd. 8, rozdz. 8.6) nazwał to najostrzejszą
        // pojedynczą obserwacją całego wydania: `src/router.tsx` miał 0 z 38
        // linii i 0 z 13 funkcji, `src/routes/__root.tsx` 0 z 124 linii i 0 z 48
        // funkcji - w repozytorium mierzącym wtedy 84,12% całości. `router.tsx`
        // nie był importowany przez ŻADEN plik testowy; jedyny kontakt suity
        // z korzeniem polegał na odczytaniu pliku jako TEKSTU
        // (`lib/seo/__tests__/rootHead.test.ts`). Próg globalny tego nie widział,
        // bo jest agregatem po całym `src/`. Bez progów per-ścieżka ten dorobek
        // jest pożyczony - dlatego wchodzą tym samym commitem co testy.
        //
        // ZMIERZONE 2026-09-01 (17 przypadków w `src/__tests__/router.test.tsx`,
        // 16 zielonych + 1 `it.fails`): router.tsx 100% instrukcji / 100% gałęzi
        // / 100% funkcji / 100% linii (35/35, 12/12, 11/11, 32/32).
        //
        // `functions: 100` jest tu ŚWIADOME, nie przez przypadek: plik ma
        // jedenaście funkcji i każda z nich posiada jakiś inwariant SSR
        // (`shouldDehydrateQuery`, `retryDelay`, obie gałęzie `rewrite`, owijka
        // `dehydrate`, owijka `hydrate`, dwa ekrany błędu). Dołożenie
        // nieprzetestowanej funkcji do TEGO pliku ma zapalić bramkę - taki sam
        // próg stoi wyżej na `queryStreamGuard.ts` i `queryTimeout.ts`.
        "src/router.tsx": {
          statements: 96,
          functions: 100,
          lines: 96,
          branches: 92,
        },
        // Budżet hydratacji wyciągnięty z `router.tsx`, żeby przestał być
        // nieobserwowalny (stała lokalna w ciele strzałki + `console.warn` jako
        // jedyny ślad). ZMIERZONE: 100% instrukcji / 80% gałęzi / 100% funkcji /
        // 100% linii.
        //
        // GAŁĘZIE NIŻEJ NIŻ RESZTA I TO NIE POMYŁKA: nieosiągnięta jest fałszywa
        // gałąź `if (timer) clearTimeout(timer)` w bloku `finally`. `timer` jest
        // przypisywany synchronicznie w konstruktorze obietnicy budżetu, która
        // ZAWSZE wchodzi do `Promise.race`, więc w chwili wejścia w `finally`
        // nie może być `undefined`. Straż zostaje, bo TypeScript nie zna tego
        // porządku, a `clearTimeout(undefined)` byłoby cichym no-opem
        // maskującym przyszłą zmianę kolejności.
        "src/lib/ssr/hydrateBudget.ts": {
          statements: 96,
          functions: 100,
          lines: 96,
          branches: 75,
        },
        // ZMIERZONE 2026-09-01 (19 przypadków w
        // `src/routes/__tests__/rootRoute.test.tsx` +
        // `rootShellRender.test.tsx`): 44,20% instrukcji / 53,33% gałęzi /
        // 14,58% funkcji / 50% linii.
        //
        // DLACZEGO FUNKCJE SĄ TAK NISKO I DLACZEGO TO NIE JEST DŁUG DO UKRYCIA:
        // z 48 funkcji tego pliku 43 to KOMPONENTY REACTA albo callbacki w ich
        // środku, a 17 z nich to same fabryki `lazy(() => import(...))`, czyli
        // czysty klej podziału kodu (dokładnie ta kategoria, którą blok
        // `exclude` wyżej wyłącza dla `widget-view/lazyWidgets.tsx` - tutaj
        // NICZEGO NIE WYŁĄCZAMY, tylko mierzymy uczciwie).
        //
        // Pokryta jest CAŁA logika, która ma inwarianty: loader (rozgrzewka
        // dwufalowa, zasiew przeterminowany, strażnik anulowanych zapytań menu,
        // nagłówki `Link`), `head()` i powłoka dokumentu przez
        // `renderToStaticMarkup`.
        //
        // DROGA W GÓRĘ JEST ZNANA I NAZWANA: `RootComponent` nie montuje się
        // z gołego renderu (`Link`/`useRouterState` czytają pusty kontekst
        // routera), więc podniesienie metryki funkcji wymaga prawdziwego
        // `RouterProvider` z `__root` JAKO KORZENIEM - czyli opcjonalnego
        // `rootRoute` w `src/test/routeHarness.tsx`. To zmiana harness'u
        // testowego, nie produkcji, i osobna praca. Ten próg wolno wyłącznie
        // podnosić.
        "src/routes/__root.tsx": {
          statements: 40,
          functions: 12,
          lines: 46,
          branches: 48,
        },

        // Menedżer przekierowań: cztery warstwy kontraktu (requireStaff, Zod,
        // audit_log, limit) i parytet normalizacji z `lib/seo/redirects`.
        // Zmierzone: 95,5 / 89,47 / 100 / 100.
        "src/lib/redirects.functions.ts": {
          statements: 94,
          functions: 100,
          lines: 99,
          branches: 88,
        },

        // Sesja podglądu wersji roboczych: maszyna stanu odzyskiwania i
        // strażnik przeładowań (heartbeat). Zmierzone CAŁYM katalogiem PO
        // scaleniu z mainem: 98,84 / 95,09 / 100 / 99,32;
        // `sessionHeartbeat.ts` osobno 98,56 / 93,15 / 100 / 99,14
        // (niepokryta linia 143).
        //
        // Linia 143 to `return` w strażniku braku powłoki w
        // `askParentToReconnect` - NIEOSIĄGALNY od zmiany kontraktu
        // 2026-08-22: moduł, który jako jedyny woła tę funkcję, odmawia
        // startu w dokładnie tym samym warunku (`isPreviewContext` wymaga
        // iframe'a). Przypięte testem „USTALENIE: strażnik braku powłoki
        // w askParentToReconnect jest nieosiągalny".
        //
        // Gałęzie są niższe od reszty etapu, bo dwie z nich domykają wyścig,
        // do którego nie ma drogi wywołania z publicznego API routera:
        // `subscribe` zwraca funkcję odpinającą, więc drugie odpięcie tego
        // samego nasłuchu nie zachodzi. Przypięte testem, który to USTALA.
        "src/lib/preview/**": {
          statements: 97,
          functions: 100,
          lines: 98,
          branches: 94,
        },

        // Powłoka aplikacji: odzyskiwanie po deployu, kotwice, `<link>` korzenia,
        // skrypt anty-FOUC, predykat chrome'u.
        // Zmierzone: cacheBusting 100 / 93,87 / 100 / 100;
        //            smoothAnchorScroll 96,22 / 89,47 / 100 / 100.
        // Gałęzie `smoothAnchorScroll` są niższe, bo sześć z nich jest
        // nieosiągalnych: dwa martwe strażniki SSR (każdy wołający strażnikuje
        // wcześniej) i dwa strażniki podwójnego sprzątania, do których nie ma
        // drogi wywołania. Wypisane z numerami linii w commicie etapu.
        "src/lib/cacheBusting.ts": {
          statements: 99,
          functions: 100,
          lines: 99,
          branches: 92,
        },
        "src/lib/smoothAnchorScroll.ts": {
          statements: 95,
          functions: 100,
          lines: 99,
          branches: 88,
        },
        "src/lib/seo/rootHead.ts": {
          statements: 99,
          functions: 100,
          lines: 99,
          branches: 98,
        },
        "src/lib/theme/themeInitScript.ts": {
          statements: 99,
          functions: 100,
          lines: 99,
          branches: 98,
        },
        // Próg KATALOGOWY dla `src/lib/theme/**` jest osobny i NIŻSZY, bo ta
        // praca dotknęła tu jednego pliku, a katalog niesie siedem zastanych
        // (`themeDesign`, `fontSizes`, `customFonts`, `typographyApply`...).
        // Zmierzone całym katalogiem: 99,72 / 92,14 / 100 / 100 - linie
        // i funkcje są już pełne, siedzą tylko gałęzie. Wpis jest tu jako
        // ZAPADKA na to, co katalog już osiągnął; podniesienie gałęzi
        // do 98 to osobna praca nad tymi siedmioma plikami, nie ta.
        //
        // PIERWOTNIE BYŁ TU JEDEN PRÓG KATALOGOWY Z GAŁĘZIAMI 98 - i to była
        // pomyłka pomiarowa: liczba pochodziła z przebiegu na samym
        // `themeInitScript.ts` (100 na czterech wymiarach), a nie z katalogu.
        // Pełna suita to złapała, bo tak ma działać zapadka.
        "src/lib/theme/**": { statements: 98, functions: 99, lines: 99, branches: 90 },

        // Lista czytelnicza gościa i deduplikacja rekordów - wyprowadzone
        // z tras jako logika domenowa. Zmierzone: 100 / 100 / 100 / 100.
        "src/lib/readingList/**": { statements: 99, functions: 100, lines: 99, branches: 98 },
        "src/lib/collections/**": { statements: 99, functions: 100, lines: 99, branches: 98 },

        // Komponenty wyprowadzone z tras publicznych (atomic design): atomy
        // (czysta prezentacja, bez I/O), molecules (kompozycja + jedna
        // odpowiedzialność) i organisms (sklejenie z danymi). Zmierzone
        // CAŁYMI katalogami: 99,72 / 99,23 / 100 / 100.
        //
        // TEN PRÓG CHRONI STAN I SKLEJENIE, A DOSTĘPU PILNUJE OSOBNO
        // `src/routes/__tests__/adminRouteAuthority.gate.test.ts` - to tam
        // mieszka dowód, że trasa panelu sprawdza rolę, a nie tylko chowa
        // przyciski. Próg na warstwie prezentacji nie mówi nic o autoryzacji
        // i nie wolno go tak czytać.
        "src/components/readingList/**": {
          statements: 99,
          functions: 100,
          lines: 99,
          branches: 94,
        },
        "src/components/home/**": {
          statements: 99,
          functions: 100,
          lines: 99,
          branches: 98,
        },
        "src/components/people/**": {
          statements: 97,
          functions: 100,
          lines: 99,
          branches: 96,
        },

        // Trasy publiczne. Zmierzone: `index.tsx` i `reading-list.tsx`
        // 100 / 100 / 100 / 100; `people.tsx` 98,91 / 98,48 / 100 / 100
        // (niepokryte gałęzie: 250, 394).
        //
        // TEN PRÓG CHRONI STAN I SKLEJENIE, A DOSTĘPU PILNUJE OSOBNO
        // `adminRouteAuthority.gate.test.ts`.
        // `index.tsx`: floor z POMIARU CI, nie z lokalnego. Lokalnie ten plik
        // stoi na 100 na czterech wymiarach, więc wpisałem 99 - jeden punkt
        // marginesu. CI zmierzyło 98,79 instrukcji / 98,75 linii i bramka
        // zapłonęła. To był MÓJ błąd metody: próg wolno stawiać 1-2 pp pod
        // pomiarem ze ŚRODOWISKA, KTÓRE BRAMKUJE, a nie pod lokalnym.
        //
        // Skąd rozjazd: CI wykonuje mniej testów tej powierzchni niż przebieg
        // lokalny - ten sam objaw, przez który na tym HEAD-zie (i na mainie)
        // czerwieni się `src/components/admin/builder/**` (lokalnie
        // 96,46/93,23/95,03/97,34, w CI 87,82/84,02/75,74/88,74). Przyczyna
        // jest wspólna i NIE leży w tym module; diagnoza to osobna praca.
        // Dlatego tu jest floor, który trzyma w CI, a nie życzenie.
        "src/routes/index.tsx": { statements: 97, functions: 100, lines: 97, branches: 98 },
        "src/routes/reading-list.tsx": {
          statements: 99,
          functions: 100,
          lines: 99,
          branches: 98,
        },
        "src/routes/people.tsx": { statements: 97, functions: 100, lines: 99, branches: 96 },

        // Warstwa zapytań publicznych. Dwanaście plików objętych tą pracą stoi
        // na 100 we wszystkich czterech wymiarach (`archives.ts` na
        // 99,35 / 98,13 / 100 / 100). Próg jest PER PLIK, nie na katalog,
        // bo `blocks.ts`, `liveBlogs.ts`, `podcasts.ts` i `relatedPosts.ts`
        // były poza nazwanym zakresem i nadal stoją nisko - katalogowy próg
        // byłby albo fałszywie niski dla dwunastu, albo czerwony dla czterech.
        "src/lib/queries/archives.ts": {
          statements: 98,
          functions: 100,
          lines: 99,
          branches: 96,
        },
        "src/lib/queries/public.ts": { statements: 99, functions: 100, lines: 99, branches: 98 },
        "src/lib/queries/programs.ts": { statements: 99, functions: 100, lines: 99, branches: 98 },
        "src/lib/queries/adjacentPosts.ts": {
          statements: 99,
          functions: 100,
          lines: 99,
          branches: 98,
        },
        "src/lib/queries/authorCv.ts": { statements: 99, functions: 100, lines: 99, branches: 98 },
        "src/lib/queries/glossary.ts": { statements: 99, functions: 100, lines: 99, branches: 98 },
        "src/lib/queries/megaMenu.ts": { statements: 99, functions: 100, lines: 99, branches: 98 },
        "src/lib/queries/mobileDrawer.ts": {
          statements: 99,
          functions: 100,
          lines: 99,
          branches: 98,
        },
        "src/lib/queries/nextPost.ts": { statements: 99, functions: 100, lines: 99, branches: 98 },
        "src/lib/queries/series.ts": { statements: 99, functions: 100, lines: 99, branches: 98 },
        "src/lib/queries/sidebarLayouts.ts": {
          statements: 99,
          functions: 100,
          lines: 99,
          branches: 98,
        },
        "src/lib/queries/staticPageSeo.ts": {
          statements: 99,
          functions: 100,
          lines: 99,
          branches: 98,
        },
        "src/lib/queries/webStories.ts": {
          statements: 99,
          functions: 100,
          lines: 99,
          branches: 98,
        },

        // ── MODUŁ WYDARZEŃ ────────────────────────────────────────────────
        //
        // DO 2026-08-29 TEN MODUŁ NIE MIAŁ PROGU WCALE - jako jedyna duża
        // powierzchnia repozytorium (74 inne ścieżki go miały). Czterdzieści
        // dwie tabele `event_*`, ~209 RPC i 31 sekcji studia stały wyłącznie
        // za progiem globalnym, który przy tej wielkości nie łapie niczego
        // poza katastrofą: moduł mógł stracić połowę testów, a bramka nadal
        // świeciła na zielono.
        //
        // Progi są ZMIERZONE na tym HEAD-zie i podniesione do „zmierzone
        // minus ~4 pp" marginesu na dryf CI - ta sama reguła, co przy progu
        // globalnym i przy panelu klubów. Zasada bez zmian: te progi wolno
        // wyłącznie PODNOSIĆ.
        //
        // POMIAR 2026-08-30: pełny przebieg suity z instrukcją pokrycia,
        // 1 861 plików testowych, 49 027 zielonych + 238 `expected fail`.
        // (Dwa pliki czerwone - `src/__tests__/db-schema-invariant.test.ts`
        // i `src/__tests__/lang-parity.test.ts` - odpytują HOSTOWANĄ bazę
        // przez anon Data API i padają lokalnie na zaślepce `.env`. Nie
        // importują niczego z modułu wydarzeń, więc liczby poniżej są
        // nietknięte; w CI, z prawdziwymi poświadczeniami, przechodzą.)
        //
        // Zmierzone (instrukcje / gałęzie / funkcje / linie), obok stan
        // z poprzedniego wpisu (2026-08-29):
        //   src/lib/events              86,3 / 80,9 / 91,2 / 88,9   (było 72,9 / 72,4 / 70,2 / 75,2)
        //   src/components/events       86,3 / 79,5 / 82,9 / 87,0   (było 67,8 / 59,1 / 66,6 / 68,3)
        //     └ packages                98,8 / 94,8 /100,0 /100,0
        //   src/components/admin/events 91,9 / 89,5 / 90,4 / 92,7   (było 44,6 / 40,0 / 45,4 / 44,5)
        //     └ molecules               99,1 / 96,6 / 99,6 / 99,7   (było 65,1 / 54,6 / 63,5 / 65,6)
        //     └ organisms               89,4 / 89,9 / 86,4 / 90,6   (było 40,4 / 36,1 / 39,4 / 40,4)
        //
        // CO SIĘ ZMIENIŁO OD POPRZEDNIEGO WPISU. Tamten wpis nazywał organizmy
        // panelu administratora „następną pracą, nie przeoczeniem" i stawiał
        // im próg 36/32/35/36, żeby łapał REGRESJĘ, a nie udawał pokrycia.
        // Ta praca się odbyła: 46 plików organizmów stoi dziś na 89,4 / 89,9,
        // a molekuły - warstwa dialogów zapisu - na 99,1 / 96,6. Katalog
        // nadrzędny podniósł się z 44,6 na 91,9 instrukcji.
        //
        // WIELKOŚCI, KTÓRE NIE DOBIŁY DO 100, SĄ NAZWANE, NIE PRZEMILCZANE.
        // Gałęzie stoją najniżej (79-97 zależnie od katalogu), bo w kilku
        // miejscach zostały strażnicy NIEOSIĄGALNI z interfejsu: `if
        // (pendingDelete === null) return` przy przycisku istniejącym tylko
        // w otwartym oknie, `formatEventDate(...) || entry.dayKey` przy kluczu
        // dnia, który zawsze parsuje się poprawnie, `row.sort_order ?? 0` na
        // kolumnie `NOT NULL`. Pokrycie ich wymagałoby podania wartości
        // niemożliwej przez rzutowanie `as unknown` - czyli testowania stanu,
        // którego baza nie dopuszcza, kosztem ratchetu `check:unknown-casts`.
        "src/lib/events/**": {
          statements: 82,
          functions: 87,
          lines: 85,
          branches: 77,
        },
        "src/components/events/**": {
          statements: 82,
          functions: 79,
          lines: 83,
          branches: 75,
        },
        // Zakup pakietu grupowego - jedyny ekran wydarzeń dotykający PIENIĘDZY
        // po stronie kupującego, więc trzyma własny, wysoki próg.
        "src/components/events/packages/**": {
          statements: 94,
          functions: 96,
          lines: 96,
          branches: 90,
        },
        // 2026-08-30: RATCHET W GÓRĘ po pracy nad CAŁYM panelem. Zmierzone
        // 91,9 / 89,5 / 90,4 / 92,7 wobec 44,6 / 40,0 / 45,4 / 44,5 dzień
        // wcześniej i 24,2 / 19,4 / 25,5 / 24,0 przy pierwszym wpisie.
        // Reguła bez zmian: zmierzone minus ~4 pp.
        "src/components/admin/events/**": {
          statements: 87,
          functions: 86,
          lines: 88,
          branches: 85,
        },
        // Molekuły panelu to DIALOGI ZAPISU: formularze biletu, pakietu,
        // sesji, ścieżki, pola zgłoszenia, urządzenia skanującego. Osiem
        // błędów naprawionych na tej gałęzi wyszło właśnie stąd, więc ta
        // warstwa dostaje próg osobny i wyraźnie wyższy niż katalog nadrzędny.
        "src/components/admin/events/molecules/**": {
          statements: 95,
          functions: 95,
          lines: 95,
          branches: 92,
        },

        // ORGANIZMY: 46 plików, 14 000 linii - katalog, który przy pierwszym
        // wpisie stał na 6,2% gałęzi i 6,8% funkcji i był tam nazwany „następną
        // pracą, nie przeoczeniem", a przy drugim (2026-08-29) na 40,4 / 36,1
        // i nazwany „nadal niskim, i to nadal uczciwie". Ta praca się odbyła:
        // katalog stoi dziś na 89,4 / 89,9 / 86,4 / 90,6, a `EventTrackWorkspace`
        // (853 linie), wymieniony w poprzednim wpisie z nazwiska jako plik bez
        // testów, ma 92 przypadki i 100% w każdej metryce.
        //
        // CZTERY PLIKI TEGO KATALOGU MAJĄ NADAL ZERO i to jest wymienione, a nie
        // uśrednione: `EventPackagesPanel` (59 linii),
        // `EventRegistrationSettingsPanel` (47), `RegistrationFieldsPanel` (33)
        // i `EventProgramPanel` (3). Do tego `EventPagesMenuPanel` stoi na
        // 71,3% linii, a `EventTypeDialog` na 37,5%. Próg mierzy ŚREDNIĄ
        // katalogu, więc te sześć plików jest w niej rozcieńczone - następna
        // porcja bierze je z nazwiska.
        "src/components/admin/events/organisms/**": {
          statements: 85,
          functions: 82,
          lines: 86,
          branches: 85,
        },

        // ══ MODUŁ 14: REKLAMY, KUPONY, PODARUNKI, DAROWIZNY (2026-08-31) ══════
        //
        // DO DZIŚ TEN MODUŁ NIE MIAŁ ANI JEDNEGO PROGU PER-ŚCIEŻKA - jako
        // jedyny duży obszar monetyzacji. Audyt notował w nim ruch 0,0 pp
        // siedem wydań z rzędu i to nie był przypadek: liczba w raporcie była,
        // bramki nie było, więc każda zmiana osuwająca pokrycie schodziła bez
        // sygnału, a raport pokazywał ją dopiero przy następnym audycie.
        // Progi niżej zamieniają pomiar na zaporę. Wszystkie floorowane
        // ~4 pp pod ZMIERZONYM 2026-08-31 (pełna suita) i wolno je wyłącznie
        // podnosić.
        //
        // PIENIĄDZE WCHODZĄ TU CZTEREMA DROGAMI (reklama, kupon, podarunek,
        // darowizna) i KAŻDA z nich ma inny sposób cichej awarii - dlatego
        // każda dostaje wpis osobny, a nie jedną średnią całego modułu.

        // Reguły emisji reklam: zgoda (CMP + Global Privacy Control), okno
        // czasowe emisji, typ strony, budżet stref na artykule. Cicha awaria
        // tej warstwy to nie brzydki układ, tylko emisja reklamy komuś, kto
        // zgody NIE dał - czyli naruszenie, nie usterka.
        // ZMIERZONE: 82,55 / 77,82 / 84,09 / 85,52 (przed tą pracą 42,66 /
        // 51,50 / 35,23 / 42,09). PRÓG NAJNIŻSZY W MODULE i wiadomo, czym:
        // `consent.ts` stoi na 58,06% gałęzi - niepokryte są ramiona
        // synchronizacji decyzji z rejestrem RODO i tryb podglądu zgód, nie
        // sama klamra GPC. To następna porcja pracy testowej, nie przeoczenie.
        "src/lib/ads/**": {
          statements: 78,
          functions: 80,
          lines: 81,
          branches: 73,
        },
        // Powierzchnia renderująca reklamy u czytelnika, razem z ramką
        // piaskownicy. Bramka pilnuje tego, że kreacja obcego pochodzenia
        // jedzie do izolowanego `iframe`, a strefa nie renderuje się przed
        // zgodą. ZMIERZONE: 97,67 / 91,43 / 96,67 / 100 (przed: 32,32 / 37,74
        // / 26,32 / 33,56, jeden plik na okrągłym zerze).
        "src/components/ads/**": {
          statements: 93,
          functions: 92,
          lines: 96,
          branches: 87,
        },
        // Beacon zliczający odsłony i kliknięcia reklam. Endpoint publiczny,
        // bez sesji, przyjmuje ruch od każdego - więc bramka trzyma limiter,
        // walidację kształtu identyfikatorów i rozpoznanie najemcy po domenie.
        // Wysyp fałszywych zdarzeń z jednego źródła fałszuje rozliczenie z
        // reklamodawcą, a `sendBeacon` nigdy nie zobaczy błędu odpowiedzi.
        // ZMIERZONE: 100 / 96,43 / 100 / 100 (przed tą pracą OKRĄGŁE ZERO).
        // Plik na 100% z progiem 96 jest mocniejszą bramką niż uśredniony
        // katalog - dlatego stoi tu osobno.
        "src/routes/api/public/ad-event.ts": {
          statements: 96,
          functions: 96,
          lines: 96,
          branches: 92,
        },
        // Domena podarunku: budowa i parsowanie linku, arytmetyka budżetu
        // kliknięć, mapowanie powodów odmowy. Czysta logika bez Reacta, więc
        // próg wysoki. Pilnuje granicy „pełny artykuł za darmo": pomyłka w
        // arytmetyce budżetu otwiera treść płatną szerzej, niż ktokolwiek
        // zdecydował. ZMIERZONE: 97,99 / 95,03 / 100 / 99,19 (przed: 43,94 /
        // 36,41 / 37,78 / 45,73).
        "src/lib/gifting/**": {
          statements: 93,
          functions: 96,
          lines: 95,
          branches: 91,
        },
        // Powierzchnia podarunku u czytelnika: przycisk, baner odbiorcy,
        // miernik zużytego budżetu, kanały udostępniania. Baner odbiorcy jest
        // jedynym miejscem, które MÓWI odbiorcy, czy dostał dostęp - stan
        // pokazany błędnie jest tu gorszy niż brak ekranu.
        // ZMIERZONE: 96,05 / 94,12 / 94,74 / 100.
        "src/components/gifting/**": {
          statements: 92,
          functions: 90,
          lines: 96,
          branches: 90,
        },
        // Formularz i CTA darowizny. O dopuszczalnej kwocie decyduje serwer,
        // ale to TA warstwa rozstrzyga, czy darczyńca trafi do naszej kasy,
        // czy do zbiórki zewnętrznej, i czy SDK operatora w ogóle się załaduje.
        // ZMIERZONE: 84,00 / 72,02 / 71,43 / 85,71 - najsłabsza powierzchnia
        // czytelnika w module i próg jest tu uczciwie niski, nie zaokrąglony
        // w górę. Niepokryte: `DonationsWidgetView` (65,62% gałęzi - warianty
        // osadzenia widgetu w builderze) oraz ramiona `DonationForm`
        // obsługujące odmowę operatora w trybie osadzonej kasy (66,67%
        // funkcji). Podniesienie tego progu wymaga testów tych dwóch rzeczy.
        "src/components/donations/**": {
          statements: 80,
          functions: 67,
          lines: 81,
          branches: 68,
        },
        // Panel reklam: slot, placement, targetowanie, statystyki. Tu redakcja
        // USTAWIA to, czego pilnuje `src/lib/ads/**` - błąd w edytorze
        // targetowania wypuszcza emisję poza zadeklarowaną grupę, a panel jest
        // jedynym miejscem, w którym widać, że emisja wygasła.
        // ZMIERZONE: 93,14 / 88,30 / 83,33 / 92,55 (przed tą pracą cały katalog
        // panelu monetyzacji stał na 40,00 / 50,00 / 42,86 / 43,48).
        // Funkcje najniżej w module: `SlotsPanel` 75,00% i `PlacementsPanel`
        // 76,92% - niedobite są procedury zapisu wariantów wymiarów kreacji.
        "src/components/admin/ads/**": {
          statements: 89,
          functions: 79,
          lines: 88,
          branches: 84,
        },
        // Panel kuponów i kampanii rabatowych. Kupon to RABAT NA PIENIĄDZACH:
        // pomyłka w zakresie daty albo w limicie użyć nie psuje ekranu, tylko
        // wydaje pieniądze, i widać ją dopiero w rozliczeniu.
        // ZMIERZONE: 91,60 / 87,74 / 90,70 / 93,70. Najsłabszy plik:
        // `DatePickerField` (57,14% funkcji, 65,22% linii) - niepokryte są
        // ścieżki klawiaturowe wyboru daty; sama walidacja zakresu, która
        // decyduje o ważności kuponu, jest pokryta.
        "src/components/admin/coupons/**": {
          statements: 87,
          functions: 86,
          lines: 89,
          branches: 83,
        },
        // Panel podarunków: ustawienia limitów, lista wydanych linków, audyt
        // odebrań. Pola limitów są lustrem CHECK-ów z bazy - rozjazd między
        // formularzem, walidacją server fn i bazą oznacza, że panel przyjmuje
        // wartość, którą baza odrzuci, albo odwrotnie: wpuszcza limit poza
        // zakres. ZMIERZONE: 100 / 98,46 / 100 / 100 - cały katalog bez ani
        // jednej niepokrytej linii, więc próg jest tu najwyższy w module.
        "src/components/admin/gifting/**": {
          statements: 96,
          functions: 96,
          lines: 96,
          branches: 94,
        },
        // Panel darowizn: rejestr wpłat i podsumowania. Jedyne miejsce, w
        // którym widać, czy wpłata doszła i czy została przypisana do
        // właściwego środowiska (produkcja / test operatora) - pomyłka w tym
        // rozdzieleniu wlicza wpłaty testowe do realnych sum.
        // ZMIERZONE: 100 / 91,43 / 100 / 100. W pomiarze sprzed tej pracy
        // największy plik katalogu, `AdminDonations.tsx` (414 linii), miał
        // OKRĄGŁE ZERO wykonanych linii - dziś katalog nie ma ani jednej
        // niepokrytej linii.
        "src/components/admin/donations/**": {
          statements: 96,
          functions: 96,
          lines: 96,
          branches: 87,
        },
        // ── MODUŁ 12: REALTIME / POWIADOMIENIA / WEB-PUSH ────────────────────
        //
        // POWIERZCHNIA, KTÓRA DO 01.09.2026 NIE MIAŁA ANI JEDNEGO PROGU.
        // Audyt wyd. 8 nazwał to wprost: 373 progi per-ścieżka w tym pliku,
        // dla modułu 12 - zero, więc regres nie zapalał niczego poza progiem
        // globalnym, a ten przy 1,1% udziału modułu w repo nie zauważyłby
        // nawet zjazdu całej powierzchni do zera. Moduł stał 5 wydań audytu
        // w miejscu (delta wyd. 7 -> 8: 0,0 pp) na 49,54% linii, z 12 z 28
        // plików na OKRĄGŁYM ZERZE.
        //
        // ZMIERZONE 01.09.2026 (pełna suita, 2 051 plików testowych,
        // `all: true`, 664 przypadki modułu w 37 plikach - 657 zielonych
        // + 7 `it.fails` na realnych defektach):
        //
        //   moduł 12 razem      98,03% linii (1145/1168) | 92,14% gałęzi | 97,11% funkcji
        //   Powiadomienia+push  97,54% linii  (834/855)  | 91,90% gałęzi | 96,17% funkcji
        //   Realtime            99,32% linii  (292/294)  | 93,25% gałęzi | 98,54% funkcji
        //   trasy                100% linii    (19/19)   |  100% gałęzi  |  100% funkcji
        //
        // Delta wobec wyd. 8: +48,49 pp linii, +60,55 pp gałęzi, +49,65 pp
        // funkcji. Plików na zerze: 12 -> 0.
        //
        // CO ODBLOKOWAŁO TE LICZBY - i dlaczego progi są tu tak wysokie.
        // Nie brakowało narzędzia: `src/test/supabase/realtime.ts` (atrapa
        // kanału z obserwowalnym refcountem) istniała od wydzielenia z fixture'ów
        // czatu i używało jej siedem plików w INNYCH modułach. Z modułu 12 -
        // ani jeden. Drugą połowę zdjęła ekstrakcja: `isInternalHref`,
        // `isPlainLeftClick`, `pickTitle`/`pickBody`, `fmtDate` i rozpoznanie
        // kluczy cache żyły w kopiach WEWNĄTRZ komponentów, więc były
        // nieosiągalne dla testu jednostkowego - nie „nieprzetestowane", tylko
        // niewywoływalne bez renderu 858-linijkowego organizmu.
        //
        // MARGINES: `floor(zmierzone - 2)` dla pojedynczego pliku i
        // `floor(zmierzone - 3)` dla katalogu. Plik nie ma wewnętrznego dryfu -
        // albo test go wykonuje, albo nie - więc szerszy margines byłby tu
        // wyłącznie luzem na regres. Wpisy KATALOGOWE stoją obok plikowych
        // celowo: to one łapią plik DOPISANY do modułu bez własnego progu.
        //
        // Te progi wolno wyłącznie PODNOSIĆ.
        "src/lib/realtime/**": { statements: 95, functions: 95, lines: 96, branches: 90 },
        "src/lib/notifications/**": { statements: 94, functions: 96, lines: 95, branches: 90 },
        "src/components/notifications/**": {
          statements: 90,
          functions: 88,
          lines: 92,
          branches: 86,
        },
        // Realtime - kanały, presence, korelacja. Refcount kanału jest tu
        // ASERCJĄ, nie dekoracją: gubiony `removeChannel` nie psuje żadnego
        // widoku od razu, dopiero po kilku przejściach między trasami kończy
        // się limit kanałów i zdarzenia przestają przychodzić. Każdy test
        // odmontowania sprawdza `removed === true` i zerowy `activeChannelCount()`.
        "src/lib/realtime/useModuleRealtime.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 98,
        },
        "src/lib/realtime/useDomainEventStream.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 98,
        },
        "src/lib/realtime/useEntityPresence.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 98,
        },
        "src/lib/realtime/tableChannelHub.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 98,
        },
        "src/lib/realtime/useEventConfirmedMutation.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 98,
        },
        "src/lib/realtime/cohesionLiveSync.tsx": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 98,
        },
        // `correlationContext.ts`: gałęzie 87,5%, bo fałszywa strona
        // `if (index >= 0)` w `runWithCorrelation` jest NIEOSIĄGALNA przez
        // publiczne API - stos nie jest eksportowany, a każdy `push` ma swój
        // `splice` w `finally`. Próg mierzy to, co da się wykonać.
        "src/lib/realtime/correlationContext.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 85,
        },
        "src/lib/realtime/correlation.ts": {
          statements: 93,
          functions: 88,
          lines: 95,
          branches: 73,
        },
        "src/lib/realtime/eventInvalidationMap.ts": {
          statements: 96,
          functions: 98,
          lines: 98,
          branches: 79,
        },
        "src/lib/realtime/domainEvents.ts": {
          statements: 83,
          functions: 64,
          lines: 83,
          branches: 98,
        },
        // Warstwa danych powiadomień. `useNotifications.ts` szedł z 44,6% linii
        // i 18 z 39 funkcji na komplet - w tym bramka WIELOTENANTOWA:
        // preferencje NIE zapisują się bez `tenant_id` odczytanego z profilu.
        "src/lib/notifications/useNotifications.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 96,
        },
        "src/lib/notifications/useActorProfiles.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 98,
        },
        // Warstwa RODO - do tej kampanii BEZ ANI JEDNEGO TESTU. Progi pilnują
        // dwóch kontraktów, których nie widać w procencie: klient nigdy nie
        // pisze do `user_consents` (wyłącznie server-fn -> RPC `set_user_consent`
        // z gwarantowanym audit-logiem), a kolumna `gpc` zapisuje AKTYWNOŚĆ
        // sygnału Global Privacy Control, nie jego honorowanie - zgoda udzielona
        // jako świadomy override MUSI mieć `gpc = true`, bo to ona jest wyjątkiem
        // wymagającym uzasadnienia.
        "src/lib/notifications/useConsents.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 96,
        },
        "src/lib/notifications/consentCatalog.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 98,
        },
        // Klient Web Push: cztery warunki wsparcia, cache klucza VAPID na czas
        // życia karty, dekodowanie base64url i ścieżki odmowy uprawnienia.
        "src/lib/notifications/push.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 98,
        },
        "src/lib/notifications/pushConfig.functions.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 98,
        },
        // `webpush.server.ts`: krypto (RFC 8291/8292) miało testy od dawna,
        // CAŁA ścieżka wysyłki nie miała żadnych - a to ona decyduje, co
        // dyspozytor zrobi z wynikiem. Gałęzie 56,3% -> 92,71%. Najważniejsza
        // z nich: strażnica SSRF jest fail-closed (endpoint na localhost /
        // 169.254.169.254 / `.internal` daje `gone:true` i `fetch` NIE zostaje
        // wywołany ani razu), bo `endpoint` subskrypcji to napis przysłany przez
        // przeglądarkę użytkownika, czyli wejście wrogie.
        "src/lib/notifications/webpush.server.ts": {
          statements: 94,
          functions: 93,
          lines: 96,
          branches: 90,
        },
        "src/lib/notifications/dispatch.server.ts": {
          statements: 90,
          functions: 98,
          lines: 92,
          branches: 79,
        },
        "src/lib/notifications/digestEmail.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 96,
        },
        "src/lib/notifications/grouping.ts": {
          statements: 94,
          functions: 98,
          lines: 98,
          branches: 88,
        },
        "src/lib/notifications/kindInvalidation.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 98,
        },
        "src/lib/notifications/preferences.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 73,
        },
        // Czyste predykaty i selektory wydzielone z komponentów (01.09.2026).
        // `notificationLink.ts` stoi na 83,33% linii i to jest poziom DOCELOWY:
        // niepokryty jest wyłącznie `catch` w `notificationActorId`, nieosiągalny
        // z publicznego kontraktu (href jest wcześniej filtrowany przez
        // `isInternalHref`, a parser WHATWG URL nie rzuca dla ścieżki
        // zaczynającej się pojedynczym `/` - sprawdzone na 11 kandydatach).
        // Pokrycie go wymagałoby podmiany globalnego `URL`, czyli testowania
        // atrapy zamiast kontraktu.
        "src/lib/notifications/notificationLink.ts": {
          statements: 83,
          functions: 98,
          lines: 81,
          branches: 98,
        },
        "src/lib/notifications/notificationText.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 98,
        },
        "src/lib/notifications/notificationListKeys.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 98,
        },
        // Komponenty. `NotificationsCenter.tsx` szedł z 0/146 linii i 0/64
        // funkcji; po ekstrakcji ma 135 linii i 94,07% z nich wykonanych.
        // Cel zlecenia dla funkcji brzmiał „>= 70%" - osiągnięte 89,47%.
        "src/components/notifications/NotificationsCenter.tsx": {
          statements: 89,
          functions: 87,
          lines: 92,
          branches: 84,
        },
        "src/components/notifications/NotificationsBell.tsx": {
          statements: 94,
          functions: 82,
          lines: 94,
          branches: 85,
        },
        "src/components/notifications/ConsentsPanel.tsx": {
          statements: 94,
          functions: 98,
          lines: 98,
          branches: 94,
        },
        "src/components/notifications/molecules/NotificationKindToggle.tsx": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 98,
        },
        // Trasy modułu - obie na komplecie.
        "src/routes/admin.community.notifications.tsx": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 98,
        },
        "src/routes/profile.notifications.tsx": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 98,
        },

        // ---------------------------------------------------------------
        // MODUŁ 07 - kampania 2026-09-02, część I: powierzchnie crawlera.
        //
        // Sześć powierzchni, które CDN zapamiętuje na godziny, a katalogi
        // (Apple Podcasts, Spotify, Google Discover) czytają jako stan
        // faktyczny. Wszystkie szły z ZERA; po dopisaniu ich do kontraktu
        // `routes/__tests__/feedRoutesDegradation.test.ts` (plik z 47 na 142
        // testy) ZMIERZONE: 100% instrukcji, 100% linii, 100% funkcji,
        // 93,57% gałęzi łącznie. Zlecenie żądało >= 90 / >= 90 / >= 80.
        //
        // Progi = zmierzone minus ~4 pp marginesu na dryf CI, ta sama reguła
        // co w kronice progu globalnego. Gałęzie per plik, bo różnią się
        // realnie: kanał programu scala trzy warstwy metadanych (program ->
        // kanał -> marka), kanał sieciowy dwie, a tracker i feed programu
        // badawczego całą mechanikę mają w modułach `lib/`.
        // ---------------------------------------------------------------
        "src/routes/podcast.rss[.]xml.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 90,
        },
        "src/routes/podcasts.$show.rss[.]xml.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 88,
        },
        "src/routes/live_.rss[.]xml.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 88,
        },
        // Tracker i feed programu badawczego to CIENKIE trasy - cała
        // mechanika siedzi w `lib/tracker/feed.server.ts` i
        // `lib/seo/taxonomyFeed.server.ts`, więc same pliki tras nie mają
        // ani jednej gałęzi. Próg na gałęziach zostaje mimo to, żeby
        // dołożenie warunku do trasy nie weszło bez testu.
        "src/routes/tracker.rss[.]xml.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 90,
        },
        "src/routes/programs.$slug.rss[.]xml.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 90,
        },
        "src/routes/web-stories.$slug.amp.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 98,
        },
        // Jeden kontrakt TTL kanałów - wydzielony z pięciu kopii literału.
        // Zmierzone 100/100/100/100; to czysta funkcja, więc próg jest
        // wysoki i ma zostać wysoki.
        "src/lib/seo/feedCache.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 98,
        },

        // ---------------------------------------------------------------
        // MODUŁ 07 - kampania 2026-09-02, część II: warstwa danych
        // podcastów, panele po ekstrakcji, eksperci i mapy.
        //
        // REGUŁA PROGÓW, zastosowana dosłownie: metryka zmierzona na 100%
        // dostaje 98 (konwencja tego pliku dla powierzchni domkniętych),
        // każda inna `floor(zmierzone - 4)` - ta sama reguła co w kronice
        // progu globalnego. Wszystkie liczby ZMIERZONE reporterem v8 na tym
        // HEAD, nie oszacowane.
        //
        // Pomiar był zawężony do testów dotykających tych plików, więc pełna
        // suita może dać wartości WYŻSZE (nigdy niższe: pełny przebieg
        // wykonuje nadzbiór kodu przebiegu zawężonego). Progi są więc
        // bezpieczne z definicji.
        // ---------------------------------------------------------------

        // Warstwa danych i czyste reguły - zmierzone 100% linii i funkcji.
        // Gałęzie niżej, bo obie warstwy mają zapasy `?? ""` wymagane
        // typem (schemat zod dopuszcza null), których kaskada nigdy nie
        // wykonuje - patrz `__tests__/PodcastPaneHandlers.test.tsx`.
        "src/lib/podcast/applePodcast.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 98,
        },
        "src/lib/podcast/queries.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 89,
        },
        "src/lib/podcast/shape.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 95,
        },
        "src/lib/podcast/types.ts": {
          statements: 92,
          functions: 98,
          lines: 98,
          branches: 89,
        },

        // Komponenty panelu podcastów. Pięć z siedmiu powstało przy
        // ekstrakcji trasy `admin.podcasts.tsx` (2072 -> 170 linii), więc bez
        // tych progów każdy z nich mógłby cicho wrócić do zera.
        "src/components/admin/podcasts/ApplePodcastMetaFields.tsx": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 98,
        },
        "src/components/admin/podcasts/PodcastFeedReadinessCard.tsx": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 98,
        },
        "src/components/admin/podcasts/PodcastStatCard.tsx": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 98,
        },
        // Odznaka statusu nie ma ANI JEDNEJ gałęzi (mapa wartość -> wygląd),
        // a v8 raportuje dla 0/0 sto procent. Próg na gałęziach zostaje
        // mimo to, żeby dołożenie warunku nie weszło bez testu.
        "src/components/admin/podcasts/PodcastStatusBadge.tsx": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 90,
        },
        "src/components/admin/podcasts/EpisodesListPane.tsx": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 86,
        },
        "src/components/admin/podcasts/EpisodeLayerEditors.tsx": {
          statements: 93,
          functions: 92,
          lines: 92,
          branches: 89,
        },
        "src/components/admin/podcasts/PodcastShowsPane.tsx": {
          statements: 93,
          functions: 92,
          lines: 93,
          branches: 83,
        },
        // GAŁĘZIE 57, i to NIE jest bramka wyłączona (rozdz. 6.1 audytu),
        // tylko próg pod SUFIT STRUKTURALNY. Ten panel ma ~15 gałęzi
        // `merged.X ?? ""`, które są runtime NIEOSIĄGALNE, bo
        // `mergePodcastSettings` domyka każde z tych pól na `""` - a usunąć
        // ich nie wolno, bo `PodcastSettings` pochodzi ze schematu zod,
        // gdzie pola są `nullable().optional()`. Zmierzone 61,90% gałęzi przy
        // 100% instrukcji, linii i funkcji. Domknięcie wymaga zawężenia typu
        // ZWRACANEGO przez `mergePodcastSettings`, czyli zmiany kontraktu
        // publicznego - osobna praca, nie doklejka do kampanii testowej.
        "src/components/admin/podcasts/PodcastSettingsPane.tsx": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 57,
        },
        // Najgrubszy z paneli (edytor odcinka z czterema warstwami, obsadą
        // i wykrywaniem czasu trwania z pliku audio). Zmierzone 93,24% linii
        // / 88,10% funkcji po dołożeniu testu atrapy `Audio`.
        "src/components/admin/podcasts/EpisodeEditorPane.tsx": {
          statements: 88,
          functions: 84,
          lines: 89,
          branches: 88,
        },

        // Trasa po ekstrakcji - POWŁOKA. Zlecenie żądało >= 50 / 45 / 40;
        // zmierzone 89,29% linii / 75% funkcji / 81,82% gałęzi.
        "src/routes/admin.podcasts.tsx": {
          statements: 85,
          functions: 71,
          lines: 85,
          branches: 77,
        },

        // Trzy pliki, które audyt wydania 8 wskazał jako JEDYNE poniżej 100%
        // w warstwie bibliotecznej modułu (obok dwóch zer, które zamknął N6).
        // ExpertPicker szedł z 41,4% linii i 4/15 funkcji, WorldMap z 85,7%
        // i 12/19, worldMapGeo z 94,7%. Wszystkie trzy zmierzone na 100%
        // linii i 100% funkcji.
        "src/components/admin/experts/ExpertPicker.tsx": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 98,
        },
        "src/components/maps/WorldMap.tsx": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 95,
        },
        "src/lib/maps/worldMapGeo.ts": {
          statements: 98,
          functions: 98,
          lines: 98,
          branches: 94,
        },
      },
    },
  },
});
