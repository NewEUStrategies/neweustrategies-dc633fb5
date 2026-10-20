# Prompt kontynuacji – hub „Przychód i lejek” (stan 2026-10-20, przekazanie do innej sesji)

## 0. Jak użyć

Wklej w nowym czacie Claude Code (także na innym koncie) poniższy tekst:

```
Kontynuujesz pracę w repo NewEUStrategies/neweustrategies-dc633fb5, PR #530
(gałąź claude/elegant-fermat-xwfca1). Najpierw `git fetch origin` i przeczytaj
W CAŁOŚCI plik docs/PROMPT_KONTYNUACJI_HUB_2026-10-20.md z gałęzi
origin/claude/elegant-fermat-xwfca1 - to Twoje zadanie, zasady i procedury.
Wykonaj kroki 1-5 po kolei (S8 → S7 → I9d → I9 → zamknięcie), każdy krok
kończ pushem do PR #530 po zielonych bramkach, sprawdzeniem CI i aktualizacją
opisu PR. Pracuj po polsku. Nie pytaj o rzeczy rozstrzygnięte w tym pliku;
pytaj tylko o decyzje oznaczone jako „do decyzji właściciela”.
```

Ten plik jest JEDYNYM źródłem instrukcji przekazania. Szczegóły techniczne
wycinków są w dzienniku i w materiałach `_kontynuacja/` na gałęziach `*-wip`
(punkt 6).

---

## 1. Kontekst

Moduł panelu admina **„Przychód i lejek”** (NES – New European Strategies,
think-tank/wydawca analiz; trasa `/admin/revenue`) porządkuje w jednym miejscu
cennik, paywall, lejek, retencję, CRM, newsletter, ścieżki e-mail (w stylu
HubSpot), wydarzenia i kluby, z dwukierunkową synchronizacją modułów (wspólne
mutatory, fabryki kluczy zapytań, zdarzenia domenowe), BI i słownikiem
wskaźników PL/EN z pięcioma progami oceny (krytyczny, słaby, normalny, dobry,
optymalny). Stos: TanStack Start (SSR), React Query, Supabase/Postgres (RLS,
RPC, pgTAP), bun, vitest, Playwright, tsgo, i18n PL/EN.

Właściciel scala PR-y sam. PR #530 jest szkicem; wycinki wchodzą do niego kolejno.

### 1.1 Co już jest w PR #530 (CI zielone)

| Wycinek | Zakres                                                                                                                                                                                                    | Dziennik     |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| S3      | lejek i paywall czytelnika, zdarzenia lejka, raporty lejka i dostępu, poprawki P08, P15, P17-P22                                                                                                          | §18          |
| I9a     | hub w nawigacji panelu i ⌘K, zakładki „w przygotowaniu”, okno porzucenia kasy                                                                                                                             | §19          |
| S5      | silnik ścieżek (backend): 6 migracji `2026102014*`, runner, 14 szablonów, tracking, D-03/D-04, silnik domyślnie wyłączony                                                                                 | §20          |
| I9b     | decyzje właściciela: segmenty przychodu, cennik v6.2, limit miejsc Zespołu, RODO księgi i po usunięciu konta, rejestr czynności, budżet `public`, bilety, scenariusz Stripe, benchmarki, D-11, limit tagu | §21.1-21.19  |
| I9c     | domknięcia RODO (konta personelu, kolejka maili) i retencja danych z kartą w `/admin/settings/privacy`                                                                                                    | §21.20-21.21 |

Migracje do `20261020161400`, bliźniaki drizzle do `0372`. Wcześniejsze
wycinki (I0, S6, S1, S4, S2) są w `main` (#520, #527).

### 1.2 Czego NIE ma w PR

- **S8** (ścieżki w panelu) – zrobione S8.1 z 3; S8.2 i S8.3 do zrobienia.
- **S7** (zakładki huba, diagnostyka, naprawy) – S7.1 przerwane w trakcie;
  S7.2 i S7.3 do zrobienia.
- **I9d** (decyzje właściciela RODO, cz. 2) – zatwierdzone, niezaczęte.
- **I9** (integracja i wydanie) – niezaczęte.

---

## 2. Warunki środowiska (nowa sesja, inne konto)

1. Dostęp do `NewEUStrategies/neweustrategies-dc633fb5` z prawem push:
   aplikacja Claude GitHub na repozytorium i konto GitHub połączone
   w ustawieniach claude.ai. Bez tego zatrzymaj się i poproś właściciela.
2. **Gałąź:** zmiany mają trafić na `claude/elegant-fermat-xwfca1` (PR #530).
   Jeśli sesja ma przypisaną inną gałąź roboczą – pracuj na niej od
   `origin/claude/elegant-fermat-xwfca1`, a po każdym kroku scal ją
   fast-forwardem do `claude/elegant-fermat-xwfca1` i wypchnij. Jeśli
   środowisko blokuje push na tę gałąź – otwórz PR ze swojej gałęzi do
   `claude/elegant-fermat-xwfca1` i poinformuj właściciela. Nigdy force-push
   na gałąź PR.
3. Start:
   ```bash
   git fetch origin
   git checkout claude/elegant-fermat-xwfca1 && git merge --ff-only origin/claude/elegant-fermat-xwfca1
   bun install --frozen-lockfile
   nproc; free -g        # zasoby decydują o równoległości (pkt 4.7)
   ```
4. Subskrybuj aktywność PR #530 (jeśli dostępne), żeby dostawać wyniki CI;
   nie odpytuj CI w pętli.

---

## 3. Dokumenty (czytaj sekcjami: `grep -n '^#'` + `sed -n`)

- `docs/WDROZENIE_HUB_PRZYCHOD_LEJEK_2026-10.md` – **dziennik wdrożenia**
  (≈3500 linii): §10 tabela wdrożeń, §17 stan, §18-§21 ostatnie wycinki
  (wzór stylu sekcji), §21.7 i §21.18 zgłoszenia i sprawy właściciela,
  §21.20-21.21 RODO i retencja.
- `docs/SPEC_MODUL_PRZYCHOD_LEJEK_2026-10-18.md` – **wiążąca specyfikacja**
  (≈370 KB): karty S7, S8, I9 w §8.3; §5.6 silnik ścieżek, §5.7 diagnostyka,
  §6.3 kanwa ścieżek, §6.4 dialogi napraw, §8.4 pliki współdzielone, §8.6
  budżet, §9.3 decyzje D-01…D-12. Fakty repozytorium wygrywają ze SPEC
  (kontrakt nazw bez zmian), każde odchylenie trafia do dziennika.
- `docs/KONTYNUACJA_HUB_PRZYCHOD_LEJEK_2026-10-19.md` – kolejka i zasady
  (aktualizowane przez integratorów).
- `docs/RODO_REJESTR_CZYNNOSCI_HUB_2026-10.md` – rejestr czynności
  przetwarzania huba (art. 30 RODO; „zatwierdzone przez administratora danych
  2026-10-20; do wiadomości IOD”).
- `docs/WIEDZA_INSIDER_MARKETINGOWY_2026-10-19.md` + `docs/benchmarki/**`
  i `docs/BENCHMARKI_WSKAZNIKOW_2026-10-18.md` – jedyne źródła liczb
  benchmarków.
- `src/lib/ci/hubDelivery.ts` – rejestr dostaw: manifesty plików wycinków,
  rejestr funkcji SQL (właściciel, grant), bloki wersji (S7 = `2026102015`,
  I9 = `2026102016`), strażnik `scripts/hub-slice-guard.ts <ID> --base <sha>`.
- `AGENTS.md` – reguły architektury (ładowane automatycznie).

---

## 4. Zasady (właściciel + AGENTS.md) – obowiązują w każdym kroku

1. **Wszystko w panelu admina:** każda funkcja i ustawienie operowalne
   z panelu dla właściwych ról; żadnych przełączników tylko z SQL/env.
   Sekcyjne `adminPageHead` (na stronach ustawień tytuł „… - Ustawienia”),
   skróty ⌘K, i18n PL/EN z parytetem (bramka `i18nParity.gate.test.ts`).
2. **UI:** wspólne atomy dat/czasu/select i tokeny rozmiarów (zachowanie
   lokalnych dat i natywnych wartości formularzy); jednakowa geometria
   light/dark (różnią się tylko kolory); dostępność (role, aria, fokus,
   klawiatura, axe); atomy i molekuły S6 (`KpiTile` z `metricId`,
   `MetricExplainer`, `BenchmarkScale`, `SourceHeader`, `RelatedModulesBar`,
   `RoleGateNotice`, `MetricTooltip`); `useHydrated` przy bramkach klubów;
   fabryki kluczy zapytań (bramka `queryKeyLiterals`), wspólne mutatory
   i `queryOptions`, zdarzenia domenowe i mapa inwalidacji.
3. **SQL / migracje:**
   - plik ≤ 45 KiB (`bun run scripts/split-migration.ts <plik> --dry-run`),
     nazwa `^\d{14}_[a-z0-9_]+\.sql$`, idempotentne;
   - polski nagłówek DEFEKT/ZMIANA/KOLEJNOSC/IDEMPOTENTNA/DOWOD (wzór
     `supabase/migrations/20261012131000_sms_send_log.sql`);
   - `-- CIALO-Z: <wersja>` przy redefinicji funkcji (najnowsza wcześniejsza
     definicja – grep po WSZYSTKICH migracjach);
   - nowe tabele: `tenant_id NOT NULL` FK `ON DELETE CASCADE`, RLS,
     `REVOKE ALL FROM PUBLIC, anon, authenticated`, jawne GRANT;
   - SECURITY DEFINER zawsze z `SET search_path = public, pg_temp`,
     REVOKE/GRANT wg rejestru w `hubDelivery.ts`;
   - **tenant i user z sesji** (`current_tenant_id()`, `assert_admin_tenant()`,
     `auth.uid()`), **nigdy z payloadu**; literalne nazwy RPC/tabel w TS
     (bramka `generate:ts-sql-contract`); server-only = `service_role`;
   - nie edytujesz migracji już wypchniętych; nie dopisujesz
     `supabase/migration-ledger.json`;
   - bliźniak drizzle: `cp` bajt w bajt do `drizzle/migrations/NNNN_<nazwa bez
wersji>.sql` (NNNN = następny wolny numer; po I9c: `0373`), wpis na końcu
     `drizzle/migrations/meta/_journal.json` (idx rosnący, `when` = poprzedni
     - 60000), `bun run check:migration-lanes`;
   - **kolejność wersji = kolejność dziennika drizzle**: migracja nie może
     zależeć od obiektów z wersji późniejszej ani redefiniować ich (replay
     w pgTAP idzie po wersjach, produkcja po dzienniku drizzle).
4. **Harnessy:** migracja wspominająca `career_*`/`contact_messages`/
   `event_*`/`club_*`, która sięga też poza te moduły → znacznik
   `-- careers-harness: exclude` albo `-- pg-harness: exclude` jako OSOBNA
   linia komentarza w nagłówku z uzasadnieniem (wzór `20261020160900`).
   Zawsze uruchamiaj `check:pg-harness`, `check:careers-harness`,
   `check:events-harness` przy zmianach SQL.
5. **Budżet bundla (D-08):** `public` (2881), `publicCss` (85), `chunk` (286),
   `boot` (579) **ZAMROŻONE** – przekroczenie = popraw kod (leniwe ładowanie,
   przeniesienie na serwer). `overall`/`css` – ratchet: nowy próg =
   `ceil(zmierzone) + 1` z wpisem kroniki nad progiem w
   `scripts/check-bundle-size.ts` (styl jak poprzednie wpisy: „Ratchet X -> Y
   (data, wycinek: …), decyzją zamawiającego D-08 … Host N -> ceil -> +1”).
   Obecnie `overall` 5023 (zmierzone 5021,2). Kod panelu ładuj leniwie.
6. **Jakość z bramek, bez etapu przeglądu adwersaryjnego.** Testy dla
   wszystkiego, co dodajesz (vitest/RTL/axe, pgTAP z asercjami). Pełna suita
   vitest idzie w CI (decyzja właściciela); lokalnie – celowane testy.
   **Push tylko po zielonych bramkach**; po pushu sprawdź CI i naprawiaj
   czerwone (przyczyna, nie pomijanie testów).
7. **Zasoby (kontener 16 GB, 4 rdzenie – sprawdź swoje):** ciężkie polecenia
   pojedynczo (`flock -x /tmp/hub-heavy.lock <cmd>` dla tsgo, build,
   `format:check`, `verify:static`, `lint`, dużych vitest); pgTAP pod
   `flock -x /tmp/hub-pgtap.lock`, harnessy pod `flock -x /tmp/hub-harness.lock`.
   Pełny niskopamięciowy tsgo (`GOMEMLIMIT=11GiB GOGC=50 bunx tsgo --noEmit
--checkers 1`, ≈14 GB) tylko gdy nic ciężkiego nie działa obok.
8. **Oszczędność tokenów:** jeden agent na podzadanie, czytaj pakiety
   `_kontynuacja/` zamiast całego SPEC, bez powtarzania pełnych przebiegów
   (po poprawce powtarzasz tylko czerwoną bramkę i testy dotknięte zmianą),
   bez pętli odpytywania CI.
9. **Benchmarki:** liczb nie wymyślasz. **Komentarze w kodzie po polsku**,
   wyjaśniające DLACZEGO (gęstość jak w otoczeniu). Commity po polsku
   „hub(<wycinek>): …”.
10. **Pliki współdzielone** (SPEC §8.4: `routeTree.gen.ts`, `adminNav.ts`,
    `integrations/supabase/types.ts`, `domainEvents.ts`,
    `eventInvalidationMap*.ts`, `useModuleRealtime.ts`, jobsTick, scheduler,
    `scripts/check-bundle-size.ts`, `reports/*`, `i18nParity.gate.test.ts`,
    `i18n-admin-core.ts`, `adminRouteAuthority.gate.test.ts`, authzSnapshot,
    ownership, CODEOWNERS, `hubDelivery.ts`, `drizzle/**`, dziennik,
    KONTYNUACJA) zmienia integrator wycinka, z opisem w dzienniku.

### 4.1 Lekcje z CI tej serii (nie powtarzaj)

- Lokalny `tsgo --checkers 1` NIE widzi części błędów, które CI (domyślne
  checkery) zgłasza → zawsze dodatkowo **zawężony typecheck jak w CI**:
  ```bash
  # w katalogu repo/worktree (inaczej nie rozwiąże typów z node_modules)
  cat > tsconfig.tmp.json <<'EOF'
  {"extends": "./tsconfig.json", "compilerOptions": {"incremental": false},
   "include": ["src/**/*.d.ts", "src/routeTree.gen.ts", "vitest.setup.ts", "<zmienione .ts/.tsx>", "<pliki je importujące>"]}
  EOF
  flock -x /tmp/hub-heavy.lock env GOMEMLIMIT=6GiB bunx tsgo --noEmit -p tsconfig.tmp.json; rm tsconfig.tmp.json
  ```
  (bez `vitest.setup.ts` matchery jest-dom dają fałszywe błędy).
- Migracja RODO dotykająca wielu modułów wpadła w selektor
  `careers-harness` → znacznik exclude (pkt 4.4).
- Nowy `adminPageHead` strony ustawień bez „- Ustawienia” → czerwony
  `adminSettingsRoutes.test.tsx`.
- Subagentowi system uprawnień potrafi zablokować ratchet D-08 („obejście
  CI”): nie obchodzić – orkiestrator wykonuje ratchet sam (to stała decyzja
  właściciela) albo wpis kroniki + arytmetyka w komunikacie commita, bez
  ponownego `check:bundle` po zmianie progu.
- Fikstury `as const` kopiowane przez JSON: pomocnik `clone` zwraca `unknown`.

---

## 5. Procedura standardowa wycinka (użyj w krokach 1-4)

1. **Worktree:** `git worktree add ../wt/<ID> -b <gałąź> origin/claude/elegant-fermat-xwfca1`
   (albo od gałęzi roboczej – krok 1/2), `bun install --frozen-lockfile`,
   zapisz BAZA = `git rev-parse HEAD`.
2. **Implementacja** podzadań po kolei (jeden agent na podzadanie, pliki
   rozłączne), każde z testami i lekkimi bramkami: prettier i eslint
   zmienionych plików, zawężony typecheck, celowane vitest (`TZ=UTC bunx vitest
run --maxWorkers=2 <pliki>`), pgTAP własnych plików SQL. Commit po każdym
   podzadaniu.
3. **Integracja** (pliki współdzielone, pkt 4.10): integration_requests
   podzadań, bliźniaki drizzle, `types.ts`, `hubDelivery.ts` (manifest,
   rejestr funkcji, komentarz „Integrator <ID>, <data>”), i18n-admin-core /
   `GATED_PREFIXES`, adminNav / ⌘K, `tabPreparing.ts`, authzSnapshot
   (`bun run generate:authz-snapshot`). Commit „hub(<ID>): integracja - pliki
   współdzielone (…)”.
4. **Pełne bramki** (każda raz; po poprawce tylko czerwona i dotknięte testy):
   ```bash
   flock -x /tmp/hub-heavy.lock bun run format:check
   flock -x /tmp/hub-heavy.lock bun run verify:static          # 18 bramek
   # typecheck: zawężony jak w CI (pkt 4.1) na WSZYSTKICH zmienionych plikach i importerach
   bun run typecheck:scripts && bun run typecheck:e2e
   flock -x /tmp/hub-heavy.lock bun run lint
   flock -x /tmp/hub-heavy.lock env TZ=UTC bunx vitest run --maxWorkers=2 <katalogi wycinka> src/lib/ci src/lib/__tests__ src/lib/admin src/lib/revenue src/lib/journeys src/components/admin/revenue src/routes/__tests__
   # przy SQL:
   export PGTAP_DIR=/tmp/pgtap-hub PGTAP_PORT=5490
   flock -x /tmp/hub-pgtap.lock bash scripts/pgtap-local/run.sh all
   bun run generate:ts-sql-contract && flock -x /tmp/hub-pgtap.lock bash scripts/pgtap-local/run.sh test ts_sql_contract
   bun run check:rpc-contract && bun run check:types-freshness && bun run check:migration-lanes
   for c in sql-tenant-scope sql-app-role sql-anon-insert sql-definer-views on-conflict-arbiters sql-owner-tenant-scope sql-policy-tenant-regression sql-migration-replay; do bun run check:$c; done
   for f in supabase/migrations/<nowe>.sql; do bun run scripts/split-migration.ts "$f" --dry-run; done
   flock -x /tmp/hub-harness.lock bun run check:pg-harness && flock -x /tmp/hub-harness.lock bun run check:careers-harness && flock -x /tmp/hub-harness.lock bun run check:events-harness
   # zawsze:
   flock -x /tmp/hub-heavy.lock bun run build && bun run check:bundle && bun run check:chunks && bun run check:entry-purity && bun run check:server-entry-purity
   bun run generate:authz-snapshot --check
   bun run scripts/hub-slice-guard.ts <ID> --base <BAZA>   # dopuszczalne naruszenia = zmiany integratorskie
   ```
   Znane błędy środowiska pgTAP (nie naprawiaj): 3 asercje pg_net
   (`community_cron_schedule`, `job_scheduler_heartbeat`),
   `public_definer_views_read_only` 1/35, `profile_intent_semantic` (vector),
   migracja `20260825230232`.
5. **Budżet D-08** (pkt 4.5).
6. **Dziennik:** nowa sekcja (kolejny numer po ostatniej) w stylu §18/§20:
   zakres, decyzje, odchylenia od SPEC, zmiany integratorskie, zgłoszenia
   zamknięte (w sekcjach źródłowych dopisek „**Zamknięte <data> (<ID>, §NN)**”)
   i otwarte Z-<ID>-NN, bliźniaki, bundle przed/po, tabela bramek, kryteria
   akceptacji karty [x]/[ ] z dowodem; wiersz w §10; aktualizacja §17
   i `docs/KONTYNUACJA_…`. `bunx prettier --write` dokumentów.
7. **Push:** `git fetch origin`, rebase na `origin/claude/elegant-fermat-xwfca1`
   jeśli trzeba, `git merge --ff-only <gałąź>` w głównym katalogu na
   `claude/elegant-fermat-xwfca1`, `git push origin claude/elegant-fermat-xwfca1`
   (retry 2/4/8/16 s przy błędzie sieci; bez force). Usuń worktree.
8. **CI i PR:** po pushu sprawdź check-runy PR #530; czerwone → przyczyna,
   poprawka, push. Zaktualizuj opis PR #530 (checklista, sekcja wycinka,
   stan CI, sprawy właściciela). Dopiero zielone CI = krok zamknięty.

---

## 6. KROK 1 – S8: ścieżki w panelu (dokończenie i integracja)

**Cel (karta S8, SPEC §8.3, bez SQL):** cały interfejs ścieżek (§6.3) na RPC
z S5: lista, galeria szablonów, ustawienia i zdrowie silnika, edytor kanwy
(HubSpot), wyniki, karta leada „Ścieżki” w CRM.

### 6.1 Odtworzenie

```bash
git fetch origin
git worktree add ../wt/S8 -b hub/s8-sciezki-panel origin/hub/s8-sciezki-panel   # S8.1 = 6d602ca5
cd ../wt/S8 && bun install --frozen-lockfile
git checkout origin/hub/s8-sciezki-panel-wip -- .                                # migawka (S8.2 przerwane na starcie) + _kontynuacja/
git status
git rebase origin/claude/elegant-fermat-xwfca1   # po zacommitowaniu/odłożeniu zmian; baza S8.1 = fcc08c55
```

**Alternatywa w samym PR** (gdy gałęzie robocze zniknęły): w gałęzi PR jest
`docs/kontynuacja/s8/` – `0001-S8.1-fundament-lista-galeria.patch` (commit
S8.1, `git am` albo `git apply`), `STAN_S8.md` i `S8.md` (te same materiały
co `_kontynuacja/`). Po zintegrowaniu S8 usuń `docs/kontynuacja/s8/` z PR.

Przeczytaj `_kontynuacja/STAN_S8.md` (podział na S8.1-S8.3 z plikami,
zakresem, kryteriami i testami; raport S8.1 z `integration_requests`) i
`_kontynuacja/S8.md` (pakiet: karta S8 dosłownie, §6.3, kontrakt server fn/
DTO S5, zgłoszenia, wiedza Insidera). **`_kontynuacja/` nie commituj.**

### 6.2 S8.1 – zrobione (`6d602ca5`)

Fundament: `src/lib/admin/journeys/{viewModel,layout,nav,ops,summaries,issues,hash,access,journeyEditor.functions,journeyQueries,journeyMutations}.ts`
z testami, lista ścieżek z galerią, ustawienia i zdrowie silnika (zakładka
Ścieżki). Jego `integration_requests` są w `STAN_S8.md` – wykonuje je
integrator S8.

### 6.3 S8.2 – wyniki, statystyki na kanwie, karta leada (do zrobienia)

- `src/lib/admin/journeys/results.ts` (czyste): kroki lejka w kolejności
  numeracji `buildJourneyView`, powody wyjścia, wiersze tabeli e-maili
  (queued, sent, uniqueHumanOpens, uniqueClicks, ctor, unsubscribed, bounced,
  complained, fallbackLocale), **werdykt A/B** (n < 100 na ramię → „za mało
  danych”; różnica pp, ufność z |z| ≥ 1,96 → 95 %, ≥ 2,58 → 99 %), mapowanie
  na `metricId`/benchmark (liczby wyłącznie z rejestru S6), serie dzienne,
  okno z `resolveRevenueRange(period)`.
- Komponenty `src/components/admin/journeys/results/*`: `JourneyResults`
  (kafle `KpiTile` z oceną progową), `JourneyStepFunnel`, `JourneyTrendCard`,
  `JourneyExitsCard`, `JourneyAbCard`, `JourneyEmailsTable`,
  `JourneyNodeResults`, `JourneyEnrollmentsTable`, nakładka statystyk na kanwę
  (`JourneyStatsOverlay`) – z testami RTL/axe.
- Karta leada „Ścieżki” w CRM (`LeadJourneysCard` lub wg pakietu) – zapisy
  kontaktu, wyjście z zapisu, link do ścieżki; oś leada z typem `journey`
  (jeśli w zakresie S8; inaczej zgłoszenie dla I9).
- Uwaga Z-I9c-06: statystyki zapisów dla okien starszych niż retencja – pokaż
  stan „dane od …” zamiast zera.
- Pełny zakres i lista plików: `STAN_S8.md` → „S8.2”.

### 6.4 S8.3 – edytor kanwy (do zrobienia)

- `src/components/admin/journeys/editor/*`: `JourneyEditorRoute` (bramka jak
  wymaga `adminRouteAuthority.gate`: literał
  `roles.includes("admin") || roles.includes("editor")`, napis
  `revenue-role-gate`, bez `roles.includes("author")` i bez
  `isAdmin/isSuperAdmin` – użyj `journeyCapabilities`; `useHydrated`;
  `MfaRequiredNotice` przy `mfa_required`; **`JourneyEditor` ładowany leniwie,
  chunk ≤ +25 KB gz**; okruszki „Przychód i lejek › Ścieżki › {nazwa}”
  z powrotem do filtrów listy), `JourneyEditor`, `JourneyToolbar`,
  `JourneyCanvas`, `JourneyNodeCard`, `JourneyEdge`, `JourneyInsertButton`,
  `JourneyOutline` (lista = ta sama kolejność co kanwa), `JourneyStepSheet`,
  `JourneySettingsSheet`, `JourneyTriggerSheet` (szacunek odbiorców),
  `JourneyIssuesList`, `JourneyPublishDialog` (blokady publikacji),
  `JourneySimulateDialog`, test na żywo, edytor maila z podglądem.
- `editorSession.ts`: szkic lokalny z historią (cofnij/ponów, aria-live),
  autozapis co 2 s z tokenem `expectedUpdatedAt` (CAS), rozróżnienie
  własnego i obcego zapisu.
- Klawiatura wg `nav.ts` (strzałki, Home/End, Enter, Insert/+, Delete,
  Ctrl/Cmd+Z, Shift+Z, zoom, Esc, Shift+F10).
- **Z-S5-08 (podgląd treści):** `substituteDocVariables` jest w
  `render.server.ts`; przenieś czystą część do `src/lib/journeys/variables.ts`
  (podgląd w przeglądarce na próbkach `JOURNEY_VARIABLE_SAMPLES`) albo server
  fn podglądu – decyzja S8, opisz w dzienniku.
- Pełny zakres: `STAN_S8.md` → „S8.3”.

### 6.5 Integracja S8 – specyficzne

- `integration_requests` S8.1-S8.3 (i18n-admin-core, `hubDelivery.ts`
  manifest S8, ewentualne `domainEvents`/inwalidacja).
- adminNav/⌘K: skrót **„Nowa ścieżka”** → `/admin/revenue/journeys?new=1`
  (I9a przypiął w `adminNav.test.ts` BRAK skrótu – zmień test) i obsługa
  `?new=1` w zakładce Ścieżki (otwarcie galerii/kreatora).
- `src/lib/admin/revenue/tabPreparing.ts`: usuń wpis zakładki Ścieżki
  (stan „w przygotowaniu” znika).
- Ustawienia silnika w panelu obejmują przełącznik **pomiaru otwarć**
  (`open_tracking_enabled`, dodany w I9c-X2) oraz nadawcę i Reply-To.
- Bundle: kod S8 tylko w leniwych chunkach admina; ratchet `overall` wg D-08.
- Bramki pkt 5.4 (bez pgTAP poza `ts_sql_contract`, chyba że coś dotyka SQL).
- Dziennik: sekcja „Wycinek S8 – Ścieżki: lista, galeria, edytor kanwy,
  ustawienia silnika, wyniki, karta leada (data)”, kryteria karty S8 [x]/[ ].
- Po pushu i zielonym CI: `git push origin --delete hub/s8-sciezki-panel-wip`.

---

## 7. KROK 2 – S7: zakładki huba, diagnostyka, szybkie naprawy

**Cel (karta S7, SPEC §8.3):** wszystkie zakładki poza Ścieżkami (Kokpit,
Przychód/MRR, Lejek, Retencja, Społeczność, Diagnostyka, Oferta, Dostęp,
Wskaźniki, Dane wejściowe), rejestr reguł i napraw, `admin_revenue_facts`,
wyciszenia, `RevenueSignalChip`, scenariusze synchronizacji, przychód
zrealizowany na pulpicie marketingu.

### 7.1 Odtworzenie

```bash
git worktree add ../wt/S7 -b hub/s7-zakladki-diagnostyka origin/claude/elegant-fermat-xwfca1
cd ../wt/S7 && bun install --frozen-lockfile
git checkout origin/hub/s7-zakladki-diagnostyka-wip -- .    # S7.1 w trakcie (≈14 plików) + _kontynuacja/
git status
```

**Alternatywa w samym PR:** `docs/kontynuacja/s7/` –
`0001-S7.1-diagnostyka-WIP-niedokonczone.patch` (49 plików niezacommitowanej
pracy S7.1: migracje `20261020150000_revenue_facts.sql`,
`20261020150050_revenue_facts_operations.sql`,
`20261020150100_revenue_diagnostic_snoozes.sql`, 2 pliki pgTAP, `facts`,
`registry`, `surfaces`, `defectMap`, `diagnostics.functions`, `queries`,
16 plików `checks/*`, testy, zakładka Diagnostyka, dialogi napraw,
`RevenueSignalChip`, `AttentionCard`, `i18n-admin-revenue-diagnostics.ts`;
nakłada się czysto na gałąź PR przez `git apply`; usuń z niej przypadkowy
`tsconfig.s7.tmp.json`), `STAN_S7.md`, `S7.md`. Po zintegrowaniu S7 usuń
`docs/kontynuacja/s7/` z PR.

Przeczytaj `_kontynuacja/STAN_S7.md` i `_kontynuacja/S7.md` (pakiet: karta
S7, §5.7, §6.4, §3.5, kontrakty `queryOptions` modułów, `TAB_PREPARING`,
zgłoszenia S7). Przejrzyj niezacommitowane pliki S7.1 (mogły zostać
przerwane w połowie) – dokończ, nie zaczynaj od zera.

### 7.2 Wersje migracji S7 (rozstrzygnięte w pakiecie)

**Blok 15:** `20261020150000_revenue_facts.sql`,
`20261020150100_revenue_diagnostic_snoozes.sql` (przy > 45 KiB kolejna wersja
w 2026102015). Warunki zgodności replay (15 przed 16) z dziennikiem drizzle
(bliźniaki `0373`, `0374` po `0372`): funkcje S7 w `plpgsql`; fakty NIE czytają
obiektów bloku 16 (`data_retention_*`, `funnel_paywall_daily`,
`metering_events_daily`, `newsletter_campaign_engagement_archive`,
`crm_leads.anonymized_at`) i nie wołają jego funkcji (np. `_funnel_counts`);
S7 nie dodaje tabel ani kolumn; pgTAP nie zakłada `created_by NOT NULL`
w `revenue_diagnostic_snoozes`. Jeśli S7 MUSI zależeć od bloku 16 – wersje po
najwyższej istniejącej i odchylenie w `hubDelivery.ts` (manifest S7 + wyjątek
bloku) oraz w dzienniku.

### 7.3 S7.1 – diagnostyka (dokończyć)

- Migracja faktów: nagłówek PL, `-- pg-harness: exclude` (fakty klubów czytają
  `club_applications`), 16 funkcji `_revenue_facts_<obszar>(p_tenant uuid)
RETURNS jsonb` (obszary = `HUB_FACT_AREAS` w `hubDelivery.ts`; `plpgsql STABLE
SECURITY DEFINER`, bez GRANT dla ról API) + `admin_revenue_facts()` (bramka
  `is_admin_or_editor()` → 42501, najemca z sesji, `statement_timeout 5s`,
  wynik `{v:1, computedAt, areas:{…}}`, kwoty tylko dla admina, błąd obszaru →
  `null` obszaru, **zero PII**). Wyciszenia: RPC zapisu/odczytu z najemcą
  i użytkownikiem z sesji, pgTAP.
- `src/lib/revenue/diagnostics/{facts,registry,surfaces,defectMap,diagnostics.functions,queries}.ts`
  - `checks/{catalog,paywall,metering,checkout,coupons,retention,dunning,funnel,crm,newsletter,workflows,journeys,events,clubs,sync,dataQuality}.ts`
    – **54 reguły** wg pakietu §5, w tym: `checkout.display_currency_mismatch`
    (P09, Z-S3-03), `paywall.members_rank_no_cta` (regresja P14),
    `funnel.signup_popup_for_members` (regresja P17),
    `checkout.abandon_window_default` (dialog okna porzucenia), alert
    odrzuconych synchronizacji miejsc Zespołu > 20 (Z-I9b-06).
- Zakładka Diagnostyka, dialogi szybkich napraw (`quickFixes.ts`,
  `diagnosticGroups.ts`), `RevenueSignalChip`, `AttentionCard`; testy.
- Pełny zakres: `STAN_S7.md` → „S7.1”.

### 7.4 S7.2 – Kokpit, most MRR, Lejek, Dostęp, Oferta, Dane wejściowe

- Słownik `src/lib/i18n-admin-revenue-tabs.ts` (`const en: typeof pl`) –
  także klucze ZAREZERWOWANE dla S7.3 (`adminRevenue.mrr.*`, `.retention.*`,
  `.metrics.*`, `.communityTab.*`); bez dublowania kluczy S2/S3/S4/S6.
- `overviewTiles.ts` (kafle z `metricId`, admin 6 z kwotami / editor 6 bez
  kwot, `MRR_KPI_TILES`, `RETENTION_KPI_TILES`; `revenue_realized` z migawki –
  ten sam klucz co BI; `drillHref` tylko do tras z `routeTree.gen.ts`),
  `policySentence.ts`, `paywallChecklist.ts` + testy.
- Kokpit (`AttentionCard`, `AreaHealthList` S6), `MrrBridgeCard`, zakładki
  Lejek (`queryOptions` z `src/lib/revenue/funnel/queries.ts`), Dostęp
  (inwentarz + symulator czytelnika = `<Paywall preview>`), Oferta, Dane
  wejściowe (Z-S2-06: `new_customers_plan` to LICZBA – opis pola).
- Pełny zakres: `STAN_S7.md` → „S7.2”.

### 7.5 S7.3 – Przychód, Retencja, Społeczność, Wskaźniki, pulpit, synchronizacja, ⌘K

- Przychód (admin): KPI, seria MRR, `MrrMovementsTable`, `RealizedRevenueCard`
  (per kategoria i waluta, nigdy suma walut), uzgodnienie dokumentów;
  `queryOptions` z `src/lib/revenue/finance/queries.ts` (Z-S2-12).
- Retencja: churn, kohorty (heatmap), windykacja, oferty, przepływ anulowania,
  powody (Z-S2-04: `not_given` poza rankingiem, `stripe:<code>` jako
  „Stripe portal: <code>”); NRR/GRR przed 12 mies. historii = „dane od …”,
  nigdy 0; `null ≠ 0`; Z-S2-05 (`ratio_currency`).
- Społeczność (`?sec=events|clubs`), Wskaźniki (wartości z oceną 5 progów,
  benchmarki z rejestru S6), `MarketingPanel` (przychód zrealizowany),
  `metricSearchIndex.ts` (skróty wskaźników w ⌘K), `syncScenarios.test.ts`
  (SPEC §3.5), `hubLinksContract.test.ts`, liczniki paska huba (Z-S6-08),
  kopie kafli na `KpiTile` (Z-S6-12), czytelnicy surowych zdarzeń kampanii →
  archiwum/rollup tam, gdzie S7 ich dotyka (Z-I9c-05).
- Pełny zakres: `STAN_S7.md` → „S7.3”.

### 7.6 Integracja S7 – specyficzne

- Bliźniaki drizzle `0373…` (pkt 4.3), `types.ts` (nowe RPC), `hubDelivery.ts`.
- `tabPreparing.ts`: usuń wpisy wszystkich zakładek zastąpionych przez S7.
- ⌘K: skróty wskaźników z `metricSearchIndex.ts`.
- Pełne bramki z pgTAP i harnessami; dziennik „Wycinek S7 – …”; push; CI.
- Po zielonym CI: `git push origin --delete hub/s7-zakladki-diagnostyka-wip`.

---

## 8. KROK 3 – I9d: decyzje właściciela RODO (2) (zatwierdzone 2026-10-20)

Migracje w bloku I9 po najwyższej wersji (po S7: sprawdź
`ls supabase/migrations | grep ^2026102016 | tail`), bliźniaki od następnego
wolnego numeru. Kod retencji z I9c-X2: migracje `20261020161000…161400`,
`src/lib/privacy/**`, `src/components/admin/settings/dataRetention/**`,
`src/lib/i18n-admin-data-retention.ts`; RODO po usunięciu konta:
`_hub_account_erase` / `_hub_account_erase_modules` (`20261020160700`,
`160900`). Dwa etapy, każdy z pushem.

### 8.1 Y1 – retencja i anonimizacja (decyzje: „optymalne rozwiązanie wybierz” dla Z-I9c-01 i Z-I9c-07; „tak, usuwaj” dla Z-I9c-08)

1. **Zgłoszenia do klubów (Z-I9c-01):**
   - (a) po usunięciu konta **anonimizacja** zgłoszenia (nie kasowanie): imię,
     nazwisko, e-mail, telefon, firma, stanowisko, miasto, profil społecznościowy
     i WSZYSTKIE pola tekstu własnego (doświadczenie, języki, motywacja, cele,
     wkład, dostępność, źródło polecenia) → wartości puste/neutralne zgodne
     z NOT NULL; `user_id` → pseudonim konta v8 (jak inne kolumny NOT NULL
     w `_hub_account_erase_modules`); zostają klub, specjalizacja, status i daty
     decyzji, warstwa (klucz, ranga) oraz pola zgrubne (branża, staż, kraj,
     lata doświadczenia). Rozszerz istniejący punkt wywołania (bez nowego
     wyzwalacza), domknięcie wstecz, zaktualizuj asercję 29 testu przeglądu
     (kolumna wypada z wyjątków).
   - (b) nowa kategoria retencji „Zgłoszenia do klubów”: odrzucone/wycofane –
     anonimizacja 24 mies. po decyzji (zakres 12-36); przyjęte – 24 mies. od
     końca członkostwa; oczekujące – nigdy automatycznie. Podstawa: RODO art. 6
     ust. 1 lit. b i f, ograniczenie przechowywania.
2. **Odczyty licznika `metered_views` (Z-I9c-07):** kategoria „Odczyty licznika
   artykułów” – **3 mies.** (zakres 2-13): licznik potrzebuje bieżącego
   okresu, a historia czytania w serwisie think-tanku może ujawniać poglądy
   (art. 9 RODO – minimalizacja). Przed usunięciem anonimowy agregat dzienny
   (`metering_events_daily`, rozszerz jeśli trzeba); wskaźniki starszych okien
   bez zmian (pgTAP).
3. **Uczestnicy wydarzeń `event_people` (Z-I9c-07):** kategoria „Uczestnicy
   wydarzeń” – anonimizacja **24 mies. od ostatniego udziału/rejestracji**
   (zakres 12-36): imię i nazwisko → neutralne (NOT NULL), e-mail, telefon,
   stanowisko, firma wpisana, profil społecznościowy, notatki → NULL;
   zostają obecność, typ biletu, status, daty, źródło. Wyjątki: osoba
   powiązana z ISTNIEJĄCYM kontem – historia w profilu do usunięcia konta;
   płatne zamówienie – nie wcześniej niż koniec przechowywania dowodów
   księgowych (`accounting_retention_until`); nie łam mechanizmów zgód
   sponsorów/stoisk.
4. **Wygaszanie nieaktywnych subskrybentów newslettera (Z-I9c-08):** kategoria
   „Nieaktywni subskrybenci” – **12 mies. bez zaangażowania** (zakres 6-24);
   zaangażowanie = kliknięcie, otwarcie ludzkie (bez Apple MPP – próg S5
   `machine_open_seconds`), logowanie powiązanego konta, formularz,
   potwierdzenie zapisu. Przebieg: JEDEN mail z prośbą o potwierdzenie (PL/EN
   wg języka subskrybenta, treść edytowalna w panelu, ton NES, link „Chcę dalej
   otrzymywać” z podpisanym tokenem jednorazowym – wzorzec
   `trackingToken.server.ts` – resetuje licznik) → brak reakcji 30 dni →
   **usunięcie wiersza subskrybenta** (dziennik zgód zostaje wg reguły „czas
   trwania zgody + 6 lat”; NIE dopisuj adresu do listy wyłączeń – to nie
   sprzeciw); mail przez istniejącą kolejkę z etykietą respektującą listę
   wyłączeń. Karta retencji: lista „do wygaszenia” z liczbą, podglądem
   i wykluczeniem adresu z powodem (`audit_log`); karencja 14 dni. Przy
   wyłączonym pomiarze otwarć zaangażowanie liczy się bez otwarć (dymek).
5. Wszystko w karcie „Retencja danych” (`/admin/settings/privacy`)
   i mechanizmie I9c-X2 (ustawienia per kategoria z CHECK zakresów i parytetem
   TS, podgląd, przebiegi, `data_retention_run` z budżetem, `audit_log`,
   zdarzenie `data_retention.changed.v1`). Rejestr czynności: nowe wpisy.
   Dziennik: podsekcja „21.x RODO – decyzje właściciela 2 (I9d-Y1)” z tabelą
   decyzji, testami, wdrożeniem i kontrolnym SQL; Z-I9c-01, -07, -08 –
   „Zamknięte (I9d, §21.x)”.
6. Testy: pgTAP (anonimizacja zgłoszeń po usunięciu konta i po okresie; każda
   nowa kategoria usuwa/anonimizuje tylko starsze niż okres, wyjątki,
   agregaty bez zmian, karencja, idempotencja; wygaszanie: mail raz, token
   resetuje, po 30 dniach usunięcie, wykluczeni zostają, lista wyłączeń
   nietknięta), vitest (parytet stałych, token, render maila PL/EN),
   RTL/axe karty.

### 8.2 Y2 – treść zgody i pomiar (decyzja: „tak, uzupełnij”)

1. **Treść zgody:** znajdź wszystkie miejsca zgody na newsletter/komunikację
   marketingową (`src/components/NewsletterForm.tsx`,
   `src/components/interests/JoinUsForm.tsx`,
   `src/components/admin/blocks/edit/RegisterForm.tsx`,
   `src/components/blocks/AuthFormBlocks.tsx`,
   `src/components/blocks/ContactFormView.tsx`, widżety buildera, popup
   newslettera, formularze wydarzeń i CFP, ustawienia newslettera z edytowalną
   treścią, słowniki i18n). Uzupełnij DOMYŚLNĄ treść PL/EN o: wiadomości mogą
   zawierać elementy mierzące otwarcia i kliknięcia; cel (dopasowanie treści
   i częstotliwości, statystyka); zgodę można wycofać w każdej chwili (link).
   **Jedno źródło tekstu domyślnego**, nie kopie. Tekstów zmienionych przez
   admina NIE nadpisuj (aktualizacja tylko tam, gdzie zapisany = stary
   domyślny); w panelu ostrzeżenie, gdy własny tekst nie wspomina o pomiarze.
   Polityka komunikacji/prywatności, jeśli jest w kodzie – akapit o pomiarze.
2. **Wersja zgody i pomiar tylko za zgodą (wytyczne EDPB 2/2023):** wersja
   treści przy każdej zgodzie (dziennik zgód – sprawdź `crm_consent_log`),
   wersja „z pomiarem”. Render maili ścieżek (`render.server`,
   `tracking.server`) i kampanii: piksel i spersonalizowane linki TYLKO dla
   odbiorców ze zgodą obejmującą pomiar (i przy włączonym przełączniku
   najemcy); pozostali bez piksela, linki bez identyfikatora odbiorcy
   (anonimowe liczenie, jeśli mechanizm pozwala). Statystyki: dymek, że
   otwarcia/kliknięcia obejmują tylko odbiorców ze zgodą na pomiar.
   Z-I9c-09: wspólny przełącznik najemcy dla ścieżek i kampanii.
3. **Ponowne potwierdzenie (opcjonalne, ręcznie z panelu newslettera):**
   „Poproś o zgodę na pomiar” – jednorazowy mail do subskrybentów ze zgodą
   sprzed nowej wersji (podgląd liczby, potwierdzenie, treść PL/EN edytowalna,
   link z podpisanym tokenem aktualizującym wersję; brak reakcji = bez zmian).
4. Rejestr czynności (podstawa pomiaru = zgoda, wersjonowanie) i dziennik
   „21.x Treść zgody i pomiar (I9d-Y2)”; rekomendację EDPB w §21.21 oznacz
   jako wykonaną.
5. Testy: vitest (jedno źródło tekstu, parytet PL/EN, ostrzeżenie panelu,
   render: piksel i tokeny tylko przy zgodzie z pomiarem), pgTAP (wersja
   zgody, odczyt zgody z pomiarem, ACL), RTL/axe.

---

## 9. KROK 4 – I9: integracja i wydanie (karta I9, SPEC §8.3)

### 9.1 Kryteria karty (wszystkie)

- [ ] `jobsTick`: krok `journeys` (`runJourneysTick(admin, { deadlineAt,
ingestLimit: 200, claimLimit: 50 })`) przed drenem poczty z terminem 3 s;
      skanery S2 co 5 min; `journey_rollup_daily` co godzinę, `journey_purge('30
days')` raz na dobę (karta retencji przestaje pokazywać „Harmonogram
      w przygotowaniu”); `SCHEDULER_JOBS`, `.github/workflows/scheduler.yml`,
      `scripts/scheduler-tick.mjs`, panel zdrowia (`SchedulerHealthPanel`) ze
      stanem silnika i `JOURNEYS_ENGINE_DISABLED`; testy (`jobsTickRun.test.ts`,
      `scheduler.test.ts`, `-jobs-tick.test.ts`) zielone. (Z-S5-03)
- [ ] Nawigacja i ⌘K kompletne (zakładki, Dane wejściowe, Nowa ścieżka,
      skróty wskaźników); `adminNav.test.ts`.
- [ ] Chipy huba w 13 modułach (SPEC §2.7 – odnośniki moduły → hub) +
      `LeadJourneysCard` + typ `journey` na osi leada (jeśli nie zrobione w S8);
      istniejące testy modułów zielone.
- [ ] `queryKeyLiterals.gate.test.ts` ścisły (lista pusta), `syncManifest.test.ts`
      ścisły (`metrics`), nowy `src/lib/revenue/__tests__/domainMap.test.ts`
      (każda `RevenueDomain` ma `queryOptions`), `hubDelivery.gate` zielony na
      wszystkich migracjach huba, `generate:authz-snapshot --check`.
- [ ] Pełny pomiar bundla, ratchet z kroniką, `reports/bundle-baseline.json`.
- [ ] Pełne bramki + e2e (jeśli środowisko pozwala; inaczej CI).
- [ ] `docs/RUNBOOK_HUB_PRZYCHOD_LEJEK.md`: przełączniki (silnik ścieżek,
      `JOURNEYS_ENGINE_DISABLED`, retencja i karencja, pomiar otwarć, wygaszanie),
      sygnały i alerty, zapytania diagnostyczne, procedury wycofania, kolejność
      wdrożenia migracji `0347…` z kontrolnym SQL.

### 9.2 Zgłoszenia do domknięcia w I9 (albo świadomie zostawić z uzasadnieniem)

| ID                | Działanie                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Z-S2-07           | `billingDocuments.server.ts`: środowisko dokumentów (koniec `unknown_environment_documents`), emisja `subscription.renewed.v1`.                                                            |
| Z-S5-01           | Emiter `contact_message.submitted.v1` z formularza kontaktu → szablon `pricing_enquiry_b2b` dostępny.                                                                                      |
| Z-S5-04           | Wspólny pomocnik wycofania zgody marketingowej dla wypisu ścieżek i CRM.                                                                                                                   |
| Z-S5-05           | Sprawdzić (test integracyjny renderu/kolejki), czy mail ścieżki nie dostaje dwóch stopek wypisu; poprawić.                                                                                 |
| Z-S5-06           | Udokumentować w panelu (dymek), że otwarcia ludzkie i CTOR to górna granica (Apple MPP).                                                                                                   |
| Z-I9b-09          | `/profile/organization`: komunikat limitu Zespołu > 20 z sugestią Enterprise (uwaga na budżet `public`).                                                                                   |
| Z-I9b-14          | Decyzja: alias `is_admin_or_editor` w generatorze snapshotu autoryzacji (zmienia snapshot wielu funkcji) – opisać i zrobić albo zostawić.                                                  |
| Z-I9b-15          | Import CSV leadów: walidacja tagów > 64 znaków w dialogu przed wysłaniem.                                                                                                                  |
| Z-I9c-02          | Czytelne etykiety PL/EN powodów pominięcia w Skrzynce wysyłek (`cancelled:account_deleted`, `skipped:…`, `suppressed:…`).                                                                  |
| Z-I9c-05          | Czytelnicy surowych zdarzeń kampanii (warstwa semantyczna, pulpit newslettera, zdrowie poczty, scoring leadów, `admin_journey_series`) → archiwum/rollup dla okien starszych niż retencja. |
| Z-I9c-06          | Dzienny rollup statusów zapisów ścieżek (podsumowanie starszych okien).                                                                                                                    |
| Z-I9c-10          | Archiwum kampanii – podwójne liczenie zasięgu przy powrocie po progu: udokumentować albo poprawić.                                                                                         |
| Z-S3-04           | e2e S3 – potwierdzić zielone w CI (`login-return`, `checkout.spec.ts:66`).                                                                                                                 |
| Z-I9c-03, Z-S3-02 | Znane skutki – tylko opis w runbooku.                                                                                                                                                      |

### 9.3 Zamknięcie I9

Dziennik „I9 – integracja i wydanie”, aktualizacja §10, §17, KONTYNUACJA;
**raport końcowy** w dzienniku (co dostarczono per wycinek, metryki jakości,
budżety, otwarte sprawy właściciela, kolejność wdrożenia); push; CI zielone.

---

## 10. KROK 5 – zamknięcie PR #530

1. Opis PR #530: pełna lista wycinków z odnośnikami do sekcji dziennika,
   tabela decyzji właściciela, bramki i CI, sekcja „Po stronie właściciela”.
2. Usuń gałęzie robocze z origin: `hub/s8-sciezki-panel-wip`,
   `hub/s7-zakladki-diagnostyka-wip` oraz scalone `hub/*` (tylko jeśli ich
   zawartość jest w PR).
3. Oznacz PR jako gotowy do przeglądu (ready for review) dopiero przy zielonym
   CI i kompletnym dzienniku; poinformuj właściciela krótkim podsumowaniem.

---

## 11. Do decyzji właściciela (nie rozstrzygaj sam)

- **Z-I9c-04:** dowody księgowe – repo trzyma je do 31.12 roku obrotowego
  - 6 lat (`20261012121000`, dłużej niż „5 lat” z polecenia); retencja
    kontaktów klientów i audytu finansowego idzie za regułą repo.
- Z-I9b-14 (alias w snapshocie autoryzacji), jeśli zmiana okaże się szeroka.
- Każda nowa sprawa prawna lub cenowa, której nie rozstrzyga ten plik.

## 12. Po stronie właściciela (nie z kontenera)

- Wdrożenie migracji `0347…` (Lovable, migrator Drizzle) w kolejności,
  z publikacją frontu; kontrolne SQL w §21.17, §21.20, §21.21 i w runbooku.
- Retencja: przez 14 dni podglądu przejrzeć liczby w karcie przed pierwszym
  czyszczeniem; okresy i rejestr czynności do wiadomości IOD.
- Stripe: 3 kroki wizualne w trybie testowym (Z-I9b-13), powody rezygnacji
  w portalu klienta (Z-S2-11).
- Po I9: test na żywo ścieżek `welcome_onboarding` i `abandoned_checkout`,
  potem włączenie silnika u NES (Z-S5-07).
