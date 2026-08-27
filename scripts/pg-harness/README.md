# Harness Postgresa - wykonywanie migracji bez Supabase

## Po co to istnieje

Bramki `check:sql-*` czytają migracje jako TEKST. Wyłapują rozjazdy inwariantów
(tenant-scope, literały `app_role`, granty dla `anon`), ale nie wyłapią niczego,
co ujawnia się dopiero przy wykonaniu:

- `column reference "id" is ambiguous` w funkcji plpgsql, której parametr OUT
  nazywa się tak jak kolumna - `CREATE FUNCTION` przechodzi, wywołanie wywala
  się błędem 42702,
- trigger `AFTER UPDATE`, gdy wszystkie realne ścieżki robią `INSERT` - nie
  odpala się nigdy, a kod wygląda poprawnie,
- odwołanie do konfiguracji wyszukiwania, która w tej instalacji nie istnieje,
- niezgodność liczby kolumn `RETURNS TABLE` z `SELECT`.

Oba pierwsze błędy REALNIE wystąpiły w module Discussion Club i przeszły przez
wszystkie bramki CI. Znalazło je dopiero wykonanie.

## Czym to NIE jest

To nie jest replika bazy produkcyjnej. `harness.sql` odtwarza wyłącznie
powierzchnię styku, której dotyka testowany moduł: `auth.users`, `auth.uid()`,
`profiles`, `tenants`, `user_roles`, `has_role`, `current_tenant_id`,
`enqueue_notification` i kilkanaście innych obiektów - każdy przepisany
z ORYGINALNEJ migracji, bo inaczej test przechodziłby na fikcji.

Czego brakuje i co to znaczy:

| Brak                  | Skutek                                                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `pgvector`            | funkcje semantyczne jadą na atrapie typu (domyślnie; `--no-vector-stub` ją wyłącza); sprawdzamy składnię i widoczność, nie jakość wyszukiwania |
| `pg_cron`             | harmonogram wołamy ręcznie, nie sprawdzamy planowania                                                                                          |
| `pgtap`               | asercje są gołym SQL-em, nie planem TAP                                                                                                        |
| konfiguracja `polish` | **nie istnieje też w standardowym PostgreSQL 16** - i to jest ustalenie, nie ograniczenie harnessu                                             |

## Użycie

```bash
bun run scripts/pg-harness/run.sh                      # migracje modułu + testy
bun run scripts/pg-harness/run.sh --keep               # zostaw bazę do ręcznego grzebania
bun run scripts/pg-harness/run.sh --only 2026080809    # tylko migracje z tym prefiksem
```

Skrypt stawia instancję na `/tmp/nespg`, wykonuje harness, potem migracje
w kolejności, potem `runtime_test.sql`.

Migracje wybierane są po TREŚCI (`grep` za `public.club_` / `public.admin_club_`),
nie po nazwie pliku. Wcześniejszy wybór po wzorcu `*discussion_clubs*` zostawiał
martwe pole: migracja klubowa nazwana losowym UUID-em - a tak nazywa je panel
Lovable - nie była aplikowana w ogóle. Zemściło się to realnie: migracja
`20260807172345` redefiniowała `club_list`, `club_replies_list`
i `admin_club_moderation_queue`, harness jej nie widział, więc kolizja sygnatur
z późniejszymi migracjami wyszła dopiero w CI (błąd 42723 przy odtwarzaniu
schematu od zera). Kod wyjścia 0 znaczy, że wszystkie
asercje przeszły; niespełniona asercja przerywa skrypt kodem 1 i wypisuje,
ile asercji zdążyło przejść przed błędem.

## `SKIP`: zlepek pominięty znacznikiem

Wybór po TREŚCI ma jedną konsekwencję, której wcześniejszy opis nie
przewidywał: panel Lovable emituje ZLEPKI - jeden plik migracji zawiera kilka
niezależnych migracji zapisanych pod jedną nową wersją. Jedno trafienie
`public.club_events` w ostatniej sekcji wciąga cały zlepek, razem z sekcjami,
które sięgają obiektów poza powierzchnią styku modułu. Tak stało się
z `20260822171037_bea8e790-...` (siedem migracji, `20260822090000`…`20260822096000`):
harness przewracał się na `UPDATE public.content_access`, a bramka stała
czerwona na `main` bez ANI JEDNEGO sygnału o module.

Rozstrzygnięcie (PR #296): taki plik nosi w swojej treści znacznik
`-- pg-harness: exclude`, a pętla migracji go POMIJA - widocznie, z nazwą pliku
i z licznikiem na końcu:

```
  SKIP 20260822171037_bea8e790-....sql (znacznik pg-harness: exclude)
Zaaplikowano: 90, pominieto znacznikiem: 1.
```

Dlaczego pominięcie w pętli, a nie wycięcie z selektora: wycięcie
(`| xargs grep -L`) daje ten sam skutek NIEWIDOCZNIE - plik przestaje istnieć
dla przebiegu i nikt się nie dowie, że zestaw się skurczył. Dlaczego znacznik,
a nie automatyczna tolerancja błędu: znacznik jest DECYZJĄ człowieka wpisaną
przy pliku, więc nie da się jej dostać przez przypadek.

Strażnik `applied > 0`: znacznik wpisany za szeroko (albo literówka w warunku)
mógłby opróżnić zestaw, a pusta pętla kończy się zerem - czyli bramka
raportowałaby sukces, nie sprawdziwszy ANI JEDNEJ migracji.

Czego bramka przez `SKIP` **przestaje** pilnować: całej treści pominiętego
pliku, także sekcji modułowej. W dzisiejszym przypadku to nie ubytek pokrycia -
klubowa sekcja zlepka jest NADZBIOREM pokrytym osobnym, przechodzącym plikiem
`20260822096000_club_events_tier_gate.sql` (różnica: jeden
`GRANT EXECUTE ... club_event_upsert` więcej w pliku samodzielnym). Gdyby
kiedyś oznaczono zlepek z SQL-em modułu, którego nie ma nigdzie indziej, ten
SQL przestanie być sprawdzany przez wykonanie - i tylko linia `SKIP` w logu
o tym powie.

Kod wyjścia `psql` jest przechwytywany PRZED potokiem `sed | grep`. Bez tego
status potoku pochodził od `grep`, więc niespełniona asercja tylko drukowała
się na ekranie, a skrypt kończył się zerem - bramka raportowała sukces
dokładnie wtedy, gdy powinna być czerwona.

## Ustalenie warte zapamiętania

Konfiguracja wyszukiwania `polish` **nie jest dostarczana przez PostgreSQL**.
Standardowa instalacja 16 ma 29 konfiguracji (`english`, `french`, `russian`...)
i nie ma wśród nich polskiej - polski wymaga słownika hunspell/ispell
doinstalowanego osobno. Kolumna `GENERATED` odwołująca się do `to_tsvector('polish', ...)`
wywala CAŁĄ migrację przy wdrożeniu. Dlatego moduł tworzy własną konfigurację
`public.nes_polish`, która wybiera źródło w czasie migracji.
