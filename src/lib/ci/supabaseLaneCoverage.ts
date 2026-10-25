// Bramka pasów migracji, KIERUNEK ODWROTNY: każdy plik `supabase/migrations/`
// od startu pasa drizzle ma kopię w dzienniku drizzle.
//
// MODEL (docs/RUNBOOK_MIGRACJE_LOVABLE.md). `supabase/migrations` jest jedynym
// źródłem prawdy, a `drizzle/` - lustrem generowanym przez
// `bun run migrations:mirror`. Produkcja (Lovable Cloud) dostaje schemat
// wyłącznie migratorem Drizzle, który narzędzie migracji Lovable uruchamia na
// `drizzle/migrations/meta/_journal.json`; plików przychodzących przez Git
// Lovable nie wykonuje. Plik leżący tylko w supabase/ przechodzi pgTAP i każdą
// bramkę `check:sql-*`, a na produkcję nie trafi, dopóki nie ma kopii w dzienniku.
// Kierunek prosty (`migrationLaneParity.ts`) pilnuje drugiej strony: wpisu
// dziennika bez źródła w supabase/.
//
// PRZYKŁAD LUKI. 20261007140300_subscriptions_tenant_from_owner (wyzwalacz
// przypinający `subscriptions.tenant_id` do najemcy WŁAŚCICIELA) do 2026-10-18
// nie miał kopii w dzienniku, więc repozytorium nie dowodziło, że jest na
// produkcji (mógł tam trafić narzędziem z panelu - tego nie wiadomo). pgTAP był
// zielony, bo baza testowa ma ten plik. Kopia weszła jako 0305 (razem z 0306
// dla 20261018100000_payment_webhook_events_follow_subscription_tenant),
// a webhook od tamtej pory wpisuje najemcę jawnie.
//
// CO ZNACZY „POKRYTY". Plik supabase z wersją >= DRIZZLE_LANE_START jest
// pokryty, gdy:
//   (i)   plik któregoś WPISU DZIENNIKA ma ten sam SQL wykonywalny
//         (`executableSql` - ta sama miara co w kierunku prostym); każdy wpis
//         pokrywa JEDEN plik, więc ponowny przebieg albo przywrócenie z tym
//         samym SQL-em co starszy plik potrzebuje własnej kopii
//         (przydział: `journalCopies`),
//   (ii)  wpis MIGRATION_LANES o tagu Z DZIENNIKA wskazuje go jako `twin`
//         (kierunek prosty pilnuje wtedy, że treść jest ta sama),
//   (iii) ma wpis w SUPABASE_LANE_GAPS: `coveredBy` (SQL wszedł do dziennika
//         w zestawieniu albo w pliku o innej treści) albo `appliedOutOfBand`
//         (plik spoza dziennika, patrz niżej).
// Plik bez pokrycia to `brak-kopii-drizzle` - i dokładnie te pliki generator
// lustra dopisuje do dziennika.
//
// `coveredBy` JEST MIERZONE PRZY KAŻDYM PRZEBIEGU, nie deklarowane: każda
// instrukcja pliku (poza `COMMENT ON`) musi stać w którymś ze wskazanych plików
// dziennika (`coverageStatements`). Instrukcję, której tam świadomie nie ma
// (pośrednia wersja funkcji nadpisanej później, diagnostyczne DO, no-op),
// wpis wymienia z początku w `uncovered` (do granicy słowa), a `reason` mówi,
// czemu to nie zmienia stanu bazy. Inaczej wpis z dowolnym tagiem dziennika
// zazieleniłby plik, którego treści w dzienniku nie ma. Zestawienie musi nieść
// choć jedną instrukcję pliku, a `uncovered` - jak `appliedOutOfBand` -
// przysługuje wyłącznie plikom z GAP_EXCEPTIONS_AT_GATE_START.
//
// DLACZEGO (ii) TYLKO DLA TAGÓW Z DZIENNIKA. Dziesięć wpisów `twin` należy do
// sierot spoza `_journal.json` (KNOWN_ORPHAN_LANE_ENTRIES, np.
// 0060_event_seating_part3) - migrator ich nie wykona, więc o produkcji nie
// dowodzą niczego. Tamte pliki supabase mają w rejestrze `coveredBy`
// wskazujące kopię, która JEST w dzienniku (0094 itd.).
//
// POZA DZIENNIKIEM (`appliedOutOfBand`). W dniu włączenia bramki (2026-10-18)
// 23 pliki nie miały w dzienniku żadnego śladu. (Stan 2026-10-25: 22 -
// `20261007140200` ma kopię `0309`.) Część z nich i tak jest na produkcji:
// src/integrations/supabase/types.ts, generowany z produkcji, zna ich obiekty
// (np. `_require_server_identity`, `admin_list_ad_slots`, `missing_schema_columns`),
// a pliki dziennika wołają funkcje zdefiniowane wyłącznie w nich
// (`_require_server_identity`, `_access_code_probe_guard`) - trafiły tam poza
// migratorem (z panelu albo narzędziem bazodanowym), bez dowodu treści grantów
// i ciał funkcji. Generator
// tych plików NIE wysyła i nie wyśle: stary plik wykonany ponownie w jednej
// transakcji migratora mógłby wywrócić całą dostawę albo cofnąć późniejsze
// zmiany tych samych obiektów. Stan produkcji domyka osobna, idempotentna
// migracja uzgadniająca (`reconciledBy` - późniejsza wersja, z kopią
// w dzienniku jak każdy nowy plik). Lista jest jawna, drukowana przy każdym
// przebiegu i ZAMKNIĘTA: `appliedOutOfBand` dla pliku spoza
// GAP_EXCEPTIONS_AT_GATE_START czerwieni CI (zbiór nazw, nie próg wersji), więc
// nowa migracja ma kopię z generatora albo zmierzone `coveredBy`.
//
// ZBIÓR SPRZED PASA JEST ZAMROŻONY (PRE_LANE_FREEZE). Bramka nie sprawdza
// plików sprzed DRIZZLE_LANE_START, więc nowy plik z cofniętą albo literówkową
// wersją (20260118… zamiast 20261018…) przeszedłby bokiem. Liczba i odcisk
// nazw plików spoza zakresu są wpisane na stałe - każdy nowy taki plik zmienia
// odcisk i czerwieni CI.
//
// KTÓRY WPIS POKRYWA KTÓRY PLIK (`journalCopies`). Sama treść nie wystarcza,
// gdy dwa pliki mają ten sam SQL wykonywalny (ponowny przebieg starszego pliku):
//   1. lustro generatora należy do pliku z SWOJEGO nagłówka (o ile SQL jest ten
//      sam) i nie pokrywa żadnego innego - inaczej starszy plik o tym samym
//      SQL-u (np. `appliedOutOfBand`) zabrałby lustro nowego, a generator
//      z bazą i `--check` bez bazy nie zgodziłyby się, czy lustro jest aktualne;
//   2. wpis bez nagłówka do JOURNAL_FREEZE_IDX (historia: kopie panelu, faza A)
//      - pliki w kolejności wersji, każdy bierze pierwszą wolną kopię; pliki
//      z SUPABASE_LANE_GAPS dopiero po pozostałych, z resztek (wtedy wpis rejestru
//      jest zbędny);
//   3. wpis bez nagłówka po zamrożeniu (adopcja wpisu bota albo jego ponowna
//      kopia) należy do NAJSTARSZEGO pliku o tym SQL-u: plik adopcji jest takim
//      plikiem z założenia, a ponowna kopia już niesionego pliku zostaje zbędna
//      i nie przykrywa późniejszego, świadomego ponownego przebiegu - ten
//      dostaje własne lustro.
//
// NIEAKTUALNY WPIS NIE CZERWIENI. Kopia może pojawić się na `main` bez zmiany
// tego pliku (lustro z innego PR albo adopcja wpisu bota Lovable). Wpis
// rejestru dla pliku, który właśnie zyskał kopię, jest wtedy zbędny - bramka
// drukuje go jako „do usunięcia", ale nie czerwieni `main`.
import { createHash } from "node:crypto";

import { mirrorSourceOf } from "../migrations/mirrorHeader";
import {
  DRIZZLE_DIR,
  JOURNAL_FREEZE_IDX,
  MIGRATION_LANES,
  SUPABASE_DIR,
  executableSql,
  listSqlOrEmpty,
  readFileOrNull,
  type LaneEntry,
  type ListSql,
  type ReadFile,
} from "./migrationLaneParity";
import { lexStatements } from "./migrationSplit";

/** Wersja pierwszego pliku supabase, którego bliźniak otwiera dziennik drizzle. */
export const DRIZZLE_LANE_START = "20260911160000";

/**
 * Pliki, którym w dniu włączenia bramki (2026-10-18) wolno mieć wyjątek:
 * `appliedOutOfBand` (22 pliki spoza dziennika; 23. - 20261007140200 - zyskał
 * od tamtej pory kopię 0309) albo `uncovered` (7 zestawień z instrukcjami
 * świadomie pominiętymi). Zbiór NAZW, nie próg wersji: port starszej migracji
 * pod dawną datą też nie dostanie cichego wyjątku. Zbiór tylko maleje - wyjątek
 * dla pliku spoza niego czerwieni CI (`zamkniety-rejestr`), więc nowa migracja
 * ma kopię w dzienniku albo zestawienie niosące każdą jej instrukcję.
 */
export const GAP_EXCEPTIONS_AT_GATE_START: ReadonlySet<string> = new Set([
  "20260912101000_chat_wallpaper_compatibility.sql",
  "20260912102000_footer_youtube_profile.sql",
  "20260914090000_push_subscriptions_tenant_binding.sql",
  "20260914120000_tenant_follows_profile.sql",
  "20260914140000_author_profiles_tenant_follows_profile.sql",
  "20260914160000_profile_cv_tenant_follows_profile.sql",
  "20260914180000_media_mentions_tenant_follows_profile.sql",
  "20260915090000_legal_document_versions_compliance_pack_keys.sql",
  "20260926153200_event_participant_defect_fixes.sql",
  "20261007100000_club_post_comments.sql",
  "20261007100100_club_post_mentions_and_link_validation.sql",
  "20261007120000_event_package_order_company_not_from_payload.sql",
  "20261007120100_ad_slots_private_notes.sql",
  "20261007120200_plan_coupon_server_only.sql",
  "20261007120300_client_grants_follow_ts_callers.sql",
  "20261007120400_content_password_explicit_tenant.sql",
  "20261007120500_service_only_rpc_default_execute.sql",
  "20261007120510_career_cv_gc_service_only.sql",
  "20261007120600_event_codes_server_only.sql",
  "20261007140000_email_queue_service_only.sql",
  "20261007140100_definer_functions_without_client_path.sql",
  "20261007140400_ticket_access_code_probe.sql",
  "20261007140500_crm_newsletter_writers_bound.sql",
  "20261007140600_event_functions_runtime_errors.sql",
  "20261007140700_runtime_errors_seats_workflow_passwords.sql",
  "20261007140710_club_application_crm_sync_overload.sql",
  "20261007140800_rate_limits_retention.sql",
  "20261009100000_podcast_apple_connect_metadata_reapply.sql",
  "20261009110000_schema_column_contract_probe.sql",
]);

/** Liczba i odcisk nazw plików supabase spoza zakresu bramki (sprzed pasa). */
export interface PreLaneFreeze {
  readonly count: number;
  readonly digest: string;
}

/** Zamrożony zbiór plików sprzed DRIZZLE_LANE_START (i o nazwie spoza konwencji). */
export const PRE_LANE_FREEZE: PreLaneFreeze = {
  count: 951,
  digest: "e1a87947c38cef519781a2f3e1ffe31e42a81cc6fa6e260b5eb870b5c26172a2",
};

/** Wpis rejestru dla pliku supabase bez kopii 1:1 w dzienniku drizzle. */
export type SupabaseLaneGap =
  | {
      readonly file: string;
      /** Tagi `_journal.json`, którymi SQL tego pliku wszedł do pasa drizzle. */
      readonly coveredBy: readonly string[];
      /**
       * Początki instrukcji pliku, których świadomie NIE MA we wskazanych
       * plikach dziennika (pomiar `coverageStatements`). Każda brakująca
       * instrukcja musi zaczynać się którymś z nich.
       */
      readonly uncovered?: readonly string[];
      /** Jak zmierzono pokrycie i czemu brakujące instrukcje nie zmieniają stanu bazy. */
      readonly reason: string;
    }
  | {
      readonly file: string;
      /**
       * Plik bez kopii w dzienniku, którego SQL mógł trafić na produkcję tylko
       * poza migratorem: co robi, czy jest krytyczny i czego o stanie produkcji
       * NIE potwierdzono. CI drukuje to przy każdym przebiegu.
       */
      readonly appliedOutOfBand: string;
      /**
       * Późniejsza migracja supabase (z kopią w dzienniku), która idempotentnie
       * domyka stan tego pliku na produkcji (granty, ciała funkcji).
       */
      readonly reconciledBy?: string;
    };

/**
 * Rejestr luk kierunku odwrotnego. Kolejność po nazwie pliku.
 *
 * `coveredBy` bramka mierzy przy każdym przebiegu (patrz nagłówek); `reason`
 * mówi, czego w kopii brakuje i czemu to nie zmienia stanu bazy.
 * `appliedOutOfBand` to plik, którego w dzienniku nie ma i którego generator nie
 * wyśle - zdanie mówi, co robi, czy dotyka bezpieczeństwa albo izolacji
 * najemców i czego o produkcji nie wiadomo.
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
    uncovered: ["UPDATE public.conversations SET wallpaper = NULL WHERE wallpaper = 'soft'"],
    reason:
      "chat_set_appearance z REVOKE/GRANT jest w 0002 identyczne; brakuje tylko UPDATE conversations SET wallpaper = NULL WHERE wallpaper = 'soft', a to no-op na każdej bazie po 20260907194459 (sprzed startu pasa drizzle), którego zwalidowany CHECK conversations_wallpaper_check dopuszcza wyłącznie NULL, 'dots', 'lines' i 'none'.",
  },
  {
    file: "20260912102000_footer_youtube_profile.sql",
    appliedOutOfBand:
      "Uzupełnia adresy YouTube, Instagram, LinkedIn i Spotify w widgecie stopki `ftr-social` (site_settings) - zmiana treści bez znaczenia dla bezpieczeństwa i izolacji najemców; 0002 tych czterech UPDATE nie zawiera, a żaden plik dziennika nie dotyka stopki. Na produkcję mógł trafić tylko poza migratorem (panel Lovable, narzędzie bazodanowe); granty, ciała funkcji i dane tam NIEPOTWIERDZONE.",
  },
  {
    file: "20260912103000_member_crm_grant_outbox.sql",
    coveredBy: ["0002_pr350_member_crm_sync_and_chat_compat"],
    reason: "Wszystkie 3 instrukcje stoją w zestawieniu #350 bez zmian.",
  },
  {
    file: "20260914090000_push_subscriptions_tenant_binding.sql",
    coveredBy: ["0018_pr365_tenant_follows_profile"],
    uncovered: [
      "DO $$ DECLARE v_orphans integer",
      "CREATE OR REPLACE FUNCTION public.tg_profiles_repin_push_subscriptions(",
      "CREATE TRIGGER profiles_repin_push_subscriptions ",
    ],
    reason:
      "Pin push_subscriptions_pin_tenant, uzgodnienie wierszy i granty są w 0018 identyczne; brakuje wyłącznie bloku DO z RAISE NOTICE o sierotach (diagnostyka bez zapisu) oraz tg_profiles_repin_push_subscriptions z wyzwalaczem, które 20260914120000 i samo 0018 zdejmują (DROP TRIGGER/FUNCTION IF EXISTS).",
  },
  {
    file: "20260914120000_tenant_follows_profile.sql",
    coveredBy: ["0018_pr365_tenant_follows_profile"],
    uncovered: ["CREATE OR REPLACE FUNCTION public.tg_profiles_repin_account_tenant("],
    reason:
      "Brakuje wyłącznie pośredniej wersji tg_profiles_repin_account_tenant(), którą nadpisuje CREATE OR REPLACE z 20260914200000 - 0018 niesie tę wersję końcową; reszta instrukcji jest identyczna.",
  },
  {
    file: "20260914140000_author_profiles_tenant_follows_profile.sql",
    coveredBy: ["0018_pr365_tenant_follows_profile"],
    uncovered: ["CREATE OR REPLACE FUNCTION public.tg_profiles_repin_account_tenant("],
    reason:
      "Brakuje wyłącznie pośredniej wersji tg_profiles_repin_account_tenant(), którą nadpisuje CREATE OR REPLACE z 20260914200000 - 0018 niesie tę wersję końcową; reszta instrukcji jest identyczna.",
  },
  {
    file: "20260914160000_profile_cv_tenant_follows_profile.sql",
    coveredBy: ["0018_pr365_tenant_follows_profile"],
    uncovered: ["CREATE OR REPLACE FUNCTION public.tg_profiles_repin_account_tenant("],
    reason:
      "Brakuje wyłącznie pośredniej wersji tg_profiles_repin_account_tenant(), którą nadpisuje CREATE OR REPLACE z 20260914200000 - 0018 niesie tę wersję końcową; reszta instrukcji jest identyczna.",
  },
  {
    file: "20260914180000_media_mentions_tenant_follows_profile.sql",
    coveredBy: ["0018_pr365_tenant_follows_profile"],
    uncovered: ["CREATE OR REPLACE FUNCTION public.tg_profiles_repin_account_tenant("],
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
    appliedOutOfBand:
      "Poszerza CHECK `legal_document_versions.doc_key` o dziesięć kluczy pakietu zgodności 2026-09 (bez tego zapis i publikacja wersji nowych dokumentów prawnych z panelu kończą się błędem 23514) - zgodność prawna i działanie panelu, nie bezpieczeństwo ani izolacja najemców; żaden plik dziennika nie dotyka legal_document_versions. Na produkcję mógł trafić tylko poza migratorem (panel Lovable, narzędzie bazodanowe); granty, ciała funkcji i dane tam NIEPOTWIERDZONE.",
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
    uncovered: [
      "CREATE OR REPLACE FUNCTION public.payments_apply_event_ticket_outcome(",
      "CREATE OR REPLACE FUNCTION public._event_apply_outcome_to_group(",
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
    appliedOutOfBand:
      "Komentarze wpisów ściany klubu (`club_post_comments`, RPC, moderacja, pseudonimy Chatham House, `club_user_can_read`) oraz `club_posts_list` filtrujące strumień całego klubu prawem odczytu działu wpisu - nowa funkcja z poprawką dostępu, krytyczna dla poufności działów klubu. Na produkcję mógł trafić tylko poza migratorem (panel Lovable, narzędzie bazodanowe); granty, ciała funkcji i dane tam NIEPOTWIERDZONE.",
  },
  {
    file: "20261007100100_club_post_mentions_and_link_validation.sql",
    appliedOutOfBand:
      "Bramka odbiorców @wzmianek liczona prawem ODBIORCY, wzmianki we wpisach i komentarzach ściany, podpowiedzi członków, walidacja załączników-linków i zamknięcie gościowi działów klubu publicznego o widoczności members/private/secret - krytyczne dla poufności treści klubów (wyciek przez powiadomienia i przez odczyt gościa). Na produkcję mógł trafić tylko poza migratorem (panel Lovable, narzędzie bazodanowe); granty, ciała funkcji i dane tam NIEPOTWIERDZONE.",
  },
  {
    file: "20261007120000_event_package_order_company_not_from_payload.sql",
    appliedOutOfBand:
      "`event_package_purchase` przestaje brać `company_id` zamówienia z ładunku kupującego (`forbidden_field`) - krytyczne: dowolna firma z kartoteki CRM najemcy trafiała do zamówienia, a błąd 23503 był wyrocznią istnienia identyfikatorów firm; najnowsze ciało tej funkcji w dzienniku (0118/0119, czyli 20261001210000) jest sprzed poprawki. Na produkcję mógł trafić tylko poza migratorem (panel Lovable, narzędzie bazodanowe); granty, ciała funkcji i dane tam NIEPOTWIERDZONE.",
  },
  {
    file: "20261007120100_ad_slots_private_notes.sql",
    appliedOutOfBand:
      "Odbiera `anon` i `authenticated` odczyt kolumny `ad_slots.notes` (SELECT kolumnowy zamiast tabelowego) i dodaje `admin_list_ad_slots()` dla panelu - krytyczne dla poufności: bez tego `GET /rest/v1/ad_slots?select=notes` z kluczem publicznym oddaje każdemu gościowi notatki operatora. Na produkcję mógł trafić tylko poza migratorem (panel Lovable, narzędzie bazodanowe); granty, ciała funkcji i dane tam NIEPOTWIERDZONE.",
  },
  {
    file: "20261007120200_plan_coupon_server_only.sql",
    appliedOutOfBand:
      "Walidacja i realizacja kodów planu (`validate_b2b_coupon`, `redeem_b2b_coupon`) tylko dla `service_role` z jawną tożsamością i kubełkiem pudeł po adresie, bez INSERT klienta na `b2b_coupon_redemptions` - krytyczne: zalogowany omijał limit prób po adresie i zużywał pulę kodu bez zamówienia. Na produkcję mógł trafić tylko poza migratorem (panel Lovable, narzędzie bazodanowe); granty, ciała funkcji i dane tam NIEPOTWIERDZONE.",
  },
  {
    file: "20261007120300_client_grants_follow_ts_callers.sql",
    appliedOutOfBand:
      "Granty zgodne z wywołaniami z TS: DELETE na `conversations` dla `authenticated` (przycisk panelu czatu) oraz odebranie klientom EXECUTE `join_us_link_and_backfill` i `enforce_form_field_policy` - krytyczne dla izolacji: zalogowany przepinał dowolną subskrypcję newslettera na dowolne konto, a anon czytał politykę pól formularzy dowolnego najemcy. Na produkcję mógł trafić tylko poza migratorem (panel Lovable, narzędzie bazodanowe); granty, ciała funkcji i dane tam NIEPOTWIERDZONE.",
  },
  {
    file: "20261007120400_content_password_explicit_tenant.sql",
    appliedOutOfBand:
      "Odblokowanie treści hasłem tylko z serwera (`verify_content_password_for_tenant`, `service_role`) z jawnym najemcą i skrótem adresu - krytyczne: PostgREST wprost omijał limit prób po adresie, a pod rolą serwisową funkcja liczyła najemcę domyślnego. Na produkcję mógł trafić tylko poza migratorem (panel Lovable, narzędzie bazodanowe); granty, ciała funkcji i dane tam NIEPOTWIERDZONE.",
  },
  {
    file: "20261007120500_service_only_rpc_default_execute.sql",
    appliedOutOfBand:
      "Zdejmuje domyślne EXECUTE `anon` i `authenticated` z `org_apply_subscription_seats(text, integer)` i 10-argumentowego `crm_upsert_from_form` - krytyczne dla izolacji najemców: anon ustawiał limit miejsc cudzej organizacji i zakładał leady CRM w dowolnym najemcy. Na produkcję mógł trafić tylko poza migratorem (panel Lovable, narzędzie bazodanowe); granty, ciała funkcji i dane tam NIEPOTWIERDZONE.",
  },
  {
    file: "20261007120510_career_cv_gc_service_only.sql",
    appliedOutOfBand:
      "Zostawia funkcje kolejki retencji CV (`career_cv_gc_scan/claim/done/fail`) wyłącznie `service_role` - obrona w głąb dla ścieżek plików CV kandydatów (ciało ma bramkę `is_super_admin`, więc to utwardzenie, nie otwarta dziura). Na produkcję mógł trafić tylko poza migratorem (panel Lovable, narzędzie bazodanowe); granty, ciała funkcji i dane tam NIEPOTWIERDZONE.",
  },
  {
    file: "20261007120600_event_codes_server_only.sql",
    appliedOutOfBand:
      "Walidacja kodów wydarzeń, wycena wejścia i zakup pakietu tylko z serwera (`_require_server_identity`, funkcje `*_for_user`, kubełek pudeł po adresie) - krytyczne przeciw zgadywaniu kodów; pliki dziennika 0227, 0231, 0242, 0244 i 0288 już wołają `_require_server_identity`, zdefiniowaną wyłącznie tutaj. Na produkcję mógł trafić tylko poza migratorem (panel Lovable, narzędzie bazodanowe); granty, ciała funkcji i dane tam NIEPOTWIERDZONE.",
  },
  {
    file: "20261007140000_email_queue_service_only.sql",
    appliedOutOfBand:
      "Zostawia wrappery kolejek pgmq `enqueue_email`, `read_email_batch` i `delete_email` wyłącznie `service_role` (`move_to_dlq` zamyka już 0236) - KRYTYCZNE: z kluczem publikowalnym dało się czytać kolejkę maili autoryzacyjnych (linki resetu hasła, czyli przejęcie konta) i wysyłać pocztę z domeny platformy. Na produkcję mógł trafić tylko poza migratorem (panel Lovable, narzędzie bazodanowe); granty, ciała funkcji i dane tam NIEPOTWIERDZONE.",
  },
  {
    file: "20261007140100_definer_functions_without_client_path.sql",
    appliedOutOfBand:
      "Odbiera klientom EXECUTE na 42 sygnaturach funkcji SECURITY DEFINER bez ścieżki klienta (28 bez bramki w ciele, 13 wykonywalnych nawet dla anon, np. `_are_connected`, `auto_connect_experts`) - krytyczne dla bezpieczeństwa i izolacji najemców. Na produkcję mógł trafić tylko poza migratorem (panel Lovable, narzędzie bazodanowe); granty, ciała funkcji i dane tam NIEPOTWIERDZONE.",
  },
  {
    file: "20261007140400_ticket_access_code_probe.sql",
    appliedOutOfBand:
      "Limit prób kodów dostępu do biletów (`_access_code_probe_guard/_miss`, `event_ticket_checkout_quote` tylko dla `service_role`) - krytyczne przeciw zgadywaniu kodów prasy i partnerów; pliki dziennika 0190, 0230, 0232, 0241, 0246 i 0281 już wołają `_access_code_probe_guard/_miss`, zdefiniowane wyłącznie tutaj. Na produkcję mógł trafić tylko poza migratorem (panel Lovable, narzędzie bazodanowe); granty, ciała funkcji i dane tam NIEPOTWIERDZONE.",
  },
  {
    file: "20261007140500_crm_newsletter_writers_bound.sql",
    appliedOutOfBand:
      "Wiąże zapisy CRM i newslettera z wołającym (`crm_upsert_lead_from_profile/_from_subscriber` tylko `service_role`, `crm_backfill_all_leads` w najemcy wołającego, `join_us_link_and_backfill` tylko dla wierszy bez właściciela) - KRYTYCZNE dla izolacji najemców: administrator najemcy A zakładał leady w CRM-ie najemcy B. Na produkcję mógł trafić tylko poza migratorem (panel Lovable, narzędzie bazodanowe); granty, ciała funkcji i dane tam NIEPOTWIERDZONE.",
  },
  {
    file: "20261007140600_event_functions_runtime_errors.sql",
    appliedOutOfBand:
      "Naprawia cztery funkcje wydarzeń padające przy każdym wywołaniu (42703/42804: historia i lista uprawnień widowni, `event_my_package_orders`, kwalifikacja widowni akademickiej) - błąd działania, nie bezpieczeństwo. Na produkcję mógł trafić tylko poza migratorem (panel Lovable, narzędzie bazodanowe); granty, ciała funkcji i dane tam NIEPOTWIERDZONE.",
  },
  {
    file: "20261007140700_runtime_errors_seats_workflow_passwords.sql",
    appliedOutOfBand:
      "Naprawia funkcje padające przy każdym wywołaniu (`org_apply_subscription_seats`, akcja `notify_followers` w `run_workflow_step`, hasła treści przez pgcrypto w `extensions`) i zawęża ustawianie hasła treści do wiersza najemcy wołającego - krytyczne dla izolacji: redaktor dowolnego najemcy nadpisywał hasło treści innego. Na produkcję mógł trafić tylko poza migratorem (panel Lovable, narzędzie bazodanowe); granty, ciała funkcji i dane tam NIEPOTWIERDZONE.",
  },
  {
    file: "20261007140710_club_application_crm_sync_overload.sql",
    appliedOutOfBand:
      "`club_application_crm_sync` wskazuje jawnie 11-argumentowe przeciążenie `crm_upsert_from_form` (dotąd 42725 przy każdym zgłoszeniu do klubu i brak leada w CRM) - błąd działania, nie bezpieczeństwo. Na produkcję mógł trafić tylko poza migratorem (panel Lovable, narzędzie bazodanowe); granty, ciała funkcji i dane tam NIEPOTWIERDZONE.",
  },
  {
    file: "20261007140800_rate_limits_retention.sql",
    appliedOutOfBand:
      "Retencja `rate_limits` (`rate_limits_prune` tylko dla `service_role`, pg_cron co godzinę) - chroni przed nieograniczonym wzrostem tabeli i kosztu każdego limitera, czyli dostępność, nie izolacja najemców. Na produkcję mógł trafić tylko poza migratorem (panel Lovable, narzędzie bazodanowe); granty, ciała funkcji i dane tam NIEPOTWIERDZONE.",
  },
  {
    file: "20261009100000_podcast_apple_connect_metadata_reapply.sql",
    appliedOutOfBand:
      "Ponawia kolumny metadanych Apple Podcasts z 20260725090500 (`podcasts.explicit`, `podcast_shows.itunes_author` i inne), których brak nagłówek dokumentuje jako awarię /podcasts zmierzoną 2026-10-09 - dostępność treści, nie bezpieczeństwo. Na produkcję mógł trafić tylko poza migratorem (panel Lovable, narzędzie bazodanowe); granty, ciała funkcji i dane tam NIEPOTWIERDZONE.",
  },
  {
    file: "20261009110000_schema_column_contract_probe.sql",
    appliedOutOfBand:
      "Sonda `missing_schema_columns(jsonb)` dla kontraktu kolumn po wdrożeniu (czyta wyłącznie katalog; EXECUTE dla `anon` i `service_role`) - narzędzie CI, nie bezpieczeństwo, ale bez niej `check:db-contract` nie widzi brakujących kolumn produkcji. Na produkcję mógł trafić tylko poza migratorem (panel Lovable, narzędzie bazodanowe); granty, ciała funkcji i dane tam NIEPOTWIERDZONE.",
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
  | "niezmierzone-pokrycie"
  | "zamkniety-rejestr"
  | "wpis-bez-pliku-supabase"
  | "nieaktualny-wpis"
  | "zmiana-sprzed-pasa"
  | "bledne-uzgodnienie";

export interface SupabaseCoverageViolation {
  readonly kind: SupabaseCoverageViolationKind;
  readonly file: string;
  readonly detail: string;
}

/** Plik poza dziennikiem drizzle - nie czerwieni CI, ale jest drukowany. */
export interface OutOfBandSupabaseFile {
  readonly file: string;
  readonly appliedOutOfBand: string;
  readonly reconciledBy?: string;
}

/** Zbędna część rejestru - drukowana „do usunięcia", bez czerwieni. */
export interface StaleSupabaseGap {
  readonly file: string;
  readonly detail: string;
}

export interface SupabaseCoverageReport {
  /** Pliki pasa supabase od DRIZZLE_LANE_START włącznie. */
  readonly checked: number;
  /** Pokryte kopią w dzienniku (i) albo wpisem `twin` o tagu z dziennika (ii). */
  readonly twins: number;
  /** Pokryte zmierzonym zestawieniem albo plikiem dziennika o innej treści (`coveredBy`). */
  readonly consolidated: number;
  /** Pliki `appliedOutOfBand` bez kopii w dzienniku - generator ich nie wysyła. */
  readonly outOfBand: readonly OutOfBandSupabaseFile[];
  readonly stale: readonly StaleSupabaseGap[];
  readonly violations: readonly SupabaseCoverageViolation[];
  /** Pokrycie (i): plik supabase -> wpis dziennika, który go niesie (`journalCopies`). */
  readonly copies: ReadonlyMap<string, string>;
}

export interface SupabaseCoverageOptions {
  readonly gaps?: readonly SupabaseLaneGap[];
  readonly read?: ReadFile;
  readonly listSupabase?: ListSql;
  readonly lanes?: readonly LaneEntry[];
  /** `null` wyłącza kontrolę zbioru sprzed pasa (testy na syntetycznych plikach). */
  readonly preLane?: PreLaneFreeze | null;
  /** Pliki, którym wolno mieć `appliedOutOfBand` albo `uncovered` (domyślnie zamrożony zbiór). */
  readonly exceptions?: ReadonlySet<string>;
  /** Ostatni wpis historii dziennika (domyślnie JOURNAL_FREEZE_IDX) - patrz `journalCopies`. */
  readonly freezeIdx?: number;
}

/** Wersja migracji supabase (14 cyfr przed `_`); `null` dla nazwy spoza konwencji CLI. */
export function supabaseMigrationVersion(file: string): string | null {
  return /^(\d{14})_/.exec(file)?.[1] ?? null;
}

/**
 * Klucz instrukcji do pomiaru `coveredBy`: SQL wykonywalny bez końcowego `;`
 * i bez spacji wokół nawiasów i przecinków. Pas drizzle bywa przeformatowany
 * (`( bucket_id` wobec `(bucket_id`), a pomiar ma pytać o treść, nie o układ.
 * Zwarcie dotyka też wnętrza literałów - przy pomiarze POKRYCIA to dopuszczalne
 * (zrównać mogłoby się tylko `'a ( b'` z `'a(b'`), dlatego klucz nie zastępuje
 * `executableSql` w porównaniu bliźniaków.
 */
function statementKey(sql: string): string {
  return executableSql(sql)
    .replace(/\s*([(),;])\s*/g, "$1")
    .replace(/;$/, "");
}

const COMMENT_ON = /^COMMENT ON\b/i;

/**
 * Prefiks `uncovered` dopasowany do granicy słowa: `CREATE TRIGGER x` nie
 * trafia w `CREATE TRIGGER x_v2` (klucz zjada końcową spację prefiksu).
 */
function startsWithToken(statement: string, prefix: string): boolean {
  if (!statement.startsWith(prefix)) return false;
  const next = statement[prefix.length];
  return next === undefined || !/[A-Za-z0-9_$]/.test(prefix.at(-1)!) || !/[A-Za-z0-9_$]/.test(next);
}

/**
 * Instrukcje najwyższego poziomu pliku jako klucze `statementKey`, bez
 * `COMMENT ON` (dokumentacja w bazie - ta sama decyzja co w kierunku prostym).
 */
export function coverageStatements(sql: string): string[] {
  const out: string[] = [];
  for (const segment of lexStatements(sql)) {
    if (segment.codeStart === -1) continue;
    const key = statementKey(segment.text);
    if (key !== "" && !COMMENT_ON.test(key)) out.push(key);
  }
  return out;
}

/** Odcisk zbioru nazw plików: liczba i sha256 posortowanej listy. */
export function preLaneFingerprint(files: readonly string[]): PreLaneFreeze {
  const sorted = [...files].sort();
  return {
    count: sorted.length,
    digest: createHash("sha256").update(sorted.join("\n")).digest("hex"),
  };
}

const inLaneScope = (file: string): boolean => {
  const version = supabaseMigrationVersion(file);
  return version !== null && version >= DRIZZLE_LANE_START;
};

/** Indeks wpisu z prefiksu tagu; tag bez prefiksu liczy się jak wpis po zamrożeniu. */
const tagIdx = (tag: string): number =>
  Number(/^(\d+)_/.exec(tag)?.[1] ?? Number.POSITIVE_INFINITY);

interface JournalCopy {
  readonly tag: string;
  /** SQL wykonywalny pliku wpisu (niepusty). */
  readonly key: string;
  /** Źródło z nagłówka generatora; `null` - wpis bez nagłówka. */
  readonly source: string | null;
}

/** Wartości pogrupowane po kluczu, w kolejności wejścia. */
function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

/** Wpisy dziennika, które mogą coś nieść: z plikiem i niepustym SQL-em wykonywalnym. */
function readJournalCopies(journalTags: readonly string[], read: ReadFile): JournalCopy[] {
  return journalTags.flatMap((tag) => {
    const text = read(`${DRIZZLE_DIR}/${tag}.sql`);
    if (text === null) return []; // wpis bez pliku łapie evaluateLaneGate
    const key = executableSql(text);
    return key === "" ? [] : [{ tag, key, source: mirrorSourceOf(text) }];
  });
}

/**
 * Pokrycie (i): który wpis dziennika niesie który plik `files` (w kolejności
 * wersji) - reguły 1-3 z nagłówka modułu. Każdy wpis niesie najwyżej jeden plik.
 */
function journalCopies(
  journalTags: readonly string[],
  files: readonly string[],
  sqlOf: (file: string) => string | null,
  gapFiles: ReadonlySet<string>,
  read: ReadFile,
  freezeIdx: number,
): Map<string, string> {
  const entries = readJournalCopies(journalTags, read);
  const copies = new Map<string, string>();
  // 1. Lustro generatora: wyłącznie plik z nagłówka, o tym samym SQL-u.
  for (const { tag, key, source } of entries) {
    if (source !== null && !copies.has(source) && sqlOf(source) === key) copies.set(source, tag);
  }
  // 2. Historia: pierwsza wolna kopia dla pliku, pliki rejestru luk z resztek.
  const history = groupBy(
    entries.filter((e) => e.source === null && tagIdx(e.tag) <= freezeIdx),
    (e) => e.key,
  );
  for (const file of [
    ...files.filter((f) => !gapFiles.has(f)),
    ...files.filter((f) => gapFiles.has(f)),
  ]) {
    const key = sqlOf(file);
    const entry = copies.has(file) || key === null ? undefined : history.get(key)?.shift();
    if (entry !== undefined) copies.set(file, entry.tag);
  }
  // 3. Po zamrożeniu: najstarszy plik o tym SQL-u (plik adopcji); zbędna kopia przepada.
  const oldestBySql = groupBy(
    files.filter((f) => (sqlOf(f) ?? "") !== ""),
    (f) => sqlOf(f)!,
  );
  for (const { tag, key, source } of entries) {
    if (source !== null || tagIdx(tag) <= freezeIdx) continue;
    const oldest = oldestBySql.get(key)?.[0];
    if (oldest !== undefined && !copies.has(oldest)) copies.set(oldest, tag);
  }
  return copies;
}

/**
 * Wada wskazania `reconciledBy` albo `null`. Uzgodnienie domyka stan produkcji PO
 * pliku, więc musi być plikiem tego pasa o PÓŹNIEJSZEJ wersji - wtedy, jak każdy
 * nowy plik, ma też kopię w dzienniku (pilnuje tego reszta bramki).
 */
function reconciliationError(
  file: string,
  reconciledBy: string | undefined,
  listed: ReadonlySet<string>,
): string | null {
  if (reconciledBy === undefined) return null;
  if (!listed.has(reconciledBy))
    return `reconciledBy wskazuje ${reconciledBy}, którego nie ma w ${SUPABASE_DIR}/.`;
  if ((supabaseMigrationVersion(reconciledBy) ?? "") <= (supabaseMigrationVersion(file) ?? ""))
    return `reconciledBy (${reconciledBy}) musi być PÓŹNIEJSZĄ migracją - uzgodnienie domyka stan po pliku.`;
  return null;
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
  {
    gaps = SUPABASE_LANE_GAPS,
    read = readFileOrNull,
    listSupabase = listSqlOrEmpty,
    lanes = MIGRATION_LANES,
    preLane = PRE_LANE_FREEZE,
    exceptions = GAP_EXCEPTIONS_AT_GATE_START,
    freezeIdx = JOURNAL_FREEZE_IDX,
  }: SupabaseCoverageOptions = {},
): SupabaseCoverageReport {
  const inJournal = new Set(journalTags);
  const statementsOf = new Map<string, ReadonlySet<string>>();
  const journalStatements = (tag: string): ReadonlySet<string> => {
    let set = statementsOf.get(tag);
    if (!set) {
      const text = read(`${DRIZZLE_DIR}/${tag}.sql`);
      set = new Set(text === null ? [] : coverageStatements(text));
      statementsOf.set(tag, set);
    }
    return set;
  };
  // Ostatni wpis tagu wygrywa - jak w `analyzeMigrationLanes`, który porównuje
  // treść WYŁĄCZNIE tego wpisu. Przesłonięty duplikat nie jest niczym
  // sprawdzony, więc niczego nie pokrywa.
  const declaredTwins = new Set(
    [...new Map(lanes.map((e) => [e.tag, e])).values()].flatMap((e) =>
      "twin" in e && inJournal.has(e.tag) ? [e.twin] : [],
    ),
  );
  const gapByFile = new Map(gaps.map((g) => [g.file, g]));
  const all = listSupabase(SUPABASE_DIR);
  const listed = new Set(all);
  const inScope = all.filter(inLaneScope).sort();
  const sqlByFile = new Map<string, string | null>();
  const sqlOf = (file: string): string | null => {
    if (!sqlByFile.has(file)) {
      const text = listed.has(file) && inLaneScope(file) ? read(`${SUPABASE_DIR}/${file}`) : null;
      sqlByFile.set(file, text === null ? null : executableSql(text));
    }
    return sqlByFile.get(file)!;
  };
  // Każdy wpis pokrywa JEDEN plik: ponowny przebieg albo przywrócenie z tym
  // samym SQL-em co starszy plik potrzebuje WŁASNEJ kopii - migrator nie wykona
  // starego wpisu drugi raz. Kopie panelu tego samego pliku (0297/0301) to po
  // prostu nadmiar wpisów.
  const copies = journalCopies(
    journalTags,
    inScope,
    sqlOf,
    new Set(gapByFile.keys()),
    read,
    freezeIdx,
  );

  const violations: SupabaseCoverageViolation[] = [];
  const outOfBand: OutOfBandSupabaseFile[] = [];
  const stale: StaleSupabaseGap[] = [];
  let twins = 0;
  let consolidated = 0;

  if (preLane) {
    const now = preLaneFingerprint(all.filter((f) => !inLaneScope(f)));
    if (now.count !== preLane.count || now.digest !== preLane.digest) {
      violations.push({
        kind: "zmiana-sprzed-pasa",
        file: `${SUPABASE_DIR}/*`,
        detail: `Zbiór plików sprzed ${DRIZZLE_LANE_START} (albo o nazwie spoza konwencji <14 cyfr>_nazwa.sql) zmienił się: ${now.count} plików wobec zamrożonych ${preLane.count}. Repozytorium jest forward-only, a bramka tych plików nie sprawdza - nowa migracja ma wersję z dzisiejszą datą i kopię w dzienniku drizzle.`,
      });
    }
  }

  for (const file of inScope) {
    const text = read(`${SUPABASE_DIR}/${file}`);
    const copy = copies.get(file);
    const gap = gapByFile.get(file);
    if (copy !== undefined || declaredTwins.has(file)) {
      twins += 1;
      if (gap)
        stale.push({
          file,
          detail: `ma już ${copy !== undefined ? `kopię w dzienniku (${copy})` : "bliźniaka z MIGRATION_LANES w dzienniku"} - usuń wpis z SUPABASE_LANE_GAPS.`,
        });
      continue;
    }
    if (!gap) {
      violations.push({
        kind: "brak-kopii-drizzle",
        file,
        detail: `Żaden wpis ${DRIZZLE_DIR}/meta/_journal.json nie ma tego SQL-u wykonywalnego - produkcja dostaje schemat wyłącznie migratorem Drizzle, więc ta migracja na nią NIE trafi. Uruchom \`bun run migrations:mirror\` - generator dopisze kopię do dziennika (nie pisz jej ręcznie).`,
      });
      continue;
    }
    if ("appliedOutOfBand" in gap) {
      if (!exceptions.has(file)) {
        violations.push({
          kind: "zamkniety-rejestr",
          file,
          detail:
            "Lista plików zastosowanych poza dziennikiem jest zamknięta (GAP_EXCEPTIONS_AT_GATE_START): migracja spoza niej - także pod dawną datą - dostaje kopię z `bun run migrations:mirror` albo zmierzone `coveredBy`.",
        });
        continue;
      }
      const wrong = reconciliationError(file, gap.reconciledBy, listed);
      if (wrong !== null) violations.push({ kind: "bledne-uzgodnienie", file, detail: wrong });
      outOfBand.push({
        file,
        appliedOutOfBand: gap.appliedOutOfBand,
        ...(gap.reconciledBy === undefined ? {} : { reconciledBy: gap.reconciledBy }),
      });
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
    // `uncovered` to wyjątek z dnia włączenia bramki, nie furtka: nowa
    // migracja ma pokrycie pełne albo kopię - inaczej wpis z samych wyjątków
    // byłby cichym `pending` obok zamkniętej listy.
    if (gap.uncovered && !exceptions.has(file)) {
      violations.push({
        kind: "zamkniety-rejestr",
        file,
        detail:
          "`uncovered` jest zamknięte (GAP_EXCEPTIONS_AT_GATE_START): zestawienie migracji spoza zbioru musi nieść każdą jej instrukcję.",
      });
      continue;
    }
    const allowed = (gap.uncovered ?? []).map(statementKey);
    if (allowed.some((prefix) => prefix === "")) {
      violations.push({
        kind: "niezmierzone-pokrycie",
        file,
        detail:
          "Pusty prefiks w `uncovered` pasuje do każdej instrukcji - wymień instrukcje z początku.",
      });
      continue;
    }
    const carried = new Set(gap.coveredBy.flatMap((tag) => [...journalStatements(tag)]));
    const statements = text === null ? [] : coverageStatements(text);
    const used = new Set<string>();
    const missing = statements.filter((statement) => {
      if (carried.has(statement)) return false;
      const prefix = allowed.find((p) => startsWithToken(statement, p));
      if (prefix === undefined) return true;
      used.add(prefix);
      return false;
    });
    if (missing.length > 0 || !statements.some((statement) => carried.has(statement))) {
      violations.push({
        kind: "niezmierzone-pokrycie",
        file,
        detail:
          missing.length > 0
            ? `${missing.length} instrukcji nie ma w ${gap.coveredBy.join(", ")} ani w \`uncovered\` wpisu, np. „${missing[0]!.slice(0, 160)}". Zestawienie, które nie niesie treści pliku, niczego nie pokrywa.`
            : `${gap.coveredBy.join(", ")} nie niesie ŻADNEJ instrukcji pliku - wpis z samych wyjątków \`uncovered\` niczego nie pokrywa.`,
      });
      continue;
    }
    for (const prefix of allowed) {
      if (!used.has(prefix))
        stale.push({
          file,
          detail: `\`uncovered\` „${prefix.slice(0, 80)}" nie trafia już w żadną brakującą instrukcję - usuń go z wpisu.`,
        });
    }
    consolidated += 1;
  }

  for (const gap of gaps) {
    if (!listed.has(gap.file))
      violations.push({
        kind: "wpis-bez-pliku-supabase",
        file: gap.file,
        detail: `Rejestr ma wpis dla ${gap.file}, ale pliku ${SUPABASE_DIR}/${gap.file} nie ma. Martwy wpis maskowałby brak pliku.`,
      });
    else if (!inLaneScope(gap.file))
      violations.push({
        kind: "nieaktualny-wpis",
        file: gap.file,
        detail: `Plik jest sprzed startu pasa drizzle (${DRIZZLE_LANE_START}) - bramka go nie sprawdza, usuń wpis.`,
      });
  }

  return { checked: inScope.length, twins, consolidated, outOfBand, stale, violations, copies };
}

export function supabaseCoverageFailed(report: SupabaseCoverageReport): boolean {
  return report.violations.length > 0;
}

/** Raport kierunku odwrotnego; pliki poza dziennikiem drukuje ZAWSZE, także przy zielonym wyniku. */
export function renderSupabaseCoverage(report: SupabaseCoverageReport): string {
  const head = `Pokrycie pasa supabase w dzienniku drizzle: ${report.checked} plików od ${DRIZZLE_LANE_START} (${report.twins} z kopią w dzienniku, ${report.consolidated} w zmierzonych zestawieniach dziennika, ${report.outOfBand.length} zastosowanych poza dziennikiem).`;
  const lines = [`${supabaseCoverageFailed(report) ? "✗" : "✓"} ${head}`];
  if (report.violations.length > 0) {
    lines.push(`NARUSZENIA POKRYCIA (${report.violations.length}):`);
    for (const v of report.violations) lines.push(`  [${v.kind}] ${v.file}: ${v.detail}`);
    lines.push(
      "  Naprawa: brak kopii - `bun run migrations:mirror` (generator dopisze kopię do dziennika drizzle; nie pisz jej ręcznie); zestawienie dziennika opisz w SUPABASE_LANE_GAPS (src/lib/ci/supabaseLaneCoverage.ts) - bramka je zmierzy.",
    );
  }
  if (report.stale.length > 0) {
    lines.push(`DO USUNIĘCIA Z SUPABASE_LANE_GAPS (${report.stale.length}, bez czerwieni):`);
    for (const s of report.stale) lines.push(`  ${s.file}: ${s.detail}`);
  }
  if (report.outOfBand.length > 0) {
    lines.push(
      `POZA DZIENNIKIEM (${report.outOfBand.length}, zamrożone - generator ich NIE wysyła: ponowne wykonanie w jednej transakcji migratora mogłoby wycofać całą dostawę):`,
    );
    for (const o of report.outOfBand)
      lines.push(
        `  ${o.file}: ${o.appliedOutOfBand} [${o.reconciledBy === undefined ? "BEZ UZGODNIENIA" : `uzgadnia: ${o.reconciledBy}`}]`,
      );
    lines.push(
      "  Domknięcie: późniejsza, idempotentna migracja supabase (lustro dopisze generator) wpisana przy pliku jako `reconciledBy`.",
    );
  }
  return lines.join("\n");
}
