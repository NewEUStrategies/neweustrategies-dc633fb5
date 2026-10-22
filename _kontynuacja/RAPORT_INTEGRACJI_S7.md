# Raport integratora S7 (2026-10-22)

Worktree `/home/user/wt/S7`, gałąź `hub/s7-zakladki-diagnostyka-c`. Baza to `75133fe20`, HEAD to `53c5d6d3b`. Nic nie zostało wypchnięte.

Po restarcie kontenera stan był spójny: commit integracji był zrobiony, a niezacommitowane były tylko dokumenty. Wszystkie bramki skończyły się przed restartem, a SQL i kod od tego czasu się nie zmieniły. Dlatego pgTAP i build nie były powtarzane.

## Commity

- `ea39da841` hub(S7): integracja - pliki współdzielone (bliźniaki 0373-0375, typy RPC, kontrakt TS⇄SQL, authz, trasy huba, licznik Diagnostyki, ⌘K wskaźników, ratchet D-08)
- `53c5d6d3b` hub(S7): dziennik - sekcja 23 i stan

## Zmiany 1-13

1. **Bliźniaki drizzle.**
   - Pliki `0373_revenue_facts`, `0374_revenue_facts_operations` i `0375_revenue_diagnostic_snoozes` są bajt w bajt zgodne z supabase (sprawdzone `cmp`). Numery 373-375 były wolne.
   - W `_journal.json` doszły idx 373-375. Wartości `when` to 1792477993912, …053912 i …113912 (poprzedni + 60000).
   - `check:migration-lanes` i `supabaseLaneCoverage.test.ts` (24) są zielone. `migration-ledger.json` bez zmian.
2. **`types.ts`.** Doszły 4 RPC: `admin_revenue_facts` i `admin_revenue_diagnostic_snoozes` (`Args: never`), `admin_revenue_diagnostic_snooze` (6 argumentów) i `_unsnooze`. Zapis jest w konwencji generatora. `check:rpc-contract` i `check:types-freshness` są zielone.
3. **Kontrakt TS⇄SQL.** `generate:ts-sql-contract` obejmuje 989 wywołań RPC. Plik jest w `.gitignore`, więc nie ma go w commicie. pgTAP `ts_sql_contract`: 9 asercji OK.
4. **`authzSnapshot`.** Po regeneracji doszła 1 linia (`premium_content` w `fn:_revenue_facts_paywall/1`). Statystyki: 1299→1302 migracji, 1823→1843 funkcji. `--check` jest zielony.
5. **Testy tras i stan „w przygotowaniu”.**
   - `adminRevenueHubRoutes.test.tsx` sprawdza teraz nagłówki h2 („Najważniejsze wskaźniki” i EN „Offer matrix”).
   - `TAB_PREPARING` jest typu `Partial` i ma tylko wpis `journeys`. Usunięte zostały stałe, etapy `s7` i `s6s7`, zdanie `partial`, klucze `what.*` dziesięciu zakładek oraz 13 kluczy `link.*`.
   - `RevenueTabPreparing` bez wpisu zwraca `null`. Testy przepisane: tabPreparing 26, molekuła 13.
   - `dashboardPanels.test.tsx` dostał atrapę leniwego `RealizedRevenueTile` zamiast `QueryClientProvider`. Powód: deterministyczność testu, a zachowanie kafla pokrywa `MarketingPanel.realized.test`.
6. **Licznik Diagnostyki (Z-S6-08).**
   - Nowy leniwy plik `diagnostics/DiagnosticsBadgeProbe.tsx` (manifest S7). Montuje go `RevenueHubLayout` przez `React.lazy` + `Suspense`, tylko gdy jest najemca, rola admin lub editor i zakładka Diagnostyka.
   - Chunk układu `admin.revenue` urósł z 4181 do 4496 B gzip. Sonda zajmuje 257 B. Rejestr reguł został w chunku `queries` (+123 B).
   - Testy układu: 25, w tym 4 nowe (licznik z cache bez żądania, redaktor, brak faktów lub najemcy, zimny cache). Dodana też zaślepka zakładki Lejek z `layout.diff`. Licznik Ścieżek zostaje dla S8.
7. **⌘K wskaźników.**
   - `adminNav.ts`: `searchEntries` to teraz zakładki plus `metricSearchEntries(t(REVENUE_TAB_NAV_LABEL.metrics), roles)`, czyli 43 skróty.
   - Test zgodnie ze zgłoszeniem, adminNav* zielony. `i18n-admin-core.ts` nie wymagał zmian.
8. **`hubDelivery.ts`.**
   - Manifest S7 dostał bliźniaki `{0373,0374,0375}` oraz pliki integracji (`tabPreparing` z testem, słownik preparing, molekuła z testem, testy tras, `dashboardPanels.test`), z komentarzem „Integrator S7, 2026-10-22”.
   - `RevenueHubLayout` celowo NIE trafił do manifestu S7. Test manifestów wymaga dla tego pliku jednego właściciela równoległego (S6).
   - `FUNCTION_TABLE` bez zmian. `hubDelivery.gate` jest zielony.
9. **`reports/i18n-parity.json`.** Bramka parytetu przepisała plik bez różnic, więc nie trafił do commitu. Allowlista bez zmian.
10. **Ratchet D-08 `overall`: 5023 → 5159.**
    - Zmierzone 5157,5 → ceil 5158 → +1. Wpis kroniki jest nad progiem.
    - `css` mieści się w progu, więc bez ratchetu.
    - `check:bundle` nie był powtarzany po zmianie progu. Arytmetyka: 5157,5 ≤ 5159.
11. **Zgłoszenia I9.** Nie wykonane, opisane w dzienniku §23.5 jako Z-S7-01…10.
12. **Usunięcie `docs/kontynuacja/s7/`.** `README.md` dotyczy teraz tylko S8 i ma odsyłacz do §23.
13. **Dziennik i stan.**
    - Dziennik §23 (23.1-23.10).
    - Wiersz w §10 i nowy §17.6.
    - Dopiski „Zamknięte 2026-10-22 (S7, §23)” przy Z-S2-06, Z-S2-12, Z-S3-03, Z-S4-07 i Z-I9b-06.
    - Dopiski „częściowo” przy Z-S6-08, Z-S2-04 i Z-S2-05.
    - Zaktualizowany KONTYNUACJA. Dokumenty przeszły `prettier --write`.

## Bramki

| Bramka | Wynik |
|---|---|
| format:check | Pliki repo czyste. 18 ostrzeżeń wyłącznie w nieśledzonym `_kontynuacja/`. |
| verify:static (18) | Przerywa się na format:check (`_kontynuacja/`). Pozostałe 17 `check:*`, puszczone bez zatrzymania: wszystkie OK. |
| tsgo zawężony (219 plików: zmienione od bazy i ich importerzy, bez importerów `types.ts`, bo zmiana addytywna) | EXIT 0 |
| typecheck:scripts / typecheck:e2e | OK / OK |
| lint | 4 błędy parsowania wyłącznie w `_kontynuacja/workflows/*.js`. W plikach S7 i integracji 0 problemów. 282 ostrzeżenia zastane. |
| vitest `--maxWorkers=2` (katalogi z polecenia) | 606 plików OK (2 skipped). 18 916 testów OK, 98 expected fail, 50 skipped, 1 todo. |
| pgTAP `run.sh all` | 1302 migracje; jedyny błąd to znany `20260825230232`. Pliki: 249 OK, razem 5734 asercje. 4 pliki czerwone, wyłącznie znane: `community_cron_schedule` 2/17, `job_scheduler_heartbeat` 1/32, `public_definer_views_read_only` 1/35, `profile_intent_semantic` (vector). Pliki S7: `revenue_facts` 24, `snoozes` 26, `plpgsql_check_gate` 4. |
| ts_sql_contract | 9 OK |
| rpc-contract / types-freshness / migration-lanes | OK |
| sql-* (7) + on-conflict-arbiters | OK |
| split-migration `2026102015*` | Każdy plik w 1 części |
| harnessy pg / careers / events | 504 asercje / OK (14 migracji) / 4914 asercji |
| build + check:bundle | Build OK. `check:bundle` czerwony tylko na `overall` (5157,5 > 5023), wymaga ratchetu (zrobiony). |
| check:chunks / entry-purity / server-entry-purity | OK / OK / OK |
| generate:authz-snapshot --check | OK (po regeneracji) |
| hub-slice-guard S7 --base 75133fe20 | Naruszenia wyłącznie integratorskie, lista niżej. Dostawa: 3 pliki, 20 funkcji. |

**Naruszenia zgłaszane przez hub-slice-guard (wszystkie integratorskie):**

- `[plik-wspoldzielony]`: `_journal.json`, `check-bundle-size.ts`, `types.ts`, `adminNav.ts` z testem, `authzSnapshot.generated.ts`, `hubDelivery.ts`.
- `[poza-manifestem]`: `RevenueHubLayout.tsx` z testem (plik S6), dziennik, KONTYNUACJA, `docs/kontynuacja/README.md` i usunięte `docs/kontynuacja/s7/*`.
- Do tego nieśledzony katalog `_kontynuacja/`.

## Bundle (gzip KB)

| Wskaźnik | Baza 75133fe2 | Wykonawcy 6d02b021 | Po integracji | Próg przed → po |
|---|---|---|---|---|
| overall | 5020,6 | 5159,1 | **5157,5** | 5023 → **5159** |
| admin-only | 2242,3 | 2379,5 | 2378,0 | - |
| public | 2778,3 | 2779,6 | 2779,4 | 2881 (zamrożony) |
| chunk | 257,9 | 258,0 | 258,0 | 286 (zamrożony) |
| css | 99,7 | 99,8 | 99,8 | 100 |
| publicCss | 83,8 | 83,8 | 83,8 | 85 (zamrożony) |
| boot | 471,7 | 471,7 | 471,7 | 579 (zamrożony) |

S7 dokłada względem bazy +136,9 KB. Wszystko to leniwe chunki panelu. Integracja względem drzewa wykonawców daje −1,6 KB.

## Otwarte

**Dla I9 (Z-S7-01…10, szczegóły w dzienniku §23.5):**

- chipy `RevenueSignalChip` w 10 ekranach modułów;
- P24: `HUB_SYNC_MANIFEST.crm_task` → `assignUnassignedCrmTasks`, zapadki w `quickFixes.test.ts` i przycisk w CRM;
- `HUB_SYNC_MANIFEST.metrics` (Z-S6-11);
- `MetricDictionary` `onOpenMetric`;
- baner realtime S-F (API statusu kanału) i zamiana `it.todo`;
- `ratioCurrency` w migawce (Z-S2-05);
- `admin_dashboard_marketing` na rollupie (Z-I9c-05);
- `RetentionFeedbackList` i `RETENTION_DIALOG_STEPS`;
- kopie kafli (Z-S6-12);
- wpięcie e-maila w migawkę.

**Dla orkiestratora i właściciela:**

- Push dopiero po S8: trzeba przebazować na gałąź PR z S8 i powtórzyć bramki dotknięte zmianą bazy (vitest katalogów huba, zawężony tsgo, build i ponowny ratchet `overall` wg pomiaru).
- Z-S7-11: budżet, cel pakietu ≤ +40 KB przekroczony; zapas `css` 0,2 KB.
- Z-S7-12: klucz `finance.series.title` bez czytelnika.
- Z-S7-13: brak briefów.
- Z-S7-14: akceptacja 55. reguły.
- Z-S7-15: brak czasu przejść w lejku.
- Z-S7-16: powtórzyć pgTAP i `plpgsql_check` po scaleniu I9d.
- Z-S7-17: po S8 usunąć cały mechanizm `TAB_PREPARING`.
- Lokalnie nie były uruchamiane pełne `bun run test` ani pełny tsgo (zgodnie z zasadami).

## Ryzyka przy przebazowaniu na gałąź z S8 (pliki zmieniane przez oba wycinki lub ich integratorów)

- **`tabPreparing.ts`, `RevenueTabPreparing.tsx` z testem, `i18n-admin-revenue-preparing.ts`, `tabPreparing.test.ts`.** S8 zdejmuje `journeys`, S7 resztę. Po obu wycinkach mapa jest pusta, więc należy usunąć cały mechanizm razem z wpisami w manifestach I9 i S7.
- **`adminNav.ts` z testem.** S7 dodaje skróty wskaźników w `searchEntries` huba, a S8 prawdopodobnie „Nową ścieżkę” (`?new=1`) w tym samym miejscu.
- **`RevenueHubLayout.tsx` z testem.** Slot `badges`: S7 dodaje licznik Diagnostyki przez sondę, S8 licznik Ścieżek. Do tego dochodzą atrapy w teście.
- **`hubDelivery.ts`.** Sąsiednie manifesty S7 i S8.
- **`check-bundle-size.ts`.** Dwa wpisy kroniki i dwa ratchety. Po przebazowaniu trzeba ponownie zmierzyć i zostawić jeden próg `ceil+1`.
- **`reports/i18n-parity.json`.** Przepisuje go bramka.
- **Dziennik.** Wiersze w §10, §17.6 (S8 może też dodać §17.6, wtedy renumerować), sekcje §22 i §23 dopisane na końcu pliku.
- **`KONTYNUACJA_HUB_PRZYCHOD_LEJEK_2026-10-19.md`.** Akapity stanu i kolejki.
- **`docs/kontynuacja/README.md`.** S8 usuwa `s8/`, S7 usunął `s7/`. Po obu wycinkach należy skasować cały katalog.
- **`_journal.json`.** S8 nie ma SQL, więc konfliktu nie będzie, chyba że na `main` doszedł bliźniak potwierdzenia wdrożenia. Wtedy przesunąć 0373-0375 i glob w `hubDelivery.ts`.
