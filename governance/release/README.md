# Wydanie: ochrona `main`, bramka i dowód wdrożenia

Ten katalog odpowiada na pytanie: **co musi być prawdą o commicie, zanim trafi na produkcję, i
skąd to wiadomo.** Powstał po audycie wydania z 2026-10, który znalazł cztery dziury:

| Ustalenie audytu                                                                                        | Co je zamyka                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Produkcja na commicie z czerwonym CI; opublikowane commity pośrednie bez żadnego przebiegu CI           | `ci.yml`: każdy commit `main` ma własny, dokończony przebieg (grupa concurrency = SHA); budżety bundla jadą też na PR-ach; zasada publikacji niżej (§4)                     |
| `main-ruleset.json` zadeklarowany jako `active`, a na GitHubie nie działa żadna reguła                  | `bun run governance:apply-ruleset` (nałożenie, §2) i workflow `release-governance.yml` (codzienny, czerwony przy rozjeździe, §3)                                            |
| Ruleset sprzeczny z kanałem Lovable: PR + review Code Ownera bez obejść, a bot pushuje prosto na `main` | Obejście `always` dla aplikacji Lovable, PR bez wymaganego zatwierdzenia; `bun run check:main-ruleset` odrzuca plik, którego nie da się nałożyć bez zatrzymania kanału (§1) |
| Zielony `post-deploy` bez sprawdzenia bazy, także po czerwonej bramce                                   | `post-deploy` jedzie tylko po zielonym `Required release checks`; brak poświadczeń = czerwony job (§5)                                                                      |

## 1. Ruleset `main-release-quality` (`main-ruleset.json`)

| Reguła                   | Ustawienie                                                                     | Dlaczego tak                                                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `deletion`               | włączona                                                                       | `main` nie znika                                                                                                                                                                                       |
| `non_fast_forward`       | włączona                                                                       | historia `main` nie jest przepisywana. Lovable tego nie potrzebuje: „Reverted to commit …" to nowy commit z drzewem celu (sprawdzone na a3c60633, e46f54d2, 2cae083d), rozjazd scala commitem scalenia |
| `required_status_checks` | `Required release checks`, `e2e`, `e2e-seeded`, każdy z `integration_id` 15368 | statusy spełnia wyłącznie GitHub Actions, nie dowolna aplikacja z uprawnieniem do statusów                                                                                                             |
| — `strict`               | `false`                                                                        | Lovable pushuje na `main` seriami; wymóg „gałąź aktualna" kazałby odświeżać i przeliczać PR po każdym pushu bota. Wynik scalenia i tak sprawdza przebieg CI commita scalenia na `main`                 |
| `pull_request`           | 0 zatwierdzeń, bez Code Ownera, rozwiązane wątki                               | jedynym Code Ownerem (`.github/CODEOWNERS`) jest konto, z którego powstają PR-y, a autor nie zatwierdza własnego PR-a. Wymagane rozwiązanie wątków zatrzymuje scalenie z otwartym wątkiem przeglądu    |
| `bypass_actors`          | aplikacja `gpt-engineer-app` (Lovable), tryb `always`                          | bot pushuje na `main` bez PR-a; bez obejścia każda publikacja Lovable zostałaby odrzucona. Tryb `pull_request` nie wystarcza - pushu bez PR-a nie ma                                                   |

Format pliku to payload REST API rulesetów z jednym wyjątkiem: aplikacja w `bypass_actors` ma
`app_slug` zamiast liczbowego `actor_id`. Identyfikator rozwiązuje skrypt nakładający (publiczne
`GET /apps/gpt-engineer-app`), więc w repo nie ma liczby, której nie da się sprawdzić. Dlatego
pliku **nie importuje się** przez „Import a ruleset" w ustawieniach - tylko skryptem z §2.

`bun run check:main-ruleset` (krok w jobie `verify` i w `bun run verify:static`) odrzuca plik,
który zatrzymałby push Lovable, wymaga zatwierdzenia przy jednym Code Ownerze, wymaga statusu,
którego żaden workflow nie raportuje na PR-ach, albo nie przypina statusu do GitHub Actions.
Logika i przypadki: `src/lib/ci/mainRuleset.ts`, `src/lib/ci/__tests__/mainRuleset.test.ts`.

**Granica, której ruleset nie przesuwa:** obejście Lovable znaczy, że push bota na `main` nie
przechodzi przez żaden wymagany status. Ruleset chroni scalenia PR-ów, nie kanał Lovable. Zamknięcie
tej granicy to decyzja właściciela (Lovable na gałęzi roboczej i scalanie przez PR), nie zmiana tego
pliku.

## 2. Nałożenie (administrator, raz i po każdej zmianie pliku)

```sh
GH_TOKEN="$(gh auth token)" bun run governance:apply-ruleset   # tworzy albo aktualizuje
bun run governance:apply-ruleset -- --dry-run                   # tylko payload
```

Token musi mieć uprawnienie „Administration: write" do repozytorium. Skrypt najpierw uruchamia
`check:main-ruleset`, potem rozwiązuje identyfikator aplikacji Lovable i robi `POST` (nowy ruleset)
albo `PUT` (ruleset o tej samej nazwie). Zmiana zasad = zmiana pliku w przeglądanym PR i ponowne
nałożenie; ręczna edycja w ustawieniach wróci jako rozjazd w §3.

## 3. Kontrola rozjazdu (`release-governance.yml`)

Codziennie, po zmianie `governance/release/**`, workflowów albo CODEOWNERS na `main` i na żądanie:
`bun run check:main-ruleset -- --live` porównuje plik z regułami, które GitHub stosuje do `main`
(`GET /repos/{repo}/rules/branches/main`). Brak reguły, inny parametr albo brak wymaganego statusu =
czerwony przebieg z poleceniem naprawy. Obejść (`bypass_actors`) to API nie pokazuje - brak obejścia
Lovable widać od razu jako odrzucony push bota. Workflow nie jest częścią `Required release checks`:
stan ustawień repozytorium nie zależy od commita.

## 4. Publikacja produkcji

Lovable publikuje front niezależnie od CI, więc ostatnią kontrolą jest człowiek:

1. Publikuj wyłącznie commit, którego `Required release checks` jest **zielony** (GitHub → commit na
   `main` → lista checków; każdy commit `main` ma własny przebieg, nic go nie anuluje).
2. Czerwony albo jeszcze trwający przebieg = nie publikuj; czerwony `main` naprawia następny PR.
3. Wdrożenie bazy: dowodem jest `post-deploy` na commicie bota z wyzwalaczem
   (docs/RUNBOOK_MIGRACJE_LOVABLE.md §4.4).

## 5. `post-deploy` - trzy stany

| Stan      | Znaczy                                                                                                                                              |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| zielony   | `check:db-contract` i `check:migration-ledger` przeszły na produkcyjnej bazie                                                                       |
| czerwony  | baza nie zgadza się z commitem albo brak ZMIENNYCH repozytorium `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` (docs/RUNBOOK_MIGRACJE_LOVABLE.md §4.8) |
| pominięty | `Required release checks` na tym commicie nie jest zielony - commit nie jest wydaniem, więc nie ma dowodu wdrożenia                                 |
