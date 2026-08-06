# Wdrożenie: bundle publiczny - 2026-08-06

**Zakres:** sygnał „Bundle publiczny" z `docs/OCENA_FUNKCJI_TABELE_2026-08-06_R2.md`
(korekta 1) - bramka `check:bundle` czerwona na wszystkich trzech budżetach, SDK operatora
płatności w chunku wejściowym każdej publicznej strony, progi nadpisywalne z env.

**Weryfikacja na tej sesji:** `tsc --noEmit` czysty · `vitest run src/lib/ci src/lib/access
src/lib/builder src/components/checkout src/lib/sanitize.test.ts` → **714 passed / 0 failed** ·
pełny `vite build` zielony · `check:bundle` i `check:chunks` uruchomione na finalnym
artefakcie · `eslint` bez błędów na plikach tej zmiany (repo ma osobny, wcześniejszy dług
formatowania w plikach nietkniętych tą zmianą).

---

## 1. Pomiar: przed i po

Ten sam host, ta sama wersja zależności (`bun install --frozen-lockfile`), pełny
`vite build`, bramka `scripts/check-bundle-size.ts`.

| Metryka                       |    Przed |     Po |     Delta | Poprzedni budżet |
| ----------------------------- | -------: | -----: | --------: | ---------------: |
| największy chunk (entry) gzip |  541,6KB | 433,5KB | **-108,1KB (-20,0%)** | ≤511 (był czerwony) |
| public total gzip             | 1886,9KB | 1891,2KB |   +4,3KB | ≤1799 (był czerwony) |
| overall total gzip            | 3129,0KB | 3135,9KB |   +6,9KB | ≤3005 (był czerwony) |
| plików JS                     |      551 |    556 |        +5 |                  - |
| graf chunków                  | 550 / 2125 krawędzi, acykliczny | 555 / 2584, acykliczny | - | - |

**Jak to czytać.** Redukcja siedzi tam, gdzie płaci ją realny czytelnik: chunk wejściowy
pobiera i parsuje KAŻDE pierwsze wejście na dowolny publiczny URL, zanim cokolwiek się
zhydratuje. `public total` to natomiast suma WSZYSTKICH chunków, jakie da się kiedykolwiek
pobrać przechodząc po publicznych trasach - drobniejszy podział przesuwa bajty między
plikami i podnosi tę sumę o ułamek procenta (nagłówki gzip osobnych plików), nie zwiększając
kosztu żadnej pojedynczej wizyty. +4,3 KB rozproszone po chunkach ładowanych na żądanie za
-108,1 KB z pierwszego ładowania to wymiana korzystna dla użytkownika i taka jest intencja
tej zmiany.

Progi zostały ustawione **po** pomiarze, z ~1% zapasu: **438 / 1910 / 3168 KB**.

## 2. Kasa poza chunk wejściowy (przyczyna z audytu, doprowadzona do końca)

Łańcuch z audytu: `routes/$.tsx` → `Paywall` → `EmbeddedCheckoutDialog` →
`@stripe/react-stripe-js`, a osobno `Paywall` → `lib/stripe` → `loadStripe`. W artefakcie
siedziały w entry i nazwa `EmbeddedCheckout`, i adres `js.stripe.com`.

Naprawa to nie samo `lazy()` - `lazy()` na całym modalu dałoby sekundę pustki po kliknięciu
„Kup". Granica biegnie **wewnątrz** modala:

| Moduł                                        | Kiedy się ładuje | Co zawiera                                        |
| -------------------------------------------- | ---------------- | ------------------------------------------------- |
| `checkout/EmbeddedCheckoutDialog.tsx`         | eager (lekki)    | ramka Radixa, nagłówek, baner trybu testowego      |
| `checkout/EmbeddedCheckoutFrame.tsx`          | eager (lekki)    | granica `Suspense` + szkielet w kształcie formularza |
| `checkout/stripeFrameChunk.ts`                | eager (~0)       | jedyny `import()` chunku kasy + `prefetchEmbeddedCheckout()` |
| `checkout/StripeEmbeddedFrame.tsx`            | **leniwie**      | `@stripe/react-stripe-js`, provider, `<EmbeddedCheckout/>` |
| `lib/stripe/sdk.ts`                           | **leniwie**      | `loadStripe` (`js.stripe.com`)                      |

`lib/stripe.ts` rozjechał się na `lib/stripe/index.ts` (samo ŚRODOWISKO - 17 importerów,
zero SDK) i `lib/stripe/sdk.ts` (loader). To była druga połowa problemu: import jest
krawędzią grafu, nie wywołaniem, więc `getStripeEnvironment()` w `Paywall` wciągał
`loadStripe` niezależnie od tego, czy ktokolwiek go wywoła.

**Płynność bez spekulacji.** `prefetchEmbeddedCheckout()` startuje pobieranie chunku na
POCZĄTKU każdej z pięciu procedur zakupu (paywall, darowizna, bilet, test w panelu admina,
trasa `/checkout/$planId`) - równolegle z żądaniem tworzącym sesję. Round-trip serwera
pokrywa pobranie chunku, więc szkielet w praktyce nie mruga, a ruch, który nie kończy się
zakupem, nie pobiera ani bajta SDK. Świadomie NIE prefetchujemy na hover.

Trasa `/checkout/$planId` (piąte miejsce montowania, poza czterema z audytu) importowała
SDK bezpośrednio - teraz używa tej samej granicy, więc chunk kasy jest jeden, współdzielony.

**Weryfikacja w artefakcie:** `grep -c "js.stripe.com" .output/public/assets/index-*.js` → 0.

## 3. `vendor-tanstack` wreszcie POWSTAJE

Reguła `manualChunks` dla `@tanstack` istniała w konfiguracji od tygodni i **nigdy nie
zadziałała** - chunk nie powstawał, a ~330 KB (surowo) routera i react-query jechało w
`index-*.js`. Bez żadnego ostrzeżenia.

Przyczyna: wejściem klienta TanStack Start jest
`node_modules/@tanstack/react-start/dist/plugin/default-entry/client.tsx`, czyli plik POD
`/node_modules/@tanstack/`. Reguła przypisywała więc **moduł wejściowy** do
`"vendor-tanstack"`, a Rollup nie potrafi przenieść entry do nazwanego chunku - zamiast tego
zapada cały ten chunk z powrotem w entry.

Naprawa jest dwuczęściowa, bo pierwsza próba (`isEntry → undefined`, cała rodzina
`@tanstack` w chunku) dała wynik odwrotny do zamierzonego: entry spadło do 0,2 KB,
a `vendor-tanstack` spuchł do 1,59 MB, wciągając CAŁY kod aplikacji. Rollup barwi bowiem
nazwanym chunkiem graf osiągalny z jego modułów, a przez rodzinę `*start*` biegnie droga do
`src/router.tsx`. Ostateczna reguła:

- pomija moduł wejściowy (`meta.getModuleInfo(id)?.isEntry`) - udokumentowana pułapka,
- wydziela wyłącznie biblioteki **liściowe**: `react-router`, `router-core`, `history`,
  `store`, `react-store`, `query-core`, `react-query`, `*-ssr-query-core`,
- dokłada ich domknięcie spoza `vendor-react`: `seroval`, `seroval-plugins`, `cookie-es`,
  `isbot` (bez tego `vendor-tanstack` importowałby je z entry, a entry importuje
  `vendor-tanstack` → CYKL, ta sama klasa awarii co incydent 2026-07-20),
- zostawia w entry runtime bootstrapu (`@tanstack/*start*`, 26,3 KB).

Efekt: `vendor-tanstack` = 159,4 KB surowo, trwale cache'owalny; `check:chunks` potwierdza
acykliczność.

## 4. `vendor-lucide`

Po wydzieleniu `vendor-tanstack` Rollup rozsypał ikony na 45 osobnych plików po 300-400 B
(każda ikona współdzielona przez ≥2 leniwe chunki dostawała własny) - ~22 KB gzip samego
narzutu, bo pliki tej wielkości praktycznie się nie kompresują. Jedna reguła
(`lucide-react` → `vendor-lucide`) scala je w jeden chunk: 613 → 556 plików,
overall 3152,2 → 3135,9 KB, a dodatkowo 94,8 KB surowo wychodzi z entry.

## 5. Słownik buildera poza chunkiem wejściowym

`Editable.tsx` (molekuła click-to-edit) rejestrowała `@/lib/i18n-builder` side-effectowym
importem. Moduł leży w EAGER-owej ścieżce publicznego chrome
(`Header/Footer → BuilderRenderer → WidgetView → Editable`), więc ~101 KB źródła ciągów
edytora jechało do każdego anonimowego czytelnika. `Editable` renderuje się wyłącznie przy
`canEdit = editable && onContentChange`, czyli w kanwie buildera - a chunk kanwy
(`Toolbar`, `WidgetProperties`, `Navigator`, `WidgetLibrary`) rejestruje ten słownik przy
inicjalizacji modułu. Usunięcie side-effectu powtarza więc regułę już udokumentowaną
i stosowaną w `widget-view/resizeWrappers.tsx`.

Słownik jest teraz osobnym chunkiem (79,6 KB surowo). **Nie** przenieśliśmy go do
`ADMIN_ONLY` w bramce: analiza grafu chunków pokazuje, że dwa jego importery
(`StructurePicker`, `EmptyContainerPickerBox`) są osiągalne ścieżką niewiodącą przez chunk
adminowy, więc rozliczenie w budżecie PUBLIC jest poprawne.

## 6. Progi zamrożone (bez env w CI)

`MAX_CHUNK_KB` / `MAX_PUBLIC_KB` / `MAX_TOTAL_KB` są w CI **ignorowane** (skrypt mówi to
głośno na stderr) - obowiązują stałe z `scripts/check-bundle-size.ts`, więc każda zmiana
progu przechodzi przez review razem z przyczyną wzrostu. Poza CI nadpisanie nadal działa,
do lokalnego eksperymentu.

Kronika re-floorów w nagłówku pliku została skondensowana do zwartego zapisu (daty, liczby,
przyczyny) - dotąd rosła o akapit na każdy re-floor i przestała być czytelna dokładnie
wtedy, gdy zaczęła być potrzebna.

## 7. Nowe narzędzia i bramki

### `check:bundle-islands` - inwariant „wysp leniwych chunków" (bez builda)

`src/lib/ci/bundleIslands.ts` + testy. Analiza statyczna grafu importów `src/`, dwie połowy
inwariantu:

1. pakiet strzeżony (`@stripe/stripe-js`, `@stripe/react-stripe-js`) wolno importować
   statycznie WYŁĄCZNIE modułowi wyspy,
2. moduł wyspy wolno importować statycznie WYŁĄCZNIE innemu modułowi tej samej wyspy -
   z zewnątrz tylko przez `import()`.

Bez (2) sam podział plików nic nie gwarantuje. Analiza jest zachowawcza (importy typów
pomijane, reszta liczy się jako krawędź), więc gate może co najwyżej zgłosić krawędź, którą
tree-shaking i tak by usunął - nigdy nie przepuści prawdziwej. Bramka wskazuje plik, linię
i łańcuch; `check:bundle` mówił tylko „public urósł o X KB". Krok w CI stoi PRZED buildem,
bo builda nie potrzebuje.

Sprawdzone, że bramka **nie jest pusta**: uruchomiona na treści plików sprzed tej zmiany
(`git show HEAD:...`) zwraca naruszenia.

### `check:bundle-islands` - parytet konfiguracji

`vite.smoke.config.ts` buduje artefakt produkcyjny na preset node-server, żeby dało się
sprawdzić BOOT KLIENTA prawdziwą przeglądarką (incydent 2026-07-20). Ta weryfikacja jest
warta tyle, ile zgodność obu konfiguracji - dotąd pilnował jej wyłącznie komentarz „UWAGA:
trzymać w synchronizacji". `viteChunkParity.test.ts` zamienia prośbę w inwariant: bloki
`manualChunks` muszą być identyczne.

### `analyze:bundle` - odpowiedź na pytanie „PRZEZ CO"

```bash
BUNDLE_STATS=1 bun run build     # plugin zrzuca reports/bundle-modules.json
bun run analyze:bundle           # 20 najcięższych chunków + skład entry
bun run analyze:bundle vendor-radix
bun run analyze:bundle --package echarts
```

Plugin (`scripts/lib/bundleStatsPlugin.ts`) bez zmiennej środowiskowej **nie ma żadnego
hooka** - artefakt produkcyjny jest bit-w-bit identyczny. Cała diagnostyka w tym dokumencie
(w tym ustalenie, że `vendor-tanstack` nigdy nie powstawał) pochodzi z tego narzędzia.

## 8. Świadomie NIE w tej zmianie

**`node-html-parser`: 201,7 KB surowo w chunku wejściowym.** Największa pozostała pozycja.
Ciągną go dwa importy:

- `lib/sanitize.ts` - gałąź `import.meta.env.SSR` jest w kliencie MARTWA, ale pakiet nie
  deklaruje `sideEffects:false`, więc Rollup jej nie wytrząsa;
- `lib/builder/normalizeRichHtml.ts` - realnie używany w przeglądarce przez `RichHtmlView`
  (normalizacja list z importów WordPress/Elementor).

Usunięcie wymaga przepisania normalizacji na natywny `DOMParser` po stronie klienta. To
zmiana dotykająca renderowania OPUBLIKOWANEJ treści (markup list), więc należy jej się
własny PR z testami parytetu wyjścia, a nie doklejenie do zmiany bundlowej.

**Klasyfikacja `ADMIN_ONLY` w bramce** pozostaje ręczną listą wzorców nazw chunków.
Poprawniejsza byłaby klasyfikacja z grafu chunków („chunk jest adminowy, gdy każda ścieżka
od entry prowadzi przez chunk adminowy"), ale przeklasyfikowałaby też pozycje istniejące
(m.in. `EChartClient`) i zmieniłaby znaczenie obu sum - to osobna decyzja produktowa
o tym, co uznajemy za koszt czytelnika.
