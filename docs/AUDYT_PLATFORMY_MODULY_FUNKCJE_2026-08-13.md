# Audyt platformy NES — moduły, funkcje, połączenia międzymodułowe — 2026-08-13

**HEAD:** `94eb31a` (gałąź `claude/platform-modules-analysis-wt1aiq`)
**Poprzedni audyt:** `docs/ANALIZA_MODULOW_DOGLEBNA_2026-08-12.md` na `a9b9e14`
**Delta od tamtego:** 69 commitów, 310 plików, +47 802 / −2 883 linii

Ten audyt jest **pomiarem, nie przeglądem**. Każda liczba niżej pochodzi
z komendy uruchomionej na tym HEAD w tej sesji; tam gdzie pomiar okazał się
błędny w pierwszym podejściu, w tekście stoi korekta razem z przyczyną.
Nie powtarzam narracji poprzedniego audytu — powtarzam metodę i podaję,
co się zmieniło.

---

## 0. Trzy korekty do wcześniejszych ustaleń

Zanim cokolwiek innego: audyt, który nie poprawia własnych błędów, jest
kolejnym źródłem dryfu. Trzy liczby podawane wcześniej były nieprawdziwe.

### 0.1. „431 + 624 ternariów językowych w 331 plikach" — źle policzone

Dodałem do siebie dwie różne miary (ternaria i tokeny). Prawdziwy stan
na bazie tej gałęzi (`1ea4ccd`): **432 ternaria `isPl ?` w 96 plikach**.
Na tym HEAD: **155 w 33 plikach**. Zdjęte w tej gałęzi: 277.

### 0.2. „5 funkcji SECURITY DEFINER bez przypiętego search_path" — false positive

Pierwszy parser urywał ciała funkcji i nie widział późniejszych
`ALTER FUNCTION … SET search_path`. Po uwzględnieniu ALTER-ów:
**624 funkcje `SECURITY DEFINER`, z czego 0 bez przypiętego `search_path`**.
Postawa bezpieczeństwa w tym wymiarze jest czysta — i to jest wynik, nie
domysł: `20260812164000_extensions_search_path_for_pgcrypto_and_unaccent.sql`
domknął ostatnie siedem przypadków dzień temu.

### 0.3. „302 wystąpienia `as any`" — 295 z nich jest w pliku GENEROWANYM

`src/routeTree.gen.ts` (generowany przez TanStack) niesie 295 z 302.
Ręcznie napisanych `as any` jest **7, w 7 plikach**. `eslint` ma
`@typescript-eslint/no-explicit-any: "error"` dla produkcji i `off` tylko
dla testów, więc ta dyscyplina jest realnie wymuszona, a nie deklarowana.

---

## 1. Skala platformy — stan zmierzony

| Wymiar                                    | Liczba                                             |
| ----------------------------------------- | -------------------------------------------------- |
| Trasy (`src/routes/*.tsx`)                | **241** (139 admin, 81 publiczne, 20 kluby, 2 API) |
| Komponenty `.tsx`                         | 1 085                                              |
| Moduły `src/lib/*.ts`                     | 955                                                |
| Hooki                                     | 39                                                 |
| Pliki `*.functions.ts` (server functions) | 82                                                 |
| Wywołania `createServerFn`                | **349**                                            |
| Moduły `*.server.ts`                      | 97                                                 |
| Unikalne nazwy RPC wołane z klienta       | **382**                                            |
| Migracje SQL                              | **760** (137 080 linii)                            |
| Tabele                                    | 252                                                |
| Funkcje SQL (ostatnia definicja)          | **732**                                            |
| Testy pgTAP                               | 90 plików                                          |
| Pliki testowe vitest                      | **737** (97 912 linii)                             |
| Słowniki i18n                             | 85 plików                                          |
| Bramki `check:*`                          | 21                                                 |
| Workflow CI                               | 5                                                  |
| **Kod produkcyjny**                       | **439 371 linii** (537 283 − 97 912 testów)        |

Stosunek testów do produkcji: **0,22** (97 912 / 439 371). To nie jest
zła liczba dla platformy z 349 funkcjami serwerowymi, ale jest bardzo
nierówno rozłożona — patrz §4.

---

## 2. Mapa modułów i połączeń — zmierzony graf importów

Graf zbudowany z faktycznych krawędzi `from "@/…"` (2 510 plików
produkcyjnych, 22 warstwy): **214 unikalnych par modułów, 6 323 importy
międzymodułowe**.

### 2.1. Najsilniejsze zależności (warstwowo)

```
427  trasy admin        -> design system      (ui/atoms/molecules)
403  admin (reszta)     -> design system
341  komponenty         -> lib
271  admin (reszta)     -> lib
205  builder            -> design system
192  trasy publiczne    -> seo
184  trasy publiczne    -> lib
181  trasy admin        -> lib
167  kluby              -> design system
158  builder            -> lib
147  trasy publiczne    -> design system
141  trasy admin        -> admin (reszta)
133  trasy publiczne    -> komponenty
116  kluby              -> i18n (rdzeń)
```

Kształt jest zdrowy: **wszystko ciąży do design systemu i do `lib`**, czyli
do warstw bez własnej domeny. Nie ma modułu domenowego, od którego zależy
pół platformy — a to jest jedyny wzorzec, którego w tej skali nie da się
później rozplątać.

### 2.2. Zależności między modułami DOMENOWYMI (bez design systemu i `lib`)

```
 23  bloki        -> builder          9  builder -> wydarzenia
 17  builder      -> bloki           9  builder -> monetyzacja
 11  treść        -> bloki           9  kluby   -> seo
 10  newsletter   -> mail            7  sieć    -> społeczność
  7  kluby        -> sieć            6  sieć    -> czat
  6  monetyzacja  -> mail            5  monetyzacja -> profil
  5  tracker      -> seo             5  kluby   -> monetyzacja
```

### 2.3. Sprzężenia dwukierunkowe (11 par)

| Para                      | Kierunki | Ocena                                                                                                                                             |
| ------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bloki ↔ builder`         | 23 / 17  | **Do rozstrzygnięcia.** Najsilniejszy cykl w repo. Dwa silniki treści dzielą typy widgetów i renderery; ani jeden nie jest jednoznacznie „niżej". |
| `treść ↔ bloki`           | 11 / 2   | Akceptowalne — kierunek dominujący jest jasny, powrót to 2 importy typów.                                                                         |
| `treść ↔ builder`         | 4 / 1    | Jak wyżej.                                                                                                                                        |
| `builder ↔ wydarzenia`    | 9 / 2    | Widget wydarzeń w builderze; kierunek dominujący jasny.                                                                                           |
| `profil ↔ monetyzacja`    | 1 / 5    | Do zaakceptowania: plan konta jest atrybutem profilu.                                                                                             |
| `profil ↔ czat`           | 1 / 3    | Do zaakceptowania.                                                                                                                                |
| `profil ↔ eksperci`       | 3 / 1    | Do zaakceptowania.                                                                                                                                |
| `czat ↔ realtime`         | 1 / 1    | Symetryczne po jednym imporcie — najprawdopodobniej typ.                                                                                          |
| `powiadomienia ↔ kluby`   | 1 / 1    | Jak wyżej.                                                                                                                                        |
| `seo ↔ analityka`         | 1 / 1    | Jak wyżej.                                                                                                                                        |
| `builder ↔ powiadomienia` | 1 / 1    | Jak wyżej.                                                                                                                                        |

**Wniosek:** dziesięć z jedenastu cykli to sprzężenia o wadze 1–2 w słabszym
kierunku, czyli import typu albo jednej stałej. Jeden — `bloki ↔ builder` —
jest realnym, obustronnie ciężkim sprzężeniem i jedynym, który zasługuje
na decyzję architektoniczną.

### 2.4. Naruszenia warstwowości — trzy znalezione, dwa fałszywe

1. **`.server.ts` importowane z komponentu: 0.** Sprawdzone bezpośrednio.
   48 importów `.server` z `src/routes` to endpointy serwerowe (`sitemaps`,
   `rss`, `llms.txt`, `platform/email/*`), które wykonują się na serwerze.
2. **Dwie trasy-komponenty importują `.server`** — `admin.billing-reconcile.tsx`
   i `admin.donations.tsx` — ale **oba to `import type`**, czyli znikają przy
   kompilacji. Nie ma przecieku serwera do klienta.
3. **Pięć tras publicznych importuje z `@/components/admin/…`** — to jest
   prawdziwe, ale trzeba je rozdzielić:
   - `index.tsx -> BuilderRenderer` — **zamierzone**: strona główna jest
     składana builderem.
   - `checkout.success.tsx -> PurchaseConfirmationView` — **zamierzone**:
     widok potwierdzenia to widget buildera.
   - `club.$clubSlug.{about,members,new}.tsx -> ClubEnumSelect` — **błąd
     ULOKOWANIA, nie bundla.** Komponent jest liściem (importuje wyłącznie
     `ui/select`, `ui/label`, `react-i18next`), więc nie ciągnie za sobą
     admina. Ale mieszka pod `components/admin/clubs/molecules/`, choć
     obsługuje powierzchnię publiczną. Do przeniesienia do
     `components/clubs/molecules/`.

---

## 3. Stan bramek — co jest zielone i co jest realnie pilnowane

Wszystkie zmierzone na tym HEAD.

| Bramka               | Stan                                                                                             | Uwaga                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `tsc --noEmit`       | **0 błędów**                                                                                     | jedyny komunikat to `@ai-sdk/openai-compatible` — proxy npm w tym kontenerze zwraca 403; pakiet jest w `package.json` |
| `eslint src/`        | **0 błędów**, 173 ostrzeżenia                                                                    | ostrzeżenia to `react-hooks/exhaustive-deps` i `react-refresh/only-export-components`                                 |
| `vitest run`         | **8 061 testów zielonych**, 50 pominiętych, 737 plików                                           |                                                                                                                       |
| Pokrycie             | **32,50% instr. / 28,23% gałęzi / 24,88% funkcji / 33,09% linii** przy progach 29 / 25 / 22 / 29 | margines ~3,5 pp; 26 progów per-ścieżka                                                                               |
| `check:i18n-parity`  | zielone, 327 asercji                                                                             | 12 bramkowanych prefiksów, 0 brakujących kluczy                                                                       |
| `check:bundle`       | zielone                                                                                          | 511,3 / 2 462,0 / 3 752,8 przy 513 / 2 475 / 3 790                                                                    |
| `check:entry-purity` | zielone                                                                                          | ścieżka bootowania: 7 chunków z 665                                                                                   |
| `check:chunks`       | zielone                                                                                          | 665 chunków, 3 310 krawędzi, graf acykliczny                                                                          |
| `check:chunk-parity` | zielone                                                                                          | 3 asercje                                                                                                             |
| `check:*` łącznie    | 21 skryptów                                                                                      |                                                                                                                       |
| CI `ci.yml`          | 5 jobów: `verify`, `pgtap`, `pg-harness`, `post-deploy` + billing/scheduler/e2e/lighthouse       | **32 nazwane kroki** w `verify`                                                                                       |

### 3.1. Co bramki naprawdę pilnują — i czego nie

Zestaw jest nietypowo mocny dla platformy tej skali. Poza standardem
(typy, testy, lint, pokrycie, bundle) pilnowane są rzeczy, które zwykle
nikt nie pilnuje:

- `check:sql-tenant-scope`, `check:sql-owner-tenant-scope` — inwariant
  wielodostępności w SQL,
- `check:sql-anon-insert` — czy anonim może cokolwiek wstawić,
- `check:sql-emit-actor` — pozycja aktora w zdarzeniach domenowych,
- `check:rpc-contract` — zgodność wywołań RPC z klienta z migracjami,
- `check:db-contract` — tabele / widoki / RPC,
- `check:authz-snapshot` + `check:permissions-parity` — macierz uprawnień,
- `check:entry-purity` — SDK płatności poza ścieżką bootowania,
- `check:stale-never-casts`, `check:legacy-payment-refs`,
  `check:workflow-env-contract` — martwe rzutowania, martwe referencje,
  martwe eksporty env.

**Czego brakuje** (§7 zawiera rekomendacje):

- **nie ma bramki na martwe zmienne i importy.** `tsconfig` ma
  `noUnusedLocals: false`, `noUnusedParameters: false`, a `eslint` ma
  `@typescript-eslint/no-unused-vars: "off"`. Zmierzony skutek niżej.
- `check:entry-purity` pilnuje **obecności SDK płatności**, nie **rozmiaru**
  chunku wejściowego. Chunk startowy może rosnąć dowolnie, dopóki nie
  wciągnie Stripe'a — patrz §5.

---

## 4. Moduły — rozmiar, gęstość testów, powierzchnia serwerowa

Kolumna **T/P** to linie testów na linię kodu produkcyjnego. To najlepszy
pojedynczy wskaźnik tego, gdzie zmiana jest bezpieczna, a gdzie idzie się
po omacku.

| Moduł           | Plików |  Linii | Testów | Linii T |  **T/P** | `.functions` | `.server` |
| --------------- | -----: | -----: | -----: | ------: | -------: | -----------: | --------: |
| builder         |    244 | 67 194 |    139 |  24 989 |     0,37 |            0 |         0 |
| bloki           |    162 | 32 656 |     36 |   4 572 | **0,14** |            0 |         0 |
| kluby           |    158 | 31 039 |     45 |   4 916 | **0,16** |            4 |         0 |
| monetyzacja     |    120 | 17 591 |     41 |   7 233 |     0,41 |           13 |        39 |
| czat            |     57 | 12 309 |     13 |   1 363 | **0,11** |            0 |         0 |
| analityka       |     53 | 11 412 |      7 |   1 041 | **0,09** |            6 |         2 |
| newsletter      |     35 | 10 808 |     10 |     992 | **0,09** |            0 |         2 |
| sieć + eksperci |     49 |  8 376 |     30 |   6 327 | **0,76** |            1 |         0 |
| treść / wpisy   |     81 |  8 138 |     23 |   1 917 |     0,24 |            4 |         0 |
| platforma       |     48 |  8 027 |     26 |   3 518 |     0,44 |            2 |        26 |
| wygląd / motyw  |     81 |  7 706 |     27 |   1 724 |     0,22 |            1 |         0 |
| profil          |     33 |  7 611 |     14 |   2 241 |     0,29 |            1 |         0 |
| seo             |     41 |  5 406 |     32 |   3 338 | **0,62** |            1 |         2 |
| crm             |     26 |  5 388 |      7 |     809 | **0,15** |            0 |         0 |
| powiadomienia   |     26 |  5 333 |     13 |   1 655 |     0,31 |            1 |         2 |
| bramki CI       |     18 |  4 989 |     21 |   3 984 | **0,80** |            0 |         0 |
| mail / email    |     25 |  4 910 |     10 |   1 262 |     0,26 |            0 |        13 |
| wyszukiwarka    |     22 |  3 575 |      8 |     672 |     0,19 |            3 |         0 |
| uprawnienia     |     22 |  1 749 |      3 |     802 |     0,46 |            0 |         0 |
| społeczność     |     15 |  1 536 |      3 |     250 |     0,16 |            0 |         1 |
| RODO / consent  |     16 |  1 463 |      2 |     239 |     0,16 |            0 |         0 |
| i18n rdzeń      |     11 |  1 020 |      5 |     459 |     0,45 |            0 |         0 |

### 4.1. Wnioski z tabeli

**Najlepiej otestowane są warstwy, które same są bramkami** (`bramki CI`
0,80; `sieć+eksperci` 0,76; `seo` 0,62). To zdrowy sygnał: mechanizm
kontrolny jest sprawdzany mocniej niż to, co kontroluje.

**Pięć modułów jest poniżej 0,17 przy istotnym rozmiarze** i to jest lista
ryzyka, uszeregowana po iloczynie rozmiaru i braku testów:

1. **bloki — 32 656 linii, T/P 0,14.** Największa nieprzetestowana masa
   w repo. Silnik treści renderujący każdy wpis.
2. **kluby — 31 039 linii, T/P 0,16.** Najmłodszy duży moduł (wydany
   6–12.08). Cztery defekty z dzisiejszego commita `94eb31a` (asymetryczny
   fallback, pusty klucz sortowania, surowy bajt NUL, czwarty picker)
   pokazują, jaka klasa błędów tu jeszcze siedzi.
3. **czat — 12 309 linii, T/P 0,11.**
4. **analityka — 11 412 linii, T/P 0,09.** Najniższe pokrycie w repo przy
   6 funkcjach serwerowych.
5. **newsletter — 10 808 linii, T/P 0,09.** Po dwóch dzisiejszych commitach
   ma za to najmocniejszą bramkę wzorcową w repo (12 asercji, w tym
   dwustronna bramka na martwe klucze).

**`RODO/consent` i `społeczność`** mają T/P 0,16 przy małym rozmiarze —
ale RODO jest powierzchnią, w której błąd jest zdarzeniem prawnym, nie
usterką. 239 linii testów na 1 463 linii kodu obsługującego zgody
i eksport danych to za mało niezależnie od proporcji.

### 4.2. Dziura funkcjonalna: 161 z 241 tras nie jest wspomniana w żadnym teście

| Grupa        | Tras bez wzmianki w testach |
| ------------ | --------------------------- |
| `admin.*`    | **111**                     |
| `profile.*`  | 16                          |
| `club.*`     | 16                          |
| `tracker.*`  | 4                           |
| `checkout.*` | **3**                       |
| pozostałe    | 11                          |

Trzy trasy `checkout.*` bez wzmianki w testach są najpoważniejszą pozycją
na tej liście — to ścieżka pieniężna. Kontekst łagodzący: warstwa **pod**
nimi jest testowana nieźle (patrz niżej), więc dziura dotyczy sklejenia
trasy, nie logiki.

### 4.3. Ścieżki pieniężne — pliki produkcyjne vs pliki testowe

| Obszar       | Prod | Testy | Stosunek |
| ------------ | ---: | ----: | -------: |
| subscription |  140 |    47 |     0,34 |
| stripe       |   88 |    29 |     0,33 |
| checkout     |   90 |    22 |     0,24 |
| webhook      |   82 |    15 |     0,18 |
| donation     |   52 |    12 |     0,23 |
| coupon       |   39 |     8 |     0,21 |
| paywall      |   38 | **6** | **0,16** |
| gifting      |   14 |     4 |     0,29 |

**`paywall` z 6 plikami testowymi na 38 produkcyjnych jest najsłabszym
punktem monetyzacji.** Paywall decyduje, kto widzi treść — błąd w jedną
stronę oddaje treść płatną darmo, w drugą blokuje płacącego.

---

## 5. Bundle — i korekta diagnozy zadania „słownik klubów w chunku startowym"

Stan zmierzony po pełnym buildzie:

| Miara                   |    Wartość |  Próg |       Zapas |
| ----------------------- | ---------: | ----: | ----------: |
| Największy chunk (gzip) |   511,3 KB |   513 |  **1,7 KB** |
| PUBLIC (gzip)           | 2 462,0 KB | 2 475 | **13,0 KB** |
| OVERALL (gzip)          | 3 752,8 KB | 3 790 |     37,2 KB |

Najwięksi pojedynczy winowajcy (surowo, nie gzip):

```
1616 KB  index-HSMM7HnQ.js        <- chunk wejściowy
 791 KB  EChartClient-*.js
 684 KB  PostBlockEditor-*.js
 544 KB  Builder-*.js
 439 KB  lucideIconNodes.generated-*.js
 419 KB  xlsx-*.js
```

### 5.1. Weryfikacja premisy: słownik klubów JEST w chunku wejściowym

Sprawdzone sondą na unikalnym, długim ciągu ze słownika
(`"Kluby dyskusyjne są dostępne po zalogowaniu"`): występuje **wyłącznie**
w `index-HSMM7HnQ.js`. Premisa zadania jest prawdziwa.

**Ale diagnoza była błędna.** Dwie pierwsze sondy (`club.role.moderator`,
`adminClubs.`) dały zero, co przez moment sugerowało, że słownika tam nie ma —
te ciągi to _ścieżki kluczy używane w kodzie_, a w pliku słownika istnieją
jako zagnieżdżone obiekty (`role: { moderator: … }`), więc nigdy nie
pojawiają się dosłownie. Sonda na wartości, nie na klucze, rozstrzyga.

### 5.2. Dlaczego `ensureClubI18n()` tego nie naprawił

`i18n-club.ts` **już** korzysta z konwencji nazwanego wiązania:
**0 importów side-effect**, 8+ importów `ensureClubI18n`. Mimo to słownik
ląduje w chunku wejściowym, bo:

- `vite.config.ts` przypisuje `manualChunks` **wyłącznie do `/node_modules/`**
  (`if (!id.includes("/node_modules/")) return undefined`), a moduły
  aplikacji zostawia domyślnej strategii Rollupa;
- domyślna strategia Rollupa **hoistuje moduł dzielony przez wiele chunków
  tras do chunku wspólnego** — a klubowych tras jest 20;
- konfiguracja **jawnie zabrania** dodania `manualChunks` na poziomie
  aplikacji: komentarz w `vite.config.ts` opisuje incydent, w którym
  wymuszenie chunków rozsypało wejście Workera i każda trasa zwracała
  h3 HTTPError 500.

**Czyli:** `ensureI18n()` chroni przed EAGER WYKONANIEM w grafie bootowania
(i to działa — `adminNewsletter` po moim wczorajszym commicie jest poza
chunkiem wejściowym), ale nie chroni przed HOISTOWANIEM przez współdzielenie.
To dwa różne mechanizmy i mieszanie ich było błędem w opisie zadania.

**Realna droga:** rozbić `i18n-club.ts` (191 kB źródła) na fragmenty per
powierzchnia (hub / wątek / dokumenty / wydarzenia / admin), żeby żaden
pojedynczy duży moduł nie był dzielony przez tyle chunków. To praca
mechaniczna z jednoznacznym kryterium sukcesu: sonda na wartość słownika
nie trafia w `index-*.js`.

### 5.3. Bufor 1,7 KB na największym chunku jest zbyt wąski

Próg `chunk: 513` przy pomiarze 511,3 zostawia 0,33% zapasu. Każda zmiana
dotykająca powierzchni dzielonej przez trasy zapali tę bramkę niezależnie
od tego, kto ją wprowadzi. To bramka, która za chwilę zacznie kłamać
o autorstwie regresji — a to dokładnie ten tryb awarii, który kronika
w `check-bundle-size.ts` opisuje trzy razy (08-01, 08-03, 08-12).

---

## 6. Dług, który da się policzyć

### 6.1. Warstwa językowa

| Miara                               |                                       Stan | Zmiana w tej gałęzi |
| ----------------------------------- | -----------------------------------------: | ------------------- |
| Ternaria `isPl ?`                   |                       **155** w 33 plikach | 432 → 155 (−277)    |
| Twarde znaczniki BCP-47             |                                    **321** | ~−6                 |
| Ręczne bliźniaki `? x_pl : x_en`    |                                    **112** | znacząco w dół      |
| `defaultValue:` w wywołaniach `t()` |                                  **1 568** | bez zmian           |
| Słowniki z `ensureI18n()`           |                                    47 / 85 | +2                  |
| Słowniki tylko side-effect          |                                     **38** | —                   |
| Parytet PL/EN                       | 0 brakujących w 12 bramkowanych prefiksach |                     |
| Wartości identyczne PL/EN           |          429 (raportowane, nie bramkowane) | −1                  |

**1 568 wywołań `defaultValue:`** to największa pozostała pozycja długu
językowego i jest niewidoczna dla bramki parytetu: fallback wpisany w kod
sprawia, że brakujący klucz nigdy się nie ujawnia. Koncentracja:
`NotificationsCenter.tsx` (66), `AdminShell.tsx` (56),
`admin.redirects.tsx` (43), `MenuManager.tsx` (38), `admin.popups.tsx` (37).

**38 słowników bez `ensureI18n()`** to lista kandydatów do tego samego
problemu, co §5.1 — w tym `i18n-builder.ts` (108 kB, **73 importy
side-effect**) i `i18n-admin-analytics.ts` (67 kB, 15 importów side-effect).
Oba są adminowe, więc nie obciążają PUBLIC-a, ale obciążają chunk admina.

### 6.2. Martwy kod — luka bez bramki, zmierzona

`tsc --noUnusedLocals` na tym HEAD, **po naprawie opisanej niżej: 156
martwych deklaracji w 67 plikach**. Przed naprawą było 192.

| Plik                           | Martwych |
| ------------------------------ | -------: |
| `admin/blocks/BlockCanvas.tsx` |   **52** |
| `interests/JoinUsForm.tsx`     |        8 |
| `builder/…/SpeakersEditor.tsx` |        6 |
| `routes/admin.analytics.tsx`   |        4 |
| pozostałe (~63 plików)         |      ~86 |

**Z tego 26 dołożyła TA GAŁĄŹ** — zmierzone, nie oszacowane: ten sam
`tsc --noUnusedLocals` na bazie gałęzi (`1ea4ccd`, worktree) daje **166**,
na tym HEAD **192**. Trzy czwarte przyrostu to nieużywane wiązania `i18n`
w destrukturyzacji `useTranslation()`, które zostały po tym, jak usunąłem
martwą derywację `lang` w dwunastu plikach; reszta to nieużywane importy
`LocaleCode`, `Plus`, `Label`, `DynamicIcon`.

Dokładnie dlatego, że ani `tsc`, ani `eslint` tego nie łapią — a ja
polegałem na tym, że złapią, i po każdej transformacji sprawdzałem tylko
`tsc` i `eslint`. Bramka, której nie ma, nie ostrzega: ona po prostu nie
działa i nikt tego nie zauważa. To najkonkretniejszy argument za R1 w §7,
bo jego dowodem jest ten audyt.

**Naprawione w tym commicie:** 37 martwych deklaracji w 27 plikach, których
ta gałąź dotykała — 26 własnych plus 11 odziedziczonych, które siedziały
w tych samych plikach. Bilans: **192 → 156, przy baseline gałęzi 166**,
czyli gałąź schodzi 10 poniżej stanu, od którego startowała.

Pozostaje **156 odziedziczonych w 67 plikach**, z `BlockCanvas.tsx` (52)
na czele. To praca do R1, nie do tego commita: włączenie bramki wymaga
najpierw wyczyszczenia całości, inaczej wejdzie czerwona.

### 6.3. Typowanie

| Miara                         |                       Stan | Ocena           |
| ----------------------------- | -------------------------: | --------------- |
| `as any` ręcznie              |        **7** (w 7 plikach) | czysto          |
| `as any` w `routeTree.gen.ts` |                        295 | plik generowany |
| `: any`                       |                          9 | czysto          |
| `as unknown as`               | 555 (350 prod / 205 testy) | do przeglądu    |
| `@ts-expect-error`            |                          3 | czysto          |
| `@ts-ignore`                  |                      **0** | czysto          |
| `TODO` / `FIXME` / `HACK`     |              **0 / 0 / 0** | czysto          |
| `@deprecated`                 |                          1 | czysto          |
| `eslint-disable`              |                         45 | do przeglądu    |

**350 rzutowań `as unknown as` w kodzie produkcyjnym** to jedyna pozycja
typowania warta uwagi. Część jest nieunikniona (granica Supabase, gdzie
typy generowane nie znają widoków), ale 350 to za dużo, żeby każde było
uzasadnione — a `as unknown as` obchodzi kontrolę typów tak samo skutecznie
jak `as any`, tylko nie zapala `no-explicit-any`.

### 6.4. Dostępność — sygnały

| Miara                              |  Stan |
| ---------------------------------- | ----: |
| `aria-label`                       | 1 230 |
| `aria-pressed`                     |   157 |
| `aria-live`                        |    80 |
| `role="dialog"` / `alertdialog`    |    19 |
| `onClick` na `<div>`               | **2** |
| `<img>` bez `alt`                  | **0** |
| Przyciski tylko z ikoną, bez nazwy | **0** |

To dobry wynik i nie jest przypadkiem: dwie ostatnie pozycje były
naprawiane w commitach z 12–13.08 (m.in. przełącznik podglądu maila
desktop/mobile w `AuthEmailPreviewPanel`, który był dwoma przyciskami
z samą ikoną). Zostały 2 `onClick` na `<div>` — do domknięcia.

---

## 7. Rekomendacje — uszeregowane po iloczynie ryzyka i kosztu

### R1. Włączyć bramkę na martwy kod (koszt: godziny, ryzyko regresji: zero)

`noUnusedLocals` + `noUnusedParameters` w `tsconfig.json` albo
`@typescript-eslint/no-unused-vars: "error"` w `eslint.config.js`.

**Dlaczego to pierwsza pozycja:** to jedyna rekomendacja w tym audycie,
której brak udokumentowałem na sobie. 192 martwe deklaracje, z czego
12 dołożyłem w ciągu dwóch dni, przekonany, że bramki to złapią.
Bramka, która nie istnieje, nie ostrzega — ona po prostu nie działa i nikt
tego nie zauważa.

Wdrożenie musi być dwustopniowe: najpierw naprawić **156 pozostałych**
(albo dodać `ignorePattern` dla `^_`), potem włączyć. Połowa z nich siedzi
w pięciu plikach, więc pierwsze 50% pracy jest tanie. Inaczej bramka wejdzie czerwona
i zostanie wyłączona pierwszym commitem, który się o nią potknie — to
znany tryb awarii, opisany w kronice `check-bundle-size.ts`.

### R2. Podnieść próg `chunk` albo zmniejszyć chunk wejściowy (ryzyko: bramka zaczyna kłamać)

1,7 KB zapasu (0,33%) znaczy, że następna regresja zostanie przypisana
przypadkowemu commitowi. Dwie drogi, do wyboru przez właściciela:

- **rozbić `i18n-club.ts`** na fragmenty per powierzchnia (§5.2) — realne
  −100 KB surowo z chunku wejściowego, kryterium sukcesu jednoznaczne,
- albo **podnieść próg z wpisem do kroniki**, świadomie przyjmując, że
  chunk wejściowy waży tyle, ile waży.

Milczące zostawienie 1,7 KB jest najgorszą z trzech opcji.

### R3. Testy na `paywall` i trzy trasy `checkout.*` (ryzyko: pieniądze)

`paywall` ma 6 plików testowych na 38 produkcyjnych — najsłabszy stosunek
w całej monetyzacji, przy funkcji, która decyduje o dostępie do treści
płatnej. Trzy trasy `checkout.*` nie są wspomniane w żadnym teście.
Warstwa pod nimi jest testowana przyzwoicie (subscription 0,34,
stripe 0,33), więc dziura dotyczy sklejenia, nie logiki — co znaczy, że
kilka testów integracyjnych zamyka ją tanio.

### R4. RODO / consent — 239 linii testów na 1 463 linii kodu

Powierzchnia, na której błąd jest zdarzeniem prawnym, a nie usterką.
Proporcja 0,16 jest tu nieadekwatna niezależnie od tego, że moduł jest
mały. Priorytet: eksport danych i wycofanie zgody.

### R5. Rozstrzygnąć sprzężenie `bloki ↔ builder` (23 / 17)

Jedyny realny cykl w repo — pozostałe dziesięć to importy typów o wadze
1–2. Dwa silniki treści dzielą typy widgetów i renderery, i żaden nie jest
jednoznacznie „niżej". Decyzja do podjęcia raz: albo wspólna warstwa
`lib/content-model` pod oboma, albo jasny kierunek zależności z adapterem
w drugą stronę. Koszt rośnie liniowo z każdym nowym widgetem.

### R6. Przenieść `ClubEnumSelect` do `components/clubs/molecules/`

Trzy trasy publiczne importują komponent mieszkający pod
`components/admin/`. Bundlowo nieszkodliwe (komponent jest liściem),
ale utrwala wrażenie, że powierzchnia publiczna zależy od admina — i przy
następnej zmianie ktoś dołoży do tego pliku zależność, która już nie
będzie liściem.

### R7. Dokończyć warstwę językową: 155 ternariów, 1 568 `defaultValue`

Pozostałe klastry, uszeregowane: panele admina 34, autor 24, popupy 18,
auth 15, `ConsentBanner` 11. Osobno **1 568 `defaultValue:`** —
to fallback wpisany w kod, który sprawia, że brakujący klucz nigdy się nie
ujawnia; koncentracja w `NotificationsCenter` (66) i `AdminShell` (56).

### R8. Przegląd 350 rzutowań `as unknown as` w produkcji

Obchodzą kontrolę typów tak samo skutecznie jak `as any`, ale nie zapalają
`no-explicit-any`. Część jest uzasadniona granicą Supabase; 350 nie jest.

---

## 8. Co ta platforma robi dobrze — i warto to zapisać

Audyt, który wymienia wyłącznie długi, daje fałszywy obraz i prowokuje
złe decyzje remontowe. Cztery rzeczy są tu zrobione lepiej niż standard:

1. **21 bramek `check:*`, z czego 9 pilnuje inwariantów SQL i uprawnień.**
   Wielodostępność, zakres właściciela, wstawianie przez anonima, pozycja
   aktora w zdarzeniach, kontrakt RPC klient⇄migracje. To rzeczy, które
   w większości projektów wychodzą dopiero z incydentu produkcyjnego.
2. **624 funkcje `SECURITY DEFINER`, wszystkie z przypiętym `search_path`.**
   Zero wyjątków, sprawdzone z uwzględnieniem późniejszych `ALTER`-ów.
3. **Zero `TODO`, `FIXME`, `HACK`, `@ts-ignore`; 7 ręcznych `as any`.**
   Przy 439 tysiącach linii produkcyjnych to nie jest przypadek, tylko
   utrzymywana dyscyplina.
4. **Komentarze w kodzie zapisują PRZYCZYNĘ, nie treść.** Kronika
   budżetów w `check-bundle-size.ts`, opis incydentu h3-500 przy
   `manualChunks`, notatka o pułapce Rollupa z modułem wejściowym.
   Ten audyt dało się w ogóle napisać w tym tempie właśnie dzięki nim —
   §5.2 jest przepisaniem komentarza, którego nie musiałem odkrywać sam.

---

## 9. Metoda — żeby ten audyt dał się powtórzyć

Każda liczba w tym dokumencie pochodzi z komendy uruchomionej na
`94eb31a`. Trzy z nich okazały się błędne w pierwszym podejściu i zostały
skorygowane w §0 wraz z przyczyną błędu. Wnioski warte zapisania jako
metoda:

- **Sondowanie zbudowanego bundla trzeba robić na WARTOŚCIACH, nie na
  kluczach.** Ścieżka klucza (`club.role.moderator`) nie istnieje dosłownie
  w pliku słownika o zagnieżdżonej strukturze. Dwa fałszywe negatywy w §5.1.
- **Parser SQL musi uwzględniać późniejsze `ALTER`.** Migracje są
  forward-only, więc stan funkcji to złożenie `CREATE` i wszystkich
  `ALTER`-ów po nim. Pięć fałszywych alarmów bezpieczeństwa w §0.2.
- **Liczby z plików generowanych trzeba oddzielać.** 295 z 302 `as any`
  siedzi w `routeTree.gen.ts`; nierozdzielone dałyby fałszywy obraz
  dyscypliny typowania (§0.3).
- **Grep na dwie różne miary nie sumuje się do jednej.** §0.1.
