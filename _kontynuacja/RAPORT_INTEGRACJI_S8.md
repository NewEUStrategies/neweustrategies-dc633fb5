# Raport integracji S8 (2026-10-22)

Worktree `/home/user/wt/S8`, gałąź `hub/s8-sciezki-panel-c`, BAZA `75133fe20`. Bez pushu.

## Commity (od HEAD `e26fba3c8`)

| SHA | Temat |
| --- | --- |
| `9139b6475` | hub(S8): integracja - pliki współdzielone (manifest, ⌘K Nowa ścieżka, karta leada w CRM, oś leada, licznik Ścieżek, prefiks [TEST]) |
| `e59f2e23d` | hub(S8): integracja - ratchet D-08 overall 5023 -> 5182 (pomiar po S8) |
| `df075ffc2` | hub(S8): dziennik - sekcja 22 i stan |

## (A) Weryfikacja S8

- Kryteria karty S8 i S8.2/S8.3 sprawdzone z raportami podzadań i testami (dziennik §22.9): 7/8 [x]; [ ] „overall ≤ +25 KB gz dla edytora” – chunk `JourneyEditor` 22,4 KB (≤ 25), ale cały interfejs edytora ok. 95 KB gz w 18 leniwych chunkach → ratchet D-08; public +0,3 (entropia hashy, 0 modułów S8).
- `JourneySettingsDialog` ma przełącznik pomiaru otwarć (`open_tracking_enabled`), nadawcę i Reply-To z testami (`JourneySettingsDialog.test`, `journeyMutations.test` – inwalidacja karty retencji). Nic nie trzeba było uzupełniać.
- Czerwone w plikach S8: brak (po `c5718bed`). Jedyna poprawka w pliku S8.3c: zdjęty filtr axe w `EmailStepEditor.test` po naprawie `CampaignBlockProperties`.
- Niezacommitowane zmiany zastane: tylko `reports/i18n-parity.json` (przepis bramki) – po dopisaniu allowlisty wraca do stanu bazy (brak zmiany do commitu).

## (B) Zmiany integratora 1–13

1. `hubDelivery.ts`: manifest S8 += `i18n-admin-journeys-{list,results,canvas,steps,publish}.ts` + `src/lib/journeys/{variables,render.server}.ts` (Z-S5-08), komentarz „Integrator S8, 2026-10-22”; `hubDelivery.gate` 51 ✓.
2. ⌘K „Nowa ścieżka komunikacji” → `/admin/revenue/journeys?new=1` (admin, redaktor; `canSeeTab("journeys")`); test odwrócony (+ autor/sam super_admin bez skrótu, parametr przechodzi `parseRevenueHubSearch`); `admin.nav.newJourney` PL/EN; test zakładki: samo `?new=1` otwiera galerię.
3. `adminRevenueHubRoutes.test.tsx`: edytor zamiast zaślepki (atrapa `getJourneyDetail`, nagłówek, „wybierz wyzwalacz”, `data-journey-id`/`data-view`).
4. `admin.crm.$id.tsx`: `LeadJourneysCard` obok `LeadStageHistoryCard` – leniwie (`lazy`+`Suspense`, słowniki ~100 KB surowe tylko na zakładce Analityka); `leadTimeline.ts`: typ `journey` (`leadTimelineEventsFromJourneys`, wejście/koniec, `summary_pl/en`, etykiety = S5 z testem zgodności, `leadJourneyTimelineTarget`); `crm.functions.ts`: `.rpc("admin_journey_lead_enrollments", { p_lead_id })` (błąd/niewdrożenie/zły kształt = oś bez wpisów); `admin.crm.index.tsx`: `tlTypes.journey`, ICONS (istniejące klasy cyan), zdanie w języku panelu; nowy `CrmJourneyActivityLink` (odnośnik do edytora na kroku `?node=&tab=contacts`) w obu widokach; testy: leadTimeline +6, crmFunctions +3, crmJourneyActivityLink 3, adminCrmLeadRoute +2, adminCrmInboxRoute +1.
5. `RevenueHubLayout.tsx`: `badges.journeys` z `journeyListQueryOptions(tenantId, null)` (po hydratacji, tylko z najemcą i rolą z zakładką; null = brak licznika); sr-only „N aktywne ścieżki” (`adminRevenue.nav.badgeJourneys_*` w `i18n-admin-revenue-shell.ts`); `activeJourneyCount` przeniesiony do liścia `src/lib/admin/journeys/activeCount.ts` (re-eksport z `summaries.ts`) – zmierzone: statyczne domknięcie układu +3,2 KB (klient server fn listy 1,9, queries 0,8, require-staff 0,3 – te same chunki co zakładka), bez `summaries`/`graph`/zod; test +6.
6. `journeysRunner.server.ts`: `journeyTestSubject` – „[TEST] ” dla `email.isTest`, PL/EN, po renderze (pusty temat dalej `subject_empty`), raz przy ponowieniu; `journeyUrlVariables` z `variables.ts` (kopia usunięta); testy +2.
7. `tabPreparing.ts`: bez wpisu `journeys`, etapu `s5s8` i odnośnika skrzynki; mapa `Partial`; molekuła zwraca `null` bez wpisu; słownik bez `what.journeys`, `stage.s5s8`, `link.outbox`; testy przepisane.
8. `tours.ts`: `JOURNEYS_TOUR_STEPS` (journeys-engine/-list/-gallery/-engine-settings), `JOURNEY_EDITOR_TOUR_STEPS` (journey-canvas/-publish), napisy `admin.onboarding.journeys*` PL/EN, test istnienia kotwic `data-tour`. Montaż w UI – otwarte Z-S8-01.
9. `CampaignBlockProperties.tsx`: `useId` + `<Label htmlFor>` dla `SelectField` i `TextField` – koniec `button-name`; test z axe; filtr axe w `EmailStepEditor.test` zdjęty.
10. `IDENTICAL_ALLOWLIST` += 15 kluczy S8; `reports/i18n-parity.json` po bramce = stan bazy (untranslated 570) – bez zmiany pliku.
11. `generate:authz-snapshot --check` ✓ (bez zmian); `generate:ts-sql-contract` 986 RPC / 1515 operacji; pgTAP `migrate` + `test ts_sql_contract` ✓ (9).
12. Ratchet D-08 `overall` 5023 → 5182 z wpisem kroniki (rozbicie przyrostu); css bez ratchetu (99,77/100). System uprawnień NIE zablokował zmiany.
13. `docs/kontynuacja/s8/` usunięty; `docs/kontynuacja/README.md` opisuje tylko S7 (s7/ nietknięty).

## (C) Bramki

| Bramka | Wynik |
| --- | --- |
| prettier zmienionych + `format:check` | ✓ |
| `verify:static` | ✓ 18 bramek (236 s; w tym rpc-contract, migration-lanes, types-freshness, ts-sql-contract --check) |
| tsgo zawężony jak w CI (`tsconfig.s8i.tmp.json`, 256 plików: zmienione od BAZY + importerzy; GOMEMLIMIT=6GiB) | ✓ 0 błędów |
| `typecheck:scripts` + `typecheck:e2e` | ✓ |
| `lint` | ✓ 0 błędów, 320 ostrzeżeń (39 w plikach S8 – react-refresh, Z-S8-06); eslint plików integracji – 0 |
| vitest (TZ=UTC, maxWorkers=2, 4 grupy z powodu restartów): lib/{admin,journeys,ci,crm,onboarding}+server | ✓ 199 plików, 5754 (+7 xfail) |
| vitest: components/admin/{journeys,revenue,newsletter,crm} | ✓ 84 pliki, 1728 |
| vitest: lib/__tests__ + src/__tests__ | ✓ 144 (+2 skip), 3750 (+12 xfail, 50 skip) |
| vitest: routes/__tests__ | ✓ 230 plików, 8084 (+79 xfail) |
| S8: 43 pliki testów, 732 testy | ✓ |
| `generate:ts-sql-contract` + pgTAP migrate + `test ts_sql_contract` (PGTAP_DIR=/tmp/pgtap-hub-s8, 5458) | ✓ 1299 migracji (znany błąd 20260825230232), 9 asercji, 986 RPC / 1515 operacji |
| build (BUNDLE_INVENTORY=1) + `check:bundle` | ✗ 5180,9 > 5023 → ✓ po ratchecie 5182 |
| `check:chunks`, `check:entry-purity`, `check:server-entry-purity` | ✓ |
| `generate:authz-snapshot --check` | ✓ |
| `hub-slice-guard S8 --base 75133fe20` | exit 1 tylko na zmianach integratora (shared: check-bundle-size, i18nParity.gate, adminNav(+test), hubDelivery, i18n-admin-core; poza manifestem: pliki CRM, hub, runner, tours, CampaignBlockProperties, tabPreparing, ich testy, docs) + `globalColors.ts` ze scalenia main (z `--base 4b1aa96d3` znika) |
| pgTAP pełny / harnessy | nie dotyczy (S8 bez SQL) |

## Bundel (gzip KB)

| Budżet | Próg przed → po | Baza 75133fe2 | S8 | Δ |
| --- | --- | --- | --- | --- |
| overall | 5023 → 5182 | 5020,6 | 5180,9 | +160,3 |
| admin-only | - | 2242,3 | 2402,3 | +160,0 |
| public | 2881 (zamr.) | 2778,3 | 2778,6 | +0,3 |
| chunk | 286 (zamr.) | 257,9 | 257,9 | 0 |
| css | 100 | 99,75 | 99,77 | +0,02 |
| publicCss | 85 (zamr.) | 83,8 | 83,8 | 0 |
| boot | 579 (zamr.) | 471,7 | 471,6 | −0,1 |

Największe chunki S8: JourneyEditor 22,4; wspólny (słowniki S5+lista, graf S5) 22,4; PredicateRow 15,2; JourneyStepSheet 12,7; RevenueJourneysTab 9,5; viewModel/ops 6,5; słowniki wyników 6,2 i publikacji 6,1. Edytor-only ok. 95 KB w 18 leniwych chunkach.

## Otwarte (dla I9 i orkiestratora)

- Z-S8-01 montaż wycieczek (P2); Z-S8-02 symulacja per predykat (RPC S5); Z-S8-03 `sendJourneyTestEmail`; Z-S8-04 odbicia twarde/miękkie; Z-S8-05 CTOR automatyzacji w rejestrze S6; Z-S8-06 39 ostrzeżeń react-refresh; Z-S8-07 Wstecz przy brudnym szkicu; Z-S8-08 wyścig realtime e2e; Z-S8-09 prefetch arkuszy; Z-S8-10 scalenie plików współdzielonych z S7.
- Dla I9: runner w `jobs-tick` + harmonogram rollup/purge (Z-S5-03), M3 (Z-S5-05, Z-S5-07), Z-I9c-06 w części SQL.
- Dla orkiestratora (scalenie S7 po S8 – konflikty spodziewane): `RevenueHubLayout.tsx` (oba dodają `tenantId` do `HubSections`; połączyć `badges` = diagnostics + journeys), `tabPreparing.ts` + `RevenueTabPreparing.tsx` + słownik + testy (po obu – mapa pusta → usunąć stan „w przygotowaniu” w całości), `adminNav.ts`/test, `i18n-admin-core.ts`, `i18nParity.gate.test.ts`, `check-bundle-size.ts` (S7 ma ratchet 5023 → 5159 – po scaleniu zmierzyć łącznie i dać nowy próg), dziennik §10 (wiersze S8 i S7), §17.6 (S7 ma też „§17.6 Stan po S7” → przenumerować na §17.7), `docs/kontynuacja/README.md` (po obu usunąć), `KONTYNUACJA`.
- hub-slice-guard: `src/lib/builder/globalColors.ts` pochodzi ze scalenia `main` (`4b1aa96d`) – nie jest zmianą S8.

## Stan drzewa

`git status` czysty (HEAD `df075ffc2`, 3 commity nad `e26fba3c8`); bez pushu. Pliki tymczasowe tylko w scratchpadzie (`tsconfig.s8i.tmp.json` usunięty). Klaster pgTAP `/tmp/pgtap-hub-s8` zostaje (po restarcie kontenera serwer nie działa).
