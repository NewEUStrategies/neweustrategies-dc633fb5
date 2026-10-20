# Kontynuacja huba „Przychód i lejek” - prompt dla następnej sesji (2026-10-19, aktualizacja 2026-10-20)

Wklej poniższą treść jako pierwszą wiadomość nowej sesji.

---

Kontynuacja huba „Przychód i lejek” (NES) po PR #527 (scalony do `main`
jako `f149a004`), gałąź PR `claude/elegant-fermat-xwfca1` (odtworzona od
`main`) do `main` - nowy PR z S3. Stos: TanStack Start (SSR), React
Query, Supabase/Postgres (RLS, RPC, pgTAP), bun, vitest, Playwright, tsgo,
i18n PL/EN.

**Przeczytaj najpierw:** `docs/WDROZENIE_HUB_PRZYCHOD_LEJEK_2026-10.md` §17
(przekazanie) i sekcje wycinków §11-16 oraz §18 (S3); specyfikacja
`docs/SPEC_MODUL_PRZYCHOD_LEJEK_2026-10-18.md` (czytaj sekcjami: §8.3 karty,
§0.3, §2-§7, §8.4, §8.6, §9.3); wiedza `docs/WIEDZA_INSIDER_MARKETINGOWY_2026-10-19.md`
i `docs/benchmarki/` (liczb benchmarków nie wymyślaj).

**Stan:** na `main` są I0, S6, S1 (z #520), krok 0, uspójnienie benchmarków,
S4 i S2 (z #527). Na gałęzi PR jest S3 (dokończony i zintegrowany 2026-10-20,
§18 dziennika: bliźniaki `0347…0351`, następny wolny `0352`; `overall` 4997;
otwarte Z-S3-01…07). Osobne PR do `main`: #528 (JoinUsForm), #529 (First
visit).

**Kolejka (jeden element naraz):**

1. S5 - silnik ścieżek (backend; D-03: maks. 3 maile / 7 dni, cisza 21:00-08:00
   Europe/Warsaw; D-04; szablony - w tym „porzucony koszyk”
   (`checkout.abandoned.v1`), „powitanie konta” (`account.registered.v1`)
   i „wyczerpany limit” (`metering.quota_exhausted.v1`) z S3; runner podpina I9).
2. S7 - zakładki huba (w tym lejek i inwentarz dostępu na `queryOptions` S3),
   50 reguł diagnostyki (w tym `checkout.display_currency_mismatch` - P09,
   Z-S3-03), dialogi napraw (w tym okno porzucenia kasy), symulator czytelnika
   (`<Paywall preview>`), tooltipy ze słownika S6 (+ scenariusze naprawy
   z pakietu Insidera), odnośniki hub ⇄ moduły.
3. S8 - lista ścieżek, galeria, edytor kanwy (HubSpot-style), wyniki per krok.
4. I9 - nawigacja, chipy, jobs-tick/scheduler (skanery S2!), authz/ownership
   (w tym wpis `premium_content` S3 - Z-S3-06), tryb ścisły literałów,
   `billingDocuments.server.ts` (Z-S2-07), ratchet końcowy, runbook, opis PR,
   raport.

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
- Migracje: ≤ 45 KiB, idempotentne, nagłówki PL, bloki wersji (S3 `12*`, S5
  `14*`, S7 `15*`), bliźniak drizzle od `0352` + `_journal.json`; tenant/user z
  sesji; SECURITY DEFINER z `search_path`; AGENTS.md obowiązuje.
- Pliki współdzielone (§8.4) zmienia Integrator wycinka przy scalaniu, z
  wpisem w dzienniku.

**Decyzje czekające na właściciela:** obietnice cennika v6.2 bez pokrycia
(lista w #520), zgłoszenia Z-xx w dzienniku (m.in. Z-S2-01 ręczna weryfikacja
anulowania w trybie testowym Stripe, Z-S3-01 budżet `public` S3 ponad cel
karty, Z-14-01..04, D-11 EN benchmarków),
konektor Confluence.
