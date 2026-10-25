// Bramka pasów migracji: każdy wpis `drizzle/migrations/meta/_journal.json` jest
// lustrem pliku `supabase/migrations/` (ten sam SQL wykonywalny), kanonicznym
// wyzwalaczem wdrożenia albo ma w rejestrze DECYZJĘ z powodem.
//
// PRZYCZYNA ŹRÓDŁOWA. Repozytorium ma dwa katalogi migracji i jedno źródło
// prawdy (docs/RUNBOOK_MIGRACJE_LOVABLE.md): `supabase/migrations` zasila CI,
// pgTAP i każdą bramkę `check:sql-*` (`MIGRATIONS_DIR`,
// scripts/lib/sqlMigrations.ts), a `drizzle/` jest generowanym lustrem - jedynym
// kanałem na produkcję (migrator Drizzle uruchamiany narzędziem Lovable).
// „Drizzle i Supabase mają odrębne rejestry" (docs/MAIN_RECOVERY_2026-09-12.md).
// Wpis dziennika bez źródła w supabase/ (np. napisany przez bota Lovable)
// wykonuje się na produkcji, a dla bramek jest NIEWIDZIALNY.
//
// Tak przeszło `0001_profiles_discoverable_default_true`: przestawiło
// `profiles.discoverable` na DEFAULT true i przepisało wszystkie wiersze, podczas
// gdy pas supabase trzymał NOT NULL DEFAULT false, a późniejsza migracja opierała
// na tym argument prawny listy uczestników. Żadna bramka nie miała jak tego zobaczyć.
//
// REJESTR DO WPISU 398, TREŚĆ OD 399. Do 2026-10-25 wpisy dziennika powstawały
// ręcznie albo narzędziem bota Lovable, a część historii to operacje jednorazowe
// na produkcji (księgowe 0023/0149/0307, naprawy dryfu 0392/0393), które kopii mieć
// nie powinny - reguła „każdy wpis jest kopią" zostałaby wyłączona pierwszego dnia.
// Dla tej historii rejestr MIGRATION_LANES trzyma świadomą decyzję: bliźniaka
// albo powód. Od wpisu JOURNAL_FREEZE_IDX + 1 wpisy generuje
// `bun run migrations:mirror` (nagłówek z src/lib/migrations/mirrorHeader.ts),
// więc rejestr jest ZAMROŻONY, a każdy nowy wpis bramka ocenia wyłącznie PO
// TREŚCI, w tej kolejności:
//   1. lustro generatora: jego źródło istnieje i ma ten sam SQL wykonywalny
//      (forward-only - zmiana źródła wysłanej migracji to NOWA migracja);
//   2. kopia pliku supabase/ (zapis wdrożenia, np. adopcja wpisu bota);
//   3. kanoniczny wyzwalacz wdrożenia (DEPLOY_TRIGGER_TAG + DEPLOY_TRIGGER_SQL):
//      no-op, którym narzędzie Lovable uruchamia migrator - przechodzi po cichu;
//   4. inny wpis z samych `COMMENT ON` (znacznik wdrożenia, jak 0398): przechodzi
//      z ostrzeżeniem, bo komentarz na produkcji różni się wtedy od pasa
//      kanonicznego (schemat i uprawnienia bez zmian);
//   5. wpis bez SQL-a wykonywalnego (same komentarze, np. szablon
//      `drizzle-kit generate --custom`): migrator wykona pusty plik, więc to
//      no-op - przechodzi z ostrzeżeniem (adoptować nie ma czego: pusty plik
//      supabase odrzuca generator jako `pusty-sql`);
//   6. cokolwiek innego to `wpis-spoza-zrodla`: SQL adoptuje się do
//      supabase/migrations (runbook §5), rejestru nie rozszerzamy.
// Wpis rejestru dla tagu po zamrożeniu to `rejestr-zamrozony`; przy wyzwalaczu,
// znaczniku i pustym wpisie, które bot Lovable zwykł rejestrować, tylko zbędny
// wpis do usunięcia.
//
// CO ZNACZY „TEN SAM SQL". Pliki obu pasów NIE muszą być bajt w bajt - ZMIERZONE
// na historycznych parach: pas supabase niesie długi nagłówek po polsku, pas
// drizzle zaczynał się od pierwszej instrukcji, a polskie znaki diakrytyczne
// w literałach `COMMENT ON` są w pasie drizzle złożone do ASCII („ktorego" wobec
// „którego"); lustro generatora dokłada własny nagłówek. Porównujemy więc SQL
// WYKONYWALNY: bez komentarzy, ze złożonymi diakrytykami, ze znormalizowaną
// spacją i z treścią literałów `COMMENT ON ... IS '...'` zastąpioną znacznikiem.
//
// CZEGO TA BRAMKA ŚWIADOMIE NIE ŁAPIE, powiedziane wprost: rozjazdu PROZY
// w literałach `COMMENT ON` (dziś realnie różni się tak para 0010). To
// dokumentacja zapisana w bazie - nie zmienia ani schematu, ani zachowania,
// a traktowanie jej na równi z DDL-em zapaliłoby bramkę na każdej poprawce
// literówki i skończyło się jej wyłączeniem.
//
// KIERUNEK ODWROTNY (supabase -> dziennik drizzle) pilnuje osobny moduł:
// `src/lib/ci/supabaseLaneCoverage.ts` (rejestr SUPABASE_LANE_GAPS).
import { readFileSync, readdirSync } from "node:fs";

import { mirrorSourceOf } from "../migrations/mirrorHeader";

export const DRIZZLE_DIR = "drizzle/migrations";
export const SUPABASE_DIR = "supabase/migrations";

/**
 * Ostatni wpis dziennika sprzed generatora (`bun run migrations:mirror`, 2026-10-25).
 * Od wpisu JOURNAL_FREEZE_IDX + 1 źródłem prawdy jest supabase/migrations: wpis jest
 * lustrem albo kopią pliku supabase, kanonicznym wyzwalaczem wdrożenia albo znacznikiem
 * z samych COMMENT ON (`analyzeMigrationLanes`), a rejestr MIGRATION_LANES nie przyjmuje
 * wpisów o wyższym idx. Jedyna furtka dla wpisu, którego SQL-a nie da się przenieść do
 * pasa supabase (jak 0393: 42710 na bazie z tego pasa): podniesienie tej stałej razem
 * z decyzją `drizzleOnly` w przeglądanym PR - test przypina wartość, więc zmiana jest
 * widoczna.
 */
export const JOURNAL_FREEZE_IDX = 398;

/**
 * Pierwszy wpis dziennika z generatora lustra (2026-10-25). W przeciwieństwie do
 * JOURNAL_FREEZE_IDX ta granica NIGDY się nie przesuwa: od niej plik niesiony
 * przez wpis dziennika (lustro albo kopia - adopcja wpisu bota) ma dowód
 * wdrożenia w rejestrze migratora Drizzle, nie w `schema_migrations`, więc
 * `check:migration-ledger` go nie egzekwuje - także po podniesieniu zamrożenia
 * (runbook §5.4 pkt 2).
 */
export const MIRROR_LANE_START_IDX = 399;

/** Tag wyzwalacza wdrożenia (docs/RUNBOOK_MIGRACJE_LOVABLE.md §4.2; wiedza projektu Lovable). */
export const DEPLOY_TRIGGER_TAG = /^\d{4,}_(?:pr\d+|lovable_\d{8})_deployment_completion$/;

/** Jedyna dozwolona treść wyzwalacza: przywraca domyślny komentarz schematu public (no-op). */
export const DEPLOY_TRIGGER_SQL = "COMMENT ON SCHEMA public IS 'standard public schema';";

/**
 * Biały znak jak w lekserze PostgreSQL (`space` w scan.l). `\s` z JS łapie też BOM
 * i twardą spację, a baza czyta je jak znaki identyfikatora - plik z nimi padłby
 * na produkcji błędem składni, więc za wyzwalacz uchodzić nie może.
 */
const PG_SPACE = String.raw`[ \t\n\r\f\v]`;
/** Spacja i komentarze `--`; lookahead wymusza komentarz do końca linii, więc dopasowanie jest liniowe. */
const PG_GAP = String.raw`(?:${PG_SPACE}|--[^\n\r]*(?![^\n\r]))*`;

/**
 * CAŁY plik wyzwalacza: DEPLOY_TRIGGER_SQL (słowa kluczowe rozdzielone dowolną spacją,
 * literał co do znaku), a wokół wyłącznie spacja i komentarze `--`. Wzorzec opisuje
 * plik od początku do końca, więc obok nie schowa się nic wykonywalnego. Wycięcie `--`
 * przed porównaniem byłoby dziurą: zjadłoby też `--` z wnętrza literału i przepuściło
 * instrukcję przemyconą między dwoma literałami.
 */
const DEPLOY_TRIGGER_FILE = new RegExp(
  String.raw`^${PG_GAP}COMMENT${PG_SPACE}+ON${PG_SPACE}+SCHEMA${PG_SPACE}+public${PG_SPACE}+IS${PG_SPACE}+'standard public schema'${PG_SPACE}*;${PG_GAP}$`,
);

/** Kanoniczny wyzwalacz wdrożenia: nazwa wg DEPLOY_TRIGGER_TAG i treść DEPLOY_TRIGGER_SQL. */
export function isDeployTrigger(tag: string, content: string | null): boolean {
  return content !== null && DEPLOY_TRIGGER_TAG.test(tag) && DEPLOY_TRIGGER_FILE.test(content);
}

/**
 * Wpis z samych `COMMENT ON` (znacznik wdrożenia panelu, jak 0329/0346/0391/0398): nie
 * zmienia schematu ani uprawnień. Zachowawczo na wyjściu `executableSql`: proza komentarza
 * jest tam zamaskowana, więc `;` w niej nie dzieli, a `;` w każdym innym literale dzieli -
 * i wtedy kawałek bez `COMMENT ON` daje `false`.
 */
export function isCommentOnlySql(sql: string): boolean {
  const parts = executableSql(sql)
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p !== "");
  return parts.length > 0 && parts.every((p) => /^COMMENT ON\b/i.test(p));
}

/** Wpis rejestru: pas drizzle ma bliźniaka albo ma powód, dla którego go nie ma. */
export type LaneEntry =
  | {
      readonly tag: string;
      /** Nazwa pliku w `supabase/migrations/` o tym samym SQL-u wykonywalnym. */
      readonly twin: string;
    }
  | {
      readonly tag: string;
      /** Powód, dla którego ten plik świadomie nie ma bliźniaka. */
      readonly drizzleOnly: string;
    };

/**
 * Rejestr pasów - historia dziennika do JOURNAL_FREEZE_IDX. Kolejność jak
 * w `drizzle/migrations/meta/_journal.json`.
 *
 * Rejestr ZAMROŻONY na JOURNAL_FREEZE_IDX: wpis dla tagu o wyższym idx czerwieni
 * bramkę (`rejestr-zamrozony`), bo nowe wpisy dziennika ocenia się po treści.
 * Dla historii `drizzleOnly` nie był wytrychem: to zdanie, które ktoś napisał
 * i podpisał w przeglądzie, a nie domyślne zachowanie.
 */
export const MIGRATION_LANES: readonly LaneEntry[] = [
  // I9d-Y2b: osobna zgoda na pomiar (wariant (b)) i pomiar tylko po
  // potwierdzeniu skrzynki (D2) - trzy części z limitu rozmiaru migracji
  // i poprawki przeglądu R1 (0397: sekret skrzynki na stronie DOI, kolumny
  // personelu, domknięcie łańcuchów pomiaru); każda para to pełne bliźniaki
  // bajt w bajt.
  {
    tag: "0397_consent_measurement_separate_fixes",
    twin: "20261023090300_consent_measurement_separate_fixes.sql",
  },
  {
    tag: "0396_consent_measurement_separate_requests",
    twin: "20261023090200_consent_measurement_separate_requests.sql",
  },
  {
    tag: "0395_consent_measurement_separate_doi_signup",
    twin: "20261023090100_consent_measurement_separate_doi_signup.sql",
  },
  {
    tag: "0394_consent_measurement_separate_core",
    twin: "20261023090000_consent_measurement_separate_core.sql",
  },
  {
    tag: "0393_membership_coupon_source_fk",
    drizzleOnly:
      "Naprawa dryfu produkcji z panelu Lovable (2026-10-23), druga część 0392: klucz obcy membership_grants_source_coupon_id_fkey -> b2b_coupons(id) ON DELETE SET NULL. Pas supabase ma go od 20260725090300_apply_coupon_effects_after_payment.sql (REFERENCES w ADD COLUMN daje ograniczenie o tej samej domyślnej nazwie), a ten plik dodaje go bez IF NOT EXISTS - bliźniak w pasie supabase wywróciłby każdą bazę stawianą z tego pasa (42710, ograniczenie już istnieje). Na produkcji kolumny, a więc i klucza, nie było. Stan końcowy klucza jest identyczny z pasem supabase (pg_get_constraintdef zmierzone 2026-10-24) - nie przenosić.",
  },
  {
    tag: "0392_membership_coupon_source",
    drizzleOnly:
      "Naprawa dryfu produkcji z panelu Lovable (2026-10-23): 20260725090300_apply_coupon_effects_after_payment.sql weszła na produkcję częściowo (effects_applied_at jest, kolumny membership_grants.source_coupon_id nie było - dawny wpis KNOWN_COLUMN_DRIFT w dbContract.ts), więc apply_b2b_coupon_effects kończył się 42703. Plik ponawia ADD COLUMN IF NOT EXISTS (bez REFERENCES - klucz dokłada 0393), nadpisuje polski komentarz kolumny angielskim i zakłada NOWY indeks membership_grants_tenant_coupon_idx (tenant_id, source_coupon_id), którego pas supabase nie ma; pas supabase ma za to idx_membership_grants_source_coupon (source_coupon_id), którego ten plik nie tworzy. ADOPTOWANE przez 20261025090010_adopt_membership_coupon_source_indexes.sql: indeks membership_grants_tenant_coupon_idx 1:1 (CREATE INDEX IF NOT EXISTS); ten sam plik zakłada na produkcji brakujące idx_membership_grants_source_coupon i przywraca kanoniczny komentarz kolumny. ADD COLUMN nie jest przenoszone - kolumna jest w pasie od 20260725090300.",
  },
  {
    tag: "0391_pr530_deployment_completion",
    drizzleOnly:
      "Jednorazowe potwierdzenie wdrożenia PR #530 na pasie Drizzle: zmienia wyłącznie komentarz schematu public i uruchamia oczekujące wpisy 0347-0390; nie dodaje nowego schematu ani nie zmienia reguł dostępu.",
  },
  {
    tag: "0346_pr527_deployment_completion",
    drizzleOnly:
      "Jednorazowe potwierdzenie wdrożenia PR #527 na pasie Drizzle: zmienia wyłącznie komentarz tabeli mrr_movements i uruchamia oczekujące wpisy 0330-0345; nie dodaje nowego schematu ani nie zmienia reguł dostępu.",
  },
  {
    tag: "0329_pr520_deployment_completion",
    drizzleOnly:
      "Jednorazowe potwierdzenie wdrożenia PR #520 na pasie Drizzle: zmienia wyłącznie komentarz tabeli domain_event_emit_errors i uruchamia oczekujące wpisy 0313-0328; nie dodaje nowego schematu ani nie zmienia reguł dostępu.",
  },
  {
    tag: "0000_search_people_super_admin_bypass",
    twin: "20260911160000_search_people_super_admin_bypass.sql",
  },
  {
    tag: "0001_profiles_discoverable_default_true",
    drizzleOnly:
      "Regresja prywatności zastosowana wyłącznie na tym pasie - przestawiła profiles.discoverable na DEFAULT true i przepisała wszystkie wiersze. Pas supabase NIE dostaje portu: każdy plik supabase/ dostaje lustro w dzienniku (`bun run migrations:mirror`), więc port wykonałby jego hurtowy UPDATE na produkcji DRUGI RAZ i ponownie przestawił każdego, kto od tamtej pory się wypisał. Stan naprawia forward-only 0011 (DEFAULT false) obecne w OBU pasach; skutki hurtowego UPDATE w danych koryguje forward-only 20261025090030_profiles_discoverable_0001_correction.sql, a decyzję właściciela profilu od tej pory stempluje 20261025090020_profiles_discoverable_decision_stamp.sql. Pliku nie usuwamy - repozytorium jest forward-only, a usunięcie nie cofa tego, co już zastosowane.",
  },
  {
    tag: "0002_pr350_member_crm_sync_and_chat_compat",
    drizzleOnly:
      "Uzgodnienie stanu produkcyjnego po scaleniu #350, wykonane na pasie drizzle. Odpowiadający SQL wszedł do pasa supabase osobnymi migracjami o innej treści, więc porównanie instrukcja po instrukcji nie ma tu sensu.",
  },
  {
    tag: "0003_read_only_schema_contract",
    twin: "20260912170000_read_only_schema_contract.sql",
  },
  {
    tag: "0004_read_only_schema_contract",
    twin: "20260912170000_read_only_schema_contract.sql",
  },
  {
    tag: "0005_pr353_admin_dashboard_aggregates",
    twin: "20260912110000_admin_dashboard_aggregates.sql",
  },
  {
    tag: "0006_impersonation_tenant_scope",
    twin: "20260912180000_impersonation_tenant_scope.sql",
  },
  {
    tag: "0007_job_runner_base_url_shape_guard",
    twin: "20260912181000_job_runner_base_url_shape_guard.sql",
  },
  {
    tag: "0008_payment_webhook_events_tenant_binding",
    twin: "20260913100000_payment_webhook_events_tenant_binding.sql",
  },
  {
    tag: "0009_email_log_tenant_scope",
    twin: "20260913101000_email_log_tenant_scope.sql",
  },
  {
    tag: "0010_email_send_log_tenant_producers",
    twin: "20260913140000_email_send_log_tenant_producers.sql",
  },
  {
    tag: "0011_profiles_discoverable_opt_in_restore",
    twin: "20260913150000_profiles_discoverable_opt_in_restore.sql",
  },
  {
    tag: "0012_email_account_tenant_for_address",
    twin: "20260913160000_email_account_tenant_for_address.sql",
  },
  {
    tag: "0013_pr355_discoverable_optin_and_email_account_tenant",
    drizzleOnly:
      "Uzgodnienie stanu po scaleniu #355: 0011 i 0012 nigdy nie pojechały na to środowisko (przyrostowy `supabase db push` bez --include-all pominął wersje starsze od zdalnej historii), więc oba SQL-e zostały wykonane RAZEM na pasie drizzle. Pas supabase ma je już jako 20260913150000 i 20260913160000 - bliźniak byłby trzecim wykonaniem tej samej treści, a nie nowym kontraktem. Pliku nie usuwamy: repozytorium jest forward-only.",
  },
  {
    tag: "0014_profile_view_privacy_fix",
    twin: "20260913170000_profile_view_privacy_fix.sql",
  },
  {
    tag: "0015_introduction_gates_and_dedup",
    twin: "20260913171000_introduction_gates_and_dedup.sql",
  },
  {
    tag: "0016_mutual_visible_count",
    twin: "20260913172000_mutual_visible_count.sql",
  },
  {
    tag: "0017_set_user_consents_atomic",
    twin: "20260913173000_set_user_consents_atomic.sql",
  },
  {
    tag: "0018_pr365_tenant_follows_profile",
    drizzleOnly:
      "Stan końcowy siedmiu migracji serii 20260914* (090000 push_subscriptions_tenant_binding, 120000 tenant_follows_profile, 140000 author_profiles, 160000 profile_cv, 180000 media_mentions, 200000 profile_graph, 220000 endorse_skill_tenant_guard) wykonany JEDNYM plikiem na pasie drizzle. Bliźniak 1:1 nie istnieje z założenia: pięć z tych plików nadpisuje tę samą funkcję tg_profiles_repin_account_tenant kolejnymi wersjami, więc pas drizzle niesie wyłącznie wersję końcową, a nie łańcuch pośrednich. Pas supabase ma wszystkie siedem wersji w rejestrze; pliku nie usuwamy - repozytorium jest forward-only.",
  },
  {
    tag: "0019_related_post_clicks_viewer_window_idx",
    twin: "20260914230000_related_post_clicks_viewer_window_idx.sql",
  },
  {
    tag: "0020_club_covers_per_club_storage_write",
    twin: "20260914184500_club_covers_per_club_storage_write.sql",
  },
  {
    tag: "0021_brand_media_urls_on_canonical_domain",
    twin: "20260915091000_brand_media_urls_on_canonical_domain.sql",
  },
  // Ten sam SQL, co 0020 - bajt w bajt - wykonany PONOWNIE na pasie drizzle,
  // bo pierwszego przebiegu nie potwierdzał żaden rejestr. Wpis wskazuje więc
  // TEGO SAMEGO bliźniaka, co 0020 (tak samo jak para 0003/0004): treść ma być
  // nadal pilnowana, a nie zwolniona z porównania przez `drizzleOnly`.
  {
    tag: "0022_club_covers_per_club_storage_write_register",
    twin: "20260914184500_club_covers_per_club_storage_write.sql",
  },
  {
    tag: "0023_record_club_covers_migration_in_ledger",
    drizzleOnly:
      "Wpis do REJESTRU WDROŻEŃ pasa supabase (supabase_migrations.schema_migrations), a nie zmiana schematu: SQL z 20260914184500 był już wykonany na bazie, ale bez wiersza w rejestrze, więc check:migration-ledger widział go jako niewdrożony. Bliźniak byłby błędem z definicji - plik leżący w supabase/migrations/ sam dostaje wiersz w tym rejestrze w chwili zastosowania, więc dopisywałby wiersz za SĄSIADA i na świeżej bazie ogłaszał cudzą migrację za wdrożoną, zanim ta się wykona. To dokładnie kłamstwo, które check:migration-ledger ma wykrywać. Pliku nie usuwamy - repozytorium jest forward-only.",
  },
  {
    tag: "0024_profiles_tenant_id_not_client_writable",
    twin: "20260915092000_profiles_tenant_id_not_client_writable.sql",
  },
  {
    tag: "0025_tenant_scope_presence_and_rsvp_owner_read",
    twin: "20260915194500_tenant_scope_presence_and_rsvp_owner_read.sql",
  },
  {
    tag: "0026_selfservice_privilege_pins",
    twin: "20260917163900_selfservice_privilege_pins.sql",
  },
  {
    tag: "0027_coupon_per_user_limit_and_cv_upload_quota",
    twin: "20260919094000_coupon_per_user_limit_and_cv_upload_quota.sql",
  },
  {
    tag: "0028_club_cover_position_y",
    twin: "20260919220300_club_cover_position_y.sql",
  },
  {
    tag: "0029_club_set_cover_position_tenant_scope",
    twin: "20260920120000_club_set_cover_position_tenant_scope.sql",
  },
  // Kontekst nawigacji dla RUM: pięć kolumn `web_vitals` plus cztery CHECK-i.
  // SQL WYKONYWALNY obu plików jest identyczny; różnią się wyłącznie NAGŁÓWEK
  // (pas supabase niesie uzasadnienie migracji, pas drizzle zaczyna od pierwszej
  // instrukcji) i DŁUGOŚĆ PROZY w literałach `COMMENT ON` - a tego ta bramka
  // świadomie nie pilnuje, bo dokumentacja w bazie nie zmienia ani schematu,
  // ani zachowania.
  {
    tag: "0030_web_vitals_navigation_context",
    twin: "20260920121000_web_vitals_navigation_context.sql",
  },
  {
    tag: "0031_user_invitations_pin_all_non_acceptance_columns",
    twin: "20260922080100_user_invitations_pin_all_non_acceptance_columns.sql",
  },
  {
    tag: "0032_mention_targets_people_crm_companies",
    drizzleOnly:
      "Pierwsza wersja funkcji celów @wzmianki (search_mention_targets, get_mention_target), nadpisana w całości przez 0033 na tym samym pasie - firmy dostały tam stabilny slug `org-<uuid>` zamiast identyfikatora z nazwy. Obie deklaracje to CREATE OR REPLACE, więc pas kanoniczny dostaje WYŁĄCZNIE stan końcowy (20260922080000_mention_targets_rpc.sql): odtwarzanie wersji pośredniej niczego nie dowodzi, a zostawiałoby w bazie przez moment funkcję, której żaden klient już nie woła. Pliku nie usuwamy - repozytorium jest forward-only.",
  },
  {
    tag: "0033_stable_organization_mention_slugs",
    twin: "20260922080000_mention_targets_rpc.sql",
  },
  // DWA DUPLIKATY Z SCALENIA PR #385. Gałąź dorzuciła na pas drizzle drugą
  // kopię plików, które już na nim stały pod innym numerem: SQL WYKONYWALNY
  // 0034 jest bajt w bajt tożsamy z 0033, a 0035 różni się od 0031 wyłącznie
  // komentarzami nagłówka i brakiem znaku końca linii. Pas kanoniczny
  // (supabase/migrations) ma po jednym bliźniaku dla każdej z tych zmian i tam
  // wskazują wpisy 0031/0033 wyżej - dopisanie im drugiego bliźniaka kazałoby
  // bramce oczekiwać dwóch wykonań tej samej definicji. Plików nie usuwamy,
  // repozytorium jest forward-only; obie definicje to CREATE OR REPLACE /
  // DROP POLICY + CREATE POLICY, więc powtórne wykonanie jest idempotentne.
  {
    tag: "0034_mention_targets_rpc",
    drizzleOnly:
      "Duplikat 0033_stable_organization_mention_slugs z tego samego scalenia (PR #385) - SQL wykonywalny identyczny bajt w bajt. Bliźniaka supabase/migrations/20260922080000_mention_targets_rpc.sql pilnuje wpis 0033.",
  },
  {
    tag: "0035_user_invitations_pin_all_non_acceptance_columns",
    drizzleOnly:
      "Duplikat 0031_user_invitations_pin_all_non_acceptance_columns z tego samego scalenia (PR #385) - różnica to wyłącznie komentarze nagłówka i brak znaku końca linii. Bliźniaka supabase/migrations/20260922080100_user_invitations_pin_all_non_acceptance_columns.sql pilnuje wpis 0031.",
  },
  {
    tag: "0036_event_sponsor_sections_and_home_ads",
    twin: "20260922200000_event_sponsor_sections_and_home_ads.sql",
  },
  {
    tag: "0037_event_home_ads_viewer_status_fix",
    twin: "20260922200100_event_home_ads_viewer_status_fix.sql",
  },
  {
    tag: "0038_event_ticket_presentation",
    twin: "20260922210000_event_ticket_presentation.sql",
  },
  {
    tag: "0039_event_ticket_codes",
    twin: "20260922220000_event_ticket_codes.sql",
  },
  {
    tag: "0040_event_ticket_tax_and_group",
    twin: "20260922230000_event_ticket_tax_and_group.sql",
  },
  {
    tag: "0041_event_link_url_regex_within_limit",
    twin: "20260923000000_event_link_url_regex_within_limit.sql",
  },
  {
    tag: "0042_member_resources_file_path_regex_within_limit",
    twin: "20260923000100_member_resources_file_path_regex_within_limit.sql",
  },
  {
    tag: "0043_event_sponsor_layout_follows_limit",
    twin: "20260923100100_event_sponsor_layout_follows_limit.sql",
  },
  {
    tag: "0044_event_ticket_group_codes",
    twin: "20260923110000_event_ticket_group_codes.sql",
  },
  {
    tag: "0045_event_agenda_sponsor_affiliation",
    twin: "20260923120000_event_agenda_sponsor_affiliation.sql",
  },
  // Plik zastosowany z panelu Lovable WYŁĄCZNIE na pasie drizzle. Bliźniak
  // supabase dopisany później, z nagłówkiem, ale z tym samym SQL-em
  // wykonywalnym - bez niego świeża baza (pgTAP, harness wydarzeń) gubiła
  // z programu prelegentów bez konta, widocznych na produkcji.
  {
    tag: "0046_event_agenda_people_without_accounts",
    twin: "20260923130000_event_agenda_people_without_accounts.sql",
  },
  // Karta prelegenta rozwijana kliknieciem (pola na nakladce scenicznej)
  // i sciezki prelegenta wyprowadzone z obsady sesji.
  {
    tag: "0050_event_speaker_card_tracks",
    twin: "20260924140000_event_speaker_card_tracks.sql",
  },
  // Podzial profili: /people dla kazdego, /author tylko z nadania roli.
  {
    tag: "0047_member_profile_people_route",
    twin: "20260924100000_member_profile_people_route.sql",
  },
  {
    tag: "0048_crm_company_inline_entities",
    twin: "20260924120000_crm_company_inline_entities.sql",
  },
  {
    tag: "0049_editor_inline_author_lookup",
    twin: "20260924120100_editor_inline_author_lookup.sql",
  },
  {
    tag: "0051_event_speaker_card_tracks",
    drizzleOnly:
      "Ponowne zastosowanie SQL-u 0050 z panelu Lovable (0050 bylo w repozytorium, ale nie na bazie). SQL identyczny i idempotentny; blizniak supabase to juz 20260924140000 - drugi plik uruchomilby to samo drugi raz.",
  },
  // Usuniecie prelegenta z wydarzenia zdejmuje go tez z obsady sesji.
  {
    tag: "0052_event_speaker_remove_clears_sessions",
    twin: "20260924150000_event_speaker_remove_clears_sessions.sql",
  },
  // Poprawka forward-only do 0047: `member_slug_is_non_author` odpowiadała
  // anonowi dla każdego sluga w każdym tenancie (wyrocznia istnienia profili
  // ukrytych przed `profiles_public`), a `is_platform_author` miało zbędny
  // EXECUTE dla `authenticated`. 0047 stoi już na produkcji, a jej bliźniak
  // musi zostać z nią zgodny, więc nowe ciało idzie osobną parą. KOLEJNOŚĆ:
  // bliźniak 0047 (20260924100000) niesie stare ciało i grant - zastosowany
  // na zdalnej bazie PO tym pliku przywróciłby wyrocznię, więc wtedy ten plik
  // trzeba ponowić.
  {
    tag: "0053_member_slug_non_author_visibility",
    twin: "20260925100000_member_slug_non_author_visibility.sql",
  },
  {
    tag: "0054_member_slug_non_author_visibility",
    drizzleOnly:
      "Zastosowanie ciala 0053 z panelu Lovable (0053 bylo w repozytorium, ale nie na bazie). Bez REVOKE is_platform_author z authenticated - narzedzie wdrozeniowe go blokuje; blizniak supabase to juz 20260925100000.",
  },
  // Goscie grupy ida za decyzja o prowadzacym (zatwierdzenie, odrzucenie,
  // anulowanie) i dostaja wlasny bilet z kodem QR; ponowna wysylka z panelu.
  {
    tag: "0055_event_group_guests_follow_lead",
    twin: "20260926100001_event_group_guests_follow_lead.sql",
  },
  // Kod kwotowy schodzi z kazdego miejsca pakietu grupowego, a uzycie kodu
  // jest zuzywane razem z zamowieniem pakietu.
  {
    tag: "0056_event_package_coupon_per_seat",
    twin: "20260926110001_event_package_coupon_per_seat.sql",
  },
  {
    tag: "0057_event_group_guests_follow_lead",
    drizzleOnly:
      "Zastosowanie SQL-u 0055 z panelu Lovable (0055 bylo w repozytorium, ale nie na bazie). SQL identyczny bajt w bajt i idempotentny; blizniak supabase to juz 20260926100001.",
  },
  {
    tag: "0058_event_package_coupon_per_seat",
    drizzleOnly:
      "Zastosowanie SQL-u 0056 z panelu Lovable (0056 bylo w repozytorium, ale nie na bazie). SQL identyczny bajt w bajt i idempotentny; blizniak supabase to juz 20260926110001.",
  },
  // Odrzucenie i anulowanie prowadzacego zamyka takze przyjetych gosci (kod QR
  // przestaje wpuszczac), a platnosc Stripe przyjmuje gosci z kontrola miejsc.
  {
    tag: "0059_event_group_lead_closes_admitted_guests",
    twin: "20260926120001_event_group_lead_closes_admitted_guests.sql",
  },
  // Anulowanie zamowienia pakietu zwraca uzycie kodu, powrot z anulowania
  // zuzywa je ponownie.
  {
    tag: "0060_event_package_order_cancel_returns_coupon",
    twin: "20260926130000_event_package_order_cancel_returns_coupon.sql",
  },
  // Benefit planu czlonka tylko na jego miejscu; bilet z puli dla miejsca
  // prowadzacego schodzi z puli.
  {
    tag: "0061_event_group_lead_plan_seat",
    twin: "20260926140000_event_group_lead_plan_seat.sql",
  },
  {
    tag: "0062_event_group_lead_closes_admitted_guests",
    drizzleOnly:
      "Zastosowanie SQL-u 0059 z panelu Lovable (bez komentarzy, instrukcje identyczne i idempotentne); blizniak supabase to juz 20260926120001.",
  },
  {
    tag: "0063_event_package_order_cancel_returns_coupon",
    drizzleOnly:
      "Zastosowanie SQL-u 0060 z panelu Lovable (bez komentarzy, instrukcje identyczne i idempotentne); blizniak supabase to juz 20260926130000.",
  },
  {
    tag: "0064_event_group_lead_plan_seat",
    drizzleOnly:
      "Zastosowanie SQL-u 0061 z panelu Lovable (bez komentarzy, instrukcje identyczne i idempotentne); blizniak supabase to juz 20260926140000.",
  },
  // Funkcje organizatora (PR #404): pas drizzle 0055-0064 z PR-a, z krotkimi
  // naglowkami - SQL wykonywalny identyczny z pasem supabase, wiec to pelne
  // pary blizniacze (bramka porownuje je przy kazdym przebiegu). Numery
  // 0055-0064 dziela prefiks z czescia 2 modulu Wydarzen - tag jest pelna
  // nazwa pliku, wiec wpisy sie nie myla. Plikow drizzle nie przenumerowujemy
  // ani nie usuwamy - repozytorium jest forward-only (tak jak w #388).
  //
  // PAS SUPABASE SZESCIU Z NICH ZMIENIL NAZWE (czysty `git mv`, tresc bajt
  // w bajt). Piec plikow mialo wersje 20260926100000-140000 - TE SAME, pod
  // ktorymi produkcja ma juz zapisane migracje czesci 2 (goscie grupy, kody
  // na miejsce, zamkniecie gosci, zwrot kodu, benefit planu). Wersja jest
  // kluczem `schema_migrations`, wiec nasze pliki zostalyby po cichu pominiete,
  // a `supabase db start` (pgTAP) padal na kluczu. Nie byly wdrozone (brak
  // zapisu drizzle, brak ich tabel w types.ts z zywej bazy), wiec przejscie na
  // 20260927000100-000500 niczego nie gubi. Klon edycji (20260926170000,
  // zaslepka) idzie na 20260927000800, bo klonuje tabele naboru, planu sali,
  // kampanii i reklam ze sponsorem w funkcjach `LANGUAGE sql` (cialo
  // sprawdzane przy CREATE) - musi przyjsc po nich. 20260926085900
  // i 20260926090000 sa WDROZONE (zapisy Lovable 0065/0066), a 20260926150000
  // i 20260926160000 nie koliduja i zaleza tylko od fundamentu - zostaja.
  // Naglowki plikow drizzle nadal wskazuja nazwy supabase sprzed zmiany (pliki
  // drizzle zostaja bajt w bajt); prawda jest ten rejestr.
  {
    tag: "0055_crm_consent_source_event",
    twin: "20260926085900_crm_consent_source_event.sql",
  },
  {
    tag: "0056_event_organizer_foundation",
    twin: "20260926090000_event_organizer_foundation.sql",
  },
  {
    tag: "0057_event_cfp",
    twin: "20260927000100_event_cfp.sql",
  },
  // Czesci 2..6 migracji 0057_event_cfp (scripts/split-migration.ts,
  // limit wdrozenia Lovable) - kazda para czesci to pelne blizniaki.
  {
    tag: "0057_event_cfp_part2",
    twin: "20260927000101_event_cfp_part2.sql",
  },
  {
    tag: "0057_event_cfp_part3",
    twin: "20260927000102_event_cfp_part3.sql",
  },
  {
    tag: "0057_event_cfp_part4",
    twin: "20260927000103_event_cfp_part4.sql",
  },
  {
    tag: "0057_event_cfp_part5",
    twin: "20260927000104_event_cfp_part5.sql",
  },
  {
    tag: "0057_event_cfp_part6",
    twin: "20260927000105_event_cfp_part6.sql",
  },
  {
    tag: "0058_event_invoices",
    twin: "20260927000200_event_invoices.sql",
  },
  // Czesci 2..5 migracji 0058_event_invoices (scripts/split-migration.ts,
  // limit wdrozenia Lovable) - kazda para czesci to pelne blizniaki.
  {
    tag: "0058_event_invoices_part2",
    twin: "20260927000201_event_invoices_part2.sql",
  },
  {
    tag: "0058_event_invoices_part3",
    twin: "20260927000202_event_invoices_part3.sql",
  },
  {
    tag: "0058_event_invoices_part4",
    twin: "20260927000203_event_invoices_part4.sql",
  },
  {
    tag: "0058_event_invoices_part5",
    twin: "20260927000204_event_invoices_part5.sql",
  },
  {
    tag: "0059_event_ads_funnel",
    twin: "20260927000300_event_ads_funnel.sql",
  },
  // Czesc 2 migracji 0059_event_ads_funnel (scripts/split-migration.ts,
  // limit wdrozenia Lovable) - para czesci to pelne blizniaki.
  {
    tag: "0059_event_ads_funnel_part2",
    twin: "20260927000301_event_ads_funnel_part2.sql",
  },
  {
    tag: "0060_event_seating",
    twin: "20260927000400_event_seating.sql",
  },
  // Czesci 2..3 migracji 0060_event_seating (scripts/split-migration.ts,
  // limit wdrozenia Lovable) - kazda para czesci to pelne blizniaki.
  {
    tag: "0060_event_seating_part2",
    twin: "20260927000401_event_seating_part2.sql",
  },
  {
    tag: "0060_event_seating_part3",
    twin: "20260927000402_event_seating_part3.sql",
  },
  {
    tag: "0061_event_sponsor_report",
    twin: "20260927000500_event_sponsor_report.sql",
  },
  // Czesc 2 migracji 0061_event_sponsor_report (scripts/split-migration.ts,
  // limit wdrozenia Lovable) - para czesci to pelne blizniaki.
  {
    tag: "0061_event_sponsor_report_part2",
    twin: "20260927000501_event_sponsor_report_part2.sql",
  },
  {
    tag: "0062_event_scanner_offline",
    twin: "20260926150000_event_scanner_offline.sql",
  },
  // Czesc 2 migracji 0062_event_scanner_offline (scripts/split-migration.ts,
  // limit wdrozenia Lovable) - para czesci to pelne blizniaki.
  {
    tag: "0062_event_scanner_offline_part2",
    twin: "20260926150001_event_scanner_offline_part2.sql",
  },
  {
    tag: "0063_event_ticket_wallet",
    twin: "20260926160000_event_ticket_wallet.sql",
  },
  {
    tag: "0064_event_clone",
    twin: "20260927000800_event_clone.sql",
  },
  // Czesci 2..3 migracji 0064_event_clone (scripts/split-migration.ts,
  // limit wdrozenia Lovable) - kazda para czesci to pelne blizniaki.
  {
    tag: "0064_event_clone_part2",
    twin: "20260927000801_event_clone_part2.sql",
  },
  {
    tag: "0064_event_clone_part3",
    twin: "20260927000802_event_clone_part3.sql",
  },
  {
    tag: "0065_crm_consent_source_event",
    drizzleOnly:
      "Ponowny zapis zastosowania 20260926085900 z panelu Lovable (SQL wykonywalny identyczny z 0055); blizniak supabase to juz 0055.",
  },
  {
    tag: "0066_event_organizer_foundation",
    drizzleOnly:
      "Ponowny zapis zastosowania 20260926090000 z panelu Lovable bez instrukcji COMMENT ON (pozostale identyczne i idempotentne); blizniak supabase to juz 0056.",
  },
  // Uzgodnienie PR #493-#494: zestaw trzech plików supabase (menu kategorii,
  // zasiew stron noindex, odpublikowanie treści testowych) wgrany jednym
  // zapisem narzędziowym oraz pola karty prelegenta w RPC panelu.
  {
    tag: "0147_pr493_menu_category_links_test_pages_noindex",
    drizzleOnly:
      "Zestawienie trzech plików supabase (menu, zasiew stron noindex, odpublikowanie) z uzgodnienia PR #493; wgrane razem jednym zapisem narzędziowym.",
  },
  {
    tag: "0148_event_speaker_panel_bio",
    drizzleOnly:
      "Pola karty prelegenta w admin_event_speakers_list (bio_*, topics_*, languages, liczniki) wgrane przez narzędzie bazodanowe. ADOPTOWANE w pasie kanonicznym przez 20261025090000_adopt_event_speaker_panel_bio.sql: to samo ciało, RETURNS TABLE, granty i komentarz, z warunkowym DROP + CREATE OR REPLACE zamiast bezwarunkowego DROP + CREATE (na produkcji bez zmiany OID), więc bliźniaka 1:1 nie ma; zgodność instrukcji przypina test adopcji w migrationLaneParity.test.ts.",
  },
  {
    tag: "0149_ledger_reconcile_pr493_pages",
    drizzleOnly:
      "Uzupełnienie rejestru supabase_migrations o wersje wgrane narzędziowo w PR #493; operacja księgowa bez zmian schematu.",
  },
  // Braki modulu Wydarzen, czesc 3: zawiadomienie gosci o odwolanym bilecie,
  // awans za gosci zwroconych, bilet z puli wraca do puli i pokrywa
  // pojedyncze zgloszenie, wplata Stripe przy wyczerpanej puli.
  {
    tag: "0067_event_registration_gaps_part3",
    twin: "20260926180000_event_registration_gaps_part3.sql",
  },
  // Most CRM zaklada nowy kontakt z imieniem i nazwiskiem (crm_lead.created.v1
  // niesie je do HubSpot) i naklada komentarze, ktorych brak w zapisie 0066.
  // Osobna para, bo fundament 20260926090000 jest juz wdrozony.
  {
    tag: "0068_event_person_crm_sync_lead_names",
    twin: "20260927000900_event_person_crm_sync_lead_names.sql",
  },
  // Czesci 2..3 migracji 0067_event_registration_gaps_part3 (scripts/split-migration.ts,
  // limit wdrozenia Lovable) - kazda para czesci to pelne blizniaki.
  {
    tag: "0069_event_registration_gaps_part3_part2",
    twin: "20260926180001_event_registration_gaps_part3_part2.sql",
  },
  {
    tag: "0070_event_registration_gaps_part3_part3",
    twin: "20260926180002_event_registration_gaps_part3_part3.sql",
  },
  // Skaner offline zastosowany z panelu Lovable 2026-09-27 (zapisy
  // drizzle.__drizzle_migrations 72-73). Ten sam uruchomiony migrator wykonal
  // przy okazji wpisy dziennika 0067-0070, czyli 20260926180000-180002
  // i 20260927000900 PRZED fundamentem #406 - kolejnosc reszty wdrozenia jest
  // w docs/WDROZENIE_FUNKCJE_ORGANIZATORA_CZ3_2026-09-27.md, sekcja 2.
  {
    tag: "0071_event_scanner_offline",
    drizzleOnly:
      "Zapis zastosowania 20260926150000 z panelu Lovable (SQL identyczny bajt w bajt z 0062_event_scanner_offline, bez znaku konca pliku); blizniak supabase pilnuje wpis 0062.",
  },
  {
    tag: "0072_event_scanner_offline_part2",
    drizzleOnly:
      "Zapis zastosowania 20260926150001 z panelu Lovable (SQL identyczny bajt w bajt z 0062_event_scanner_offline_part2, bez znaku konca pliku); blizniak supabase pilnuje wpis 0062_event_scanner_offline_part2.",
  },
  // Lejek Google Ads - poprawki po przegladzie (pakiety, zgoda, przychod, limit
  // grup). Bez wpisu w dzienniku drizzle - wdrazana z panelu po kolei.
  {
    tag: "0073_event_ads_funnel_review_fixes",
    twin: "20260927001100_event_ads_funnel_review_fixes.sql",
  },
  // Plan sali - poprawki z przegladu 0060_event_seating*: kolejnosc blokad
  // przydzialu, zaokraglenie parametrow sekcji, eksport bez e-maili, etykieta
  // kandydata na zywo, `event_my_seats` z flagami zapowiedzi. BEZ wpisu
  // w dzienniku drizzle - kolejnosc: scripts/deploy-order/produkcja.txt.
  {
    tag: "0074_event_seating_review_fixes",
    twin: "20260927001200_event_seating_review_fixes.sql",
  },
  // Poprawki z przegladu (funkcje organizatora, czesc 3): klon edycji kopiuje
  // ustawienia uczestnika i szanuje strefe zrodla, most CRM trzyma stan per
  // intencja. BEZ wpisu w dzienniku - kolejnosc wdrozenia w
  // scripts/deploy-order/produkcja.txt.
  {
    tag: "0075_event_clone_participant_settings",
    twin: "20260927001300_event_clone_participant_settings.sql",
  },
  {
    tag: "0076_event_person_crm_intents",
    twin: "20260927001400_event_person_crm_intents.sql",
  },
  // Zapisy wdrozen z panelu Lovable (czesci pod limit rozmiaru) i poprawka po probnym zakupie.
  {
    tag: "0075_event_participant_defect_fixes_agenda",
    drizzleOnly:
      "Zapis wdrozenia z panelu: tylko sekcja 1 (event_my_agenda) z 20260926153200_event_participant_defect_fixes.sql; sekcje 2-3 sa w bazie w nowszej wersji z 20260926180000/180002, wiec blizniak celowo nie jest identyczny.",
  },
  {
    tag: "0094_event_seating_part3",
    drizzleOnly:
      "Zapis wdrozenia z panelu: czesc 20260927000402_event_seating_part3.sql przycieta pod limit rozmiaru migracji; jedyna wersja planu sali w bazie (stary duplikat 20260926130001 NIE byl wdrazany), poprawki pilnuje wpis 0074_event_seating_review_fixes.",
  },
  {
    tag: "0095_event_sponsor_report",
    drizzleOnly:
      "Zapis wdrozenia z panelu: 20260927000500_event_sponsor_report.sql przyciety pod limit rozmiaru (reszta w 0096); stary duplikat 20260926140001 NIE byl wdrazany.",
  },
  {
    tag: "0096_event_sponsor_report_part2",
    drizzleOnly:
      "Zapis wdrozenia z panelu: druga czesc 20260927000500/000501 raportu sponsorow, pocieta pod limit rozmiaru migracji.",
  },
  {
    tag: "0097_event_clone",
    drizzleOnly:
      "Zapis wdrozenia z panelu: 20260927000800_event_clone.sql pociety pod limit rozmiaru migracji (reszta w kolejnych czesciach).",
  },
  {
    tag: "0099_event_clone_part3",
    drizzleOnly:
      "Zapis wdrozenia z panelu: 20260927000802_event_clone_part3.sql pociety pod limit rozmiaru migracji.",
  },
  {
    tag: "0100_event_person_crm_sync_lead_names",
    drizzleOnly:
      "Zapis wdrozenia z panelu: funkcja _event_person_crm_sync z 20260927000900_event_person_crm_sync_lead_names.sql bez czesci juz obecnych w bazie.",
  },
  {
    tag: "0101_event_ads_funnel_review_fixes",
    drizzleOnly:
      "Zapis wdrozenia z panelu poprawek lejka Google Ads; blizniaka 20260927001100 pilnuje wpis 0073_event_ads_funnel_review_fixes, ta kopia jest pocieta pod limit rozmiaru.",
  },
  {
    tag: "0102_event_seating_review_fixes",
    drizzleOnly:
      "Zapis wdrozenia z panelu poprawek planu sali; blizniaka 20260927001200 pilnuje wpis 0074_event_seating_review_fixes, ta kopia jest pocieta pod limit rozmiaru.",
  },
  {
    tag: "0103_event_clone_participant_settings",
    drizzleOnly:
      "Zapis wdrozenia z panelu; blizniaka 20260927001300 pilnuje wpis 0075_event_clone_participant_settings, ta kopia jest pocieta pod limit rozmiaru.",
  },
  {
    tag: "0104_event_person_crm_intents",
    drizzleOnly:
      "Zapis wdrozenia z panelu; blizniaka 20260927001400 pilnuje wpis 0076_event_person_crm_intents, ta kopia jest pocieta pod limit rozmiaru.",
  },
  {
    tag: "0105_payment_orders_guard_service_role_detection",
    twin: "20260929095900_payment_orders_guard_service_role_detection.sql",
  },
  {
    tag: "0106_event_seed_pages_on_publish",
    twin: "20260929100000_event_seed_pages_on_publish.sql",
  },
  {
    tag: "0107_event_participant_features_require_payment",
    twin: "20260929100100_event_participant_features_require_payment.sql",
  },
  {
    tag: "0108_speaker_institution_logo",
    twin: "20260929100200_speaker_institution_logo.sql",
  },
  {
    tag: "0109_speaker_logo_crm_fallback",
    twin: "20260929100300_speaker_logo_crm_fallback.sql",
  },
  {
    tag: "0110_event_identity_subtitles_and_type",
    twin: "20260929100400_event_identity_subtitles_and_type.sql",
  },
  {
    tag: "0111_event_general_type_without_legacy_kind_sync",
    twin: "20260929100500_event_general_type_without_legacy_kind_sync.sql",
  },
  {
    tag: "0112_event_publication_readiness",
    twin: "20260929110000_event_publication_readiness.sql",
  },
  {
    tag: "0113_event_participation_lifecycle",
    twin: "20260929113000_event_participation_lifecycle.sql",
  },
  {
    tag: "0116_event_code_guessing_lockdown",
    twin: "20261001100000_event_code_guessing_lockdown.sql",
  },
  {
    tag: "0118_event_code_scalar_verdicts",
    twin: "20261001210000_event_code_scalar_verdicts.sql",
  },
  {
    tag: "0120_profile_link_routes",
    twin: "20261002100000_profile_link_routes.sql",
  },
  {
    tag: "0121_profile_slug_always_set",
    twin: "20261002110000_profile_slug_always_set.sql",
  },
  {
    tag: "0129_post_views_dwell_signal",
    twin: "20261002200000_post_views_dwell_signal.sql",
  },
  {
    tag: "0131_event_seat_state_single_source",
    twin: "20261002210000_event_seat_state_single_source.sql",
  },
  {
    tag: "0136_event_participant_reminders",
    twin: "20261003140000_event_participant_reminders.sql",
  },
  {
    tag: "0137_event_participant_reminders_apply",
    drizzleOnly:
      "Zapis wdrożenia 0136 z panelu Lovable: plik zawiera wyłącznie COMMENT ON FUNCTION public.run_event_reminders(), dokumentujący zastosowanie 0136. Treść funkcji ma bliźniaka 20261003140000_event_participant_reminders.sql; sam komentarz nie zmienia schematu, więc pas supabase nie dostaje kopii.",
  },
  {
    tag: "0140_club_cover_write_follows_capabilities",
    drizzleOnly:
      "Zastosowanie SQL-u 20261003170000_club_cover_write_follows_capabilities.sql z panelu Lovable: te same 121 instrukcji (zmierzone po zwinięciu spacji), bez pięciu COMMENT ON FUNCTION z pasa supabase. Komentarz nie zmienia ani schematu, ani zachowania; kanonem zostaje plik supabase.",
  },
  {
    tag: "0150_event_speaker_detail_safe_projection",
    drizzleOnly:
      "Wersja event_speaker_detail z panelu Lovable: gałąź ELSE e-maila czyta ap.contact_email z author_profiles_public. Port 20261012123000 celowo oddaje tam NULL (widok w pasie supabase nie ma tej kolumny), więc SQL się różni i bliźniaka nie ma; produkcję wyrównuje 0163.",
  },
  {
    tag: "0163_event_speaker_detail_safe_projection_supabase_lane",
    twin: "20261012123000_event_speaker_detail_safe_projection.sql",
  },
  {
    tag: "0170_payment_orders_shape_guard_and_free_ticket_settlement",
    drizzleOnly:
      "Zestawienie dwóch plików supabase z panelu Lovable: SQL wykonywalny to dokładnie 20261012130300_payment_orders_purchase_shape_guard.sql, a po nim 20261012130400_event_free_ticket_settlement.sql (zmierzone executableSql 2026-10-13). Jeden plik dla dwóch wersji, więc pojedynczego bliźniaka nie ma.",
  },
  {
    tag: "0185_author_profiles_public_drop_contact_email",
    twin: "20261012200000_author_profiles_public_drop_contact_email.sql",
  },
  {
    tag: "0186_public_definer_views_read_only",
    twin: "20261012210000_public_definer_views_read_only.sql",
  },
  // Port poprawki nadużycia kuponu B2B, wcześniej obecnej tylko w pasie
  // supabase (patrz REQUIRED_PRODUCTION_TWINS).
  {
    tag: "0307_ledger_reconcile_pr521",
    drizzleOnly:
      "Uzupełnienie rejestru supabase_migrations o wersje PR #521 wgrane narzędziowo; operacja księgowa bez zmian schematu.",
  },
  {
    tag: "0308_release_coupon_order_lock",
    twin: "20261018120000_release_coupon_order_lock.sql",
  },
  {
    tag: "0309_release_coupon_server_only",
    twin: "20261007140200_release_coupon_server_only.sql",
  },
  {
    tag: "0310_release_coupon_order_lock_final",
    twin: "20261018120000_release_coupon_order_lock.sql",
  },
  {
    tag: "0398_pr533_deployment_completion",
    drizzleOnly:
      "Zapis potwierdzenia wdrożenia PR #533: wyłącznie komentarz funkcji po zastosowaniu bliźniaków 0394-0397; bez dodatkowej zmiany zachowania lub schematu.",
  },
];

export type LaneViolationKind =
  | "brak-wpisu"
  | "wpis-bez-pliku"
  | "brak-blizniaka"
  | "rozjazd-sql"
  | "wpis-spoza-zrodla"
  | "rejestr-zamrozony";

export interface LaneViolation {
  readonly kind: LaneViolationKind;
  readonly tag: string;
  readonly detail: string;
}

/**
 * Zapis wdrozenia z panelu Lovable rozpoznany PO TRESCI, bez wpisu w rejestrze:
 * SQL wykonywalny pliku drizzle jest identyczny z plikiem `twin` pasa supabase.
 */
export interface DeployRecord {
  readonly tag: string;
  readonly twin: string;
}

export interface LaneReport {
  readonly checked: number;
  readonly twins: number;
  readonly drizzleOnly: number;
  /** Pliki bez wpisu, ktore sa kopia migracji z pasa supabase (patrz `analyzeMigrationLanes`). */
  readonly deployRecords: readonly DeployRecord[];
  /** Wpisy po zamrożeniu: kanoniczne wyzwalacze wdrożenia (no-op) - przechodzą po cichu. */
  readonly deployTriggers: readonly string[];
  /** Wpisy po zamrożeniu z samych `COMMENT ON` spoza kanonu - przechodzą z ostrzeżeniem. */
  readonly deployMarkers: readonly string[];
  /** Wpisy po zamrożeniu bez SQL-a wykonywalnego (same komentarze) - no-op z ostrzeżeniem. */
  readonly emptyEntries: readonly string[];
  /** Wpisy MIGRATION_LANES dla wyzwalaczy, znaczników i pustych wpisów po zamrożeniu - zbędne, bez czerwieni. */
  readonly redundantRegistry: readonly string[];
  readonly violations: readonly LaneViolation[];
}

/** Odczyt pliku; `null`, gdy pliku nie ma. Wstrzykiwalny, żeby test nie dotykał dysku. */
export type ReadFile = (path: string) => string | null;

export const readFileOrNull: ReadFile = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

/** Nazwy plikow `.sql` katalogu migracji; wstrzykiwalne jak `ReadFile`. */
export type ListSql = (dir: string) => readonly string[];

export const listSqlOrEmpty: ListSql = (dir) => {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch {
    return [];
  }
};

/** Polskie znaki do ASCII - pas drizzle zapisuje literały bez diakrytyków. */
function foldDiacritics(sql: string): string {
  return sql.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/Ł/g, "L");
}

/**
 * Czy tekst POZA literałami, od ostatniego `;`, kończy się na `COMMENT ON ... IS `
 * (albo `IS E` - prefiks literału E'...' stoi tuż przed apostrofem).
 */
function isCommentOperand(stmt: string): boolean {
  return /\bCOMMENT\s+ON\b[\s\S]*\bIS\s+E?$/i.test(stmt);
}

/**
 * Koniec (wyłącznie) literału zaczynającego się na `at`; `''` w środku to escape.
 * `backslash` - literał E'...': tam `\'` też jest escape'em i NIE zamyka
 * literału (`E'a\';b'` to jeden napis `a';b`). Bez tego skaner kończył literał
 * przy `\'`, a resztę pliku czytał z odwróconym cytowaniem - i spacja W ŚRODKU
 * następnych literałów przestawała być widoczna dla odcisku.
 */
function literalEnd(src: string, at: number, backslash: boolean): number {
  let j = at + 1;
  while (j < src.length) {
    if (backslash && src[j] === "\\") {
      j += 2;
      continue;
    }
    if (src[j] === "'") {
      if (src[j + 1] === "'") {
        j += 2;
        continue;
      }
      break;
    }
    j += 1;
  }
  return Math.min(j + 1, src.length);
}

/**
 * Nazwa (słowo kluczowe albo identyfikator) jak w lekserze PostgreSQL: zaczyna
 * się literą, `_` albo znakiem spoza ASCII, a dalej może mieć też cyfry i `$`.
 * `$` W ŚRODKU nazwy (`a$b$c`) należy do niej - nie otwiera cytowania dolarami.
 * Wspólne ze splitterem migracji, jak granice komentarzy niżej.
 */
export const SQL_IDENT_START = /[A-Za-z_\u0080-\uFFFF]/;
export const SQL_IDENT_CONT = /[A-Za-z0-9_$\u0080-\uFFFF]/;
/** Tag cytowania dolarami jak w PostgreSQL (także z literami spoza ASCII); `sticky`. */
export const SQL_DOLLAR_TAG = /\$(?:[A-Za-z_\u0080-\uFFFF][A-Za-z0-9_\u0080-\uFFFF]*)?\$/y;

/**
 * Koniec komentarza `/* ... *\/` od `at` - ZAGNIEŻDŻONEGO, jak w PostgreSQL
 * (`/* a /* b *\/ c *\/` to jeden komentarz); `-1`, gdy niedomknięty. Wspólny
 * ze splitterem migracji (migrationSplit.ts): granice komentarzy w odcisku
 * i w lekserze instrukcji muszą być TE SAME, inaczej dowód podziału porównuje
 * dwa różne odczytania jednego pliku.
 */
export function sqlBlockCommentEnd(src: string, at: number): number {
  let depth = 0;
  let j = at;
  while (j < src.length) {
    if (src[j] === "/" && src[j + 1] === "*") {
      depth += 1;
      j += 2;
    } else if (src[j] === "*" && src[j + 1] === "/") {
      depth -= 1;
      j += 2;
      if (depth === 0) return j;
    } else {
      j += 1;
    }
  }
  return -1;
}

/**
 * Koniec komentarza `--` od `at`: pierwszy `\n` ALBO `\r` (tak kończy go
 * lekser PostgreSQL i psql - samotny CR też zamyka komentarz), bez niego.
 * Wspólny ze splitterem migracji, jak `sqlBlockCommentEnd`.
 */
export function sqlLineCommentEnd(src: string, at: number): number {
  let j = at;
  while (j < src.length && src[j] !== "\n" && src[j] !== "\r") j += 1;
  return j;
}

/**
 * Kontynuacja literalu jak w lekserze PostgreSQL (`quotecontinue`): za
 * zamykajacym `'` stoja poziome biale znaki albo komentarze `--`, KONIEC
 * LINII, dalej biale znaki albo komentarze zakonczone koncem linii - i `'`.
 * Zwraca indeks tego `'` albo `-1`, gdy literal sie tu konczy. Dla zwyklego
 * literalu granice instrukcji wychodza te same z kontynuacja i bez niej, ale
 * E'...' kontynuuje sie W TRYBIE E: `\'` w dalszym kawalku tez jest escape'em
 * i nie zamyka literalu. Wspolne ze splitterem migracji.
 */
export function sqlQuoteContinuation(src: string, at: number): number {
  let j = at;
  for (;;) {
    if (j < src.length && /[ \t\f]/.test(src[j]!)) j += 1;
    else if (src[j] === "-" && src[j + 1] === "-") j = sqlLineCommentEnd(src, j);
    else break;
  }
  if (src[j] !== "\n" && src[j] !== "\r") return -1;
  j += 1;
  for (;;) {
    if (j < src.length && /[ \t\n\r\f\v]/.test(src[j]!)) j += 1;
    else if (src[j] === "-" && src[j + 1] === "-") {
      const end = sqlLineCommentEnd(src, j);
      if (end === src.length) return -1;
      j = end + 1;
    } else break;
  }
  return src[j] === "'" ? j : -1;
}

/**
 * Koniec CAŁEGO ciągu sklejanych literałów zaczynającego się na `at`.
 *
 * KONIEC WIERSZA JEST WARUNKIEM, NIE OZDOBĄ. PostgreSQL skleja dwie sąsiadujące
 * stałe napisowe tylko wtedy, gdy rozdzielający je biały znak zawiera ZNAK
 * NOWEGO WIERSZA; `'a' 'b'` w jednej linii to błąd składni, a nie napis `ab`.
 * Gdyby ta pętla łykała też wariant jednowierszowy, odcisk zrównywałby plik
 * NIEWYKONYWALNY z poprawnym bliźniakiem - a bramki `check:sql-*` czytają
 * wyłącznie pas supabase, więc nic innego by tego nie złapało. Zepsuty plik
 * pasa drizzle ma tu zapalić bramkę, nie przejść.
 *
 * Cokolwiek innego niż biały znak - również komentarz `--` - kończy ciąg.
 */
function concatenatedLiteralsEnd(src: string, at: number, backslash: boolean): number {
  // Kawalek sklejony z E'...' jest nadal w trybie E (tak czyta go lekser
  // PostgreSQL), wiec `backslash` obowiazuje caly ciag.
  let end = literalEnd(src, at, backslash);
  for (;;) {
    let k = end;
    let sawNewline = false;
    while (k < src.length && /\s/.test(src[k]!)) {
      if (src[k] === "\n") sawNewline = true;
      k += 1;
    }
    if (!sawNewline || src[k] !== "'") return end;
    end = literalEnd(src, k, backslash);
  }
}

/**
 * Skaner świadomy cytowania. Normalizuje WYŁĄCZNIE tekst poza literałami
 * i sam wycina komentarze - to drugie jest istotne, patrz `executableSql`.
 *
 * `maskCommentProse` włącza podmianę treści literału, który jest operandem
 * `COMMENT ON ... IS`. Wyłączamy je dla ciał cytowanych dolarami: `COMMENT ON`
 * w środku ciała funkcji czy widoku to NIE jest instrukcja komentująca obiekt,
 * tylko fragment zachowania - i dwa różne ciała nie mogą się przez to zrównać.
 *
 * `dollarIsCode` mówi, czym jest napotkany obszar `$tag$ ... $tag$`. Na
 * najwyższym poziomie to ciało funkcji albo widoku, czyli KOD: wchodzimy w nie
 * rekurencyjnie, bo spacja jest tam nieistotna, a komentarze `--` to proza,
 * którą trzeba wyciąć. JUŻ W ŚRODKU tego ciała zagnieżdżony obszar cytowany
 * dolarami jest natomiast WARTOŚCIĄ - i musi przejść bajt w bajt, razem
 * z tekstem, który tylko wygląda na komentarz.
 */
function scan(src: string, opts: { maskCommentProse: boolean; dollarIsCode: boolean }): string {
  let out = "";
  let buf = "";
  let stmt = "";
  let i = 0;
  /** Poprzedni token to samo `E`/`e` stojące tuż przed `'` - literał E'...'. */
  let escapeLiteral = false;

  /** Oddaje zebrany tekst spoza literałów - złożony i ze zwartą spacją. */
  const flush = (): void => {
    if (buf === "") return;
    const norm = foldDiacritics(buf).replace(/\s+/g, " ");
    buf = "";
    out += norm;
    const lastSemi = norm.lastIndexOf(";");
    stmt = lastSemi === -1 ? stmt + norm : norm.slice(lastSemi + 1);
  };

  while (i < src.length) {
    const ch = src[i]!;

    // Komentarze wycinamy TUTAJ, a nie przed wejściem do skanera: dopiero tu
    // wiadomo, czy `--` stoi w kodzie, czy w środku wartości. Zostaje spacja,
    // żeby `a--c\nb` nie skleiło się w `ab`. Granice komentarzy są te same, co
    // w PostgreSQL (`--` do `\n` albo `\r`, `/* */` zagnieżdżony) - inaczej
    // koniec komentarza wypadałby w innym miejscu niż na bazie i skaner czytałby
    // dalszy ciąg pliku z przesuniętym cytowaniem.
    if (ch === "-" && src[i + 1] === "-") {
      buf += " ";
      i = sqlLineCommentEnd(src, i);
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const end = sqlBlockCommentEnd(src, i);
      buf += " ";
      i = end === -1 ? src.length : end;
      continue;
    }

    // $tag$ ... $tag$ - na wierzchu ciało funkcji/widoku (KOD), a w środku
    // takiego ciała już WARTOŚĆ, którą zostawiamy nietkniętą.
    if (ch === "$") {
      SQL_DOLLAR_TAG.lastIndex = i;
      const opener = SQL_DOLLAR_TAG.exec(src);
      if (opener) {
        const tag = opener[0];
        const bodyFrom = i + tag.length;
        const close = src.indexOf(tag, bodyFrom);
        const bodyTo = close === -1 ? src.length : close;
        const body = src.slice(bodyFrom, bodyTo);
        flush();
        out +=
          tag +
          (opts.dollarIsCode
            ? scan(body, { maskCommentProse: false, dollarIsCode: false })
            : body) +
          (close === -1 ? "" : tag);
        stmt += "x";
        i = close === -1 ? src.length : close + tag.length;
        continue;
      }
    }

    // Literał pojedynczy; '' w środku to escape, nie koniec (w E'...' także \').
    if (ch === "'") {
      const backslash = escapeLiteral;
      let end = literalEnd(src, i, backslash);
      let next = backslash ? sqlQuoteContinuation(src, end) : -1;
      while (next !== -1) {
        end = literalEnd(src, next, true);
        next = sqlQuoteContinuation(src, end);
      }
      escapeLiteral = false;
      // `flush()` PRZED pytaniem o operand: dopiero on dokłada do `stmt` tekst
      // spoza literałów, a to w nim stoi `COMMENT ON ... IS `.
      flush();
      if (opts.maskCommentProse && isCommentOperand(stmt)) {
        // SĄSIADUJĄCE LITERAŁY TO JEDNA WARTOŚĆ. SQL skleja `'a' 'b'` w `'ab'`,
        // więc operand `COMMENT ON ... IS` rozbity na kilka literałów - tak
        // zapisuje długą prozę pas supabase - jest tą samą prozą, co jeden
        // literał w pasie drizzle. Bez zjedzenia całego ciągu pierwszy literał
        // dostawał znacznik, a reszta szła bajt w bajt i para 0016 zapalała
        // `rozjazd-sql` na SAMEJ PROZIE, której ta bramka świadomie nie pilnuje.
        out += "'<proza>'";
        stmt += "x";
        i = concatenatedLiteralsEnd(src, i, backslash);
        continue;
      }
      out += src.slice(i, end);
      stmt += "x";
      i = end;
      continue;
    }

    // Cytowany identyfikator - też nietykalny ("Kolumna" != "kolumna").
    if (ch === '"') {
      const close = src.indexOf('"', i + 1);
      const end = close === -1 ? src.length : close + 1;
      flush();
      out += src.slice(i, end);
      stmt += "x";
      i = end;
      continue;
    }

    // Nazwa w całości, razem z `$` w środku - jak w lekserze PostgreSQL, żeby
    // `a$b$c` nie otworzyło ciała `$b$`. Samo `E`/`e` tuż przed `'` to
    // prefiks literału E'...' (a `somE'x'` to nazwa i zwykły literał).
    if (SQL_IDENT_START.test(ch)) {
      let j = i + 1;
      while (j < src.length && SQL_IDENT_CONT.test(src[j]!)) j += 1;
      escapeLiteral = j === i + 1 && (ch === "E" || ch === "e") && src[j] === "'";
      buf += src.slice(i, j);
      i = j;
      continue;
    }

    buf += ch;
    i += 1;
  }

  flush();
  return out;
}

/**
 * SQL WYKONYWALNY: bez komentarzy, ze złożonymi diakrytykami i znormalizowaną
 * spacją POZA literałami, i z treścią operandu `COMMENT ON ... IS '...'`
 * zastąpioną znacznikiem - także wtedy, gdy operand jest sklejony z kilku
 * sąsiadujących literałów, bo SQL widzi w nich JEDNĄ wartość.
 *
 * Znacznik zamiast treści, a nie wycięcie całej instrukcji: gdyby jeden pas
 * przestał w ogóle komentować obiekt, różnica ma być nadal widoczna.
 *
 * DLACZEGO SKANER, A NIE TRZY `replace`. Poprzednia wersja składała diakrytyki
 * i zwierała spację GLOBALNIE, a literał komentarza łapała wyrażeniem
 * regularnym - i każda z tych trzech rzeczy potrafiła uzgodnić pliki, które
 * NAPRAWDĘ się różnią:
 *
 *   * globalne składanie diakrytyków zrównywało `CHECK (typ = 'złożony')`
 *     z `CHECK (typ = 'zlozony')` - inne ograniczenie, ten sam odcisk;
 *   * globalne zwieranie spacji zmieniało TREŚĆ literałów, więc `'a  b'`
 *     i `'a b'` przestawały się różnić;
 *   * wzorzec `COMMENT ON ... IS '...'` trafiał też WEWNĄTRZ ciała funkcji czy
 *     widoku cytowanego dolarami, więc dwa różne ciała zwracające
 *     `$$COMMENT ON x IS 'foo'$$` i `$$COMMENT ON x IS 'bar'$$` maskowały się
 *     nawzajem - a to jest różnica zachowania, nie prozy.
 *
 * CO JEST, A CO NIE JEST TREŚCIĄ. Literał pojedynczy i cytowany identyfikator
 * przechodzą bajt w bajt. Obszar cytowany dolarami zależy od piętra: NA WIERZCHU
 * to ciało funkcji albo widoku, czyli kod - wchodzimy w nie rekurencyjnie, bo
 * spacja jest tam nieistotna, a komentarze `--` to proza, którą trzeba wyciąć
 * (pas supabase komentuje ciała obficie, pas drizzle wcale; bez tego bramka
 * zapalałaby się na czterech z dziesięciu par WYŁĄCZNIE z powodu prozy).
 * JUŻ W ŚRODKU takiego ciała zagnieżdżony obszar cytowany dolarami jest
 * WARTOŚCIĄ i przechodzi nietknięty.
 *
 * DLACZEGO KOMENTARZE WYCINA SAM SKANER, a nie `stripSqlComments` przed nim.
 * Tamta funkcja zna apostrof i cudzysłów, ale NIE zna cytowania dolarami, więc
 * uruchomiona wcześniej kasowała tekst wyglądający na komentarz także ze środka
 * zagnieżdżonej WARTOŚCI - a rekurencja nie ma już czego ochronić, skoro wejście
 * przyszło zmienione. Para
 *
 *     $a$ BEGIN RETURN $b$foo -- A\nbar$b$; END $a$
 *     $a$ BEGIN RETURN $b$foo -- B\nbar$b$; END $a$
 *
 * zwracała ten sam odcisk, mimo że funkcje zwracają RÓŻNE napisy. Dlatego
 * wycinanie komentarzy siedzi w pętli skanera: dopiero tam wiadomo, czy `--`
 * stoi w kodzie, czy w wartości.
 */
export function executableSql(sql: string): string {
  return scan(sql, { maskCommentProse: true, dollarIsCode: true }).trim();
}

/** Indeks wpisu z prefiksu tagu (`0399_x` -> 399); tag bez prefiksu liczy się jak wpis po zamrożeniu. */
function journalIdx(tag: string): number {
  return Number(/^(\d+)_/.exec(tag)?.[1] ?? Number.POSITIVE_INFINITY);
}

/** Ocena wpisu po zamrożeniu - wyłącznie PO TREŚCI; rejestr nie ma tu głosu. */
type FrozenVerdict =
  | { readonly kind: "brak-pliku" }
  | { readonly kind: "zapis"; readonly twin: string }
  | { readonly kind: "wyzwalacz" }
  | { readonly kind: "znacznik" }
  | { readonly kind: "pusty" }
  | { readonly kind: "naruszenie"; readonly violation: LaneViolation };

/**
 * Klasyfikacja wpisu po zamrożeniu w kolejności z nagłówka modułu: lustro
 * generatora, kopia pliku supabase, kanoniczny wyzwalacz, znacznik z samych
 * `COMMENT ON`, wpis bez SQL-a wykonywalnego, a wszystko inne to
 * `wpis-spoza-zrodla`. Nagłówek generatora
 * rozstrzyga PIERWSZY: lustro rozjechane ze swoim źródłem nie przejdzie jako
 * kopia innego pliku o starym SQL-u.
 */
function judgeAfterFreeze(
  tag: string,
  drizzleSql: string | null,
  read: ReadFile,
  supabaseTwinOf: (sql: string) => string | undefined,
  freezeIdx: number,
): FrozenVerdict {
  if (drizzleSql === null) return { kind: "brak-pliku" }; // łapie evaluateLaneGate (missingFiles)
  const source = mirrorSourceOf(drizzleSql);
  if (source !== null) {
    const sourceSql = read(`${SUPABASE_DIR}/${source}`);
    if (sourceSql === null)
      return {
        kind: "naruszenie",
        violation: {
          kind: "brak-blizniaka",
          tag,
          detail: `Nagłówek generatora wskazuje ${SUPABASE_DIR}/${source}, a tego pliku nie ma - źródła wysłanej migracji nie usuwa się ani nie przemianowuje (forward-only).`,
        },
      };
    if (executableSql(sourceSql) !== executableSql(drizzleSql))
      return {
        kind: "naruszenie",
        violation: {
          kind: "rozjazd-sql",
          tag,
          detail: `${SUPABASE_DIR}/${source} zmieniono po wygenerowaniu ${tag}. Wpis z main mógł już wykonać się na produkcji: cofnij zmianę źródła i dodaj NOWĄ migrację. Wpis lokalny gałęzi przepisze \`bun run migrations:mirror\`; poprawkę Lovable wpisu oczekującego przenieś do obu plików. Jedyny wyjątek (docs/RUNBOOK_MIGRACJE_LOVABLE.md §6.3): wpis, którego produkcja nie wykonała (\`bun run migrations:deploy-sql -- --verify\` zwraca „brak w rejestrze"), przepisuje \`bun run migrations:mirror --rewrite ${tag}\`.`,
        },
      };
    return { kind: "zapis", twin: source };
  }
  const twin = supabaseTwinOf(drizzleSql);
  if (twin !== undefined) return { kind: "zapis", twin };
  if (isDeployTrigger(tag, drizzleSql)) return { kind: "wyzwalacz" };
  if (isCommentOnlySql(drizzleSql)) return { kind: "znacznik" };
  if (executableSql(drizzleSql) === "") return { kind: "pusty" };
  return {
    kind: "naruszenie",
    violation: {
      kind: "wpis-spoza-zrodla",
      tag,
      detail: `Wpis po zamrożeniu dziennika (${freezeIdx}) nie jest lustrem ani kopią żadnego pliku ${SUPABASE_DIR}/, a nie jest też znacznikiem wdrożenia z samych COMMENT ON - produkcja wykona SQL, którego pas kanoniczny (pgTAP, bramki check:sql-*) nie zna.`,
    },
  };
}

/**
 * Porównuje dziennik drizzle z rejestrem (historia do `freezeIdx`) i z pasem
 * supabase (wpisy z bliźniakiem, kopie, a po zamrożeniu każdy wpis).
 *
 * `tags` to nazwy plików `.sql` z `drizzle/migrations/` BEZ rozszerzenia, czyli
 * dokładnie `tag` z dziennika drizzle.
 *
 * ZAPIS WDROŻENIA BEZ WPISU. Do 2026-10-18 (faza A) panel Lovable wdrażał
 * migrację, przepisując ją na nowy wpis dziennika (`0071_event_scanner_offline`
 * = 20260926150000) - kilkadziesiąt kopii, każda bez wpisu w rejestrze. Od
 * przełączenia kopie powstają wyłącznie z `bun run migrations:mirror` albo
 * z adopcji (docs/RUNBOOK_MIGRACJE_LOVABLE.md §5). Przed tym, co ta bramka łapie
 * (SQL widoczny tylko w pasie drizzle, niewidoczny dla bramek `check:sql-*`),
 * chroni sama treść: plik, którego SQL WYKONYWALNY jest identyczny z plikiem
 * `supabase/migrations/`, stoi w pasie kanonicznym. Taki plik przechodzi jako
 * `deployRecords` - raport wymienia go z nazwy i bliźniakiem. W historii (do
 * `freezeIdx`) różnica choćby o jedną instrukcję (np. kopia bez `COMMENT ON`,
 * jak 0066) wymaga wpisu w rejestrze; po zamrożeniu - adopcji do pasa
 * kanonicznego (`wpis-spoza-zrodla`).
 *
 * PO ZAMROŻENIU (idx > `freezeIdx`) rejestr niczego nie zwalnia: wpis ocenia
 * `judgeAfterFreeze`, a wpis rejestru dla takiego tagu to `rejestr-zamrozony`
 * - poza wyzwalaczem i znacznikiem, przy których jest tylko zbędny
 * (`redundantRegistry`). Brak pliku łapie `evaluateLaneGate` (missingFiles).
 */
export function analyzeMigrationLanes(
  tags: readonly string[],
  entries: readonly LaneEntry[] = MIGRATION_LANES,
  read: ReadFile = readFileOrNull,
  listSupabase: ListSql = listSqlOrEmpty,
  freezeIdx: number = JOURNAL_FREEZE_IDX,
): LaneReport {
  const byTag = new Map(entries.map((e) => [e.tag, e]));
  const violations: LaneViolation[] = [];
  const deployRecords: DeployRecord[] = [];
  const deployTriggers: string[] = [];
  const deployMarkers: string[] = [];
  const emptyEntries: string[] = [];
  const redundantRegistry: string[] = [];
  let twins = 0;
  let drizzleOnly = 0;

  // Odcisk SQL-u wykonywalnego -> pierwszy plik pasa supabase (w kolejności
  // wersji). Liczony leniwie: tylko gdy jest plik bez wpisu albo po zamrożeniu.
  let supabaseBySql: Map<string, string> | null = null;
  const supabaseTwinOf = (sql: string): string | undefined => {
    if (supabaseBySql === null) {
      supabaseBySql = new Map();
      for (const name of listSupabase(SUPABASE_DIR)) {
        const text = read(`${SUPABASE_DIR}/${name}`);
        if (text === null) continue;
        const key = executableSql(text);
        if (key !== "" && !supabaseBySql.has(key)) supabaseBySql.set(key, name);
      }
    }
    return supabaseBySql.get(executableSql(sql));
  };

  for (const tag of tags) {
    const entry = byTag.get(tag);
    if (journalIdx(tag) > freezeIdx) {
      const verdict = judgeAfterFreeze(
        tag,
        read(`${DRIZZLE_DIR}/${tag}.sql`),
        read,
        supabaseTwinOf,
        freezeIdx,
      );
      if (verdict.kind === "zapis") deployRecords.push({ tag, twin: verdict.twin });
      else if (verdict.kind === "wyzwalacz") deployTriggers.push(tag);
      else if (verdict.kind === "znacznik") deployMarkers.push(tag);
      else if (verdict.kind === "pusty") emptyEntries.push(tag);
      else if (verdict.kind === "naruszenie") violations.push(verdict.violation);
      if (!entry) continue;
      if (verdict.kind === "wyzwalacz" || verdict.kind === "znacznik" || verdict.kind === "pusty")
        redundantRegistry.push(tag);
      else
        violations.push({
          kind: "rejestr-zamrozony",
          tag,
          detail: `MIGRATION_LANES jest zamrożony na wpisie ${freezeIdx}: wpis po nim ocenia się po treści (lustro z \`bun run migrations:mirror\`, kopia pliku ${SUPABASE_DIR}/ albo znacznik wdrożenia), a nie decyzją w rejestrze.`,
        });
      continue;
    }
    if (!entry) {
      const drizzleSql = read(`${DRIZZLE_DIR}/${tag}.sql`);
      const twin = drizzleSql === null ? undefined : supabaseTwinOf(drizzleSql);
      if (twin !== undefined) {
        deployRecords.push({ tag, twin });
        continue;
      }
      violations.push({
        kind: "brak-wpisu",
        tag,
        detail: `Plik ${DRIZZLE_DIR}/${tag}.sql nie ma wpisu w MIGRATION_LANES. Wskaż bliźniaka z ${SUPABASE_DIR}/ albo napisz, czemu go nie ma.`,
      });
      continue;
    }
    if (!("twin" in entry)) {
      drizzleOnly += 1;
      continue;
    }

    twins += 1;
    const drizzleSql = read(`${DRIZZLE_DIR}/${tag}.sql`);
    const supabaseSql = read(`${SUPABASE_DIR}/${entry.twin}`);
    if (drizzleSql === null) continue; // brak pliku łapie pętla niżej
    if (supabaseSql === null) {
      violations.push({
        kind: "brak-blizniaka",
        tag,
        detail: `Wpis wskazuje na ${SUPABASE_DIR}/${entry.twin}, ale tego pliku nie ma.`,
      });
      continue;
    }
    if (executableSql(drizzleSql) !== executableSql(supabaseSql)) {
      violations.push({
        kind: "rozjazd-sql",
        tag,
        detail: `${DRIZZLE_DIR}/${tag}.sql i ${SUPABASE_DIR}/${entry.twin} mają RÓŻNY SQL wykonywalny. Produkcja i pgTAP testowałyby wtedy dwie różne bazy.`,
      });
    }
  }

  const present = new Set(tags);
  for (const entry of entries) {
    if (!present.has(entry.tag)) {
      violations.push({
        kind: "wpis-bez-pliku",
        tag: entry.tag,
        detail: `Rejestr ma wpis dla ${entry.tag}, ale pliku ${DRIZZLE_DIR}/${entry.tag}.sql nie ma. Martwy wpis maskuje brak pliku.`,
      });
    }
  }

  return {
    checked: tags.length,
    twins,
    drizzleOnly,
    deployRecords,
    deployTriggers,
    deployMarkers,
    emptyEntries,
    redundantRegistry,
    violations,
  };
}

// ---------------------------------------------------------------------------
// BRAMKA W CI (`bun run check:migration-lanes`).
//
// Rejestr wyżej istniał od początku, ale nic go nie wołało - plik dołożony do
// drizzle/ bez decyzji przechodził po cichu, choć nagłówek tego modułu mówi
// „Nie da się już dołożyć pliku po cichu". Od 2026-10-12 runner porównuje
// raport z rejestrem ZNANYCH naruszeń w dniu włączenia: każde NOWE naruszenie
// czerwieni CI, a znane, które przestało występować, trzeba z listy usunąć -
// lista może tylko maleć. Kopia pliku supabase (ten sam SQL wykonywalny)
// przechodzi bez wpisu jako zapis wdrożenia, więc repliki panelu Lovable nie
// zapalają bramki; zapala ją plik WYŁĄCZNIE drizzle bez wpisu.
//
// Znane w dniu włączenia: 31 wpisów `wpis-bez-pliku`. To nie są brakujące
// pliki - pliki leżą w drizzle/migrations, ale NIE MA ich w `_journal.json`
// (sieroty po przenumerowaniu przez panel, np. `0057_event_cfp.sql` wobec
// dziennikowego `0079_event_cfp`), więc migrator drizzle nigdy ich nie
// wykona, a wpisy niczego, co jedzie na produkcję, nie maskują. Zamrożone
// zamiast skasowanych, żeby nie gubić zapisu decyzji; usunięcie sieroty albo
// jej wpisu skraca tę listę.
//
// KOLEJNOŚĆ DZIENNIKA. Migrator drizzle stosuje wyłącznie wpisy, których
// `when` jest PÓŹNIEJSZE niż `created_at` ostatniej zastosowanej migracji.
// Wpis z `when` nie większym od poprzednika - typowo po scaleniu gałęzi,
// której numeracja powstała przed nowszymi wpisami z main - zostaje na
// produkcji pominięty po cichu. Ten PR trafił na to dwa razy w jeden dzień
// (bliźnięta 0151-0153 i 0164/0165 pod wpisami Lovable 0151-0170). Bramka
// wymaga więc, żeby każdy wpis miał `when` późniejsze od WSZYSTKICH
// wcześniejszych (tak liczy migrator: względem najnowszego zastosowanego);
// pięć historycznych odstępstw - powtórek bez skutku - jest zamrożonych jak
// sieroty wyżej.
// ---------------------------------------------------------------------------

/** Wpisy rejestru dla sierot spoza `_journal.json` - znane w dniu włączenia bramki. */
export const KNOWN_ORPHAN_LANE_ENTRIES: readonly string[] = [
  "0055_crm_consent_source_event",
  "0056_event_organizer_foundation",
  "0057_event_cfp",
  "0057_event_cfp_part2",
  "0057_event_cfp_part3",
  "0057_event_cfp_part4",
  "0057_event_cfp_part5",
  "0057_event_cfp_part6",
  "0058_event_invoices",
  "0058_event_invoices_part2",
  "0058_event_invoices_part3",
  "0058_event_invoices_part4",
  "0058_event_invoices_part5",
  "0059_event_ads_funnel",
  "0059_event_ads_funnel_part2",
  "0060_event_seating",
  "0060_event_seating_part2",
  "0060_event_seating_part3",
  "0061_event_sponsor_report",
  "0061_event_sponsor_report_part2",
  "0062_event_scanner_offline",
  "0062_event_scanner_offline_part2",
  "0063_event_ticket_wallet",
  "0064_event_clone",
  "0064_event_clone_part2",
  "0064_event_clone_part3",
  "0073_event_ads_funnel_review_fixes",
  "0074_event_seating_review_fixes",
  "0075_event_clone_participant_settings",
  "0076_event_person_crm_intents",
  "0131_event_seat_state_single_source",
];

/**
 * Wpisy `_journal.json`, których `when` nie przekracza najpóźniejszego `when`
 * wcześniejszych wpisów - znane w dniu włączenia bramki. Wszystkie pięć to
 * powtórki o IDENTYCZNYM SQL-u wykonywalnym (zmierzone `executableSql`
 * 2026-10-13): 0062-0064 = 0059-0061 (ręcznie ustawione `when` co godzinę),
 * 0114/0115 = 0112/0113 (`when` 11:00/11:30). Pominięcie ich przez migrator
 * niczego nie zmienia - stąd zamrożenie zamiast naprawy.
 */
export const KNOWN_NON_MONOTONIC_JOURNAL: readonly string[] = [
  "0062_event_group_lead_closes_admitted_guests",
  "0063_event_package_order_cancel_returns_coupon",
  "0064_event_group_lead_plan_seat",
  "0114_event_publication_readiness",
  "0115_event_participation_lifecycle",
];

/**
 * Poprawki z pasa supabase, które MUSZĄ mieć nośnik w dzienniku drizzle - wpis,
 * którego plik ma ten sam SQL wykonywalny (bliźniak z rejestru albo zapis
 * wdrożenia rozpoznany po treści).
 *
 * Rejestr wyżej patrzy tylko w jedną stronę: plik drizzle bez decyzji zapala
 * bramkę, ale migracja obecna WYŁĄCZNIE w pasie supabase przechodzi po cichu -
 * a pgTAP i bramki `check:sql-*` czytają tylko ten pas, więc dowód poprawki
 * zostaje zielony, choć migrator produkcji nigdy jej nie wykona. Tak przeszło
 * `20261007140200_release_coupon_server_only`: `release_b2b_coupon` (SECURITY
 * DEFINER, EXECUTE dla authenticated, bez sprawdzenia właściciela i statusu
 * zamówienia) zostało na produkcji, a kod wracał do niego przy PGRST202.
 *
 * Lista może tylko rosnąć. Nie jest regułą „każda migracja supabase ma
 * bliźniaka": wiele plików tego pasa celowo nie ma osobnego nośnika (zlepki
 * panelu, rekoncyliacje), więc wpis tutaj to świadoma decyzja, że brak
 * nośnika byłby luką na produkcji.
 */
export const REQUIRED_PRODUCTION_TWINS: readonly string[] = [
  "20261007140200_release_coupon_server_only.sql",
  "20261018120000_release_coupon_order_lock.sql",
];

/**
 * Pliki z `required`, których SQL-a wykonywalnego nie niesie żaden wpis dziennika
 * (także plik supabase, którego nie ma - wpis listy nie może wskazywać w próżnię).
 */
export function missingProductionCarriers(
  tags: readonly string[],
  required: readonly string[] = REQUIRED_PRODUCTION_TWINS,
  read: ReadFile = readFileOrNull,
): string[] {
  if (required.length === 0) return [];
  const carried = new Set<string>();
  for (const tag of tags) {
    const sql = read(`${DRIZZLE_DIR}/${tag}.sql`);
    if (sql !== null) carried.add(executableSql(sql));
  }
  return required.filter((name) => {
    const sql = read(`${SUPABASE_DIR}/${name}`);
    return sql === null || !carried.has(executableSql(sql));
  });
}

/** Wpis dziennika drizzle (`meta/_journal.json`) w zakresie, którego potrzebuje bramka. */
export interface JournalEntry {
  readonly idx: number;
  readonly when: number;
  readonly tag: string;
}

/**
 * Tagi wpisów, których `when` nie jest późniejsze od NAJPÓŹNIEJSZEGO `when`
 * wcześniejszych wpisów (tak liczy migrator: względem najnowszej zastosowanej).
 */
export function nonMonotonicJournal(entries: readonly JournalEntry[]): string[] {
  const out: string[] = [];
  let prev = Number.NEGATIVE_INFINITY;
  for (const e of entries) {
    if (e.when <= prev) out.push(e.tag);
    prev = Math.max(prev, e.when);
  }
  return out;
}

export interface LaneGateResult {
  /** Naruszenia rejestru spoza listy znanych sierot - czerwienią CI. */
  readonly fresh: readonly LaneViolation[];
  /** Znane sieroty, które już nie są naruszeniem - do usunięcia z listy. */
  readonly stale: readonly string[];
  /** Wpisy dziennika z niemonotonicznym `when` spoza listy znanych - czerwienią CI. */
  readonly journalFresh: readonly string[];
  /** Znane odstępstwa kolejności, których już nie ma - do usunięcia z listy. */
  readonly journalStale: readonly string[];
  /** Wpisy dziennika bez pliku `.sql` - migrator wywróci się na nich przy wdrożeniu. */
  readonly missingFiles: readonly string[];
  /** Wymagane poprawki (`REQUIRED_PRODUCTION_TWINS`) bez nośnika w dzienniku - czerwienią CI. */
  readonly missingCarriers: readonly string[];
}

export interface LaneGateKnown {
  readonly orphans: readonly string[];
  readonly nonMonotonic: readonly string[];
  /** Domyślnie pusta - testy jednostkowe nie dziedziczą listy z repozytorium. */
  readonly requiredTwins?: readonly string[];
}

/** Ocena bramki: raport rejestru + kolejność dziennika względem list znanych przypadków. */
export function evaluateLaneGate(
  report: LaneReport,
  journal: readonly JournalEntry[],
  known: LaneGateKnown = {
    orphans: KNOWN_ORPHAN_LANE_ENTRIES,
    nonMonotonic: KNOWN_NON_MONOTONIC_JOURNAL,
    requiredTwins: REQUIRED_PRODUCTION_TWINS,
  },
  read: ReadFile = readFileOrNull,
): LaneGateResult {
  const orphans = new Set(known.orphans);
  const fresh = report.violations.filter(
    (v) => !(v.kind === "wpis-bez-pliku" && orphans.has(v.tag)),
  );
  const still = new Set(
    report.violations.filter((v) => v.kind === "wpis-bez-pliku").map((v) => v.tag),
  );
  const stale = known.orphans.filter((tag) => !still.has(tag));
  const disordered = nonMonotonicJournal(journal);
  const knownDisorder = new Set(known.nonMonotonic);
  const journalFresh = disordered.filter((tag) => !knownDisorder.has(tag));
  const journalStale = known.nonMonotonic.filter((tag) => !disordered.includes(tag));
  // analyzeMigrationLanes pomija wpis z decyzją, gdy pliku nie ma - tu to łapiemy.
  const tags = journal.map((e) => e.tag);
  const missingFiles = tags.filter((tag) => read(`${DRIZZLE_DIR}/${tag}.sql`) === null);
  const missingCarriers = missingProductionCarriers(tags, known.requiredTwins ?? [], read);
  return { fresh, stale, journalFresh, journalStale, missingFiles, missingCarriers };
}

export function laneGateFailed(result: LaneGateResult): boolean {
  return (
    result.fresh.length > 0 ||
    result.stale.length > 0 ||
    result.journalFresh.length > 0 ||
    result.journalStale.length > 0 ||
    result.missingFiles.length > 0 ||
    result.missingCarriers.length > 0
  );
}

/** Rada dla kinda naruszenia, drukowana raz pod listą; `wpis-bez-pliku` niesie radę w wierszu. */
const LANE_REMEDY: Partial<Record<LaneViolationKind, string>> = {
  "brak-wpisu":
    "dopisz wpis do MIGRATION_LANES w src/lib/ci/migrationLaneParity.ts - `twin` (plik supabase o tym samym SQL-u) albo `drizzleOnly` z powodem; dotyczy wyłącznie historii do JOURNAL_FREEZE_IDX.",
  "wpis-spoza-zrodla": `adoptuj wpis wg docs/RUNBOOK_MIGRACJE_LOVABLE.md §5 (nowy plik ${SUPABASE_DIR} o tym samym SQL-u wykonywalnym); rejestru MIGRATION_LANES nie rozszerzamy. Gdy tego SQL-a nie da się wykonać na bazie z pasa supabase: idempotentny odpowiednik w ${SUPABASE_DIR} i podniesienie JOURNAL_FREEZE_IDX z decyzją \`drizzleOnly\` w przeglądanym PR.`,
  "rejestr-zamrozony":
    "usuń wpis z MIGRATION_LANES - po JOURNAL_FREEZE_IDX decyduje treść wpisu dziennika, a jedyną furtką jest podniesienie JOURNAL_FREEZE_IDX w przeglądanym PR.",
};

export function renderLaneGate(report: LaneReport, result: LaneGateResult): string {
  const records = report.deployRecords.length;
  const knownOrphans = report.violations.length - result.fresh.length;
  const head = `Pasy migracji: ${report.checked} wpisów dziennika drizzle (${report.twins} z bliźniakiem, ${report.drizzleOnly} świadomie bez, ${records} zapisów wdrożenia rozpoznanych po treści, ${report.deployTriggers.length} wyzwalaczy wdrożenia, ${report.deployMarkers.length} znaczników wdrożenia, ${knownOrphans} znanych sierot spoza dziennika; od wpisu ${JOURNAL_FREEZE_IDX + 1} decyduje treść, nie rejestr).`;
  const lines = [`${laneGateFailed(result) ? "✗" : "✓"} ${head}`];
  if (result.fresh.length > 0) {
    lines.push(`NOWE NARUSZENIA REJESTRU (${result.fresh.length}):`);
    for (const v of result.fresh)
      lines.push(
        v.kind === "wpis-bez-pliku"
          ? `  [${v.kind}] ${v.tag}: wpis MIGRATION_LANES dla tagu spoza _journal.json (migrator go nie wykona) - usuń wpis albo dopisz plik do dziennika.`
          : `  [${v.kind}] ${v.tag}: ${v.detail}`,
      );
    for (const kind of new Set(result.fresh.map((v) => v.kind))) {
      const remedy = LANE_REMEDY[kind];
      if (remedy) lines.push(`  Naprawa: ${remedy}`);
    }
  }
  if (result.missingFiles.length > 0) {
    lines.push(
      `WPISY DZIENNIKA BEZ PLIKU (${result.missingFiles.length}) - migrator wywróci się przy wdrożeniu:`,
    );
    for (const t of result.missingFiles) lines.push(`  ${DRIZZLE_DIR}/${t}.sql`);
  }
  if (result.missingCarriers.length > 0) {
    lines.push(
      `POPRAWKI BEZ NOŚNIKA NA PASIE PRODUKCYJNYM (${result.missingCarriers.length}) - migrator drizzle ich nie wykona:`,
    );
    for (const t of result.missingCarriers) lines.push(`  ${SUPABASE_DIR}/${t}`);
    lines.push(
      "  Naprawa: bun run migrations:mirror - generator dopisze kopię do dziennika drizzle (nie pisz jej ręcznie).",
    );
  }
  if (result.journalFresh.length > 0) {
    lines.push(`NIEMONOTONICZNY DZIENNIK (${result.journalFresh.length}):`);
    for (const t of result.journalFresh)
      lines.push(
        `  ${t}: \`when\` nie jest późniejsze od poprzedniego wpisu - migrator drizzle pominie go na bazie, która zastosowała już nowszy wpis.`,
      );
    lines.push(
      "  Naprawa: git checkout origin/main -- drizzle/migrations/meta && bun run migrations:mirror (generator usuwa osierocone wpisy gałęzi i dopisuje je za ostatnim wpisem main, z `when` większym od jego maksimum).",
    );
  }
  for (const [heading, list] of [
    [
      `ZNANE SIEROTY, KTÓRE ZNIKNĘŁY - usuń je z KNOWN_ORPHAN_LANE_ENTRIES (${result.stale.length}):`,
      result.stale,
    ],
    [
      `ZNANE ODSTĘPSTWA KOLEJNOŚCI, KTÓRYCH JUŻ NIE MA - usuń je z KNOWN_NON_MONOTONIC_JOURNAL (${result.journalStale.length}):`,
      result.journalStale,
    ],
    [
      `UWAGA - ZNACZNIKI WDROŻENIA SPOZA KANONU (${report.deployMarkers.length}, bez czerwieni): same COMMENT ON, więc schemat i uprawnienia bez zmian, ale komentarz na produkcji różni się od ${SUPABASE_DIR}; kanoniczny wyzwalacz to ${DEPLOY_TRIGGER_SQL}`,
      report.deployMarkers,
    ],
    [
      `UWAGA - WPISY BEZ SQL-A WYKONYWALNEGO (${report.emptyEntries.length}, bez czerwieni): same komentarze (np. szablon drizzle-kit generate --custom) - migrator wykona pusty plik, więc to no-op`,
      report.emptyEntries,
    ],
    [
      `ZBĘDNE WPISY MIGRATION_LANES (${report.redundantRegistry.length}, bez czerwieni): rejestr jest zamrożony, a te wpisy bramka rozpoznaje po treści - usuń je`,
      report.redundantRegistry,
    ],
  ] as const) {
    if (list.length === 0) continue;
    lines.push(heading);
    for (const t of list) lines.push(`  ${t}`);
  }
  return lines.join("\n");
}
