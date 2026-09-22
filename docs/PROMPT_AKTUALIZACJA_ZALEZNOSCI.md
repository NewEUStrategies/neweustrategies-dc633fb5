# ZLECENIE: PRZEKROJOWE - standaryzacja i podniesienie zależności (`package.json`, `bun.lock`)

> **HEAD pomiaru: `119c03b`.** Każda liczba w tym dokumencie została zmierzona na tym commicie,
> na drzewie zgodnym z `bun.lock` (nie z npm), bun 1.2.23, rejestr `registry.npmjs.org`.
>
> **ERRATA WŁASNA (2026-09-22).** W trakcie pisania tego zlecenia scalono PR #385, a `main`
> przeszedł z `119c03b` na `a80dc767e`. Test aktualności uruchomiony na nowym `main` wskazał
> **jeden** plik: `scripts/check-bundle-size.ts`. Skutek jest konkretny i unieważnia jedno
> z moich własnych sprostowań - szczegóły w rozdz. 4.3.1. **`package.json` i `bun.lock` NIE
> ZMIENIŁY SIĘ**, więc cały inwentarz zależności, wszystkie peery i wszystkie cztery testy
> akceptacyjne z rozdz. 0 zachowują ważność.
>
> **Sprawdzisz aktualność tego zlecenia jednym poleceniem:**
>
> ```
> git diff --name-only 119c03b..HEAD -- package.json bun.lock bunfig.toml eslint.config.js \
>   vite.config.ts vitest.config.ts vitest.shard.config.ts scripts/check-bundle-size.ts \
>   src/lib/icons/curatedIconNames.ts scripts/vitest/testAccountingReporter.ts
> ```
>
> ma nie wypisać nic.

---

## ZAKRES DOWODU - co zmierzone, czego nie

Sesja, w której powstało to zlecenie, **zainstalowała zależności zgodnie z `bun.lock`** i wykonała
na tym drzewie pomiary. To nie jest zlecenie pisane na ślepo. Ograniczenie jest jedno i wąskie:

**`cdn.sheetjs.com` jest odrzucany przez politykę egresu tej sesji (403 na CONNECT).** `xlsx`
jest jedyną paczką pobieraną spoza npm, więc jako jedyna się nie zainstalowała. Wszystkie
pozostałe 1 268 paczek z `bun.lock` zainstalowały się poprawnie.

| Co                                 | Stan                                |
| ---------------------------------- | ----------------------------------- |
| `bun outdated`, pełna tabela       | **zmierzone**                       |
| `tsc --noEmit`                     | **zmierzone**                       |
| `eslint .`                         | **zmierzone**                       |
| Cztery testy akceptacyjne z briefu | **zmierzone, wszystkie przeszły**   |
| `bun run build`, `check:bundle`    | **NIE zmierzone** - wymagają `xlsx` |
| Pokrycie (`--coverage`)            | **NIE zmierzone**                   |

Osiem plików importuje `xlsx` (m.in. `src/lib/files/spreadsheetCore.ts`,
`src/lib/billing/audit.server.ts`, `src/lib/events/leadExport.ts`,
`src/lib/charts/importTable.ts`), więc bez tej paczki build nie przejdzie. To jedyny powód,
dla którego dwie bramki zostały niezmierzone.

---

## 0. WYNIK: standaryzacja toolchainu DZIAŁA - cztery testy akceptacyjne

Brief postawił cztery testy akceptacyjne na to, czy wyrównanie drzewa do `bun.lock` usuwa
„zastane czerwienie". **Wszystkie cztery przeszły.** To jest najważniejszy wynik tego zlecenia,
bo unieważnia kilka rzekomych defektów.

### Test 1 - `sliderVariantCatalogs.test.tsx` - PRZESZEDŁ

```
✓ src/lib/builder/__tests__/sliderVariantCatalogs.test.tsx (113 tests) 723ms
  Tests  111 passed | 2 expected fail (113)
```

`happy-dom` z locka to **20.9.0**. npm podciągał 20.14.5, w której
`HTMLImageElement.complete` startuje z `true` zamiast `false`. Test był czerwony **z powodu
wersji, nie z powodu kodu**.

### Test 2 - `tsc --noEmit` - ZERO REALNYCH BŁĘDÓW

To jest najmocniejsze ustalenie całego zlecenia.

```
10 błędów, WSZYSTKIE pochodne brakującego modułu 'xlsx':
  8 × TS2307 Cannot find module 'xlsx'
  1 × TS2347 (pochodna braku typów xlsx)
  1 × TS7006 (pochodna braku typów xlsx)
```

**Zapowiadanych „17-21 błędów, typy TanStack Routera schodzące do `never`" NIE MA.** Nie istnieją.
Były artefaktem drzewa npm-owego. Na drzewie zgodnym z lockiem `tsc` jest czysty, pomijając
`xlsx`, którego ta sesja nie mogła pobrać. **Nie szukaj tych błędów i nie „naprawiaj" ich** -
naprawa czegoś, czego nie ma, to najdroższy możliwy sposób zepsucia typów.

### Test 3 - `platformBuildGuards.test.ts` - PRZESZEDŁ 7/7

```
✓ src/lib/ci/__tests__/platformBuildGuards.test.ts (7 tests) 403ms
```

Wcześniej 6 z 7 padało wyłącznie z braku binarki `bun` na `PATH`.

### Test 4 - pliki `@vitest-environment jsdom` - PRZESZŁY

`jsdom@29.1.1` **jest** w `bun.lock` i instaluje się poprawnie. Plików jest **pięć**, nie trzy
jak twierdził brief:

```
✓ src/lib/wp-import/__tests__/wxr.test.ts (30)
✓ src/components/builder/organisms/widget-view/__tests__/CircularCarouselView.test.tsx (7)
✓ src/components/admin/__tests__/wxrUploadPanel.test.tsx (41)
✓ src/components/builder/organisms/widget-view/__tests__/ProgressCarouselView.test.tsx (4)
✓ src/components/admin/__tests__/wordPressImportDialog.test.tsx (36)
  Tests  116 passed | 2 expected fail (118)
```

### Test 5 (dodatkowy) - `eslint .` - ZIELONY

```
✖ 241 problems (0 errors, 241 warnings)
```

241 ostrzeżeń, wszystkie `react-refresh/only-export-components`. **Zero błędów.** To jest
punkt odniesienia: po każdym etapie liczba **błędów** ma zostać na zerze.

---

## 1. Stan wyjściowy - zmierzony

### 1.1. Inwentarz

| Metryka                                           | Wartość                                                    |
| ------------------------------------------------- | ---------------------------------------------------------- |
| Zależności bezpośrednie                           | **113** (82 `dependencies` + 31 `devDependencies`)         |
| Paczek w `bun.lock`                               | **1 269**                                                  |
| Skryptów w `package.json`                         | **86**, w tym **49** `check:*`                             |
| **Przeterminowanych (zmierzone `bun outdated`)**  | **92**                                                     |
| - do podniesienia w zakresie semver (minor/patch) | **73**                                                     |
| - poza zakresem                                   | **27**, w tym **17 prawdziwych majorów** i **10 przypięć** |
| Aktualnych                                        | **21**                                                     |

Brief mówił „76 minor/patch, 17 major". **Majorów jest dokładnie 17 - to się zgadza.**
Minor/patch jest **73**, nie 76. Nowa, nieopisana w briefie kategoria to **10 przypięć**
(rozdz. 1.3).

### 1.2. Siedemnaście majorów - zmierzone

| Paczka                      | Teraz    | Latest  | Etap                            |
| --------------------------- | -------- | ------- | ------------------------------- |
| `typescript`                | 5.9.3    | 7.0.2   | **ZABLOKOWANY** (rozdz. 3.1)    |
| `eslint`                    | 9.39.4   | 10.11.0 | B                               |
| `@eslint/js`                | 9.39.4   | 10.0.1  | B                               |
| `globals`                   | 15.15.0  | 17.12.0 | B                               |
| `eslint-plugin-react-hooks` | 5.2.0    | 7.1.1   | B                               |
| `@types/node`               | 22.19.17 | 26.6.2  | B                               |
| `@testing-library/jest-dom` | 6.9.1    | 7.0.1   | B                               |
| `zod`                       | 3.25.76  | 4.6.5   | C                               |
| `lucide-react`              | 0.577.0  | 1.47.0  | C                               |
| `react-day-picker`          | 9.14.0   | 10.0.1  | C                               |
| `entities`                  | 4.5.0    | 8.1.0   | C                               |
| `@lovable.dev/mcp-js`       | 0.20.0   | 3.0.1   | C                               |
| `vite`                      | 7.3.2    | 8.3.0   | D                               |
| `vitest`                    | 4.1.7    | 5.0.1   | D                               |
| `@vitest/coverage-istanbul` | 4.1.7    | 5.0.1   | D                               |
| `@vitest/coverage-v8`       | 4.1.7    | 5.0.1   | **D - albo USUNĄĆ, rozdz. 3.4** |
| `@vitejs/plugin-react`      | 5.2.0    | 6.1.1   | D, opcjonalny                   |

### 1.3. Dziesięć przypięć - kategoria, której brief nie zauważył

Te paczki **nie dostają poprawek, bo są przypięte co do wersji** (bez `^`) albo mają zakres
`0.x`, który nie przepuszcza kolejnego minora. To nie są majory - to jest zamrożenie.

| Paczka                        | Teraz           | Latest          | Ocena                                                                           |
| ----------------------------- | --------------- | --------------- | ------------------------------------------------------------------------------- |
| **`dompurify`**               | **3.4.7**       | **3.4.15**      | **PATRZ NIŻEJ - bezpieczeństwo**                                                |
| `stripe`                      | 22.0.2          | 22.6.2          | do odmrożenia                                                                   |
| `@stripe/stripe-js`           | 9.2.0           | 9.17.0          | do odmrożenia                                                                   |
| `@stripe/react-stripe-js`     | 6.2.0           | 6.11.0          | do odmrożenia                                                                   |
| `axe-core`                    | 4.10.2          | 4.13.0          | do odmrożenia                                                                   |
| `@lovable.dev/email-js`       | 0.1.2           | 0.3.0           | zakres `0.x`                                                                    |
| `eslint-plugin-react-refresh` | 0.4.26          | 0.5.7           | zakres `0.x`                                                                    |
| `prettier`                    | 3.9.6           | 3.9.8           | przypięcie **zamierzone** (stabilność formatu)                                  |
| `@tailwindcss/oxide`          | 4.2.4           | 4.3.3           | przypięcie **zamierzone** (binarka natywna musi pasować do `@tailwindcss/vite`) |
| `nitro`                       | 3.0.260603-beta | 3.0.260903-beta | beta, rozdz. 4.6                                                                |

**`dompurify` wymaga osobnej uwagi.** To jest sanityzator XSS tego serwisu - bramka
`check:dangerous-html` wymusza, żeby **każdy** `dangerouslySetInnerHTML` przechodził przez niego.
Przypięcie co do wersji na komponencie bezpieczeństwa oznacza, że **poprawki bezpieczeństwa nie
docierają**. Osiem wydań patch w tyle. Jeżeli przypięcie ma powód, musi być zapisany w komentarzu
obok; jeżeli nie ma - to jest defekt, nie konwencja.

**Do zrobienia:** rozstrzygnąć każde z dziesięciu przypięć: albo odmrozić na `^`, albo zostawić
**z komentarzem podającym powód**. Przypięcie bez uzasadnienia jest długiem, nie decyzją.

---

## 2. Rejestr w `bun.lock` - problem JEST JUŻ OBSŁUGIWANY, ale obejściem

To jest najważniejszy punkt „standaryzacyjny" tego zlecenia i wygląda inaczej, niż zakładał brief.

**Stan faktyczny:** `bun.lock` przypina **384 z 1 269** rozstrzygnięć do prywatnego lustra
sandboxa Lovable (`europe-west1/4-npm.pkg.dev/lovable-core-prod/sandbox-npm-cache`). Pozostałe
**884** mają pole rozstrzygnięcia puste, czyli rejestr domyślny. Lock jest więc wewnętrznie
niespójny.

**CI już to obchodzi - na każdym przebiegu.** `.github/workflows/ci.yml`, krok
„Repoint lockfile to the public npm registry" (linie 151-153), tuż przed instalacją:

```yaml
- name: Repoint lockfile to the public npm registry
  run: |
    sed -E -i 's#https://europe-west[0-9]+-npm\.pkg\.dev/lovable-core-prod/sandbox-npm-cache/#https://registry.npmjs.org/#g' bun.lock
```

z komentarzem, który stoi w pliku (linie 146-150):

> The committed bun.lock pins tarballs to the build platform's private GAR cache
> (europe-west4-npm.pkg.dev/...), which is unreachable from public CI. The path after the cache
> prefix is byte-identical to the npm registry layout, so repointing the host keeps the exact
> pinned versions + integrity while installing from the public registry.
> **This edit is CI-only (never committed).**

Z tego wynikają trzy rzeczy, wszystkie sprawdzone:

1. **Operacja jest bezpieczna i udowodniona.** Sumy `sha512` zostają nietknięte, więc integralność
   jest dalej egzekwowana. Ta sesja wykonała dokładnie ten sam krok i zainstalowała 1 268 z 1 269
   paczek - jedyny wyjątek to `xlsx`, który nie pochodzi z npm.
2. **Komplet paczek JEST na publicznym npm.** CI dowodzi tego przy każdym przebiegu.
3. **To jest obejście, nie rozwiązanie.** Repozytorium wozi lockfile, którego nie da się
   zainstalować nigdzie poza sandboxem Lovable, i łata to `sed`-em w CI. Każde inne środowisko -
   maszyna dewelopera, sesja agenta, CI innego dostawcy - dostaje 403 i musi ten `sed`
   samodzielnie odtworzyć.

**Decyzja należy do właściciela repozytorium.** Opcje:

- **A1 - utrwalić repoint w locku.** Wyzerować pole rozstrzygnięcia w tych 384 wpisach (albo
  wpisać URL npm). Krok „Repoint lockfile" **znika z CI**, lock staje się przenośny.
  **To jest rekomendacja tego zlecenia**: promuje udokumentowane, wykonywane-co-przebieg
  obejście do stanu trwałego i kasuje jeden krok CI.
- **A2 - zostawić jak jest.** Wtedy `sed` z CI trzeba **udokumentować w README** jako wymagany
  krok każdej instalacji poza platformą, bo dziś wie o nim tylko `ci.yml`.

**Czego nie robić:** nie zostawiaj stanu bez decyzji i nie zapisuj do repo locka z URL-ami
`registry.npmjs.org`, jeżeli wybrano A2 - komentarz w `ci.yml` mówi wprost „never committed".

### 2.0. DECYZJA WŁAŚCICIELA: wybrano A1

**Właściciel repozytorium wybrał A1 - utrwalenie repointu w locku** (decyzja z 2026-09-22).
Do wykonania w etapie 0, osobnym commitem, zanim ruszy cokolwiek innego:

1. Ujednolicić 384 wpisy na rejestr publiczny (najprościej: tym samym `sed`-em, który stoi
   w `ci.yml:152-153`, tylko z zapisem wyniku do repo).
2. **Usunąć krok „Repoint lockfile to the public npm registry" ze WSZYSTKICH miejsc, gdzie
   występuje.** Zmierzone: **8 wystąpień w 3 plikach workflow** (nie jedno, jak sugeruje
   czytanie samego `verify`):

   | Plik                               | Linie                    |
   | ---------------------------------- | ------------------------ |
   | `.github/workflows/ci.yml`         | 152, 850, 893, 998, 1460 |
   | `.github/workflows/e2e.yml`        | 41, 93                   |
   | `.github/workflows/lighthouse.yml` | 224                      |

   Do tego **8 wystąpień `npm_config_registry`** w tych samych plikach oraz opis kroku
   w komentarzu `ci.yml:161`. Zostawienie kroku po utrwaleniu repointu jest nieszkodliwe
   (`sed` nie znajdzie wzorca), ale zostawia w CI osiem martwych kroków udających, że problem
   istnieje.

3. Zaktualizować komentarz nad krokiem instalacji, żeby nie opisywał stanu, którego już nie ma.
4. Zweryfikować `bun install --frozen-lockfile` **bez** `npm_config_registry` - po utrwaleniu
   repointu zmienna przestaje być potrzebna.

**Zysk jest mierzalny:** lock daje się zainstalować w każdym środowisku, a nie tylko w sandboxie
platformy, i z CI znika krok wykonywany dziś pięć razy na przebieg.

### 2.1. `pnpm.overrides` jest martwą konfiguracją

```json
"pnpm": { "overrides": { "entities": "4.5.0" } }
```

Projekt używa **bun**. Bun czyta `overrides` i `resolutions`, **nie czyta `pnpm.overrides`**.
Dowód jest w locku: gdyby override działał, wszystkie `entities` stałyby na 4.5.0. Tymczasem
w drzewie są trzy wersje naraz:

| Ścieżka                     | Wersja |
| --------------------------- | ------ |
| `entities` (bezpośrednia)   | 4.5.0  |
| `happy-dom/entities`        | 7.0.1  |
| `node-html-parser/entities` | 8.0.0  |
| `parse5/entities`           | 8.0.0  |

**`entities` 8 jest już w drzewie od dawna, transitywnie, i nic się nie pali.** Override nie
zadziałał ani razu. Do zrobienia: przenieść na klucz czytany przez bun albo skasować - w obu
przypadkach świadomie i z wpisem w raporcie.

---

## 3. Twarde ograniczenia - zweryfikowane w `bun.lock`

### 3.1. TypeScript 7 jest zablokowany i NIE WOLNO go obchodzić wyłączeniem lintowania

`typescript-eslint@8.59.0` (nie 8.70.1, jak podawał brief) deklaruje peer
`typescript: ">=4.8.4 <6.1.0"`.

Wariant „wyłączmy lintowanie, żeby wziąć TS 7" został rozważony i **odrzucony**:

1. `eslint.config.js` **w całości** jest wywołaniem `tseslint.config(...)` (linia 8). Usunięcie
   `typescript-eslint` nie wyłącza reguły - sprawia, że konfiguracja się nie ładuje.
   `bun run lint` przestaje działać na **wszystkim**, łącznie z czystym JS. To skasowanie bramki,
   nie jej degradacja.
2. Linia 76 ustawia `@typescript-eslint/no-explicit-any: "error"`. To jedyna reguła lintera
   egzekwująca „bez `any`". Razem z `check:unknown-casts` stanowi komplet. Wyłączenie lintera
   po to, żeby podnieść kompilator, kasuje strażnika zasady nienegocjowalnej.
3. Asymetria: TS 7 daje **czas kompilacji**, nie poprawność. Szybkość wróci za darmo, gdy
   `typescript-eslint` wyda peer na 7. Defekty wpuszczone w oknie bez lintowania nie znikną same.

**Zostaw TypeScript na najnowszym 5.x.** W raporcie zapisz datę sprawdzenia, czy
`typescript-eslint` wydał już wersję z peerem na 7.

### 3.2. Vite 8 nie jest przez nic w drzewie blokowany

Komplet konsumentów peera `vite` z `bun.lock`:

| Paczka                              | peer `vite`                              | Vite 8? |
| ----------------------------------- | ---------------------------------------- | ------- |
| `@vitejs/plugin-react` (5.2.0)      | `^4.2.0 \|\| ^5 \|\| ^6 \|\| ^7 \|\| ^8` | **tak** |
| `@tailwindcss/vite`                 | `^5.2.0 \|\| ^6 \|\| ^7 \|\| ^8`         | tak     |
| `@tanstack/devtools-vite`           | `^6 \|\| ^7 \|\| ^8`                     | tak     |
| `@tanstack/react-start`             | `>=7.0.0`                                | tak     |
| `@tanstack/start-plugin-core`       | `>=7.0.0`                                | tak     |
| `@tanstack/router-plugin`           | `>=5.0.0 \|\| ... \|\| >=8.0.0`          | tak     |
| `@vitest/mocker`                    | `^6 \|\| ^7 \|\| ^8`                     | tak     |
| `nitro`                             | `^7 \|\| ^8`                             | tak     |
| `@lovable.dev/mcp-js`               | `>=5.0.0 <9.0.0`                         | tak     |
| `@lovable.dev/vite-tanstack-config` | `>=5.0.0 <9.0.0`                         | tak     |
| `vite-tsconfig-paths`               | `*`                                      | tak     |
| `vitefu`                            | `^3 \|\| ... \|\| ^8`                    | tak     |

**SPROSTOWANIE briefu.** Brief twierdził: „Vite 8 i plugin-react 6 muszą iść RAZEM albo wcale".
To jest prawdą tylko w jedną stronę. `@vitejs/plugin-react@6` istotnie wymaga Vite 8, ale
**zainstalowany dziś `@vitejs/plugin-react@5.2.0` już obsługuje Vite 8**. Vite 8 można wziąć
bez ruszania plugin-react. To **rozprzęga etap D**.

### 3.3. zod 4 jest dozwolony - i jest już w drzewie

| Paczka                       | peer `zod`             |
| ---------------------------- | ---------------------- |
| `ai`, `@ai-sdk/*` (6 paczek) | `^3.25.76 \|\| ^4.1.8` |
| `@lovable.dev/mcp-js`        | `>=3.23.0`             |
| `zod-to-json-schema`         | `^3.25.28 \|\| ^4`     |

**Uwaga: dolna granica to 4.1.8.** Skok na cokolwiek niższego niż 4.1.8 **złamałby** peer
`@ai-sdk/*`. Cel to `^4.6.5` (latest), więc warunek jest spełniony.

Fakt, który zmienia bilans: **zod 4.4.3 jest już zainstalowany**, zagnieżdżony pod
`@modelcontextprotocol/sdk`, `@tanstack/router-generator`, `@tanstack/router-plugin`
i `@tanstack/start-plugin-core`. Drzewo wiezie dziś **dwie linie zod naraz**. Podniesienie
zależności bezpośredniej do 4 je **deduplikuje** - powinno bundel **zmniejszyć**. To argument
ZA etapem C.

### 3.4. `@vitest/coverage-v8` jest zainstalowany, ale NIC go nie używa

Jedyny `provider` w repozytorium to `"istanbul"`. `@vitest/coverage-v8` nie jest referencjonowany
przez żaden z czterech configów vitesta ani przez `ci.yml`.

Znaczenie dla etapu D jest konkretne: **oba** pakiety pokrycia pinują `vitest` **co do wersji**
(`"vitest": "4.1.7"`), więc dziś trójka `vitest` + `coverage-istanbul` + `coverage-v8` musi
ruszać się razem. **Usunięcie martwego `@vitest/coverage-v8` zmniejsza ten splot z trójki do
pary** i kasuje jedną zależność deweloperską.

**Do zrobienia przed etapem D:** potwierdzić, że nic go nie używa (`grep -rn "coverage-v8\|provider.*v8"`),
usunąć osobnym commitem, dopiero potem ruszać vitesta.

---

## 4. Pułapki tego repozytorium

### 4.1. `lucide-react` ma obowiązkowy krok następczy, o którym automat nie wie

`src/lib/icons/lucideIconNodes.generated.ts` to **484 771 bajtów** w 11 liniach. Nagłówek mówi
wprost:

```
// WYGENEROWANE przez scripts/gen-lucide-icon-nodes.mjs z lucide-react v0.577.0.
// Nie edytować ręcznie; po podbiciu lucide-react uruchom generator ponownie.
```

**`bun update lucide-react` bez ponownego uruchomienia generatora zostawia dane ikon ze starej
wersji.** Plik jest wyłączony z pokrycia (`vitest.config.ts`, linia 87), więc **żadna bramka tego
nie złapie**. Cicha niespójność - dokładnie ta klasa, którą to zlecenie ma likwidować.

`src/lib/icons/curatedIconNames.ts` niesie **125** nazw ikon, a `check:menu-icons` wymusza, żeby
nazwa podana menu należała do tego zestawu. Koszt naruszenia: nazwa spoza zestawu każe
przeglądarce dociągnąć pełny rejestr ikon - **473 KB źródeł, 109 KB gzip, u każdego anonima,
na ścieżce renderu nagłówka**.

**Po podniesieniu `lucide-react`:**

1. Uruchom `scripts/gen-lucide-icon-nodes.mjs` i **commituj przegenerowany plik razem z bumpem**.
2. Sprawdź, czy któraś ze 125 kuratorowanych nazw **zniknęła lub została przemianowana**.
   Skok 0.577 -> 1.47 to major; renejmy są tu regułą.
3. `bun run check:menu-icons` zielone.
4. Zmierz wpływ na budżety (rozdz. 4.3).

### 4.2. `vitest.config.ts` ma 7 683 linie i 743 progi

To nie jest zwykły config. Punkty ryzyka przy vitest 5:

- **`scripts/vitest/testAccountingReporter.ts`** - własny reporter implementujący interfejs
  `Reporter` z vitesta 4, zarejestrowany w `vitest.config.ts:18` i ponownie w CLI shardów
  (`ci.yml:860`). **Najwyższe ryzyko etapu D** - interfejs reporterów to obszar, który vitest
  zmienia między majorami.
- **Reporter `blob` + `--merge-reports`** (`ci.yml:860`, `:864-869`, `:903-908`) - shardy zdają
  raporty cząstkowe, job `test` je scala. Format blobów jest wewnętrzny i **nie jest** objęty
  gwarancją zgodności.
- **743 klucze progów**, część z eskejpowanymi nawiasami kwadratowymi dla nazw tras TanStack
  Start. Dopasowanie globów robi picomatch - zmiana jego wersji zmienia, które pliki wpadają
  pod który próg, **bez żadnego sygnału**.
- **`coverage.reportOnFailure: true`** (`vitest.config.ts:70`) z komentarzem tłumaczącym, że
  opiera się na wewnętrznym zachowaniu vitesta (`checkThresholds` żyje w
  `coverageProvider.reportCoverage()`). Zależność od wewnętrznego szczegółu **przez major nie
  przechodzi automatycznie** - zweryfikuj ją jawnie.
- **`vitest.shard.config.ts` mutuje zaimportowany obiekt w miejscu**
  (`config.test.coverage.thresholds = undefined`) zamiast składać nowy przez `defineConfig`.
  Działa, dopóki vitest nie zamrozi configu.

Konsekwencja praktyczna: **progi pokrycia są kasowane w shardach**, więc naruszenie progu wywala
job `test`, a **nie** `test-shards`. Zielone shardy nie dowodzą niczego o pokryciu.

### 4.3. Bramka rozmiaru bundla - kronika i pomiar obu stron

`FROZEN_BUDGET_KB` na `119c03b`:

```
chunk: 286,  public: 2826,  overall: 4509,  css: 96,  publicCss: 83,  boot: 579
```

### 4.3.1. OBOWIĄZUJE: floor OVERALL to 4572, wpis XVII. Moje sprostowanie było przedwczesne.

**To jest errata do mojego własnego sprostowania i najciekawszy wpis w tym dokumencie, bo
pokazuje dokładnie ten tryb pomyłki, przed którym zlecenie ostrzega.**

Pierwsza redakcja tego rozdziału twierdziła: „Brief podawał floor OVERALL 4572 (wpis XVII),
a ciąg `4572` nie występuje w pliku ani razu; faktyczny floor to 4509, ostatni wpis to XVI".

**Na `119c03b` to było prawdą.** Ale w trakcie pisania tego zlecenia scalono PR #385, a wraz
z nim wjechał **wpis kroniki XVII (2026-09-22)**, który podniósł `overall` z **4509 na 4572**.
Zmierzone na `a80dc767e`:

```
chunk: 286,  public: 2826,  overall: 4572,  css: 96,  publicCss: 83,  boot: 579
```

**Autor briefu czytał nowsze drzewo niż ja, a nie mylił się.** Moje „sprostowanie" było poprawne
wobec HEAD-a pomiaru i nieaktualne wobec `main` w chwili, gdy ktokolwiek je przeczyta.

**Co OBOWIĄZUJE wykonawcę:** `overall` = **4572**, ostatni wpis kroniki = **XVII**, następny
w kolejności = **XVIII**. Pozostałe pięć progów bez zmian.

**Morał, który jest wart więcej niż sama liczba.** To jest ta sama klasa pomyłki, którą zlecenie
opisuje dwa razy: raz przy 17-21 nieistniejących błędach typów (rozdz. 0, test 2) i raz przy
punkcie odniesienia suity (rozdz. 5.0). Za każdym razem mechanizm jest identyczny - **ktoś
porównuje pomiar z jednego drzewa z oczekiwaniem z innego**. Dlatego to zlecenie nosi test
aktualności w nagłówku i dlatego go na sobie uruchomiłem. Uruchom go też, zanim ruszysz.

Pozostałe cztery sprostowania briefu (rozdz. 1) sprawdziłem ponownie po scaleniu #385
i **wszystkie dalej obowiązują**: `package.json` i `bun.lock` nie zmieniły się ani o bajt.

Uwaga ratująca przed fałszywym pomiarem: **w CI zmienne `MAX_CHUNK_KB`, `MAX_PUBLIC_KB`,
`MAX_TOTAL_KB`, `MAX_CSS_KB`, `MAX_BOOT_KB` są IGNOROWANE** - bramką jest zamrożona tabela
(`scripts/check-bundle-size.ts`, okolice linii 1153).

Aktualizacja ruszy te liczby **w obie strony**: zod 4 deduplikuje (w dół), przegenerowany rejestr
ikon może pójść w górę, Vite 8 zmieni granulację chunków. Podniesienie floora wymaga pomiaru
**obu** stron (main i gałąź) i wpisu do kroniki; obowiązuje „floor z runnera, nie z hosta"
(wpis V) oraz margines na zaokrąglenie (wpis IV).

### 4.4. `check:unknown-casts` to ratchet per plik - nowe rzutowania NIE PRZEJDĄ

Bramka jest zamrożona **per plik**: licznik może tylko maleć, a plik nieobecny w bazie musi mieć
zero. Klasa `as unknown as T` liczyła 362 wystąpienia przed zamrożeniem; repo trzyma dodatkowo
**5** ręcznych `as any` pod regułą lintera.

**To jest najważniejsze ograniczenie wykonawcze całego zlecenia.** Jeśli `zod` 4, `vitest` 5 albo
`vite` 8 zmienią typy tak, że coś przestanie się kompilować, **nie wolno** zaspokoić `tsc`
rzutowaniem. Poprawną odpowiedzią jest zmiana **typu**. Jeżeli w konkretnym miejscu nie da się
inaczej - **zostaw paczkę na obecnej wersji i napisz wprost dlaczego**. To dozwolone zakończenie.
Rzutowanie nie jest.

### 4.5. `xlsx` - NIE RUSZAĆ

`xlsx` pochodzi z tarballa CDN SheetJS (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`),
nie z npm. Paczka `xlsx` w npm stoi na 0.18.5 i jest porzucona. Automat „podnieś do latest"
zrobi tu **downgrade na martwą wersję**. `bun outdated` **nie pokazuje** `xlsx` właśnie dlatego,
że nie pochodzi z rejestru - nie daj się zmylić jego nieobecności na liście.

### 4.6. `nitro` na becie

`nitro` przypięty na `3.0.260603-beta`, latest beta to `3.0.260903-beta`, peer `vite: "^7 || ^8"`.
Przed etapem D sprawdź, czy nowsza beta nie zmienia kontraktu SSR. Jeśli zmienia - zostaw i opisz.

### 4.7. `minimumReleaseAge` przytnie listę „latest"

`bunfig.toml` ustawia `minimumReleaseAge = 86400` - 24-godzinną zaporę łańcucha dostaw. Wersje
opublikowane mniej niż dobę temu **zostaną pominięte**, a lista wyjątków niesie komentarz:
„Each entry bypasses the 24h guard for one package - confirm with the user before adding any."

**„Najnowsza" znaczy „najnowsza starsza niż 24 h"** - tak to zapisz w raporcie.
**Nie dopisuj nic do `minimumReleaseAgeExcludes`** bez zgody właściciela repozytorium.

### 4.8. `src/routeTree.gen.ts` i pozostałe rejestry

- `src/routeTree.gen.ts` jest **generowany i commitowany**; generator odpala się przy `vite dev`
  i `vite build`. Po etapie D sprawdź `git diff --stat src/routeTree.gen.ts`; jeśli plik się
  przepisał, to osobny, opisany commit - nie doklejaj go do bumpu.
- `supabase/migrations` (kanoniczny) i `drizzle/migrations` - każdy plik drizzle musi mieć wpis
  w `src/lib/ci/migrationLaneParity.ts`. Bump `drizzle-kit`/`drizzle-orm` **nie może** dopisać
  migracji.
- `scripts/lib/coldPublicRouteBaseline.ts` - lista może **tylko się skracać**.
- `src/integrations/supabase/types.ts` - generowany, pilnowany przez `check:types-freshness`.
- `check:authz-snapshot`, `check:codeowners` - generatory z trybem `--check`.

---

## 5. Kolejność - etapami, osobny commit po każdym

Przy 113 zależnościach bezpośrednich jednorazowe `bun update --latest` uniemożliwia ustalenie,
która zmiana co zepsuła.

| Etap  | Zakres                                                                                                                                           | Pozycji   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| **0** | decyzja o rejestrze (rozdz. 2), martwy `pnpm.overrides` (2.1), usunięcie martwego `@vitest/coverage-v8` (3.4), rozstrzygnięcie 10 przypięć (1.3) | 4 commity |
| **A** | wszystkie skoki minor/patch w zakresie                                                                                                           | **73**    |
| **B** | majory deweloperskie: `@types/node`, `globals`, `@eslint/js`, `eslint`, `eslint-plugin-react-hooks`, `@testing-library/jest-dom`                 | 6         |
| **C** | majory produktu, **po jednej paczce na commit**: `zod`, `lucide-react`, `react-day-picker`, `entities`, `@lovable.dev/mcp-js`                    | 5         |
| **D** | toolchain: `vite` + `vitest` + `coverage-istanbul` (+ `@vitejs/plugin-react` osobno)                                                             | 3-4       |

**Etap 0 idzie pierwszy**, bo porządkuje grunt: kasuje martwą zależność, która niepotrzebnie
usztywnia etap D, i rozstrzyga rejestr, od którego zależy każda kolejna instalacja.

### 5.0. KROK ZEROWY PRZED WSZYSTKIM: zdejmij punkt odniesienia z nietkniętego HEAD

**Suita JUŻ PADA, przed jakąkolwiek aktualizacją.** Nie jest to przypuszczenie - stoi
w `ci.yml` (okolice linii 821-825), w komentarzu joba `test-shards`:

> CZEGO TEN JOB NIE NAPRAWIA: na dziś suita PADA - nie na czasie, tylko na progach pokrycia
> dla `src/components/admin/billing/**` oraz `src/components/profile/**`. To osobny dług,
> tej samej klasy co floor bundla.

**Jeżeli nie zdejmiesz punktu odniesienia na nietkniętym `main`, pierwszy PR aktualizacyjny
odziedziczy tę czerwień i każde kolejne przypisanie przyczyny będzie błędne.** To jest
najbardziej prawdopodobna pomyłka w całym tym planie - ta sama klasa, która w poprzedniej sesji
kazała szukać 17-21 nieistniejących błędów typów.

**Do zrobienia, zanim ruszysz cokolwiek:** przebieg joba `test` na nietkniętym `main`, wynik
zapisany (które globy pokrycia padają i o ile). Dopiero różnica wobec tej liczby jest sygnałem.

### 5.0.1. Dwa joby, które NIE SĄ dowodem

`pgtap` i `pg-harness` nie instalują node-a ani bun-a i nie mają kroku „Repoint lockfile".
Są blokującymi członkami `release-gate`, więc **zostaną zielone przez wszystkie cztery etapy
niezależnie od tego, co zepsujesz**. Realny sygnał dają wyłącznie `verify`, `test-shards` + `test`
oraz `build`.

### 5.0.2. Najgroźniejszy tryb awarii: `package.json` bez przegenerowanego `bun.lock`

Wszystkie 40 kroków bramkowych joba `verify` nosi warunek
`if: !cancelled() && steps.install.outcome == 'success'`. Zmiana `package.json` bez
przegenerowanego locka wywala `bun install --frozen-lockfile`, a wtedy **wszystkie 40 bramek
raportuje się jako POMINIĘTE, a `release-gate` czerwienieje bez ani jednej diagnostyki na temat
samej aktualizacji.**

**Każdy commit etapu musi nieść przegenerowany `bun.lock`**, zwalidowany tak, jak widzi go CI:

```
sed -E 's#https://europe-west[0-9]+-npm\.pkg\.dev/lovable-core-prod/sandbox-npm-cache/#https://registry.npmjs.org/#g' bun.lock \
  && npm_config_registry=https://registry.npmjs.org bun install --frozen-lockfile
```

(po wykonaniu decyzji z rozdz. 2 `sed` przestaje być potrzebny - to jest jeden z zysków tej decyzji)

### 5.0.3. `check:gate-coverage` pilnuje wiązania skryptów z workflow

`scripts/check-gate-coverage.ts` wyprowadza listę bramek z `package.json` i sprawdza, że każdy
`check:*` występuje w workflow **dokładnie raz na job**. Jeżeli któryś etap doda albo przemianuje
skrypt `check:*` (np. bramkę świeżości rejestru ikon) bez podpięcia go w `ci.yml`, ta bramka
padnie. Pilnuje też samej siebie.

### 5.1. Etap A NIE JEST bezpiecznym etapem - cztery konkretne miny

Nazwa „minor/patch" myli. W tych 73 pozycjach siedzą cztery pułapki, z których każda potrafi
wywalić więcej niż którykolwiek major z etapu B.

**A1. Trio Tailwinda musi ruszać się jako jedność.** Zmierzone na dysku:
`@tailwindcss/vite@4.2.4` zależy od `@tailwindcss/node@4.2.4`, `@tailwindcss/oxide@4.2.4`
i `tailwindcss@4.2.4` - **wszystkie CO DO WERSJI**. A w `package.json` stoi:

```
"@tailwindcss/vite": "^4.2.1",   (karetka, linia 135)
"tailwindcss":       "^4.2.1",   (karetka, linia 175)
"@tailwindcss/oxide": "4.2.4",   (PRZYPIĘTE, linia 187)
```

Podniesienie `@tailwindcss/vite` do 4.3.3 w ramach etapu A **dociągnie zagnieżdżony
`oxide` 4.3.3 obok przypiętego w korzeniu 4.2.4** - czyli dokładnie ten rozjazd binarki NAPI,
przed którym przypięcie miało chronić. **`tailwindcss`, `@tailwindcss/vite` i `@tailwindcss/oxide`
podnosisz razem, jednym commitem, albo żadnego.**

**A2. `happy-dom` 20.9 -> 20.14 może wywalić CAŁĄ suitę, nie jeden test.**
`vitest.setup.ts` (okolice linii 31-37) definiuje no-opowy `navigator.sendBeacon` przez
`Object.defineProperty`, **bo happy-dom wykonuje prawdziwe żądanie sieciowe**. Dziś deskryptor
ma `configurable: true`. Jeżeli 20.14 zdefiniuje `sendBeacon` jako niekonfigurowalny,
`defineProperty` rzuci - a wtedy **plik setupowy rzuci, czyli padnie każdy plik testowy
w domyślnym środowisku**, we wszystkich czterech shardach, plus `check:chunk-parity`,
`check:permissions-parity`, `check:i18n-parity`, `check:ci-gates`, `check:widget-fidelity`
i krok SEO. Remedium: osłoń `defineProperty` sprawdzeniem deskryptora i `try/catch`.
**Nie zmieniaj środowiska testowego.**

**A3. Test slidera może przejść Z ZŁEGO POWODU.**
`sliderVariantCatalogs.test.tsx` (okolice linii 908-921) łata
`HTMLImageElement.prototype.complete` i `naturalWidth` w `withBrokenImages()` i przywraca stan,
rozgałęziając się na to, czy deskryptor istniał. W 20.14 `naturalWidth` bywa `> 0` domyślnie,
więc jeden z testów **przejdzie, mimo że łatka nie zadziałała**. Zielony wynik nie jest tu
dowodem. Remedium: asercja, że łatka się założyła, **przed** ciałem testu.

**A4. Minory TanStacka przepisują `src/routeTree.gen.ts`.** Plik ma ~346 KB i jest commitowany;
`@tanstack/react-router` 1.170.18 -> 1.170.38 i `@tanstack/react-start` 1.168.28 -> 1.168.57
mogą go przegenerować. To tryb awarii przypisywany etapowi D, który przychodzi już w etapie A.
Sprawdź `git diff --stat src/routeTree.gen.ts` po instalacji i pierwszym buildzie.

Do tego tło: **18 paczek `@radix-ui/*` na karetkach** stoi pod 21 prymitywami w
`src/components/ui`, na których około tysiąca testów RTL asertuje DOM. To nie jest powód,
żeby ich nie podnosić - to powód, żeby podnieść je **osobnym commitem** w ramach etapu A.

**Sugerowany podział etapu A na commity:** (1) trio Tailwinda, (2) TanStack, (3) `@radix-ui/*`
razem, (4) `happy-dom` osobno, (5) reszta. Pięć commitów zamiast jednego, bo przy jednym nie
ustalisz, która z tych czterech min wybuchła.

### 5.2. Etap B - uwaga szczegółowa

`eslint` 10 jest zgodny z `typescript-eslint@8.59.0` (peer `^8.57.0 || ^9.0.0 || ^10.0.0`) -
sprawdzone w locku.

`eslint-plugin-react-hooks` 5 -> 7 to największe ryzyko etapu: w linii 7 zestaw `recommended`
niesie reguły z lintera React Compilera. Spodziewaj się **nowych** naruszeń w niezmienionym
kodzie. **To nie jest powód, żeby regułę wyłączyć.** Punkt odniesienia: dziś `eslint .` daje
**0 błędów i 241 ostrzeżeń**. Jeżeli naruszeń jest dużo, wejdź na `recommended` z jawną listą
wyłączeń opatrzonych komentarzem i licznikiem (konwencja ratchetu), nie globalnym `off`.

### 5.3. Etap C - kolejność wewnętrzna

1. `zod` 3 -> 4 (cel `^4.6.5`, minimum wymuszone peerami: **4.1.8**). Deduplikuje drugą linię zod.
2. `lucide-react` - **obowiązkowy krok następczy**, rozdz. 4.1.
3. `react-day-picker` 9 -> 10.
4. `entities` 4 -> 8 - najpierw rozstrzygnij martwy `pnpm.overrides` (rozdz. 2.1).
5. `@lovable.dev/mcp-js` 0.20 -> 3.0. Pliki tras MCP są **generowane** przez wtyczkę platformy
   (lista `ignores` w `eslint.config.js`) - major może je przepisać.

### 5.4. Etap D - dwa warianty zamiast jednego

Dzięki sprostowaniu z rozdz. 3.2:

- **D1 (zalecany):** `vite` 8 + `vitest` 5 + `@vitest/coverage-istanbul` 5, **bez** ruszania
  `@vitejs/plugin-react` (5.2.0 obsługuje Vite 8).
- **D2:** `@vitejs/plugin-react` 6, osobnym commitem **po** zazielenieniu D1.

Przed D1 przeczytaj rozdz. 4.2 - reporter i format blobów to realne punkty pęknięcia.

---

## 6. Bramki, które muszą pozostać zielone

Po **każdym** etapie, przed commitem:

```
bun install --frozen-lockfile
bun run typecheck            # tsc + tsconfig.scripts.json
bun run lint                 # punkt odniesienia: 0 błędów, 241 ostrzeżeń
bun run format:check
bun run test
bun run build
```

oraz bramki celowane:

```
bun run check:i18n-parity          bun run check:i18n-overlay-imports
bun run check:i18n-hardcoded       bun run check:i18n-default-value
bun run check:rpc-contract         bun run check:unknown-casts
bun run check:clock-freeze         bun run check:ssr-budgets
bun run check:authz-snapshot       bun run check:permissions-parity
bun run check:menu-icons           bun run check:bundle
```

Uwagi wykonawcze:

- **`check:bundle`**, nie `check:bundle-size` - skryptu o tej drugiej nazwie **nie ma**
  w `package.json`. Lista akceptacyjna briefu podawała nazwę nieistniejącą.
- Kroki joba `verify` mają warunek `if: ${{ !cancelled() && steps.install.outcome == 'success' }}`,
  więc **wykonują się niezależnie od siebie**, byle instalacja przeszła. Czerwień jednego kroku
  nie ukrywa pozostałych.
- Job `verify` ma **47 kroków** i `timeout-minutes: 20`.
- CI jedzie w `TZ=UTC`. Bez tego testy kalendarza pokazują fałszywą czerwień.
- CI przypina **bun 1.2.23** (`oven-sh/setup-bun@v2`) i **Node 24.19.0**. Używaj tych wersji.

---

## 7. Zasady warsztatu

**Kod.** Bez `any` i `as any`. Bez `as unknown as` (rozdz. 4.4). Zamiast „—" stosuj „-".

**i18n (PL i EN).** Jeżeli bump wymusi zmianę w komponencie z tekstem, tekst idzie przez `t()`,
w obu językach, **bez `defaultValue`** - bramka `check:i18n-default-value` jest zerowa,
bo `i18next` czyta `defaultValue` wyłącznie przy braku klucza, a bramka parytetu dowodzi przy
każdym przebiegu, że żaden klucz nie brakuje. Klucze PL mają formy `_one/_few/_many/_other`,
EN tylko `_one/_other`.

**Atomic design.** Zmiana wymuszona bumpem zostaje **w istniejącej warstwie**. Nie przenoś plików
między `atoms`/`molecules`/`organisms` przy okazji aktualizacji zależności - to byłby drugi,
niezwiązany diff w tym samym commicie.

**Testy.** Nie kasuj, nie wyłączaj i nie oznaczaj testu jako pominiętego, żeby zazielenić bramkę.

---

## 8. CZEGO NIE ROBIĆ - osiem pułapek

1. **Nie szukaj „17-21 błędów typów TanStack Routera".** Nie istnieją (rozdz. 0, test 2). Były
   artefaktem drzewa npm-owego. Naprawianie nieistniejącego defektu to najdroższy sposób
   zepsucia typów.
2. **Nie rób `bun update --latest` na wszystkim naraz.** 113 zależności, 1 269 paczek.
3. **Nie ruszaj TypeScriptu poza 5.x** i **nie wyłączaj lintowania**, żeby to obejść (rozdz. 3.1).
4. **Nie ruszaj `xlsx`** (rozdz. 4.5). „Latest" to tutaj downgrade na porzuconą paczkę.
5. **Nie podnoś floora bundla bez pomiaru obu stron** (rozdz. 4.3).
6. **Nie zaspokajaj `tsc` rzutowaniem** (rozdz. 4.4). Zostawienie paczki na starej wersji
   z uzasadnieniem jest **poprawnym** zakończeniem; `as unknown as` nie jest.
7. **Nie zapomnij przegenerować `lucideIconNodes.generated.ts`** (rozdz. 4.1). Żadna bramka
   tego nie złapie.
8. **Nie dopisuj nic do `minimumReleaseAgeExcludes`** (rozdz. 4.7).

---

## 9. DEFINICJA UKOŃCZENIA

1. **Etap 0 wykonany:** decyzja o rejestrze (rozdz. 2) podjęta i zapisana; `pnpm.overrides`
   rozstrzygnięty; martwy `@vitest/coverage-v8` usunięty albo udowodniony jako używany;
   każde z 10 przypięć albo odmrożone, albo opatrzone komentarzem z powodem.
2. **Etapy A-D w osobnych commitach**, etap C rozbity na pięć, każdy z kompletem bramek
   z rozdz. 6 na zielono **przed** commitem.
3. **`lucideIconNodes.generated.ts` przegenerowany** z nowej wersji `lucide-react`, w tym samym
   commicie co bump, `check:menu-icons` zielone.
4. **Budżety bundla zmierzone po obu stronach**; jeśli ruszyły - wpis **XVIII** w kronice
   `scripts/check-bundle-size.ts` z pomiarem obu stron i uzasadnieniem (XVII zajął PR #385,
   rozdz. 4.3.1).
5. **`src/routeTree.gen.ts`** albo bez zmian, albo przegenerowany osobnym, opisanym commitem.
6. **Żadnego nowego `as unknown as`, `as any` ani `any`.** `check:unknown-casts` zielone,
   liczniki per plik nie wzrosły.
7. **`eslint .` dalej 0 błędów.** Liczba ostrzeżeń podana przed i po.
8. **`dompurify` rozstrzygnięty** (rozdz. 1.3) - odmrożony albo z zapisanym powodem przypięcia.
9. **Lista paczek pozostawionych na starej wersji**, każda z powodem podanym wprost.

**Na koniec zdaj raport:**

- **Tabela: paczka, wersja przed, wersja po, etap, commit.** Dla pozostawionych - powód.
- **Data ustalenia „latest"** i uwaga, że `minimumReleaseAge` przycina listę o wersje młodsze
  niż doba.
- **Budżety bundla przed i po**, tą samą metodą, z zaznaczeniem: runner czy host.
- **Czy `typescript-eslint` wydał wersję z peerem na TypeScript 7** - data sprawdzenia.
- **Osobno: które liczby z tego zlecenia okazały się nieaktualne.** Ta lista jest dla audytu
  najcenniejsza, a to zlecenie daje jej dwa rodzaje wpisu.

  **Cztery sprostowania briefu, które OBOWIĄZUJĄ** (sprawdzone ponownie po scaleniu #385,
  bo `package.json` i `bun.lock` nie drgnęły): `typescript-eslint` to 8.59.0, nie 8.70.1;
  `@vitejs/plugin-react` 5.2.0 już obsługuje Vite 8, więc etap D się rozprzęga;
  skryptu `check:bundle-size` nie ma, właściwa nazwa to `check:bundle`; minor/patch jest 73,
  nie 76.

  **Jedno sprostowanie, które SAMO SIĘ UNIEWAŻNIŁO** i dlatego jest tu najbardziej pouczające:
  twierdziłem, że floor OVERALL to 4509, a nie 4572 z briefu. Na HEAD-zie pomiaru było to
  prawdą. Scalenie #385 dołożyło wpis XVII, który podniósł floor na 4572 - czyli **brief miał
  rację, tylko czytał nowsze drzewo** (rozdz. 4.3.1). Mechanizm jest ten sam co przy 17-21
  nieistniejących błędach typów: porównanie pomiaru z jednego drzewa z oczekiwaniem z innego.
  Uruchom test aktualności z nagłówka, zanim uwierzysz którejkolwiek liczbie w tym pliku -
  ja go na sobie uruchomiłem i właśnie dlatego ten akapit istnieje.
