export const meta = {
  name: 'hub-s8-lane-resume',
  description: 'S8 (wznowienie): panele boczne S8.3c, złożenie edytora S8.3d i bramki wycinka w /home/user/wt/S8',
  phases: [
    { title: 'S8.2', detail: 'wyniki, nakładka statystyk, karta leada' },
    { title: 'S8.3', detail: 'sesja, kanwa, panele, publikacja, złożenie edytora' },
    { title: 'Bramki', detail: 'pełne bramki wycinka i raport kryteriów' },
  ],
}

const WT = '/home/user/wt/S8'
const SLICE = 'S8'
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
  return `Jesteś agentem implementującym podzadanie ${id} wycinka ${SLICE} modułu „Przychód i lejek” (panel admina NES – think-tank/wydawca analiz; hub /admin/revenue) w repo NewEUStrategies/neweustrategies-dc633fb5. Stos: TanStack Start (SSR), React Query, Supabase/Postgres, bun, vitest, tsgo, i18n PL/EN. Pracuj po polsku. Wynik zwracasz narzędziem StructuredOutput (raport dla integratora).

ŚRODOWISKO
- Pracujesz WYŁĄCZNIE w worktree ${WT} (baza wycinka BAZA=${BASE}; fundament S8.1 jest już zacommitowany). KAŻDE polecenie Bash zaczynaj od "cd ${WT} && ..." (katalog roboczy się resetuje). Nie pushujesz, nie zmieniasz gałęzi, nie robisz rebase/reset/stash/merge/checkout cudzych plików, nie usuwasz cudzych plików.
- W tym samym worktree może RÓWNOLEGLE pracować inny agent nad rozłącznymi plikami, a inne worktree (/home/user/wt/*) należą do innych agentów. Commituj WYŁĄCZNIE swoje pliki: "git add <konkretne ścieżki>" + "git commit" (nigdy git add -A / git add . / git commit -a). Przy błędzie index.lock odczekaj 5 s i ponów. Niezacommitowanych plików spoza Twojej listy nie ruszaj i nie commituj.
- Zasoby wspólne (4 rdzenie, 15 GB RAM, kilku agentów naraz): ciężkie polecenia WYŁĄCZNIE pod "flock -x /tmp/hub-heavy.lock" (każdy tsgo, bun run build, format:check, verify:static, pełny lint, vitest > 10 plików lub --maxWorkers=2); małe vitest (≤ 10 plików, --maxWorkers=1) oraz eslint/prettier pojedynczych plików pod "flock -s /tmp/hub-heavy.lock". Nigdy tsgo na całym repo.

ŹRÓDŁA (czytaj sekcjami: grep -n '^#' plik, potem sed -n 'a,bp'; nie wczytuj całych wielkich plików naraz)
- ${WT}/docs/kontynuacja/s8/STAN_S8.md – podział S8 na podzadania (owned_files, scope, acceptance, tests – sekcje "### S8.2" i "### S8.3"), oczekiwane zmiany integratora, ryzyka, raport S8.1 (API fundamentu, odchylenia).
- ${WT}/docs/kontynuacja/s8/S8.md – pakiet kontekstu: §0 fakty, §1 karta S8 dosłownie, §2.1 SPEC §6.3 (kanwa) dosłownie, §2.2 silnik S5, §2.3 IA i adresy, §4 kontrakt danych (server fn, DTO, klucze, queryOptions, biblioteki S5 – parametry węzłów i predykatów, zachowania RPC, ustawienia/zdrowie/symulacja/test, luki API), §5 zgłoszenia, §6 wiedza Insidera i benchmarki, §8 prymitywy do reużycia, §9 bramki i wzory testów, §10 podział, §11 ryzyka.
- Fundament S8.1 (w gałęzi): src/lib/admin/journeys/{viewModel,layout,nav,ops,summaries,issues,hash,access,journeyEditor.functions,journeyQueries,journeyMutations}.ts (+ __tests__), src/components/admin/journeys/list/**, src/lib/i18n-admin-journeys-list.ts (wspólne etykiety adminJourneys.common – reużyj, NIE dubluj). Silnik S5: src/lib/journeys/** (dto, keys, queries, journeys.functions, stats.functions, parse, nodeTypes, predicates, triggers, labels, limits, variables, render.server, tracking.server, templates/), słownik S5 src/lib/i18n-admin-journeys.ts. Fikstury RPC: src/lib/journeys/__tests__/rpcShapes.fixture.ts.
- Nie czytaj całego docs/SPEC_MODUL_PRZYCHOD_LEJEK_2026-10-18.md (370 KB) – pakiet ma wyciągi; do SPEC sięgaj tylko po konkretną sekcję (grep).

ZASADY KODU (obok AGENTS.md, który masz w kontekście)
- Wszystko operowalne z panelu admina dla właściwych ról; role z dokładnych "roles" (useAuth) / access.ts (journeyCapabilities), nie z isAdmin/isSuperAdmin; useHydrated przy treści zależnej od sesji; stany forbidden / unavailable / mfa_required (MfaRequiredNotice) / pusty jako stany kart, nie toasty.
- Wspólne atomy UI (src/components/ui: TimeInput, DateInput, PlatformSelect, Popover/PopoverAnchor, Sheet, Switch, Checkbox, Tooltip), ConfirmDialog, useAutosave/AutosaveBar, useHistory, useUnsavedChangesGuard, usePrefersReducedMotion oraz atomy/molekuły huba S6 (KpiTile z metricId, MetricExplainer, BenchmarkScale, BenchmarkTierBadge, SourceHeader, RelatedModulesBar, RoleGateNotice, MetricTooltip, ChartCard + biChart, FunnelBars) – lista i ścieżki w pakiecie §8. Geometria identyczna w light/dark (różnią się tylko kolory/tokeny); reużywaj istniejących klas (budżet css); rounded-[6px]; ikony z lucide-react jak w hubie. Dostępność: role, aria, fokus, klawiatura, tabele z caption/scope, cele ≥ 24 px; testy axe bez naruszeń.
- Zapytania wyłącznie przez fabryki kluczy (journeyKeys itd.) i istniejące queryOptions/mutatory (bramka queryKeyLiterals: zero literałów kluczy); zapytania enabled po hydratacji i z tenantId.
- i18n PL/EN: własny plik słownika wg wzoru src/lib/i18n-admin-journeys-list.ts ("const en: typeof pl", rejestracja ensureI18n() przy imporcie i w komponencie, eksport słowników dla testów); liczebniki PL _one/_few/_many/_other, EN _one/_other; ZERO kolizji z istniejącymi kluczami (przed wyborem gałęzi grep po wszystkich src/lib/i18n-*.ts – bramka i18nOverlayIntegrity); każdy klucz ma czytelnika w kodzie produkcyjnym (overlayReaders); zakaz "lang === 'pl' ?" i L(pl,en); w napisach EN unikaj słów równych klasom narzędziowym Tailwinda (trafiają do publicznego CSS – limit publicCss zamrożony); słownik importowany z komponentów, nie z pliku trasy.
- Liczb benchmarków NIE wymyślasz – wyłącznie rejestr S6 (useBenchmark / evaluateMetricValue / metricById). Progi operacyjne bez źródła = nazwane stałe z komentarzem DLACZEGO albo stan unknown.
- Kod panelu wyłącznie w leniwych chunkach admina (budżet D-08: public 2881, publicCss 85, chunk 286, boot 579 ZAMROŻONE; overall/css ratchetuje integrator). Moduły *.server tylko dynamicznym import() w handlerze server fn. Zero bibliotek grafu, zero nowych zależności, zero nowych tras.
- Komentarze w kodzie po polsku, wyjaśniające DLACZEGO, gęstość jak w otoczeniu; kod czytelny jak otoczenie (nazewnictwo, idiomy).
- Testy dla wszystkiego, co dodajesz (vitest, RTL + axe). Wzory: src/components/admin/revenue/molecules/__tests__/RevenueTabPreparing.test.tsx (realT z @/test/i18nReal, RouterLinkStub z @/test/routerLinkStub, axeViolations/summarize z @/test/axe), @/test/renderWithQueryClient, @/test/serverFn, @/test/supabaseChain, @/test/middlewareHarness; testy S8.1 w src/components/admin/journeys/list/__tests__ i src/lib/admin/journeys/__tests__. Fikstury "as const" kopiowane przez JSON: pomocnik clone zwraca unknown. TZ=UTC.

PLIKI WSPÓŁDZIELONE I CUDZE – NIE EDYTUJESZ (zmianę opisz dokładnie w integration_requests: plik + konkretny diff/opis; wykona ją integrator): src/routeTree.gen.ts, src/routes/**, src/lib/admin/adminNav.ts (+ test), src/lib/i18n-admin-core.ts, src/integrations/supabase/types.ts, src/lib/realtime/**, jobsTick/scheduler, src/lib/server/**, scripts/**, reports/** (bramka i18nParity przepisuje reports/i18n-parity.json – nie commituj go), src/__tests__/**, authzSnapshot, ownership, CODEOWNERS, src/lib/ci/hubDelivery.ts, drizzle/**, supabase/**, docs/**, src/lib/crm/**, src/components/admin/revenue/** (poza RevenueJourneysTab.tsx), src/lib/onboarding/** oraz każdy plik spoza Twojej listy (o ile ta instrukcja wprost nie pozwala).

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
4) gdy dotykasz słownika/zapytań/trasy: TZ=UTC flock -s /tmp/hub-heavy.lock bunx vitest run --maxWorkers=1 src/__tests__/i18nParity.gate.test.ts src/lib/__tests__/i18nOverlayIntegrity.gate.test.ts src/lib/__tests__/overlayReaders.test.ts src/lib/__tests__/queryKeyLiterals.gate.test.ts src/routes/__tests__/adminRouteAuthority.gate.test.ts
5) bun run scripts/hub-slice-guard.ts ${SLICE} --base ${BASE}  (naruszenia dopuszczalne tylko dla plików słownika spoza manifestu i zmian, które zgłaszasz integratorowi – wypisz je w open)

COMMIT: po polsku "hub(${SLICE}): <co i po co>", treść z wypunktowaniem zakresu i odchyleń, zakończona DOKŁADNIE liniami:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TguECirxRRzWuhfPrnn48H
(git commit -F <plik z wiadomością w /tmp>). Możesz robić kilka commitów; ostatni zostawia zielone bramki.

RAPORT (StructuredOutput): status (done | partial | failed), head_sha, commits, summary (zakres, decyzje, API/propsy, które importują kolejni agenci), files, deviations (odchylenia od SPEC/pakietu z uzasadnieniem – trafią do dziennika), integration_requests (plik + dokładna zmiana), acceptance (każde kryterium Twojej części karty: spełnione/niespełnione + dowód: test/plik), gates (nazwa + wynik), open (co zostało, ryzyka). Nie pisz "done", jeśli bramki są czerwone albo czegoś nie zrobiłeś.
`
}

const T_S82 = `ZADANIE: S8.2 – wyniki ścieżki, statystyki na kanwie i karta leada „Ścieżki” w CRM. Zakres, pliki (owned_files), kryteria i testy: STAN_S8.md sekcja "### S8.2" (przeczytaj ją w całości) oraz:
- src/lib/admin/journeys/results.ts (czyste): kroki lejka w kolejności numeracji buildJourneyView, powody wyjścia, wiersze tabeli e-maili (queued, sent, uniqueHumanOpens, uniqueClicks, ctor, unsubscribed, bounced, complained, fallbackLocale), werdykt A/B (n < 100 na ramię → „za mało danych (n < 100)”; różnica pp; ufność z |z| ≥ 1,96 → 95 %, ≥ 2,58 → 99 %), mapowanie na metricId/benchmark (liczby wyłącznie z rejestru S6), serie dzienne, okno z resolveRevenueRange(period).
- Komponenty src/components/admin/journeys/results/*: JourneyResults (kafle KpiTile z oceną progową), JourneyStepFunnel, JourneyTrendCard, JourneyExitsCard, JourneyAbCard („Zostaw B” → nowy szkic przez ops.resolveSplit + useSaveJourneyDraft z CAS – nie publikuje; konflikt obsłużony; tylko canEdit), JourneyEmailsTable (dymek MPP: otwarcia ludzkie i CTOR to górna granica – Z-S5-06; caption/scope), JourneyNodeResults (zakładka „Wyniki” panelu kroku), JourneyEnrollmentsTable (zakładka „Kontakty”: filtr statusu, strony po 50, wyjście z zapisu – admin+redaktor, pominięcie czekania tylko admin, redaktor: przycisk wyłączony z wyjaśnieniem, ConfirmDialog); src/components/admin/journeys/editor/JourneyStatsOverlay.tsx (chipy przy węzłach pozycjonowane z layout S8.1: wejścia/wysłane, otwarcia ludzkie z dymkiem MPP, kliknięcia, CTOR z BenchmarkTierBadge, A/B jak w §6.3; prop ukrywający liczby dla ?stats=off) – wszystkie z testami RTL/axe.
- src/components/admin/journeys/lead/LeadJourneysCard.tsx (+ test): zapisy kontaktu, wyjście z zapisu, link do ścieżki, stany błędów/MFA/pusty, akcje wg ról. Montaż w src/routes/admin.crm.$id.tsx (obok LeadStageHistoryCard) i typ „journey” na osi leada (src/lib/crm/leadTimeline.ts, SPEC §2.7) to pliki integratora – podaj dokładny diff w integration_requests.
- Z-I9c-06: dla okien starszych niż retencja statystyki zapisów pochodzą z rollupu / są niepełne – pokaż stan „dane od …” (podpis source='rollup'), nigdy zera udającego brak danych.
- Słownik: src/lib/i18n-admin-journeys-results.ts (gałęzie np. adminJourneys.results / nodeResults / enrollments / statsOverlay / lead – sprawdź kolizje).
- Komponenty S8.2 zamontuje edytor (S8.3: panel kroku – zakładki „Wyniki” i „Kontakty”; kanwa – nakładka statystyk; trasa wyników). Zaprojektuj czytelne, stabilne propsy i opisz je w summary.`

const T_S83A = `ZADANIE: S8.3a – sesja edytora, podgląd maila, adres edytora i dialog konfliktu (pierwsza część S8.3). Pełny zakres S8.3: STAN_S8.md sekcja "### S8.3" (przeczytaj całą – realizujesz z niej tylko poniższe pliki; resztę robią kolejni agenci: S8.3b kanwa/lista, S8.3c panele, S8.3c2 publikacja/symulacja/test, S8.3d złożenie edytora i trasa).
Twoje pliki:
- src/lib/admin/journeys/editorSession.ts (+ src/lib/admin/journeys/__tests__/editorSession.test.ts): czysta maszyna stanów + hook (np. useJourneyEditorSession): szkic lokalny w useHistory (etykiety operacji do aria-live; cofnij/ponów), autozapis co 2 s (useAutosave + AutosaveBar) z tokenem expectedUpdatedAt (CAS – p_expected_updated_at; token z detail albo z wyniku ostatniego zapisu; useSaveJourneyDraft z S8.1 wpisuje token do cache), rozróżnienie własnego zapisu od obcego (refetch detail po journey.changed.v1 nie nadpisuje brudnego szkicu; obcy updatedAt przy isDirty → konflikt), conflict → dane dla JourneyConflictDialog, useUnsavedChangesGuard(isDirty), flush() przed pierwszym zapisem treści nowego węzła send_email (RPC wymaga węzła w zapisanym szkicu – node_not_email), stan „wybierz wyzwalacz” dla szkicu bez triggerEventType, szkic archiwalny / podgląd wersji = tylko odczyt. API hooka opisz w summary (użyje go S8.3d w JourneyEditor, a panele S8.3c dostaną z niego flush).
- src/lib/admin/journeys/emailPreview.ts (+ __tests__/emailPreview.test.ts): podgląd treści maila w przeglądarce na próbkach JOURNEY_VARIABLE_SAMPLES, ZGODNY z wysyłką (test parytetu emailPreview ↔ render.server na kilku szablonach i zmiennych). Decyzja Z-S5-08 (podejmujesz ją, integrator akceptuje): przenieś czystą część substituteDocVariables z src/lib/journeys/render.server.ts do src/lib/journeys/variables.ts (render.server.ts importuje/re-eksportuje – zachowanie i testy S5 bez zmian), emailPreview korzysta z variables.ts. Te dwa pliki S5 (variables.ts, render.server.ts) WOLNO Ci zmienić – to zmiana integratorska: opisz ją w integration_requests jako „wykonane”; uruchom testy S5 renderu/zmiennych z src/lib/journeys/__tests__. Sprawdź, że variables.ts nie ciągnie do klienta modułów serwerowych.
- src/lib/journeys/editorSearch.ts (+ src/lib/journeys/__tests__/editorSearch.test.ts): walidowany search edytora (np. view=canvas|list, node, tab, stats=off, period) – zmieniaj tylko, jeśli potrzebne nowe parametry; zachowaj kompatybilność trasy src/routes/admin.revenue_.journeys.$journeyId.tsx (trasy nie edytujesz).
- src/components/admin/journeys/editor/JourneyConflictDialog.tsx (+ __tests__/JourneyConflictDialog.test.tsx): różnice lokalny vs serwer (diffLines/collapseContext z src/lib/content/revisionDiff.ts na liniach stabilnego JSON grafu i ustawień), „zachowaj moje” = zapis z nowym tokenem, „weź serwera” = reset; dostępny dialog (fokus, Esc), axe.
- Słownik src/lib/i18n-admin-journeys-editor.ts – gałąź adminJourneys.editor.* (session, autosave, conflict, preview…). Plik rozszerzy później agent S8.3d (pasek, trasa, okruszki) – zostaw porządną strukturę.`

const T_S83B = `ZADANIE: S8.3b – kanwa i lista (outline) edytora ścieżki. Pełny zakres S8.3: STAN_S8.md "### S8.3" (pkt (3) i (4) dotyczą Ciebie) oraz SPEC §6.3 (pakiet §2.1 dosłownie).
Twoje pliki: src/components/admin/journeys/editor/{JourneyCanvas,JourneyNodeCard,JourneyEdge,JourneyInsertButton,JourneyOutline}.tsx + __tests__/{JourneyCanvas,JourneyOutline}.test.tsx (+ testy NodeCard/InsertButton, jeśli wnoszą logikę), słownik src/lib/i18n-admin-journeys-canvas.ts (gałęzie np. adminJourneys.canvas / outline – sprawdź kolizje).
Wymagania: JourneyCanvas wg §6.3: kontener overflow-auto (nie ScrollArea), transform scale(z) 50–150 %, „dopasuj”, Ctrl/Cmd+= / - / 0; jeden <svg aria-hidden> z JourneyEdge (ścieżki z layout S8.1, vector-effect="non-scaling-stroke", currentColor klasy text-border); JourneyNodeCard (absolutny HTML 280×88, rounded-[6px], przycisk z aria-label typu „Krok 3 z 7: Wyślij e-mail «temat», 380 wysłanych”); etykiety gałęzi w HTML, chipy scalenia (fokus, Enter → przejście do celu); JourneyInsertButton (28 px) → Popover + PopoverAnchor z paletą (grupy z summaries, wyszukiwanie, opis skutku) i „Połącz z krokiem…” (mergeInto) na końcu gałęzi; jeden tab stop (roving tabindex jak src/components/admin/events/molecules/SeatMapCanvas.tsx:166-201), klawisze z nav.ts (strzałki, Home/End, Enter, Insert/+, Delete, zoom, Esc, Shift+F10 – menu kontekstowe z availableOps; Ctrl/Cmd+Z i Shift+Z przekazywane callbackiem do edytora), instrukcja sr-only (aria-describedby), aria-live="polite" dla operacji, Delete z ConfirmDialog przy poddrzewie, nakładka JourneyStatsOverlay (z S8.2 – przeczytaj jej propsy), usePrefersReducedMotion, cele ≥ 24 px, przeciąganie nigdy jedyną drogą; zero bibliotek grafu. JourneyOutline: role=tree/treeitem z aria-level/setsize/posinset/expanded, ta sama kolejność i numeracja co kanwa (test „Lista = te same węzły i kolejność co kanwa”), te same pozycje menu (availableOps) co kanwa.
Komponenty są KONTROLOWANE: przyjmują widok (buildJourneyView/layout), fokus/zaznaczenie i callbacki (np. onApplyOp(op), onSelectNode(nodeId), onOpenStep, onUndo/onRedo, onAnnounce) – stan sesji trzyma JourneyEditor (S8.3d, z editorSession S8.3a). Opisz propsy w summary.`

const T_S83C = `ZADANIE: S8.3c – panele boczne edytora (Sheet): krok, mail, warunki, wyzwalacz, ustawienia ścieżki. Zakres: STAN_S8.md "### S8.3" (panel kroku z formularzami 14 typów węzłów i edytorem maila, arkusze wyzwalacza i ustawień) i SPEC §6.3 (pakiet §2.1); parametry węzłów i predykatów z bibliotek S5 (pakiet §4.5: nodeTypes, predicates, triggers, limits).
Twoje pliki: src/components/admin/journeys/editor/{JourneyStepSheet,EmailStepEditor,PredicateRow,JourneyTriggerSheet,JourneySettingsSheet}.tsx + __tests__/{JourneyStepSheet,EmailStepEditor,JourneyTriggerSheet}.test.tsx (+ testy JourneySettingsSheet/PredicateRow), słownik src/lib/i18n-admin-journeys-steps.ts (gałęzie np. adminJourneys.stepSheet / emailStep / predicate / triggerSheet / settingsSheet – S5 ma już adminJourneys.trigger, .settings, .nodeType, .branch, .triggerGroup… – NIE koliduj).
Wymagania: JourneyStepSheet – formularze wszystkich 14 typów węzłów (parametry z nodeTypes/predicates S5, walidacja jak limity SQL/TS, odrzucenie zamiast przycięcia), zakładki „Ustawienia” / „Wyniki” (JourneyNodeResults z S8.2) / „Kontakty” (JourneyEnrollmentsTable z S8.2; pominięcie czekania tylko admin); wspólne atomy pól (TimeInput, DateInput, PlatformSelect, Switch). EmailStepEditor – edytor EmailDoc wg wzoru src/components/admin/newsletter/CampaignContentBuilder.tsx (blok post-list pominąć), warianty A/B, podgląd PL/EN przez emailPreview z S8.3a (src/lib/admin/journeys/emailPreview.ts – przeczytaj API), zapis treści mutatorem S5/S8.1 (wymaga zapisanego węzła send_email: przed pierwszym zapisem treści nowego węzła wywołaj przekazany flush() z editorSession S8.3a – przeczytaj API), temat/preheader z limitami. PredicateRow – wiersz warunku (warunki S5). JourneyTriggerSheet – wybór wyzwalacza z grupami i szacunkiem odbiorców (server fn/RPC S5, jeśli jest; inaczej stan „brak szacunku” i zgłoszenie w open). JourneySettingsSheet – ustawienia ścieżki (nazwa, kategoria, ponowne wejście, cel, okno wysyłki itd. wg S5 DTO).
Komponenty KONTROLOWANE: dostają szkic/węzeł, uprawnienia (access.ts) i callbacki zmian (onChangeNode / onChangeSettings / flush) – stan trzyma sesja edytora montowana przez JourneyEditor (S8.3d). Opisz propsy w summary.`

const T_S83C2 = `ZADANIE: S8.3c2 – problemy, publikacja, symulacja i test na żywo. Zakres: STAN_S8.md "### S8.3" (publikacja, symulacja, test na sobie) i SPEC §6.3 (pakiet §2.1); kontrakt pakietu §4.6–§4.7.
Twoje pliki: src/components/admin/journeys/editor/{JourneyIssuesList,JourneyPublishDialog,JourneySimulateDialog,JourneyTestPanel}.tsx + __tests__/{JourneyPublishDialog,JourneySimulateDialog,JourneyTestPanel,JourneyIssuesList}.test.tsx, słownik src/lib/i18n-admin-journeys-publish.ts (gałęzie np. adminJourneys.issuesList / publish / simulate / testRun – sprawdź kolizje; etykiety problemów są już w adminJourneys.common.issue – reużyj).
Wymagania: JourneyIssuesList – lista problemów z collectJourneyIssues/publishBlockers (S8.1 issues.ts), przejście do kroku (callback onFocusNode). JourneyPublishDialog – blokady publikacji (treść z szablonu, nadawca domyślny = brak sender_name w journey_settings – odchylenie od SPEC opisane w S8.1), szacunek wolumenu, „N kontaktów kontynuuje wersję k”, deduplikacja z przepisami (workflowDefinitionsQueryOptions + useSetWorkflowEnabled z src/lib/admin/workflowQueries.ts), tryb drain / exit_all, potwierdzenie, publikacja mutatorem S5/S8.1, konflikt CAS. JourneySimulateDialog – symulacja ze szkicem (nic nie zapisuje i nie wysyła), wynik krok po kroku. JourneyTestPanel – test na żywo wyłącznie na własnym kontakcie zalogowanego (mail z prefiksem „[TEST] ” – prefiks w runnerze doda integrator: opisz w UI i w integration_requests), pominięcie czekania tylko admin (redaktor: przycisk wyłączony z wyjaśnieniem). Runner nie jest jeszcze podpięty do jobs-tick (Z-S5-03, I9) – pokaż to uczciwie (engineHealthNotice z summaries).
Komponenty KONTROLOWANE (dostają journeyId, szkic, wersję, uprawnienia z access.ts, callbacki) – zamontuje je JourneyEditor (S8.3d). Opisz propsy w summary.`

const T_S83D = `ZADANIE: S8.3d – złożenie edytora: JourneyEditorRoute, JourneyEditor, JourneyToolbar, testy parytetu i autozapisu, okruszki, leniwe ładowanie; zamknięcie S8.3. Zakres: STAN_S8.md "### S8.3" (pkt (1), (2) i wszystkie kryteria) i SPEC §6.3. Wcześniejsi agenci zbudowali (przeczytaj ich kod i propsy – git log --stat ${BASE}..HEAD; nie zgadujesz): S8.2 (results/*, editor/JourneyStatsOverlay, lead/*, i18n-admin-journeys-results.ts), S8.3a (editorSession, emailPreview, editorSearch, JourneyConflictDialog, i18n-admin-journeys-editor.ts), S8.3b (JourneyCanvas, JourneyNodeCard, JourneyEdge, JourneyInsertButton, JourneyOutline; i18n-admin-journeys-canvas.ts), S8.3c (JourneyStepSheet, EmailStepEditor, PredicateRow, JourneyTriggerSheet, JourneySettingsSheet; i18n-admin-journeys-steps.ts), S8.3c2 (JourneyIssuesList, JourneyPublishDialog, JourneySimulateDialog, JourneyTestPanel; i18n-admin-journeys-publish.ts).
Twoje pliki: src/components/admin/journeys/editor/{JourneyEditorRoute,JourneyEditor,JourneyToolbar}.tsx + __tests__/{JourneyEditorRoute,JourneyEditorParity,JourneyEditorAutosave}.test.tsx; rozszerzenie src/lib/i18n-admin-journeys-editor.ts (gałąź adminJourneys.editor – pasek, trasa, okruszki). Wolno Ci też: drobne poprawki integracyjne w plikach S8.2/S8.3a–c2 (propsy, błędy wykryte przy złożeniu – opisz w summary) oraz zapis filtrów listy (?status=&q=) przed wejściem do edytora w src/components/admin/journeys/list/JourneyList.tsx (S8.1) – sessionStorage w try/catch albo history.state.
Wymagania: JourneyEditorRoute zachowuje bramkę wymaganą przez src/routes/__tests__/adminRouteAuthority.gate.test.ts (literał roles.includes("admin") || roles.includes("editor"), napis revenue-role-gate, brak roles.includes("author"), ŻADNEGO identyfikatora isAdmin/isSuperAdmin – użyj journeyCapabilities z access.ts), useHydrated → RevenueTabPending, data-testid="journey-editor" z data-journey-id i data-view, błąd mfa_required → MfaRequiredNotice; JourneyEditor ładowany leniwie (lazy(() => import(...)), przyrost chunku ≤ +25 KB gz); okruszki „Przychód i lejek › Ścieżki › {nazwa}” z powrotem do ostatnich filtrów listy (brak → /admin/revenue/journeys); props search z trasy (editorSearch), nawigacja useNavigate (to: '/admin/revenue/journeys/$journeyId'). JourneyEditor: sesja z editorSession (S8.3a), widok kanwa/lista (usePrefersReducedMotion → domyślnie Lista), pasek (cofnij/ponów z aria-live, zoom, widok, problemy, symulacja, test, publikuj, ustawienia ścieżki, ?stats=off, AutosaveBar), panele i dialogi z S8.3b/c/c2, klawiatura wg nav.ts (Ctrl/Cmd+Z, Shift+Z itd.), konflikt → JourneyConflictDialog, useUnsavedChangesGuard, atrybuty data-tour="journey-canvas" i "journey-publish". Testy: JourneyEditorParity (te same pozycje menu z availableOps w kanwie, liście i Shift+F10; lista = te same węzły i kolejność co kanwa), JourneyEditorAutosave (2 s, p_expected_updated_at, konflikt → dialog różnic, własny vs obcy zapis, ochrona przed utratą), JourneyEditorRoute (bramka, MFA, hydratacja, testid, okruszki).
Na końcu zmierz bundel: flock -x /tmp/hub-heavy.lock env BUNDLE_INVENTORY=1 bun run build, potem bun run check:bundle; bun run check:chunks; bun run check:entry-purity; bun run check:server-entry-purity – wynik overall/css/public/publicCss/chunk/boot (zmierzone vs progi) wpisz do gates/summary. Przekroczenie overall/css jest oczekiwane (ratchet robi integrator); public/publicCss/chunk/boot MUSZĄ być w progach – inaczej popraw kod (leniwe ładowanie, przeniesienie na serwer). Sprawdź, że templates/index.ts (pełne EmailDoc) i render.server.ts nie wyciekają do chunków klienta. Test I0 src/routes/__tests__/adminRevenueHubRoutes.test.tsx (asercja zaślepki „w przygotowaniu” dla edytora) zaczerwieni się – podaj integratorowi dokładny diff (asercja journey-editor + data-journey-id/data-view z zamockowanym getJourneyDetail).`

function gatesPrompt(prev) {
  return `ZADANIE: S8-bramki – pełna weryfikacja wycinka S8 (bez integracji plików współdzielonych) i raport kryteriów karty S8.
Wyniki poprzednich agentów S8 (JSON – integration_requests, odchylenia, otwarte sprawy):
${JSON.stringify(prev)}

Kroki:
(1) Przeczytaj kartę S8 (pakiet §1 dosłownie) i kryteria S8.2/S8.3 w STAN_S8.md.
(2) Uruchom po kolei (każde raz; po poprawce powtarzasz tylko czerwone i dotknięte testy):
 flock -x /tmp/hub-heavy.lock bun run format:check
 flock -x /tmp/hub-heavy.lock bun run verify:static
 typecheck zawężony (pkt 2 bramek) na WSZYSTKICH plikach .ts/.tsx zmienionych od BAZY (git diff --name-only ${BASE}..HEAD) i ich importerach (grep -rl)
 bun run typecheck:scripts && bun run typecheck:e2e
 flock -x /tmp/hub-heavy.lock bun run lint
 flock -x /tmp/hub-heavy.lock env TZ=UTC bunx vitest run --maxWorkers=2 src/lib/admin/journeys src/components/admin/journeys src/lib/journeys src/lib/ci src/lib/__tests__ src/lib/admin src/lib/revenue src/components/admin/revenue src/routes/__tests__ src/__tests__/i18nParity.gate.test.ts src/lib/crm
 bun run check:ts-sql-contract (jeśli skrypt istnieje – nowe .from() w S8: literały, kolumny, granty)
 bun run scripts/hub-slice-guard.ts S8 --base ${BASE}
 flock -x /tmp/hub-heavy.lock env BUNDLE_INVENTORY=1 bun run build && bun run check:bundle; bun run check:chunks; bun run check:entry-purity; bun run check:server-entry-purity
 bun run generate:authz-snapshot --check
(3) Czerwone w plikach S8 (src/lib/admin/journeys/**, src/components/admin/journeys/**, src/components/admin/revenue/tabs/RevenueJourneysTab.tsx, src/lib/journeys/editorSearch*, src/lib/journeys/{variables,render.server}.ts zmienione przez S8.3a, słowniki src/lib/i18n-admin-journeys-{list,results,editor,canvas,steps,publish}.ts) – napraw przyczynę (nie pomijaj/nie wyłączaj testów) i commituj "hub(S8): poprawki bramek – …". Czerwone wynikające wyłącznie z braku zmian integratorskich (np. adminRevenueHubRoutes.test.tsx – zaślepka edytora, adminNav.test.ts, manifest hubDelivery dla nowych słowników, ratchet overall/css, authz snapshot, allowlista i18nParity) – NIE naprawiasz, tylko dokładny diff w integration_requests.
(4) Sprawdź, że ustawienia silnika w panelu (src/components/admin/journeys/list/JourneySettingsDialog.tsx, S8.1) obejmują przełącznik pomiaru otwarć open_tracking_enabled (I9c-X2), nadawcę i Reply-To – jeśli czegoś brak, uzupełnij z testem.
(5) Raport: integration_requests = połączona lista WSZYSTKICH podzadań S8 (z JSON wyżej i z STAN_S8.md „Oczekiwane zmiany plików współdzielonych”, bez duplikatów, z aktualnym, dokładnym opisem) + Twoje; deviations = połączone odchylenia S8.1–S8.3 do dziennika; acceptance = KAŻDE kryterium karty S8 (pakiet §1) [spełnione/niespełnione] z dowodem (test/plik); gates = tabela wszystkich bramek z wynikami + pomiar bundla (overall, css, public, publicCss, chunk, boot: zmierzone/próg); open = otwarte sprawy.`
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

const pc = run('S8.3c', 'S8.3', common('S8.3c', 's83c') + '\n' + T_S83C + RESUME('S8.1, S8.2, S8.3a (sesja, podgląd, konflikt), S8.3b (kanwa, lista), S8.3c2 (publikacja, symulacja, test)'))
const pd = run('S8.3d', 'S8.3', common('S8.3d', 's83d') + '\n' + T_S83D + RESUME('S8.1, S8.2, S8.3a, S8.3b, S8.3c, S8.3c2'), [pc])
const all = await Promise.all([pc, pd])
const g = await run('S8-bramki', 'Bramki', common('S8-bramki', 's8g') + '\n' + gatesPrompt(brief(all)) + '\nRaporty WCZEŚNIEJSZYCH agentów S8 (S8.3c2, S8.2, S8.3a, S8.3b – integration_requests, odchylenia, kryteria): plik /home/user/wt/S7/_kontynuacja/prev-S8.json – przeczytaj go (python3 -c / jq) i uwzględnij w zbiorczym raporcie.', [])
return { subtasks: all, gates: g }
