export const meta = {
  name: 'hub-s7-lane-resume',
  description: 'S7 (wznowienie): UI diagnostyki S7.1-ui, Społeczność/Wskaźniki S7.3b i bramki wycinka w /home/user/wt/S7',
  phases: [
    { title: 'S7.1', detail: 'diagnostyka: SQL, reguły, UI' },
    { title: 'S7.2', detail: 'Kokpit, MRR, Lejek, Dostęp, Oferta, Dane wejściowe' },
    { title: 'S7.3', detail: 'Przychód, Retencja, Społeczność, Wskaźniki, pulpit' },
    { title: 'Bramki', detail: 'pełne bramki wycinka i raport kryteriów' },
  ],
}

const WT = '/home/user/wt/S7'
const SLICE = 'S7'
const BASE = '75133fe20'

const RESULT = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'partial', 'failed'] },
    head_sha: { type: 'string' },
    commits: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    deviations: { type: 'array', items: { type: 'string' } },
    integration_requests: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, change: { type: 'string' } }, required: ['file', 'change'] } },
    acceptance: { type: 'array', items: { type: 'object', properties: { criterion: { type: 'string' }, status: { type: 'string' }, evidence: { type: 'string' } }, required: ['criterion', 'status', 'evidence'] } },
    gates: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, result: { type: 'string' } }, required: ['name', 'result'] } },
    open: { type: 'array', items: { type: 'string' } },
  },
  required: ['status', 'head_sha', 'commits', 'summary', 'files', 'deviations', 'integration_requests', 'acceptance', 'gates', 'open'],
}

function common(id, tmpid) {
  return `Jesteś agentem implementującym podzadanie ${id} wycinka ${SLICE} modułu „Przychód i lejek” (panel admina NES – think-tank/wydawca analiz; hub /admin/revenue) w repo NewEUStrategies/neweustrategies-dc633fb5. Stos: TanStack Start (SSR), React Query, Supabase/Postgres (RLS, RPC, pgTAP), bun, vitest, tsgo, i18n PL/EN. Pracuj po polsku. Wynik zwracasz narzędziem StructuredOutput (raport dla integratora).

ŚRODOWISKO
- Pracujesz WYŁĄCZNIE w worktree ${WT} (baza wycinka BAZA=${BASE}). KAŻDE polecenie Bash zaczynaj od "cd ${WT} && ..." (katalog roboczy się resetuje). Nie pushujesz, nie zmieniasz gałęzi, nie robisz rebase/reset/stash/merge/checkout cudzych plików, nie usuwasz cudzych plików. Katalogu _kontynuacja/ (materiały robocze) nie commitujesz.
- W tym samym worktree może RÓWNOLEGLE pracować inny agent nad rozłącznymi plikami, a inne worktree (/home/user/wt/*) należą do innych agentów. Commituj WYŁĄCZNIE swoje pliki: "git add <konkretne ścieżki>" + "git commit" (nigdy git add -A / git add . / git commit -a). Przy błędzie index.lock odczekaj 5 s i ponów. Niezacommitowanych plików spoza Twojej listy nie ruszaj i nie commituj.
- Zasoby wspólne (4 rdzenie, 15 GB RAM, kilku agentów naraz): ciężkie polecenia WYŁĄCZNIE pod "flock -x /tmp/hub-heavy.lock" (każdy tsgo, bun run build, format:check, verify:static, pełny lint, vitest > 10 plików lub --maxWorkers=2); małe vitest (≤ 10 plików, --maxWorkers=1) oraz eslint/prettier pojedynczych plików pod "flock -s /tmp/hub-heavy.lock"; pgTAP pod "flock -x /tmp/hub-pgtap.lock"; harnessy pod "flock -x /tmp/hub-harness.lock". Nigdy tsgo na całym repo.

ŹRÓDŁA (czytaj sekcjami: grep -n '^#' plik, potem sed -n 'a,bp'; nie wczytuj całych wielkich plików naraz)
- ${WT}/docs/kontynuacja/s7/STAN_S7.md – podział S7 na podzadania (owned_files, scope, acceptance, tests: sekcje "### S7.1", "### S7.2", "### S7.3"), oczekiwane zmiany integratora, ryzyka, wersje migracji.
- ${WT}/docs/kontynuacja/s7/S7.md – pakiet kontekstu S7: §1 SPEC dla S7 (karta dosłownie, §5.7 diagnostyka, §6.4 dialogi napraw, komponenty, §6.2/6.5/6.7/6.8, IA/URL, synchronizacja §3, baza §4, warstwa TS, defekty §7), §2 stan plików, §3 kontrakt danych (finanse S2, lejek/dostęp S3, społeczność S4, e-mail S1, migawka i rejestr wskaźników S6, RPC, wyciszenia, mutatory modułów, ścieżki S5), §4 zgłoszenia, §5 Insider i RevenueFacts v1, §6 manifest i zmiany integratora, §7 wersje migracji, §8 decyzje, §9 ryzyka, §10 weryfikacja, §11 podział.
- Decyzje wiążące z promptu przekazania: kolejność wersji = kolejność dziennika drizzle; blok 15 (20261020150000_revenue_facts.sql, 20261020150050_revenue_facts_operations.sql, 20261020150100_revenue_diagnostic_snoozes.sql) przed blokiem 16; funkcje S7 w plpgsql; fakty NIE czytają obiektów bloku 16 (data_retention_*, funnel_paywall_daily, metering_events_daily, newsletter_campaign_engagement_archive, crm_leads.anonymized_at) i nie wołają jego funkcji (np. _funnel_counts); S7 nie dodaje tabel ani kolumn; pgTAP nie zakłada created_by NOT NULL w revenue_diagnostic_snoozes.
- Tylko do odczytu: dziennik docs/WDROZENIE_HUB_PRZYCHOD_LEJEK_2026-10.md (wzór §18–§21), src/lib/ci/hubDelivery.ts (manifest S7, HUB_FACT_AREAS, FUNCTION_TABLE, bloki wersji). Nie czytaj całego SPEC (370 KB) – pakiet ma wyciągi; do SPEC sięgaj tylko po konkretną sekcję (grep).

ZASADY KODU (obok AGENTS.md, który masz w kontekście)
- Wszystko operowalne z panelu admina dla właściwych ról; role z dokładnych "roles" (useAuth), nie z isAdmin/isSuperAdmin; useHydrated przy treści zależnej od sesji i bramkach klubów; stany forbidden / unavailable / mfa_required (MfaRequiredNotice) / pusty jako stany kart, nie toasty; editor nie widzi kwot (LockedMetricTile, bez wywołania RPC finansowego).
- Wspólne atomy UI (src/components/ui: TimeInput, DateInput, PlatformSelect, Popover, Sheet, Switch, Checkbox, Tooltip, Accordion) i atomy/molekuły huba S6 (KpiTile z metricId, MetricExplainer, BenchmarkScale, BenchmarkTierBadge, SourceHeader, RelatedModulesBar, RoleGateNotice, MetricTooltip, ProvenanceNote, AreaHealthList, ChartCard + biChart, FunnelBars). Geometria identyczna w light/dark (różnią się tylko kolory/tokeny); reużywaj istniejących klas (budżet css); dostępność: role, aria, fokus, klawiatura, tabele z caption/scope; testy axe bez naruszeń; daty lokalne (YYYY-MM-DD/YYYY-MM bez przesunięć strefy).
- Zapytania wyłącznie przez fabryki kluczy (revenueKeys itd.) i istniejące queryOptions/mutatory modułów (pisarze z HUB_SYNC_MANIFEST); zero literałów kluczy (bramki queryKeyLiterals, revenueKeysReuse); brak queryFn w komponentach; zdarzenia domenowe i mapa inwalidacji.
- i18n PL/EN: plik słownika wg wzoru src/lib/i18n-admin-journeys-list.ts ("const en: typeof pl", ensureI18n() przy imporcie i w komponencie, eksport słowników dla testów); liczebniki PL _one/_few/_many/_other, EN _one/_other; ZERO kolizji z istniejącymi kluczami (grep po wszystkich src/lib/i18n-*.ts – bramka i18nOverlayIntegrity; nie dubluj adminRevenue.area/severity/finance/funnel/access/community… z S2/S3/S4/S6); każdy klucz ma czytelnika (overlayReaders); zakaz "lang === 'pl' ?" i L(pl,en); w napisach EN unikaj słów równych klasom narzędziowym Tailwinda (publiczny CSS – limit publicCss zamrożony).
- Liczb benchmarków NIE wymyślasz – wyłącznie rejestr S6 (useBenchmark / evaluateMetricValue / metricById) i docs/benchmarki/**. Progi operacyjne bez źródła = nazwane stałe z komentarzem DLACZEGO albo stan unknown. Kwoty per waluta – nigdy suma walut; null ≠ 0; brak liczby = „-” z powodem; historia krótsza niż wymagana = „dane od …”, nigdy 0.
- Kod panelu wyłącznie w leniwych chunkach admina (budżet D-08: public 2881, publicCss 85, chunk 286, boot 579 ZAMROŻONE; overall/css ratchetuje integrator). Moduły *.server tylko dynamicznym import() w handlerze server fn. Server fn: requireCrmStaff / bramki ról, najemca i użytkownik WYŁĄCZNIE z sesji.
- Komentarze w kodzie po polsku, wyjaśniające DLACZEGO, gęstość jak w otoczeniu; kod czytelny jak otoczenie.
- Testy dla wszystkiego, co dodajesz (vitest, RTL + axe). Wzory: src/components/admin/revenue/molecules/__tests__/RevenueTabPreparing.test.tsx (realT z @/test/i18nReal, RouterLinkStub z @/test/routerLinkStub, axeViolations/summarize z @/test/axe), @/test/renderWithQueryClient, @/test/serverFn, @/test/supabaseChain, @/test/middlewareHarness. Fikstury "as const" kopiowane przez JSON: pomocnik clone zwraca unknown. TZ=UTC.

ZASADY SQL (gdy dotykasz SQL): plik ≤ 45 KiB (bun run scripts/split-migration.ts <plik> --dry-run), nazwa wersja14cyfr_nazwa.sql (małe litery, cyfry, _), idempotentne (CREATE OR REPLACE, IF NOT EXISTS, DROP … IF EXISTS); polski nagłówek DEFEKT/ZMIANA/KOLEJNOSC/IDEMPOTENTNA/DOWOD (wzór supabase/migrations/20261012131000_sms_send_log.sql); "-- CIALO-Z: <wersja>" przy redefinicji istniejącej funkcji (najnowsza wcześniejsza definicja – grep po WSZYSTKICH migracjach); SECURITY DEFINER zawsze z SET search_path = public, pg_temp; REVOKE/GRANT wg FUNCTION_TABLE w hubDelivery.ts (server-only = service_role; RPC panelu: REVOKE FROM PUBLIC, anon + GRANT authenticated, service_role); tenant i user z sesji (current_tenant_id(), is_admin_or_editor() / has_role(auth.uid(),'admin'), auth.uid()), nigdy z payloadu; literalne nazwy RPC/tabel w TS (bramka generate:ts-sql-contract); znacznik harnessu: migracja wspominająca career_*/contact_messages/event_*/club_*, która sięga też poza te moduły → "-- pg-harness: exclude" (lub "-- careers-harness: exclude") jako OSOBNA linia komentarza w nagłówku z uzasadnieniem (wzór 20261020160900); migracje bloku 15 nie są jeszcze wypchnięte – wolno je zmieniać. Nie dopisujesz supabase/migration-ledger.json; bliźniaki drizzle, types.ts i ts_sql_contract_test.sql robi integrator.
pgTAP: export PGTAP_DIR=/tmp/pgtap-hub-s7 PGTAP_PORT=5457; flock -x /tmp/hub-pgtap.lock bash scripts/pgtap-local/run.sh all (pełne odtworzenie migracji + suita), potem celowane: flock -x /tmp/hub-pgtap.lock bash scripts/pgtap-local/run.sh test <wzorzec>. Znane błędy środowiska (nie naprawiaj): 3 asercje pg_net (community_cron_schedule, job_scheduler_heartbeat), public_definer_views_read_only 1/35, profile_intent_semantic (vector), migracja 20260825230232.

PLIKI WSPÓŁDZIELONE I CUDZE – NIE EDYTUJESZ (zmianę opisz dokładnie w integration_requests: plik + konkretny diff/opis; wykona ją integrator): src/routeTree.gen.ts, src/routes/**, src/lib/admin/adminNav.ts (+ test), src/lib/i18n-admin-core.ts, src/integrations/supabase/types.ts, src/lib/realtime/**, jobsTick/scheduler, scripts/**, reports/** (bramka i18nParity przepisuje reports/i18n-parity.json – nie commituj go), src/__tests__/**, authzSnapshot, ownership, CODEOWNERS, src/lib/ci/hubDelivery.ts, drizzle/**, supabase/migration-ledger.json, supabase/tests/ts_sql_contract_test.sql, docs/**, src/components/admin/revenue/organisms/**, src/lib/admin/revenue/tabPreparing.ts, src/lib/i18n-admin-revenue-preparing.ts, src/components/admin/dashboard/__tests__/dashboardPanels.test.tsx, moduły źródłowe (paywall, cennik, CRM, newsletter, przepisy, wydarzenia, kluby) oraz każdy plik spoza Twojej listy (o ile ta instrukcja wprost nie pozwala).

BRAMKI LEKKIE – przed każdym commitem, wszystkie zielone:
1) cd ${WT} && flock -s /tmp/hub-heavy.lock bunx prettier --write <Twoje pliki> && flock -s /tmp/hub-heavy.lock bunx eslint <Twoje .ts/.tsx>
2) typecheck zawężony jak w CI (lokalny tsgo inaczej nie widzi części błędów zgłaszanych przez CI):
   cat > tsconfig.${tmpid}.tmp.json <<'EOF'
   {"extends": "./tsconfig.json", "compilerOptions": {"incremental": false},
    "include": ["src/**/*.d.ts", "src/routeTree.gen.ts", "vitest.setup.ts", <Twoje .ts/.tsx>, <pliki je importujące (grep -rl)>]}
   EOF
   flock -x /tmp/hub-heavy.lock env GOMEMLIMIT=6GiB bunx tsgo --noEmit -p tsconfig.${tmpid}.tmp.json; rm -f tsconfig.${tmpid}.tmp.json
   (bez vitest.setup.ts matchery jest-dom dają fałszywe błędy; plik tmp nigdy nie trafia do commita)
3) TZ=UTC flock -s /tmp/hub-heavy.lock bunx vitest run --maxWorkers=1 <Twoje testy, ≤ 10 plików na wywołanie>
4) gdy dotykasz słownika/zapytań: TZ=UTC flock -s /tmp/hub-heavy.lock bunx vitest run --maxWorkers=1 src/__tests__/i18nParity.gate.test.ts src/lib/__tests__/i18nOverlayIntegrity.gate.test.ts src/lib/__tests__/overlayReaders.test.ts src/lib/__tests__/queryKeyLiterals.gate.test.ts src/routes/__tests__/adminRouteAuthority.gate.test.ts (oraz bramka revenueKeysReuse, jeśli istnieje – grep)
5) bun run scripts/hub-slice-guard.ts ${SLICE} --base ${BASE}  (naruszenia dopuszczalne tylko dla plików, które zgłaszasz integratorowi – wypisz je w open)

COMMIT: po polsku "hub(${SLICE}): <co i po co>", treść z wypunktowaniem zakresu i odchyleń, zakończona DOKŁADNIE liniami:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TguECirxRRzWuhfPrnn48H
(git commit -F <plik z wiadomością w /tmp>). Możesz robić kilka commitów; ostatni zostawia zielone bramki.

RAPORT (StructuredOutput): status (done | partial | failed), head_sha, commits, summary (zakres, decyzje, API, które importują kolejni agenci), files, deviations (odchylenia od SPEC/pakietu z uzasadnieniem – trafią do dziennika), integration_requests (plik + dokładna zmiana), acceptance (każde kryterium Twojej części karty: spełnione/niespełnione + dowód: test/plik), gates (nazwa + wynik), open (co zostało, ryzyka). Nie pisz "done", jeśli bramki są czerwone albo czegoś nie zrobiłeś.
`
}

const T_LIB = `ZADANIE: S7.1-lib – dokończenie diagnostyki (część danych): SQL faktów i wyciszeń + pgTAP, silnik 54 reguł, rejestr, mapy, server fn, queries, quickFixes/diagnosticGroups, słownik diagnostyki. Zakres i kryteria: STAN_S7.md "### S7.1" (przeczytaj CAŁĄ sekcję; pkt (6) UI robi później agent S7.1-ui).
STAN WYJŚCIOWY: poprzednia sesja przerwała S7.1 w trakcie – w worktree są NIEZACOMMITOWANE pliki (git status): migracje 20261020150000/150050/150100, supabase/tests/revenue_{facts,diagnostic_snoozes}_test.sql, src/lib/revenue/diagnostics/** (facts, registry, surfaces, defectMap, diagnostics.functions, queries, checks/16 plików, testy checks/facts/registry), src/lib/admin/revenue/{quickFixes,diagnosticGroups}.ts, src/lib/i18n-admin-revenue-diagnostics.ts oraz pliki UI (src/components/admin/revenue/{diagnostics/**,overview/AttentionCard.tsx,molecules/RevenueSignalChip.tsx}, tabs/RevenueDiagnosticsTab.tsx). Mogły zostać przerwane w połowie – przejrzyj i DOKOŃCZ, nie zaczynaj od zera.
Twoje pliki: migracje bloku 2026102015 (wolno dodać kolejną wersję w 2026102015 przy > 45 KiB), 2 pliki pgTAP, src/lib/revenue/diagnostics/** (bez __tests__/hubLinksContract.test.ts – to S7.3b), src/lib/admin/revenue/{quickFixes,diagnosticGroups}.ts + __tests__/{quickFixes,diagnosticGroups}.test.ts, src/lib/i18n-admin-revenue-diagnostics.ts. Plików UI NIE commitujesz (robi je S7.1-ui), ale ich nie łam: publiczne API (eksporty) queries.ts, facts.ts, registry.ts, quickFixes.ts, diagnosticGroups.ts zmieniaj tylko addytywnie – równolegle agent S7.2 importuje revenueFactsQueryOptions/evaluateFindings/typy faktów i AttentionCard; jeśli zmiana nazwy jest konieczna, opisz ją w summary.
Brakujące testy (lista "tests" sekcji S7.1): defectMap.test.ts (każdy ID z tabeli §7 SPEC i listy odłożonych → checkId | 'fixed:<wycinek>' | 'deferred'), diagnostics.functions.test.ts (42501 → forbidden, 42883/PGRST202 → unavailable, 'mfa_required' → stan MFA, zod na REVENUE_LIMITS – odrzucenie zamiast przycięcia), queries.test.ts (evaluateFindings, select po obszarach, licznik paska useDiagnosticsBadgeCount = otwarte critical+warning bez aktywnych wyciszeń – Z-S6-08, mutatory wyciszeń inwalidują facts+snoozes), snoozeParity.test.ts (lista niewyciszalnych SQL = lustro TS – parsuj migrację), i18n.test.ts (każdy RevenueCheckId i RevenueFixDialogId ma klucz PL i EN, różny), quickFixes.test.ts (każda naprawa fix.kind=dialog ma dokładnie jeden QuickFixSpec, importuje mutator z HUB_SYNC_MANIFEST.writers, bez własnego .from(...).update; każdy użyty mutator używa także moduł źródłowy), diagnosticGroups.test.ts; checks.test.ts – KAŻDA reguła (54 + opcjonalna catalog.team_seats_over_cap dla Z-I9b-06: alert odrzuconych synchronizacji / miejsc Zespołu > 20) ma przypadek ok/warn/error/unknown, brak pola = unknown. Prompt przekazania wymaga m.in. reguł: checkout.display_currency_mismatch (P09, Z-S3-03), paywall.members_rank_no_cta (regresja P14), funnel.signup_popup_for_members (regresja P17), checkout.abandon_window_default (dialog okna porzucenia).
pgTAP (kryteria S7.1): revenue_facts_test.sql i revenue_diagnostic_snoozes_test.sql zielone (2 najemców, editor bez kwot, brak PII, kształt v:1, czas < statement_timeout; wyciszenia admin-only, days ≤ 180, intentional z hash+powodem, krytyczne sync/data_quality niewyciszalne, zdarzenie revenue_diagnostic.snoozed.v1 z dozwolonymi kluczami payloadu, unsnooze; ACL: anon bez EXECUTE, _revenue_facts_* bez EXECUTE dla authenticated).
Bramki dodatkowe (SQL): pełny pgTAP (all) pod blokadą, split-migration --dry-run każdego pliku, harnessy (flock -x /tmp/hub-harness.lock bun run check:pg-harness; check:careers-harness; check:events-harness), kontrole SQL: for c in sql-tenant-scope sql-app-role sql-anon-insert sql-definer-views on-conflict-arbiters sql-owner-tenant-scope sql-policy-tenant-regression sql-migration-replay; do bun run check:$c; done; bun run check:rpc-contract i bun run check:migration-lanes (czerwień wyłącznie z braku sygnatur w types.ts / bliźniaków drizzle – zgłoś integratorowi z dokładną treścią). Analiza src/lib/ci/hubDelivery.ts (bramka hubDelivery.gate test: src/lib/ci/__tests__) bez [bez-wlasciciela]/[brak-revoke]/[zly-blok]. Commit(y) "hub(S7): …".`

const T_S72 = `ZADANIE: S7.2 – Kokpit, most MRR, Lejek, Dostęp, Oferta, Dane wejściowe i słownik zakładek. Zakres, pliki (owned_files), kryteria i testy: STAN_S7.md "### S7.2" (przeczytaj CAŁĄ sekcję) oraz:
- Słownik src/lib/i18n-admin-revenue-tabs.ts (const en: typeof pl) – gałęzie adminRevenue.{overview, offer, inputs, funnelTab, accessTab} ORAZ klucze ZAREZERWOWANE dla S7.3 (adminRevenue.mrr.*, .retention.*, .metrics.*, .communityTab.* – lista w STAN_S7); bez dublowania kluczy S2/S3/S4/S6.
- src/lib/admin/revenue/overviewTiles.ts (kafle z metricId: zestaw admin 6 z kwotami / editor 6 bez kwot, MRR_KPI_TILES, RETENTION_KPI_TILES; revenue_realized z migawki – revenueSnapshotQueryOptions, ten sam klucz co BI; drillHref wyłącznie do tras z routeTree.gen.ts), policySentence.ts, paywallChecklist.ts + testy (revenueTilesHaveMetric.test.ts czyta routeTree.gen.ts).
- Kokpit (RevenueOverview z AttentionCard z S7.1 i AreaHealthList S6, GettingStartedCard, karty skrótu Ścieżek i Społeczności), MrrBridgeCard (warianty full|compact z tym samym kluczem; start + Σ = end w stopce, rozjazd > 0,5 % = baner), zakładki Lejek (queryOptions z src/lib/revenue/funnel/queries.ts; przejście między strumieniami bez ilorazu; etap aktywacji = „brak definicji”; mini lejek w Kokpicie = ten sam organizm i klucz), Dostęp (PolicySentence, lista kontrolna, AccessInventoryTable, symulator czytelnika = ten sam moduł <Paywall> w trybie preview bez efektów: brak record_paywall_hit i track – test tożsamości importu), Oferta (macierz plan × benefit z konfliktami P20, tabela a11y, Accordion < 768 px, PriceLadder; editor disabled + Tooltip), Dane wejściowe (tylko admin; Z-S2-06: new_customers_plan to LICZBA – opis pola; za długa notatka odrzucona bez slice; współbieżność → konflikt; daty YYYY-MM lokalne).
- Zakładki: src/components/admin/revenue/tabs/Revenue{Overview,Funnel,Access,Offer,Inputs}Tab.tsx – zachowaj istniejące eksporty i data-testid zakładek, usuń z nich RevenueTabPreparing (stan „w przygotowaniu”), useHydrated, role dokładne, RoleGateNotice.
STAN: w worktree są niezacommitowane pliki S7.1 (pracuje nad nimi równolegle agent S7.1-lib, potem S7.1-ui) – importuj z nich (src/lib/revenue/diagnostics/queries.ts: revenueFactsQueryOptions/evaluateFindings; src/components/admin/revenue/overview/AttentionCard.tsx), ale ich NIE edytujesz i NIE commitujesz. Testy w plikach spoza listy, które pękną po podmianie zaślepek (src/routes/__tests__/adminRevenueHubRoutes.test.tsx, src/lib/admin/revenue/__tests__/tabPreparing.test.ts) – zgłoś integratorowi z dokładnym diffem.`

const T_UI = `ZADANIE: S7.1-ui – dokończenie diagnostyki (część UI): zakładka Diagnostyka, dialogi szybkich napraw, RevenueSignalChip, AttentionCard, testy. Zakres: STAN_S7.md "### S7.1" pkt (6)–(7) i kryteria; SPEC §5.7/§6.4 (pakiet §1.2–1.3).
STAN: agent S7.1-lib zacommitował SQL, src/lib/revenue/diagnostics/**, quickFixes/diagnosticGroups i słownik diagnostyki (git log). W worktree zostały NIEZACOMMITOWANE pliki UI z poprzedniej sesji: src/components/admin/revenue/diagnostics/** (DiagnosticsBoard, DiagnosticCard, QuickFixDialog, SnoozeDialog, SystemMapGrid, findingText, fixes/*), src/components/admin/revenue/molecules/RevenueSignalChip.tsx, src/components/admin/revenue/overview/AttentionCard.tsx, src/components/admin/revenue/tabs/RevenueDiagnosticsTab.tsx – przejrzyj, DOKOŃCZ (mogły zostać przerwane w połowie), nie zaczynaj od zera. AttentionCard importuje już Kokpit S7.2 (zacommitowany) – nie łam jego propsów.
Twoje pliki: powyższe + testy: src/components/admin/revenue/diagnostics/__tests__/{DiagnosticsBoard,DiagnosticCard,QuickFixDialog,SystemMapGrid,RevenueDiagnosticsTab}.test.tsx, src/components/admin/revenue/molecules/__tests__/RevenueSignalChip.test.tsx (zero dodatkowych żądań przy ciepłym cache – test z QueryClient i licznikiem wywołań queryFn), src/components/admin/revenue/overview/__tests__/AttentionCard.test.tsx; wolno Ci dopisywać klucze do src/lib/i18n-admin-revenue-diagnostics.ts (gałęzie diagnostyki – nie dubluj adminRevenue.area/severity z S6).
Kryteria m.in.: filtry ?area, waga, stan; ?view=list|map; ?finding= fokus; ?fix= otwiera dialog i sprawdza, czy reguła nadal aktywna („Ten problem już nie występuje”); pętla naprawa → ponowne sprawdzenie (refetchQueries revenueKeys.facts) z komunikatem aria-live zgodnym ze stanem („✓ problem zniknął” / „! zapisano, ale problem nadal występuje”); „Cofnij” 60 s dla zmian odwracalnych; konflikt (0 wierszy/40001) → RevisionDiffDialog; brak roli → „Zastosuj” disabled + Tooltip; naprawa kodem → „Zgłoś do zespołu” kopiuje opis z dowodem; wyciszanie tylko admin (editor: przycisk disabled + Tooltip); SystemMapGrid z HUB_SYNC_MANIFEST (tabela caption/scope); fixes/* jako React.lazy; brak queryFn i literałów kluczy w komponentach (bramka revenueKeysReuse); RevenueDiagnosticsTab zachowuje data-testid="revenue-tab-diagnostics" i eksport, bez RevenueTabPreparing, useHydrated, RoleGateNotice; RevenueSignalChip warianty bar|chip, link do /admin/revenue/diagnostics?area=; axe bez naruszeń. Licznik paska huba i chipy w modułach to pliki integratora – podaj dokładne diffy.`

const T_S73A = `ZADANIE: S7.3a – zakładki Przychód (MRR) i Retencja. Zakres, kryteria, testy: STAN_S7.md "### S7.3" pkt (1)–(2) i odpowiadające kryteria (resztę S7.3 robi później agent S7.3b).
- Przychód (admin): wiersz KPI z MRR_KPI_TILES (overviewTiles z S7.2; kwoty z migawki, przychód zrealizowany z revenueSnapshotQueryOptions – ten sam klucz co BI), MrrSeriesCard (revenueMrrSeriesQueryOptions, ziarno, strefa, dryf migawki), montaż MrrBridgeCard full (S7.2), MrrMovementsTable (ruchy per rodzaj/powód/waluta, caption/scope), RealizedRevenueCard (revenueRealizedQueryOptions per kategoria i waluta, NIGDY suma walut; unknownEnvironmentDocuments), RevenueReconciliationCard (dokumenty vs zamówienia, VerdictBadge), ProvenanceNote; queryOptions z src/lib/revenue/finance/queries.ts (Z-S2-12).
- Retencja (admin): ChurnTrendCard, CohortHeatmapCard (heatmap), DunningCard, RetentionOffersCard, CancellationFlowView (≤ 2 kroki), ChurnReasonsCard (Z-S2-04: not_given poza rankingiem jako reasonNotGiven + Hint, stripe:<code> jako „Stripe portal: <code>”); NRR/GRR/kohorty przed 12 mies. od data_since = „dane od …” (ProvenanceNote FULL_HISTORY_MONTHS), NIGDY 0; null ≠ 0; Z-S2-05 (ratio_currency).
Twoje pliki: src/components/admin/revenue/mrr/** (POZA MrrBridgeCard.tsx i jego testem – S7.2), src/components/admin/revenue/retention/**, src/components/admin/revenue/tabs/{RevenueMrrTab,RevenueRetentionTab}.tsx + testy (RevenueMrrTab, RealizedRevenueCard, MrrMovementsTable, RevenueRetentionTab, CohortHeatmapCard, ChurnReasonsCard). Zakładki: zachowaj eksporty i data-testid, usuń RevenueTabPreparing, useHydrated, role dokładne, RoleGateNotice (editor – brak dostępu do kwot).
Słownik: klucze zarezerwowane przez S7.2 w src/lib/i18n-admin-revenue-tabs.ts (adminRevenue.mrr.*, .retention.*), adminRevenue.finance.* (S2), powłoka S6 (provenance, money, locked, role), etykiety metricById; brakujący napis WOLNO Ci dopisać do src/lib/i18n-admin-revenue-tabs.ts wyłącznie w gałęziach adminRevenue.mrr i adminRevenue.retention (PL i EN).`

const T_S73B = `ZADANIE: S7.3b – Społeczność, Wskaźniki, pulpit marketingu, indeks ⌘K wskaźników, scenariusze synchronizacji, kontrakt linków huba. Zakres: STAN_S7.md "### S7.3" pkt (3) i dalej + wszystkie kryteria S7.3 (Przychód i Retencję zrobił S7.3a – przeczytaj jego commit):
- Społeczność (admin, editor bez kwot): ?sec=events|clubs, EventsRevenueCard (per waluta), ClubApplicationsFunnelCard (za useHydrated; clubs_enabled=false → tylko Wydarzenia + adminRevenue.community.clubsDisabled), PlanTicketPoolCard; revenueEventsSummaryQueryOptions / revenueClubsSummaryQueryOptions (Z-S4-07).
- Wskaźniki: MetricDictionaryView (MetricDictionary S6 z values: ReadonlyMap<MetricId, number|null> z wpisów migawki i samples; ocena 5 progów S6; benchmarki z rejestru S6; ?metric=&ctx= w URL; „brak danych” mówi, czego brakuje, z linkiem do Danych wejściowych).
- MarketingPanel (src/components/admin/dashboard/MarketingPanel.tsx): przychód zrealizowany spod IDENTYCZNEGO klucza co hub i BI (test porównuje queryKey) + __tests__/MarketingPanel.realized.test.tsx.
- src/lib/admin/revenue/metricSearchIndex.ts (+ test): skróty wskaźników do ⌘K (np. „NRR · Wskaźniki” → /admin/revenue/metrics?metric=net_revenue_retention); wpięcie w adminNav robi integrator – podaj dokładny diff.
- Testy: src/lib/revenue/__tests__/syncScenarios.test.ts (SPEC §3.5 S-A…S-F), src/lib/revenue/diagnostics/__tests__/hubLinksContract.test.ts (każdy drillHref i link huba wskazuje trasę z routeTree.gen.ts i parametr z kontraktu §2.6), src/lib/admin/revenue/__tests__/sourceHeaderOnMutations.test.ts.
- Liczniki paska huba (Z-S6-08), kopie kafli na KpiTile (Z-S6-12), czytelnicy surowych zdarzeń kampanii → archiwum/rollup tam, gdzie S7 ich dotyka (Z-I9c-05): w plikach spoza Twojej listy – zgłoszenie z dokładnym diffem.
Twoje pliki: src/components/admin/revenue/{community,metrics}/**, src/components/admin/revenue/tabs/{RevenueCommunityTab,RevenueMetricsTab}.tsx, MarketingPanel.tsx + test, metricSearchIndex.ts + test, powyższe 3 testy; wolno Ci dopisać napisy do src/lib/i18n-admin-revenue-tabs.ts wyłącznie w gałęziach adminRevenue.metrics i adminRevenue.communityTab. Zakładki: zachowaj eksporty i data-testid, usuń RevenueTabPreparing, useHydrated, role dokładne. src/components/admin/dashboard/__tests__/dashboardPanels.test.tsx (MarketingPanel bez QueryClientProvider) – plik spoza listy: zgłoś integratorowi dokładny diff.`

function gatesPrompt(prev) {
  return `ZADANIE: S7-bramki – pełna weryfikacja wycinka S7 (bez integracji plików współdzielonych) i raport kryteriów karty S7.
Wyniki poprzednich agentów S7 (JSON – integration_requests, odchylenia, otwarte sprawy):
${JSON.stringify(prev)}

Kroki:
(1) Przeczytaj kartę S7 (pakiet §1.1 dosłownie) i kryteria S7.1–S7.3 w STAN_S7.md. Sprawdź git status: wszystkie pliki S7 mają być zacommitowane (poza _kontynuacja/ i plikami tmp); niezacommitowane pliki S7 – przejrzyj, dokończ, zacommituj.
(2) Uruchom po kolei (każde raz; po poprawce powtarzasz tylko czerwone i dotknięte testy):
 flock -x /tmp/hub-heavy.lock bun run format:check
 flock -x /tmp/hub-heavy.lock bun run verify:static
 typecheck zawężony (pkt 2 bramek) na WSZYSTKICH plikach .ts/.tsx zmienionych od BAZY (git diff --name-only ${BASE}..HEAD) i ich importerach (grep -rl)
 bun run typecheck:scripts && bun run typecheck:e2e
 flock -x /tmp/hub-heavy.lock bun run lint
 flock -x /tmp/hub-heavy.lock env TZ=UTC bunx vitest run --maxWorkers=2 src/lib/revenue src/lib/admin src/components/admin/revenue src/components/admin/dashboard src/lib/ci src/lib/__tests__ src/routes/__tests__ src/__tests__/i18nParity.gate.test.ts
 export PGTAP_DIR=/tmp/pgtap-hub-s7 PGTAP_PORT=5457; flock -x /tmp/hub-pgtap.lock bash scripts/pgtap-local/run.sh all  (znane błędy środowiska – patrz wyżej)
 for f in supabase/migrations/2026102015*.sql; do bun run scripts/split-migration.ts "$f" --dry-run; done
 for c in sql-tenant-scope sql-app-role sql-anon-insert sql-definer-views on-conflict-arbiters sql-owner-tenant-scope sql-policy-tenant-regression sql-migration-replay; do bun run check:$c; done; bun run check:rpc-contract; bun run check:migration-lanes
 flock -x /tmp/hub-harness.lock bun run check:pg-harness && flock -x /tmp/hub-harness.lock bun run check:careers-harness && flock -x /tmp/hub-harness.lock bun run check:events-harness
 bun run scripts/hub-slice-guard.ts S7 --base ${BASE}
 flock -x /tmp/hub-heavy.lock env BUNDLE_INVENTORY=1 bun run build && bun run check:bundle; bun run check:chunks; bun run check:entry-purity; bun run check:server-entry-purity
 bun run generate:authz-snapshot --check
(3) Czerwone w plikach S7 – napraw przyczynę (nie pomijaj/nie wyłączaj testów) i commituj "hub(S7): poprawki bramek – …". Czerwone wynikające wyłącznie z braku zmian integratorskich (bliźniaki drizzle, types.ts, ts_sql_contract, adminRevenueHubRoutes.test.tsx, tabPreparing, dashboardPanels.test.tsx, adminNav, ratchet overall/css, authz snapshot, allowlista i18nParity, licznik paska w RevenueHubLayout) – NIE naprawiasz, tylko dokładny diff w integration_requests. public/publicCss/chunk/boot MUSZĄ być w progach – inaczej popraw kod S7.
(4) Raport: integration_requests = połączona lista WSZYSTKICH podzadań S7 (z JSON wyżej i z STAN_S7.md „Oczekiwane zmiany plików współdzielonych”, bez duplikatów, aktualne i dokładne) + Twoje; deviations = połączone odchylenia S7.1–S7.3 do dziennika (m.in. liczba reguł, brak proposal_dane/briefów, lista rdzenia ścieżek, 55. reguła, wariant klucza przychodu zrealizowanego); acceptance = KAŻDE kryterium karty S7 (pakiet §1.1) [spełnione/niespełnione] z dowodem; gates = tabela wszystkich bramek z wynikami (pgTAP: liczby testów/asercji, tylko znane błędy środowiska) + pomiar bundla (overall, css, public, publicCss, chunk, boot: zmierzone/próg); open = otwarte sprawy.`
}

async function run(label, phase, prompt, deps) {
  const ds = await Promise.all(deps || [])
  const bad = ds.filter(d => !d || d.status === 'failed' || d.status === 'skipped')
  if (bad.length) {
    log(`${label}: pomijam – zależność nieudana (${bad.map(b => b && b.label).join(', ')})`)
    return { label, status: 'skipped' }
  }
  const r = await agent(prompt, { label, phase, schema: RESULT })
  if (!r) { log(`${label}: agent nie zwrócił wyniku`); return { label, status: 'failed' } }
  log(`${label}: ${r.status} @ ${r.head_sha}`)
  return { ...r, label }
}

const RESUME = (done) => `

UWAGA – WZNOWIENIE: poprzedni agent tego podzadania przerwał na limicie tokenów sesji. W worktree mogą być jego częściowe, NIEZACOMMITOWANE pliki z Twojej listy (git status) – przejrzyj je, dokończ i zacommituj; nie zaczynaj od zera i nie kasuj ich bez powodu. Zakończone i zacommitowane wcześniej podzadania tego wycinka: ${done}.`
const brief = (rs) => rs.map(r => ({ label: r.label, status: r.status, head: r.head_sha, summary: r.summary, integration_requests: r.integration_requests, deviations: r.deviations, open: r.open }))

const pUi = run('S7.1-ui', 'S7.1', common('S7.1-ui', 's71u') + '\n' + T_UI + RESUME('S7.1-lib (SQL, reguły, słownik), S7.2 (Kokpit, MRR, Lejek, Dostęp, Oferta, Dane wejściowe), S7.3a (Przychód, Retencja)'))
const p73b = run('S7.3b', 'S7.3', common('S7.3b', 's73b') + '\n' + T_S73B + RESUME('S7.1-lib, S7.2, S7.3a; równolegle pracuje S7.1-ui (pliki diagnostyki – nie ruszaj)'))
const all = await Promise.all([pUi, p73b])
const g = await run('S7-bramki', 'Bramki', common('S7-bramki', 's7g') + '\n' + gatesPrompt(brief(all)) + '\nRaporty WCZEŚNIEJSZYCH agentów S7 (S7.1-lib, S7.2, S7.3a – integration_requests, odchylenia, kryteria): plik /home/user/wt/S7/_kontynuacja/prev-S7.json – przeczytaj go i uwzględnij w zbiorczym raporcie.', [])
return { subtasks: all, gates: g }
