# Raport scalenia S7 z gałęzią PR po S8 (2026-10-22)

Worktree `/home/user/wt/S7`, gałąź `hub/s7-zakladki-diagnostyka-c`. Nic nie zostało wypchnięte.

## Commity

| SHA | Temat |
| --- | --- |
| `6bf83a923` | hub(S7): scalenie gałęzi PR po S8 (df075ffc) do S7. Merge commit, rodzice `53c5d6d3b` i `df075ffc2`. |
| `6f9403283` | hub(S7): scalenie po S8 - dziennik §23.11 (bramki po scaleniu) i komentarz manifestu I9 |

Oba commity kończą się wymaganymi liniami `Co-Authored-By` i `Claude-Session`.

## Konflikty i rozwiązania

- **`RevenueHubLayout.tsx`**
  - `badges` łączy teraz oba liczniki:
    - `diagnostics`: leniwa sonda S7 `DiagnosticsBadgeProbe`;
    - `journeys`: `useJourneysBadgeCount` z S8.
  - Gdy któryś licznik ma `null`, jego plakietka się nie pokazuje (nigdy „0”).
- **`RevenueHubLayout.test.tsx`**
  - Atrapy faktów i wyciszeń oraz `listJourneys` siedzą w jednym `vi.hoisted`.
  - `beforeEach` resetuje obie.
  - Zostały oba bloki testów liczników: Diagnostyka (4) i Ścieżki (6).
- **Mechanizm „w przygotowaniu”: usunięty w całości** (Z-S7-17).
  - Usunięte pliki: `tabPreparing.ts`, `RevenueTabPreparing.tsx`, `i18n-admin-revenue-preparing.ts` i ich 2 testy.
  - Usunięte wpisy w manifestach S7 i I9 w `hubDelivery.ts`, z komentarzem.
  - Poprawione komentarze w `RevenueJourneysTab.tsx` i w testach zakładek Ścieżki i Diagnostyka.
  - `grep` nie znajduje już odwołań poza kroniką.
  - W `reports/*` nie było wpisów, `overlayReaders` nie dotyczy.
- **`adminNav.ts`, `i18n-admin-core.ts`, `hubDelivery.ts`, `i18nParity.gate.test.ts`**
  - Scaliły się automatycznie.
  - ⌘K zawiera zakładki, „Nowa ścieżka” z S8 i 43 wskaźniki z S7.
- **`adminNav.test.ts`**
  - Automatyczne scalenie zostawiło dwie deklaracje `tabEntries` (błąd parsowania).
  - Teraz jest jeden filtr: wpisy bez `search`.
- **`check-bundle-size.ts`**
  - Kronika zachowuje oba wpisy: S8 5023→5182 oraz S7 5023→5159 z dopiskiem „próg zastąpiony”.
  - Nowy wpis: „Ratchet 5182 -> 5316 (2026-10-22, scalenie S7 po S8)”, D-08. Zmierzone na hoście 5314,3 → ceil 5315 → +1.
- **`_journal.json`**
  - Bez konfliktu: S8 i scalenie `main` nie dodały bliźniaków.
  - Bliźniaki `0373…0375` zostają, następny wolny numer to `0376`.
  - `check:migration-lanes` zielony.
- **Dziennik**
  - §10: wiersz S8, potem wiersz S7.
  - §11.5: Z-S6-08 zamknięte (oba liczniki).
  - §17.6 opisuje S8. Sekcja S7 przenumerowana na **§17.7** i zaktualizowana, odwołanie w §23 poprawione.
  - Kolejność na końcu pliku: §22 (S8), potem §23 (S7).
  - Nowa §23.11: konflikty, usunięcie mechanizmu, łączny pomiar bundla, bramki.
  - Z-S7-17 zamknięte.
- **`docs/KONTYNUACJA_…`**
  - Stan: S8 i S7 są w PR. Kolejka: I9d, potem I9.
- **`docs/kontynuacja/`**: usunięty w całości.
- Dokumenty przeszły prettier.

## Bramki

| Bramka | Wynik |
| --- | --- |
| `format:check` | ✓ (`_kontynuacja/` odstawiony poza drzewo na czas sprawdzenia) |
| `verify:static` (18) | ✓ (246 s) |
| tsgo zawężony (`tsconfig.s7m.tmp.json`, 492 pliki: 196 zmienionych względem PR + 296 importerów, także `types.ts`; `GOMEMLIMIT=6GiB`) | ✓ 0 błędów; plik tymczasowy usunięty |
| `typecheck:scripts && typecheck:e2e` | ✓ / ✓ |
| `lint` | ✓ 0 błędów, 320 ostrzeżeń (tyle samo co w PR po S8) |
| vitest g1: `lib/{revenue,admin,journeys,crm,ci,onboarding}` | ✓ 218 plików, 7129 testów (+7 xfail, 1 todo) |
| vitest g2: `components/admin/{revenue,dashboard,journeys,newsletter}` | ✓ 112 plików, 2434 testy |
| vitest g3: `lib/__tests__` + `src/__tests__` | ✓ 144 pliki (+2 skip), 3750 testów (+12 xfail, 50 skip); `i18n-parity.json` bez zmian |
| vitest g4: `routes/__tests__` | ✓ 230 plików, 8084 testy (+79 xfail) |
| pgTAP `run.sh all` (`/tmp/pgtap-hub-s7`, port 5457) | 1302 migracje; jedyny błąd to znany `20260825230232`. 249 plików OK, 5734 asercje. 4 czerwone pliki, wyłącznie znane: `community_cron_schedule` 2/17, `job_scheduler_heartbeat` 1/32, `public_definer_views_read_only` 1/35, `profile_intent_semantic`. Pliki S7: 24, 26 i 4 asercje, wszystkie OK. |
| `generate:ts-sql-contract` + `test ts_sql_contract` | ✓ 9 asercji (990 RPC, 1515 operacji) |
| `rpc-contract`, `types-freshness`, `migration-lanes`, `sql-*` (7), `on-conflict-arbiters` | ✓ wszystkie, także uruchomione osobno |
| harnessy pg / careers / events | ✓ 504 asercje / 14 migracji / 4914 asercji |
| build (`BUNDLE_INVENTORY=1`) + `check:bundle` | build ✓. `check:bundle` czerwony: 5314,3 > 5182. Po ratchecie 5316 jeden przebieg ✓. |
| `check:chunks` / `entry-purity` / `server-entry-purity` | ✓ / ✓ / ✓ (graf 1552 chunków acykliczny) |
| `generate:authz-snapshot --check` | ✓ bez regeneracji |
| `hub-slice-guard S7 --base origin/claude/elegant-fermat-xwfca1` | exit 1 wyłącznie na zmianach integratorskich (szczegóły niżej). Dostawa: 3 pliki, 20 funkcji. |

Zmiany integratorskie zgłoszone przez `hub-slice-guard`:

- pliki współdzielone: `_journal.json`, `check-bundle-size.ts`, `types.ts`, `adminNav` z testem, `authzSnapshot`, `hubDelivery`;
- poza manifestem:
  - `RevenueHubLayout` z testem;
  - `RevenueJourneysTab` z testem;
  - usunięte pliki mechanizmu „w przygotowaniu”;
  - dokumenty i `docs/kontynuacja/**`.

## Bundel (gzip KB)

| Budżet | Zmierzone po scaleniu | Próg | PR po S8 |
| --- | --- | --- | --- |
| overall | 5314,3 | **5316** (było 5182) | 5180,9 |
| admin-only | 2535,0 | - | 2402,3 |
| css | 99,81 | 100 (bez ratchetu, zapas 0,19) | 99,77 |
| public | 2779,2 | 2881 (zamrożony) | 2778,6 |
| publicCss | 83,8 | 85 (zamrożony) | 83,8 |
| chunk | 258,0 | 286 (zamrożony) | 257,9 |
| boot | 471,7 | 579 (zamrożony) | 471,6 |

Przyrost względem S8 wynosi +133,4. To przyrost S7 (+136,9) pomniejszony o usunięty `RevenueTabPreparing` (−3,7).

## Stan

- HEAD to `6f9403283` i zawiera `origin/claude/elegant-fermat-xwfca1` (`df075ffc2`, sprawdzone `ls-remote`). Push będzie fast-forwardem o 13 commitów.
- `git status`: czysto, poza nieśledzonym `_kontynuacja/`.

## Otwarte

- Z-S7-01…16 (§23.5) dla I9 i właściciela.
- Zapas budżetu jest minimalny: `overall` 1,7 KB, `css` 0,19 KB (Z-S7-11).
- I9d (gałąź od `53c5d6d3b`) musi scalić gałąź PR po S7 i powtórzyć `plpgsql_check_gate` oraz pgTAP faktów S7 (Z-S7-16).
- Z-S8-01…10 bez zmian.
- Pełny vitest uruchamia CI po pushu.
