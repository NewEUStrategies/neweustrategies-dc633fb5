// BRAMKA: każdy klucz, który pięć map odmów potrafi ZWRÓCIĆ, musi istnieć w
// nakładce i18n - w OBU językach.
//
// DLACZEGO TO JEST BRAMKA, A NIE ZWYKŁY TEST. Klucz błędu podróżuje w GŁOWIE
// komunikatu plpgsql, więc jedyne, co spina SQL ze słownikiem, to NAZWA -
// zapisana w dwóch niezależnych plikach, których nic ze sobą nie sprawdza.
// Nowy `RAISE EXCEPTION` w migracji przechodzi `tsc`, przechodzi przegląd i
// przechodzi parytet PL/EN (klucza nie ma w ŻADNYM z języków, więc parytet go
// nie widzi). Widać go dopiero na ekranie: albo surową kropkowaną ścieżką
// (`i18n.t()` na nieznanym kluczu oddaje sam klucz), albo zdaniem awaryjnym,
// z którego organizator nie dowie się, co poprawić.
//
// TECHNIKA JEST TA SAMA, CO W `adminAgendaErrors.test.ts` i `adminSponsorErrors
// .test.ts`: lista kodów w postaci z SQL-a, przepuszczona przez PRAWDZIWY mapper
// (nie przez własną kopię `camel()`), a obecność klucza czytana z EKSPORTOWANEGO
// słownika nakładki. Dzięki przejściu przez mapper bramka pilnuje obu połów
// kontraktu naraz: i tego, że kod jest rozpoznawany, i tego, że klucz ma tekst.
//
// STRONA EN CZYTANA JEST Z EKSPORTU, NIE PRZEZ `i18n.exists(klucz, { lng: "en" })`.
// Instancja i18next ma `fallbackLng: "pl"`, więc `exists()` odpowiada „tak" na
// klucz obecny WYŁĄCZNIE po polsku - ZMIERZONE na tym HEAD: klucz dopisany
// tylko do bundla „pl" daje `exists(..., { lng: "en" }) === true`. Sprawdzenie
// EN tą drogą byłoby więc puste, a bramka mierzyłaby dwa razy to samo.
// `readKey(<nakladka>En, klucz)` patrzy DOKŁADNIE w plik, w którym klucz ma
// stać, i dlatego łapie też klucz obecny w innej nakładce albo w rdzeniu.
//
// SKĄD LISTY KODÓW. Z `RAISE EXCEPTION '<kod>: …'` w funkcjach, które WOŁA
// warstwa `src/lib/events/*Api.ts` danego modułu. Kody funkcji, których żaden
// klient nie woła, świadomie tu nie stoją - patrz komentarz przy rejestracjach.
//
// LISTY SĄ RĘCZNE, ALE NIE SĄ NA WIARĘ. Przypadek „ręczna lista kodów nadąża za
// migracjami" konfrontuje każdą z nich ze skanem drzewa `supabase/migrations`
// (`src/test/events/pgRaiseCodes.ts`), więc kod dopisany w nowej migracji
// czerwieni bramkę od razu, zamiast czekać, aż ktoś zajrzy do listy.
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import { readKey, type ResourceTree } from "@/lib/ci/i18nParity";
import { scanRaiseCodes } from "@/test/events/pgRaiseCodes";
import { adminRegistrationFailure } from "@/lib/events/adminRegistrationErrors";
import { adminTermsFailure } from "@/lib/events/adminTermsErrors";
import { adminOnsiteFailure } from "@/lib/events/adminOnsiteErrors";
import { publicEventErrorKey } from "@/lib/events/publicEventErrors";
import { adminEventStudioErrorKey } from "@/lib/events/adminEventStudioErrors";
import { adminSeatingFailure } from "@/lib/events/adminSeatingErrors";
import { adminAdsFunnelFailure } from "@/lib/events/adminAdsFunnelErrors";
import {
  adminEventRegistrationEn,
  adminEventRegistrationPl,
} from "@/lib/i18n-admin-event-registration";
import { adminEventTermsEn, adminEventTermsPl } from "@/lib/i18n-admin-event-terms";
import { adminEventOnsiteEn, adminEventOnsitePl } from "@/lib/i18n-admin-event-onsite";
import { eventFrontEn, eventFrontPl } from "@/lib/i18n-event-front";
import { adminEventsEn, adminEventsPl } from "@/lib/i18n-admin-events";
import { adminCfpFailure } from "@/lib/events/adminCfpErrors";
import { publicCfpFailure } from "@/lib/events/publicCfpErrors";
import { adminEventCfpEn, adminEventCfpPl } from "@/lib/i18n-admin-event-cfp";
import { eventCfpEn, eventCfpPl } from "@/lib/i18n-event-cfp";
import { adminEventInvoiceErrorKey } from "@/lib/events/adminEventInvoiceErrors";
import { eventInvoiceErrorKey } from "@/lib/events/eventInvoiceErrors";
import { adminEventInvoicesEn, adminEventInvoicesPl } from "@/lib/i18n-admin-event-invoices";
import { eventInvoicesEn, eventInvoicesPl } from "@/lib/i18n-event-invoices";
import { adminEventSeatingEn, adminEventSeatingPl } from "@/lib/i18n-admin-event-seating";
import { adminSponsorReportFailure } from "@/lib/events/adminSponsorReportErrors";
import {
  adminEventSponsorReportEn,
  adminEventSponsorReportPl,
} from "@/lib/i18n-admin-event-sponsor-report";
import { adminEventAdsFunnelEn, adminEventAdsFunnelPl } from "@/lib/i18n-admin-event-ads-funnel";
import { adminCloneFailure } from "@/lib/events/adminCloneErrors";
import { adminEventCloneEn, adminEventClonePl } from "@/lib/i18n-admin-event-clone";

// ══ FUNKCJE UCZESTNIKA F1-F5: BLOKI TORÓW (spec B.11-2) ══════════════════════
// Tory A/B/C dopisują importy swoich map i nakładek WYŁĄCZNIE do własnego bloku
// `imports`, kody do istniejących map przez `PF_<X>_EXTRA_CODES` w bloku
// `codes`, a własne mapy do bloku `maps` na końcu `MAPY`. Bloki dzieli co
// najmniej dwie linie, których nikt nie zmienia - scalanie torów nie
// konfliktuje na tym pliku.
// >>> PF-A imports (begin)
// <<< PF-A imports (end)
//
// (separator bloków - tych dwóch linii nie edytuje żaden tor)
// >>> PF-B imports (begin)
// <<< PF-B imports (end)
//
// (separator bloków - tych dwóch linii nie edytuje żaden tor)
// >>> PF-C imports (begin)
// <<< PF-C imports (end)

/** Klucz ma tekst, gdy w słowniku stoi pod nim NIEPUSTY napis (nie gałąź). */
function maTekst(slownik: ResourceTree, klucz: string): boolean {
  const wartosc = readKey(slownik, klucz);
  return typeof wartosc === "string" && wartosc.trim() !== "";
}

/**
 * `assert_event_admin_tenant()` / `assert_event_staff_tenant()` podnoszą
 * `forbidden` PRZED ciałem każdej funkcji administracyjnej modułu, więc ten kod
 * dociera do każdej z map panelu.
 */
const STRAZNIK_TENANTA = "forbidden";

/** Zapisy, bilety, pakiety, stawki - `registrationsApi`, `packagesApi`, `audienceGrantsApi`. */
const KODY_REJESTRACJI = [
  // admin_event_registration_decide / _upsert / _mark_notified, admin_event_waitlist_promote
  "already_registered",
  "invalid_action",
  "invalid_request",
  "invalid_transition",
  "no_seats_left",
  "not_found",
  "reason_required",
  "invalid_answers",
  "invalid_name",
  "invalid_status",
  // admin_event_registration_field_upsert
  "invalid_consent_url",
  "invalid_key",
  "invalid_labels",
  "invalid_options",
  // admin_event_ticket_upsert / _delete
  "invalid_access_code",
  "invalid_benefits",
  "invalid_early_bird",
  "invalid_names",
  "invalid_price_schedule",
  "quota_below_sold",
  "ticket_in_use",
  // admin_event_package_upsert / _delete / _order_create / _order_set_status
  "package_in_use",
  "package_sold_out",
  "invalid_email",
  // admin_event_package_order_set_status - powrót z anulowania, które oddało
  // użycie kodu rabatowego (20260926130000)
  "coupon_restore_exhausted",
  "coupon_restore_used_by_buyer",
  // admin_event_package_seat_invite / _revoke
  "order_cancelled",
  "seat_revoked",
  "seat_taken",
  // admin_event_audience_grant_save / _revoke (ekran „stawki i uprawnienia")
  "invalid_audience",
  "invalid_evidence",
  "invalid_subject",
  // admin_event_ticket_resend (server fn `ticketResend.functions` - panel tlumaczy
  // jej odmowe ta sama mapa, co decyzje)
  "ticket_not_issuable",
  "ticket_send_in_progress",
  // Odmowa SERWERA tej samej server fn (adres z listy wykluczen) - nie pada
  // w SQL-u, wiec skan migracji jej nie zobaczy; stoi tu, zeby bramka pilnowala
  // jej zdania w obu jezykach.
  "ticket_address_suppressed",
  STRAZNIK_TENANTA,
] as const;

/** Grupy i zgody - `termsGroupsApi`. */
const KODY_GRUP_I_ZGOD = [
  // admin_event_group_upsert / _delete / _member_set
  "invalid_key",
  "invalid_names",
  "invalid_request",
  "not_found",
  "group_in_use",
  "group_system",
  // admin_event_term_upsert / _delete
  "invalid_labels",
  "term_in_use",
  STRAZNIK_TENANTA,
] as const;

/** Punkty kontrolne, odprawa, urządzenia i identyfikatory - `onsiteApi`. */
const KODY_ONSITE = [
  // admin_event_checkpoint_save / _delete
  "invalid_kind",
  "invalid_names",
  "invalid_payload",
  "not_found",
  "room_not_in_event",
  "session_not_in_event",
  "session_required",
  "sponsor_not_in_event",
  "sponsor_required",
  "checkpoint_has_devices",
  "checkpoint_in_use",
  // admin_event_scanner_device_issue / _revoke / _set_active
  "checkpoint_not_in_event",
  "invalid_expiry",
  "invalid_label",
  "invalid_scopes",
  "device_revoked",
  // admin_event_checkin_search / _manual (przez `_event_checkin_write`)
  "query_too_short",
  "invalid_source",
  "person_not_found",
  "checkpoint_not_found",
  "invalid_direction",
  // `_event_checkin_write` od 20260926150000: skan starszy niz 7 dni
  "device_time_out_of_range",
  // admin_event_badge_template_save / _delete
  "custom_dimensions_required",
  "invalid_background_color",
  "invalid_background_url",
  "invalid_dimensions",
  "invalid_name",
  "invalid_orientation",
  "invalid_paper_format",
  "invalid_qr_size",
  "too_many_elements",
  "template_in_use",
  // admin_event_badge_print / _badge_sheet - odmowy PODNOSZONE W FUNKCJI
  // POMOCNICZEJ wydruku, nie w ciele RPC. Do listy dopisane po tym, jak skan
  // migracji (przypadek „ręczna lista nadąża za migracjami" niżej) pokazał je
  // jako kody osiągalne z `onsiteApi`, których bramka nie mierzyła.
  "template_missing",
  "template_not_in_event",
  // walidacja POJEDYNCZEGO bloku układu identyfikatora
  "invalid_element",
  "invalid_element_align",
  "invalid_element_field",
  "invalid_element_font_size",
  "invalid_element_kind",
  "invalid_element_text",
  "invalid_element_url",
  "invalid_element_width",
  STRAZNIK_TENANTA,
] as const;

/** Raport dla sponsorów - `sponsorReportApi` (studio, link dla sponsora, karta firmy, CRM). */
const KODY_RAPORTU_SPONSORA = [
  // _event_sponsor_report_assert_filters (summary / series / leads_series)
  "invalid_range",
  "invalid_placement",
  "not_found",
  // admin_event_sponsor_report_link_issue / _link_revoke
  "invalid_payload",
  "sponsor_not_found",
  "invalid_label",
  "invalid_expiry",
  "too_many_links",
  // admin_event_lead_scans_push_to_crm -> _event_person_crm_sync (most CRM
  // lapie ten wyjatek u siebie, ale skan widzi go w ciele funkcji)
  "invalid_audit_action",
  STRAZNIK_TENANTA,
] as const;

/** Lejek Google Ads - `adsFunnelApi` (kampanie, koszty, raport, eksport konwersji). */
const KODY_LEJKA_REKLAM = [
  // admin_event_ad_campaigns_list / _save / _delete
  "invalid_payload",
  "not_found",
  "invalid_match_kind",
  "invalid_match_value",
  "invalid_label",
  "invalid_conversion_name",
  "campaign_exists",
  // admin_event_ad_costs_list / _save / admin_event_ad_cost_delete
  "invalid_source",
  "invalid_rows",
  "invalid_cost_row",
  "duplicate_cost_day",
  // admin_event_ads_funnel / admin_event_ads_conversions_export
  "invalid_window",
  STRAZNIK_TENANTA,
] as const;

/** Powierzchnia uczestnika - `publicEventApi` (agenda, zakładki, lista osób). */
const KODY_UCZESTNIKA = [
  // event_session_signup
  "forbidden",
  "invalid_payload",
  "invalid_status",
  "not_found",
  "overlap_conflict",
  "signup_disabled",
  "tier_required",
  // event_bookmark_toggle / event_bookmarks_mine / event_attendees
  "auth_required",
  "invalid_scope",
  // event_meeting_directory_visibility_set
  "requester_not_participating",
] as const;

/** Studio wydarzenia - `eventDetailApi`, `eventPagesApi`. */
const KODY_STUDIA = [
  "invalid_event_type",
  "publish_blocked",
  // admin_event_general_save
  "cover_required",
  "external_url_invalid",
  "external_url_required",
  "invalid_capacity",
  "invalid_currency",
  "invalid_ends_at",
  "invalid_event",
  "invalid_format",
  "invalid_guest_mode",
  "invalid_hashtag",
  "invalid_join_url",
  "invalid_languages",
  "invalid_price",
  "invalid_recording_url",
  "invalid_registration_flow",
  "invalid_registration_mode",
  "invalid_slug",
  "invalid_starts_at",
  "invalid_support_email",
  "invalid_tier_rank",
  "invalid_titles",
  "invalid_video_platform",
  "invalid_visibility",
  "not_found",
  "slug_taken",
  // admin_event_set_status
  "invalid_status",
  // admin_event_branding_save
  "invalid_appearance",
  "invalid_color",
  "invalid_image",
  // admin_event_page_upsert / _detach / _create
  "invalid_group",
  "invalid_icon",
  "invalid_page",
  "module_page",
  "invalid_builder_data",
  // admin_event_features_save
  "invalid_feature",
  // admin_event_participant_settings_get / _save (F1-F5, `participantSettingsApi`).
  // `survey_locked` (wyzwalacz toru C na tym samym RPC) dopisuje tor C przez
  // `PF_C_EXTRA_CODES`, gdy jego migracja wyląduje - klucz i18n już jest.
  "invalid_request",
  "invalid_boolean",
  "invalid_reminder_leads",
  "invalid_session_lead",
  "invalid_transfer_deadline",
  "invalid_refund_mode",
  "invalid_refund_deadline",
  "invalid_offer_hours",
  "invalid_certificate_eligibility",
  "invalid_certificate_min_sessions",
  "invalid_certificate_hours",
  "invalid_text_length",
  "invalid_survey_close_days",
  "invalid_survey_min_results",
  STRAZNIK_TENANTA,
] as const;

/** Nabór prelegentów, panel organizatora - `cfpApi` (f1). */
const KODY_NABORU_PANEL = [
  // ustawienia (`admin_event_cfp_settings_save`)
  "invalid_status",
  "invalid_window",
  "invalid_texts",
  "invalid_formats",
  "invalid_tracks",
  "invalid_limit",
  "invalid_score_max",
  "invalid_min_reviews",
  "invalid_criteria",
  "invalid_group",
  "invalid_ticket",
  "score_max_below_reviews",
  // pytania formularza (`admin_event_cfp_field_upsert` / `_fields_reorder`)
  "invalid_key",
  "key_taken",
  "key_immutable",
  "invalid_field_type",
  "invalid_labels",
  "invalid_help",
  "invalid_options",
  "invalid_order",
  // decyzja i przyjęcie (`admin_event_cfp_submission_decide` / `_accept`)
  "invalid_transition",
  "note_required",
  "invalid_note",
  "invalid_schedule",
  "invalid_format",
  "room_not_found",
  "track_not_found",
  "room_conflict",
  // szkic sesji z przyjęcia przechodzi przez wyzwalacze sesji
  // (20260823140000_event_sessions.sql) - skan nie schodzi w wyzwalacze.
  "session_before_event",
  "session_after_event",
  "speaker_overlap",
  // recenzenci i materiały (`admin_event_cfp_material_publish` odmawia
  // publikacji materiału tylko dla organizatorów)
  "reviewer_not_found",
  "invalid_visibility",
  // wspólne
  "invalid_payload",
  "not_found",
  // most CRM (`_event_person_crm_sync` -> wpis historii)
  "invalid_audit_action",
  STRAZNIK_TENANTA,
] as const;

/** Nabór prelegentów, strona zgłoszenia i panele prelegenta/recenzenta - `cfpPublicApi` (f1). */
const KODY_NABORU_UCZESTNIK = [
  "auth_required",
  "rate_limited",
  "rate_limit_hit",
  "not_found",
  "invalid_payload",
  "invalid_transition",
  // szkic i wysłanie (`event_cfp_submission_save` / `_submit`)
  "cfp_closed",
  "limit_reached",
  "not_editable",
  "email_required",
  "email_in_use",
  // zgoda na przetwarzanie danych tylko z jawnego zaznaczenia (`_event_cfp_resolve_person`)
  "consent_required",
  "invalid_name",
  "invalid_speaker",
  "invalid_title",
  "invalid_abstract",
  "invalid_language",
  "invalid_format",
  "invalid_track",
  "invalid_topics",
  "invalid_answers",
  "invalid_role",
  "invalid_speakers",
  "co_speakers_disabled",
  "too_many_speakers",
  "missing_title",
  "missing_abstract",
  "missing_format",
  "missing_track",
  "missing_required_fields",
  // panel prelegenta (profil, materiały)
  "not_speaker",
  "invalid_profile",
  "invalid_kind",
  "invalid_url",
  "invalid_visibility",
  "invalid_session",
  "invalid_submission",
  "too_many_materials",
  // panel recenzenta
  "not_reviewer",
  "invalid_recommendation",
  "invalid_scores",
  "invalid_score",
  "score_required",
  "invalid_comment",
  // most CRM przy wysłaniu zgłoszenia
  "invalid_audit_action",
] as const;

/** Dane nabywcy - wspolne dla prosby kupujacego i szkicu w studiu (`_event_invoice_buyer_clean`). */
const KODY_NABYWCY = [
  "invalid_buyer_name",
  "invalid_country",
  "invalid_tax_id",
  "tax_id_required",
  "invalid_buyer_address",
  "invalid_postal_code",
  "invalid_email",
  "invalid_po_number",
  "invalid_recipient",
] as const;

/** Faktury wydarzenia w studiu - `eventInvoicesApi` (migracja 20260927000200). */
const KODY_FAKTUR = [
  ...KODY_NABYWCY,
  // _event_invoice_draft_build / admin_event_invoice_draft_create / _update
  "invoicing_disabled",
  "invalid_kind",
  "invalid_aggregate",
  "invalid_locale",
  "invalid_vat_rate",
  "invalid_note",
  "not_found",
  "no_sources",
  "too_many_sources",
  "invalid_source",
  "duplicate_source",
  "source_not_found",
  "source_not_lead",
  "source_not_invoiceable",
  "source_plan_ticket",
  "already_invoiced",
  "currency_mismatch",
  "request_not_found",
  "invalid_payment_method",
  "not_draft",
  "no_lines",
  "too_many_lines",
  "invalid_quantity",
  "invalid_price",
  "invalid_line",
  // _event_invoice_issue_core
  "vat_exempt_basis_required",
  "negative_total",
  "mor_seller_conflict",
  "correction_target_invalid",
  "invalid_due_date",
  "source_changed",
  "buyer_mismatch",
  "operator_invoice_enabled",
  "billing_plane_unknown",
  "correction_inconsistent",
  "correction_use_full",
  // admin_event_invoice_settings_save
  "invalid_settings",
  "invalid_series",
  "series_not_distinct",
  "invalid_payment_days",
  "seller_incomplete",
  "seller_confirmation_required",
  // admin_event_invoice_cancel / _correction_create / _from_proforma / _ksef_update
  "already_cancelled",
  "reason_required",
  "ksef_locked",
  "has_corrections",
  "correction_locked",
  "invalid_correction_mode",
  "correction_exists",
  "correction_empty",
  "not_proforma",
  "proforma_already_converted",
  "ksef_not_applicable",
  "invalid_ksef_status",
  "ksef_number_required",
  "invalid_ksef_number",
  "correction_not_latest",
  // Osiagalne przez most CRM (`crm_ensure_member_company`, `_event_person_crm_sync`);
  // oba sa wolane w bloku, ktory ich blad polyka, ale skan ich nie odroznia.
  "crm",
  "invalid_audit_action",
  STRAZNIK_TENANTA,
] as const;

/** Prosba kupujacego o fakture - `myEventInvoicesApi` (plaszczyzna publiczna). */
const KODY_PROSBY_O_FAKTURE = [
  ...KODY_NABYWCY,
  "auth_required",
  "invalid_source",
  "rate_limited",
  "rate_limit_hit",
  "not_found",
  "request_window_closed",
  "already_invoiced",
  "invoicing_disabled",
  "operator_invoice",
  "request_foreign",
  "source_plan_ticket",
] as const;

/**
 * Plan sali - `seatingApi` (migracja 20260927000400). Te same glowy wracaja
 * tez jako kody odrzutow przydzialu zbiorczego (`rejected[].code`).
 */
const KODY_PLANU_SALI = [
  // admin_event_seat_map_save / _delete / _detail, admin_event_seat_maps_list
  "invalid_event",
  "invalid_name",
  "name_taken",
  "invalid_status",
  "invalid_size",
  "room_not_found",
  "session_not_found",
  "invalid_stage",
  "map_has_assignments",
  "not_found",
  // admin_event_seat_category_save / _delete
  "invalid_key",
  "key_taken",
  "invalid_names",
  "invalid_color",
  "invalid_payload",
  "ticket_not_found",
  "category_in_use",
  // admin_event_seat_section_save / _delete
  "invalid_label",
  "label_taken",
  "category_not_found",
  "invalid_shape",
  "map_too_large",
  "seats_in_use",
  "section_has_assignments",
  // admin_event_seats_update
  "too_many_seats",
  "seat_not_found",
  "invalid_note",
  "seat_assigned",
  "company_not_found",
  "sponsor_not_found",
  "package_not_found",
  // admin_event_seat_assign / _assign_batch / _release
  "seat_blocked",
  "registration_not_found",
  "registration_not_seatable",
  "seat_held_for_other",
  "category_ticket_mismatch",
  "seat_taken",
  "swap_not_allowed",
  "too_many_items",
  // admin_event_seat_lookup
  "too_many_ids",
  STRAZNIK_TENANTA,
] as const;
/**
 * Kod dopisany przez tor do ISTNIEJĄCEJ mapy: `[nazwa mapy, kod]`.
 * `PF_<X>_BEZ_INTERPOLACJI` - nazwy NOWYCH map toru, które wołają `t()`
 * bez parametrów (sprawdzenie „zdania bez interpolacji" niżej).
 */
type PfExtraCode = readonly [mapName: string, code: string];

// >>> PF-A codes (begin)
const PF_A_EXTRA_CODES: readonly PfExtraCode[] = [];
const PF_A_BEZ_INTERPOLACJI: readonly string[] = [];
// <<< PF-A codes (end)
//
// (separator bloków - tych dwóch linii nie edytuje żaden tor)
// >>> PF-B codes (begin)
const PF_B_EXTRA_CODES: readonly PfExtraCode[] = [];
const PF_B_BEZ_INTERPOLACJI: readonly string[] = [];
// <<< PF-B codes (end)
//
// (separator bloków - tych dwóch linii nie edytuje żaden tor)
// >>> PF-C codes (begin)
const PF_C_EXTRA_CODES: readonly PfExtraCode[] = [];
const PF_C_BEZ_INTERPOLACJI: readonly string[] = [];
// <<< PF-C codes (end)

/** Kody dopisane przez tory A/B/C do mapy o danej nazwie. */
function pfExtraCodes(nazwa: string): string[] {
  return [...PF_A_EXTRA_CODES, ...PF_B_EXTRA_CODES, ...PF_C_EXTRA_CODES]
    .filter(([mapName]) => mapName === nazwa)
    .map(([, code]) => code);
}

/**
 * Klon edycji - `eventCloneApi` (migracja 20260927000800): klon, podglad,
 * lista edycji i wyszukiwarka zrodla (`admin_events_list`).
 */
const KODY_KLONU = [
  // admin_event_clone - idempotencja komendy
  "invalid_idempotency_key",
  "idempotency_conflict",
  "clone_in_progress",
  // _event_clone_settings
  "invalid_code_suffix",
  "invalid_task_due_days",
  // _event_clone_resolve
  "invalid_source",
  "not_found",
  "invalid_timezone",
  "invalid_starts_at",
  "invalid_ends_at",
  // admin_event_clone - pola nowej edycji i okno sesji
  "invalid_titles",
  "invalid_slug",
  "slug_taken",
  "external_url_required",
  "external_url_invalid",
  "clone_sessions_outside_window",
  STRAZNIK_TENANTA,
] as const;

interface BramkowanaMapa {
  nazwa: string;
  prefix: string;
  klucz: (error: unknown) => string;
  kody: readonly string[];
  /** Nakładka, w której klucze tego modułu muszą stać. */
  nakladka: string;
  pl: ResourceTree;
  en: ResourceTree;
  /**
   * Moduły `src/lib/events/<nazwa>.ts`, których ekrany czytają tę mapę. Z nich
   * skan bierze nazwy `supabase.rpc("…")` i schodzi do ciał funkcji w SQL-u.
   */
  moduly: readonly string[];
  /**
   * Czy mapa przekazuje parametry do `i18n.t()`. Trzy mapy panelu wyciągają
   * liczby z ogona komunikatu; studio i powierzchnia uczestnika wołają `t()`
   * z SAMYM kluczem - i dlatego ich zdania nie mogą mieć miejsc interpolacji.
   */
  interpoluje: boolean;
}

const MAPY: readonly BramkowanaMapa[] = [
  {
    nazwa: "adminRegistrationErrors",
    prefix: "adminEventRegistration.errors.",
    klucz: (error) => adminRegistrationFailure(error).key,
    kody: [...KODY_REJESTRACJI, ...pfExtraCodes("adminRegistrationErrors")],
    nakladka: "src/lib/i18n-admin-event-registration.ts",
    pl: adminEventRegistrationPl,
    en: adminEventRegistrationEn,
    moduly: ["registrationsApi", "packagesApi", "audienceGrantsApi", "ticketResend.functions"],
    interpoluje: true,
  },
  {
    nazwa: "adminTermsErrors",
    prefix: "adminEventTerms.errors.",
    klucz: (error) => adminTermsFailure(error).key,
    kody: [...KODY_GRUP_I_ZGOD, ...pfExtraCodes("adminTermsErrors")],
    nakladka: "src/lib/i18n-admin-event-terms.ts",
    pl: adminEventTermsPl,
    en: adminEventTermsEn,
    moduly: ["termsGroupsApi"],
    interpoluje: true,
  },
  {
    nazwa: "adminOnsiteErrors",
    prefix: "adminEventOnsite.errors.",
    klucz: (error) => adminOnsiteFailure(error).key,
    kody: [...KODY_ONSITE, ...pfExtraCodes("adminOnsiteErrors")],
    nakladka: "src/lib/i18n-admin-event-onsite.ts",
    pl: adminEventOnsitePl,
    en: adminEventOnsiteEn,
    moduly: ["onsiteApi"],
    interpoluje: true,
  },
  {
    nazwa: "adminAdsFunnelErrors",
    prefix: "adminEventAdsFunnel.errors.",
    klucz: (error) => adminAdsFunnelFailure(error).key,
    kody: KODY_LEJKA_REKLAM,
    nakladka: "src/lib/i18n-admin-event-ads-funnel.ts",
    pl: adminEventAdsFunnelPl,
    en: adminEventAdsFunnelEn,
    moduly: ["adsFunnelApi"],
    interpoluje: true,
  },
  {
    nazwa: "publicEventErrors",
    prefix: "eventFront.errors.",
    klucz: publicEventErrorKey,
    kody: [...KODY_UCZESTNIKA, ...pfExtraCodes("publicEventErrors")],
    nakladka: "src/lib/i18n-event-front.ts",
    pl: eventFrontPl,
    en: eventFrontEn,
    moduly: ["publicEventApi"],
    interpoluje: false,
  },
  {
    nazwa: "adminSponsorReportErrors",
    prefix: "adminEventSponsorReport.errors.",
    klucz: (error) => adminSponsorReportFailure(error).key,
    kody: KODY_RAPORTU_SPONSORA,
    nakladka: "src/lib/i18n-admin-event-sponsor-report.ts",
    pl: adminEventSponsorReportPl,
    en: adminEventSponsorReportEn,
    moduly: ["sponsorReportApi"],
    interpoluje: true,
  },
  {
    nazwa: "adminEventStudioErrors",
    prefix: "adminEvents.studio.errors.",
    klucz: adminEventStudioErrorKey,
    kody: [...KODY_STUDIA, ...pfExtraCodes("adminEventStudioErrors")],
    nakladka: "src/lib/i18n-admin-events.ts",
    pl: adminEventsPl,
    en: adminEventsEn,
    moduly: ["eventDetailApi", "eventPagesApi", "participantSettingsApi"],
    interpoluje: false,
  },
  {
    nazwa: "adminCfpErrors",
    prefix: "adminEventCfp.errors.",
    klucz: (error) => adminCfpFailure(error).key,
    kody: KODY_NABORU_PANEL,
    nakladka: "src/lib/i18n-admin-event-cfp.ts",
    pl: adminEventCfpPl,
    en: adminEventCfpEn,
    moduly: ["cfpApi"],
    interpoluje: true,
  },
  {
    nazwa: "publicCfpErrors",
    prefix: "eventCfp.errors.",
    klucz: (error) => publicCfpFailure(error).key,
    kody: KODY_NABORU_UCZESTNIK,
    nakladka: "src/lib/i18n-event-cfp.ts",
    pl: eventCfpPl,
    en: eventCfpEn,
    moduly: ["cfpPublicApi"],
    interpoluje: true,
  },
  {
    nazwa: "adminEventInvoiceErrors",
    prefix: "adminEventInvoices.errors.",
    klucz: adminEventInvoiceErrorKey,
    kody: KODY_FAKTUR,
    nakladka: "src/lib/i18n-admin-event-invoices.ts",
    pl: adminEventInvoicesPl,
    en: adminEventInvoicesEn,
    moduly: ["eventInvoicesApi"],
    interpoluje: false,
  },
  {
    nazwa: "eventInvoiceErrors",
    prefix: "eventInvoices.errors.",
    klucz: eventInvoiceErrorKey,
    kody: KODY_PROSBY_O_FAKTURE,
    nakladka: "src/lib/i18n-event-invoices.ts",
    pl: eventInvoicesPl,
    en: eventInvoicesEn,
    moduly: ["myEventInvoicesApi"],
    interpoluje: false,
  },
  {
    nazwa: "adminCloneErrors",
    prefix: "adminEventClone.errors.",
    klucz: (error) => adminCloneFailure(error).key,
    kody: KODY_KLONU,
    nakladka: "src/lib/i18n-admin-event-clone.ts",
    pl: adminEventClonePl,
    en: adminEventCloneEn,
    moduly: ["eventCloneApi"],
    interpoluje: true,
  },
  {
    nazwa: "adminSeatingErrors",
    prefix: "adminEventSeating.errors.",
    klucz: (error) => adminSeatingFailure(error).key,
    kody: KODY_PLANU_SALI,
    nakladka: "src/lib/i18n-admin-event-seating.ts",
    pl: adminEventSeatingPl,
    en: adminEventSeatingEn,
    moduly: ["seatingApi"],
    interpoluje: true,
  },
  // >>> PF-A maps (begin)
  // <<< PF-A maps (end)
  //
  // (separator bloków - tych dwóch linii nie edytuje żaden tor)
  // >>> PF-B maps (begin)
  // <<< PF-B maps (end)
  //
  // (separator bloków - tych dwóch linii nie edytuje żaden tor)
  // >>> PF-C maps (begin)
  // <<< PF-C maps (end)
];

describe.each(MAPY)("bramka kluczy i18n: $nazwa", (mapa) => {
  const awaryjny = `${mapa.prefix}unknown`;
  const klucze = mapa.kody.map((kod) => ({ kod, klucz: mapa.klucz(new Error(`${kod}: detail`)) }));

  it("bramka mierzy niepustą listę kluczy", () => {
    // Bez tego przypadku pomyłka w budowie listy (pusta tablica, zły filtr)
    // dawałaby ZIELONĄ bramkę mierzącą pustkę - najgorszy możliwy wynik, bo
    // wygląda jak dowód.
    expect(klucze.length).toBeGreaterThan(0);
    expect(new Set(mapa.kody).size).toBe(mapa.kody.length);
  });

  it("żaden kod z migracji nie degraduje do zdania awaryjnego", () => {
    // Degradacja znaczy albo brak wpisu w nakładce, albo literówkę w kodzie
    // SQL-a. Jedno i drugie kończy się komunikatem bez powodu odmowy.
    const zdegradowane = klucze.filter((wpis) => wpis.klucz === awaryjny).map((wpis) => wpis.kod);
    expect(zdegradowane, `dopisz je w ${mapa.nakladka}`).toEqual([]);
  });

  it.each(klucze)("klucz $klucz stoi w nakładce po polsku i po angielsku", ({ klucz }) => {
    // `i18n.t()` na nieznanym kluczu oddaje SAM KLUCZ, a nie pusty napis - brak
    // wpisu w jednym języku pokazuje kropkowaną ścieżkę tylko części
    // użytkowników i dlatego potrafi przeżyć w produkcji miesiącami.
    expect(maTekst(mapa.pl, klucz), `brak PL: ${klucz} (${mapa.nakladka})`).toBe(true);
    expect(maTekst(mapa.en, klucz), `brak EN: ${klucz} (${mapa.nakladka})`).toBe(true);
  });

  it("zdanie awaryjne modułu też stoi w nakładce w obu językach", () => {
    // Klucz, do którego spada KAŻDA nierozpoznana odmowa. Jego brak zamienia
    // każdy nieznany błąd w surową ścieżkę i18n - w tym miejscu byłby to
    // pojedynczy punkt awarii całej mapy.
    expect(maTekst(mapa.pl, awaryjny), `brak PL: ${awaryjny}`).toBe(true);
    expect(maTekst(mapa.en, awaryjny), `brak EN: ${awaryjny}`).toBe(true);
    expect(i18n.t(awaryjny)).not.toContain(mapa.prefix);
  });

  it("ręczna lista kodów nadąża za migracjami", () => {
    // LISTA WYŻEJ JEST PRZEPISANA RĘCZNIE, a więc starzeje się po cichu: nowy
    // `RAISE EXCEPTION` w migracji nie dopisuje się do niej sam, przechodzi
    // `tsc`, przechodzi lint i przechodzi parytet PL/EN (klucza nie ma w ŻADNYM
    // języku, więc parytet go nie widzi). Cała reszta tej bramki byłaby wtedy
    // ZIELONA, bo mierzyłaby wyłącznie kody, o których ktoś pamiętał.
    //
    // Dlatego listę konfrontujemy z drzewem `supabase/migrations`: skan bierze
    // nazwy `supabase.rpc("…")` z modułów klienckich tej mapy i schodzi w ciała
    // funkcji razem z ich wywołaniami (`assert_event_admin_tenant()` podnosi
    // `forbidden` przed ciałem każdej funkcji panelu, a odprawę zapisuje
    // `_event_checkin_write()` - bez domknięcia po wywołaniach nie byłoby
    // widać ani strażnika tenanta, ani połowy kodów odprawy).
    //
    // ZMIERZONE: to sprawdzenie znalazło `template_missing`
    // i `template_not_in_event`, których lista on-site nie miała.
    const skan = scanRaiseCodes(mapa.moduly);
    expect(skan.missingFunctions, "RPC bez definicji w migracjach").toEqual([]);
    // Pusty skan (zła ścieżka, zmieniony kształt `rpc("…")`) wyglądałby jak
    // „moduł bez odmów", czyli jak sukces - stąd dolne ograniczenie.
    expect(skan.functions.length).toBeGreaterThan(0);
    expect(skan.codes.length).toBeGreaterThan(0);
    const nieobjete = skan.codes.filter((kod) => !mapa.kody.includes(kod));
    expect(nieobjete, `dopisz je do listy tej mapy i do ${mapa.nakladka}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// MAPY, KTÓRE WOŁAJĄ `i18n.t()` BEZ PARAMETRÓW.
//
// Studio wydarzenia i powierzchnia uczestnika nie czytają liczb z ogona - nie
// mają `paramsOf()`. Miejsce interpolacji w ICH słowniku nie ma więc czym się
// wypełnić i pokaże się na ekranie jako surowe wąsy. Żadna inna bramka tego nie
// widzi: klucz istnieje, stoi w obu językach, parytet jest zielony.
// ---------------------------------------------------------------------------
const BEZ_INTERPOLACJI = MAPY.filter((mapa) => !mapa.interpoluje);

describe("zdania bez interpolacji", () => {
  it("bramka mierzy dokładnie te mapy, które wołają `t()` bez parametrów", () => {
    // Lista powstaje z filtra, więc przestawiona flaga zamieniłaby tę bramkę
    // w ZIELONĄ pustkę (`describe.each([])` nie zgłasza nic). Wymieniamy oba
    // moduły z nazwy także po to, żeby dołożenie `paramsOf()` do którejś z tych
    // map było świadomą zmianą TU, a nie cichym wyłączeniem sprawdzenia.
    // Mapy torów F1-F5 stoją w blokach `maps` w kolejności A, B, C, więc
    // lista dokłada ich nazwy w tej samej kolejności.
    expect(BEZ_INTERPOLACJI.map((mapa) => mapa.nazwa)).toEqual([
      "publicEventErrors",
      "adminEventStudioErrors",
      "adminEventInvoiceErrors",
      "eventInvoiceErrors",
      ...PF_A_BEZ_INTERPOLACJI,
      ...PF_B_BEZ_INTERPOLACJI,
      ...PF_C_BEZ_INTERPOLACJI,
    ]);
  });
});

describe.each(BEZ_INTERPOLACJI)("zdania bez interpolacji: $nazwa", (mapa) => {
  it("żadne zdanie odmowy tego modułu nie ma miejsca interpolacji", () => {
    // Sprawdzamy CAŁĄ gałąź `errors`, a nie tylko klucze użyte w przypadkach:
    // wąsy dopisane do klucza, którego dziś nikt nie testuje, wyszłyby dopiero
    // u redaktora albo u uczestnika.
    for (const [jezyk, slownik] of [
      ["pl", mapa.pl],
      ["en", mapa.en],
    ] as const) {
      const galaz = readKey(slownik, mapa.prefix.slice(0, -1));
      expect(typeof galaz, `brak gałęzi ${mapa.prefix} w ${jezyk}`).toBe("object");
      for (const [klucz, zdanie] of Object.entries(galaz as Record<string, unknown>)) {
        if (typeof zdanie !== "string") continue;
        expect(zdanie, `${jezyk}: ${klucz} ma interpolację, której mapa nie wypełni`).not.toContain(
          "{{",
        );
      }
    }
  });
});
