# Wdrożenie: podział chunków bundla publicznego - 2026-08-06

**Zakres:** sygnał „Bundle publiczny" z `docs/OCENA_FUNKCJI_TABELE_2026-08-06_R2.md`
(korekta 1) - **część dotycząca PODZIAŁU CHUNKÓW i ZAMROŻENIA PROGÓW**.

**Relacja do PR #183.** Ta gałąź powstała równolegle z `claude/bundle-stripe-optimization`
i niezależnie doszła do tej samej architektury leniwej kasy. PR #183 scalił się pierwszy,
więc **cała powierzchnia Stripe przy scaleniu została wzięta z `main`** (`EmbeddedCheckoutFrame`,
`StripeEmbeddedFrame`, `atoms/CheckoutFrameSkeleton`, `checkoutIntent`, `lib/stripe.ts`
z dynamicznym `loadStripe`, bramka `check:entry-purity`, przyrząd
`report:chunk-inventory`). Wersja z maina jest w kilku miejscach lepsza od tutejszej -
ma `ErrorBoundary` z akcją ponowienia i strażnika montowania - i nie ma sensu utrzymywać
dwóch takich samych rozwiązań. Ta gałąź nie dokłada więc do tematu Stripe niczego; opisany
niżej zakres to **to, czego `main` nie ma**.

**Weryfikacja na tej sesji:** `tsc --noEmit` czysty · `vitest run src/lib/ci src/lib/authz
src/components/checkout src/components/admin/permissions` → 354 passed / 0 failed ·
pełny `vite build` zielony · `check:bundle`, `check:chunks`, `check:entry-purity`
uruchomione na finalnym artefakcie · `eslint` bez błędów na plikach tej zmiany.

---

## 0. Dwie awarie ODZIEDZICZONE z `main`, naprawione po drodze

Bez nich ta gałąź nie miała jak się zbudować ani przejść typecheckiem. Obie pochodzą ze
scalenia PR #182 i #183, obie są na `main` w tej chwili.

**1. `vite.config.ts` woła `chunkInventoryPlugin()` bez importu.** Plik
`scripts/lib/chunkInventoryPlugin.ts` istnieje i eksportuje funkcję, ale instrukcja importu
nie dojechała. Skutek: `vite build` pada na `chunkInventoryPlugin is not defined`,
a `tsc --noEmit` na TS2304. Naprawa: dodany import (jedna linia, z komentarzem skąd się
wziął brak).

**2. `src/lib/ci/authzGates.ts` ma zdublowaną funkcję `diffAuthzSnapshots`.** Scalenie
`48b1fd1` („Merge branch 'main' into claude/authz-snapshot-diagnosis-fix") wstawiło nagłówek
i pierwszy fragment STAREJ implementacji w środek NOWEJ (`collectAuthzSnapshotDrift`
z modelem wagi `authorization` / `provenance`). Efekt: `TS2323` (redeklaracja), `TS2393`
(duplikat implementacji), `TS2304` na `AuthzFieldDrift`, `formatFieldValue`, `describeFields`
oraz zmienna `drift` używana przed deklaracją. Cały plik `src/lib/ci/**` nie kompilował się,
więc razem z nim padał typecheck całego repozytorium.

Naprawa jest jednoznaczna, bo uszkodzenie było punktowe: różnica między plikiem z maina
a ostatnią spójną wersją (`28a2279`) to **dokładnie dwa hunki**, oba w środku bloku
diagnostyki i oba cofające go do implementacji sprzed tamtego commita. Reszta pliku jest
identyczna. Przywrócono więc `28a2279` w całości - to wersja, przeciw której napisane są
`src/lib/authz/__tests__/authzSnapshotParity.test.ts` (właściwa bramka CI) oraz
`scripts/generate-authz-snapshot.ts`.

Konsekwencje w plikach towarzyszących:

- `src/lib/ci/__tests__/authzGates.test.ts` - usunięty **zduplikowany** test „nazywa pole,
  które się zmieniło": to samo scalenie skopiowało go do bloku `describe`, w którym
  `built` nie jest w zasięgu (`TS2304`), a zjawisko, które sprawdzał, pokrywa już test
  „przeniesienie definicji do nowszej migracji raportuje provenance".
- Ten ostatni test przepisano na API, które faktycznie zostało w kodzie: asercja idzie
  teraz na **wagę** dryfu (`severity === "provenance"`, `hasAuthorizationDrift === false`),
  a nie na brzmienie komunikatu, i buduje próbkę z `before` zamiast z drugiego
  `deriveAuthzSnapshot` - inaczej różniłyby się też metryki skanu i test mierzyłby dwa
  zjawiska naraz.
- `src/lib/authz/authzSnapshot.generated.ts` - **zregenerowany**. Snapshot był starszy niż
  migracja `20260806150000_profile_verification_authority.sql`, dodana w tym samym PR #182.
  Regeneracja daje dokładnie to, co raportowała bramka, i nic ponadto:
  `profiles_guard_privileged_columns` i `profiles_guard_verification` przechodzą na
  `tenantRef: none -> caller` (ZAWĘŻENIE - guard zostaje związany z tenantem wywołującego),
  zbiory ról BEZ ZMIAN, `stats` 625→626 migracji / 554→555 funkcji.

**3. `src/__tests__/profilesVerificationGuard.invariant.test.ts` - dwa fałszywe alarmy.**
Bramka sprawdzała regexem, czy w CIELE `profiles_guard_verification` stoi
`has_role(..., 'admin')` i `has_role(..., 'super_admin')`. Migracja
`20260806150000_profile_verification_authority.sql` (ten sam PR #182) celowo sprowadziła
decyzję „kto może" do jednego predykatu `can_manage_profile_verification()` - literały ról
zjechały o poziom niżej i regex zaczął raportować UTRATĘ obu ról przy uprawnieniach, które
są nienaruszone.

Nie wystarczy rozluźnić asercji: ten sam regex przepuściłby też ciche ZAWĘŻENIE predykatu,
bo w guardzie nic by się wtedy nie zmieniło. Test czyta więc teraz EFEKTYWNY zbiór ról
z `deriveAuthzSnapshot` (rozwinięcie aliasów - to samo, czym liczy snapshot), wciąż
odtwarzany z MIGRACJI, więc `generate:authz-snapshot` nadal go nie ucisza - a to była
wprost deklarowana racja bytu tego pliku. Dołożona jest też druga strona inwariantu:
zbiór efektywny musi być DOKŁADNIE `["admin", "super_admin"]`, żeby rozwinięcie aliasów nie
mogło po cichu POSZERZYĆ kręgu uprawnionych (kanarkiem jest `editor` - weryfikacja steruje
odznaką, a odznaka `expert` nadaje dożywotni VIP).

## 1. Pomiar: przed i po

Ten sam host, ta sama wersja zależności, pełny `vite build`, bramka
`scripts/check-bundle-size.ts`. Baza = `main` po naprawach z sekcji 0 (bez nich nie ma
z czym porównywać, bo `main` się nie buduje).

| Metryka                       |    `main` |     ta gałąź |                  Delta |
| ----------------------------- | --------: | -----------: | ---------------------: |
| największy chunk (entry) gzip |  540,8 KB | **434,1 KB** | **-106,7 KB (-19,7%)** |
| public total gzip             | 1888,6 KB |    1896,1 KB |                +7,5 KB |
| overall total gzip            | 3130,6 KB |    3142,7 KB |               +12,1 KB |

**Jak to czytać.** Chunk wejściowy pobiera i parsuje KAŻDE pierwsze wejście na dowolny
publiczny URL, zanim cokolwiek się zhydratuje - to jedyna z tych liczb, którą płaci realny
czytelnik. `public total` sumuje WSZYSTKIE chunki osiągalne z publicznych tras, więc
drobniejszy podział przesuwa w niej bajty między plikami zamiast je usuwać; ten sam
mechanizm opisuje akapit „DLACZEGO PUBLIC/OVERALL NIE MOGŁY SPAŚĆ" w nagłówku bramki,
dopisany przez PR #183.

## 2. `vendor-tanstack` wreszcie POWSTAJE

Reguła `manualChunks` dla `/node_modules/@tanstack/` była w konfiguracji od tygodni
i **nigdy nie zadziałała** - chunk nie powstawał, a ~330 KB (surowo) routera i react-query
jechało w `index-*.js`. Bez ostrzeżenia: Rollup nie zgłasza tego w żaden sposób.

Przyczyna: wejściem klienta TanStack Start jest
`node_modules/@tanstack/react-start/dist/plugin/default-entry/client.tsx`, czyli plik POD
tą samą ścieżką. Reguła przypisywała więc **moduł wejściowy** do nazwanego chunku,
a Rollup odpowiada na to zapadnięciem CAŁEGO chunku z powrotem w entry.

Naprawa jest trzyczęściowa i każda część wynika z pomiaru, nie z teorii:

1. `manualChunks` pomija moduły wejściowe (`meta.getModuleInfo(id)?.isEntry`).
2. Wydzielamy wyłącznie biblioteki **liściowe** (`react-router`, `router-core`, `history`,
   `store`, `react-store`, `query-core`, `react-query`, `*-ssr-query-core`). Rodzina
   `@tanstack/*start*` zostaje w entry: pierwsza próba z całą rodziną w chunku dała entry
   **0,2 KB** i vendor-tanstack **1,59 MB** - Rollup barwi nazwanym chunkiem cały graf
   osiągalny z jego modułów, a przez runtime bootstrapu biegnie droga do `src/router.tsx`.
3. Dokładamy domknięcie spoza `vendor-react`: `seroval`, `seroval-plugins`, `cookie-es`,
   `isbot`. Bez nich `vendor-tanstack` importowałby je z chunku wejściowego, a entry
   importuje `vendor-tanstack` - czyli CYKL, ta sama klasa awarii co incydent 2026-07-20.
   `check:chunks` potwierdza acykliczność wynikowego grafu.

## 3. `vendor-lucide`

Po (2) Rollup rozsypał ikony na 45 osobnych plików po 300-400 B - każda ikona współdzielona
przez ≥2 leniwe chunki dostawała własny. To ~22 KB gzip samego narzutu nagłówków, bo pliki
tej wielkości praktycznie się nie kompresują. Jedna reguła (`lucide-react` →
`vendor-lucide`) scala je w jeden, trwale cache'owalny chunk i przy okazji zabiera ~95 KB
surowo z entry. Domknięcie trywialne: `lucide-react` importuje wyłącznie React.

## 4. Słownik buildera poza chunkiem wejściowym

`Editable.tsx` rejestrowała `@/lib/i18n-builder` side-effectowym importem. Moduł leży
w EAGER-owej ścieżce publicznego chrome (`Header/Footer → BuilderRenderer → WidgetView →
Editable`), więc ~101 KB źródła ciągów edytora jechało do każdego anonimowego czytelnika -
pierwsza pozycja „zmierzonego backlogu redukcji", który PR #183 zapisał w nagłówku bramki.

**To NIE jest powtórka nieudanego eksperymentu opisanego tamże.** Tamten WYMUSZAŁ
`manualChunks` po ścieżkach plików i wciągnął do nazwanego chunku `src/lib/i18n.ts`
(bootstrap potrzebny na każdej stronie), przez co liczba spadła bez pokrycia w bajtach.
Ta zmiana nie wymusza niczego - **usuwa krawędź w grafie** i pozostawia decyzję Rollupowi.
`Editable` renderuje się wyłącznie przy `canEdit = editable && onContentChange`
(`WidgetView.tsx`), czyli w kanwie buildera, a chunk kanwy (`Toolbar`, `WidgetProperties`,
`Navigator`, `WidgetLibrary`) rejestruje ten słownik przy inicjalizacji modułu. Ta sama
zasada jest już udokumentowana i stosowana w `widget-view/resizeWrappers.tsx`.

Słownik jest teraz osobnym chunkiem. **Nie** przeniesiono go do `ADMIN_ONLY`: analiza grafu
chunków pokazuje, że dwa jego importery (`StructurePicker`, `EmptyContainerPickerBox`) są
osiągalne ścieżką niewiodącą przez chunk adminowy, więc rozliczanie go w PUBLIC jest
poprawne. Liczba w bramce ma pokrycie w bajtach - inaczej niż w wycofanym eksperymencie.

## 5. Progi ZAMROŻONE (bez env w CI)

`MAX_CHUNK_KB` / `MAX_PUBLIC_KB` / `MAX_TOTAL_KB` są w CI **ignorowane** - skrypt mówi to
głośno na stderr, a obowiązują stałe z `scripts/check-bundle-size.ts`. Bramka, którą wolno
rozluźnić jedną zmienną w workflow, jest sugestią, nie bramką; teraz każda zmiana progu
przechodzi przez review razem z przyczyną wzrostu i wpisem do kroniki. Poza CI nadpisanie
nadal działa - do lokalnego eksperymentu „ile zejdzie, jeśli...".

Kronika floorów z maina zostaje w całości (razem z uczciwym bilansem PR #183 i opisem
wycofanego eksperymentu); ta zmiana dopisuje własny wpis.

## 6. `check:chunk-parity` - nowa bramka, blokująca, bez builda

`vite.smoke.config.ts` istnieje po to, żeby zbudować artefakt PRODUKCYJNY na preset
node-server i sprawdzić BOOT KLIENTA prawdziwą przeglądarką - incydent 2026-07-20 był
niewidoczny w dev (brak chunków) i w testach jednostkowych. Ta weryfikacja jest warta tyle,
ile **zgodność podziału chunków z produkcją**, a dotąd pilnował jej wyłącznie komentarz
„UWAGA: trzymać w synchronizacji". `src/lib/ci/__tests__/viteChunkParity.test.ts` zamienia
prośbę w inwariant: bloki `manualChunks` obu konfiguracji muszą być identyczne, obie muszą
mieć `hoistTransitiveImports: false`, a reguła vendorowa musi pomijać moduł wejściowy.

Ostatni punkt nie jest ozdobnikiem - to zakodowana pamięć o pułapce z sekcji 2, przez którą
martwa reguła przeżyła tygodnie.

Bramka nie potrzebuje builda (czyta dwa pliki konfiguracji), więc stoi w CI PRZED krokiem
`Build`.

## 7. Świadomie NIE w tej zmianie

Pozostałe pozycje „zmierzonego backlogu redukcji" z nagłówka bramki - w szczególności
`node-html-parser` (202 kB surowo w entry, przez `lib/builder/normalizeRichHtml`
i `RichHtmlView`). Usunięcie wymaga przepisania normalizacji list na natywny `DOMParser`
po stronie klienta, czyli dotyka renderowania OPUBLIKOWANEJ treści. Należy mu się własny PR
z testami parytetu wyjścia, a nie doklejenie do zmiany bundlowej.
