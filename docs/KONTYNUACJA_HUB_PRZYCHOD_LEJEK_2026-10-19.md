# Kontynuacja huba „Przychód i lejek” - prompt dla następnej sesji (2026-10-19)

Wklej poniższą treść jako pierwszą wiadomość nowej sesji.

---

Kontynuacja PR #527 (hub „Przychód i lejek”, NES), gałąź
`claude/elegant-fermat-xwfca1` do `main`. Stos: TanStack Start (SSR), React
Query, Supabase/Postgres (RLS, RPC, pgTAP), bun, vitest, Playwright, tsgo,
i18n PL/EN.

**Przeczytaj najpierw:** `docs/WDROZENIE_HUB_PRZYCHOD_LEJEK_2026-10.md` §17
(stan na koniec poprzedniej sesji) i sekcje wycinków §11-16; specyfikacja
`docs/SPEC_MODUL_PRZYCHOD_LEJEK_2026-10-18.md` (czytaj sekcjami: §8.3 karty,
§0.3, §2-§7, §8.4, §8.6, §9.3); wiedza `docs/WIEDZA_INSIDER_MARKETINGOWY_2026-10-19.md`
i `docs/benchmarki/` (liczb benchmarków nie wymyślaj).

**Stan:** na gałęzi PR są I0, S6, S1 (z #520), krok 0, uspójnienie benchmarków,
S4 i S2 - CI zielone. S3 niescalony: 8 commitów w
`docs/kontynuacja/s3-wip/*.patch` + inwentarz `docs/kontynuacja/S3-stan-2026-10-19.md`.
Osobne PR do `main`: #528 (JoinUsForm), #529 (First visit) - zielone, czekają
na scalenie.

**Kolejka (jeden element naraz):**

1. S3: `git worktree add ../wt/S3 -b hub/s3-lejek-paywall claude/elegant-fermat-xwfca1`,
   `git am docs/kontynuacja/s3-wip/*.patch`, dokończ braki z inwentarza
   (zwłaszcza `public` ≤ +1,2 KB - leniwe ładowanie, nie podnoszenie progu;
   P22 `expires_at` w `adhocCheckout.server.ts`; P09), integracja (bliźniaki
   drizzle od `0346`, `types.ts`, manifest S3), usuń `docs/kontynuacja/s3-wip`
   po scaleniu.
2. S5 - silnik ścieżek (backend; D-03: maks. 3 maile / 7 dni, cisza 21:00-08:00
   Europe/Warsaw; D-04; szablony; runner podpina I9).
3. S7 - zakładki huba, 50 reguł diagnostyki, dialogi napraw, tooltipy ze
   słownika S6 (+ scenariusze naprawy z pakietu Insidera), odnośniki hub ⇄ moduły.
4. S8 - lista ścieżek, galeria, edytor kanwy (HubSpot-style), wyniki per krok.
5. I9 - nawigacja, chipy, jobs-tick/scheduler (skanery S2!), authz/ownership,
   tryb ścisły literałów, `billingDocuments.server.ts` (Z-S2-07), ratchet
   końcowy, runbook, opis PR, raport.

**Zasady (decyzje właściciela):**

- Praca szeregowa - jeden agent/zadanie naraz.
- Bez przeglądu adwersaryjnego. Lokalnie: format, `verify:static`, typecheck,
  lint, testy celowane, pgTAP (gdy SQL), kontrakt TS⇄SQL, build + budżety,
  `hub-slice-guard`; pełna suita vitest w CI. Push po zielonych bramkach,
  po pushu sprawdź CI #527 i napraw czerwone.
- Pamięć 16 GB: `bunx tsgo --noEmit --checkers 2`, vitest `--maxWorkers=3`,
  ciężkie kroki po kolei (`flock -o /tmp/hub-build.lock`). pgTAP:
  `sudo apt-get install -y postgresql-16 postgresql-16-pgtap` (po
  `apt-get update`), `PGTAP_DIR=/tmp/pgtap-<ID> PGTAP_PORT=<port> bash scripts/pgtap-local/run.sh all`.
  Znane błędy środowiska: 3 asercje pg_net, `public_definer_views_read_only`
  1/35, `profile_intent_semantic` (vector), migracja `20260825230232`.
- Budżet D-08: `overall`/`css` ratchet o zmierzony przyrost (+1) z kroniką;
  `public`, `publicCss`, `chunk`, `boot` zamrożone.
- Migracje: ≤ 45 KiB, idempotentne, nagłówki PL, bloki wersji (S3 `12*`, S5
  `14*`, S7 `15*`), bliźniak drizzle od `0346` + `_journal.json`; tenant/user z
  sesji; SECURITY DEFINER z `search_path`; AGENTS.md obowiązuje.
- Pliki współdzielone (§8.4) zmienia Integrator wycinka przy scalaniu, z
  wpisem w dzienniku.

**Decyzje czekające na właściciela:** obietnice cennika v6.2 bez pokrycia
(lista w #520), zgłoszenia Z-xx w dzienniku (m.in. Z-S2-01 ręczna weryfikacja
anulowania w trybie testowym Stripe, Z-14-01..04, D-11 EN benchmarków),
konektor Confluence.
