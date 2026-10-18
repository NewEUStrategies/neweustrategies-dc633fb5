// Bramka dwóch pasów migracji: każdy plik w `drizzle/migrations/` ma w rejestrze
// DECYZJĘ - albo bliźniaka w `supabase/migrations/` o tym samym SQL-u, albo jawny
// powód, dla którego bliźniaka nie ma.
//
// PRZYCZYNA ŹRÓDŁOWA. Repozytorium ma DWA pasy migracji i oba jadą na produkcję,
// co `docs/MAIN_RECOVERY_2026-09-12.md` mówi wprost: „Drizzle i Supabase mają
// odrębne rejestry; samo wykonanie `0002` w Drizzle nie dowodzi obecności wersji
// w rejestrze Supabase". Cała warstwa dowodowa repozytorium patrzy jednak
// WYŁĄCZNIE na pas supabase: `MIGRATIONS_DIR = "supabase/migrations"`
// (scripts/lib/sqlMigrations.ts) zasila każdą bramkę `check:sql-*`, a bazę pgTAP
// stawia `supabase db start` z tego samego katalogu. Plik dołożony tylko do
// drizzle/ jest dla nich NIEWIDZIALNY.
//
// Tak przeszło `0001_profiles_discoverable_default_true`: przestawiło
// `profiles.discoverable` na DEFAULT true i przepisało wszystkie wiersze, podczas
// gdy pas supabase trzymał NOT NULL DEFAULT false, a późniejsza migracja opierała
// na tym argument prawny listy uczestników. Żadna bramka nie miała jak tego zobaczyć.
//
// CO ZNACZY „TEN SAM SQL". Pliki obu pasów NIE są bajt w bajt i nie taka jest
// konwencja - ZMIERZONE na wszystkich parach: pas supabase niesie długi nagłówek
// po polsku, pas drizzle zaczyna się od pierwszej instrukcji, a polskie znaki
// diakrytyczne w literałach `COMMENT ON` są w pasie drizzle złożone do ASCII
// („ktorego" wobec „którego"). Porównujemy więc SQL WYKONYWALNY: bez komentarzy,
// ze złożonymi diakrytykami, ze znormalizowaną spacją i z treścią literałów
// `COMMENT ON ... IS '...'` zastąpioną znacznikiem.
//
// CZEGO TA BRAMKA ŚWIADOMIE NIE ŁAPIE, powiedziane wprost: rozjazdu PROZY
// w literałach `COMMENT ON` (dziś realnie różni się tak para 0010). To
// dokumentacja zapisana w bazie - nie zmienia ani schematu, ani zachowania,
// a traktowanie jej na równi z DDL-em zapaliłoby bramkę na każdej poprawce
// literówki i skończyło się jej wyłączeniem.
//
// DLACZEGO REJESTR, A NIE REGUŁA „każdy plik musi mieć bliźniaka". Bo to
// nieprawda: dwa pliki pasa drizzle powstały jako operacje jednorazowe na
// produkcji i bliźniaka mieć nie powinny. Reguła, której stan faktyczny nie
// spełnia, zostaje wyłączona pierwszego dnia. Rejestr wymusza coś słabszego, ale
// wykonalnego: KAŻDY nowy plik w drizzle/ wymaga świadomego wpisu - wskazania
// bliźniaka albo napisania, czemu go nie ma. Nie da się już dołożyć pliku po cichu.
//
// KIERUNEK ODWROTNY (supabase -> dziennik drizzle) pilnuje osobna sekcja na
// końcu pliku: `analyzeSupabaseCoverage` i rejestr SUPABASE_LANE_GAPS.
import { readFileSync, readdirSync } from "node:fs";

export const DRIZZLE_DIR = "drizzle/migrations";
export const SUPABASE_DIR = "supabase/migrations";

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
 * Rejestr pasów. Kolejność jak w `drizzle/migrations/meta/_journal.json`.
 *
 * Dopisanie pliku do `drizzle/migrations/` BEZ wpisu tutaj zapala bramkę - i o to
 * chodzi. `drizzleOnly` nie jest wytrychem: to zdanie, które ktoś musi napisać
 * i podpisać w przeglądzie, a nie domyślne zachowanie.
 */
export const MIGRATION_LANES: readonly LaneEntry[] = [
  {
    tag: "0000_search_people_super_admin_bypass",
    twin: "20260911160000_search_people_super_admin_bypass.sql",
  },
  {
    tag: "0001_profiles_discoverable_default_true",
    drizzleOnly:
      "Regresja prywatności zastosowana wyłącznie na tym pasie - przestawiła profiles.discoverable na DEFAULT true i przepisała wszystkie wiersze. Pas supabase NIE dostaje bliźniaka: oba pasy jadą na produkcję, więc skopiowanie tego pliku uruchomiłoby jego hurtowy UPDATE DRUGI RAZ i ponownie przestawiło każdego, kto od tamtej pory się wypisał. Stan naprawia forward-only 0011 (DEFAULT false) obecne w OBU pasach. Pliku nie usuwamy - repozytorium jest forward-only, a usunięcie nie cofa tego, co już zastosowane.",
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
      "Pola karty prelegenta w admin_event_speakers_list (bio_*, topics_*, languages, liczniki) wgrane przez narzędzie bazodanowe; brak bliźniaka supabase.",
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
];

export type LaneViolationKind = "brak-wpisu" | "wpis-bez-pliku" | "brak-blizniaka" | "rozjazd-sql";

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

/**
 * Porównuje pas drizzle z rejestrem i - dla wpisów z bliźniakiem - z pasem supabase.
 *
 * `tags` to nazwy plików `.sql` z `drizzle/migrations/` BEZ rozszerzenia, czyli
 * dokładnie `tag` z dziennika drizzle.
 *
 * ZAPIS WDROŻENIA BEZ WPISU. Panel Lovable wdraża migrację, dopisując do pasa
 * drizzle KOPIĘ pliku (`0071_event_scanner_offline` = 20260926150000) - przy
 * wdrożeniu plik po pliku to kilkadziesiąt kopii, a każda bez wpisu zapalała
 * bramkę na `main`, choć niczego nie ukrywa. Przed tym, co ta bramka łapie
 * (SQL widoczny tylko w pasie drizzle, niewidoczny dla bramek `check:sql-*`),
 * chroni sama treść: plik, którego SQL WYKONYWALNY jest identyczny z plikiem
 * `supabase/migrations/`, stoi w pasie kanonicznym. Taki plik przechodzi jako
 * `deployRecords` - raport wymienia go z nazwy i bliźniakiem, żeby wpis dało
 * się dopisać przy okazji. Różnica choćby o jedną instrukcję (np. kopia bez
 * `COMMENT ON`, jak 0066) nadal wymaga wpisu: to już jest decyzja człowieka.
 */
export function analyzeMigrationLanes(
  tags: readonly string[],
  entries: readonly LaneEntry[] = MIGRATION_LANES,
  read: ReadFile = readFileOrNull,
  listSupabase: ListSql = listSqlOrEmpty,
): LaneReport {
  const byTag = new Map(entries.map((e) => [e.tag, e]));
  const violations: LaneViolation[] = [];
  const deployRecords: DeployRecord[] = [];
  let twins = 0;
  let drizzleOnly = 0;

  // Odcisk SQL-u wykonywalnego -> pierwszy plik pasa supabase (w kolejności
  // wersji). Liczony leniwie: tylko gdy jest plik bez wpisu.
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

  return { checked: tags.length, twins, drizzleOnly, deployRecords, violations };
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
}

export interface LaneGateKnown {
  readonly orphans: readonly string[];
  readonly nonMonotonic: readonly string[];
}

/** Ocena bramki: raport rejestru + kolejność dziennika względem list znanych przypadków. */
export function evaluateLaneGate(
  report: LaneReport,
  journal: readonly JournalEntry[],
  known: LaneGateKnown = {
    orphans: KNOWN_ORPHAN_LANE_ENTRIES,
    nonMonotonic: KNOWN_NON_MONOTONIC_JOURNAL,
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
  const missingFiles = journal
    .map((e) => e.tag)
    .filter((tag) => read(`${DRIZZLE_DIR}/${tag}.sql`) === null);
  return { fresh, stale, journalFresh, journalStale, missingFiles };
}

export function laneGateFailed(result: LaneGateResult): boolean {
  return (
    result.fresh.length > 0 ||
    result.stale.length > 0 ||
    result.journalFresh.length > 0 ||
    result.journalStale.length > 0 ||
    result.missingFiles.length > 0
  );
}

export function renderLaneGate(report: LaneReport, result: LaneGateResult): string {
  const records = report.deployRecords.length;
  const knownOrphans = report.violations.length - result.fresh.length;
  const head = `Pasy migracji: ${report.checked} wpisów dziennika drizzle (${report.twins} z bliźniakiem, ${report.drizzleOnly} świadomie bez, ${records} zapisów wdrożenia rozpoznanych po treści, ${knownOrphans} znanych sierot spoza dziennika).`;
  if (!laneGateFailed(result)) return `✓ ${head}`;
  const lines = [`✗ ${head}`];
  if (result.fresh.length > 0) {
    lines.push(`NOWE NARUSZENIA REJESTRU (${result.fresh.length}):`);
    for (const v of result.fresh)
      lines.push(
        v.kind === "wpis-bez-pliku"
          ? `  [${v.kind}] ${v.tag}: wpis MIGRATION_LANES dla tagu spoza _journal.json (migrator go nie wykona) - usuń wpis albo dopisz plik do dziennika.`
          : `  [${v.kind}] ${v.tag}: ${v.detail}`,
      );
    lines.push(
      "  Naprawa: dopisz wpis do MIGRATION_LANES w src/lib/ci/migrationLaneParity.ts - `twin` (plik supabase o tym samym SQL-u) albo `drizzleOnly` z powodem.",
    );
  }
  if (result.missingFiles.length > 0) {
    lines.push(
      `WPISY DZIENNIKA BEZ PLIKU (${result.missingFiles.length}) - migrator wywróci się przy wdrożeniu:`,
    );
    for (const t of result.missingFiles) lines.push(`  ${DRIZZLE_DIR}/${t}.sql`);
  }
  if (result.journalFresh.length > 0) {
    lines.push(`NIEMONOTONICZNY DZIENNIK (${result.journalFresh.length}):`);
    for (const t of result.journalFresh)
      lines.push(
        `  ${t}: \`when\` nie jest późniejsze od poprzedniego wpisu - migrator drizzle pominie go na bazie, która zastosowała już nowszy wpis.`,
      );
    lines.push(
      "  Naprawa: przenumeruj wpis na koniec dziennika z `when` późniejszym od ostatniego wpisu main i od ostatniej migracji zastosowanej na produkcji.",
    );
  }
  for (const [label, list] of [
    ["ZNANE SIEROTY, KTÓRE ZNIKNĘŁY - usuń je z KNOWN_ORPHAN_LANE_ENTRIES", result.stale],
    [
      "ZNANE ODSTĘPSTWA KOLEJNOŚCI, KTÓRYCH JUŻ NIE MA - usuń je z KNOWN_NON_MONOTONIC_JOURNAL",
      result.journalStale,
    ],
  ] as const) {
    if (list.length === 0) continue;
    lines.push(`${label} (${list.length}):`);
    for (const t of list) lines.push(`  ${t}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// KIERUNEK ODWROTNY: KAŻDY PLIK PASA SUPABASE MA KOPIĘ W DZIENNIKU DRIZZLE.
//
// Wszystko wyżej pilnuje kierunku drizzle -> supabase: plik dołożony tylko do
// drizzle/ nie przejdzie po cichu. Kierunku supabase -> drizzle nie pilnowało
// nic, a to on decyduje o produkcji: od startu pasa drizzle (jego pierwszy
// wpis, 0000_search_people_super_admin_bypass, to bliźniak 20260911160000)
// produkcja wykonuje WYŁĄCZNIE `_journal.json`
// (docs/PROMPT_ZAPROSZENIE_GRANICA_NAJEMCY.md, „Migracja w obu pasach";
// docs/WDROZENIE_KOD_KWOTOWY_NA_BILET_2026-09-26.md, sekcja 1). Plik leżący
// tylko w supabase/ przechodzi pgTAP i każdą bramkę `check:sql-*` - i nigdy
// nie trafia na produkcję.
//
// Tak przepadło 20261007140300_subscriptions_tenant_from_owner: wyzwalacz
// przypinający `subscriptions.tenant_id` do najemcy WŁAŚCICIELA, bez którego
// webhook płatności pod rolą serwisową zapisuje subskrypcję do najemcy
// DOMYŚLNEGO (ten widzi cudze, właściwy - żadnej). pgTAP był zielony, bo baza
// testowa ma ten plik; na produkcję nie trafił, bo w dzienniku nie było jego
// kopii. Kopia przyszła dopiero jako 0305 (razem z 0306 dla
// 20261018100000_payment_webhook_events_follow_subscription_tenant).
//
// CO ZNACZY „POKRYTY". Plik supabase z wersją >= DRIZZLE_LANE_START jest
// pokryty, gdy:
//   (i)   plik któregoś WPISU DZIENNIKA ma ten sam SQL wykonywalny
//         (`executableSql` - ta sama miara co w kierunku prostym),
//   (ii)  wpis MIGRATION_LANES o tagu Z DZIENNIKA wskazuje go jako `twin`,
//   (iii) ma wpis w SUPABASE_LANE_GAPS: `coveredBy` (SQL wszedł do dziennika
//         w zestawieniu albo w pliku o innej treści - ZMIERZONE, nie
//         zadeklarowane) albo `pending` (ZNANY brak).
//
// DLACZEGO (ii) TYLKO DLA TAGÓW Z DZIENNIKA. Dziesięć wpisów `twin` należy do
// sierot spoza `_journal.json` (KNOWN_ORPHAN_LANE_ENTRIES, np.
// 0060_event_seating_part3) - migrator ich nie wykona, więc o produkcji nie
// dowodzą niczego. Tamte pliki supabase mają w rejestrze `coveredBy`
// wskazujące kopię, która JEST w dzienniku (0094 itd.).
//
// DLACZEGO `pending` NIE CZERWIENI CI. W dniu włączenia 23 pliki nie mają
// w dzienniku żadnego śladu, a repozytorium nie zawiera niczego, co mówiłoby,
// czy produkcja je ma (mogły pójść z panelu, ręcznie albo wcale). Bramka
// czerwona od pierwszego dnia zostaje wyłączona; bramka, która milczy,
// powtarza incydent. Stąd środek: lista jest jawna, KAŻDY przebieg drukuje ją
// głośno z powodem, a NOWY plik bez kopii czerwieni CI od razu. Port do
// dziennika zamienia wpis w nieaktualny (bramka każe go usunąć), a test
// pilnuje, że lista tylko maleje.
// ---------------------------------------------------------------------------

/** Wersja pierwszego pliku supabase, którego bliźniak otwiera dziennik drizzle. */
export const DRIZZLE_LANE_START = "20260911160000";

/** Wpis rejestru dla pliku supabase bez kopii 1:1 w dzienniku drizzle. */
export type SupabaseLaneGap =
  | {
      readonly file: string;
      /** Tagi `_journal.json`, którymi SQL tego pliku wszedł do pasa drizzle. */
      readonly coveredBy: readonly string[];
      /** Jak zmierzono pokrycie i czego - świadomie - w kopii nie ma. */
      readonly reason: string;
    }
  | {
      readonly file: string;
      /** Co robi migracja i czy jest krytyczna; CI drukuje to przy każdym przebiegu. */
      readonly pending: string;
    };

/**
 * Rejestr luk kierunku odwrotnego. Kolejność po nazwie pliku.
 *
 * `coveredBy` jest WYNIKIEM POMIARU (executableSql instrukcja po instrukcji,
 * 2026-10-18), a nie deklaracją: `reason` mówi, czego w kopii brakuje i czemu
 * to nie zmienia stanu bazy. `pending` to plik, którego w dzienniku nie ma
 * - zdanie mówi, co robi i czy dotyka bezpieczeństwa albo izolacji najemców.
 */
export const SUPABASE_LANE_GAPS: readonly SupabaseLaneGap[] = [
  {
    file: "20260912100000_member_crm_sync_recovery.sql",
    coveredBy: ["0002_pr350_member_crm_sync_and_chat_compat"],
    reason:
      "Wszystkie 11 instrukcji (z COMMENT ON) stoją w zestawieniu #350 bez zmian; 0002 łączy cztery pliki serii 20260912*, więc kopii 1:1 nie ma.",
  },
  {
    file: "20260912101000_chat_wallpaper_compatibility.sql",
    coveredBy: ["0002_pr350_member_crm_sync_and_chat_compat"],
    reason:
      "chat_set_appearance z REVOKE/GRANT jest w 0002 identyczne; brakuje tylko UPDATE conversations SET wallpaper = NULL WHERE wallpaper = 'soft', a to no-op na każdej bazie po 20260907194459 (sprzed startu pasa drizzle), którego zwalidowany CHECK conversations_wallpaper_check dopuszcza wyłącznie NULL, 'dots', 'lines' i 'none'.",
  },
  {
    file: "20260912102000_footer_youtube_profile.sql",
    pending:
      "Uzupełnia adresy YouTube, Instagram, LinkedIn i Spotify w widgecie stopki `ftr-social` (site_settings) - zmiana treści bez znaczenia dla bezpieczeństwa i izolacji najemców; 0002 tych czterech UPDATE nie zawiera, a żaden plik dziennika nie dotyka stopki.",
  },
  {
    file: "20260912103000_member_crm_grant_outbox.sql",
    coveredBy: ["0002_pr350_member_crm_sync_and_chat_compat"],
    reason: "Wszystkie 3 instrukcje stoją w zestawieniu #350 bez zmian.",
  },
  {
    file: "20260914090000_push_subscriptions_tenant_binding.sql",
    coveredBy: ["0018_pr365_tenant_follows_profile"],
    reason:
      "Pin push_subscriptions_pin_tenant, uzgodnienie wierszy i granty są w 0018 identyczne; brakuje wyłącznie bloku DO z RAISE NOTICE o sierotach (diagnostyka bez zapisu) oraz tg_profiles_repin_push_subscriptions z wyzwalaczem, które 20260914120000 i samo 0018 zdejmują (DROP TRIGGER/FUNCTION IF EXISTS).",
  },
  {
    file: "20260914120000_tenant_follows_profile.sql",
    coveredBy: ["0018_pr365_tenant_follows_profile"],
    reason:
      "Brakuje wyłącznie pośredniej wersji tg_profiles_repin_account_tenant(), którą nadpisuje CREATE OR REPLACE z 20260914200000 - 0018 niesie tę wersję końcową; reszta instrukcji jest identyczna.",
  },
  {
    file: "20260914140000_author_profiles_tenant_follows_profile.sql",
    coveredBy: ["0018_pr365_tenant_follows_profile"],
    reason:
      "Brakuje wyłącznie pośredniej wersji tg_profiles_repin_account_tenant(), którą nadpisuje CREATE OR REPLACE z 20260914200000 - 0018 niesie tę wersję końcową; reszta instrukcji jest identyczna.",
  },
  {
    file: "20260914160000_profile_cv_tenant_follows_profile.sql",
    coveredBy: ["0018_pr365_tenant_follows_profile"],
    reason:
      "Brakuje wyłącznie pośredniej wersji tg_profiles_repin_account_tenant(), którą nadpisuje CREATE OR REPLACE z 20260914200000 - 0018 niesie tę wersję końcową; reszta instrukcji jest identyczna.",
  },
  {
    file: "20260914180000_media_mentions_tenant_follows_profile.sql",
    coveredBy: ["0018_pr365_tenant_follows_profile"],
    reason:
      "Brakuje wyłącznie pośredniej wersji tg_profiles_repin_account_tenant(), którą nadpisuje CREATE OR REPLACE z 20260914200000 - 0018 niesie tę wersję końcową; reszta instrukcji jest identyczna.",
  },
  {
    file: "20260914200000_profile_graph_tenant_follows_profile.sql",
    coveredBy: ["0018_pr365_tenant_follows_profile"],
    reason:
      "Wszystkie 5 instrukcji, w tym końcowa wersja tg_profiles_repin_account_tenant(), stoją w 0018 bez zmian; 0018 to jeden plik dla całej serii 20260914*.",
  },
  {
    file: "20260914220000_endorse_skill_tenant_guard.sql",
    coveredBy: ["0018_pr365_tenant_follows_profile"],
    reason:
      "Wszystkie 3 instrukcje stoją w 0018 bez zmian; 0018 to jeden plik dla całej serii 20260914*.",
  },
  {
    file: "20260915090000_legal_document_versions_compliance_pack_keys.sql",
    pending:
      "Poszerza CHECK `legal_document_versions.doc_key` o dziesięć kluczy pakietu zgodności 2026-09 (bez tego zapis i publikacja wersji nowych dokumentów prawnych z panelu kończą się błędem 23514) - zgodność prawna i działanie panelu, nie bezpieczeństwo ani izolacja najemców; żaden plik dziennika nie dotyka legal_document_versions.",
  },
  {
    file: "20260926090000_event_organizer_foundation.sql",
    coveredBy: ["0066_event_organizer_foundation"],
    reason:
      "Wpis `twin` (0056_event_organizer_foundation) to sierota spoza _journal.json; do dziennika SQL wszedł jako 0066 - wszystkie 25 instrukcji poza COMMENT ON identyczne.",
  },
  {
    file: "20260926153200_event_participant_defect_fixes.sql",
    coveredBy: [
      "0075_event_participant_defect_fixes_agenda",
      "0067_event_registration_gaps_part3",
      "0070_event_registration_gaps_part3_part3",
    ],
    reason:
      "Sekcja 1 (event_my_agenda z grantami i komentarzem) jest w 0075 identyczna; sekcje 2-3 (payments_apply_event_ticket_outcome, _event_apply_outcome_to_group) mają w 0070 i 0067 nowsze ciała z tymi samymi REVOKE/GRANT - to bliźnięta 20260926180002 i 20260926180000, które także w pasie supabase nadpisują te funkcje później.",
  },
  {
    file: "20260927000402_event_seating_part3.sql",
    coveredBy: ["0094_event_seating_part3"],
    reason:
      "Wpis `twin` (0060_event_seating_part3) to sierota spoza _journal.json; do dziennika SQL wszedł jako 0094 - wszystkie 27 instrukcji poza COMMENT ON identyczne.",
  },
  {
    file: "20260927000500_event_sponsor_report.sql",
    coveredBy: ["0095_event_sponsor_report"],
    reason:
      "Wpis `twin` (0061_event_sponsor_report) to sierota spoza _journal.json; do dziennika SQL wszedł jako 0095 - wszystkie 52 instrukcje poza COMMENT ON identyczne.",
  },
  {
    file: "20260927000501_event_sponsor_report_part2.sql",
    coveredBy: ["0096_event_sponsor_report_part2"],
    reason:
      "Wpis `twin` (0061_event_sponsor_report_part2) to sierota spoza _journal.json; do dziennika SQL wszedł jako 0096 - wszystkie 18 instrukcji poza COMMENT ON identyczne.",
  },
  {
    file: "20260927000800_event_clone.sql",
    coveredBy: ["0097_event_clone"],
    reason:
      "Wpis `twin` (0064_event_clone) to sierota spoza _journal.json; do dziennika SQL wszedł jako 0097 - wszystkie 39 instrukcji poza COMMENT ON identyczne.",
  },
  {
    file: "20260927000802_event_clone_part3.sql",
    coveredBy: ["0099_event_clone_part3"],
    reason:
      "Wpis `twin` (0064_event_clone_part3) to sierota spoza _journal.json; do dziennika SQL wszedł jako 0099 - wszystkie 24 instrukcje poza COMMENT ON identyczne.",
  },
  {
    file: "20260927001100_event_ads_funnel_review_fixes.sql",
    coveredBy: ["0101_event_ads_funnel_review_fixes"],
    reason:
      "Wpis `twin` (0073_event_ads_funnel_review_fixes) to sierota spoza _journal.json; do dziennika SQL wszedł jako 0101 - wszystkie 24 instrukcje poza COMMENT ON identyczne.",
  },
  {
    file: "20260927001200_event_seating_review_fixes.sql",
    coveredBy: ["0102_event_seating_review_fixes"],
    reason:
      "Wpis `twin` (0074_event_seating_review_fixes) to sierota spoza _journal.json; do dziennika SQL wszedł jako 0102 - wszystkie 18 instrukcji poza COMMENT ON identyczne.",
  },
  {
    file: "20260927001300_event_clone_participant_settings.sql",
    coveredBy: ["0103_event_clone_participant_settings"],
    reason:
      "Wpis `twin` (0075_event_clone_participant_settings) to sierota spoza _journal.json; do dziennika SQL wszedł jako 0103 - wszystkie 18 instrukcji poza COMMENT ON identyczne.",
  },
  {
    file: "20260927001400_event_person_crm_intents.sql",
    coveredBy: ["0104_event_person_crm_intents"],
    reason:
      "Wpis `twin` (0076_event_person_crm_intents) to sierota spoza _journal.json; do dziennika SQL wszedł jako 0104 - wszystkie 11 instrukcji poza COMMENT ON identyczne.",
  },
  {
    file: "20261003170000_club_cover_write_follows_capabilities.sql",
    coveredBy: ["0140_club_cover_write_follows_capabilities"],
    reason:
      "Te same instrukcje co 0140 bez pięciu COMMENT ON FUNCTION; poza tym różni je wyłącznie spacja przy nawiasach (`( bucket_id` wobec `(bucket_id`) w ciele club_can_edit_cover i w czterech politykach storage, co nie zmienia ani schematu, ani zachowania.",
  },
  {
    file: "20261007100000_club_post_comments.sql",
    pending:
      "Komentarze wpisów ściany klubu (`club_post_comments`, RPC, moderacja, pseudonimy Chatham House, `club_user_can_read`) oraz `club_posts_list` filtrujące strumień całego klubu prawem odczytu działu wpisu - nowa funkcja z poprawką dostępu, krytyczna dla poufności działów klubu.",
  },
  {
    file: "20261007100100_club_post_mentions_and_link_validation.sql",
    pending:
      "Bramka odbiorców @wzmianek liczona prawem ODBIORCY, wzmianki we wpisach i komentarzach ściany, podpowiedzi członków, walidacja załączników-linków i zamknięcie gościowi działów klubu publicznego o widoczności members/private/secret - krytyczne dla poufności treści klubów (wyciek przez powiadomienia i przez odczyt gościa).",
  },
  {
    file: "20261007120000_event_package_order_company_not_from_payload.sql",
    pending:
      "`event_package_purchase` przestaje brać `company_id` zamówienia z ładunku kupującego (`forbidden_field`) - krytyczne: dowolna firma z kartoteki CRM najemcy trafiała do zamówienia, a błąd 23503 był wyrocznią istnienia identyfikatorów firm; najnowsze ciało tej funkcji w dzienniku (0118/0119, czyli 20261001210000) jest sprzed poprawki.",
  },
  {
    file: "20261007120100_ad_slots_private_notes.sql",
    pending:
      "Odbiera `anon` i `authenticated` odczyt kolumny `ad_slots.notes` (SELECT kolumnowy zamiast tabelowego) i dodaje `admin_list_ad_slots()` dla panelu - krytyczne dla poufności: bez tego `GET /rest/v1/ad_slots?select=notes` z kluczem publicznym oddaje każdemu gościowi notatki operatora.",
  },
  {
    file: "20261007120200_plan_coupon_server_only.sql",
    pending:
      "Walidacja i realizacja kodów planu (`validate_b2b_coupon`, `redeem_b2b_coupon`) tylko dla `service_role` z jawną tożsamością i kubełkiem pudeł po adresie, bez INSERT klienta na `b2b_coupon_redemptions` - krytyczne: zalogowany omijał limit prób po adresie i zużywał pulę kodu bez zamówienia.",
  },
  {
    file: "20261007120300_client_grants_follow_ts_callers.sql",
    pending:
      "Granty zgodne z wywołaniami z TS: DELETE na `conversations` dla `authenticated` (przycisk panelu czatu) oraz odebranie klientom EXECUTE `join_us_link_and_backfill` i `enforce_form_field_policy` - krytyczne dla izolacji: zalogowany przepinał dowolną subskrypcję newslettera na dowolne konto, a anon czytał politykę pól formularzy dowolnego najemcy.",
  },
  {
    file: "20261007120400_content_password_explicit_tenant.sql",
    pending:
      "Odblokowanie treści hasłem tylko z serwera (`verify_content_password_for_tenant`, `service_role`) z jawnym najemcą i skrótem adresu - krytyczne: PostgREST wprost omijał limit prób po adresie, a pod rolą serwisową funkcja liczyła najemcę domyślnego.",
  },
  {
    file: "20261007120500_service_only_rpc_default_execute.sql",
    pending:
      "Zdejmuje domyślne EXECUTE `anon` i `authenticated` z `org_apply_subscription_seats(text, integer)` i 10-argumentowego `crm_upsert_from_form` - krytyczne dla izolacji najemców: anon ustawiał limit miejsc cudzej organizacji i zakładał leady CRM w dowolnym najemcy.",
  },
  {
    file: "20261007120510_career_cv_gc_service_only.sql",
    pending:
      "Zostawia funkcje kolejki retencji CV (`career_cv_gc_scan/claim/done/fail`) wyłącznie `service_role` - obrona w głąb dla ścieżek plików CV kandydatów (ciało ma bramkę `is_super_admin`, więc to utwardzenie, nie otwarta dziura).",
  },
  {
    file: "20261007120600_event_codes_server_only.sql",
    pending:
      "Walidacja kodów wydarzeń, wycena wejścia i zakup pakietu tylko z serwera (`_require_server_identity`, funkcje `*_for_user`, kubełek pudeł po adresie) - krytyczne przeciw zgadywaniu kodów; pliki dziennika 0227, 0231, 0242, 0244 i 0288 już wołają `_require_server_identity`, zdefiniowaną wyłącznie tutaj.",
  },
  {
    file: "20261007140000_email_queue_service_only.sql",
    pending:
      "Zostawia wrappery kolejek pgmq `enqueue_email`, `read_email_batch` i `delete_email` wyłącznie `service_role` (`move_to_dlq` zamyka już 0236) - KRYTYCZNE: z kluczem publikowalnym dało się czytać kolejkę maili autoryzacyjnych (linki resetu hasła, czyli przejęcie konta) i wysyłać pocztę z domeny platformy.",
  },
  {
    file: "20261007140100_definer_functions_without_client_path.sql",
    pending:
      "Odbiera klientom EXECUTE na 42 sygnaturach funkcji SECURITY DEFINER bez ścieżki klienta (28 bez bramki w ciele, 13 wykonywalnych nawet dla anon, np. `_are_connected`, `auto_connect_experts`) - krytyczne dla bezpieczeństwa i izolacji najemców.",
  },
  {
    file: "20261007140200_release_coupon_server_only.sql",
    pending:
      "`release_b2b_coupon` tylko dla `service_role` i tylko dla nieopłaconego zamówienia tego konta w tym najemcy - krytyczne: zalogowany zerował licznik jednorazowego kodu po zapłacie i używał go bez ograniczeń.",
  },
  {
    file: "20261007140400_ticket_access_code_probe.sql",
    pending:
      "Limit prób kodów dostępu do biletów (`_access_code_probe_guard/_miss`, `event_ticket_checkout_quote` tylko dla `service_role`) - krytyczne przeciw zgadywaniu kodów prasy i partnerów; pliki dziennika 0190, 0230, 0232, 0241, 0246 i 0281 już wołają `_access_code_probe_guard/_miss`, zdefiniowane wyłącznie tutaj.",
  },
  {
    file: "20261007140500_crm_newsletter_writers_bound.sql",
    pending:
      "Wiąże zapisy CRM i newslettera z wołającym (`crm_upsert_lead_from_profile/_from_subscriber` tylko `service_role`, `crm_backfill_all_leads` w najemcy wołającego, `join_us_link_and_backfill` tylko dla wierszy bez właściciela) - KRYTYCZNE dla izolacji najemców: administrator najemcy A zakładał leady w CRM-ie najemcy B.",
  },
  {
    file: "20261007140600_event_functions_runtime_errors.sql",
    pending:
      "Naprawia cztery funkcje wydarzeń padające przy każdym wywołaniu (42703/42804: historia i lista uprawnień widowni, `event_my_package_orders`, kwalifikacja widowni akademickiej) - błąd działania, nie bezpieczeństwo.",
  },
  {
    file: "20261007140700_runtime_errors_seats_workflow_passwords.sql",
    pending:
      "Naprawia funkcje padające przy każdym wywołaniu (`org_apply_subscription_seats`, akcja `notify_followers` w `run_workflow_step`, hasła treści przez pgcrypto w `extensions`) i zawęża ustawianie hasła treści do wiersza najemcy wołającego - krytyczne dla izolacji: redaktor dowolnego najemcy nadpisywał hasło treści innego.",
  },
  {
    file: "20261007140710_club_application_crm_sync_overload.sql",
    pending:
      "`club_application_crm_sync` wskazuje jawnie 11-argumentowe przeciążenie `crm_upsert_from_form` (dotąd 42725 przy każdym zgłoszeniu do klubu i brak leada w CRM) - błąd działania, nie bezpieczeństwo.",
  },
  {
    file: "20261007140800_rate_limits_retention.sql",
    pending:
      "Retencja `rate_limits` (`rate_limits_prune` tylko dla `service_role`, pg_cron co godzinę) - chroni przed nieograniczonym wzrostem tabeli i kosztu każdego limitera, czyli dostępność, nie izolacja najemców.",
  },
  {
    file: "20261009100000_podcast_apple_connect_metadata_reapply.sql",
    pending:
      "Ponawia kolumny metadanych Apple Podcasts z 20260725090500 (`podcasts.explicit`, `podcast_shows.itunes_author` i inne), których brak nagłówek dokumentuje jako awarię /podcasts zmierzoną 2026-10-09 - dostępność treści, nie bezpieczeństwo.",
  },
  {
    file: "20261009110000_schema_column_contract_probe.sql",
    pending:
      "Sonda `missing_schema_columns(jsonb)` dla kontraktu kolumn po wdrożeniu (czyta wyłącznie katalog; EXECUTE dla `anon` i `service_role`) - narzędzie CI, nie bezpieczeństwo, ale bez niej `check:db-contract` nie widzi brakujących kolumn produkcji.",
  },
  {
    file: "20261011090000_menu_items_follow_categories.sql",
    coveredBy: ["0147_pr493_menu_category_links_test_pages_noindex"],
    reason:
      "Wszystkie 12 instrukcji stoją w 0147 bez zmian; 0147 łączy trzy pliki serii 20261011*, więc kopii 1:1 nie ma.",
  },
  {
    file: "20261011090100_event_seed_test_pages_noindex.sql",
    coveredBy: ["0147_pr493_menu_category_links_test_pages_noindex"],
    reason: "Wszystkie 4 instrukcje stoją w 0147 bez zmian; 0147 łączy trzy pliki serii 20261011*.",
  },
  {
    file: "20261011090200_unpublish_test_pages.sql",
    coveredBy: ["0147_pr493_menu_category_links_test_pages_noindex"],
    reason: "Wszystkie 4 instrukcje stoją w 0147 bez zmian; 0147 łączy trzy pliki serii 20261011*.",
  },
  {
    file: "20261012130300_payment_orders_purchase_shape_guard.sql",
    coveredBy: ["0170_payment_orders_shape_guard_and_free_ticket_settlement"],
    reason:
      "SQL wykonywalny tego pliku to pierwsza część 0170 (druga to 20261012130400) - jeden plik dziennika dla dwóch wersji.",
  },
  {
    file: "20261012130400_event_free_ticket_settlement.sql",
    coveredBy: ["0170_payment_orders_shape_guard_and_free_ticket_settlement"],
    reason:
      "SQL wykonywalny tego pliku to druga część 0170 (pierwsza to 20261012130300) - jeden plik dziennika dla dwóch wersji.",
  },
];

export type SupabaseCoverageViolationKind =
  | "brak-kopii-drizzle"
  | "pokrycie-spoza-dziennika"
  | "wpis-bez-pliku-supabase"
  | "nieaktualny-wpis";

export interface SupabaseCoverageViolation {
  readonly kind: SupabaseCoverageViolationKind;
  readonly file: string;
  readonly detail: string;
}

/** Znany brak w dzienniku drizzle - nie czerwieni CI, ale jest drukowany. */
export interface PendingSupabaseFile {
  readonly file: string;
  readonly pending: string;
}

export interface SupabaseCoverageReport {
  /** Pliki pasa supabase od DRIZZLE_LANE_START włącznie. */
  readonly checked: number;
  /** Pokryte kopią w dzienniku (i) albo wpisem `twin` o tagu z dziennika (ii). */
  readonly twins: number;
  /** Pokryte zestawieniem albo plikiem dziennika o innej treści (`coveredBy`). */
  readonly consolidated: number;
  readonly pending: readonly PendingSupabaseFile[];
  readonly violations: readonly SupabaseCoverageViolation[];
}

/** Wersja migracji supabase (14 cyfr przed `_`); `null` dla nazwy spoza konwencji CLI. */
export function supabaseMigrationVersion(file: string): string | null {
  return /^(\d{14})_/.exec(file)?.[1] ?? null;
}

/**
 * Kierunek odwrotny: czy każdy plik `supabase/migrations/` od DRIZZLE_LANE_START
 * jest w dzienniku drizzle - kopią (i), bliźniakiem z MIGRATION_LANES o tagu
 * z dziennika (ii) albo wpisem SUPABASE_LANE_GAPS (iii).
 *
 * `journalTags` to tagi `_journal.json` - TYLKO one jadą na produkcję, więc
 * sierota leżąca w drizzle/ bez wpisu w dzienniku niczego nie pokrywa.
 */
export function analyzeSupabaseCoverage(
  journalTags: readonly string[],
  gaps: readonly SupabaseLaneGap[] = SUPABASE_LANE_GAPS,
  read: ReadFile = readFileOrNull,
  listSupabase: ListSql = listSqlOrEmpty,
  lanes: readonly LaneEntry[] = MIGRATION_LANES,
): SupabaseCoverageReport {
  const inJournal = new Set(journalTags);
  // Odcisk SQL-u wykonywalnego -> pierwszy tag dziennika o tej treści.
  const journalBySql = new Map<string, string>();
  for (const tag of journalTags) {
    const text = read(`${DRIZZLE_DIR}/${tag}.sql`);
    if (text === null) continue; // wpis bez pliku łapie evaluateLaneGate
    const key = executableSql(text);
    if (key !== "" && !journalBySql.has(key)) journalBySql.set(key, tag);
  }
  const declaredTwins = new Set(
    lanes.flatMap((e) => ("twin" in e && inJournal.has(e.tag) ? [e.twin] : [])),
  );
  const gapByFile = new Map(gaps.map((g) => [g.file, g]));
  const all = listSupabase(SUPABASE_DIR);
  const inScope = all.filter((f) => {
    const version = supabaseMigrationVersion(f);
    return version !== null && version >= DRIZZLE_LANE_START;
  });

  const violations: SupabaseCoverageViolation[] = [];
  const pending: PendingSupabaseFile[] = [];
  let twins = 0;
  let consolidated = 0;

  for (const file of inScope) {
    const text = read(`${SUPABASE_DIR}/${file}`);
    const copy = text === null ? undefined : journalBySql.get(executableSql(text));
    const gap = gapByFile.get(file);
    if (copy !== undefined || declaredTwins.has(file)) {
      twins += 1;
      if (gap)
        violations.push({
          kind: "nieaktualny-wpis",
          file,
          detail: `Plik ma już ${copy !== undefined ? `kopię w dzienniku (${copy})` : "bliźniaka z MIGRATION_LANES w dzienniku"} - wpis SUPABASE_LANE_GAPS jest nieaktualny, usuń go.`,
        });
      continue;
    }
    if (!gap) {
      violations.push({
        kind: "brak-kopii-drizzle",
        file,
        detail: `Żaden wpis ${DRIZZLE_DIR}/meta/_journal.json nie ma tego SQL-u wykonywalnego - produkcja wykonuje wyłącznie dziennik drizzle, więc ta migracja na nią NIE trafi.`,
      });
      continue;
    }
    if ("pending" in gap) {
      pending.push({ file, pending: gap.pending });
      continue;
    }
    const outside = gap.coveredBy.filter((tag) => !inJournal.has(tag));
    if (gap.coveredBy.length === 0 || outside.length > 0) {
      violations.push({
        kind: "pokrycie-spoza-dziennika",
        file,
        detail:
          gap.coveredBy.length === 0
            ? "Wpis `coveredBy` jest pusty - nie wskazuje żadnego wpisu dziennika."
            : `\`coveredBy\` wskazuje tagi spoza _journal.json (${outside.join(", ")}) - migrator ich nie wykona, więc niczego nie pokrywają.`,
      });
      continue;
    }
    consolidated += 1;
  }

  const listed = new Set(all);
  const scoped = new Set(inScope);
  for (const gap of gaps) {
    if (!listed.has(gap.file))
      violations.push({
        kind: "wpis-bez-pliku-supabase",
        file: gap.file,
        detail: `Rejestr ma wpis dla ${gap.file}, ale pliku ${SUPABASE_DIR}/${gap.file} nie ma. Martwy wpis maskowałby brak pliku.`,
      });
    else if (!scoped.has(gap.file))
      violations.push({
        kind: "nieaktualny-wpis",
        file: gap.file,
        detail: `Plik jest sprzed startu pasa drizzle (${DRIZZLE_LANE_START}) - bramka go nie sprawdza, usuń wpis.`,
      });
  }

  return { checked: inScope.length, twins, consolidated, pending, violations };
}

export function supabaseCoverageFailed(report: SupabaseCoverageReport): boolean {
  return report.violations.length > 0;
}

/** Raport kierunku odwrotnego; znane braki drukuje ZAWSZE, także przy zielonym wyniku. */
export function renderSupabaseCoverage(report: SupabaseCoverageReport): string {
  const head = `Pokrycie pasa supabase w dzienniku drizzle: ${report.checked} plików od ${DRIZZLE_LANE_START} (${report.twins} z kopią w dzienniku, ${report.consolidated} w zestawieniach dziennika, ${report.pending.length} ZNANYCH BRAKÓW).`;
  const lines = [`${supabaseCoverageFailed(report) ? "✗" : "✓"} ${head}`];
  if (report.violations.length > 0) {
    lines.push(`NARUSZENIA POKRYCIA (${report.violations.length}):`);
    for (const v of report.violations) lines.push(`  [${v.kind}] ${v.file}: ${v.detail}`);
    lines.push(
      `  Naprawa: dołóż bliźniaka do ${DRIZZLE_DIR} (ten sam SQL wykonywalny) z wpisem w _journal.json, którego \`when\` przekracza maksimum dziennika; zestawienie albo świadomy brak opisz w SUPABASE_LANE_GAPS (src/lib/ci/migrationLaneParity.ts).`,
    );
  }
  if (report.pending.length > 0) {
    lines.push(
      `UWAGA - ZNANE BRAKI W DZIENNIKU DRIZZLE (${report.pending.length}). Produkcja wykonuje wyłącznie _journal.json, a nic w repozytorium nie dowodzi, że te migracje na niej są:`,
    );
    for (const p of report.pending) lines.push(`  ${p.file}: ${p.pending}`);
    lines.push(
      "  Port: bliźniak w drizzle/migrations + wpis w _journal.json; bramka poprosi wtedy o usunięcie wpisu z SUPABASE_LANE_GAPS.",
    );
  }
  return lines.join("\n");
}
