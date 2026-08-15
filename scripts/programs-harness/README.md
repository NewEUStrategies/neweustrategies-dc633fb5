# Harness scalenia tabel programów

## Po co to istnieje

Scalenie tabel programów robi cztery rzeczy, których **żadna bramka
`check:sql-*` nie jest w stanie zobaczyć**, bo wszystkie czytają migracje
jako TEKST:

1. przenosi wiersze między dwiema tabelami z rozstrzyganiem kolizji slugów,
2. przepina cztery klucze obce na inną tabelę docelową,
3. podmienia tabelę na widok,
4. przepisuje sześć polityk RLS, w tym dwie, które dotąd niczego nie filtrowały.

Harness sprawdza **skutki na danych**, nie składnię.

## Na czym harness stoi (i dlaczego był czerwony)

Scalenie było najpierw napisane jako **jedna ręczna migracja**
`20260815100000_programs_single_table.sql` (540 linii). Ta migracja została
**zastąpiona** łańcuchem trzech migracji i usunięta z repo (commit `207fdd9`):

| Migracja | Co wnosi |
| --- | --- |
| `20260815110437` | kolumna `programs.status` |
| `20260815110844` | właściwe scalenie: `program_merge_map`, przeniesienie wierszy, przepięcie 4 kluczy obcych, `DROP TABLE research_programs` + widok |
| `20260815111026` | `club_anchor_label` przepięty z `research_programs` na `programs` |

Harness **nie został wtedy przepięty** i wskazywał na skasowany plik, więc
`check:programs-harness` failował (`FAIL migracja 20260815100000`) — mimo że
scalenie w schemacie **zaszło**. To była awaria testu, nie schematu.

**Nie przywracaj skasowanej migracji**: ponowne scalenie jest już wykonane przez
łańcuch wyżej, a dodatkowo stara migracja wpada w selektor
`scripts/pg-harness` (redefiniuje `club_anchor_label`), gdzie replay wywala się
na `relation "public.programs" does not exist` — bo harness klubów nie zna
tabel modułu programów.

## Co już złapał

**Błąd kolejności, 23503.** Pierwsza wersja migracji przepisywała `program_id`
w tabelach-dzieciach, a dopiero potem zdejmowała stary klucz obcy. Nowy
identyfikator żyje w `programs`, a nie w `research_programs`, więc stary FK
odrzucał `UPDATE`:

```
ERROR: insert or update on table "research_program_members" violates
       foreign key constraint "research_program_members_program_id_fkey"
DETAIL: Key (program_id)=(e0000000-…-0001) is not present in table "research_programs".
```

W tekście migracji ta wersja wyglądała poprawnie i przeszłaby każdą bramkę
statyczną. Wywaliłaby się dopiero przy `supabase db push` na produkcji -
w połowie migracji, po `ALTER TABLE`, które już się wykonały.

## Co sprawdza

**27 asercji strukturalnych + 7 RLS (anon) + 3 zapisu przez widok + 1 odmowy zapisu.**

| Obszar                 | Pytanie                                                                                                                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| kształt                | czy `research_programs` jest widokiem, czy stara tabela zniknęła, czy widok ma `security_invoker = true`                                                                                            |
| kompletność            | czy żaden program nie zginął przy scaleniu i czy identyfikatory hubów bez kolizji są zachowane                                                                                                      |
| kolizja                | czy warstwa redakcyjna trafiła na wiersz słownika i czy opis ze słownika NIE został nadpisany                                                                                                       |
| dzieci                 | czy cztery tabele wskazują na `programs`, czy istnieje 4/4 kluczy obcych, czy żaden nie wisi na nieistniejącej tabeli                                                                               |
| treść                  | czy `post_programs` przeżyło scalenie (FK treści nie były ruszane)                                                                                                                                  |
| `status` ↔ `is_active` | czy kolumny nie mogą się rozjechać, w obie strony zapisu, także przy `INSERT`                                                                                                                       |
| widok                  | czy `INSERT` / `UPDATE` / `DELETE` przez widok trafiają do `programs` i odpalają trigger                                                                                                            |
| RPC                    | czy `get_program_members` i `club_anchor_label` (przepięte na `programs`) realnie się WYWOŁUJĄ - ciała plpgsql/sql nie są walidowane przy `CREATE`                                                  |
| RLS                    | czy anon NIE widzi szkicu, widzi opublikowany, nie widzi cudzego najemcy, nie widzi członkostwa w programie innego najemcy                                                                          |
| zapis                  | czy `authenticated` z rolą sztabową pisze przez widok (`security_invoker` wymaga grantów na TABELI BAZOWEJ - test jako superuser przeszedłby mimo ich braku) i czy zwykły użytkownik dostaje odmowę |

Dwie ostatnie pozycje to dziury **domknięte** tą migracją: `programs public read`
nie miał filtra statusu (bo statusu nie było), a `program_members public read`
stał na `USING (true)` - bez tenanta.

## Czym to NIE jest

To nie jest replika produkcji. `harness.sql` odtwarza wyłącznie powierzchnię
styku, której dotyka ta jedna migracja: obie rodziny programów w kształcie
**sprzed** scalenia (przepisane z `20260713175104`, `20260713181044`
i `20260714130000`) plus `tenants`, `auth.users`, `profiles`, `categories`,
`posts`, `podcasts`, `events`, `has_role`, `current_tenant_id`,
`public_tenant_id`, `set_updated_at`.

Tenant rozstrzyga `current_setting('nes.tenant')`, żeby test mógł **przełączyć
najemcę** i zmierzyć izolację zamiast jej założyć.

## Użycie

```bash
bun run check:programs-harness          # harness + seed + migracja + asercje
bash scripts/programs-harness/run.sh --keep   # zostaw bazę (port 5435) do grzebania
```

Instancja stoi na `/tmp/nespg-programs`, port **5435** - osobny od
`pg-harness` (5433) i klastra systemowego (5432), więc trzy harnessy mogą
jechać w tym samym jobie CI.

Kod wyjścia 0 = wszystkie asercje przeszły. Niespełniona asercja przerywa
skrypt kodem 1 i wypisuje, na czym stanęła.

## Dane testowe (`seed.sql`)

Trzy przypadki, każdy realny:

1. **kolizja** - `energia` istnieje w obu tabelach pod tym samym slugiem. To
   jest dokładnie ten defekt, przez który audyt zgłasza tę pozycję siódme
   wydanie: ten sam program opisany dwa razy;
2. **tylko słownik** - `departament-analiz` (`kind = 'department'`, nieaktywny);
3. **tylko hub** - `bezpieczenstwo-europejskie` z kompletem dzieci, plus
   `szkic-programu` w statusie `draft` do sprawdzenia RLS.

Plus drugi najemca z własnym programem `energia` - bez niego test izolacji
mierzyłby fikcję, bo nie byłoby czego nie zobaczyć.
