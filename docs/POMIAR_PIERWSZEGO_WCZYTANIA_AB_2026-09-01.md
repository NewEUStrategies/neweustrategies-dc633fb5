# Pomiar porównawczy pierwszego wczytania: `1d5d0ed` → `ecff3f2`

**Data:** 2026-09-01
**Pytanie:** czy praca zamykająca rozdział 8.6 audytu (SSR, hydratacja, pierwsze wczytanie strony publicznej) sprawiła, że strona wczytuje się szybciej?
**Odpowiedź w jednym zdaniu:** na mierzonej trasie **nie szybciej i nie wolniej** - wszystkie metryki czasowe i bajtowe mieszczą się w zmierzonym paśmie szumu; zmieniły się natomiast dwie rzeczy, których żadna z tych liczb nie pokazuje, a jedna z nich była całkowicie martwa.

---

## 0. Dlaczego ten dokument istnieje

Rozdział 8.6 został zamknięty i zmergowany (PR #314), ale nie dało się poprzeć liczbą ani jednego zdania o przyspieszeniu - bo **pomiaru bazy nie było**. Repozytorium miało bramkę BUDŻETU (`e2e/boot-timing.spec.ts`: „czy TTFB, gotowość i transfer bootu mieszczą się w progach") i nie miało niczego, co odpowiadałoby na inne pytanie: „czy ta zmiana przyspieszyła wczytywanie".

To są dwa różne pytania i pierwsze nie odpowiada na drugie. Bramka progowa przechodzi zarówno wtedy, gdy zmiana zyskała 30%, jak i wtedy, gdy straciła 30%, dopóki obie liczby są pod progiem.

Ten dokument jest **pierwszym pomiarem porównawczym** w historii tego repozytorium, a `bun run measure:boot-ab` - narzędziem, którym każdy następny da się powtórzyć.

## 1. Metoda

| składnik      | wartość                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------- |
| baza          | `1d5d0ed` (punkt odgałęzienia PR #314)                                                                              |
| stan mierzony | `ecff3f2` (main po merge'u; drzewo bajt w bajt równe `78433c4`)                                                     |
| artefakt      | `vite.smoke.config.ts`, preset `node-server`, `node .output/server/index.mjs`                                       |
| przeglądarka  | Chromium z `/opt/pw-browsers`, `devices["Desktop Chrome"]`                                                          |
| trasa         | `/cookies`                                                                                                          |
| Supabase      | zaślepka `https://placeholder.supabase.co` (tak jak w CI)                                                           |
| zależności    | **te same** dla obu stron (`node_modules` przez symlink; `dependencies` i `devDependencies` porównane - identyczne) |
| przebiegi     | 1 na stronę, `workers: 1`, `retries: 0`                                                                             |

**Sonda jest przenośna i to jest warunek wiarygodności wyniku.** Nie wolno jej używać `__nesBootT0`, `__nesBootDead` ani `__nesBootErrors`, bo te globalne stawia sonda bootu dodana mierzoną zmianą - pomiar oparty na nich mierzyłby własną obecność i „nowe" wychodziłoby lepiej z definicji. Czas liczony jest od `responseStart` z Navigation Timing, czyli od przeglądarki, nie od aplikacji. Jedynym wyjątkiem jest `__nesAppReady`, obecny w obu drzewach - sprawdzone, nie założone (baza: `previewWatchdog.ts:18`).

## 2. Wynik

Liczby z przebiegu `bun run measure:boot-ab 1d5d0ed /cookies` **po naprawie czterech znalezisk recenzji** (sekcja 7). Pierwszy przebieg tego pomiaru dał inne wartości dwóch wierszy - nie usuwam tego faktu, bo różnica pokazuje dokładnie, na czym polegała naprawa (sekcja 7.3).

| metryka                        | BAZA `1d5d0ed`   | PO `ecff3f2` | różnica          | werdykt          |
| ------------------------------ | ---------------- | ------------ | ---------------- | ---------------- |
| TTFB dokumentu                 | 5 068 ms         | 5 064 ms     | -4 ms (-0,1%)    | szum             |
| First Contentful Paint         | 5 312 ms         | 5 272 ms     | -40 ms (-0,8%)   | szum             |
| **gotowość (`__nesAppReady`)** | **brak sygnału** | **491,3 ms** | -                | **pojawiło się** |
| dokument SSR                   | 76 860 B         | 77 414 B     | +554 B (+0,7%)   | szum             |
| treść tekstowa w SSR           | 2 298 zn.        | 2 298 zn.    | 0                | szum             |
| JS bootu RAZEM                 | 2 580,6 KB       | 2 591,6 KB   | +11,0 KB (+0,4%) | szum             |
| w tym plików                   | 70               | 71           | +1 (+1,4%)       | szum             |
| domknięcie statyczne           | 1 955,8 KB       | 1 966,2 KB   | +10,4 KB (+0,5%) | szum             |
| plików statycznych             | 12               | 12           | 0                | szum             |
| dociągnięte dynamicznie        | 624,8 KB         | 625,4 KB     | +0,6 KB (+0,1%)  | szum             |
| plików dynamicznych            | 58               | 59           | +1 (+1,7%)       | szum             |
| CSS                            | 557,3 KB         | 557,3 KB     | 0                | szum             |
| hintów `modulepreload` w DOM   | 67               | 68           | +1 (+1,5%)       | szum             |

Werdykt narzędzia: **poza pasmem szumu wyszła dokładnie jedna metryka** - gotowość, i to jako „pojawiło się", nie jako zmiana wartości.

Hinty `modulepreload` w nagłówku `Link`:

- **BAZA:** (brak)
- **PO:** `/assets/pl-DEZyBPCt.js`

### Pasma szumu - skąd

Werdykt „szum" nie jest uznaniowy. Pasma wyprowadzone z rozrzutu **sześciu przebiegów tej samej sondy na tym samym artefakcie** (zapisane w nagłówku `e2e/boot-timing.spec.ts`):

| klasa metryki | rozrzut zmierzony                                               | pasmo przyjęte |
| ------------- | --------------------------------------------------------------- | -------------- |
| czas          | 2,3% (TTFB 5 075,6 - 5 194,9 ms)                                | 5%             |
| bajty         | 1,1% (2 270,1 - 2 294,2 KB)                                     | 2%             |
| liczba plików | 33,6% na gotowości; 21 wobec 54 plików dynamicznych host↔runner | 25%            |

Trzy pasma, nie jedno: bajty są powtarzalne (artefakt deterministyczny), czas zależy od maszyny, a liczba dociągniętych chunków zależy od niej najmocniej - szybsza maszyna zdąża pobrać więcej leniwych chunków przed flagą gotowości. Jedno wspólne pasmo musiałoby przyjąć najgorszy przypadek (34%) i przegapiłoby realną, trzydziestoprocentową regresję bajtów.

## 3. Co się faktycznie zmieniło

### 3.1. Flaga gotowości była MARTWA na każdej publikowanej stronie

To najważniejsze ustalenie tego pomiaru i zostało **znalezione pomiarem, nie z lektury diffu**. Sonda odpytywała `__nesAppReady` przez 30 s (dwukrotność progu martwej hydratacji) i na bazie nie dostała jej **ani raz**.

Przyczyna, prześledzona w kodzie bazy:

- jedynym pisarzem flagi jest `markPreviewAppReady()` (`previewWatchdog.ts:179`);
- jedynym jego wywołaniem jest `__root.tsx:493`;
- to wywołanie stoi **wewnątrz `if (inPreviewIframe)`**, czyli wykonuje się wyłącznie w iframie edytora podglądu.

Na publikowanej stronie - u każdego prawdziwego czytelnika - flaga nie pojawiała się nigdy. Znaczy to, że **nie istniał żaden sygnał odróżniający „zhydratowano" od „martwe"**: dokładnie ta klasa awarii, którą rozdział 8.6 miał zamknąć, była niewidoczna dla jedynego mechanizmu, który miał ją widzieć.

Po zmianie `markAppReady()` stoi bezwarunkowo i synchronicznie (`__root.tsx:631`), a pomiar oddaje **491,3 ms**.

To **nie jest przyspieszenie** i nie należy go tak przedstawiać - brak flagi nie zwalniał strony. To jest różnica w OBSERWOWALNOŚCI, bez której zdanie „strona wczytuje się poprawnie" nie było sprawdzalne.

### 3.2. Hint `modulepreload` rdzenia słownika: z martwego na żywy

Nagłówek `Link` bazy nie niósł ani jednego celu `modulepreload`. Po zmianie niesie chunk rdzenia słownika (`/assets/pl-DEZyBPCt.js`).

Ten zysk **nie jest widoczny w tabeli** i trzeba powiedzieć dlaczego: sonda mierzy SUMĘ transferu, a hint nie zmniejsza liczby pobranych bajtów - **skraca ścieżkę krytyczną**. Bez hintu przeglądarka pobiera komplet preloadów manifestu, zaczyna wykonywać chunk wejściowy, dopiero wtedy odkrywa `import("@/lib/locale/pl")` i płaci kolejny szeregowy hop (rdzeń: pl 26,0 KB gzip, en 22,8 KB gzip) - w oknie, w którym cała reszta już czeka na hydratację. Zmierzenie tego wymaga wodospadu żądań, nie sumy bajtów, i jest do zrobienia następnym krokiem.

### 3.3. Artefakt jest MINIMALNIE cięższy i to jest uczciwa cena

+11,0 KB JS (+0,4%) i +929 B dokumentu SSR (+1,2%). Oba mieszczą się w paśmie szumu, więc formalnie nie są różnicą - ale kierunek jest jednoznaczny i nie ma powodu go ukrywać: doszła sonda bootu (skrypt inline w dokumencie), hint słownika i budżet hydratacji. **Ta praca nie odchudziła bundla i nigdy tego nie obiecywała.**

### 3.4. TTFB został przy JEDNYM budżecie zapytań, nie dwóch

5 066,4 → 5 068,5 ms. Obie liczby to `SSR_QUERY_TIMEOUT_MS` = 5 000 ms: przy zaślepce Supabase zapytania loaderów nie mają dokąd pójść i render czeka na cały budżet.

Wygląda to na brak informacji, a jest informacją **negatywną i wartościową**: gdyby przebudowa fal prefetchu zaszeregowała budżety, TTFB wyszedłby ~10 000 ms (dwa budżety) albo ~15 000 (trzy). Nie wyszedł. Fale nadal jadą równolegle - a to jest jedyna rzecz, którą ta metryka w tym środowisku potrafi rozstrzygnąć, i rozstrzyga ją po dobrej stronie.

## 4. Czego ten pomiar NIE pokazuje

Ograniczenie jest jedno i jest poważne: **artefakt gada z zaślepką Supabase, więc żadne zapytanie nie wraca z danymi.**

Główny zysk prefetchu SSR - treść obecna w PIERWSZYM dokumencie zamiast dociągana po hydratacji - jest tym pomiarem **niemierzalny**. Identyczna `treść tekstowa w SSR` po obu stronach (2 298 znaków) potwierdza wyłącznie, że bez danych obie wersje renderują tę samą statyczną powłokę; nie mówi nic o tym, ile treści schodzi z serwera, gdy baza odpowiada.

To zdanie ma teraz oparcie, którego pierwsza wersja tego dokumentu **nie miała**. Wcześniej ta metryka pochodziła z `document.body.innerText` po hydratacji, czyli argumentowałem o zawartości pierwszego dokumentu SSR na podstawie stanu DOM-u po wykonaniu całego bundla. Teraz liczba pochodzi z surowego HTML-a odpowiedzi nawigacyjnej - szczegóły w sekcji 7.3.

Wniosek praktyczny: **na trasach z prawdziwymi danymi ten pomiar trzeba powtórzyć**, i to jest jedyna droga do liczby na pytanie „czy czytelnik zobaczy treść szybciej". Do tego czasu jedyne uczciwe zdanie brzmi: na mierzonej trasie pierwsze wczytanie nie zmieniło się w sposób wykrywalny, a dwie rzeczy, które się zmieniły, dotyczą obserwowalności i ścieżki krytycznej, nie sumy bajtów.

Poza tym: jeden przebieg na stronę (nie sześć), jedna trasa, jedna maszyna, brak pomiaru z runnera GitHuba.

## 5. Jak to powtórzyć

```bash
bun run measure:boot-ab <rewizja-bazowa> [trasa]
bun run measure:boot-ab 1d5d0ed /cookies
```

Skrypt zakłada worktree na rewizji bazowej (nie rusza drzewa roboczego), buduje oba artefakty, mierzy je tą samą sondą, wypisuje tabelę różnic i sprząta worktree.

**Świadomie `measure:*`, a nie `check:*`, czyli nie jest to bramka CI** - z dwóch powodów. Koszt: dwa pełne buildy artefaktu (zmierzone 1 min 47 s + 2 min 41 s na hoście, w CI ≥ 3 min 30 s każdy) plus dwa przebiegi przeglądarki. Charakter: wynik jest RÓŻNICĄ, a nie progiem - nie ma liczby, przy której „wolniej" powinno automatycznie wywalić przebieg, bo +11 KB za wcześniej martwy hint to dobry interes, a te same +11 KB za nic to zły. Tę ocenę robi człowiek. Progów pilnuje `e2e/boot-timing.spec.ts` i on jest wpięty w CI.

## 6. Bramki dołożone razem z narzędziem

| bramka                                                                          | co pilnuje                                                                                                                                       |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/lib/ci/__tests__/bootAbReport.test.ts` (24 przypadki)                      | warstwa interpretacji: pasma szumu, `null` → liczba jako „pojawiło się", brak dzielenia przez zero, unikalność etykiet, parsowanie wyjścia sondy |
| `src/lib/ci/__tests__/playwrightConfigParity.test.ts` (+7 przypadków, 13 razem) | rozdział trzech konfiguracji Playwrighta: własny katalog pomiaru, różne porty, `reuseExistingServer: false`, `retries: 0`                        |

Kontrole negatywne wykonane, nie założone: przestawienie `testDir` na `./e2e`, `reuseExistingServer` na `true` i przeniesienie specu pomiarowego do `e2e/` zapalają **dokładnie po jednym** przypadku każde; po przywróceniu 13 zielonych.

Dwie pomyłki w moim własnym kodzie, które te bramki złapały i które zostawiam zapisane, bo obie są pouczające:

1. `METRICS` miało **dwa wiersze o identycznej etykiecie** `"    plików"`. Wyszukiwanie wiersza po etykiecie brało pierwsze trafienie, więc jeden przypadek testowy mierzył licznik statyczny, choć nazywał dynamiczny - i przechodził z niewłaściwego powodu. Naprawione w etykietach, nie w teście, bo czytelnik raportu miał ten sam problem.
2. Asercja „konfiguracja pomiaru nie czyta `e2e`" sprawdzała brak napisu w źródle i padła słusznie: ten napis stoi w **komentarzu** tego samego pliku, który wyjaśnia pozostałe konfiguracje. Asercja o kodzie nie może patrzeć na prozę - jest teraz zakotwiczona na deklaracji właściwości.

## 7. Recenzja: cztery znaleziska, wszystkie prawdziwe

Codex zgłosił do tego narzędzia cztery znaleziska (PR #315, commit `8ec61fb`). **Wszystkie cztery okazały się prawdziwe i wszystkie były moje.** Naprawione w `fc583f9`. Zapisuję je tutaj, a nie tylko w wątkach recenzji, bo dwa z nich zmieniają to, jak należy czytać tabelę z sekcji 2.

### 7.1. Orkiestrator przyjmował próbkę z padniętego przebiegu (P1)

`probe()` brał z `run()` tylko `stdout`, odrzucając `ok`. Sonda wypisuje próbkę `console.log`-iem **przed** swoją asercją integralności („dokument SSR nie jest pusty"), więc padnięta asercja dawała kod niezerowy, ale komplet JSON-a zostawał na wyjściu - orkiestrator go parsował, przyjmował i kończył zerem. **Unieważniało to jedyną asercję integralności, jaką ten pomiar ma.**

Naprawa: `if (!ok) return null`. Kolejności w sondzie świadomie nie odwracam - próbka z padniętego przebiegu jest materiałem diagnostycznym i ma zostać wypisana; odpowiedzialność za jej odrzucenie należy do orkiestratora.

### 7.2. Nierówne okienka obserwacji (P1) - i eksperyment, który rozstrzygnął jego wagę

Sonda czekała `gotowość + 1500 ms`. Gotowość jest po obu stronach skrajnie różna (baza nie stawia flagi wcale, więc wyczerpywała 30 s; `ecff3f2` stawia ją po ~0,5 s), a metryki zasobów są **kumulatywne w czasie** - porównywały się więc okienka ~31,5 s wobec ~2 s.

Zamiast przyjąć wagę tego defektu na słowo, zmierzyłem ją. Jedno wczytanie artefaktu `ecff3f2`, dwie próbki na tej samej stronie:

| metryka    | t=2 s           | t=31,5 s        | dryf |
| ---------- | --------------- | --------------- | ---- |
| JS razem   | 2 591,6 KB      | 2 591,6 KB      | 0    |
| plików JS  | 71              | 71              | 0    |
| dynamiczne | 625,4 KB / 59   | 625,4 KB / 59   | 0    |
| statyczne  | 1 966,2 KB / 12 | 1 966,2 KB / 12 | 0    |
| CSS        | 557,3 KB        | 557,3 KB        | 0    |
| tekst      | 2 622 zn.       | 2 622 zn.       | 0    |

**Defekt metody realny, wpływ na liczby zerowy** - oba zdania są prawdziwe naraz. Dlatego pierwszej tabeli nie unieważniłem, a kod naprawiłem: narzędzie pomiarowe nie może opierać poprawności na tym, że „na trasie, którą sprawdziłem, akurat nic się nie doładowuje". Na trasie z leniwymi widżetami, odpytywaniem albo importem wyzwalanym widocznością dryf byłby realny i **cichy**.

Naprawa: `OBSERVATION_WINDOW_MS` = 3 000, identyczne po obu stronach; gotowość mierzy nieblokujący rejestrator, więc nie przesuwa momentu próbkowania; budżet 30 s na flagę zostaje, ale jest dociągany **po** próbkowaniu.

### 7.3. „Treść tekstowa w SSR" mierzona po hydratacji (P2) - to znalezisko podważało mój własny wniosek

Metryka pochodziła z `document.body.innerText`, czyli ze stanu DOM-u po hydratacji i po całym okienku obserwacji, a nazywała się treścią SSR. **Tej właśnie liczby użyłem w sekcji 4**, żeby postawić tezę „bez danych obie wersje renderują tę samą statyczną powłokę" - argumentowałem więc o zawartości pierwszego dokumentu na podstawie pomiaru zrobionego po wykonaniu całego bundla. Zła nazwa metryki weszła do mojego wniosku; to gorsze niż sam defekt kodu.

Naprawa liczy tekst z surowego HTML-a odpowiedzi nawigacyjnej: `DOMParser` (nie wykonuje skryptów - gwarancja specyfikacji), usunięcie `script`/`style`/`template`/`noscript`, `textContent` (dokument z `DOMParser` nie ma layoutu, więc `innerText` nie miałby czego czytać), normalizacja białych znaków (bez niej liczba mierzyłaby w większości wcięcia formatowania).

**Skutek liczbowy: 2 622 → 2 298 znaków, po obu stronach identycznie.** Wniosek się nie zmienił, ale teraz stoi na pomiarze tego, o czym mówi. Przy okazji bajty dokumentu też biorę z odpowiedzi nawigacyjnej, a nie z drugiego żądania - stąd `76 485 B` → `76 860 B` na bazie.

### 7.4. Status odpowiedzi nieweryfikowany (P2)

`page.goto()` rozwiązuje się dla 4xx i 5xx. To trafia w sedno zastosowania narzędzia: najbardziej typowa pomyłka to nie literówka w trasie, lecz **trasa dodana mierzoną zmianą, która na rewizji bazowej nie istnieje**. Sonda zmierzyłaby tam stronę 404, a próg 1 000 bajtów by ją przepuścił, bo aplikacja renderuje dla 404 pełną powłokę. Efektem byłoby wiarygodnie wyglądające porównanie **dwóch różnych stron**.

Naprawa: twardy błąd na `status >= 400`, z komunikatem mówiącym o rewizjach, nie o samym statusie.

## 8. Skutek uboczny naprawy `if:`: trzy bramki, których CI nie raportowało

Nie jest to część tego narzędzia, ale wyszło przy tym samym PR i dotyczy wiarygodności całego CI, więc zapisuję.

Naprawa warunków `if:` w jobie `verify` (weszła do maina razem z PR #314) sprawiła, że wykonują się wszystkie 39 kroków, zero SKIPPED. Pierwszy skutek: **`Typecheck` i `Lint` pobiegły w CI tej gałęzi pierwszy raz w historii** - oba zielone. Drugi: trzy kroki, które stały za czerwonym krokiem 10, zaczęły raportować i **są czerwone**.

Sprawdziłem, czy to regresja, uruchamiając te same bramki na worktree z `1d5d0ed`. Nie jest - a porównanie **nazw** padających testów (nie liczników) dało wniosek mocniejszy: to nie trzy nowe problemy, a **te same dwie blokady w trzech dodatkowych miejscach**:

| blokada                                                     | wywraca                                                    |
| ----------------------------------------------------------- | ---------------------------------------------------------- |
| snapshot autoryzacji nieaktualny wobec migracji (932 → 934) | `check:authz-snapshot` **oraz** `check:permissions-parity` |
| bliźniacze migracje / rejestr `KNOWN_CONTENT_TWINS`         | `check:sql-migration-replay` **oraz** `check:i18n-parity`  |

Promień rażenia obu blokad jest zatem **dwukrotny** wobec tego, co było wiadome - właśnie dlatego, że dodatkowe bramki były skipowane. Odblokowanie każdej gasi po dwie bramki, nie po jednej.

Obie mają lekarstwo, które istnieje, i obie **należą do człowieka**: regeneracja snapshotu autoryzacji to zmiana w zacommitowanym artefakcie bezpieczeństwa, a wpisy `KNOWN_CONTENT_TWINS` wymagają dowodu, że oba pliki każdej pary są w `schema_migrations` - faktu z wdrożenia, nie z repozytorium.
