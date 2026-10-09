# P3.9: recenzja adwersaryjna (fala 3, partia 3c)

Worktree `wt3/P3.9`, commit `cf1076b8` na `5adde441` (jeden commit, rodzic = `5adde441`, drzewo czyste).
Diff: 6 plików (`WidgetView.tsx`, `JoinUsForm.tsx`, `formFieldConfig.tsx`, nowy `customFieldDefs.ts`, dwa testy).

## Werdykt: APPROVE (0 blokujących, 0 poważnych, 5 drobnych)

Część A działa zgodnie z planem, a mechanizm jest ten, który plan opisał. Część B pominięto jawnie. Powód jest
zmierzony i potwierdziłem go niezależnie. Nie znalazłem regresji SSR/hydratacji, grafu chunków, budżetów ani zachowania.

## Co sprawdziłem samodzielnie

1. **Zakres.** Zmienione są tylko pliki z części A planu i testy. Nie ruszono `vite*.config.ts`, `i18n.ts`, tras,
   `FooterSlideup.tsx` ani plików P3.2b. Nie ma nowych zależności ani zbędnych plików. Trailer commita zgadza się
   co do znaku. Komentarze i opis commita są po polsku.
2. **Przeniesienie 1:1.** `tail -n +19 customFieldDefs.ts` i `git show 5adde441:…/formFieldConfig.tsx` w liniach
   19–133 są IDENTYCZNE (`diff` pusty). Reeksport obejmuje cały dawny publiczny zestaw (5 funkcji i 3 typy), a
   `formFieldConfig.test.tsx` przechodzi bez edycji. Jedynym importerem wartości `customFieldDefs` jest
   `formFieldConfig.tsx`. Poza nim i testami nikt nie importuje `formFieldConfig`/`customFieldDefs` z
   dyspozytora, wejścia ani `lazyWidgets`.
3. **Graf.** `p39-graph-check.py`:
   - baza `base-w3e`: 12 naruszeń, wszystkie w domknięciu `WidgetView`;
   - końcowy inwentarz B: **OK, 0 naruszeń**; `WidgetView` ma 11 chunków zamiast 20, a komponent `/` ma
     22 chunki i 3 908 995 B, czyli tyle co baza;
   - `customFieldDefs.ts` i `formFieldConfig.tsx` są w `JoinUsForm-*.js` (dyn=True, 1 importer statyczny, czyli
     `club.apply`, jak dotąd);
   - nagłówek `WidgetView-*.js` w `.output` importuje tylko `vendor-react`, wejście i `vendor-tanstack`.
4. **Przesłanka części B na bazie.** Na `base-w3e` `FooterSlideup.tsx` ma własny chunk
   (`FooterSlideup-Bk1WUnPR.js`, 2 moduły), a w domknięciu `/` nie ma komponentu `/blog`, `FriendlyErrorPage`,
   `Breadcrumbs` ani locale `date-fns`. Kryterium dowodu „bez chunku /blog z FooterSlideup” było więc spełnione,
   zanim P3.9 cokolwiek zmienił. Inwentarz wariantu 1 z §7 (`chunk-inventory-variant1.json`) potwierdza raport:
   bramka daje OK, `FooterSlideup` ma 3 importerów statycznych (`conversions.ts` doklejony do chunku), a
   domknięcie `/` nadal ma 22 chunki, czyli wariant nie daje zysku.
5. **Budżety (JSON A i B).**
   - `bootClosureRawBytes` −141, `bootClosureGzipBytes` −34, `bootBurstGzipBytes` −32, `bootBurstCount` 26 = 26;
   - `htmlGzipBytes` i `preLcpTransferBytes` +7 B. Przyczyna to inne hasze w `#nes-boot-set`, nie wzrost kodu;
   - `check:bundle` zielony. Ostrzeżenia o ruchach (`SeoPanel` +2,4 KB itd.) liczą się względem starego
     baseline'u `b006c2e` i są te same co w bazie: `SeoPanel` ma 65 338 B w A i w B;
   - `check:chunks` zielony: 894 chunki (A: 895), graf acykliczny.
6. **SSR i hydratacja.** Parsowanie przeszło z `WidgetView` do `JoinUsForm` i na serwerze, i na kliencie, więc
   wejście i wyjście renderu są te same i nie ma rozjazdu HTML. `useMemo` stoi przed pierwszym `return` i za
   `useState`, więc kolejność hooków jest stała. `cfList` nie jest zależnością żadnego efektu. Nowy prop nie
   trafia do DOM, bo jest zdestrukturyzowany.
7. **Edytor, EN i zalogowani.** Ścieżka edytora (`WidgetView` z `editable`) przekazuje surową treść tak samo.
   `useMemo` liczy się od referencji treści, a edytor tworzy nowe obiekty treści, więc podgląd na żywo
   przelicza pola. Język i zgody są bez zmian.
8. **Bramki szybkie (uruchomione przeze mnie w worktree):**
   - `bunx eslint` na 6 plikach: 0 błędów, 8 ostrzeżeń `react-refresh/only-export-components`, tego samego
     rodzaju co na bazie (w `formFieldConfig` teraz na reeksporcie);
   - `bunx prettier --check`: czysto;
   - `bunx vitest run` dla `widgetViewJoinUsCustomFields`, `joinUsForm` i `formFieldConfig`: 3 pliki,
     **154 passed + 3 expected fail**;
   - `bun run verify:static`: **15 bramek OK** (exit 0).

## Lantern i realizm zysku

Na `/` fixture'a i produkcji `join-us` stoi w sekcji 6 (`home-body[0].builder_data.sections[6]`), czyli w wyspie.
Wyspa otwiera się:

- przy widoczności,
- przy pierwszej interakcji lub przewinięciu,
- w punkcie ciszy, czyli po 5 s ciszy. Ten punkt leży poza śladem Lighthouse'a (`whenQuiescent.ts`).

Na bazie `JoinUsForm-*` nie było na liście 53 żądań `/` (`base-m1-js.txt`). W śladzie Lighthouse'a 9 chunków
(~75 KB gz) znika więc naprawdę, nie przesuwa się w obrębie śladu. U czytelnika, który przewinie stronę, te same
chunki przyjdą przy otwarciu wyspy razem z `JoinUsForm`. Vite ładuje wtedy zależności z `__vite__mapDeps`
równolegle, więc wodospad nie robi się głębszy, a HTML wyspy jest już z SSR, więc nie ma nowej zmiany wizualnej.
Zmiana dotyczy bajtów, żądań i kompilacji w oknie TBT, a nie LCP ani SI. Potwierdzić to ma etap Prove.

## Ustalenia

### m1 [minor] Część B pominięta: orkiestrator musi ją jawnie przyjąć (IMPL §3–§4)

- **Dowód.** Notatki orkiestratora wymieniają część B jako zakres. Pominięcia nie ukryto: IMPL §3 opisuje je z
  pomiarem, a plan §7.2 przewiduje „zatrzymać się i przekazać; część A wchodzi sama”. Potwierdziłem, że na
  `5adde441` przesłanka B nie istnieje (pkt 4).
- **Brak dowodu.** Inwentarz buildu 1 (wariant z planu, „22 naruszenia”) nie został zachowany. Nadpisał go build
  2/3, a w katalogu raportu nie ma `graph-check` dla buildu 1.
- **Poprawka.** Orkiestrator zapisuje decyzję „B nie dotyczy bazy po P3.8” w księdze fali. Zysk z §3.2 IMPL
  (`conversions.ts` poza chunkiem paska, ok. 2 żądania i 2,6 KB gz) warto przekazać do P3.10 jako osobny wpis.
  Nie trzeba niczego zmieniać w kodzie.

### m2 [minor] Nieprawdziwe zdanie w komentarzach: „widget, którego tam nie ma”

- **Gdzie.** `src/components/builder/organisms/__tests__/widgetViewJoinUsCustomFields.test.tsx:8` („~64 KB
  transferu na `/` dla widgetu, którego tam nie ma”). Podobnie IMPL §2.1.
- **Dowód.** Strona główna fixture'a ma `join-us` w sekcji 6 (diagnoza `zapytania-po-boocie.md:79`, `:446`).
  Kod nie jest usuwany z `/`, tylko odkładany do otwarcia wyspy.
- **Poprawka.** Zmienić na „…na `/`, zanim wyspa z widgetem się otworzy (przewinięcie lub punkt ciszy)”.

### m3 [minor] Test grafu ładowania zależy od kolejności testów

- **Gdzie.** `widgetViewJoinUsCustomFields.test.tsx:86-101`. Pierwszy test sprawdza `loads === 0`, a drugi
  podnosi licznik. Przy `--sequence.shuffle` albo `it.only` na drugim teście asercje stają się fałszywe.
- **Poprawka.** W pierwszym teście `vi.resetModules()`, potem `await import("@/components/builder/organisms/WidgetView")`
  i asercja na liczniku. Albo zerować licznik w `beforeEach` i w każdym teście importować dyspozytor dynamicznie.

### m4 [minor] Brak testu na aktualizację pól przy zmianie surowej treści

- **Dowód.** Wyobrażona regresja: deps `useMemo` z `JoinUsForm.tsx:277-280` zamienione na `[]`. Żaden nowy test by
  jej nie wykrył, bo każdy montuje komponent raz. W edytorze pole dodane w panelu nie pojawiłoby się w podglądzie.
- **Poprawka.** W `joinUsForm.test.tsx` dodać `rerender` z nową tablicą `customFieldsSource`: nowe pole się
  pojawia, a usunięte znika.

### m5 [minor] Nie uruchomiono e2e popupów i stopki z notatek

- **Dowód.** Notatki wymagają „e2e artefaktu i popupów/stopki zielone”. Uruchomiono tylko `test:e2e:artifact`
  (18 passed). Specyfikacji `on-demand-overlays` i `ssr-degradation` nie uruchomiono, z uzasadnieniem, że B nie
  weszło, a pasek i nakładki są bez zmian. Diff to potwierdza: nie dotyka tych ścieżek.
- **Poprawka.** Uruchomić je w etapie Prove razem z Lighthouse'em (przez mutex) albo jawnie zwolnić decyzją
  orkiestratora.

## Nie znalazłem

- Nowej statycznej krawędzi do wejścia ani domknięcia bootu (chunk wejściowy ma ten sam kod, a mniejszy jest
  tylko `__vite__mapDeps`).
- Cykli, pinów ani zmian w nazwanych chunkach.
- Zmian w zachowaniu walidacji i payloadu: testy z surowej treści obejmują payload, wymagalność, pierwszeństwo
  `customFields`, wadliwe linie i pustą treść. Kontrola negatywna implementera na kodzie bazy zawiodła w 4 nowych
  testach, czyli testy łapią cofnięcie zmiany.
- Problemów z a11y, CLS, SEO i zgodami: markup pól jest ten sam, a renderer bez zmian.
