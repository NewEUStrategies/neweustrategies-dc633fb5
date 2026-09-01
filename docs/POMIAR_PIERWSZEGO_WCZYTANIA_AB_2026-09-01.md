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

| metryka                        | BAZA `1d5d0ed`   | PO `ecff3f2` | różnica          | werdykt          |
| ------------------------------ | ---------------- | ------------ | ---------------- | ---------------- |
| TTFB dokumentu                 | 5 066,4 ms       | 5 068,5 ms   | +2,1 ms (+0,04%) | szum             |
| First Contentful Paint         | 5 280 ms         | 5 300 ms     | +20 ms (+0,4%)   | szum             |
| **gotowość (`__nesAppReady`)** | **brak sygnału** | **568,4 ms** | -                | **pojawiło się** |
| dokument SSR                   | 76 485 B         | 77 414 B     | +929 B (+1,2%)   | szum             |
| treść tekstowa w SSR           | 2 622 zn.        | 2 622 zn.    | 0                | szum             |
| JS bootu RAZEM                 | 2 580,6 KB       | 2 591,6 KB   | +11,0 KB (+0,4%) | szum             |
| w tym plików                   | 70               | 71           | +1               | szum             |
| domknięcie statyczne           | 1 955,8 KB       | 1 966,2 KB   | +10,4 KB (+0,5%) | szum             |
| plików statycznych             | 12               | 12           | 0                | szum             |
| dociągnięte dynamicznie        | 624,8 KB         | 625,4 KB     | +0,6 KB (+0,1%)  | szum             |
| plików dynamicznych            | 58               | 59           | +1               | szum             |
| CSS                            | 557,3 KB         | 557,3 KB     | 0                | szum             |
| hintów `modulepreload` w DOM   | 67               | 68           | +1               | szum             |

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

Po zmianie `markAppReady()` stoi bezwarunkowo i synchronicznie (`__root.tsx:631`), a pomiar oddaje **568,4 ms**.

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

Główny zysk prefetchu SSR - treść obecna w PIERWSZYM dokumencie zamiast dociągana po hydratacji - jest tym pomiarem **niemierzalny**. Identyczna `treść tekstowa w SSR` po obu stronach (2 622 znaki) potwierdza wyłącznie, że bez danych obie wersje renderują tę samą statyczną powłokę; nie mówi nic o tym, ile treści schodzi z serwera, gdy baza odpowiada.

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
