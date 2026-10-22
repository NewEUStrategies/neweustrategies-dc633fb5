# Kontynuacja huba „Przychód i lejek” - prompt dla następnej sesji (2026-10-19, aktualizacja 2026-10-22 po S8, S7 i I9d-Y1)

Wklej poniższą treść jako pierwszą wiadomość nowej sesji.

---

Kontynuacja huba „Przychód i lejek” (NES) po PR #527 (scalony do `main`
jako `f149a004`), gałąź PR `claude/elegant-fermat-xwfca1` (odtworzona od
`main`) do `main` - nowy PR z S3. Stos: TanStack Start (SSR), React
Query, Supabase/Postgres (RLS, RPC, pgTAP), bun, vitest, Playwright, tsgo,
i18n PL/EN.

**Przeczytaj najpierw:** `docs/WDROZENIE_HUB_PRZYCHOD_LEJEK_2026-10.md` §17
(przekazanie) i sekcje wycinków §11-16, §18 (S3), §20 (S5), §21 (I9b - decyzje właściciela, I9c - §21.20-21.21, I9d-Y1 - §21.22), §22 (S8) i §23 (S7, scalenie po S8 - §23.11); specyfikacja
`docs/SPEC_MODUL_PRZYCHOD_LEJEK_2026-10-18.md` (czytaj sekcjami: §8.3 karty,
§0.3, §2-§7, §8.4, §8.6, §9.3); wiedza `docs/WIEDZA_INSIDER_MARKETINGOWY_2026-10-19.md`
i `docs/benchmarki/` (liczb benchmarków nie wymyślaj).

**Stan:** na `main` są I0, S6, S1 (z #520), krok 0, uspójnienie benchmarków,
S4 i S2 (z #527). Na gałęzi PR jest S3 (dokończony i zintegrowany 2026-10-20,
§18 dziennika: bliźniaki `0347…0351`, następny wolny `0352`; `overall` 4997;
otwarte Z-S3-02…05; Z-S3-01, 06, 07 zamknięte w I9b) i **I9a** (2026-10-20, §19 dziennika): hub „Przychód
i lejek” jest już w nawigacji panelu (monetyzacja + „Ścieżki komunikacji”
w CRM, skróty ⌘K do zakładek), zakładki S7/S8 pokazywały do swoich wycinków
stan „w przygotowaniu” z odnośnikami do modułów, Wskaźniki - słownik S6, a karta kasy
w `/admin/paywall?tab=checkout` ma pole okna porzucenia
(`abandon_after_minutes`). Osobne PR do `main`: #528 (JoinUsForm), #529
(First visit) - oba scalone.

**S5 (2026-10-20, §20 dziennika):** silnik ścieżek - 6 migracji
`2026102014*` (bliźniaki `0352…0357`), 7 plików
pgTAP, `src/lib/journeys/**` (graf, warunki, wyzwalacze, 14 szablonów,
server fn i `queryOptions` dla S8, render, tracking, etykiety `labels.ts`),
runner `journeysRunner.server.ts` (**niepodpięty do `jobs-tick` - I9**),
tracking 1:1 w `nl-open`/`nl-click`/wypisie, słownik `adminJourneys`.
Silnik wyłączony domyślnie; każdy przełącznik ma RPC panelu (lista dla S8 -
§20.4). Otwarte Z-S5-01, Z-S5-03…08 (§20.5; Z-S5-02 zamknięte w I9b).

**I9b (2026-10-20, §21 dziennika):** decyzje właściciela wykonane (zgoda
delegowana „wykonaj wszystkie i aktualizuj - masz zgodę”) - 9 migracji
`20261020160000…160800` (bliźniaki `0358…0366`, **następny wolny `0367`**):
segmenty z typu klienta (Z-01), cennik v6.2 (Zespół z trackerem, pula 3
w seedzie, maks. 20 miejsc; NGO ranga 40 z zakresem Partnera), RODO księgi
MRR i całego huba po usunięciu konta (Z-07, A2, rejestr czynności
`docs/RODO_REJESTR_CZYNNOSCI_HUB_2026-10.md`), jeden limit tagu CRM 64
(Z-S5-02), linia okna kasy przy biletach (Z-S3-07), wpis `engagement_rate`
(Z-14-03), akceptacje Z-S3-01, Z-S3-06, Z-S2-02, Z-14-01/02/04, D-11/Z-S6-14;
Z-S2-01 zautomatyzowane na granicy SDK. Tabela decyzji - §21.16, wdrożenie -
§21.17, otwarte Z-I9b-06, 09, 10, 11, 14, 15 (§21.7). **Na gałęzi PR są
części A, A2 i B z krokiem C (bliźniaki do `0366`); ratchet `overall`
5003 → 5005 wykonał orkiestrator (Z-I9b-16, §21.19).**

**I9c (2026-10-20, §21.20-21.21 dziennika):** X1 - domknięcia RODO po
usunięciu konta (autorzy w modułach spoza huba Z-I9b-11, poczta w kolejce
Z-I9b-17; migracja `20261020160900`, bliźniak `0367`). X2 - retencja danych
(Z-I9b-10, polecenie „tak, zaproponuj zgodnie z polskim i europejskim prawem
oraz rynkowymi standardami”): 5 migracji `20261020161000…161400` (bliźniaki
`0368…0372`, **następny wolny `0373`, wersja `20261020161500`**), 9
kategorii z okresami i zakresami (jedno źródło
`src/lib/privacy/dataRetention.ts`, CHECK bazy i test parytetu), zadanie
dzienne `data_retention_run` w `jobs-tick` (okno 02:07-02:57 UTC)
z 14-dniowym podglądem, anonimowe agregaty dzienne lejka i licznika (odczyt
starszych okien z agregatu - `_funnel_counts`, `monetization_dashboard`),
archiwum kampanii, pieczęć rollupu ścieżek, karta „Retencja danych”
w `/admin/settings/privacy` (leniwy chunk, `adminPageHead` sekcyjne),
przełącznik pomiaru otwarć ścieżek (`journey_settings.open_tracking_enabled`,
klucz w ustawieniach silnika S5 - UI ustawień w S8). Otwarte: Z-I9c-05, 06,
09, 10 (wycinki), decyzja administratora danych Z-I9c-04 i rekomendacja
treści zgody (pomiar otwarć, EDPB 2/2023 - etap I9d-Y2) - §21.21; Z-I9c-01,
07 i 08 zamknięte w I9d-Y1 (§21.22).

**S8 (2026-10-22, §22 dziennika) - zintegrowany:** zakładka Ścieżki (lista
z `?status=&q=`, galeria szablonów `?new=1&template=`, kreator, ustawienia
silnika z pomiarem otwarć `open_tracking_enabled`, nadawcą i Reply-To,
pasek zdrowia), edytor kanwy `/admin/revenue/journeys/$journeyId` (kanwa
i lista `role="tree"`, panel kroku 14 typów, edytor maila z podglądem
zgodnym z wysyłką - Z-S5-08 w `variables.ts`, publikacja z blokadami,
symulacja, test na sobie, autozapis z CAS i dialogiem różnic), wyniki
(`?view=results`, A/B z `z`, rollup Z-I9c-06), karta „Ścieżki” i typ
`journey` na osi leada w CRM, ⌘K „Nowa ścieżka”, licznik aktywnych ścieżek
na pasku huba, „[TEST] ” w temacie maila testowego. Bez SQL; ratchet D-08
`overall` 5023 → 5182. Otwarte Z-S8-01…10 (§22.5) - m.in. montaż wycieczek
(P2), symulacja per predykat i osobny mail testowy (S5), scalenie plików
współdzielonych z S7 (Z-S8-10).

**S7 (2026-10-22, §23 dziennika) - zintegrowany i scalony z gałęzią PR po
S8 (§23.11):** gałąź `hub/s7-zakladki-diagnostyka-c` (worktree
`/home/user/wt/S7`, baza `75133fe2` + merge `df075ffc`). Dziesięć zakładek huba (Kokpit, Przychód, Lejek, Retencja,
Społeczność, Diagnostyka, Oferta, Dostęp, Wskaźniki, Dane wejściowe),
fakty diagnostyki i wyciszenia w SQL (3 migracje `20261020150000…150100`,
bliźniaki `0373…0375`, **następny wolny `0376`**), 55 reguł z 15 szybkimi
naprawami na mutatorach modułów, `RevenueSignalChip` (montaż w modułach -
I9), licznik Diagnostyki na pasku huba (leniwa sonda), ⌘K 43 wskaźników,
przychód zrealizowany na pulpicie spod klucza migawki BI. Po S8 i S7 żadna
zakładka nie ma stanu „w przygotowaniu” - mechanizm (`tabPreparing.ts`,
`RevenueTabPreparing`, słownik `-preparing`) usunięty w całości przy
scaleniu (Z-S7-17); pasek huba ma oba liczniki (Diagnostyka z leniwej sondy
S7, aktywne ścieżki S8), ⌘K - zakładki, 43 wskaźniki i „Nowa ścieżka”.
Ratchet D-08 `overall` z łącznego pomiaru 5182 → 5316 (S7 +133,4 KB nad S8,
leniwe chunki panelu; `css` 99,8 / 100 bez ratchetu). Otwarte Z-S7-01…16
(§23.5). Materiały przekazania `docs/kontynuacja/` usunięte - praca jest
w historii gałęzi i w dzienniku.

**I9d-Y1 (2026-10-22, §21.22 dziennika) - zintegrowany:** decyzje
właściciela 2 (RODO - retencja i anonimizacja; Z-I9c-01, 07, 08). Gałąź
`hub/i9d-rodo-2` (worktree `/home/user/wt/I9d`, baza `53c5d6d3` + merge
gałęzi PR `70bdccbb`). 8 migracji `20261020161500…162200` (bliźniaki
`0376…0383`, **następny wolny `0384`, wersja `20261020162300`**): zgłoszenia
do klubów anonimizowane po usunięciu konta (`_hub_account_erase_modules`,
pseudonim v8) i po okresie (odrzucone 24 mies. po decyzji, przyjęte 24 mies.
od końca członkostwa - nowe `club_members.ended_at`, oczekujące nigdy),
odczyty licznika 3 mies. z agregatem `metered_views_daily` (okna starsze
z agregatu - dymek w Lejku, Kokpicie i pulpicie monetyzacji), uczestnicy
wydarzeń 24 mies. (`[redacted]`, zgody sponsorów nietknięte), wygaszanie
nieaktywnych subskrybentów (12 mies., jedna prośba PL/EN z linkiem „Chcę
dalej otrzymywać” - krok `jobs-tick` w minucie 9 okna 08-17, trasa
`/newsletter/keep`, edytor treści w `/admin/newsletter/email-content`;
30 dni, usunięcie, rejestr zgód zostaje). Karta „Retencja danych” - 13
kategorii, lista „do wygaszenia” z wykluczeniem i powodem. Bramka CIALO-Z
z mapą wersji per plik (Y2 dopisze wpis `journey_record_message_event`).
Ratchet D-08 `overall` 5316 → 5334. Otwarte Z-I9d-01…10 (§21.22 pkt 10).

**Wymóg właściciela (2026-10-20): „wszystko, co robimy, ma być w panelu
admina”.** Każdy kolejny wycinek kończy się wejściem w panelu dla właściwych
ról: pozycja nawigacji albo zakładka huba, skrót ⌘K, sekcyjne `adminPageHead`,
napisy PL/EN i stan pusty z następnym krokiem - nigdy pusty
ekran ani funkcja dostępna tylko z adresu albo z bazy.

**Kolejka (jeden element naraz):**

1. ~~S8~~ - **zintegrowany 2026-10-22 (§22 dziennika)**, w PR.
2. ~~S7~~ - **zintegrowany i scalony z gałęzią PR po S8 2026-10-22 (§23,
   §23.11 dziennika)**, w PR (fast-forward gałęzi PR do scalenia).
3. ~~I9d-Y1~~ - **zintegrowany 2026-10-22 (§21.22 dziennika)**: scalona
   gałąź PR po S7, `plpgsql_check_gate` i pgTAP faktów S7 (Z-S7-16)
   powtórzone po scaleniu - zielone. Dalej **I9d-Y2** (treść zgody
   i pomiar, pakiet I9d-5) w tym samym worktree - redefinicje funkcji zapisu
   zdarzeń wg §21.22 pkt 11.
4. I9 - **runner ścieżek w `jobs-tick`** (po zadaniach uczestnika, przed
   drenem kolejki maili: `runJourneysTick(admin, { deadlineAt, ingestLimit: 200, claimLimit: 50 })`),
   `journey_rollup_daily` co godzinę, `journey_purge` raz na dobę, stan
   silnika w panelu zdrowia schedulera (§20.4); chipy `RevenueSignalChip`
   w modułach (SPEC §2.7, gotowe miejsca wpięcia - Z-S7-01), P24 w manifeście
   i ekranie CRM (Z-S7-02), `HUB_SYNC_MANIFEST.metrics` (Z-S7-03),
   `onOpenMetric` w słowniku S6 (Z-S7-04), baner realtime S-F (Z-S7-05),
   `ratioCurrency` migawki (Z-S7-06), `admin_dashboard_marketing` na rollupie
   (Z-S7-07), `RetentionFeedbackList` (Z-S7-08),
   baner `/admin/monetization` (D-09), jobs-tick/scheduler (skanery S2!),
   authz/ownership (wpis `premium_content` S3 potwierdzony w I9b - Z-S3-06), tryb ścisły
   literałów, `billingDocuments.server.ts` (Z-S2-07), ratchet końcowy,
   runbook (`JOURNEYS_ENGINE_DISABLED`), opis PR, raport; **M3** - włączenie
   silnika u NES po teście na żywo `welcome_onboarding`
   i `abandoned_checkout` (§20.9 pkt 7, decyzja właściciela). Nawigacja
   i skróty zakładek są już z I9a (§19 dziennika).

**Zasady (decyzje właściciela):**

- Praca szeregowa - jeden agent/zadanie naraz.
- Bez przeglądu adwersaryjnego. Lokalnie: format, `verify:static`, typecheck,
  lint, testy celowane, pgTAP (gdy SQL), kontrakt TS⇄SQL, build + budżety,
  `hub-slice-guard`; pełna suita vitest w CI. Push po zielonych bramkach,
  po pushu sprawdź CI #527 i napraw czerwone.
- Pamięć 16 GB: `bunx tsgo --noEmit --checkers 2` (przy OOM:
  `GOMEMLIMIT=11GiB GOGC=50 bunx tsgo --noEmit --checkers 1`), vitest `--maxWorkers=3`,
  ciężkie kroki po kolei (`flock -o /tmp/hub-build.lock`). pgTAP:
  `sudo apt-get install -y postgresql-16 postgresql-16-pgtap` (po
  `apt-get update`), `PGTAP_DIR=/tmp/pgtap-<ID> PGTAP_PORT=<port> bash scripts/pgtap-local/run.sh all`.
  Znane błędy środowiska: 3 asercje pg_net, `public_definer_views_read_only`
  1/35, `profile_intent_semantic` (vector), migracja `20260825230232`.
- Budżet D-08: `overall`/`css` ratchet o zmierzony przyrost (+1) z kroniką;
  `public`, `publicCss`, `chunk`, `boot` zamrożone.
- Migracje: ≤ 45 KiB, idempotentne, nagłówki PL, bloki wersji (S7 `15*`,
  I9 `16*` - zajęte do `162200`), bliźniak drizzle od `0384` + `_journal.json`; tenant/user z
  sesji; SECURITY DEFINER z `search_path`; AGENTS.md obowiązuje.
- Pliki współdzielone (§8.4) zmienia Integrator wycinka przy scalaniu, z
  wpisem w dzienniku.
- „Wszystko w panelu admina” (2026-10-20): nowa funkcja bez wejścia w panelu
  dla właściwych ról nie jest skończona - wycinek dowozi też jej pozycję
  (nawigacja/zakładka/karta), ⌘K, `adminPageHead` i napisy PL/EN.

**Decyzje czekające na właściciela** (wyłącznie rzeczy niewykonalne
z kontenera - §21.18 dziennika): wdrożenie migracji `0358…0383` i publikacja
frontu (§21.17, §21.20, §21.21, §21.22 - retencja: 14 dni podglądu, także
osobne dla nowych kategorii I9d, przegląd liczb i listy „do wygaszenia”
w karcie przed terminem karencji); Z-I9d-01 - okres dla subskrybentów
niepotwierdzonych i wypisanych; Z-S2-01 - trzy kroki wizualne w trybie testowym Stripe
(kupon w panelu, `Idempotency-Key` w logach, portal z powodami - Z-I9b-13);
Z-S2-11 - powody rezygnacji w konfiguracji portalu klienta Stripe; Z-S5-07
(M3) - włączenie silnika ścieżek po teście na żywo, po I9; konektor
Confluence.
