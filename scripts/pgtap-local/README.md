# Lokalny runner pgTAP (pełny schemat, bez Dockera)

Stawia PostgreSQL, aplikuje **wszystkie** migracje z `supabase/migrations` w kolejności
Supabase CLI i uruchamia suite z `supabase/tests`, parsując surowy TAP.

```bash
bun run test:pgtap-local                      # pełny przebieg: schemat + wszystkie testy
bun run test:pgtap-local all discussion_clubs # tylko pliki testów pasujące do wzorca
bun run test:pgtap-local migrate              # sam schemat (diagnostyka migracji)
```

## Po co, skoro jest bramka `pgtap` w CI

Bramka w CI chodzi przez `supabase db start`, czyli przez Dockera. W środowiskach bez
Dockera (część sandboxów agentowych, część maszyn deweloperskich) **nie da się uruchomić
ani jednego testu bazodanowego**, więc czerwony pgTAP naprawia się na wyczucie i wypycha
„na próbę" do CI. Ten runner zdejmuje tę barierę: potrzebuje tylko `postgresql-16`
i rozszerzenia `pgtap`.

Odtwarzalność została zmierzona: na `a9b9e14` runner pokazał **dokładnie te 17 plików**,
które raportowała bramka `pgtap` w CI (plus kilka pozycji własnych — patrz niżej).

## Czego ten runner NIE dowodzi

Supabase dostarcza w produkcji rzeczy, których migracje same nie tworzą. `stub.sql`
odtwarza ich **powierzchnię**, nie zachowanie:

| Atrapa                                  | Co robi                                                  | Czego nie wolno na niej wnioskować                                                                                                                                                                                                                                                                |
| --------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extensions.vector` (gdy brak pgvector) | domena `double precision[]`, operator `<=>` zwracający 0 | Żadnych wyników podobieństwa semantycznego. Modyfikator wymiaru (`vector(768)`) jest niedopuszczalny, więc testy rzutujące na `vector(768)` przerwą się lokalnie, a w CI nie. **Dlatego warto doinstalować `postgresql-16-pgvector`** — bez niego ta atrapa maskuje realne defekty (patrz niżej). |
| `net.http_post` / `net.http_get`        | zwraca `0`, nie wysyła nic                               | Dostarczalności webhooków i maili.                                                                                                                                                                                                                                                                |
| `cron.schedule`                         | wpisuje wiersz do `cron.job`                             | Że zadanie się **wykonało** — tylko że zostało zarejestrowane.                                                                                                                                                                                                                                    |
| `pgmq.*`                                | kolejka w jednej tabeli                                  | Semantyki `vt`/widoczności i ponownych odczytów.                                                                                                                                                                                                                                                  |
| `vault.*`                               | sekret w jawnym tekście                                  | Czegokolwiek o szyfrowaniu. **Nie wkładaj tu prawdziwych sekretów.**                                                                                                                                                                                                                              |
| `storage.objects`                       | tabela z RLS, bez warstwy Storage API                    | Polityk zależnych od metadanych, których Storage dokłada sam.                                                                                                                                                                                                                                     |
| `auth.*`                                | `auth.uid()`/`role()` czytane z `request.jwt.claim.*`    | Przepływów GoTrue (logowanie, MFA, tokeny).                                                                                                                                                                                                                                                       |

Skutek praktyczny: **kilka plików pada lokalnie z powodu atrapy, a w CI przechodzi.**
Na `e7f3466`, z doinstalowanym pgvector, jest ich sześć: `community_cron_schedule`
i `job_scheduler_heartbeat` (oba sprawdzają raportowanie braku `pg_net` — atrapa ma go
„obecnym"), `tenant_isolation_billing_storage` i `chat_privacy_isolation` (polityki
`storage.objects`), `chat_contacts_search_and_privacy` (`unaccent` w indeksie) oraz
`community_events` (rozstrzyganie tenanta publicznego bez hosta). Zanim uznasz lokalną
porażkę za defekt, sprawdź, czy nie jest w tej klasie — a jeśli masz wątpliwość,
rozstrzyga CI.

**Ostrzeżenie z praktyki — atrapa wektora maskuje defekty.** Bez `pgvector` runner
raportował `profile_intent_semantic` jako artefakt atrapy („modyfikator wymiaru
niedopuszczalny"). Po doinstalowaniu `postgresql-16-pgvector` ten sam plik pokazał
**prawdziwy** błąd: fikstura budowała wektor jako `array_fill(...)::text::vector(768)`,
czyli literał tablicy Postgresa (`{0.01,…}`), którego pgvector nie przyjmuje — wymaga
nawiasów kwadratowych (`[0.01,…]`). Plik przerywał na 20. z 36 asercji **także w CI**,
a wśród nieuruchomionych siedziała asercja utrwalająca regresję stopnia oddalenia.
Wniosek: brak rozszerzenia zamienia realny defekt w „znany artefakt" — najbardziej
kosztowna klasa fałszywego negatywu, jaką to narzędzie może wygenerować.

## Wymagania

- `postgresql-16` (`initdb`, `pg_ctl`, `psql`) — runner nie korzysta z systemowego klastra,
  stawia własny na sockecie w `$PGTAP_DIR`;
- rozszerzenie `pgtap` (`apt install postgresql-16-pgtap`);
- `pgvector` opcjonalnie — bez niego wchodzi atrapa typu.

Zmienne: `PGTAP_DIR` (domyślnie `/tmp/nespgtap`) i `PGTAP_PORT` (domyślnie `5434`).
Równoległe przebiegi **muszą** dostać własny katalog i port — dwa runnery na jednym
porcie podłączają się do bazy poprzednika i sypią setkami fałszywych „already exists".
