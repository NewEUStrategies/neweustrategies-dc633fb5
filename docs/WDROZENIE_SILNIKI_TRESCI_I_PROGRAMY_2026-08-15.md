# Wdrożenie: rozstrzygnięcie `bloki ↔ builder` + cztery pozycje domknięte

_15.08.2026 · odpowiedź na `AUDYT_PLATFORMY_MODULY_FUNKCJE_2026-08-14.md` (R5, R6)
i `OCENA_FUNKCJI_TABELE_2026-08-14.md` (§Programy, §Moduł 9, §Wydmuszki)_

---

## 0. Co zostało zrobione

| #   | Pozycja                                                           | Wydań w audycie | Stan po tej zmianie                               |
| --- | ----------------------------------------------------------------- | :-------------: | ------------------------------------------------- |
| 1   | `bloki ↔ builder` **28 / 16** - jedyny realny cykl, rósł od 30.07 |        6        | **bloki → builder: 0**, kierunek pilnowany bramką |
| 2   | `ClubEnumSelect` pod adminem, a używany publicznie (R6)           |        2        | przeniesiony do `components/clubs/molecules`      |
| 3   | Dwie równoległe tabele programów                                  |        7        | **jedna tabela**, druga nazwa to widok zgodności  |
| 4   | FTS czatu na `simple` wbrew komentarzowi o fleksji                |        7        | konfiguracja `public.nes_polish` po obu stronach  |
| 5   | Prerender = 0                                                     |        3        | zestaw wrócił tam, gdzie jest konsumowany         |

Trzy nowe bramki CI: `check:content-layering`, `check:programs-harness`
oraz (pośrednio) rozszerzony zakres `check:rpc-contract`, który złapał realny
defekt w trakcie tej pracy.

---

## 1. `bloki ↔ builder`: warstwa `lib/content-model`

### Przyczyna, nie objaw

Cykl nie brał się z tego, że ktoś napisał zły import. Brał się z tego, że
**żaden z dwóch silników treści nie był „niżej"**, więc każdy nowy widget
dokładał krawędź w tę stronę, w którą akurat było wygodniej. Skrajny przykład:
`lib/blocks/wordPaste.ts` importował `toJson` z buildera **nie dlatego, że
potrzebował buildera**, tylko dlatego, że tam stała jedyna kopia escape-hatcha
do JSON-a. Typ `Json` był zdefiniowany dwa razy, identycznym kształtem
strukturalnym, więc TypeScript godził go po strukturze i rozjazd nigdy nie
zapalał błędu.

Dlatego liczba rosła (13.08: 23/17 → 14.08: 28/16) mimo dwóch rekomendacji.

### Rozstrzygnięcie

```
                content-model          <- prymitywy modelu treści
                 ^          ^             (nie zna ŻADNEGO silnika)
                 |          |
              bloki  <---  builder     <- jeden jawny, dozwolony kierunek
                 ^          ^
                 └── wp-import ────────┘  <- adapter NAD oboma silnikami
```

`src/lib/content-model/` (opis: `src/lib/content-model/README.md`):

| plik                                   | co zawiera                                    | skąd                             |
| -------------------------------------- | --------------------------------------------- | -------------------------------- |
| `json.ts`                              | `Json`, `toJson`, `newId`, `newBlockId`       | **nowy** - scala dwie kopie      |
| `contentValue.ts`                      | koercja swobodnego JSON-a treści              | `lib/builder/`                   |
| `editorCanvas.tsx`                     | znacznik „render w kanwie edytora" + tryb     | `lib/builder/modeContext`        |
| `postContext.tsx`                      | kontekst wpisu/archiwum + próbka builder-only | `lib/builder/currentPostContext` |
| `formFields.ts`, `authFormSettings.ts` | model pól formularza                          | `lib/builder/`                   |
| `profileCardStyle.ts`                  | styl karty profilu autora                     | `lib/builder/`                   |

Dodatkowo:

- **`convert.ts` + `elementor.ts` → `lib/wp-import/`.** Te moduły **czytają**
  blokami, ale **produkują dokument buildera**, a ich jedynymi konsumentami są
  `wp-import/buildPage.ts` i `wp-import.functions.ts`. Trzymane pod
  `lib/blocks/` były krawędzią cyklu **fałszywą**: import wynikał z miejsca
  pliku, nie z zależności silnika bloków od buildera.
- **`RenderErrorBoundary` → `components/error/`.** Używają go oba silniki
  (widgety, bloki, sekcje strumieniowane w SSR); mieszkał w drzewie buildera.
  Etykieta telemetrii (`builder_render_boundary`) **zostaje bez zmian** -
  ciągłość serii pomiarowej jest warta więcej niż zgodność nazwy ze ścieżką.

### Dlaczego bez barrela

`lib/builder/types.ts` i `lib/blocks/types.ts` lądują w chunku wejściowym
**i** w skryptach CI. Barrel wciągnąłby tam Reacta z `postContext.tsx`
i rozjechał `check:bundle` przy zapasie 0,76% / 0,93%. Importy są głębokie
(`@/lib/content-model/json`), a oba `types.ts` **re-eksportują** prymitywy,
więc żaden istniejący import nie musiał się zmienić.

### Pomiar

| kierunek        | 14.08 |                  po zmianie |
| --------------- | ----: | --------------------------: |
| bloki → builder |    28 |                       **0** |
| builder → bloki |    16 | 18 (bez zmian co do natury) |

Pozostałe 18 krawędzi to **realne hostowanie**: widget `rich-text` renderuje
dokument bloków (`RichTextView` → `BlocksRenderer`), panel właściwości montuje
edytor bloków (`RichTextEditor` → `PostBlockEditor`), a widget formularza
używa widoków bloków (`AuthFormBlocks`, `ContactFormView`).

### Bramka

`bun run check:content-layering` (`src/lib/ci/contentLayering.ts` + 15 testów
jednostkowych). Trzy reguły: `content-model` nie zna silników ani tras;
`blocks` nie importuje z `builder`; `builder` **może** importować z `blocks`.

Bez bramki decyzja przetrwałaby do pierwszego widgetu, któremu wygodniej
byłoby w drugą stronę - **dokładnie tak, jak przez poprzednie sześć wydań**.

### Zostaje do zrobienia

`AdminColorPicker` (19 importerów!) i `AdminDatePicker` mieszkają pod
`components/admin/blocks/`, choć nie mają nic wspólnego z blokami - to
generyczne kontrolki panelu. Nie ruszone **świadomie**: importują namespace
i18n `admin-blocks`, więc przeniesienie pociąga migrację przestrzeni nazw
tłumaczeń, a tej nie da się w tej sesji zweryfikować bramką
`check:i18n-parity`. Cykl jest już zerwany, więc to nie blokuje niczego.

---

## 2. `ClubEnumSelect` (R6, druga próba)

Komponent obsługuje **obie** powierzchnie: siedem organizmów panelu i trzy
trasy publiczne (`club.$clubSlug.{about,members,new}`), a mieszkał pod
`components/admin/clubs/molecules/`. Po przeniesieniu jedynymi importami
publicznymi z drzewa admina są dwa widoki **składane builderem**
(`index.tsx`, `checkout.success.tsx`) - czyli zamierzone.

Koszt niewykonania był zerowy bundlowo (komponent jest liściem) i rósł
wyłącznie jako ryzyko: **jedna** dopisana tu zależność, która liściem nie
jest, i publiczny chunk pociąga kawałek panelu administracyjnego.

---

## 3. Jedna tabela programów

### Co było

Od 13/14.07 dwie tabele opisywały ten sam byt:

- **`public.programs`** - słownik przynależności (`kind`, `is_active`),
  cel **czterech kluczy obcych** z tabel treści i **~10 funkcji
  `SECURITY DEFINER`** huba eksperta;
- **`public.research_programs`** - hub redakcyjny (`status`, `tagline`,
  `scope`, `research_questions`, `icon`, `accent_color`), z czterema własnymi
  tabelami-dziećmi, publicznym `/programs`, RSS i sitemapą.

Ten sam program badawczy istniał jako **dwa wiersze w dwóch tabelach**,
z osobnym cyklem życia. Nie było sposobu, żeby powiedzieć, który jest prawdziwy.

### Kierunek scalenia i dlaczego ten

Zostaje **`public.programs`**, `research_programs` staje się **widokiem**.
Wybór podyktowany masą zależności:

1. widok **nie może być celem klucza obcego** - odwrotny kierunek wymagałby
   przepięcia FK na `posts` / `podcasts` / `events`;
2. `programs` czyta ~10 funkcji `SECURITY DEFINER` - odwrotny kierunek to
   przepisanie ich wszystkich, czyli **zmiana granicy bezpieczeństwa przy
   okazji porządków w słowniku**. Najgorszy możliwy moment na taką zmianę;
3. `research_programs` czytają wyłącznie `SELECT`-y plus CRUD panelu -
   a widok automatycznie aktualizowalny obsługuje jedno i drugie **bez zmiany
   ani jednej linii klienta**.

**Identyfikatory są zachowane.** Wiersze huba wjeżdżają do `programs` ze swoim
`id`, więc kotwice wątków klubowych (`club_threads.anchor_id` to `text`, bez
FK), zapisane filtry i linki w treści działają dalej. Remap dotyczy wyłącznie
programów istniejących w obu tabelach pod tym samym slugiem - czyli dokładnie
tej pary, którą scalamy świadomie.

### Dwie dziury domknięte przy okazji

1. **`programs public read` nie filtrował po statusie** (bo statusu nie było),
   więc anon czytał programy `is_active = false`. Bez tej poprawki widok
   wypuściłby **szkice** hubów redakcyjnych, których stara polityka
   `research_programs` pilnowała.
2. **`program_members public read` stało na `USING (true)`** - bez tenanta.
   Członkostwo w programie było widoczne **między najemcami**.

Widok ma `security_invoker = true`. Bez tego działałby z uprawnieniami
właściciela i **omijał RLS tabeli bazowej** - zamiast domknąć izolację,
otworzyłby ją na oścież. Harness to sprawdza jawnie.

### Harness złapał realny błąd

Pierwsza wersja migracji przepisywała `program_id` w tabelach-dzieciach,
a dopiero potem zdejmowała stary klucz obcy:

```
ERROR: insert or update on table "research_program_members" violates
       foreign key constraint "research_program_members_program_id_fkey"
DETAIL: Key (program_id)=(e0000000-…-0001) is not present in table "research_programs".
```

W tekście migracji ta wersja wyglądała poprawnie i przeszłaby **każdą** bramkę
statyczną. Wywaliłaby się przy `supabase db push` **w połowie**, po
`ALTER TABLE`, które już się wykonały.

`check:rpc-contract` złapała drugi: `club_anchor_label` i `get_program_members`
celowały w relację zmieniającą naturę. Ciała plpgsql/sql **nie są walidowane
przy `CREATE FUNCTION`** - taki rozjazd widzi dopiero użytkownik.

### Bramka

`bun run check:programs-harness` - 27 asercji strukturalnych + 7 RLS na
prawdziwym PostgreSQL-u, na danych obejmujących kolizję slugów, program
wyłącznie słownikowy, hub bez odpowiednika i **drugiego najemcę** (bez niego
test izolacji mierzyłby fikcję - nie byłoby czego nie zobaczyć).

---

## 4. FTS czatu: słownik z fleksją

Migracja z 20.07 deklarowała w nagłówku FTS „z polską fleksją", po czym
budowała wektor i podświetlenie w `simple`. „polityki" nie znajdowało
„polityka" - a komentarz twierdził, że znajduje. **To gorsze niż brak
funkcji**, bo czytający kod nie ma powodu jej sprawdzać.

Rozstrzygnięcie nie było nowe: moduł Discussion Club wprowadził
`public.nes_polish` 7.08 i nazwał ten dług wprost - _„FTS w konfiguracji
public.nes_polish … nie powielamy dlugu czatu"_ (`20260808093000:168`).

Po zmianie **wektor, zapytanie i `ts_headline` idą przez jedną konfigurację**.
Nowy `nes_polish_tsquery` buduje zapytanie z **lematów z prefiksem**, bo czat
to szukanie w trakcie pisania: `websearch_to_tsquery` (którego używa klub) nie
robi prefiksów, więc wpisane „poli" nie trafiałoby w nic.

**Symetria jest warunkiem poprawności, nie ozdobą.** Stemowany wektor
z niestemowanym zapytaniem byłby **gorszy** niż dzisiejszy `simple`: prefiks
`polityki:*` nie trafiłby w krótszy lemat `polityk`.

Zweryfikowane na PostgreSQL 16 - migracja w całości, trigger, tombstone, RPC
end-to-end, odporność na wstrzyknięcie w `tsquery`. Własność symetrii
sprawdzona osobno na konfiguracji stemującej:

| zapytanie                                 | symetrycznie (stem + prefiks) | `simple` + prefiks |
| ----------------------------------------- | :---------------------------: | :----------------: |
| `negotiation` → dokument z „negotiations" |             **1**             |         0          |
| `running` → dokument z „Running"          |             **1**             |         0          |

Backfill jest **pełny**, nie tylko `search_vector IS NULL`: wiersze zapisane
od 20.07 mają lematy z `simple` i bez przeliczenia cała historia rozmów
zniknęłaby z wyszukiwarki w chwili wdrożenia.

---

## 5. Prerender

Zestaw był usunięty z uzasadnieniem: _„AppLink przechwytuje nawigacje, więc
prerenderowany dokument nie byłby konsumowany"_.

**To uzasadnienie jest prawdziwe, ale niepełne** - i różnica ma znaczenie.
Obowiązuje dla chromu, menu i widgetów, bo tam anchor powstaje jako
`<AppLink>`. **Nie obowiązuje dla treści artykułu**: prose wchodzi przez
`dangerouslySetInnerHTML`, więc linki w tekście to **surowe `<a href="/…">`**,
a w repo nie ma delegowanego handlera klików. Klik w odsyłacz w akapicie
**jest** nawigacją dokumentową - dokładnie tym przypadkiem, w którym prerender
zostaje skonsumowany. Na serwisie treściowym to najczęściej klikana klasa
linków w całym produkcie.

Zestaw wraca zawężony do `.single-post-content a`, z tą samą listą wykluczeń
co prefetch, bez `[target]` i `[download]`.

**Warunkiem wstępnym była trzecia osłona `afterPrerendering`.** Ekspozycja
testu A/B (`ExperimentSection` w `BuilderRenderer`) odpalała się na mount bez
guardu, więc najazd kursora na link w treści podbijałby **mianownik**
współczynnika konwersji - zaniżając wynik eksperymentu tym mocniej, im lepiej
działa prefetch. Osłonięte są teraz wszystkie trzy beacony: licznik odsłon,
RUM i ekspozycja A/B.

---

## 6. Czego ta zmiana NIE zweryfikowała

Uczciwie, bo audyt tej serii karze za przepisywanie progu zamiast uruchomienia
bramki:

- **`tsc --noEmit`, `vitest`, `eslint` nie zostały uruchomione.** Prywatne
  lustro npm jest w tym kontenerze zablokowane polityką egress, a repoint
  `bun.lock` na `registry.npmjs.org` (procedura z `ci.yml:55`) był w tej sesji
  niedostępny. Zamiast tego: własny weryfikator rozwiązywalności **wszystkich**
  importów i eksportów w `src` (3 279 plików - zero nierozwiązanych ścieżek
  i zero brakujących eksportów poza artefaktami parsera), `prettier --check`
  na wszystkich zmienionych plikach oraz **11 bramek `check:*`** uruchomionych
  realnie (patrz niżej).
- **`check:db-contract`** wymaga klucza Supabase - to bramka po wdrożeniu.
- **Testy jednostkowe nowych modułów napisane, ale nieuruchomione** przez
  `vitest`. Logika obu (`contentLayering`, `speculationRules`) została
  przepuszczona przez te same asercje wykonane bezpośrednio w `bun`.

Bramki uruchomione i zielone: `content-layering`, `gate-coverage`,
`types-freshness`, `sql-migration-replay`, `sql-tenant-scope`, `sql-app-role`,
`sql-anon-insert`, `sql-emit-actor`, `sql-owner-tenant-scope`,
`sql-policy-tenant-regression`, `rpc-contract`, `stale-never-casts`,
`i18n-hardcoded`, `db-row-casts`, `public-assets`, `legacy-payment-refs`,
`programs-harness`.
