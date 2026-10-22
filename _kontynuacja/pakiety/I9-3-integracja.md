# Pakiet I9-3 – integracja huba „Przychód i lejek” z modułami

Zakres: kryteria karty I9 (SPEC §8.3, prompt `docs/PROMPT_KONTYNUACJI_HUB_2026-10-20.md`
§9.1, wiersze 590-614) dotyczące odnośników moduły → hub, nawigacji/⌘K, bramek
ścisłych (`queryKeyLiterals`, `syncManifest` metrics, `domainMap`,
`hubDelivery.gate`, authz), bundla D-08, e2e i runbooka. NIE obejmuje
`jobsTick`/scheduler (osobny pakiet) ani I9d (RODO cz. 2).
Stan zbadany 2026-10-21 tylko odczytem (grep/sed/git show + skrypty bun
w scratchpadzie, zero zmian w repo).

## 0. Stan bazowy (fakty)

- Katalog `/home/user/neweustrategies-dc633fb5`, gałąź lokalna
  `claude/loving-einstein-caze7r`, HEAD `4b1aa96d3` = głowa PR #530
  (`origin/claude/elegant-fermat-xwfca1` = `75133fe20`) + niewypchnięte scalenie
  `main` (`b1e459ce2`, `e22ac9e2d` – „ikony kolorem przycisku”). Strażnik
  wycinka liczy diff od merge-base – **BAZA = HEAD po scaleniu**, inaczej pliki
  z `main` wyjdą jako „spoza manifestu”.
- Brak `node_modules` w tym checkoucie (vitest/tsgo/build wymagają
  `bun install --frozen-lockfile` w worktree).
- Najwyższa migracja: `supabase/migrations/20261020161400_data_retention_panel.sql`
  (blok I9 `2026102016*` zajęty 160000…161400, 15 plików). Najwyższy bliźniak:
  `drizzle/migrations/0372_data_retention_panel.sql`, `_journal.json` idx 372,
  `when` 1792477933912; kolejne wpisy **+60 000** (dziennik §21.21, l. 3908-3910;
  w prompcie „- 60000” to artefakt listy markdown). Plan: S7 bierze
  `20261020150000/150050/150100` → `0373…0375`, I9d – blok 16 po `161400`.
- CI na głowie PR `75133fe2`: `e2e` success, `e2e-seeded` success
  (REST `commits/{sha}/check-runs`; `gh pr checks` nie działa – GraphQL 403).
  To dowód dla Z-S3-04 (`login-return`, `checkout.spec.ts:66`).
- `bun run scripts/generate-authz-snapshot.ts --check` → „✓ … zgodny z migracjami”
  (działa bez `node_modules`).
- Gałęzie robocze (nie scalone): `origin/hub/s7-zakladki-diagnostyka-c-wip`
  (`fffb69802`, 2026-10-21, najnowsza; `RevenueSignalChip` identyczny jak w
  `-wip`), `origin/hub/s8-sciezki-panel-c-wip` (`5c168addc`, zawiera
  `LeadJourneysCard`). Żadna nie zmienia plików współdzielonych
  (`syncManifest.ts`, `adminNav.ts`, `hubDelivery.ts`, `keys.ts`,
  `queryKeyLiterals.gate.test.ts`, `leadTimeline.ts`, `admin.crm.$id.tsx`).

## 1. SPEC §2.7 – 13 punktów montażu (moduły → hub)

SPEC `docs/SPEC_MODUL_PRZYCHOD_LEJEK_2026-10-18.md:248-252`. Mapa obszarów
w S7: `src/lib/revenue/diagnostics/surfaces.ts` (gałąź S7) – `SIGNAL_SURFACES`
**różni się od SPEC** (S7 dodał obszary; używać mapy S7, odchylenie do dziennika):

```ts
paywall: ["catalog","paywall","metering","checkout"],   // SPEC: to samo
pricing: ["catalog","retention","checkout"],            // SPEC: catalog,retention
membership: ["catalog","clubs"],                        // SPEC: catalog
coupons: ["coupons"], newsletter: ["newsletter","funnel"], crm: ["crm","dunning"],
workflows: ["workflows","journeys"], billing: ["dunning","data_quality","catalog"],
events: ["events"], clubs: ["clubs"],
```

| #   | Ekran / plik (kotwica)                                                                                                                    | Co montować (SPEC)                                                                                                     | Test modułu, który to zobaczy                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | `src/routes/admin.paywall.tsx:80-88` (`<header>`, po `<PaywallKpiStrip />` l. 87)                                                        | chip `SIGNAL_SURFACES.paywall`                                                                                         | `src/routes/__tests__/platformPaywallRoute.test.tsx` (mock routera BEZ `importOriginal`)                              |
| 2   | `src/components/admin/pricing/organisms/AdminPricingWorkspace.tsx:90-123` (lokalny pasek „Powiązane moduły” l. 95-122)                    | chip `pricing` + **zastąpienie lokalnego paska `RelatedModulesBar`**                                                   | `.../pricing/organisms/__tests__/AdminPricingWorkspace.test.tsx:165-178` (oczekuje hrefów incl. `/admin/monetization`) |
| 3   | `src/components/admin/membership/organisms/AdminMembershipWorkspace.tsx:267` (`<header>`)                                                 | chip `membership`                                                                                                      | `.../membership/organisms/__tests__/AdminMembershipWorkspace.test.tsx` (mock routera bez `importOriginal`)             |
| 4   | `src/routes/admin.coupons.tsx:66` (layout z `<Outlet/>` l. 104)                                                                          | chip `coupons`                                                                                                         | `src/routes/__tests__/adminCouponsShellRoutes.test.tsx`                                                               |
| 5   | `src/routes/admin.newsletter.tsx:16-19` (layout, `<AdminShell hideSidebar>`, po `<NewsletterSubNav />` l. 18)                             | chip `newsletter`                                                                                                      | `src/routes/__tests__/adminNewsletterShellRoutes.test.tsx`                                                            |
| 6   | `src/routes/admin.crm.tsx:12-14` (sam `<Outlet/>` – chip pojawi się też na `$id` i `funnel`; alternatywa: nagłówek `admin.crm.index.tsx`) | chip `crm`                                                                                                             | `src/routes/__tests__/adminCrmLayoutRoutes.test.tsx` (RouterProvider, **bez QueryClient**)                            |
| 7   | `src/routes/admin.workflows.tsx:145-151` (`<header>`)                                                                                     | chip `workflows` + baner „Wieloetapowe ścieżki są w hubie” (słownik `src/lib/i18n-admin-workflows.ts`, w manifeście I9) | `src/routes/__tests__/adminWorkflowsRoute.test.tsx`                                                                   |
| 8   | `src/routes/admin.billing.tsx:39-52` (`<header>`, napisy przez `L(pl,en)`)                                                               | chip `billing`                                                                                                         | `src/routes/__tests__/adminBillingRoute.test.tsx` (bez QueryClient)                                                   |
| 9   | `src/components/admin/events/organisms/EventCommunicationsPanel.tsx:62/68`                                                                | „Zautomatyzuj komunikację → szablon” = link `/admin/revenue/journeys?new=1&template=event_registration_nurture`         | `.../events/organisms/__tests__/EventCommunicationsPanel.test.tsx`, `adminEventStudioSectionRoutes.test.tsx`           |
| 10  | `.../events/organisms/EventAnalyticsPanel.tsx:61/94`                                                                                      | „Przychód ze wszystkich wydarzeń” → `/admin/revenue/community?sec=events`                                              | `EventAnalyticsPanel.test.tsx`, `eventsRouteTree.test.tsx`                                                            |
| 11  | `.../events/organisms/EventOverviewPanel.tsx:47/92`                                                                                       | „aktywne ścieżki wydarzenia” (patrz §1.2)                                                                              | `EventOverviewPanel.test.tsx`, `src/lib/revenue/community/__tests__/queries.test.ts`                                  |
| 12  | `src/components/admin/clubs/organisms/ClubInvitationsTab.tsx:62/155`                                                                      | „Zautomatyzuj potwierdzenia zgłoszeń” → `…journeys?new=1&template=club_application_received`                           | `src/components/admin/clubs/__tests__/ClubInvitationsTab.test.tsx` (bez QueryClient, bez mocka routera)               |
| 13  | `src/components/admin/clubs/organisms/ClubApplicationsInbox.tsx:85/179`                                                                   | jw. (+ chip `clubs`)                                                                                                   | `.../clubs/__tests__/ClubApplicationsInbox.test.tsx`                                                                  |
| +   | `src/routes/admin.crm.$id.tsx:742-768` (zakładka `analytics`, obok `<LeadStageHistoryCard …/>` l. 767)                                   | `<LeadJourneysCard leadId={lead.id} lang={lang} />` (S8)                                                               | `src/routes/__tests__/adminCrmLeadRoute.test.tsx` (mockuje `@/lib/crm.functions`)                                     |
| +   | `src/lib/crm/leadTimeline.ts:18-19` + konsumenci                                                                                          | typ `journey` na osi leada (§3)                                                                                        | `src/lib/crm/__tests__/leadTimeline.test.ts`                                                                          |
| +   | `src/routes/admin.monetization.tsx:125` (`<header>`)                                                                                      | baner „przeniesione do huba” (D-09; przekierowanie dopiero po decyzji)                                                 | `src/routes/__tests__/platformMonetizationRoute.test.tsx` (mock routera bez `importOriginal`)                         |

Szablony ścieżek istniejące (`src/lib/journeys/templates/`):
`event_registration_nurture`, `event_attended_upsell`,
`club_application_received`, `club_application_followup` (+ 10 innych).
S8 (`c-wip`) obsługuje `?new=1&template=<key>` w
`src/components/admin/revenue/tabs/RevenueJourneysTab.tsx:88,117,151`
(`isTemplateKey`; nieznany klucz → sama galeria). Ścieżki wymagają aal2
(`requireCrmStaff`, `src/integrations/supabase/require-staff.ts:31,110`).

### 1.1 `RelatedModulesBar` w cenniku

- Komponent: `src/components/admin/revenue/molecules/RelatedModulesBar.tsx`
  (`{ items: readonly RelatedModule[]; className? }`, `<nav aria-label>`, bez
  ikon, `ensureI18n` z `src/lib/i18n-admin-revenue-shell.ts`).
- Dane: `RELATED_MODULES` w `src/lib/admin/revenue/hubTabs.ts` (9 pozycji, bez
  `/admin/monetization` i bez huba); klucze `adminRevenue.related.*`
  (`i18n-admin-revenue-shell.ts:120-131` PL, `465-476` EN).
- Lokalny pasek cennika: ikony + `adminPricing.related.{heading,coupons,
membership,paywall,dashboard}` (`src/lib/i18n-admin-pricing.ts:17-23`),
  test `AdminPricingWorkspace.test.tsx:165-178` wymaga `/admin/monetization`.
  Decyzja: lista dla cennika (np. kupony, członkostwo, paywall, hub
  `/admin/revenue`, pulpit do D-09) → nowe `labelKey` w słowniku shell (plik S6 –
  dopisać do manifestu I9) i aktualizacja testu (spoza manifestu).

### 1.2 „Aktywne ścieżki wydarzenia” (EventOverviewPanel)

Brak RPC per wydarzenie. Dostępne: `journeyListQueryOptions(tenantId, "active")`
(`src/lib/journeys/queries.ts:46-58`, klucz `journeyKeys.list(t,status)`),
RPC `admin_journey_list(p_status)` (`20261020140300_journeys_admin_rpc.sql:626-664`)
zwraca `trigger_event_type`, `active`, `enrolled_30d`, `goal_reached_30d` –
filtr klienta po prefiksie wyzwalacza (`event_registration.*`) przez `select`.
Wymaga aal2 → stan `mfa_required` ma dawać cichy brak/notkę, nie błąd.

## 2. `RevenueSignalChip` (S7) – kontrakt i pułapki montażu

Plik (S7): `src/components/admin/revenue/molecules/RevenueSignalChip.tsx`
(`git show origin/hub/s7-zakladki-diagnostyka-c-wip:…`, 183 linie).

```ts
export interface RevenueSignalChipProps {
  areas: readonly RevenueArea[]; variant?: "bar" | "chip"; className?: string;
}
// RevenueSignalChip → useHydrated() (z "@tanstack/react-router") → SignalChipBody:
const { roles, tenantId } = useAuth();
const facts = useQuery({ ...revenueFactsQueryOptions(tenant, { roleOk }), select });
const snoozes = useQuery(revenueSnoozesQueryOptions(tenant, { roleOk }));
if (!roleOk || !tenant) return null;          // ← bramka PO useQuery
// link: <Link to="/admin/revenue/$tab" params={{tab:"diagnostics"}} search={{area}}>
```

- Klucze: `revenueKeys.facts(t)` = `["admin-revenue","diagnostics",t,"facts"]`,
  `revenueKeys.snoozes(t)` (`src/lib/revenue/keys.ts:86-88`); staleTime 30 s
  (`FACTS_STALE_MS`, `src/lib/revenue/diagnostics/queries.ts:38` na S7).
- i18n: `adminRevenue.signal.{label,ok,unknown,open_one/few/many/other,details,action}`
  w `src/lib/i18n-admin-revenue-diagnostics.ts` (S7, l. 138 PL / 1125 EN);
  `testid="revenue-signal"`, `data-variant`, `data-tone`, `role="status"`.
- `RevenueArea`, `REVENUE_AREAS` (16) i `AREA_OWNER_LINK` już w
  `src/lib/admin/revenue/hubTabs.ts:143-200` (bieżąca gałąź).
- **Pułapka A (testy modułów):** `useQuery` przed bramką roli → w testach bez
  `QueryClientProvider` (adminCrmLayoutRoutes, adminCrmLeadRoute,
  adminBillingRoute, ClubInvitationsTab, adminPricingMembershipRoutes) chip
  rzuci „No QueryClient set” po hydratacji, nawet dla gościa (domyślny kontekst
  `useAuth`: `roles: []`, `src/hooks/useAuth.tsx:92-95`). **Pułapka B:** testy
  mockujące `@tanstack/react-router` bez `importOriginal`
  (AdminPricingWorkspace, AdminMembershipWorkspace, platformPaywallRoute,
  platformMonetizationRoute) nie eksportują `useHydrated` → błąd mocka vitest.
  Rekomendacja: (1) przenieść bramkę `roleOk && tenant` przed hooki zapytań
  (zewnętrzny komponent → `SignalChipBody` z zapytaniami) – zmiana pliku S7
  w I9 = wpis w dzienniku; (2) w testach modułów
  `vi.mock("@/components/admin/revenue/molecules/RevenueSignalChip", () => ({ RevenueSignalChip: () => null }))`
  albo mock leniwego wrappera; (3) pozytywny test montażu w 1-2 modułach.
- **Pułapka C (bundle):** chip ciągnie `diagnostics/queries.ts` → `registry.ts`
  (16 plików `checks/*`) + `facts.ts` + `diagnostics.functions.ts` + słownik
  diagnostyki **~24,6 KB gzip** (cały `i18n-admin-revenue-diagnostics.ts`,
  105 KB surowo). Statyczny import w 13 trasach = wspólny chunk ładowany na
  każdym ekranie modułu. Rekomendacja: `React.lazy` wrapper
  (np. `RevenueSignalChipLazy`, w `src/components/admin/revenue/**` – manifest
  I9 już to obejmuje) i/lub wydzielenie gałęzi `adminRevenue.signal.*` do
  małego słownika. Zamrożone: `chunk` 286, `public` 2881, `boot` 579,
  `publicCss` 85 – trasy admina nie mogą trafić do `public`.
- Bramka `revenueKeysReuse` (`src/lib/admin/revenue/__tests__/revenueKeysReuse.test.ts`):
  w `src/components/admin/{revenue,journeys}/**` zero `queryFn` i literałów
  kluczy – wrapper/molekuły tylko przez `*QueryOptions`.

## 3. Oś leada – typ `journey`

Stan (S8 NIE zmienił `leadTimeline.ts` ani `admin.crm.$id.tsx` – diff pusty):

- `src/lib/crm/leadTimeline.ts:18-19`
  `export type LeadTimelineEventType = "submit" | "consent" | "note" | "stage_change" | "webhook" | "newsletter" | "event";`
  (jedyne źródło; `TimelineEvent = LeadTimelineEvent`, `src/lib/crm.functions.ts:718`).
- Budowa: `buildLeadTimeline(context, leadId)` `src/lib/crm.functions.ts:720-842`
  (5 zapytań `fetchRows(looseTable(...))`, `fetchRows` toleruje błąd → `[]`,
  `src/lib/supabase/looseQuery.ts:131`); `getCrmLeadTimeline` (l. 845) i
  `exportCrmLeadTimelineCsv` – `requireCrmStaff` (admin/editor/super_admin + aal2).
  Plik w manifeście I9 (`src/lib/{crm,crm-tasks}.functions.ts`).
- Źródło ścieżek: RPC `public.admin_journey_lead_enrollments(p_lead_id uuid) RETURNS jsonb`
  (jedyna definicja `20261020140300_journeys_admin_rpc.sql:718-746`; bramka
  `_journey_staff_tenant(false)` = admin_or_editor lub super_admin; `GRANT EXECUTE … TO authenticated, service_role`),
  pola: `enrollment_id, journey_id, journey_name, category, status, current_node_id, entered_at, finished_at, exit_reason, is_test, version`, LIMIT 100.
  Alternatywa tabelą: `journey_enrollments` (`20261020090300_hub_schema_journeys_core.sql:167-201`;
  `status` CHECK `active|waiting|completed|goal_reached|exited|failed`,
  `exit_reason` + `account_deleted` od I9b-A2; RLS `journey_enrollments_staff_read`
  = `is_admin_or_editor()` – bez super_admin, więc RPC lepsze). Literał RPC w TS =
  zgodne z `generate:ts-sql-contract`. Bez nowej migracji.
- Etykiety powodów: `JOURNEY_EXIT_REASONS` (`src/lib/journeys/limits.ts:87-102`),
  `adminJourneys…exitReason` (`src/lib/i18n-admin-journeys.ts:62/379`).
- Konsumenci do zmiany: `src/routes/admin.crm.index.tsx:1576`
  `const ICONS: Record<LeadTimelineEvent["type"], string>` (**kompilacja
  padnie** bez wpisu `journey`), `tlTypes` PL l. 273 / EN l. 346
  (`as Record<string,string>`) – **plik spoza manifestu I9** (dopisać);
  `src/routes/admin.crm.$id.tsx:700-738` (oś w zakładce `activity`; odnośnik do
  edytora `/admin/revenue/journeys/$journeyId?node=&tab=contacts` jak w
  `LeadJourneysCard`); druk `buildLeadTimelineHtml` (escapowanie –
  `journey_name` to dane admina, ale przez `escapeHtml` jak reszta).
- Test: `src/lib/crm/__tests__/leadTimeline.test.ts` (describe „wiersz audytu…”,
  „konsumenci osi czasu” l. 157-) – spoza manifestu I9; dodać przypadek
  `journey` + test handlera (wzorzec mocków w `crm.functions` testach).
- `LeadJourneysCard` (S8 `c-wip`, `src/components/admin/journeys/lead/LeadJourneysCard.tsx`):
  `{ leadId: string; lang?: … }`, `leadJourneysQueryOptions(leadId)`
  (klucz `journeyKeys.forLead`), stany: przed hydratacją, `RoleGateNotice`,
  `MfaRequiredNotice`, niewdrożone, błąd, pusto (link `search={{new:"1"}}`).
  Montaż w `admin.crm.$id.tsx` po l. 767 (leniwie – karta ciągnie mutatory
  i 3 słowniki ścieżek).

## 4. Nawigacja i ⌘K

- `src/lib/admin/adminNav.ts` (684 l.): I9a zrobił pozycje
  `/admin/revenue` (ikona `Route`, `admin.nav.revenueHub`, l. 281-300) i
  `/admin/revenue/journeys` (`GitBranch`, `admin.nav.journeys`, l. 306-308),
  `searchEntries` 11 zakładek wg ról (`revenueHubSearchEntries` l. 257-264,
  `REVENUE_TAB_NAV_LABEL` l. 210-221, `REVENUE_TAB_KEYWORDS` l. 228-240),
  `isCompactSidebarRoute` l. 678-681. Typy: `AdminNavSearchEntry {to; search?; label; keywords?}` (l. 75-80),
  `adminNavItemKey` uwzględnia `search` (l. 116-124), `searchAdminNav` dedup po
  kluczu (l. 142-200). `AdminShell.tsx:261` przekazuje `search={item.search}`.
  Klucze `admin.nav.*` w `src/lib/i18n-admin-core.ts:43-54` (PL), `1313-` (EN).
- Brakuje: (a) „Nowa ścieżka” `{to:"/admin/revenue/journeys", search:{new:"1"}}`
  (S8 obsługuje), (b) „Dane wejściowe” – już jest jako zakładka `inputs`
  (admin-only), (c) skróty wskaźników z `src/lib/admin/revenue/metricSearchIndex.ts`
  – **plik nie istnieje na żadnej gałęzi** (S7.3 niezrobione; manifest S7).
  SPEC: lekki liść `{key, abbr}` ~1 KB gz, wynik „NRR · Wskaźniki” →
  `/admin/revenue/metrics?metric=net_revenue_retention`. **Nie importować
  `metrics.ts` (2622 l.) ani `metricHelp.ts` do `adminNav.ts`** – powłoka
  panelu jest na każdej trasie admina; `abbreviationOf` (`src/lib/analytics/semantic/metricHelp.ts:25`)
  użyć w teście parytetu, nie w runtime. `HUB_METRIC_IDS` = 70.
- Test `src/lib/admin/__tests__/adminNav.test.ts` (230 l.): l. 153-160
  „admin: skrót do KAŻDEJ z 11 zakładek” porównuje **całą** listę `searchEntries`
  z `REVENUE_TABS` → po dodaniu wpisów trzeba filtrować wpisy zakładek (np. bez
  `search`); l. 218-221 przypina BRAK `?new=1` → odwrócić; l. 171-179 sprawdza
  trasy z `routeTree.gen.ts` (dodać `search.metric ∈ HUB_METRIC_IDS`); redaktor
  bez Danych wejściowych (l. 162-169) – metryk z kwotami? (decyzja: skróty
  wskaźników dla admin+editor, bo zakładka `metrics` jest dla obu).
- Okruszki edytora (`Przychód i lejek › Ścieżki › {nazwa}`, SPEC §2.4) – S8.

## 5. `queryKeyLiterals.gate.test.ts` – tryb ścisły

- Plik `src/lib/__tests__/queryKeyLiterals.gate.test.ts` (301 l.); lista długu
  `QUERY_KEY_LITERAL_DEBT` l. 75-95 – 19 plików (S1):
  AccessSettingsPane, PostGeneralOverview, coupons/CampaignsPage,
  newsletter/{OverviewPanel,PopupEventsPanel,SubscribersPanel,subscribers/ImportCsvDialog},
  pricing/RetentionTab, hooks/{useCheckoutSettings,useNewsletterSettings},
  lib/access/metering, lib/admin/couponQueries, lib/retention/queries,
  routes/admin.{coupons.redemptions,monetization,newsletter.campaigns.$id,newsletter.campaigns.index,newsletter.overview,paywall}.
- **Skan (replika skanera bramki w bun, ten sam regex, wartownik, maska
  komentarzy): wszystkie 19 plików mają 0 literałów; cały `src` (4450 plików
  poza wyjątkami) – 0 trafień; fabryki: crm 18, billing 56 (kanarek działa).**
  Zmienione pliki z S7 `c-wip` (83) i S8 `c-wip` (40) – 0 literałów.
- Do zrobienia: `QUERY_KEY_LITERAL_DEBT = []` (lub usunąć stałą), test
  „wpis nieaktualny…” l. 260-269 → asercja `expect(QUERY_KEY_LITERAL_DEBT).toEqual([])`
  (albo `nieaktualne` = `[]`), nagłówek l. 26-28 i komentarz l. 66-74 („tryb
  ścisły włączony w I9, data”). `LEGACY_KEY_ALIASES` (`["admin-access-plans"]`)
  zostaje. Plik współdzielony (I9). Ponowić skan po scaleniu S7/S8.

## 6. `syncManifest.ts` – tryb `metrics` (Z-S6-11) i ścisłość

- `src/lib/revenue/syncManifest.ts` (637 l.): `HUB_ENTITY_IDS` 28 bytów
  (l. 43-72), `HubEntity.metrics: readonly MetricId[]` (l. 119-120, „uzupełnia
  I9”), wszystkie 28 wpisów `metrics: []`. Rejestr: `HUB_METRIC_IDS`
  (`src/lib/analytics/semantic/metrics.ts:2457`, 70: revenue 14, retention 13,
  funnel 9, economics 7, email 12, community 10, crm 5),
  `METRIC_GROUP: Record<MetricId, MetricGroup>` (l. 2464-), `MetricGroup` =
  `traffic|revenue|retention|funnel|economics|email|community|crm` (l. 163-164).
- Test `src/lib/revenue/__tests__/syncManifest.test.ts` (241 l.): nagłówek
  l. 12-13 „metrics NIEŚCISŁE … I9 włącza regułę «byt zasilający metrykę
  unieważnia jej dziedzinę»”; inwariant I4 SPEC §3.1. Pomocniki: `eventOf`,
  `invalidationKeysFor(eventOf(type), {userId})` z zarejestrowanym
  `ADMIN_HUB_INVALIDATION`, `related(a,b)` (prefiks), `isPanelKey`.
- Brak mapy grupa → domena. Propozycja (stała w `syncManifest.ts` lub teście):
  `revenue→[snapshot,mrr,realized,offer]`, `retention→[churn,retention,cohorts,dunning]`,
  `funnel→[funnel]`, `economics→[economics,inputs]`, `email→[email]` (metryki
  `journey_*` → klucze `journeyKeys`/`["admin","journeys"]`), `community→[events,clubs]`,
  `crm→[funnel]` (tor sprzedaży), `traffic→[]`. Nowe asercje: każde
  `metrics ⊆ HUB_METRIC_IDS`, każdy byt z `metrics` – każde zdarzenie unieważnia
  `["admin-revenue", d, tenant]` dla ≥1 domeny jego metryk; metryka huba
  pokryta przez ≥1 byt (opcjonalnie).
- **Pułapka:** domena `email` NIE ma żadnej reguły w
  `src/lib/realtime/eventInvalidationMap.admin.ts` (liczniki `rev("<d>"`:
  access 6, churn 3, clubs 3, cohorts 1, diagnostics 1, dunning 1, economics 1,
  events 6, funnel 1, inputs 1, mrr 1, offer 5, realized 12, retention 2,
  snapshot 6, **email 0**); `newsletter_subscriber.*.v1` → tylko `funK`
  (l. 122-125). Przypięcie metryk e-mail do `newsletter_subscriber` wymaga
  dopisania `rev("email", e)` (plik współdzielony I9).
- Ścisłość pisarzy (opcjonalna, wszystkie wycinki dowiezione): test l. 177-198
  przepuszcza pisarza nieistniejącego, gdy `sliceOfPath(path) !== null` lub
  funkcja w `HUB_FUNCTION_OWNERS`. Skan: brak
  `src/lib/crm-tasks.functions.ts#bulkUpdateCrmTasks` (byt `crm_task`,
  `syncManifest.ts:470`; istnieją `createCrmTask`, `updateCrmTask`,
  `deleteCrmTask`, `assignUnassignedCrmTasks`) oraz SQL
  `admin_revenue_diagnostic_snooze/unsnooze` (dowiezie S7). Z-S1-12: pełna lista
  kolumn `access_plan` w `owners` razem z Z-S6-11.

## 7. `RevenueDomain` i `domainMap.test.ts`

- **Dwie definicje o tej samej nazwie:**
  `src/lib/revenue/keys.ts:16-34` (16 domen: snapshot, mrr, churn, cohorts,
  dunning, retention, funnel, realized, offer, access, events, clubs, email,
  diagnostics, inputs, economics) – właściwa dla `domainMap`;
  `src/lib/analytics/semantic/revenueSnapshot.functions.ts:204-205`
  (`["snapshot","funnel","events","clubs","email"]` – domeny migawki). Importować
  z `@/lib/revenue/keys`.
- Mapa domena → `queryOptions` (wszystkie z kluczem `["admin-revenue", <domena>, t, …]`):

| Domena      | queryOptions (plik:linia)                                                                                                        | staleTime                              |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| snapshot    | `revenueSnapshotQueryOptions(t, range: RevenueRange, filters)` `src/lib/analytics/semantic/revenueSnapshot.functions.ts:623`      | 60 s / 30 min                          |
| mrr         | `revenueMrrBridgeQueryOptions(t, range, segment?, gate?)` `src/lib/revenue/finance/queries.ts:89`; `revenueMrrSeriesQueryOptions` l. 111 | fast                                   |
| realized    | `revenueRealizedQueryOptions` l. 130                                                                                             | fast                                   |
| retention   | `revenueRetentionOffersQueryOptions` l. 146                                                                                      | fast                                   |
| churn       | `revenueChurnQueryOptions` l. 164                                                                                                | 5 min                                  |
| dunning     | `revenueDunningQueryOptions` l. 180                                                                                              | 5 min                                  |
| cohorts     | `revenueCohortsQueryOptions(t, fromMonth, toMonth, gate?)` l. 197 (`domainTenant("cohorts")`)                                    | 5 min                                  |
| inputs      | `revenueInputsQueryOptions(t, from, to, gate?)` l. 214 (`manualInputs`)                                                          | 5 min                                  |
| economics   | `revenueEconomicsQueryOptions(t, from, to, timeZone, gate?)` l. 230                                                              | 5 min                                  |
| offer       | `revenueOfferMatrixQueryOptions(t, gate?)` l. 256 (`offerMatrix`)                                                                | 30 s                                   |
| funnel      | `revenueFunnelQueryOptions(t, range, {segment,track})` `src/lib/revenue/funnel/queries.ts:32`                                    | open/complete                          |
| access      | `revenueAccessInventoryQueryOptions(t)` `src/lib/revenue/access/queries.ts:17`                                                   | 30 s                                   |
| events      | `revenueEventsSummaryQueryOptions(t, range)` `src/lib/revenue/community/queries.ts:42`                                           | open/complete                          |
| clubs       | `revenueClubsSummaryQueryOptions(t, range)` l. 59                                                                                | open/complete                          |
| email       | `revenueEmailHealthQueryOptions(t, range)` `src/lib/revenue/email/queries.ts:25`                                                 | 60 s / 30 min                          |
| diagnostics | **brak na bieżącej gałęzi** – `revenueFactsQueryOptions` / `revenueSnoozesQueryOptions` (S7 `src/lib/revenue/diagnostics/queries.ts:70,82`) | 30 s                                   |

- Wzorzec testu: `vi.mock` modułów `*.functions` (jak
  `src/lib/revenue/community/__tests__/queries.test.ts:17-28`), dla migawki
  `vi.mock("@tanstack/react-start", async () => (await import("@/test/serverFnHarness")).serverFnStubModule())`
  (`src/lib/analytics/semantic/snapshot.functions.test.ts:112-115`); okno z
  `resolveRevenueRange` (`src/lib/revenue/window.ts:149`). Asercje: tabela
  `Record<RevenueDomain, () => {queryKey}>` kompletna (`satisfies`), `queryKey[0]==="admin-revenue"`,
  `queryKey[1]===domena`, `queryKey[2]===tenant`, `gcTime` 10 min, `retry` 1,
  `staleTime` wg SPEC §5.4 (`SPEC:779-788`); opcjonalnie: każda domena ma ≥1
  regułę szyny (dziś czerwone dla `email` – patrz §6).
- Ścieżka: `src/lib/revenue/__tests__/domainMap.test.ts` (glob
  `src/lib/revenue/__tests__/{syncManifest,domainMap}.test.ts` już w manifeście I9).

## 8. `hubDelivery.ts` – manifest I9 i bramka

- `src/lib/ci/hubDelivery.ts` (1566 l.): `HUB_VERSION_BLOCKS.I9 = "2026102016"`
  (l. 63), `HUB_VERSION_RANGE` [20261020090000, 20261020170000) (l. 49),
  `HUB_SHARED_FILES` l. 394-430, manifest I9 l. 818-955, `HUB_I9_REDEFINITIONS`
  l. 369-387, `HUB_CIALO_Z` l. 339-357, `FUNCTION_TABLE` (S7: l. 234-238).
- Manifest I9 już obejmuje: `src/routes/admin.{paywall,coupons,newsletter,crm,crm.$id,workflows,billing,monetization}.tsx`,
  `AdminPricingWorkspace.tsx`, `AdminMembershipWorkspace.tsx`,
  `src/lib/crm/leadTimeline.ts`, 3 organizmy wydarzeń, 2 klubów,
  `src/lib/onboarding/tours.ts`, `src/components/admin/{revenue,journeys}/**`,
  `src/lib/revenue/syncManifest.ts`, `src/lib/revenue/__tests__/{syncManifest,domainMap}.test.ts`,
  `docs/{RUNBOOK_HUB_PRZYCHOD_LEJEK,WDROZENIE_HUB_PRZYCHOD_LEJEK_2026-10}.md`,
  `src/lib/{crm,crm-tasks}.functions.ts`, `src/lib/i18n-admin-workflows.ts`,
  `src/lib/ci/__tests__/hubDelivery.gate.test.ts`, `platformPaywallRoute.test.tsx`.
- Dopisać (komentarz „(Integrator I9, 2026-10-xx) …”), jeśli dotykane:
  `src/routes/admin.crm.index.tsx`; `src/lib/crm/__tests__/leadTimeline.test.ts`;
  testy modułów: `src/components/admin/pricing/organisms/__tests__/AdminPricingWorkspace.test.tsx`,
  `src/components/admin/membership/organisms/__tests__/AdminMembershipWorkspace.test.tsx`,
  `src/components/admin/events/organisms/__tests__/{EventCommunicationsPanel,EventAnalyticsPanel,EventOverviewPanel}.test.tsx`,
  `src/components/admin/clubs/__tests__/{ClubInvitationsTab,ClubApplicationsInbox}.test.tsx`,
  `src/routes/__tests__/{adminPricingMembershipRoutes,adminCouponsShellRoutes,adminNewsletterShellRoutes,adminCrmLayoutRoutes,adminCrmLeadRoute,adminWorkflowsRoute,adminBillingRoute,platformMonetizationRoute,adminEventStudioSectionRoutes,eventsRouteTree}.test.tsx`;
  słowniki: `src/lib/i18n-admin-revenue-shell.ts` (nowe `related.*`),
  słowniki wydarzeń/klubów dla CTA (`src/lib/i18n-admin-events.ts`,
  `src/lib/i18n-clubs-admin.ts`) albo nowy mały słownik linków huba;
  `src/lib/admin/revenue/metricSearchIndex.ts` (+ test) jeśli robi go I9;
  `src/lib/ci/authzGates.ts` przy Z-I9b-14. I9 nie jest równoległy – nakładanie
  z manifestami S jest dozwolone (`sliceOfPath` filtruje `HUB_PARALLEL_SLICES`,
  l. 1019-1021); test „manifesty wycinków” (`hubDelivery.gate.test.ts:541-639`)
  wymaga jedynie jednego właściciela RÓWNOLEGŁEGO dla próbek.
- Bramka: `src/lib/ci/__tests__/hubDelivery.gate.test.ts` (699 l.; „prawdziwe
  migracje” l. 82-141 – właściciel, blok, CIALO-Z, granty, nagłówek, rozmiar
  45 KiB; rejestr l. 143-209; fikstury l. 211-500). Strażnik:
  `bun run scripts/hub-slice-guard.ts I9 --base <BAZA>` (diff merge-base +
  niezatwierdzone; kod 1 = poza manifestem/plik współdzielony/blok/dostawa).
  I9-3 nie potrzebuje SQL; jeśli zajdzie potrzeba – wersja w bloku 16 po
  najwyższej (po I9d), `-- CIALO-Z:` wg `HUB_I9_REDEFINITIONS`.

## 9. Snapshot autoryzacji

- Generator `scripts/generate-authz-snapshot.ts` (skan migracji, bez bazy),
  wynik `src/lib/authz/authzSnapshot.generated.ts` (85 l.; `roleGates` z
  `DOCUMENTED_ROLE_GATE_REFS` w `src/lib/authz/permissionRows.ts`,
  `featureGates` z odczytów `membership_tiers.features`, pole `file` = migracja
  najnowszej definicji). `--check` dziś zielony; po S7/I9d (redefinicje
  funkcji czytających `features`) – `bun run generate:authz-snapshot`.
- Z-I9b-14: `is_admin_or_editor` nie jest w `ROLE_ALIAS_ANY`
  (`src/lib/ci/authzGates.ts:69-77`: `is_staff`, `is_super_admin`,
  `can_publish_content`, `can_manage_profile_verification`; `ROLE_ALIAS_ALL`
  = `assert_admin_tenant`) → raporty personelu mają `bypassRoles: []`. Dodanie
  aliasu zmienia snapshot wielu funkcji – decyzja właściciela (prompt §11).

## 10. Bundle D-08

- Progi (`scripts/check-bundle-size.ts`): `chunk: 286` (l. 2254), `public: 2881`
  (l. 2329), `overall: 5023` (l. 2501, zmierzone 5021,2), `css: 100` (l. 2616,
  99,7), `publicCss: 85` (l. 2661), `boot: 579` (l. 2682). Zamrożone: public,
  publicCss, chunk, boot. Ratchet tylko `overall`/`css`: `ceil(zmierzone)+1`.
  Budżet I9 wg SPEC §8.6 (`SPEC:1651-1662`): chunk ≤ +0,1, overall ≤ +2, css 0.
- Kronika (wzór ostatniego wpisu, l. 2481-2500):

```ts
// Ratchet 5005 -> 5023 (2026-10-20, I9c-X2: retencja danych huba
// „Przychód i lejek”, Z-I9b-10 - …), decyzją zamawiającego D-08. Baza 763ecda0
// (gałąź PR po I9c-X1) 5002,9 / public 2777,8; po X2 5021,2: +18,3 KB, w tym
// admin-only +17,4 … Rozbicie: NOWY leniwy chunk … Arkusze CSS bit w bit te
// same (css 99,7, publicCss 83,8); chunk 257,9 i boot 471,7 w zamrożonych progach.
// Host 5021,2 -> 5022 -> +1.
overall: 5023,
```

- Wpisy wcześniejsze: l. 2384 (I0+S6+S1), 2390, 2399 (S4), 2415 (S2), 2428 (S3),
  2451 (I9a), 2467 (I9b). Subagentowi system uprawnień może zablokować ratchet
  – wykonuje orkiestrator (prompt §4.1).
- `reports/bundle-baseline.json`: pomiar 2026-10-02, commit `b006c2e`,
  `bucketConvention: 2`; aktualizacja WYŁĄCZNIE `bun run scripts/check-bundle-size.ts --update-baseline`
  na **zielonym buildzie runnera** (reguła l. 1242-1249, 2730-2760; host nie).
  Karta I9 każe odświeżyć baseline → zrobić z artefaktu CI albo zostawić
  świadomie z uzasadnieniem.

## 11. e2e (Playwright)

- `playwright.config.ts`: `testDir: "./e2e"`, `testIgnore` boot-(artifact|timing|home),
  dev server `bun run dev --host 127.0.0.1 --port 4173`, lokalny Chromium
  wykrywany (`/opt/pw-browsers/chromium-1194/chrome-linux/chrome` – istnieje).
  27 specyfikacji (`checkout`, `login-return`, `paywall`, `popup-registration`,
  `user-paths`, …); brak e2e huba/panelu (tylko `seo.spec.ts:302` bramka auth).
- Lokalnie: po `bun install --frozen-lockfile`,
  `VITE_SUPABASE_URL=https://placeholder.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=placeholder-anon-key SUPABASE_URL=https://placeholder.supabase.co SUPABASE_PUBLISHABLE_KEY=placeholder-anon-key flock -x /tmp/hub-heavy.lock bun run test:e2e -- e2e/paywall.spec.ts e2e/checkout.spec.ts e2e/login-return.spec.ts`
  (wzór dziennik l. 1938). Ograniczenie: brak sekretów Supabase → część testów
  z sesją pada lokalnie (Z-S3-04, dziennik l. 1842); `e2e-seeded`
  (`.github/workflows/e2e.yml:68-145`, lokalny Supabase) **niewykonalny** –
  demon Dockera nie działa (`/var/run/docker.sock` brak). Rozstrzyga CI
  (`e2e.yml` job `e2e` i `e2e-seeded`; oba zielone na `75133fe2`).

## 12. Runbook – wzorzec

- Istnieją: `docs/RUNBOOK_CIAGLOSC_WYKONAWCY.md` (547 l.; numerowane sekcje,
  checklisty godzinowe, bloki `bash` z komentarzem, tabele sekretów),
  `docs/RUNBOOK_COMMUNITY.md` (264 l.; architektura → harmonogram → obserwowalność →
  checklista uruchomieniowa → testy). Brak `docs/RUNBOOK_HUB_PRZYCHOD_LEJEK.md`
  (w manifeście I9) i brak `docs/hub/awaryjne/*.sql` (SPEC §9.2 je zapowiada).
- Treść wymagana (prompt §9.1 ost. punkt + SPEC §9.2 `SPEC:1712-1726`):
  przełączniki (`journey_settings.enabled`, `JOURNEYS_ENGINE_DISABLED`
  – `src/lib/server/journeysRunner.server.ts`, status ścieżki/`exit_all`,
  retencja i karencja `data_retention_settings.enforce_after` +14 dni / „Włącz
  teraz”, wyłącznik pomiaru otwarć `open_tracking_enabled`, wygaszanie
  nieaktywnych – I9d), sygnały (tabela SPEC §9.2: `domain_event_emit_errors`,
  `admin_journey_engine_health()`, `email_queue_depth()`, reguły
  `sync.emitter_silent`, `data_quality.ledger_drift`), zapytania diagnostyczne,
  wycofanie (kod `git revert`, SQL addytywny/forward-only), kolejność wdrożenia
  `0347…0372` (+S7/I9d) z kontrolnym SQL – źródła: dziennik §4.1-4.3 (M0),
  §20.9 (S5, okno nocne, `trg_journey_route_event` z `lock_timeout 5s`),
  §21.17, §21.20, §21.21 („Wdrożenie (właściciel)”, „Bezpieczny start” l. 3796-),
  rejestr RODO `docs/RODO_REJESTR_CZYNNOSCI_HUB_2026-10.md` (§ „Retencja danych”
  l. 26, „Wspólny mechanizm usunięcia konta” l. 48). Znane skutki Z-I9c-03,
  Z-S3-02 – tylko opis.

## Rekomendacja wdrożenia

Kolejność (po scaleniu S7, S8 i I9d; worktree od gałęzi PR, BAZA = HEAD):

1. **Chip – utwardzenie (pliki S7 w I9, wpis w dzienniku):** bramka
   `roleOk && tenant` przed `useQuery` w `RevenueSignalChip.tsx`; leniwy
   wrapper (`src/components/admin/revenue/molecules/RevenueSignalChipLazy.tsx`
   z `lazy()` + `Suspense fallback={null}`); ewentualnie mały słownik
   `adminRevenue.signal.*`. Test RTL/axe wrappera (zero zapytań bez roli,
   `useHydrated`, link `?area=`).
2. **Montaż 13 punktów** wg tabeli §1 (+ baner D-09 w `admin.monetization.tsx`,
   `RelatedModulesBar` w cenniku, baner w automatyzacjach, CTA wydarzeń
   i klubów do `?new=1&template=`). Napisy PL/EN w słownikach (parytet
   `const en: typeof pl`; drift gate `src/__tests__/i18nKeyDrift.gate.test.ts`).
   Testy modułów: mock chipu + 1-2 testy pozytywne; dopisać pliki do manifestu I9.
3. **Oś leada `journey`:** `leadTimeline.ts` (unia), `crm.functions.ts`
   (RPC `admin_journey_lead_enrollments`, wpisy wejścia/końca z
   `exit_reason`, `is_test` oznaczone), `admin.crm.index.tsx` (ICONS, tlTypes),
   `admin.crm.$id.tsx` (render + link do edytora, `LeadJourneysCard` leniwie
   po l. 767), testy `leadTimeline.test.ts` + handler.
4. **⌘K:** `metricSearchIndex.ts` (jeśli S7.3 nie dowiózł – I9 z wpisem
   w manifeście; generowany liść, test parytetu z `HUB_METRIC_IDS` i rozmiaru),
   wpisy „Nowa ścieżka” i wskaźników w `adminNav.ts`, aktualizacja
   `adminNav.test.ts` (l. 153, 171, 218), klucze `admin.nav.*` w `i18n-admin-core.ts`.
5. **Bramki ścisłe:** `queryKeyLiterals` (lista pusta + asercja),
   `syncManifest` (`metrics` z mapą grup, `rev("email")` w
   `eventInvalidationMap.admin.ts` jeśli wymagane, opcjonalnie ścisli pisarze –
   naprawa `bulkUpdateCrmTasks`), nowy `domainMap.test.ts`.
6. **Pliki generowane:** `bun run generate:authz-snapshot` (+ `--check`),
   `bun run generate:codeowners` (jeśli ownership), `routeTree.gen.ts` –
   regeneracja kontrolna (bez nowych tras).
7. **Bramki:** celowane vitest
   (`TZ=UTC bunx vitest run --maxWorkers=2 src/lib/__tests__ src/lib/revenue src/lib/admin src/lib/crm src/lib/ci src/components/admin/revenue src/components/admin/pricing src/components/admin/membership src/components/admin/events/organisms src/components/admin/clubs src/routes/__tests__`),
   zawężony tsgo jak w CI (prompt §4.1), `format:check`, `lint`,
   `verify:static`, build + `check:bundle`/`check:chunks`/`check:entry-purity`,
   `hub-slice-guard I9`, `generate:ts-sql-contract` (+ pgTAP `ts_sql_contract`
   bo nowy literał RPC w `crm.functions.ts`), `check:rpc-contract`.
8. **D-08:** pomiar, ratchet `overall` (i `css`, jeśli potrzeba) z wpisem
   kroniki (orkiestrator); baseline tylko z runnera.
9. **Runbook** `docs/RUNBOOK_HUB_PRZYCHOD_LEJEK.md` (§12) + dziennik „I9 –
   integracja i wydanie”, §10, §17, KONTYNUACJA; e2e w CI.

Migracje: I9-3 nie wymaga SQL. Gdyby jednak (np. RPC „aktywne ścieżki
wydarzenia”), wersja `2026102016NNNN` > najwyższej w bloku 16 po I9d
(dziś `20261020161400`), bliźniak = następny wolny numer po S7/I9d (dziś
`0373`, ale S7 planuje `0373-0375`), `_journal.json` idx +1, `when` +60000,
`bun run check:migration-lanes`, nagłówek PL, `-- CIALO-Z:` przy redefinicji.

## Otwarte pytania / ryzyka

1. **Zależność od S7/S8:** chip, `revenueFactsQueryOptions` (domena
   `diagnostics` w `domainMap`), `metricSearchIndex.ts`, `LeadJourneysCard`,
   `?new=1&template=` istnieją tylko na gałęziach WIP – I9-3 startuje po ich
   scaleniu albo blokuje kryteria.
2. `SIGNAL_SURFACES` (S7) ≠ SPEC §2.7 (dodatkowe obszary) – zaakceptować
   i opisać w dzienniku.
3. Chip w layoutach `admin.crm.tsx`/`admin.coupons.tsx`/`admin.newsletter.tsx`
   pojawia się na wszystkich podstronach (także karta leada) – świadoma decyzja
   albo montaż w indeksie (`admin.crm.index.tsx` spoza manifestu).
4. Koszt chipu (rejestr reguł + słownik ~24,6 KB gz) na 13 ekranach – bez
   leniwego ładowania ryzyko `overall` > budżet I9 (+2) i wolniejszy pierwszy
   render modułów.
5. Mapa grupa metryki → domena (`crm`, `email`/`journey_*`) nie jest w SPEC –
   decyzja integratora; domena `email` bez reguły szyny (czerwień przy ścisłym
   teście, jeśli bytowi przypisze się metryki e-mail).
6. Ścisli pisarze manifestu: `bulkUpdateCrmTasks` nie istnieje – podmiana
   referencji vs implementacja (SPEC §3.2 wymienia `bulkUpdateCrmTasks`).
7. Pasek cennika: `RELATED_MODULES` nie ma `/admin/monetization` (test
   cennika go wymaga) – zakres listy dla cennika do ustalenia.
8. „Aktywne ścieżki wydarzenia” bez RPC per wydarzenie – filtr klienta po
   `trigger_event_type` jest przybliżeniem (warunki wyzwalacza z `event_id`
   nie są w odpowiedzi listy).
9. `reports/bundle-baseline.json` – karta I9 każe odświeżyć, reguła repo
   pozwala tylko z runnera.
10. D-09 (przekierowanie `/admin/monetization`) – warunek „14 dni bez rozjazdu
    `reconcileAll`”; w I9 tylko baner. Z-I9b-14 (alias authz) – decyzja
    właściciela.
11. Lokalnie brak e2e-seeded (Docker) i sekretów Supabase – zielone e2e tylko
    z CI.
12. Testy modułów spoza manifestu I9 – każdy dotknięty plik musi wejść do
    manifestu, inaczej `hub-slice-guard I9` = czerwień.
