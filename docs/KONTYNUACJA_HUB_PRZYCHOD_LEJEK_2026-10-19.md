# Kontynuacja huba „Przychód i lejek” - prompt dla następnej sesji (2026-10-19, aktualizacja 2026-10-20 po S5)

Wklej poniższą treść jako pierwszą wiadomość nowej sesji.

---

Kontynuacja huba „Przychód i lejek” (NES) po PR #527 (scalony do `main`
jako `f149a004`), gałąź PR `claude/elegant-fermat-xwfca1` (odtworzona od
`main`) do `main` - nowy PR z S3. Stos: TanStack Start (SSR), React
Query, Supabase/Postgres (RLS, RPC, pgTAP), bun, vitest, Playwright, tsgo,
i18n PL/EN.

**Przeczytaj najpierw:** `docs/WDROZENIE_HUB_PRZYCHOD_LEJEK_2026-10.md` §17
(przekazanie) i sekcje wycinków §11-16, §18 (S3) i §20 (S5); specyfikacja
`docs/SPEC_MODUL_PRZYCHOD_LEJEK_2026-10-18.md` (czytaj sekcjami: §8.3 karty,
§0.3, §2-§7, §8.4, §8.6, §9.3); wiedza `docs/WIEDZA_INSIDER_MARKETINGOWY_2026-10-19.md`
i `docs/benchmarki/` (liczb benchmarków nie wymyślaj).

**Stan:** na `main` są I0, S6, S1 (z #520), krok 0, uspójnienie benchmarków,
S4 i S2 (z #527). Na gałęzi PR jest S3 (dokończony i zintegrowany 2026-10-20,
§18 dziennika: bliźniaki `0347…0351`, następny wolny `0352`; `overall` 4997;
otwarte Z-S3-01…07) i **I9a** (2026-10-20, §19 dziennika): hub „Przychód
i lejek” jest już w nawigacji panelu (monetyzacja + „Ścieżki komunikacji”
w CRM, skróty ⌘K do zakładek), zakładki S7/S8 pokazują stan „w
przygotowaniu” z odnośnikami do modułów, Wskaźniki - słownik S6, a karta kasy
w `/admin/paywall?tab=checkout` ma pole okna porzucenia
(`abandon_after_minutes`). Osobne PR do `main`: #528 (JoinUsForm), #529
(First visit) - oba scalone.

**S5 (2026-10-20, §20 dziennika):** silnik ścieżek - 6 migracji
`2026102014*` (bliźniaki `0352…0357`, **następny wolny `0358`**), 7 plików
pgTAP, `src/lib/journeys/**` (graf, warunki, wyzwalacze, 14 szablonów,
server fn i `queryOptions` dla S8, render, tracking, etykiety `labels.ts`),
runner `journeysRunner.server.ts` (**niepodpięty do `jobs-tick` - I9**),
tracking 1:1 w `nl-open`/`nl-click`/wypisie, słownik `adminJourneys`.
Silnik wyłączony domyślnie; każdy przełącznik ma RPC panelu (lista dla S8 -
§20.4). Otwarte Z-S5-01…08 (§20.5).

**Wymóg właściciela (2026-10-20): „wszystko, co robimy, ma być w panelu
admina”.** Każdy kolejny wycinek kończy się wejściem w panelu dla właściwych
ról: pozycja nawigacji albo zakładka huba, skrót ⌘K, sekcyjne `adminPageHead`,
napisy PL/EN i stan pusty/„w przygotowaniu” z następnym krokiem - nigdy pusty
ekran ani funkcja dostępna tylko z adresu albo z bazy.

**Kolejka (jeden element naraz):**

1. S8 - lista ścieżek, galeria szablonów, edytor kanwy (HubSpot-style),
   wyniki per krok, ustawienia i zdrowie silnika - na gotowym API S5 (§20.4
   „Dla S8”: server fn, `queries.ts`, `validateJourneyGraph`,
   `JOURNEY_TRIGGERS`, `JOURNEY_TEMPLATES`, `journeyLabelKey`); podgląd treści
   w przeglądarce wymaga klienckiego podstawiania zmiennych (Z-S5-08); po
   obsłudze `?new=1` dopisz skrót ⌘K „Nowa ścieżka” w `adminNav.ts` (I9a go
   świadomie pominął); podmieniając zaślepkę zakładki Ścieżek, usuń jej wpis
   z `TAB_PREPARING`.
2. S7 - zakładki huba (w tym lejek i inwentarz dostępu na `queryOptions` S3),
   50 reguł diagnostyki (w tym `checkout.display_currency_mismatch` - P09,
   Z-S3-03), dialogi napraw (w tym okno porzucenia kasy - pole w karcie kasy
   już jest od I9a, dialog może je reużyć), symulator czytelnika
   (`<Paywall preview>`), tooltipy ze słownika S6 (+ scenariusze naprawy
   z pakietu Insidera), odnośniki hub ⇄ moduły. Podmieniając zaślepkę
   zakładki, usuń jej wpis z `TAB_PREPARING` (`src/lib/admin/revenue/tabPreparing.ts`)
   i gałąź `adminRevenue.preparing.what.*`; Wskaźniki - wartości z oceną
   i `?metric=&ctx=` obok słownika; skróty wskaźników ⌘K
   (`metricSearchIndex.ts`) wpina I9.
3. I9 - **runner ścieżek w `jobs-tick`** (po zadaniach uczestnika, przed
   drenem kolejki maili: `runJourneysTick(admin, { deadlineAt, ingestLimit: 200, claimLimit: 50 })`),
   `journey_rollup_daily` co godzinę, `journey_purge` raz na dobę, stan
   silnika w panelu zdrowia schedulera (§20.4); chipy w modułach (SPEC §2.7),
   baner `/admin/monetization` (D-09), jobs-tick/scheduler (skanery S2!),
   authz/ownership (w tym wpis `premium_content` S3 - Z-S3-06), tryb ścisły
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
  I9 `16*`), bliźniak drizzle od `0358` + `_journal.json`; tenant/user z
  sesji; SECURITY DEFINER z `search_path`; AGENTS.md obowiązuje.
- Pliki współdzielone (§8.4) zmienia Integrator wycinka przy scalaniu, z
  wpisem w dzienniku.
- „Wszystko w panelu admina” (2026-10-20): nowa funkcja bez wejścia w panelu
  dla właściwych ról nie jest skończona - wycinek dowozi też jej pozycję
  (nawigacja/zakładka/karta), ⌘K, `adminPageHead` i napisy PL/EN.

**Decyzje czekające na właściciela:** obietnice cennika v6.2 bez pokrycia
(lista w #520), zgłoszenia Z-xx w dzienniku (m.in. Z-S2-01 ręczna weryfikacja
anulowania w trybie testowym Stripe, Z-S3-01 budżet `public` S3 ponad cel
karty, Z-S5-02 limit tagu 40/64, Z-S5-07 M3, Z-14-01..04, D-11 EN
benchmarków),
konektor Confluence.
