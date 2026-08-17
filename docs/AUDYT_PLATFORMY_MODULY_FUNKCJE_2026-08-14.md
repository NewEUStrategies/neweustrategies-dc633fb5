# Audyt platformy NES — moduły, funkcje, połączenia międzymodułowe — 2026-08-15

> **Nazwa pliku niesie datę 14.08, treść jest z 15.08.** Ten dokument został
> **zaktualizowany w miejscu** na wyraźne polecenie, zamiast założenia nowego pliku
> serii. Poprzednie wydanie (HEAD `0fd4108`) jest odzyskiwalne z historii gita
> (`git show 0fd4108:docs/AUDYT_PLATFORMY_MODULY_FUNKCJE_2026-08-14.md`). Wszystkie
> liczby niżej dotyczą HEAD-a `c6306e7`.

**HEAD:** `c6306e7` (gałąź `claude/audyt-platformy-2026-jr2cyv`)
**Poprzedni audyt:** to samo wydanie na `0fd4108`
**Delta `0fd4108..c6306e7`:** 96 commitów, 493 pliki, +24 984 / −6 919 linii

Ten audyt jest **pomiarem, nie przeglądem**. Każda liczba niżej pochodzi z komendy
uruchomionej na tym HEAD w tej sesji — łącznie z pełnym `bun install` (przepięcie
lockfile na publiczny npm, dokładnie tak jak robi to CI), `tsc --noEmit`, `eslint .`,
`prettier --check`, `vitest run --coverage`, pełnym `vite build` i **32 z 33 bramek
`check:*`**. Tam, gdzie pomiaru **nie dało się** wykonać w tym kontenerze, jest to
napisane wprost zamiast przepisania progu z kodu.

**Najważniejsze zdanie tego audytu:** to pierwsze okno w tej serii, w którym
**rekomendacje poprzedniego wydania zostały wykonane hurtem, a nie pojedynczo** —
R2, R5, R7 i R8 są zamknięte pomiarem, R1 i R3 częściowo, a każda z nich została
**przypięta bramką**, więc nie da się jej cofnąć po cichu. CI zeszło z czterech
czerwonych kroków na **jeden** (`check:bundle`) — po naprawie opisanej w §3.4,
wykonanej w trakcie tego audytu.

Drugi czerwony krok, `check:programs-harness`, okazał się **awarią testu, nie
schematu**, i wymagał korekty mojego własnego ustalenia — patrz §0.4. Zapisuję to
w nagłówku, bo pierwsza wersja tego dokumentu twierdziła coś przeciwnego
i twierdziła to jako „najpoważniejsze pojedyncze ustalenie".

---

## 0. Korekta do wcześniejszych ustaleń

Audyt, który nie poprawia własnych błędów, jest kolejnym źródłem dryfu. Tym razem
korekty dotyczą **narzędzia pomiarowego tego audytu**, nie liczb z poprzedniego
wydania — i obie zostały złapane, zanim trafiły do tabeli.

### 0.1. Regexowe „usuwanie komentarzy SQL" skasowało 65% migracji

Pierwsza wersja mojego parsera migracji czyściła komentarze wzorcem
`/\*.*?\*/` (non-greedy, `re.S`). Efekt zmierzony:

| Wejście                           |     Rozmiar | `CREATE TABLE` | `CREATE FUNCTION` | `CREATE POLICY` |
| --------------------------------- | ----------: | -------------: | ----------------: | --------------: |
| surowe migracje                   | 6 038 997 B |            395 |             1 946 |           1 150 |
| po regexowym czyszczeniu          | 2 142 233 B |        **202** |           **662** |         **666** |
| po leksera respektującym literały | 5 159 537 B |        **389** |         **1 936** |       **1 150** |

Przyczyna: w migracjach stoi **22 razy `/*` i tylko 18 razy `*/`** — sekwencje te
siedzą w literałach (wzorce regex, URL-e). Non-greedy dopasowanie łączyło `/*` z
literału z odległym `*/` i zjadało wszystko pomiędzy. **Parser zgłosiłby połowę
schematu jako nieistniejącą.**

Rozwiązanie: właściwy lekser dialektu Postgres (`scratchpad/pglex.py`) — obsługuje
`$tag$…$tag$`, `''`, `E'\\'`, zagnieżdżone `/* */` i `"identyfikatory"`. Wszystkie
liczby SQL w §1 pochodzą z niego.

### 0.2. „4 funkcje SECURITY DEFINER bez `search_path`" — fałszywy alarm

Parser zgłosił cztery funkcje bez przypiętego `search_path`: `delete_email`,
`enqueue_email`, `move_to_dlq`, `read_email_batch`. Poprzednie wydanie podawało
**0** i wprost nazywało to „jedyną rzeczą, w której obie metody są zgodne".

Sprawdzenie ręczne: wszystkie cztery mają `search_path` przypięty **osobną
instrukcją** `ALTER FUNCTION … SET search_path` w późniejszej migracji
(`20260728212941`, `20260729062739`), a nie w ciele `CREATE FUNCTION`. Mój parser
czytał wyłącznie ciało definicji.

**Stan faktyczny: 0 funkcji `SECURITY DEFINER` bez przypiętego `search_path`** —
poprzednie wydanie miało rację. Parser uwzględnia teraz `ALTER FUNCTION`
(21 funkcji korzysta z tej drogi).

Zapisuję to, bo jest to dokładnie ten tryb porażki, przed którym ostrzega §9:
**liczba wyprodukowana przez narzędzie nie jest pomiarem, dopóki nie sprawdzi się
przypadków brzegowych**. Gdyby ten alarm poszedł do dokumentu, byłby to zmyślony
defekt bezpieczeństwa w module poczty.

### 0.3. Różnice metody wobec wydania z 14.08 — nie są regresjami

Mój parser liczy **stan końcowy** (instrukcje odtwarzane w kolejności migracji,
`DROP … IF EXISTS; CREATE …` nie kasuje obiektu, który żyje). Wydanie z 14.08
liczyło inaczej. Żeby następne wydanie nie zgłosiło „regresji", która jest
artefaktem parsera, poniżej obie kolumny **z mojego skryptu na obu HEAD-ach**:

| Miara              | 14.08 (tamten dokument) | mój skrypt na `0fd4108` | mój skrypt na `c6306e7` |
| ------------------ | ----------------------: | ----------------------: | ----------------------: |
| Tabele             |                     244 |                     251 |                 **250** |
| Polityki RLS       |                     556 |                     543 |                 **543** |
| Triggery           |                     356 |                     342 |                 **343** |
| Indeksy            |                     535 |                     529 |                 **532** |
| Widoki             |                      16 |                      13 |                  **14** |
| Funkcje SQL        |                     790 |                     793 |                 **797** |
| `SECURITY DEFINER` |                     709 |                     687 |                 **689** |
| Zadania `pg_cron`  |                      19 |                      17 |                  **17** |

Porównywalne są **wyłącznie dwie prawe kolumny**. Kolumna z 14.08 stoi tu jako ślad,
nie jako baza odejmowania.

### 0.4. „Skasowana migracja programów" — poprawiam własne ustalenie z tej sesji

Pierwsza wersja tego dokumentu podawała jako **najpoważniejsze ustalenie audytu**:
migracja scalająca tabele programów została skasowana commitem „Changes", więc
„obie równoległe rodziny tabel programów żyją dalej", a naprawa to jedna komenda
`git checkout`. **To było błędne w części, która najbardziej znaczy: scalenie
w schemacie ZASZŁO.**

Co ustaliłem dopiero po przywróceniu pliku i uruchomieniu go na żywym Postgresie:

| Fakt                                                    | Dowód                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Skasowana migracja została **zastąpiona**, nie utracona | `20260815110844:116` robi `DROP TABLE public.research_programs`, a linia 117 zakłada w jej miejsce widok; wcześniej buduje `program_merge_map`, przenosi wiersze i przepina `program_id` w czterech tabelach-dzieciach z powrotem na `public.programs`                                                                                             |
| Łańcuch zastępczy ma trzy ogniwa                        | `20260815110437` (kolumna `status`) → `20260815110844` (scalenie) → `20260815111026` (`club_anchor_label` przepięty z `research_programs` na `programs`)                                                                                                                                                                                           |
| `research_programs` **nie jest żywą tabelą**            | w stanie końcowym to **widok** (`security_invoker=true`); w moim wykazie 250 żywych tabel nie ma jej ani przed, ani po                                                                                                                                                                                                                             |
| Przywrócenie pliku jest **szkodliwe**                   | stara migracja redefiniuje `club_anchor_label`, więc wpada w selektor `scripts/pg-harness` (`grep -lE 'public\.(club_\|admin_club_)'`); replay w tym podzbiorze wywala się na `relation "public.programs" does not exist`, bo harness klubów nie zna tabel modułu programów. Zmierzone: `check:pg-harness` **zrobił się czerwony** po przywróceniu |

**Czym naprawdę był czerwony `check:programs-harness`:** `run.sh:18` wskazywał
twardo na plik usunięty przy podmianie. Harness został **osierocony** — testował
migrację, której już nie ma, mimo że praca, którą sprawdza, jest w schemacie.
To awaria testu, nie schematu.

**Co zrobiłem zamiast przywracania:** przepiąłem harness na trzy migracje, które
faktycznie wykonują scalenie. Wynik: **38 asercji przechodzi** (27 strukturalnych,
7 RLS dla `anon`, 3 zapisu przez widok, 1 odmowy zapisu), `check:pg-harness`
zostaje zielony (369 asercji), `check:authz-snapshot` bez regeneracji.

**Dlaczego się pomyliłem — i co to mówi o metodzie.** Zbudowałem wniosek na
`git log` i na wykazie tabel, w którym zobaczyłem `programs` obok
`research_program_items/members/partners/projects`. Wyciągnąłem z tego „obie
rodziny żyją", **nie sprawdzając, czym jest sam `research_programs` w stanie
końcowym** — a jest widokiem. Tabele-dzieci noszą stary przedrostek w nazwie
i to mnie zmyliło: **nazwa relacji nie jest dowodem na jej rodzica.** Właściwym
sprawdzeniem było jedno zapytanie o `DROP TABLE`/`CREATE VIEW` na tej nazwie,
i zajęło mniej niż minutę, kiedy w końcu je zadałem.

Ustalenie, które **zostaje w mocy**: blokujący job CI przez ponad dobę wskazywał
na nieistniejący plik, a przy podmianie migracji nikt nie przepiął harnessu.
Zmienia się kaliber — z „skasowano naprawę" na „nie zaktualizowano testu przy
podmianie" — nie zmienia się wzorzec procesowy z §3.4.

---

## 1. Skala platformy — stan zmierzony

| Wymiar                                 |                                      Liczba | Zmiana od 14.08 |
| -------------------------------------- | ------------------------------------------: | --------------- |
| Trasy (`src/routes/*.tsx`)             | **244** (142 admin, 26 kluby, 76 pozostałe) | 0               |
| Trasy-endpointy (`src/routes/**/*.ts`) |                    55 (w tym 22 pod `api/`) | 0               |
| Komponenty `.tsx` (bez testów)         |                                       1 091 | +1              |
| Moduły `src/lib/**/*.ts` (bez testów)  |                                         968 | +29             |
| Hooki                                  |                                          35 | 0               |
| Pliki `*.functions.ts`                 |                                          82 | 0               |
| Wywołania `createServerFn`             |                                         343 | 0               |
| Moduły `*.server.ts`                   |                                          98 | 0               |
| Unikalne nazwy RPC wołane z klienta    |                       **383** (bramka: 382) | +2              |
| Migracje SQL                           |                     **779** (140 619 linii) | +10             |
| Tabele (stan końcowy)                  |                                     **250** | −1              |
| Funkcje SQL (ostatnia definicja)       |                                     **797** | +4              |
| `SECURITY DEFINER` / bez `search_path` |                                 **689 / 0** | +2 / 0          |
| Polityki RLS (stan końcowy)            |                                     **543** | 0               |
| Triggery / indeksy / widoki            |                              343 / 532 / 14 | +1 / +3 / +1    |
| Zadania `pg_cron`                      |                                      **17** | 0               |
| Testy pgTAP                            |                                    93 pliki | +2              |
| Pliki testowe vitest (w `src`)         |                                     **785** | +27             |
| Słowniki i18n (`src/lib/i18n-*.ts`)    |                                     **100** | **+13**         |
| Bramki `check:*`                       |                                      **33** | **+8**          |
| Workflow CI                            |                                           5 | 0               |
| **Kod produkcyjny**                    |                           **543 797 linii** | +3 878          |
| **Linie testów**                       |                                 **109 051** | **+7 942**      |

**Stosunek testów do produkcji: 0,187 → 0,201.** Pierwszy wzrost tej miary w serii.
Przyczyna jest arytmetyczna i warta zapisania: w tym oknie **testy urosły 2,05 raza
szybciej niż kod produkcyjny** (+7 942 vs +3 878 linii).

Osiem nowych bramek: `check:content-layering`, `check:editor-autosave`,
`check:gate-coverage`, `check:i18n-default-value`, `check:i18n-overlay-imports`,
`check:sql-policy-tenant-regression`, `check:unknown-casts`, `check:programs-harness`.
Żadna nie została usunięta. `check:gate-coverage` pilnuje, że **każda bramka jest
wpięta dokładnie raz na job** — i przechodzi na 33.

Uwaga o „zerach" w kolumnie zmian: brak ruchu na trasach, `createServerFn` i
`*.server.ts` **nie jest zastojem**. To okno nie dodało powierzchni produktowej —
w całości poszło w testy, warstwę językową, typy i bramki. Jedna nowa trasa
publiczna nie powstała; powstało 27 plików testowych.

---

## 2. Mapa modułów i połączeń — zmierzony graf importów

Graf zbudowany z faktycznych krawędzi `from "@/…"` w **2 523 plikach produkcyjnych**,
36 warstw: **438 unikalnych par warstw, 6 718 importów międzywarstwowych** z 8 454
importów `@/` ogółem.

### 2.1. Najsilniejsze zależności (warstwowo)

```
431  trasy admin        -> design system
234  kluby              -> design system
215  trasy publiczne    -> seo
203  builder            -> design system
197  komponenty (reszta)-> lib (wspólne)
178  admin (reszta)     -> design system
177  admin (reszta)     -> bloki
156  trasy kluby        -> kluby
146  trasy publiczne    -> design system
123  trasy admin        -> admin (reszta)
115  builder            -> lib (wspólne)
100  admin (reszta)     -> lib (wspólne)
 99  trasy publiczne    -> lib (wspólne)
 95  kluby              -> i18n (rdzeń)
 84  monetyzacja        -> design system
```

Kształt jest ten sam, co w poprzednim wydaniu i nadal zdrowy: **wszystko ciąży do
design systemu i do `lib`**, czyli do warstw bez własnej domeny. Nie ma modułu
domenowego, od którego zależy pół platformy.

### 2.2. R5 wykonana: cykl `bloki ↔ builder` przestał istnieć

To jest najważniejsza zmiana strukturalna tego okna i jedyna, którą widać w grafie:

| Krawędź            | `0fd4108` | `c6306e7` |
| ------------------ | --------: | --------: |
| `bloki -> builder` |        17 |     **0** |
| `builder -> bloki` |         8 |         8 |
| `bloki -> treść`   |         2 |    **19** |
| `builder -> treść` |         1 |    **42** |

Commit `ca96fde` („Rozstrzygnięto cykl bloki <-> builder warstwą lib/content-model")
zrobił **dokładnie to, co rekomendował poprzedni audyt**: wspólna warstwa modelu
treści zamiast wzajemnego importu. Kierunek jest teraz jednoznaczny:

```
content-model  ->  nie zna żadnego silnika ani tras
bloki          ->  nie importuje z buildera (zero wyjątków)
builder        ->  MOŻE importować z bloków (realnie je hostuje)
```

I — co ważniejsze od samego refaktoru — inwariant jest **przypięty bramką**
`check:content-layering`, która ma własny test jednostkowy
(`src/lib/ci/__tests__/contentLayering.test.ts`), a nie tylko przebieg w CI. Bramka
raportuje na tym HEAD: `bloki -> builder: 0 · content-model -> silniki: 0`.

**Cykl nie został „rozwiązany dokumentem". Został zmierzony, zamknięty i zablokowany.**

### 2.3. Sprzężenia dwukierunkowe — 89 → 87 par

Spadek o dwie pary. Największe sprzężenia są **strukturalne, nie domenowe**:
`builder ↔ design system` 203/1, `komponenty ↔ lib` 197/1, `builder ↔ lib` 115/18.
Stosunek w rodzaju 203/1 nie jest cyklem w sensie ryzyka — to jedna krawędź powrotna
przy dwustu w przód. Realne dwukierunkowe pary domenowe są małe:
`builder ↔ treść` 42/4, `komponenty ↔ builder` 16/25.

### 2.4. Naruszenia warstwowości — 24, bez zmian

Design system importuje z warstw domenowych **24 razy** (media 6, profil/konto 4,
mail 4, motyw 3, po 1: newsletter, monetyzacja, czat, realtime, builder, społeczność).
Liczba nie drgnęła od poprzedniego wydania. To jedyny wskaźnik strukturalny, który
w tym oknie **stoi** — i jedyny, którego żadna bramka nie pilnuje.

---

## 3. Stan bramek — CI jest CZERWONE na JEDNYM kroku (było na czterech)

Uruchomione w tej sesji na `c6306e7`, po `bun install` procedurą z `ci.yml`.

### 3.1. Kroki blokujące spoza `check:*`

| Krok CI                              |     Wynik      | Liczba                                               |
| ------------------------------------ | :------------: | ---------------------------------------------------- |
| `bun run format:check` (prettier)    | ✅ **zielony** | „All matched files use Prettier code style"          |
| `bun run typecheck` (`tsc --noEmit`) | ✅ **zielony** | **0 błędów**                                         |
| `bun run lint` (`eslint .`)          | ✅ **zielony** | **0 błędów**, 177 ostrzeżeń                          |
| `bun run build` (`vite build`)       | ✅ **zielony** | 679 plików JS klienta                                |
| `bun run test:coverage`              | ✅ **zielony** | **9 055 testów przeszło**, 50 pominiętych; 783 pliki |

Trzy z czterech czerwonych kroków poprzedniego wydania są zamknięte: 115 błędów
`prettier` → 0, żywa referencja do poprzedniego operatora płatności → bramka
`check:legacy-payment-refs` przechodzi na 3 566 plikach, bliźniaki migracji →
patrz §3.3.

Ostrzeżenia lintu (177) rozkładają się na dwie reguły: **143
`react-refresh/only-export-components`** i **34 `react-hooks/exhaustive-deps`**.
Żadna nie blokuje; obie są tego rodzaju, który rośnie po cichu, bo nikt na niego
nie patrzy.

**Pokrycie testami (v8, całe repo):**

| Miara      |  Zmierzone | Próg globalny |   Zapas |
| ---------- | ---------: | ------------: | ------: |
| Linie      | **34,59%** |            29 | 5,59 pp |
| Instrukcje |     33,99% |            29 | 4,99 pp |
| Gałęzie    |     29,57% |            25 | 4,57 pp |
| Funkcje    |     26,24% |            22 | 4,24 pp |

Do tego **progi per-plik** dla ścieżek krytycznych (m.in. `lib/access/gating.ts`
95/100/100/95, `lib/builder/schema.ts` 98/100/100/95, kilkanaście pozycji na 100%).
Bramka przechodzi w całości. Globalne 34,59% linii nie jest powodem do dumy, ale
**jest liczbą prawdziwą** — i po raz pierwszy rosnącą.

### 3.2. Bramki `check:*` — 31 zielonych, 1 czerwona, 1 niemierzalna

| Wynik                 | Bramki                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅ **31 zielonych**   | `authz-snapshot`, `careers-harness`, `chunk-parity`, `chunks`, `content-layering`, `db-row-casts`, `editor-autosave`, `entry-purity`, `gate-coverage`, `i18n-default-value`, `i18n-hardcoded`, `i18n-overlay-imports`, `i18n-parity`, `legacy-payment-refs`, `permissions-parity`, `pg-harness`, `programs-harness` (§3.4), `public-assets`, `rpc-contract`, `sql-anon-insert`, `sql-app-role`, `sql-emit-actor`, `sql-migration-replay`, `sql-owner-tenant-scope`, `sql-policy-tenant-regression`, `sql-tenant-scope`, `stale-never-casts`, `types-freshness`, `unknown-casts`, `widget-fidelity`, `workflow-env-contract` |
| ❌ **1 czerwona**     | **`bundle`** (§5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ⚠️ **1 niemierzalna** | `db-contract` — wymaga `SUPABASE_URL` i żywej bazy; w `ci.yml` stoi w jobie `post-deploy`, nie w `verify`. Nie przepisuję jej stanu z wczoraj.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

Wybrane liczby z przebiegów, bo bramka mówi więcej niż swój kolor:

- `check:sql-tenant-scope` — 839 funkcji zbadanych, 4 uzasadnione ścieżki publiczne
- `check:sql-app-role` — 972 literały `has_role`
- `check:sql-anon-insert` — 556 polityk w stanie końcowym, 8 tabel intake chronionych
- `check:rpc-contract` — 382 nazwy wołane z klienta ⇄ 798 funkcji w stanie końcowym
- `check:sql-owner-tenant-scope` — 153 polityki właściciela z 556; **0 pozycji znanego długu**
- `check:i18n-parity` — 36 plików, **536 testów**
- `check:widget-fidelity` — 3 pliki, **537 testów**
- `check:permissions-parity` — 4 pliki, 98 testów
- `check:pg-harness` — **369 asercji runtime**
- `check:entry-purity` — ścieżka bootowania: 7 chunków z 678, **czysta** (bez SDK płatności)

Dwie z nich domykają rzeczy, których poprzednie wydanie **nie umiało zmierzyć**:
`check:entry-purity` (wtedy: „nitro nie składa `.output/server` w tym kontenerze")
przeszedł tutaj realnie, a `check:i18n-default-value` (wtedy nieistniejąca) raportuje
**0 zapasowych tekstów przy `t()` w 2 495 plikach**.

### 3.3. Bliźniaki migracji: z czerwonego na zielone — ale ratchetem, nie usunięciem

Poprzednie wydanie miało `check:sql-migration-replay` na czerwono przez dwie
migracje rekrutacji wjeżdżające dwa razy. Dziś bramka jest **zielona**, a jej
komunikat brzmi:

```
✓ Inwariant odtwarzalności migracji OK (779 plików: zero kolizji wersji,
  zero niezabezpieczonych zapisów do storage.objects,
  43 znanych par bliźniaków treści (dług, lista może tylko maleć)).
```

Obie pary rekrutacji są na tej liście:

```
dług: 20260814100000_careers_tenant_scope.sql            ≡ 20260814122639_37dcf7c4….sql
dług: 20260814110000_careers_pipeline_and_cv_retention.sql ≡ 20260814123014_97f305de….sql
```

**To nie jest to samo, co usunięcie duplikatu.** Rekomendacja brzmiała „P0: usunąć
duplikaty, zostawić wersje z PR-a"; wykonano „wpisać obie na listę znanego długu".
Konstrukcja ratchetu jest uczciwa (lista może tylko maleć, więc nowy bliźniak nadal
zapali bramkę), a duplikat pozbawiony 27-linijkowego nagłówka **nadal siedzi w
repo** i nadal nie niesie zapisu, dlaczego izolacja pękała. Dług został **nazwany
i zamrożony**, nie spłacony. Przy 43 parach to jest właściwa kolejność — pod
warunkiem, że lista faktycznie maleje.

### 3.4. `check:programs-harness` — osierocony harness, naprawiony w tym audycie

Ta bramka była drugim czerwonym krokiem i wymagała korekty mojego ustalenia
(§0.4). Wersja ostateczna, odtworzona w całości i **zweryfikowana uruchomieniem**:

1. Commit `ab9b074` dodał `20260815100000_programs_single_table.sql` — **540 linii**
   ręcznego scalenia dwóch tabel programów. Powstał do niej dedykowany harness
   (`scripts/programs-harness/`), który **złapał realny błąd kolejności 23503**.
2. Scalenie zostało następnie **przepisane na łańcuch trzech migracji**:
   `20260815110437` (kolumna `status`) → `20260815110844` (właściwe scalenie:
   `program_merge_map`, przeniesienie wierszy, przepięcie czterech kluczy obcych,
   `DROP TABLE research_programs` + widok w jej miejsce) → `20260815111026`
   (`club_anchor_label` przepięty na `public.programs`).
3. Commit `207fdd9` o nazwie **„Changes"** skasował ręczną wersję —
   **słusznie**, bo była już zastąpiona.
4. **Nikt nie przepiął harnessu.** `run.sh:18` dalej wskazywał na skasowany plik,
   więc blokujący job CI failował na `FAIL migracja 20260815100000` — mimo że
   scalenie w schemacie **zaszło**.

**Stan schematu (zmierzony, nie wywnioskowany z nazw):** `research_programs` jest
w stanie końcowym **widokiem** (`security_invoker=true`) nad `public.programs`,
a nie tabelą. Cztery tabele-dzieci (`research_program_{items,members,partners,projects}`)
zachowały historyczny przedrostek w nazwie, ale ich `program_id` wskazuje na
`public.programs`. **Jedna rodzina tabel, nie dwie.**

**Naprawa wykonana w tym audycie:** harness przepięty na trzy migracje, które
faktycznie wykonują scalenie. Zmierzone po zmianie:

```
  OK   harness (stan sprzed scalenia)
  OK   seed (kolizja + tylko slownik + tylko hub + drugi najemca)
  OK   migracja 20260815110437 (kolumna status)
  OK   migracja 20260815110844 (scalenie)
  OK   migracja 20260815111026 (etykieta kotwicy)
  OK   asercje runtime
       asercje strukturalne: 27 OK · asercje RLS (anon): 7 OK
       asercje zapisu przez widok: 3 OK · asercje odmowy zapisu: 1 OK
programs-harness: OK
```

`check:pg-harness` zostaje zielony (369 asercji), `check:authz-snapshot` zgodny
bez regeneracji, `check:gate-coverage` nadal widzi 33 bramki wpięte po razie.

**Czego NIE należy robić — sprawdzone doświadczalnie.** Przywrócenie skasowanego
pliku (`git checkout ab9b074 -- …`) wygląda jak naprawa i **psuje inny job**:
stara migracja redefiniuje `club_anchor_label`, więc wpada w selektor treściowy
`scripts/pg-harness` (`grep -lE 'public\.(club_|admin_club_)'`), a ten podzbiór
nie zna tabel modułu programów — replay wywala się na
`relation "public.programs" does not exist`. Zmierzone: po przywróceniu
`check:pg-harness` **zrobił się czerwony**, a `check:authz-snapshot` wymagał
regeneracji (779 → 780 migracji, przy niezmienionych 839 funkcjach i 543
politykach — czysty licznik proweniencji, zero zmian uprawnień).

> **Wniosek procesowy, nie techniczny — i słabszy, niż pisałem pierwotnie.**
> To nie jest „skasowano naprawę". To jest **podmiana migracji bez aktualizacji
> testu, który ją pilnuje** — a więc dokładnie ten sam wzorzec, który poprzednie
> wydanie nazwało „bramki istnieją, są dobre i są omijane przy wdrożeniu", tylko
> od drugiej strony: bramka nie została ominięta, została **osierocona**.
> Sprzyjał temu opis zmiany: **32 z 96 commitów w tym oknie (33%) nosi nazwę
> „Changes" (30) albo „Lovable update" (2)** — komunikat, z którego nie da się
> odczytać ani zakresu, ani intencji. Gdyby commit `207fdd9` nazywał się
> „scalenie programów przepisane na łańcuch 110437/110844/111026 — kasuję wersję
> ręczną", przepięcie harnessu byłoby oczywistym następnym krokiem dla autora,
> a nie ustaleniem audytu dobę później.

---

## 4. Moduły — rozmiar, gęstość testów, powierzchnia serwerowa

Jeden skrypt puszczony na obu HEAD-ach (`scratchpad/modules.py`, jeden regex per
moduł, pierwszy trafiony wygrywa). Taksonomia jest moja i różni się od tabeli
z 14.08 — porównywalne są kolumny „linie prod" i „T/P" **między sobą**, nie z tamtym
dokumentem.

| Moduł                                                          | Linie prod |      Δ |       T/P | T/P 14.08 | Pliki serwerowe |
| -------------------------------------------------------------- | ---------: | -----: | --------: | --------: | --------------: |
| warstwy wspólne (design system, `routeTree.gen`, locale, http) |    115 542 | +1 571 |     0,123 |     0,124 |              31 |
| 3 bloki + builder                                              |    101 834 | −1 534 | **0,290** |     0,286 |               0 |
| 16 społeczność / kluby                                         |     59 217 |   +218 | **0,136** |     0,099 |               5 |
| 19 ustawienia / RODO                                           |     31 799 |   +542 |     0,076 |     0,069 |               6 |
| 11 newsletter                                                  |     27 287 |   +284 | **0,161** |     0,124 |              24 |
| 4 strony / wygląd / import                                     |     25 883 | +1 142 |     0,132 |     0,116 |               6 |
| 13 monetyzacja                                                 |     24 607 |   +325 | **0,362** |     0,320 |              52 |
| 15 profil / konto                                              |     20 308 |    +68 |     0,261 |     0,262 |               9 |
| 7 typy specjalne                                               |     17 281 |    −24 |     0,134 |     0,134 |               4 |
| 17 analityka / BI                                              |     12 822 |     +6 |     0,110 |     0,110 |               8 |
| 2 edytor                                                       |     12 569 |    +32 |     0,150 |     0,138 |               1 |
| 9 czat                                                         |     12 293 |    −36 |     0,111 |     0,111 |               0 |
| 14 kupony / darowizny / reklamy                                |     11 995 |    +58 |     0,158 |     0,158 |               1 |
| 18 CRM                                                         |     10 859 |   −121 | **0,149** |     0,083 |               5 |
| 20 platforma / SSR                                             |     10 504 | +1 710 |     0,502 |     0,491 |              12 |
| 8 SEO                                                          |      9 797 |   −166 |     0,395 |     0,385 |               7 |
| 6 wyszukiwarka                                                 |      8 366 |    −21 |     0,199 |     0,199 |               3 |
| 10 sieć / networking                                           |      8 230 |     +1 | **0,727** |     0,727 |               0 |
| 1 wpisy                                                        |      7 716 |    −93 |     0,118 |     0,117 |               1 |
| 12 realtime / powiadomienia                                    |      5 936 |   −128 |     0,294 |     0,287 |               4 |
| 21 rekrutacja                                                  |      5 543 |    +61 | **0,416** |     0,271 |               1 |
| 5 strona główna / archiwa                                      |      3 409 |    −17 |     0,160 |     0,157 |               0 |

### 4.1. Wnioski z tabeli

**Cztery moduły, które poprzedni audyt wskazał palcem, poprawiły się — i to one
odpowiadają za wzrost T/P całej platformy:**

| Moduł               | T/P 14.08 | T/P 15.08 | Co się stało                                    |
| ------------------- | --------: | --------: | ----------------------------------------------- |
| CRM                 |     0,083 | **0,149** | +79% gęstości, przy **spadku** kodu o 121 linii |
| kluby / społeczność |     0,099 | **0,136** | R2 z poprzedniego wydania                       |
| rekrutacja          |     0,271 | **0,416** | najmłodszy moduł, najszybszy przyrost testów    |
| newsletter          |     0,124 | **0,161** | R3 częściowo                                    |

**Trzy moduły nadal poniżej 0,15 przy dużej powierzchni:** `ustawienia/RODO` (0,076
na 31 799 liniach — najgorszy stosunek w repo przy tej skali), `wpisy` (0,118),
`czat` (0,111). Moduł `ustawienia/RODO` jest tym, w którym siedzi wielodostępność
i zgody — czyli miejsce, gdzie defekt kosztuje najwięcej.

**`bloki + builder` skurczył się o 1 534 linie** przy wzroście T/P — to skutek
refaktoru z §2.2, a nie usuwania funkcji: 101 typów bloków i rejestr widgetów stoją.

**`platforma/SSR` urosła o 1 710 linii** — to głównie nowe bramki i ich testy
jednostkowe (`src/lib/ci/*`), przy T/P 0,502.

### 4.2. Dziura funkcjonalna: 123 z 244 tras bez wzmianki w jakimkolwiek teście

Metoda: nazwa pliku trasy (i jej postać ze slashami) szukana w treści **wszystkich**
785 plików testowych `src` plus 7 plików `e2e`.

|                    | `0fd4108` | `c6306e7` |
| ------------------ | --------: | --------: |
| Trasy wzmiankowane |       119 |   **121** |
| Trasy bez wzmianki |       125 |   **123** |
| — z tego admin     |        92 |    **90** |

**50,4% tras nie pada w żadnym teście.** Ruch o dwie trasy w dobrą stronę przy
+27 plikach testowych oznacza, że testy tego okna poszły w **głębokość istniejących
ścieżek**, nie w szerokość pokrycia tras. To jest właściwy wybór przy naprawianiu
długu — ale nie zmniejsza tej dziury.

### 4.3. Ścieżki pieniężne — pierwszy realny ruch

| Obszar                    | Pliki prod | Pliki test |       T/P | T/P 14.08 |
| ------------------------- | ---------: | ---------: | --------: | --------: |
| checkout                  |         23 |         12 | **0,806** |     0,453 |
| stripe                    |          5 |          2 |     1,029 |     1,029 |
| metering                  |          2 |          1 |     0,507 |     0,507 |
| subscription              |          7 |          3 |     0,504 |     0,504 |
| entitlement               |          2 |          2 |     0,488 |     0,488 |
| billing                   |        112 |         39 |     0,394 |     0,401 |
| donation                  |         13 |          5 |     0,379 |     0,379 |
| gift                      |         13 |          4 |     0,246 |     0,246 |
| refund                    |          3 |          1 |     0,122 |     0,122 |
| **coupon**                |         13 |          2 | **0,044** |     0,048 |
| invoice (po nazwie pliku) |          2 |          0 |     0,000 |     0,000 |
| paywall (po nazwie pliku) |          3 |          0 |     0,000 |     0,000 |
| **Łącznie**               |            |            | **0,388** |     0,360 |

**Erozja z poprzedniego wydania została zatrzymana i odwrócona** — łączne T/P
ścieżek pieniężnych 0,360 → 0,388, a `checkout` niemal się podwoił (0,453 → 0,806)
dzięki czterem nowym plikom testowym tras checkoutu
(`checkoutPlanRoute`, `checkoutSuccessRoute`, `checkoutCancelRoute`,
`checkoutRoutesContract`). To jest **wykonana część R3** i zamknięcie zdania
„trzy trasy `checkout.*` bez wzmianki w jakimkolwiek teście, czternasty dzień".

Pomiar po **treści**, nie po nazwie pliku (porównywalny z wydaniem 14.08):
`paywall` — **48 plików produkcyjnych na 8 testowych** (14.08: 48/6),
`coupon` — 55/9, `entitlement` — 15/5, `invoice` — 40/13.

**`coupon` przy 0,044 jest najgorszą ścieżką pieniężną w repo** i jedyną, która
w tym oknie się pogorszyła.

---

## 5. Bundle — jedyny czerwony krok, który jest defektem produktu

| Miara                       |      Wartość |    Próg |                              Zapas |
| --------------------------- | -----------: | ------: | ---------------------------------: |
| **Największy chunk (gzip)** | **482,0 KB** | **471** | **−11,0 KB (przekroczony o 2,3%)** |
| PUBLIC (gzip)               |   2 519,4 KB |   2 535 |                    15,6 KB (0,62%) |
| OVERALL (gzip)              |   3 789,0 KB |   3 835 |                    46,0 KB (1,20%) |
| tylko admin (gzip)          |   1 269,7 KB |       — |               rozliczane w OVERALL |

Klient: **679 plików JS, 3 789,0 KB gzip łącznie.**

### 5.1. Próg został ZACIŚNIĘTY w tym oknie — i to jest dobra decyzja

Kronika w `scripts/check-bundle-size.ts` zapisuje ruch z 2026-08-15:
**chunk 513 → 471** (bo „przy 466,6 stara wartość dawała 10% luzu i przestała
łapać"), **public 2 505 → 2 535**, overall bez zmian.

To jest odwrotność tego, przed czym ostrzegał poprzedni audyt: próg poszedł **w
dół, za śladem pomiaru**, a nie w górę pod regresję. Bramka odzyskała czułość.

### 5.2. …i natychmiast złapała regresję

Zmierzone 466,6 KB przy ustawianiu progu 471. Dziś **482,0 KB**. Chunk wejściowy
urósł o **15,4 KB gzip** (surowo: 1 482 → 1 524 KB) po zaciśnięciu progu. Diagnoza
bramki wobec baseline'u `d255605`:

```
  +   17,5 KB  SeoPanel (NOWY)  (0.0 -> 17.5)
  +   15,2 KB  index  (570.0 -> 585.2)
  −    2,6 KB  admin.tracker
  −    2,4 KB  admin.posts._slug
  +    1,7 KB  admin.billing
```

Co **nie** jest przyczyną — sprawdzone, żeby nie powtórzyć błędu atrybucji
z poprzednich wydań:

- **Nie słowniki i18n.** Sonda na wartościach (nie kluczach): „Kluby dyskusyjne są
  dostępne po zalogowaniu" → **0 trafień** w `index-*`. Podział z R2 trzyma:
  **27 osobnych chunków `i18n-*`**, w tym `i18n-club` 36,6 KB, `i18n-builder`
  30,6 KB, `i18n-profile` 19,5 KB — wszystkie poza wejściem.
- **Nie rdzeń słownika.** `src/lib/locale/{pl,en}.ts` jest **bajtowo identyczny**
  z poprzednim HEAD-em (4 509 linii, 165 272 B). Cała praca i18n tego okna
  (+2 078 linii w 19 plikach) poszła w nakładki `src/lib/i18n-*.ts`, czyli w chunki
  ładowane osobno.
- **Nie `SeoPanel`.** Jest osobnym plikiem (59 667 B surowo), nie siedzi w wejściu.

**Czego nie zmierzyłem:** składu chunku wejściowego z dokładnością do modułu. Bramka
podaje dokładne narzędzie (`BUNDLE_INVENTORY=1 bun run build && bun run
report:chunk-inventory index`) — wymaga drugiego pełnego builda i nie zmieściłem go
w tej sesji. Zapisuję to jako **niezmierzone**, bo wskazanie winnego bez inwentarza
byłoby zgadywaniem; trzy hipotezy powyżej są **wykluczone pomiarem**, co zawęża
pole, ale nie zamyka sprawy.

### 5.3. Zapas na dwóch pozostałych budżetach nadal cienki

PUBLIC ma **0,62%** zapasu (15,6 KB), OVERALL **1,20%** (46,0 KB). Wniosek
z poprzedniego wydania stoi bez zmian: przy takim zapasie **następna regresja
zostanie przypisana przypadkowemu commitowi**, bo zmieści się w niej cokolwiek.

---

## 6. Dług, który da się policzyć

### 6.1. Warstwa językowa — R7 wykonana, i to hurtem

| Miara                                               | `0fd4108` | `c6306e7` |                  Δ |
| --------------------------------------------------- | --------: | --------: | -----------------: |
| `defaultValue:` w kodzie produkcyjnym (surowy grep) |     1 398 |        75 |         **−1 323** |
| **zapasowe teksty przy `t()` (bramka)**             |         — |     **0** | bramka trzyma zero |
| ternary `isPl ? …`                                  |       155 |    **26** |               −129 |
| ternary `lang === "pl" ? …`                         |       844 |   **681** |               −163 |
| słowniki i18n                                       |        87 |   **100** |                +13 |

Commit `516e94a` („i18n: 1398 -> 0 zapasowych tekstów przy t() + bramka trzymająca
zero") plus cztery commity `i18n(cz. 1–4)`. Bramka `check:i18n-default-value`
raportuje na tym HEAD: **0 zapasowych tekstów w 2 495 plikach, 53 przepuszczenia
wartości runtime'owej świadomie dozwolone**.

Rozjazd między moim gołym grepem (75) a bramką (0) jest **różnicą definicji, nie
sprzecznością**: grep łapie każde `defaultValue:` — także prop React Hook Form
i dozwolone `t(\`…${code}\`, { defaultValue: code })`, gdzie zapas nie niesie tekstu
dla użytkownika. Autorytatywna jest liczba bramki, bo to ona definiuje dług.

Uzasadnienie w `src/lib/ci/i18nDefaultValue.ts` jest warte zacytowania jako wzorzec:
warunek usunięcia nie brzmiał „wygląda na zbędny", tylko **„klucz ma liść tekstowy
w PL i w EN"** — wtedy `defaultValue` jest gałęzią nieosiągalną i jego zniknięcie
nie może zmienić ani jednego wyrenderowanego znaku. Miejsca, gdzie warunek nie
zachodzi, zostały **nietknięte** i wychodzą w raporcie jako `load-bearing`, czyli
realny brak w słowniku.

Zostało **681 ternariów po języku** — to jest największa pozostała pozycja tego długu
i jedyna droga do trzeciego języka.

### 6.2. Typowanie — R8 wykonana

| Miara                                 | `0fd4108` |                     `c6306e7` |
| ------------------------------------- | --------: | ----------------------------: |
| `as unknown as` w kodzie produkcyjnym |       359 |                       **257** |
| ratchet bramki `check:unknown-casts`  |         — | **201 znanych w 129 plikach** |
| `@ts-ignore` / `@ts-expect-error`     |         2 |                             2 |
| adnotacje `: any`                     |         5 |                             5 |
| wyjątki `check:db-row-casts`          |         — |   22 (lista może tylko maleć) |
| baseline `check:types-freshness`      |         — |         26 kolumn poza typami |

Trzy commity: `ce51372` (wspólny builder zapytań Supabase — 71 rzutowań w CRM do 2),
`0b3ee3c` (35 ręcznych rzutowań na `Json` → `toJson()`), `8c1b227` (`toJsonArray` +
generyk — 193 rzutowania). Każdy z ratchetem.

`tsconfig.json` trzyma `strict: true`, `noUnusedLocals: true`,
`noUnusedParameters: true` — **bez regresji**, a `tsc --noEmit` daje 0 błędów, więc
martwy kod nadal wynosi 0.

### 6.3. Bezpieczeństwo bazy — najmocniejszy wynik tego audytu

Zmierzone własnym parserem stanu końcowego na 779 migracjach:

| Miara                                 | Wynik                                      |
| ------------------------------------- | ------------------------------------------ |
| Tabele żywe                           | **250**                                    |
| Tabele z włączonym RLS                | **250 z 250 (100%)**                       |
| Tabele bez deklaracji RLS             | **0**                                      |
| Tabele z `DISABLE ROW LEVEL SECURITY` | **0**                                      |
| Polityki na tabelach bez RLS (martwe) | **0**                                      |
| Tabele bez ani jednej polityki        | 40 — **wszystkie 40 mają RLS włączony**    |
| Funkcje `SECURITY DEFINER`            | 689                                        |
| …bez przypiętego `search_path`        | **0** (21 przypina przez `ALTER FUNCTION`) |

Czterdzieści tabel bez polityk **nie jest luką** — to konstrukcja domknięta:
RLS włączony przy zerze polityk znaczy **deny-all** dla ról nieuprzywilejowanych,
więc dostęp idzie wyłącznie przez funkcje `SECURITY DEFINER`. Sprawdzone na
`club_posts`: `ENABLE ROW LEVEL SECURITY` stoi, `GRANT SELECT, INSERT, UPDATE,
DELETE … TO authenticated` też — i RLS ten grant unieważnia. **Trzydzieści jeden**
z tych czterdziestu tabel to `club_*`; pozostałe dziewięć to kolejka pocztowa
(`email_send_log`, `email_send_state`, `email_unsubscribe_tokens`,
`suppressed_emails`), stan runnera (`job_runner_runs`, `profile_view_alert_state`),
`profile_embeddings`, `connection_suggestion_dismissals`
i `tenant_host_assertion_keys` — wszystkie obsługiwane wyłącznie serwerowo.

Osiemdziesiąt tabel ma `GRANT` dla `anon` — wszystkie pod RLS.

**Nie znalazłem ani jednej tabeli, do której dałoby się dostać z pominięciem RLS.**

### 6.4. Dostępność — bez ruchu

| Sygnał                     | `0fd4108` | `c6306e7` |
| -------------------------- | --------: | --------: |
| atrybuty `aria-*`          |     2 619 |     2 618 |
| `role="…"`                 |       441 |       441 |
| `alt=` / `<img`            | 297 / 209 | 297 / 209 |
| `sr-only`                  |       106 |       106 |
| `<div onClick>` (bez roli) |         2 |         2 |

To okno **nie dotknęło dostępności**. Zapisuję jako fakt, nie jako zarzut: przy
pracy skoncentrowanej na warstwie językowej i typach brak ruchu tutaj jest spójny.

---

## 7. Rekomendacje — uszeregowane po iloczynie ryzyka i kosztu

### R1. Zmierzyć skład chunku wejściowego — nie podnosić progu (ryzyko: wydajność)

**Jedyny czerwony krok CI po naprawie z §3.4.** Bramka przekroczona o 11,0 KB,
próg świeżo zaciśnięty (513 → 471) i **czuły — to jest stan pożądany, nie problem
do obejścia**. Trzy hipotezy (słowniki i18n, rdzeń `locale`, `SeoPanel`) są
**wykluczone pomiarem** w §5.2, więc inwentarz zawęzi się szybko:

```
BUNDLE_INVENTORY=1 bun run build && bun run report:chunk-inventory index
```

Skrypt sam pisze, że podniesienie progu jest ostatecznością. Przy 0,62% zapasu na
PUBLIC następna regresja i tak trafi w losowy commit.

### R2. Opisowe komunikaty commitów (koszt: konwencja, ryzyko: zero)

To jest rekomendacja wyprowadzona wprost z §3.4 — i jedyna, która w tym oknie
kosztowała realny czas. **32 z 96 commitów (33%) nosi nazwę „Changes" (30) albo
„Lovable update" (2).** Jeden z nich skasował 540-liniową migrację. Kasacja była
**słuszna** (migracja była już zastąpiona łańcuchem trzech innych), ale z komunikatu
nie dało się tego odczytać — więc harness, który tę migrację testował, został
osierocony i przez dobę trzymał blokujący job CI na czerwono.

Wniosek nie brzmi „nie kasujcie". Brzmi: **zmiana, której nie da się zrozumieć
z komunikatu, kosztuje tyle, ile trwa jej odtworzenie z drugiej strony** — tutaj
było to uruchomienie migracji na żywym Postgresie i porównanie stanu końcowego
schematu. Minimum: komunikat, który mówi, **co zastępuje co**.

### R3. `coupon` — 0,044 to najgorsza ścieżka pieniężna w repo (ryzyko: pieniądze)

13 plików produkcyjnych na 2 testowe, i jedyny obszar pieniężny, który w tym oknie
**spadł** (0,048 → 0,044). Kupony B2B mają własne kampanie, wykupienia i limity —
czyli dokładnie tę klasę logiki, w której błąd jest cichy i kosztowny. Wzorzec
do skopiowania jest w tym samym oknie: cztery pliki testowe tras checkoutu podniosły
`checkout` z 0,453 na 0,806.

### R4. `ustawienia/RODO` — 0,076 na 31 799 liniach (ryzyko: prawne)

Najgorszy stosunek testów do kodu w repo przy tej skali, w module, w którym siedzą
wielodostępność, zgody i dane osobowe. Warstwa SQL jest tu wzorowa (§6.3); warstwa
aplikacyjna nie ma dowodu.

### R5. Zdjąć 43 pary bliźniaków migracji z listy długu

Ratchet działa i lista może tylko maleć — ale w tym oknie **nie zmalała**. Dwie pary
rekrutacji weszły na nią zamiast zostać usunięte (§3.3). Duplikat pozbawiony
nagłówka to zgubiony zapis przyczyny, a nie tylko powtórzony DDL.

### R6. Dokończyć warstwę językową: 681 ternariów po języku

`defaultValue` spadło z 1 398 na 0, `isPl ?` ze 155 na 26. Zostało **681
`lang === "pl" ? …`** — ostatnia pozycja, która trzyma tekst w kodzie zamiast
w słowniku, i jedyna realna przeszkoda przed trzecim językiem. Droga jest
przetarta i obudowana bramkami.

### R7. 24 importy z design systemu do warstw domenowych

Jedyny wskaźnik strukturalny, który nie drgnął od poprzedniego wydania, i jedyny bez
bramki. Wzorzec do skopiowania powstał w tym samym oknie: `check:content-layering`
zamknął cykl `bloki ↔ builder` i pilnuje kierunku (§2.2).

### R8. 177 ostrzeżeń lintu

143 `react-refresh/only-export-components` + 34 `react-hooks/exhaustive-deps`.
Nie blokują, więc rosną. Drugie z nich to klasa realnych błędów (zależności hooków),
nie kosmetyka.

---

## 8. Co ta platforma robi dobrze

Lista jest krótsza niż lista rekomendacji, bo rekomendacje są celem dokumentu —
nie dlatego, że jest krótsza w rzeczywistości.

1. **Bramki są pisane razem z kodem, który mają pilnować.** Osiem nowych bramek
   w jednym oknie, a `check:gate-coverage` dowodzi, że każda z 33 jest wpięta
   dokładnie raz na job. `check:content-layering` i `check:editor-autosave` mają
   **własne testy jednostkowe**, więc bramka nie jest skryptem, któremu trzeba wierzyć.
2. **Uzasadnienia żyją w kodzie, nie w dokumentach.** Nagłówek
   `src/lib/ci/i18nDefaultValue.ts` zapisuje warunek bezpieczeństwa usunięcia
   i **kontrargument, który przegrał**. Migracja `20260815090000` zaczyna się od
   akapitu „co było zepsute", z odwołaniem do wydania audytu i numeru modułu.
   Komentarz do indeksu `nl_campaign_events_subscriber_day_uq` tłumaczy, dlaczego
   jest częściowy.
3. **RLS bez wyjątków.** 250 z 250 tabel, zero funkcji `SECURITY DEFINER` bez
   przypiętego `search_path`, zero martwych polityk (§6.3).
4. **Rekomendacje audytu są wykonywane zaleconą drogą.** R2, R5, R7 i R8 zamknięte
   pomiarem w jednym oknie — a każda przypięta bramką, więc nie da się jej cofnąć
   po cichu. Dwa razy z rzędu w tej serii.
5. **Progi są zaciskane za śladem pomiaru.** `chunk 513 → 471`, bo stara wartość
   „przestała łapać". To jest odwrotność obchodzenia bramki.
6. **Defekty zgłoszone przez audyt są naprawiane u źródła, nie maskowane.** FTS
   czatu dostał słownik z fleksją zamiast poprawionego komentarza; import WP dostał
   wspólny moduł scalania dla obu stacków; zdarzenia newslettera dostały indeks
   unikalny z deduplikacją danych zastanych.

---

## 9. Metoda — żeby ten audyt dał się powtórzyć

Każda liczba pochodzi z komendy uruchomionej na `c6306e7`. Rzeczy warte zapisania
jako metoda:

- **Środowisko trzeba odtworzyć procedurą z CI.** Prywatne lustro npm
  (`europe-west*-npm.pkg.dev`) jest w tym kontenerze nieosiągalne. Właściwe
  rozwiązanie stoi w `ci.yml`: `sed` przepinający `bun.lock` na
  `registry.npmjs.org`, który zachowuje **przypięte wersje** i zmienia tylko host.
  Po tym: 895 pakietów, `tsc` 0 błędów. Edycja `bun.lock` jest **wycofana przed
  commitem** — tak jak w CI, gdzie nigdy nie jedzie w commicie.
- **Parser SQL nie może być regexem.** §0.1: naiwne czyszczenie komentarzy skasowało
  65% migracji, bo `/*` bywa w literale. Lekser respektujący `$tag$`, `''` i
  zagnieżdżone `/* */` daje liczby zgodne z bramkami repo (moje 543 polityki wobec
  „556 w stanie końcowym" z `check:sql-anon-insert` — różnica to polityki liczone
  per tabela+nazwa).
- **Stan końcowy liczy się w kolejności, nie zbiorami.** Wzorzec
  `DROP … IF EXISTS; CREATE …` jest w tych migracjach masowy. Odjęcie zbioru DROP od
  zbioru CREATE dawało 127 tabel zamiast 250 — czyli kasowało połowę schematu, która
  żyje.
- **Alarm z narzędzia trzeba sprawdzić ręcznie, zanim trafi do tabeli.** §0.2:
  cztery funkcje „bez `search_path`" miały go przypiętego osobnym `ALTER FUNCTION`.
  Publikacja tej liczby byłaby zmyślonym defektem bezpieczeństwa.
- **Bramkę, której nie da się uruchomić, trzeba oznaczyć jako niezmierzoną.**
  `check:db-contract` wymaga żywej bazy (jest w jobie `post-deploy`), a job `pgtap`
  wymaga rozszerzenia `pgtap`, którego nie ma w tym obrazie
  (`extension "pgtap" is not available`). Obie są **niezmierzone**, nie „zielone jak
  wczoraj". Za to trzy harnessy postgresowe **dały się uruchomić** i dwa przeszły
  (369 asercji w `pg-harness`, komplet w `careers-harness`), a trzeci pokazał realną
  awarię z §3.4 — czego lektura kodu by nie pokazała.
- **Nazwa relacji nie jest dowodem na jej rodzaj ani na jej rodzica.** §0.4: wykaz
  żywych tabel pokazał `programs` obok `research_program_items/members/partners/
projects` i wyprowadziłem z tego „obie rodziny tabel żyją". `research_programs`
  jest w stanie końcowym **widokiem**, a dzieci tylko zachowały historyczny
  przedrostek. Jedno zapytanie o `DROP TABLE`/`CREATE VIEW` na tej nazwie
  rozstrzygało sprawę i zajęło mniej niż minutę — zadane po fakcie.
- **„Czerwona bramka" i „zepsuty produkt" to dwa różne ustalenia.** Osierocony
  harness (§3.4) daje ten sam kolor w CI, co realna regresja schematu, i wymaga
  zupełnie innej naprawy. Rozstrzyga to dopiero **uruchomienie migracji na żywym
  Postgresie i porównanie stanu końcowego**, nie lektura `git log`.
- **Naprawę, która „wygląda oczywiście", trzeba zmierzyć jak każdą inną.**
  Przywrócenie skasowanego pliku wyglądało na jednokomendową naprawę, a zapaliło
  `check:pg-harness` — bo migracja wpada w treściowy selektor cudzego harnessu.
  Bez uruchomienia obu harnessów wypchnąłbym regresję pod hasłem naprawy.
- **Tabelę porównawczą trzeba liczyć tym samym skryptem na obu HEAD-ach.** Wszystkie
  kolumny „14.08" w §4 i §4.3 pochodzą z moich skryptów puszczonych na worktree
  `0fd4108`, nie z przepisania tamtego dokumentu — taksonomie modułów się różnią
  i porównanie byłoby fikcją.
- **Sondowanie bundla robi się na WARTOŚCIACH, nie na kluczach** (zasada przejęta
  z poprzednich wydań, potwierdzona w §5.2) — i służy do **wykluczania** hipotez.
  Wykluczenie trzech przyczyn nie jest wskazaniem czwartej; inwentarz chunku
  pozostaje niezmierzony i jest tak oznaczony.

---

_Dokument towarzyszy `docs/OCENA_FUNKCJI_TABELE_2026-08-14.md` (oceny poglądowe
funkcja po funkcji) i kontynuuje serię `AUDYT_PLATFORMY_MODULY_FUNKCJE_*`._
