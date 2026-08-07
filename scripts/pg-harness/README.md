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

| Brak | Skutek |
| ---- | ------ |
| `pgvector` | funkcje semantyczne trzeba uruchomić z atrapą typu (`--vector-stub`); sprawdzamy składnię i widoczność, nie jakość wyszukiwania |
| `pg_cron` | harmonogram wołamy ręcznie, nie sprawdzamy planowania |
| `pgtap` | asercje są gołym SQL-em, nie planem TAP |
| konfiguracja `polish` | **nie istnieje też w standardowym PostgreSQL 16** - i to jest ustalenie, nie ograniczenie harnessu |

## Użycie

```bash
bun run scripts/pg-harness/run.sh                      # migracje modułu + testy
bun run scripts/pg-harness/run.sh --keep               # zostaw bazę do ręcznego grzebania
bun run scripts/pg-harness/run.sh --only 2026080809    # tylko migracje z tym prefiksem
```

Skrypt stawia instancję na `/tmp/nespg`, wykonuje harness, potem migracje
w kolejności, potem `runtime_test.sql`. Kod wyjścia 0 znaczy, że wszystkie
asercje przeszły.

## Ustalenie warte zapamiętania

Konfiguracja wyszukiwania `polish` **nie jest dostarczana przez PostgreSQL**.
Standardowa instalacja 16 ma 29 konfiguracji (`english`, `french`, `russian`...)
i nie ma wśród nich polskiej - polski wymaga słownika hunspell/ispell
doinstalowanego osobno. Kolumna `GENERATED` odwołująca się do `to_tsvector('polish', ...)`
wywala CAŁĄ migrację przy wdrożeniu. Dlatego moduł tworzy własną konfigurację
`public.nes_polish`, która wybiera źródło w czasie migracji.
