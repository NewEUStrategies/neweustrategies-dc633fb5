// BRAMKA DOSTAWY HUBA „PRZYCHÓD I LEJEK" - rejestr wycinków, bloków wersji
// migracji, właścicieli funkcji SQL i plików, z czystą analizą (bez dysku).
//
// DLACZEGO TO ISTNIEJE. Hub powstaje w dziesięciu wycinkach (I0, S1-S8, I9),
// z czego osiem pracuje RÓWNOLEGLE w osobnych gałęziach. Dwie klasy kolizji
// nie wychodzą w żadnym teście pojedynczego wycinka, tylko przy scaleniu:
//   * dwie migracje z różnych wycinków redefiniują tę samą funkcję SQL -
//     wygrywa późniejsza WERSJA, a nie późniejszy merge, więc poprawka jednego
//     wycinka znika po cichu na produkcji;
//   * wycinek zmienia plik współdzielony (`types.ts`, mapa inwalidacji,
//     `routeTree.gen.ts`, dziennik drizzle) - konflikt rozwiązywany ręcznie
//     przy scaleniu gubi czyjś wpis.
// Rejestr zamraża więc w I0, KTO jest właścicielem każdej funkcji i każdego
// pliku, a bramka (test + `scripts/hub-slice-guard.ts`) odrzuca odstępstwa,
// zanim wycinek trafi do gałęzi integracyjnej.
//
// ZAKRES SKANU: WYŁĄCZNIE blok huba [20261020090000, 20261020170000).
// Specyfikacja mówiła „wersje > 20261018120400", ale cennik v6.2 wszedł
// później (20261018160000…160400) - taki próg łapał jego funkcje, które do
// huba nie należą.
//
// REDEFINICJA FUNKCJI SPRZED HUBA wymaga znacznika `-- CIALO-Z: <wersja>`
// z wersją NAJNOWSZEJ wcześniejszej definicji (`HUB_CIALO_Z`). Autor
// przepisuje ciało z tej wersji - starsze ciało przywróciłoby naprawione
// błędy (np. `uuid = text` w `run_workflow_step` sprzed 20261007140700).
// Gdy analiza dostaje też migracje sprzed huba, sprawdza, że rejestr nadal
// wskazuje najnowszą definicję (nowa definicja na `main` = czerwień).
//
// Moduł nie importuje niczego z dysku: dane wchodzą parametrami, więc ten sam
// kod obsługuje test (fikstury w pamięci) i cienki runner w `scripts/`.

/** Wycinki w kolejności planu (§8.1 specyfikacji). */
export const HUB_SLICE_IDS = ["I0", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "I9"] as const;
export type HubSliceId = (typeof HUB_SLICE_IDS)[number];

/** Wycinki równoległe - ich zbiory plików są parami rozłączne. */
export const HUB_PARALLEL_SLICES: readonly HubSliceId[] = [
  "S1",
  "S2",
  "S3",
  "S4",
  "S5",
  "S6",
  "S7",
  "S8",
];

/** Zakres wersji migracji huba: [from, until). */
export const HUB_VERSION_RANGE = { from: "20261020090000", until: "20261020170000" } as const;

/**
 * Prefiks wersji (RRRRMMDDGG) bloku migracji wycinka. S6 i S8 nie mają SQL,
 * więc nie mają bloku - każda ich migracja jest poza blokiem.
 */
export const HUB_VERSION_BLOCKS: Readonly<Partial<Record<HubSliceId, string>>> = {
  I0: "2026102009",
  S1: "2026102010",
  S2: "2026102011",
  S3: "2026102012",
  S4: "2026102013",
  S5: "2026102014",
  S7: "2026102015",
  I9: "2026102016",
};

/**
 * Rodzaj funkcji wg macierzy grantów (§4.4 specyfikacji):
 *   panel    - RPC panelu, EXECUTE dla authenticated (funkcja sama sprawdza rolę);
 *   reader   - wywoływana przez zalogowanego czytelnika (bez bramki roli);
 *   service  - wyłącznie service_role (runner, webhook, skanery);
 *   internal - helper bez EXECUTE dla ról API (poza wyjątkami parytetu);
 *   trigger  - funkcja wyzwalacza.
 * Dla `service`, `internal` i `trigger` GRANT dla authenticated jest błędem.
 */
export type HubFunctionKind = "panel" | "reader" | "service" | "internal" | "trigger";

/** Obszary faktów diagnostyki (S7, `_revenue_facts_<obszar>`). */
export const HUB_FACT_AREAS = [
  "catalog",
  "paywall",
  "metering",
  "checkout",
  "coupons",
  "retention",
  "dunning",
  "funnel",
  "crm",
  "newsletter",
  "workflows",
  "journeys",
  "events",
  "clubs",
  "sync",
  "data_quality",
] as const;

type FunctionEntry = readonly [name: string, slice: HubSliceId, kind: HubFunctionKind];

// Jedna tabela zamiast dwóch map: właściciel i rodzaj nie mogą się rozjechać.
// Nazwy emiterów S1 są ustalone TERAZ jako kontrakt - wycinek, który nazwie
// emiter inaczej, zaczerwieni bramkę i musi zgłosić zmianę Integratorowi.
const FUNCTION_TABLE: readonly FunctionEntry[] = [
  // I0 - helpery wspólne (20261020090500).
  ["_log_emit_error", "I0", "internal"],
  ["_tier_rank_of", "I0", "internal"],
  ["tier_rank_of", "I0", "panel"],
  ["metering_defaults", "I0", "internal"],
  ["revenue_segment_of_tier", "I0", "internal"],
  // S1 - emitery ustawień, newsletter, kupony, nadania, zdrowie e-mail.
  ["tg_metering_settings_emit", "S1", "trigger"],
  ["tg_checkout_settings_emit", "S1", "trigger"],
  ["tg_content_access_emit", "S1", "trigger"],
  ["tg_retention_settings_emit", "S1", "trigger"],
  ["tg_retention_reasons_emit", "S1", "trigger"],
  ["tg_newsletter_settings_emit", "S1", "trigger"],
  ["tg_newsletter_subscribers_emit_events", "S1", "trigger"],
  ["tg_b2b_coupons_emit", "S1", "trigger"],
  ["tg_b2b_coupon_campaigns_emit", "S1", "trigger"],
  ["tg_b2b_coupon_redemptions_emit", "S1", "trigger"],
  ["admin_newsletter_settings_patch", "S1", "panel"],
  ["admin_coupon_campaign_set_status", "S1", "panel"],
  ["admin_revenue_email_health", "S1", "panel"],
  ["admin_membership_grant_set", "S1", "panel"],
  ["admin_membership_grant_revoke", "S1", "panel"],
  // S2 - księga MRR, windykacja, przychód zrealizowany, retencja, dane wejściowe.
  ["billing_catalog_entry", "S2", "internal"],
  ["billing_months_per_interval", "S2", "internal"],
  ["subscription_mrr_minor", "S2", "internal"],
  ["tg_subscriptions_revenue_history", "S2", "trigger"],
  ["tg_billing_documents_renewed_emit", "S2", "trigger"],
  ["_revenue_mrr_at", "S2", "internal"],
  ["_revenue_movements", "S2", "internal"],
  ["_revenue_realized", "S2", "internal"],
  ["admin_revenue_semantic_snapshot", "S2", "panel"],
  ["admin_revenue_mrr_bridge", "S2", "panel"],
  ["admin_revenue_mrr_series", "S2", "panel"],
  ["admin_revenue_churn", "S2", "panel"],
  ["admin_revenue_cohorts", "S2", "panel"],
  ["admin_revenue_dunning", "S2", "panel"],
  ["admin_revenue_realized", "S2", "panel"],
  ["run_revenue_lifecycle_scanner", "S2", "service"],
  ["tg_retention_feedback_emit", "S2", "trigger"],
  ["run_retention_flow_scanner", "S2", "service"],
  ["admin_revenue_retention_offers", "S2", "panel"],
  ["admin_revenue_offer_matrix", "S2", "panel"],
  ["admin_revenue_inputs", "S2", "panel"],
  ["admin_revenue_input_upsert", "S2", "panel"],
  ["admin_revenue_economics", "S2", "panel"],
  // S3 - lejek, paywall czytelnika, licznik, kasa.
  ["tg_profiles_account_registered_emit", "S3", "trigger"],
  ["record_paywall_hit", "S3", "reader"],
  ["record_paywall_hit_visitor", "S3", "service"],
  ["_metered_view_consume", "S3", "internal"],
  ["log_metering_event", "S3", "reader"],
  ["tg_payment_orders_checkout_emit", "S3", "trigger"],
  ["_funnel_counts", "S3", "internal"],
  ["admin_revenue_funnel", "S3", "panel"],
  ["admin_revenue_access_inventory", "S3", "panel"],
  // S4 - CRM, automatyzacje, społeczność.
  ["tg_crm_leads_stage_history", "S4", "trigger"],
  ["crm_set_lifecycle_stage", "S4", "service"],
  ["admin_crm_set_lifecycle_stage", "S4", "panel"],
  // Pomocnik poprawki D10 (zakup podnosi `source_type`) - nazwa z projektu
  // danych (§7.7), zarezerwowana tu, żeby S4 nie musiał zgłaszać jej osobno.
  ["_crm_source_type_rank", "S4", "internal"],
  ["crm_upsert_lead_from_profile", "S4", "service"],
  ["run_workflow_step", "S4", "service"],
  ["newsletter_subscriber_list_set", "S4", "service"],
  ["tg_run_workflows_for_event", "S4", "trigger"],
  ["install_workflow_template", "S4", "panel"],
  ["tg_workflow_definitions_emit", "S4", "trigger"],
  ["admin_dashboard_crm", "S4", "panel"],
  ["tg_club_applications_emit", "S4", "trigger"],
  ["club_application_crm_sync", "S4", "service"],
  ["tg_event_registrations_attended_emit", "S4", "trigger"],
  ["_event_revenue_net", "S4", "internal"],
  ["admin_event_ads_funnel", "S4", "panel"],
  ["admin_revenue_events_summary", "S4", "panel"],
  ["admin_revenue_clubs_summary", "S4", "panel"],
  // S5 - silnik ścieżek.
  ["tg_journey_route_event", "S5", "trigger"],
  ["journey_ingest_inbox", "S5", "service"],
  ["journey_resolve_lead", "S5", "service"],
  ["journey_claim_due", "S5", "service"],
  ["journey_advance", "S5", "service"],
  ["journey_fail_step", "S5", "service"],
  ["journey_tick_emit_stats", "S5", "service"],
  ["journey_purge", "S5", "service"],
  ["_membership_tier_for_user", "S5", "internal"],
  ["journey_eval_predicate", "S5", "internal"],
  ["journey_can_send", "S5", "service"],
  ["journey_contact_for_send", "S5", "service"],
  ["journey_validate_graph", "S5", "internal"],
  ["admin_journey_create", "S5", "panel"],
  ["admin_journey_save_draft", "S5", "panel"],
  ["admin_journey_publish", "S5", "panel"],
  ["admin_journey_set_status", "S5", "panel"],
  ["admin_journey_email_content_save", "S5", "panel"],
  ["admin_journey_settings_save", "S5", "panel"],
  ["admin_journey_list", "S5", "panel"],
  ["admin_journey_enrollments", "S5", "panel"],
  ["admin_journey_lead_enrollments", "S5", "panel"],
  ["admin_journey_enroll_test", "S5", "panel"],
  ["admin_journey_enrollment_skip_wait", "S5", "panel"],
  ["admin_journey_enrollment_exit", "S5", "panel"],
  ["admin_journey_trigger_estimate", "S5", "panel"],
  ["admin_journey_simulate", "S5", "panel"],
  ["admin_journey_engine_health", "S5", "panel"],
  ["journey_complete_email_step", "S5", "service"],
  ["journey_record_message_event", "S5", "service"],
  ["admin_journey_stats", "S5", "panel"],
  ["admin_journey_series", "S5", "panel"],
  ["journey_rollup_daily", "S5", "service"],
  ["email_apply_delivery_event", "S5", "service"],
  // (Integrator S5, 2026-10-20): pomocnicze silnika rozpisane przy wykonaniu
  // (wewnętrzne - REVOKE od wszystkich ról, woła je wyłącznie SQL S5) oraz
  // odczyt ustawień silnika dla panelu (wymóg właściciela: każdy przełącznik
  // w panelu admina, także stan „brak wiersza = wartości domyślne").
  ["_journey_enroll", "S5", "internal"],
  ["_journey_node", "S5", "internal"],
  ["_journey_edge", "S5", "internal"],
  ["_journey_next_time", "S5", "internal"],
  ["_journey_exec_action", "S5", "internal"],
  ["_journey_marketing_consent", "S5", "internal"],
  ["_journey_eval_predicate", "S5", "internal"],
  ["_journey_quiet_until", "S5", "internal"],
  ["_journey_num", "S5", "internal"],
  ["_journey_send_verdict", "S5", "internal"],
  ["_journey_message_id", "S5", "internal"],
  ["_journey_unsubscribe", "S5", "internal"],
  ["_journey_staff_tenant", "S5", "internal"],
  ["admin_journey_settings_get", "S5", "panel"],
  // S7 - diagnostyka.
  ...HUB_FACT_AREAS.map((area): FunctionEntry => [`_revenue_facts_${area}`, "S7", "internal"]),
  ["admin_revenue_facts", "S7", "panel"],
  ["admin_revenue_diagnostic_snooze", "S7", "panel"],
  ["admin_revenue_diagnostic_unsnooze", "S7", "panel"],
  ["admin_revenue_diagnostic_snoozes", "S7", "panel"],
  // I9 - decyzje właściciela z 2026-10-20 (I9b): katalog cennika v6.2
  // (redefinicje sprzed huba, `HUB_CIALO_Z`), limit miejsc Zespołu i RODO
  // księgi MRR (redakcja śladów operatora po usunięciu subskrypcji/konta).
  ["pricing_catalog_v62_rows", "I9", "service"],
  ["pricing_catalog_v62_benefits", "I9", "service"],
  ["_pricing_v62_owner_decisions", "I9", "internal"],
  ["tg_member_organizations_team_seat_cap", "I9", "trigger"],
  ["tg_organization_seats_team_seat_cap", "I9", "trigger"],
  ["_revenue_segments_recompute", "I9", "internal"],
  ["_revenue_ledger_redact_subscription", "I9", "internal"],
  ["_revenue_ledger_redact_orphans", "I9", "internal"],
  ["tg_subscriptions_revenue_redact", "I9", "trigger"],
  ["tg_auth_users_revenue_redact", "I9", "trigger"],
  // (I9b-A2, 2026-10-20) RODO po usunięciu konta (Z-I9b-03/04/05): pseudonim
  // zastępczy lejka, redakcja szyny i jej kopii, wyjście ze ścieżek, odcięcie
  // CRM/newslettera, autorzy konfiguracji, audyt; wyzwalacz AFTER DELETE na
  // `auth.users` i domknięcie wstecz.
  ["_hub_erasure_surrogate", "I9", "internal"],
  ["_funnel_erase_account", "I9", "internal"],
  ["_hub_erasure_payload", "I9", "internal"],
  ["_hub_erasure_text", "I9", "internal"],
  ["_domain_events_erase_account", "I9", "internal"],
  ["_journeys_erase_account", "I9", "internal"],
  ["_hub_account_erase", "I9", "internal"],
  ["_hub_account_erase_orphans", "I9", "internal"],
  ["tg_auth_users_hub_erasure", "I9", "trigger"],
  // (I9c, 2026-10-20) RODO po usunięciu konta - domknięcia po A2 (Z-I9b-11
  // i poczta w kolejce): autorzy, recenzenci i dane własne konta w modułach
  // spoza huba, anulowanie poczty konta w kolejce i pytanie drenu przed
  // wysyłką (service_role) - ten sam punkt wejścia `_hub_account_erase`.
  ["_hub_account_bound_email_labels", "I9", "internal"],
  ["_hub_account_erase_modules", "I9", "internal"],
  ["_hub_account_erase_mail_queue", "I9", "internal"],
  ["email_queue_send_recheck", "I9", "service"],
  // (I9c, 2026-10-20) Retencja danych (Z-I9b-10, polecenie właściciela):
  // ustawienia najemcy, pieczęcie agregatów (lejek, licznik, ścieżki),
  // wykonanie per kategoria, zadanie dzienne (`jobs-tick`), RPC karty
  // „Retencja danych" w `/admin/settings/privacy` oraz odczyt okien sprzed
  // progu z agregatów (redefinicje niżej i w `HUB_CIALO_Z`).
  ["_data_retention_catalog", "I9", "internal"],
  ["_data_retention_effective", "I9", "internal"],
  ["_data_retention_funnel_cut", "I9", "internal"],
  ["_data_retention_journey_sealed", "I9", "internal"],
  ["_data_retention_seal_funnel", "I9", "internal"],
  ["_journey_rollup_days", "I9", "internal"],
  ["_data_retention_seal_journeys", "I9", "internal"],
  ["_data_retention_audit_is_financial", "I9", "internal"],
  ["_data_retention_customer_until", "I9", "internal"],
  ["_data_retention_bounded", "I9", "internal"],
  ["_data_retention_paywall_metering", "I9", "internal"],
  ["_data_retention_fold_campaign_events", "I9", "internal"],
  ["_data_retention_email_engagement", "I9", "internal"],
  ["_data_retention_email_send_log", "I9", "internal"],
  ["_data_retention_crm_candidates", "I9", "internal"],
  ["_data_retention_anonymize_lead", "I9", "internal"],
  ["_data_retention_crm", "I9", "internal"],
  ["_data_retention_audit_log", "I9", "internal"],
  ["_data_retention_journey_enrollments", "I9", "internal"],
  ["_data_retention_cancellation_surveys", "I9", "internal"],
  ["_data_retention_consent_log", "I9", "internal"],
  ["_data_retention_run_tenant", "I9", "internal"],
  ["_data_retention_admin_tenant", "I9", "internal"],
  ["_data_retention_emit", "I9", "internal"],
  ["data_retention_run", "I9", "service"],
  ["admin_data_retention_get", "I9", "panel"],
  ["admin_data_retention_save", "I9", "panel"],
  ["admin_data_retention_enforcement", "I9", "panel"],
  ["admin_data_retention_preview", "I9", "panel"],
  ["admin_data_retention_crm_due", "I9", "panel"],
  ["admin_data_retention_crm_extend", "I9", "panel"],
  ["admin_data_retention_run_now", "I9", "panel"],
  // Funkcje sprzed huba czytające okna sprzed progu retencji z agregatów.
  ["monetization_dashboard", "I9", "panel"],
  ["newsletter_campaign_engagement", "I9", "panel"],
  // (I9d-Y1, 2026-10-22) RODO - decyzje właściciela 2: zgłoszenia do klubów
  // (anonimizacja po usunięciu konta i po okresie, koniec członkostwa,
  // odmowa decyzji dla zgłoszenia zanonimizowanego), odczyty licznika
  // (agregat dzienny, redakcja historii czytania), uczestnicy wydarzeń,
  // wygaszanie nieaktywnych subskrybentów newslettera (znacznik
  // zaangażowania, cykl prośby, wysyłka przez krok TS, panel listy
  // i wykluczeń).
  ["_club_applications_anonymize", "I9", "internal"],
  ["tg_club_members_membership_end", "I9", "trigger"],
  ["tg_club_members_membership_gone", "I9", "trigger"],
  ["tg_club_applications_club_detached", "I9", "trigger"],
  ["_data_retention_club_candidates", "I9", "internal"],
  ["_data_retention_club_applications", "I9", "internal"],
  ["admin_club_application_set_status", "I9", "panel"],
  ["_data_retention_backfill_metered_views", "I9", "internal"],
  ["_data_retention_metered_views", "I9", "internal"],
  ["_data_retention_event_attendee_candidates", "I9", "internal"],
  ["_data_retention_event_attendees", "I9", "internal"],
  ["_newsletter_engagement_touch", "I9", "internal"],
  ["newsletter_record_campaign_event", "I9", "service"],
  ["newsletter_engagement_touch", "I9", "service"],
  ["newsletter_sunset_keep", "I9", "service"],
  ["_newsletter_last_engagement", "I9", "internal"],
  ["_newsletter_track_opens", "I9", "internal"],
  ["_data_retention_newsletter_candidates", "I9", "internal"],
  ["_newsletter_sunset_fold_events", "I9", "internal"],
  ["_newsletter_sunset_delete", "I9", "internal"],
  ["_data_retention_newsletter_inactive", "I9", "internal"],
  ["newsletter_sunset_claim", "I9", "service"],
  ["newsletter_sunset_mark", "I9", "service"],
  ["admin_data_retention_newsletter_due", "I9", "panel"],
  ["admin_data_retention_newsletter_exclude", "I9", "panel"],
  ["admin_data_retention_newsletter_include", "I9", "panel"],
  // (I9d-Y2, 2026-10-22) Treść zgody i pomiar: jedno źródło treści domyślnej
  // i jej wersji, rejestr wersji z pomiarem, oznaczenie admina, klucz zgody
  // `email_measurement` (wyzwalacz rejestru zgód), wersja przy każdej zgodzie
  // newslettera, czytelnik zgody na pomiar i porcja dla runnerów, wycofanie
  // samego pomiaru, licznik mierzonych kampanii, ponowne potwierdzenie
  // (prośby, wspólny budżet z wygaszaniem, link) i panel.
  ["_newsletter_consent_default", "I9", "internal"],
  ["_newsletter_consent_version", "I9", "internal"],
  ["_newsletter_consent_upgrade_defaults", "I9", "internal"],
  ["_consent_measurement_versions", "I9", "internal"],
  ["_consent_text_sha256", "I9", "internal"],
  ["_consent_text_version", "I9", "internal"],
  ["_consent_covers_measurement", "I9", "internal"],
  ["tg_crm_consent_log_measurement", "I9", "trigger"],
  ["_newsletter_log_consents", "I9", "internal"],
  ["newsletter_to_lead", "I9", "trigger"],
  ["tg_newsletter_consents_log", "I9", "trigger"],
  ["_email_measurement_consent", "I9", "internal"],
  ["email_measurement_status", "I9", "service"],
  ["_email_measurement_subject", "I9", "internal"],
  ["email_measurement_state", "I9", "service"],
  ["email_measurement_withdraw", "I9", "service"],
  ["tg_newsletter_recipients_measured", "I9", "trigger"],
  ["admin_newsletter_campaign_measurement", "I9", "panel"],
  ["_newsletter_oneoff_mail_used", "I9", "internal"],
  ["_newsletter_measurement_candidates", "I9", "internal"],
  ["admin_newsletter_measurement_preview", "I9", "panel"],
  ["admin_newsletter_measurement_request", "I9", "panel"],
  ["newsletter_measurement_claim", "I9", "service"],
  ["newsletter_measurement_mark", "I9", "service"],
  ["newsletter_measurement_confirm", "I9", "service"],
  ["admin_newsletter_consent_measurement_get", "I9", "panel"],
  ["admin_newsletter_consent_measurement_mark", "I9", "panel"],
];

/** Właściciel każdej funkcji definiowanej w bloku huba. */
export const HUB_FUNCTION_OWNERS: Readonly<Record<string, HubSliceId>> = Object.freeze(
  Object.fromEntries(FUNCTION_TABLE.map(([name, slice]) => [name, slice])),
);

/** Rodzaj każdej funkcji (macierz grantów §4.4). */
export const HUB_FUNCTION_KINDS: Readonly<Record<string, HubFunctionKind>> = Object.freeze(
  Object.fromEntries(FUNCTION_TABLE.map(([name, , kind]) => [name, kind])),
);

/**
 * Funkcje sprzed huba redefiniowane w wycinkach - wersja NAJNOWSZEJ
 * wcześniejszej DEFINICJI (ciała), zweryfikowana testem na pełnym zestawie
 * migracji (`verifyCialoZRegistry`); plik z nazwą UUID ma tę wersję jako
 * prefiks.
 *
 * Dwie wartości odbiegają od tabeli §4.8 specyfikacji, bo tam wpisano
 * ostatnią migrację DOTYKAJĄCĄ funkcji, a nie ostatnią definicję:
 * `20261007140500` i `20261013090400` zmieniają wyłącznie granty
 * `crm_upsert_lead_from_profile` i `log_metering_event` (REVOKE/GRANT),
 * a ciała pochodzą z `20260722093022` i `20260721070203`. Redefinicja
 * (CREATE OR REPLACE) zachowuje ACL, ale migracja wycinka i tak powtarza
 * REVOKE/GRANT z tamtych plików - bramka wymaga REVOKE w tym samym pliku.
 */
export const HUB_CIALO_Z: Readonly<Record<string, string>> = {
  run_workflow_step: "20261007140700",
  install_workflow_template: "20260711221058",
  tg_run_workflows_for_event: "20260711221058",
  crm_upsert_lead_from_profile: "20260722093022",
  admin_dashboard_crm: "20260912110000",
  club_application_crm_sync: "20261007140710",
  admin_event_ads_funnel: "20260927001100",
  _metered_view_consume: "20261013090400",
  log_metering_event: "20260721070203",
  tg_newsletter_subscribers_emit_events: "20260711220607",
  email_apply_delivery_event: "20260725123624",
  pricing_catalog_v62_rows: "20261018160100",
  pricing_catalog_v62_benefits: "20261018160200",
  // (I9c, 2026-10-20) Retencja danych: zdarzenia licznika i zaangażowanie
  // kampanii dni sprzed progu z agregatów.
  monetization_dashboard: "20260724100000",
  newsletter_campaign_engagement: "20260814215302",
  // (I9d, 2026-10-22) Decyzje właściciela 2 (Y1): decyzja komisji klubu
  // odmawia zgłoszeniu zanonimizowanemu, zapis zdarzeń kampanii utrwala
  // zaangażowanie subskrybenta (wygaszanie nieaktywnych).
  admin_club_application_set_status: "20260811150000",
  newsletter_record_campaign_event: "20260814215302",
  // (I9d-Y2, 2026-10-22) Wersja treści przy każdej zgodzie newslettera
  // (wspólny pisarz rejestru zgód z wyzwalacza subskrybenta).
  newsletter_to_lead: "20260708151417",
};

/**
 * Funkcje INNYCH wycinków huba redefiniowane w bloku I9 - Integrator domyka
 * w nim poprawki ze scalenia i decyzje właściciela (SPEC §4.2, wiersz
 * `2026102016…`). Bez tego wyjątku każda taka redefinicja byłaby „złym
 * blokiem" i „funkcją w dwóch blokach", choć właśnie po to I9 ma rezerwę.
 * Wartość = wersja NAJNOWSZEJ wcześniejszej definicji w bloku huba; migracja
 * I9 niesie ją jako `-- CIALO-Z:`, a bramka sprawdza, że rejestr nadal
 * wskazuje najnowszą (późniejsza redefinicja w innym wycinku = czerwień).
 * Właściciel i rodzaj zostają z `FUNCTION_TABLE` (granty jak u właściciela).
 *
 * (I9d, 2026-10-22) DRUGA I KOLEJNA REDEFINICJA tej samej funkcji w bloku I9
 * (np. zapis zdarzeń ścieżek: I9c-X2 - wyłącznik piksela, I9d-Y1 - znacznik
 * zaangażowania, I9d-Y2 - pomiar tylko za zgodą) dostaje MAPĘ wersji per
 * plik: `{ "<wersja pliku I9>": "<CIALO-Z tego pliku>" }`. Każdy plik I9
 * z redefinicją musi mieć w mapie swój wpis, a wartość nadal musi wskazywać
 * NAJNOWSZĄ wcześniejszą definicję w hubie - ochrona przed przepisaniem
 * starego ciała zostaje taka sama jak dla jednej wartości.
 */
export type HubI9Redefinition = string | Readonly<Record<string, string>>;

export const HUB_I9_REDEFINITIONS: Readonly<Record<string, HubI9Redefinition>> = {
  // Z-01 / Z-S2-02: segment przychodu z typu klienta (I9b, decyzja właściciela).
  revenue_segment_of_tier: "20261020090500",
  // Z-S5-02: jeden limit tagu CRM (`CRM_TAG_MAX`) w pisarzu tagów S4
  // i walidatorze grafu S5 (I9b, część B, decyzja właściciela).
  run_workflow_step: "20261020130200",
  journey_validate_graph: "20261020140200",
  // (I9c, 2026-10-20) Retencja danych: lejek S3 i statystyki S5 czytają dni
  // sprzed progu z agregatów, rollup S5 liczy dowolny zakres dni bez dni
  // zapieczętowanych, a piksel otwarć ma wyłącznik najemcy (ustawienia
  // silnika, kontakt do wysyłki, zapis zdarzenia).
  _funnel_counts: "20261020120400",
  journey_rollup_daily: "20261020140500",
  admin_journey_stats: "20261020140500",
  // (I9d, 2026-10-22) + znacznik zaangażowania subskrybenta newslettera
  // (wygaszanie nieaktywnych, Z-I9c-08) - druga redefinicja w I9.
  // (I9d-Y2, 2026-10-22) + otwarcia i kliknięcia tylko za zgodą na pomiar
  // i przy wspólnym przełączniku najemcy - trzecia (zapis zdarzeń) i druga
  // (kontakt do wysyłki: piksel i linki z identyfikatorem) redefinicja.
  journey_record_message_event: {
    "20261020161300": "20261020140500",
    "20261020161900": "20261020161300",
    "20261020162400": "20261020161900",
  },
  journey_contact_for_send: {
    "20261020161300": "20261020140200",
    "20261020162400": "20261020161300",
  },
  admin_journey_settings_get: "20261020140300",
  admin_journey_settings_save: "20261020140300",
};

/**
 * Pliki współdzielone (§8.1, §8.4): zmienia je wyłącznie Integrator w I0
 * albo I9. Wycinek S, który ich potrzebuje, wpisuje zmianę w sekcji
 * „Do integracji" opisu PR.
 */
export const HUB_SHARED_FILES: readonly string[] = [
  ".github/CODEOWNERS",
  ".github/workflows/scheduler.yml",
  "drizzle/migrations/meta/_journal.json",
  "governance/ownership.json",
  "reports/bundle-baseline.json",
  // (I9c, 2026-10-20) Raport bramki parytetu i18n - przepisywany przy każdym
  // przebiegu `i18nParity.gate.test.ts`; nowy bramkowany prefiks
  // (`adminDataRetention`) zmienia jego listę prefiksów.
  "reports/i18n-parity.json",
  "scripts/check-bundle-size.ts",
  "scripts/hub-slice-guard.ts",
  "scripts/scheduler-tick.mjs",
  "src/__tests__/i18nParity.gate.test.ts",
  "src/components/admin/community/SchedulerHealthPanel.tsx",
  "src/integrations/supabase/types.ts",
  "src/lib/__tests__/queryKeyLiterals.gate.test.ts",
  "src/lib/admin/__tests__/adminNav.test.ts",
  "src/lib/admin/adminNav.ts",
  "src/lib/authz/authzSnapshot.generated.ts",
  "src/lib/ci/hubDelivery.ts",
  "src/lib/i18n-admin-core.ts",
  "src/lib/jobs/scheduler.ts",
  "src/lib/realtime/domainEvents.ts",
  "src/lib/realtime/eventInvalidationMap.admin.ts",
  "src/lib/realtime/eventInvalidationMap.ts",
  "src/lib/realtime/useModuleRealtime.ts",
  "src/lib/server/__tests__/serviceRoleTenantScope.gate.test.ts",
  "src/lib/server/jobsTick.server.ts",
  "src/routeTree.gen.ts",
  "src/routes/__tests__/adminRouteAuthority.gate.test.ts",
];

/**
 * Wyjątki imienne: plik współdzielony, który specyfikacja przydziela
 * konkretnemu wycinkowi S (§8.4: jeden wpis `SERVICE_ROLE_READERS` dodaje S5 -
 * jedyny wycinek z nowym plikiem service-role).
 */
export const HUB_SHARED_FILE_GRANTS: Readonly<Record<string, readonly HubSliceId[]>> = {
  "src/lib/server/__tests__/serviceRoleTenantScope.gate.test.ts": ["S5"],
};

const I0_MANIFEST: readonly string[] = [
  // Tor A - SQL, typy bazy, bramka dostawy.
  "supabase/migrations/2026102009????_hub_*.sql",
  // Numery po renumeracji `4549a6f1` (Integrator S4, 2026-10-19: Z-S1-02 -
  // stary glob `0317…0322` przypisywał `0323_hub_shared_sql_helpers` do S1).
  "drizzle/migrations/{0318,0319,0320,0321,0322,0323}_hub_*.sql",
  "drizzle/migrations/meta/_journal.json",
  "supabase/tests/{hub_schema_rls,hub_shared_helpers}_test.sql",
  "src/integrations/supabase/types.ts",
  "src/lib/admin/retentionStats.ts",
  // Test `retentionStats` (przypadek wiersza bez powodu - `started`/`abandoned`
  // z CHECK-u I0) mieszka w zbiorczym teście reguł cennika, bez właściciela.
  "src/lib/admin/__tests__/pricingRules.test.ts",
  "src/routes/admin.monetization.tsx",
  "src/lib/ci/hubDelivery.ts",
  "src/lib/ci/__tests__/hubDelivery.gate.test.ts",
  // Tor B - fabryki kluczy i kontrakt TS.
  "src/lib/revenue/{keys,search,window,segments,limits,money,rpcCallable}.ts",
  "src/lib/journeys/{keys,limits,editorSearch}.ts",
  "src/lib/crm/{keys,lifecycle}.ts",
  "src/lib/newsletter/keys.ts",
  "src/lib/access/{keys,meteringDefaults}.ts",
  "src/lib/retention/keys.ts",
  "src/lib/admin/{workflowKeys,couponKeys}.ts",
  "src/lib/analytics/semantic/benchmarks/types.ts",
  "src/lib/__tests__/{hubKeyFactories,queryKeyLiterals.gate}.test.ts",
  "src/lib/revenue/__tests__/{search,window,segmentsParity,revenueLimitsParity,money}.test.ts",
  "src/lib/journeys/__tests__/{journeyLimitsParity,editorSearch}.test.ts",
  "src/lib/crm/__tests__/lifecycleParity.test.ts",
  "src/lib/access/__tests__/meteringDefaultsParity.test.ts",
  "src/lib/billing/keys.ts",
  "src/components/admin/members/{MemberBillingDetails,MemberTierDialog,MembersDirectoryPanel}.tsx",
  "src/components/admin/monetization/organisms/AdminMonetizationLedger.tsx",
  "src/routes/profile.organization.tsx",
  // Tor C - szyna zdarzeń, rozszerzenie panelu, manifest synchronizacji.
  "src/lib/realtime/{domainEvents,eventInvalidationMap,eventInvalidationMap.admin,useModuleRealtime}.ts",
  "src/lib/realtime/__tests__/{hubEventCatalog,revenueInvalidation,slowInvalidation,invalidationExtension,eventInvalidationMap}.test.ts",
  // Test hooka przypina dokładną listę kluczy `crm_lead.created.v1` - D8
  // dokłada do niej lejek CRM, więc I0 musi zaktualizować asercję.
  "src/lib/realtime/__tests__/useModuleRealtime.test.tsx",
  "src/lib/revenue/syncManifest.ts",
  "src/lib/revenue/__tests__/syncManifest.test.ts",
  "src/routes/admin.tsx",
  // Tor D - trasy, zaślepki, i18n, nawigacja kompaktowa.
  "src/routes/admin.revenue.tsx",
  "src/routes/admin.revenue.index.tsx",
  "src/routes/admin.revenue.$tab.tsx",
  "src/routes/admin.revenue_.journeys.$journeyId.tsx",
  "src/components/admin/revenue/organisms/RevenueHubLayout.tsx",
  "src/components/admin/revenue/tabs/*.tsx",
  "src/components/admin/revenue/atoms/RevenueTabPending.tsx",
  "src/components/admin/journeys/editor/JourneyEditorRoute.tsx",
  "src/lib/i18n-admin-revenue.ts",
  "src/routes/__tests__/adminRevenueHubRoutes.test.tsx",
  "src/routes/__tests__/adminRouteAuthority.gate.test.ts",
  "src/routeTree.gen.ts",
  "src/lib/admin/adminNav.ts",
  "src/__tests__/i18nParity.gate.test.ts",
  // Raport bramki parytetu i18n zapisywany przy każdym przebiegu testu.
  "reports/i18n-parity.json",
  // Tor E - proces i integracja.
  "scripts/hub-slice-guard.ts",
  "docs/WDROZENIE_HUB_PRZYCHOD_LEJEK_2026-10.md",
];

/**
 * Manifesty plików wycinków (globy z kart §8.3 specyfikacji). Testy w
 * katalogach `__tests__` są przypisane po nazwie modułu, nie hurtem, bo kilka
 * wycinków dzieli te same katalogi testów.
 */
export const HUB_SLICE_MANIFESTS: Readonly<Record<HubSliceId, readonly string[]>> = {
  I0: I0_MANIFEST,
  S1: [
    "supabase/migrations/2026102010????_*.sql",
    "supabase/tests/{hub_settings_events,newsletter_settings_patch,coupon_events,email_health_aggregate,membership_grants_single_path}_test.sql",
    "src/lib/billing/{planQueries,tierMutations}.ts",
    "src/lib/billing/__tests__/{planQueries,tierMutations}*.test.ts",
    "src/lib/access/{meteringQueries,contentAccessQueries,metering}.ts",
    "src/lib/access/__tests__/{meteringQueries,contentAccessQueries,metering,meteringHooks}.test.ts{,x}",
    "src/lib/retention/{mutations,queries}.ts",
    "src/lib/retention/__tests__/{mutations,queries}*.test.ts",
    "src/lib/newsletter/{settingsQueries,renderCampaign.server,newsletterFieldLabels}.ts",
    "src/lib/newsletter/__tests__/{settingsQueries,renderCampaign,newsletterFieldLabels}*.test.ts",
    "src/lib/revenue/email/**",
    "src/lib/admin/{paywallTabs,pricingTabs,billingTabs,retentionStats,couponQueries,membership-admin,membersDirectory.functions}.ts",
    "src/lib/admin/__tests__/{paywallTabs,pricingTabs,billingTabs,retentionStats,couponQueries,membershipAdmin,membersDirectoryFunctions}*.test.ts",
    "src/lib/newsletter-campaigns.functions.ts",
    "src/lib/__tests__/newsletter-campaigns*.test.ts",
    "src/components/admin/paywall/**",
    "src/components/admin/pricing/**",
    "src/components/admin/membership/**",
    "src/components/admin/coupons/**",
    "src/components/admin/newsletter/{OverviewPanel,PopupEventsPanel,SubscribersPanel}.tsx",
    "src/components/admin/newsletter/subscribers/ImportCsvDialog.tsx",
    "src/components/admin/newsletter/**/__tests__/{OverviewPanel,PopupEventsPanel,SubscribersPanel,ImportCsvDialog}*.test.tsx",
    "src/components/admin/popups/SignupPopupContentSection.tsx",
    "src/components/admin/popups/**/__tests__/SignupPopupContentSection*.test.tsx",
    "src/components/admin/{AccessSettingsPane,PostGeneralOverview}.tsx",
    "src/components/admin/__tests__/{AccessSettingsPane,PostGeneralOverview}*.test.tsx",
    "src/hooks/{useCheckoutSettings,useNewsletterSettings}.ts",
    "src/hooks/__tests__/{useCheckoutSettings,useNewsletterSettings}*.test.ts{,x}",
    "src/routes/admin.{paywall,pricing,billing,membership,popups,monetization}.tsx",
    "src/routes/admin.coupons{,.index,.campaigns,.analytics,.redemptions}.tsx",
    "src/routes/admin.newsletter.{overview,campaigns.index,campaigns.$id}.tsx",
    "src/routes/__tests__/{adminBilling,adminCoupons,adminNewsletter,adminPopups,adminPricingMembership,platformMonetization,platformPaywall}*.test.tsx",
    "src/lib/i18n-admin-{paywall-sync,revenue-email,pricing,membership,coupons}.ts",
    // Integrator S1 (2026-10-19, wycinek prosto do PR #520) - pliki potrzebne
    // do kryteriów karty, bez właściciela wśród wycinków równoległych:
    // Z-S1-P1/def. 10: zapis i wysyłka kampanii za `requireAdminEditor`;
    // testy przypinały `requireStaff`.
    "src/lib/__tests__/newsletterCampaign{Crud,Send}.test.ts",
    // Z-S1-P1/P20: `capability_key` w elemencie `benefits` - odczyt i zapis
    // w `tiers.ts`, inaczej edytor cennika kasowałby pole przy zapisie.
    "src/lib/billing/tiers.ts",
    "src/lib/billing/__tests__/tiers.test.ts",
    // D-S1-04: `NewsletterBuilder` zapisuje przez szew grup (RPC), test
    // przypinał UPDATE pełnym wierszem; `/admin/popups` ma sekcyjny
    // `adminPageHead` i patch jednej kolumny - test tras audytorium przypinał
    // brak nagłówka i zapis całego wiersza.
    "src/components/admin/newsletter/builder/__tests__/NewsletterBuilder.test.tsx",
    "src/routes/__tests__/adminAudienceRoutes.test.tsx",
    // Budżet `public` (SPEC §8.6): szew zapisu przeniesiony z chunku
    // wejściowego (`useNewsletterSettings.ts`) do modułu panelu - dwaj jego
    // konsumenci importują go teraz z `settingsQueries.ts`.
    "src/components/admin/{auth/RegistrationFieldsSection,newsletter/builder/NewsletterBuilder}.tsx",
    "src/components/admin/auth/__tests__/RegistrationFieldsSection.test.tsx",
    // Test fabryk I0 importował stałą `ADMIN_COUPONS_KEY`, którą S1 usunął
    // (jedna definicja w `couponKeys.ts`).
    "src/lib/__tests__/hubKeyFactories.test.ts",
    // D-S1-01: bliźniaki drizzle migracji S1 (bajt w bajt z supabase). Numery
    // po renumeracji `4549a6f1` (Integrator S4, 2026-10-19: Z-S1-02).
    "drizzle/migrations/{0324,0325,0326,0327,0328}_*.sql",
  ],
  S2: [
    "supabase/migrations/2026102011????_*.sql",
    "supabase/tests/{revenue_catalog_mirror,revenue_subscription_history,revenue_backfill,revenue_aggregates,revenue_lifecycle_scanner,retention_flow,revenue_offer_inputs_economics}_test.sql",
    "src/lib/revenue/finance/**",
    "src/lib/retention/{applyOffer.server,functions}.ts",
    "src/lib/retention/__tests__/{applyOffer,functions}*.test.ts",
    "src/lib/billing/{catalog,webhookDispatch.server,stripeEvents.server,notifications.server,reminders.server}.ts",
    "src/lib/billing/__tests__/{billingCatalogSqlParity,catalog,webhookDispatch,stripeEvents,notifications,reminders}*.test.ts",
    "src/components/billing/organisms/{SubscriptionCard,SubscriptionManagerSection,RetentionDialog}.tsx",
    "src/components/billing/**/__tests__/{SubscriptionCard,SubscriptionManagerSection,RetentionDialog}*.test.tsx",
    "src/routes/profile.plan.tsx",
    "src/routes/__tests__/profilePlan*.test.tsx",
    "src/lib/email-templates/{tx-body,tx-copy,registry}.ts",
    "src/lib/email-templates/__tests__/**",
    "src/components/admin/billing/{AdminBillingPanel,AdminPaymentOrdersPanel,AdminPaymentsDiagnosticsPanel}.tsx",
    "src/components/admin/billing/__tests__/{AdminBillingPanel,AdminPaymentOrdersPanel,AdminPaymentsDiagnosticsPanel}*.test.tsx",
    "src/lib/i18n-{admin-revenue-finance,profile}.ts",
    // (Integrator S2, 2026-10-19): bliźniaki drizzle 8 migracji S2 (bajt w bajt
    // z supabase, numery od pierwszego wolnego na `main` po S4 - §6 dziennika
    // wdrożenia); bez nich `check:migration-lanes` i `supabaseLaneCoverage`
    // są czerwone.
    "drizzle/migrations/{0338,0339,0340,0341,0342,0343,0344,0345}_*.sql",
    // (Integrator S2, 2026-10-19): P01 zastępuje anulowanie jednym kliknięciem
    // dialogiem - test fałszywego sukcesu potwierdza teraz w atrapie dialogu
    // (asercje bez zmian).
    "src/components/billing/__tests__/subscriptionFalseSuccess.test.tsx",
    // (Integrator S2, 2026-10-19): Z-S6-16 - wpięcie `snapshot`
    // (`admin_revenue_semantic_snapshot`, migracja 20261020110400) w migawkę huba.
    "src/lib/analytics/semantic/revenueSnapshot.functions.ts",
    // (Integrator S2, 2026-10-19): filtr `status` z adresu do panelu rozliczeń
    // (PLAN S1 §3.3) - panel S2 przyjmuje już `statusFilter`.
    "src/routes/admin.billing.tsx",
  ],
  S3: [
    "supabase/migrations/2026102012????_*.sql",
    "supabase/tests/{account_registered_event,paywall_hits,metering_quota_rank_gate,checkout_events,revenue_funnel_access}_test.sql",
    "src/lib/revenue/funnel/**",
    "src/lib/revenue/access/**",
    "src/lib/access/{paywallOffer,paywallLinks,paywallHits.functions,meteringVisitor.functions}.ts",
    "src/lib/access/__tests__/{paywallOffer,paywallLinks,paywallHits,meteringVisitor}*.test.ts",
    "src/lib/i18n-{admin-revenue-funnel,paywall}.ts",
    "src/components/Paywall.tsx",
    "src/components/__tests__/Paywall{,.reader}.test.tsx",
    "src/components/{PopupSignupForm,NewsletterPopup}.tsx",
    "src/components/__tests__/{PopupSignupForm,NewsletterPopup}*.test.tsx",
    // (Integrator S3, 2026-10-20): testy popupu mają w repo nazwy małą literą
    // (`popupSignupForm.test.tsx`, `newsletterPopup.test.tsx`) - P08
    // przestawił w nich domyślną zgodę newslettera.
    "src/components/__tests__/{popupSignupForm,newsletterPopup}*.test.tsx",
    "src/components/molecules/MeterBanner.tsx",
    "src/components/molecules/__tests__/MeterBanner*.test.tsx",
    "src/components/clubs/organisms/ClubAccessGate.tsx",
    "src/components/clubs/__tests__/ClubAccessGate*.test.tsx",
    "src/components/auth/AuthPortal.tsx",
    "src/components/auth/__tests__/AuthPortal*.test.tsx",
    "src/components/pricing/organisms/TierCard.tsx",
    "src/components/pricing/molecules/AudienceSwitcher.tsx",
    "src/components/pricing/__tests__/{TierCard,AudienceSwitcher}*.test.tsx",
    "src/lib/overlayCoordinator.ts",
    "src/lib/__tests__/overlayCoordinator*.test.ts",
    "src/routes/{login,auth.callback,plans.$planId,checkout.$planId,checkout.success}.tsx",
    "src/routes/__tests__/{login,authCallback,plansPlanId,checkoutPlanId,checkoutSuccess}*.test.tsx",
    "src/routes/api/public/{track.ts,-track.test.ts}",
    "src/lib/analytics/{ga4EventMap,footerTracking}.ts",
    "src/lib/analytics/__tests__/{ga4EventMap,footerTracking}*.test.ts",
    "src/lib/billing/{oneTimeFulfilment.server,stripeCheckout.functions}.ts",
    "src/lib/billing/__tests__/{oneTimeFulfilment,stripeCheckout}*.test.ts",
    "e2e/{login-return,paywall}.spec.ts",
    // (Integrator S3, 2026-10-20): bliźniaki drizzle 5 migracji S3 (bajt w bajt
    // z supabase, numery od pierwszego wolnego na `main` - po `0346`, którym
    // Lovable potwierdził wdrożenie PR #527; §6 dziennika wdrożenia).
    "drizzle/migrations/{0347,0348,0349,0350,0351}_*.sql",
    // (Integrator S3, 2026-10-20): P22 - sesje Stripe powstają
    // w `adhocCheckout.server.ts` (nie w `stripeCheckout.functions.ts`), a okno
    // porzucenia czyta serwerowy odczyt ustawień kasy (pole opcjonalne
    // w `CheckoutSettings`).
    "src/lib/billing/{adhocCheckout.server,checkoutSettings,checkoutSettings.server}.ts",
    "src/lib/billing/__tests__/{checkoutSessionFlags.server,checkoutSettingsLoad.server}.test.ts",
    // (Integrator S3, 2026-10-20): wspólny skrót gościa (`meteringVisitorDigest`)
    // dla licznika uderzeń - weryfikacja podpisanego cookie w jednym module.
    "src/lib/access/meteringVisitor.server.ts",
    // (Integrator S3, 2026-10-20): P15 - CTA darmowej warstwy w `TierCard`
    // prowadzi do rejestracji z intencją `pricing`; test trasy cennika
    // przypinał goły `/login`.
    "src/routes/__tests__/pricingRoute.test.tsx",
    // (Integrator S3, 2026-10-20): Z-S6-16 - wpięcie `funnel`
    // (`admin_revenue_funnel`, migracja 20261020120400) w migawkę huba.
    "src/lib/analytics/semantic/revenueSnapshot.functions.ts",
  ],
  S4: [
    "supabase/migrations/2026102013????_*.sql",
    "supabase/tests/{crm_lifecycle_history,crm_user_id_backfill,workflow_actions_v2,workflow_engine_fixes,crm_dashboard_fixes,club_application_events,event_attended_revenue_net,revenue_community_aggregates,cohesion_layer}_test.sql",
    "src/lib/revenue/community/**",
    "src/lib/admin/{workflowQueries,workflows}.ts",
    "src/lib/admin/__tests__/{workflowQueries,workflows}*.test.ts",
    "src/components/admin/workflows/**",
    "src/routes/admin.workflows.tsx",
    "src/lib/billing/purchaseEffects.server.ts",
    "src/lib/billing/__tests__/purchaseEffects*.test.ts",
    "src/lib/crm/{leadListSpec,leadViews,leadMutations}.ts",
    "src/lib/crm/__tests__/{leadListSpec,leadViews,leadMutations}*.test.ts",
    "src/lib/{crm.functions,crm-tasks.functions}.ts",
    "src/lib/__tests__/{crm.functions,crm-tasks.functions,crmFunctions,crmTasks}*.test.ts",
    "src/routes/admin.crm.{index,$id,funnel.index}.tsx",
    "src/routes/admin.companies.{index,$id}.tsx",
    "src/routes/__tests__/{adminCrm,adminCompanies,adminWorkflows}*.test.tsx",
    "src/components/admin/crm/**",
    "src/components/admin/post-editor/molecules/OrganizationCreateForm.tsx",
    "src/components/admin/post-editor/**/__tests__/OrganizationCreateForm*.test.tsx",
    "src/components/admin/clubs/organisms/ClubApplicationsInbox.tsx",
    "src/components/admin/clubs/**/__tests__/ClubApplicationsInbox*.test.tsx",
    "src/lib/i18n-admin-{crm-lifecycle,revenue-community,workflows}.ts",
    // (Integrator S4, 2026-10-19): bliźniaki drizzle 8 migracji S4 (bajt w bajt
    // z supabase, numery od pierwszego wolnego na `main` przy scaleniu - §6
    // dziennika wdrożenia).
    "drizzle/migrations/{0330,0331,0332,0333,0334,0335,0336,0337}_*.sql",
    // (Integrator S4, 2026-10-19): `crmKeys.staffUsers()` zamiast tymczasowego
    // `crmStaffUsersKey()` z `leadMutations.ts` (Z-S4-03) i jego wiersz w tabeli
    // par fabryk (test kompletności).
    "src/lib/crm/keys.ts",
    "src/lib/__tests__/hubKeyFactories.test.ts",
    // (Integrator S4, 2026-10-19): br. 04 D7 - filtry skrzynki zgłoszeń
    // w `validateSearch` trasy (Z-S4-05); organizm był już w manifeście.
    "src/routes/admin.community.clubs.applications.tsx",
    "src/routes/__tests__/adminClubRoutes.test.tsx",
    // (Integrator S4, 2026-10-19): wzorzec pgTAP w ERE - komenda z karty
    // (`a|b|c`) w BRE uruchamiała 0 plików i kończyła się zielono (Z-S4-08).
    "scripts/pgtap-local/run.sh",
    // (Integrator S4, 2026-10-19): asercja izolacji historii etapów I0 po
    // DISTINCT najemcy - wyzwalacz S4 dopisuje wiersz historii przy INSERT
    // leada w fixture'ze.
    "supabase/tests/hub_schema_rls_test.sql",
    // (Integrator S4, 2026-10-19): Z-S6-16 - wpięcie `events` i `clubs`
    // w migawkę huba razem z migracją 20261020130700 (plik S6).
    "src/lib/analytics/semantic/revenueSnapshot.functions.ts",
    // (Integrator S4, 2026-10-19): test end-to-end webhooka przypinał martwy
    // `?retention=1`, który karta S4 każe usunąć z dzwonka rezygnacji.
    "src/routes/api/public/payments/-webhook.test.ts",
  ],
  S5: [
    "supabase/migrations/2026102014????_*.sql",
    "supabase/tests/journeys_*_test.sql",
    "src/lib/journeys/{graph,nodeTypes,predicates,triggers,variables,dto,parse,journeys.functions,stats.functions,queries,render.server}.ts",
    "src/lib/journeys/templates/**",
    "src/lib/journeys/__tests__/{graph,nodeTypesParity,triggers,templates,render.server,parse}.test.ts",
    "src/lib/server/journeysRunner.server.ts",
    "src/lib/server/__tests__/journeysRunner.server.test.ts",
    "src/lib/server/__tests__/serviceRoleTenantScope.gate.test.ts",
    "src/lib/i18n-admin-journeys.ts",
    "src/lib/newsletter/trackingToken.server.ts",
    "src/lib/newsletter/__tests__/trackingToken*.test.ts",
    "src/routes/api/public/{nl-open.ts,nl-click.ts,-nl-tracking.test.ts}",
    "src/routes/{api.public.newsletter.unsubscribe.ts,-api.public.newsletter.unsubscribe.test.ts}",
    "src/lib/email/{queueDrain.server,suppressionPolicy}.ts",
    "src/lib/email/__tests__/{queueDrain,suppressionPolicy}*.test.ts",
    // (Integrator S5, 2026-10-20): zapis zdarzeń maila 1:1 (otwarcie,
    // kliknięcie, wypis) - jedyne miejsce, z którego trasy publiczne dotykają
    // silnika; testy server fn, zapytań, słownika i kształtów RPC z bazy.
    "src/lib/journeys/tracking.server.ts",
    // (Integrator S5, 2026-10-20): klucze etykiet `adminJourneys.*` z kodów
    // unii (typowane) - czytelnik słownika do czasu UI S8 i jego API.
    "src/lib/journeys/labels.ts",
    "src/lib/journeys/__tests__/{journeys.functions,queries,tracking.server,i18nJourneys}.test.ts",
    "src/lib/journeys/__tests__/rpcShapes.fixture.ts",
    // (Integrator S5, 2026-10-20): nadawca i Reply-To z panelu
    // (`journey_settings.sender_name`/`reply_to`) idą przez tę samą kolejkę co
    // poczta transakcyjna - `enqueueRawEmail` przyjmuje je jako opcje.
    "src/lib/email/transactional.server.ts",
    "src/lib/email/__tests__/transactional.server.test.ts",
    // (Integrator S5, 2026-10-20): bliźniaki drizzle 6 migracji S5 (bajt w bajt
    // z supabase, numery od pierwszego wolnego po `0351` z S3; §6 dziennika).
    "drizzle/migrations/{0352,0353,0354,0355,0356,0357}_*.sql",
    // (Integrator S5, 2026-10-20): `journey.changed.v1` z op `settings`
    // (agregat = najemca) odświeża kartę ustawień i zdrowie silnika - test
    // reguły w zbiorczym teście inwalidacji huba (plik I0).
    "src/lib/realtime/__tests__/revenueInvalidation.test.ts",
    // (Integrator S5, 2026-10-20): strażnik ACL `hub_grants` (plik I0) zna
    // pomocnicze silnika dopisane do rejestru - inaczej nikt nie sprawdza ich
    // EXECUTE po wdrożeniu (`hubDelivery.gate.test.ts`).
    "supabase/tests/hub_shared_helpers_test.sql",
  ],
  S6: [
    "src/lib/analytics/semantic/{metricHelp,revenueRaw,revenueSnapshot.functions,metrics,streams,format,reconcile,window,index}.ts",
    "src/lib/analytics/semantic/{registry,snapshot.functions,format,window}.test.ts",
    "src/lib/analytics/semantic/benchmarks/{sources,index,evaluate,consistency,adapter,benchmarks.functions}.ts",
    "src/lib/analytics/semantic/benchmarks/groups/**",
    "src/lib/analytics/semantic/benchmarks/__tests__/**",
    "scripts/benchmarks/import-benchmarks.ts",
    "docs/benchmarki/2026-10-18/*.json",
    // (Integrator S6, 2026-10-19): pakiet wiedzy „Insider marketingowy” i jego
    // uspójnienie z rejestrem (pole `hub` w przedziałach, dokumenty metodyki) -
    // dane i źródła rejestru wskaźników należą do S6, nie do kolejnych wycinków.
    "docs/BENCHMARKI_WSKAZNIKOW_2026-10-18.md",
    "docs/WIEDZA_INSIDER_MARKETINGOWY_2026-10-19.md",
    "docs/benchmarki/insider-2026-10-19/*.json",
    "src/components/admin/analytics/{FunnelBars,KpiTile,TimeRangeFilter}.tsx",
    "src/components/admin/analytics/biChart.ts",
    "src/components/admin/analytics/__tests__/{FunnelBars,KpiTile,TimeRangeFilter,biChart}*.test.ts{,x}",
    "src/components/admin/analytics/semantic/atoms/{MetricHelpButton,BenchmarkTierBadge,BenchmarkContextSelect,SourceCitation}.tsx",
    "src/components/admin/analytics/semantic/molecules/{MetricExplainer,BenchmarkScale,MetricDefinitionPopover}.tsx",
    "src/components/admin/analytics/semantic/hooks/useBenchmark.ts",
    "src/components/admin/analytics/semantic/organisms/{RevenueInsightSection,MetricDictionary}.tsx",
    "src/components/admin/analytics/semantic/**/__tests__/**",
    "src/components/admin/revenue/atoms/{LockedMetricTile,SeverityLabel,AreaChip,ProvenanceNote}.tsx",
    "src/components/admin/revenue/molecules/{SourceHeader,RelatedModulesBar,MoneyByCurrencyText,RevenueSection,RoleGateNotice,MfaRequiredNotice,AreaHealthList}.tsx",
    "src/components/admin/revenue/{atoms,molecules,organisms}/__tests__/{LockedMetricTile,SeverityLabel,AreaChip,ProvenanceNote,SourceHeader,RelatedModulesBar,MoneyByCurrencyText,RevenueSection,RoleGateNotice,MfaRequiredNotice,AreaHealthList,RevenueHubLayout}*.test.tsx",
    "src/components/admin/revenue/organisms/RevenueHubLayout.tsx",
    "src/lib/admin/revenue/hubTabs.ts",
    "src/lib/admin/revenue/__tests__/{hubTabs,revenueKeysReuse}.test.ts",
    // `benchmarkTier` (Integrator S6, 2026-10-19): ocena 5-stopniowa poza
    // `status.ts`, który jedzie we wspólnym chunku wykresów publicznych.
    "src/lib/charts/{waterfall,status,types,benchmarkTier}.ts",
    "src/lib/charts/__tests__/{waterfall,status,types,benchmarkTier}*.test.ts",
    // Z-S6-02 (Integrator S6, 2026-10-19): dymek i tabela mostka czytają
    // `level` (poziom PO kroku, D1) zamiast krawędzi `to` - bez tego naprawa
    // modelu nie dociera do ekranu; test D1 w renderze obok.
    "src/components/charts/{CartesianChart,Chart}.tsx",
    "src/components/charts/__tests__/waterfallLevel.test.tsx",
    "src/components/charts/MetricTooltip.tsx",
    "src/components/charts/__tests__/MetricTooltip*.test.tsx",
    "src/components/admin/events/molecules/AdsFunnelBars.tsx",
    "src/components/admin/dashboard/DashboardPeriodTabs.tsx",
    "src/components/admin/dashboard/__tests__/DashboardPeriodTabs*.test.tsx",
    "src/routes/admin.analytics.bi.tsx",
    "src/lib/i18n-admin-{revenue-shell,semantic,analytics}.ts",
  ],
  S7: [
    "supabase/migrations/2026102015????_*.sql",
    "supabase/tests/{revenue_facts,revenue_diagnostic_snoozes}_test.sql",
    "src/lib/revenue/diagnostics/**",
    "src/lib/revenue/__tests__/syncScenarios.test.ts",
    "src/lib/admin/revenue/{overviewTiles,quickFixes,diagnosticGroups,policySentence,paywallChecklist,metricSearchIndex}.ts",
    "src/lib/admin/revenue/__tests__/{revenueTilesHaveMetric,quickFixes,diagnosticGroups,policySentence,paywallChecklist,metricSearchIndex,sourceHeaderOnMutations}.test.ts",
    "src/components/admin/revenue/{overview,mrr,retention,funnel,community,diagnostics,offer,access,metrics,inputs}/**",
    "src/components/admin/revenue/molecules/RevenueSignalChip.tsx",
    "src/components/admin/revenue/molecules/__tests__/RevenueSignalChip*.test.tsx",
    "src/components/admin/revenue/tabs/Revenue{Overview,Mrr,Funnel,Retention,Community,Diagnostics,Offer,Access,Metrics,Inputs}Tab.tsx",
    "src/components/admin/dashboard/MarketingPanel.tsx",
    "src/components/admin/dashboard/__tests__/MarketingPanel*.test.tsx",
    "src/lib/i18n-admin-revenue-{tabs,diagnostics}.ts",
    // (Integrator S7, 2026-10-22): bliźniaki drizzle 3 migracji S7 (bajt w bajt
    // z supabase, numery od pierwszego wolnego po `0372` z I9c; §6 dziennika).
    "drizzle/migrations/{0373,0374,0375}_*.sql",
    // (Integrator S7, 2026-10-22): zakładki S7 mają treść; testy tras I0
    // asertują nagłówki Kokpitu i Oferty zamiast zdania zaślepki; pulpit
    // atrapuje leniwy kafel przychodu zrealizowanego (zachowanie dowodzi
    // `MarketingPanel.realized.test.tsx`). Licznik Diagnostyki w układzie huba
    // (Z-S6-08) zostaje plikiem S6 - zmiana integratora (§23 dziennika).
    // (Scalenie S7 po S8, 2026-10-22): po S7 i S8 żadna zakładka nie ma stanu
    // „w przygotowaniu” (I9a §19.6) - moduł `tabPreparing`, molekuła
    // `RevenueTabPreparing`, słownik `-preparing` i ich testy usunięte
    // (Z-S7-17, §23.11 dziennika); wpisy zdjęte z manifestów S7 i I9.
    "src/routes/__tests__/adminRevenueHubRoutes.test.tsx",
    "src/components/admin/dashboard/__tests__/dashboardPanels.test.tsx",
  ],
  S8: [
    "src/lib/admin/journeys/**",
    "src/components/admin/journeys/{list,editor,results,lead}/**",
    "src/components/admin/revenue/tabs/RevenueJourneysTab.tsx",
    "src/lib/journeys/editorSearch.ts",
    "src/lib/journeys/__tests__/editorSearch.test.ts",
    "src/lib/i18n-admin-journeys-editor.ts",
    // (Integrator S8, 2026-10-22): słownik podzielony na podzadania - lista,
    // galeria i ustawienia silnika (S8.1), wyniki i karta leada (S8.2), kanwa
    // (S8.3b), panele kroku (S8.3c), publikacja, symulacja i test (S8.3c2);
    // `-editor` = sesja szkicu i złożenie edytora (S8.3a/d). Jeden plik na
    // podzadanie - rozłączne pliki przy pracy kolejnych agentów.
    "src/lib/i18n-admin-journeys-{list,results,canvas,steps,publish}.ts",
    // (Integrator S8, 2026-10-22): Z-S5-08 - czysta część podstawiania
    // zmiennych maila (`substituteDocVariables`, `journeyUrlVariables`) mieszka
    // w liściu klienckim `variables.ts`, a `render.server.ts` ją importuje
    // i re-eksportuje: podgląd edytora i wysyłka mają jedną implementację.
    // Pliki S5 zmienione przez S8.3a (precedens: S4 i migawka S6).
    "src/lib/journeys/{variables,render.server}.ts",
  ],
  I9: [
    ...HUB_SHARED_FILES,
    "supabase/migrations/2026102016????_*.sql",
    "drizzle/migrations/*.sql",
    "src/lib/server/__tests__/jobsTickRun.test.ts",
    "src/lib/jobs/__tests__/scheduler.test.ts",
    "src/routes/api/public/-jobs-tick.test.ts",
    "src/lib/revenue/syncManifest.ts",
    "src/lib/revenue/__tests__/{syncManifest,domainMap}.test.ts",
    "docs/{RUNBOOK_HUB_PRZYCHOD_LEJEK,WDROZENIE_HUB_PRZYCHOD_LEJEK_2026-10}.md",
    "src/routes/admin.{paywall,coupons,newsletter,crm,crm.$id,workflows,billing,monetization}.tsx",
    "src/components/admin/pricing/organisms/AdminPricingWorkspace.tsx",
    "src/components/admin/membership/organisms/AdminMembershipWorkspace.tsx",
    "src/lib/crm/leadTimeline.ts",
    "src/components/admin/events/organisms/{EventCommunicationsPanel,EventAnalyticsPanel,EventOverviewPanel}.tsx",
    "src/components/admin/clubs/organisms/{ClubInvitationsTab,ClubApplicationsInbox}.tsx",
    "src/lib/onboarding/tours.ts",
    // Atrybuty `data-tour` w komponentach S7/S8 (P2).
    "src/components/admin/revenue/**",
    "src/components/admin/journeys/**",
    // (Integrator I9a, 2026-10-20 - decyzja właściciela: hub w nawigacji przed
    // I9). Powłoka panelu podaje nawigacji DOKŁADNE role i `search` skrótów
    // ⌘K; stan „w przygotowaniu" zakładek (dane, słownik, testy - usunięte
    // po S7 i S8, §23.11); okno porzucenia kasy w karcie ustawień kasy (S1) -
    // wspólny predykat w limitach I0, odczyt i zapis w module S1, serwer kasy
    // S3.
    "src/components/admin/AdminShell.tsx",
    "src/components/admin/__tests__/AdminShell.test.tsx",
    "src/lib/locale/__tests__/coreScopeSurfaces.test.tsx",
    "src/routes/__tests__/platformPaywallRoute.test.tsx",
    "src/components/admin/paywall/CheckoutSettingsCard.tsx",
    "src/components/admin/paywall/__tests__/CheckoutSettingsCard.abandon.test.tsx",
    "src/hooks/useCheckoutSettings.ts",
    "src/hooks/__tests__/useCheckoutSettings.test.ts",
    "src/lib/i18n-admin-paywall-sync.ts",
    "src/lib/revenue/limits.ts",
    "src/lib/revenue/__tests__/checkoutAbandonMinutes.test.ts",
    "src/lib/billing/{checkoutSettings,checkoutSettings.server}.ts",
    "docs/KONTYNUACJA_HUB_PRZYCHOD_LEJEK_2026-10-19.md",
    // (Integrator I9b, 2026-10-20 - decyzje właściciela, część A: SQL
    // i katalog). Segment przychodu z typu klienta (mapa I0, lustro TS,
    // chip w panelu członkostwa), cennik v6.2 (Zespół, NGO - katalog
    // seedu, lustra rang i macierz, stabilny drugi klucz rangi), Zespół
    // 3-20 miejsc (stała współdzielona, funkcja serwerowa, panel
    // organizacji) i RODO księgi MRR (test S2 Z-07 po wymianie
    // identyfikatora subskrypcji).
    "supabase/tests/hub_i9b_*_test.sql",
    // Rezerwa I9 w bramce dostawy (`HUB_I9_REDEFINITIONS`) - fikstury reguły.
    "src/lib/ci/__tests__/hubDelivery.gate.test.ts",
    "supabase/tests/{hub_shared_helpers,pricing_catalog_v62,revenue_subscription_history}_test.sql",
    "src/lib/revenue/segments.ts",
    "src/lib/revenue/__tests__/segmentsParity.test.ts",
    "src/lib/billing/{tierRanks,tiers}.ts",
    "src/lib/billing/__tests__/{tierCatalogParity,tierRankOrder}.test.ts",
    "src/lib/access/paywallOffer.ts",
    "src/lib/admin/membersDirectory.functions.ts",
    "src/lib/clubs/planTiers.ts",
    "src/components/admin/AccessSettingsPane.tsx",
    "src/components/admin/membership/membershipQueries.ts",
    "src/components/admin/membership/molecules/{TierEditorCard,TierSummaryCard}.tsx",
    "src/components/admin/membership/atoms/RevenueSegmentChip.tsx",
    "src/components/admin/membership/atoms/__tests__/RevenueSegmentChip.test.tsx",
    "src/lib/i18n-admin-membership.ts",
    "src/components/pricing/organisms/PricingComparisonMatrix.tsx",
    "src/components/pricing/__tests__/{comparisonMatrixV62,tierCardV62Catalog}.test.tsx",
    "src/lib/i18n-pricing.ts",
    "src/lib/organizations/{teamSeats,teamSeats.functions}.ts",
    "src/lib/organizations/__tests__/{teamSeatCap,organizationsFunctions}.test.ts",
    "src/components/admin/organizations/**",
    "src/lib/i18n-admin-organizations.ts",
    "src/routes/admin.organizations{,.new,.$id}.tsx",
    "src/routes/__tests__/adminOrganizationsRoutes.test.tsx",
    "src/routes/admin.library.tsx",
    "src/routes/admin.newsletter.campaigns.$id.tsx",
    // (I9b-A2, 2026-10-20) RODO po usunięciu konta: powód wyjścia ze ścieżki
    // `account_deleted` (lustro CHECK, etykiety PL/EN, parytet) i rejestr
    // czynności przetwarzania huba (art. 30 RODO).
    "src/lib/journeys/limits.ts",
    "src/lib/journeys/__tests__/journeyLimitsParity.test.ts",
    "src/lib/i18n-admin-journeys.ts",
    "docs/RODO_REJESTR_CZYNNOSCI_HUB_2026-10.md",
    // (Integrator I9b, 2026-10-20 - decyzje właściciela, część B). Z-S5-02:
    // jeden limit tagu CRM (`CRM_TAG_MAX`) w schematach panelu CRM, przepisów
    // i ścieżek, parytet z pisarzem S4 i walidatorem S5 (testy tych wycinków
    // czytają teraz najnowszą definicję). Z-S3-07: linia okna porzucenia kasy
    // w karcie biletów wydarzenia. Z-S2-01: scenariusz anulowania na granicy
    // SDK operatora. Z-14-03/04: wpis `engagement_rate` rejestru S6
    // (dane, nakładka, wygenerowane moduły, pole `hub` pakietu Insidera)
    // i przegląd źródeł PPCR.
    "src/lib/crm/{lifecycle,leadListSpec,leadViews}.ts",
    "src/lib/crm/__tests__/{tagLimitParity,leadViews}.test.ts",
    "src/lib/{crm,crm-tasks}.functions.ts",
    "src/lib/admin/workflows.ts",
    "src/lib/admin/__tests__/workflows.test.ts",
    "src/lib/i18n-admin-workflows.ts",
    "src/components/admin/crm/LeadFilterChips.tsx",
    "src/components/admin/crm/__tests__/LeadFilterChipsHub.test.tsx",
    "src/lib/journeys/{graph,predicates}.ts",
    "src/lib/journeys/__tests__/{graph,nodeTypesParity}.test.ts",
    "supabase/tests/workflow_actions_v2_test.sql",
    "src/components/admin/events/organisms/EventTicketsPanel.tsx",
    "src/components/admin/events/molecules/EventTicketCheckoutWindowNote.tsx",
    "src/components/admin/events/molecules/__tests__/EventTicketCheckoutWindowNote.test.tsx",
    "src/components/admin/events/__tests__/{EventTicketsPanel,EventTicketsPanelStudio}.test.tsx",
    "src/lib/i18n-admin-event-registration.ts",
    "src/lib/retention/__tests__/{applyOffer,functions.stripeBoundary}.test.ts",
    "docs/benchmarki/2026-10-18/lejek{,.overlay}.json",
    "docs/benchmarki/insider-2026-10-19/{manifest,ranges}.json",
    "docs/{BENCHMARKI_WSKAZNIKOW_2026-10-18,WIEDZA_INSIDER_MARKETINGOWY_2026-10-19}.md",
    "src/lib/analytics/semantic/benchmarks/{index,sources}.ts",
    "src/lib/analytics/semantic/benchmarks/groups/funnel.server.ts",
    "src/lib/analytics/semantic/benchmarks/__tests__/{registry,i18nParity,metricMap}.test.ts",
    // (I9c, 2026-10-20) RODO po usunięciu konta - domknięcia po A2: lista
    // poczty związanej z kontem albo zapisem (lustro SQL, parytet), dren
    // pytający bazę przed wysyłką, testy drenu i pgTAP domknięć.
    "src/lib/email/{queueDrain.server,suppressionPolicy}.ts",
    "src/lib/email/__tests__/{queueDrainAccountBound,accountBoundLabelsParity,emailLogTenantBoundary}.test.ts",
    "supabase/tests/hub_i9c_*_test.sql",
    // (I9c, 2026-10-20) Retencja danych (Z-I9b-10): stałe, funkcje serwerowe
    // i zapytania karty, karta w ustawieniach prywatności (leniwy chunk,
    // słownik PL/EN), piksel otwarć w renderze i ustawieniach silnika ścieżek
    // (S5), reguła szyny `data_retention.changed.v1` w rozszerzeniu panelu.
    "src/lib/privacy/**",
    "src/components/admin/settings/dataRetention/**",
    "src/routes/admin.settings.privacy.tsx",
    "src/routes/__tests__/adminSettingsPrivacyRoute.test.tsx",
    "src/lib/i18n-admin-data-retention.ts",
    "src/lib/journeys/{render.server,dto,parse,journeys.functions}.ts",
    "src/lib/journeys/__tests__/{render.server.test,parse.test,journeys.functions.test,rpcShapes.fixture}.ts",
    "src/lib/server/journeysRunner.server.ts",
    "src/lib/server/__tests__/journeysRunner.server.test.ts",
    "src/lib/realtime/__tests__/{invalidationExtension,eventInvalidationMap}.test.ts",
    // (I9d-Y1, 2026-10-22) RODO - decyzje właściciela 2: pgTAP kategorii
    // retencji (zgłoszenia do klubów, licznik, uczestnicy wydarzeń,
    // wygaszanie newslettera) i bramka CIALO-Z (mapa wersji per plik).
    "supabase/tests/hub_i9d_*_test.sql",
    // (Integrator I9d-Y1, 2026-10-22) Wygaszanie newslettera (Y1-B): trasa
    // publiczna „Chcę dalej otrzymywać" (endpoint, strona, słownik PL/EN,
    // noindex - bramka noindex tras kodu) i zaangażowanie z formularza zapisu
    // (`newsletter_engagement_touch` przy istniejącym adresie).
    "src/routes/{api.public.newsletter.keep.ts,newsletter.keep.tsx,-api.public.newsletter.keep.test.ts}",
    "src/routes/__tests__/newsletterKeepPage.test.tsx",
    "src/lib/i18n-newsletter-keep{,-head}.ts",
    "src/lib/newsletter.functions.ts",
    "src/lib/__tests__/newsletter.functions.test.ts",
    "src/lib/seo/noindexCodeRoutes.ts",
    // (Integrator I9d-Y1, 2026-10-22) Panel (Y1-C): notka agregatu dobowego
    // (osobny mały słownik - lejek nie ciągnie słownika karty), edytor treści
    // prośby obok treści maili newslettera, test pulpitu monetyzacji
    // (`aggregate_before`).
    "src/lib/i18n-admin-retention-aggregate.ts",
    "src/routes/admin.newsletter.email-content.tsx",
    "src/routes/__tests__/platformMonetizationRoute.test.tsx",
    // (I9d-Y2, 2026-10-22) Treść zgody i pomiar: zapis otwarć i kliknięć
    // tylko za zgodą na pomiar - fikstury testów zapisu zdarzeń kampanii
    // i ścieżek (S5) nadają zgodę (ich przedmiotem jest deduplikacja
    // i statystyki, nie zgoda).
    "supabase/tests/{journeys_tracking_stats,newsletter_campaign_events_dedup}_test.sql",
    // (Integrator I9d-Y2, 2026-10-22) Treść zgody i pomiar (Y2-B): jedno
    // źródło treści zgody newslettera i formularze zgody (widżety, popup,
    // rejestracja, bramka klubu, kontakt, dokument buildera), pomiar tylko za
    // zgodą w renderze kampanii i ścieżek, trasa publiczna linków pomiaru
    // (strona, słownik PL/EN, noindex), link „Nie mierz" w preferencjach
    // (wypis).
    "src/lib/newsletter/{consentText,keys,renderCampaign.server,trackingEvents.server}.ts",
    "src/lib/newsletter/__tests__/{consentText,renderCampaign.server,trackingEvents}.test.ts",
    "src/components/newsletter/{NewsletterConsentText,NewsletterDocRenderer}.tsx",
    "src/components/newsletter/__tests__/newsletterDocRendererPure.test.tsx",
    "src/components/{NewsletterForm,PopupSignupForm}.tsx",
    "src/components/__tests__/{NewsletterForm,popupSignupForm}.test.tsx",
    "src/components/popups/__tests__/SignupPopupPanel.test.tsx",
    "src/components/blocks/{AuthFormBlocks,ContactFormView}.tsx",
    "src/components/blocks/__tests__/{authFormBlocks,authFormPlaceholders,contactFormNewsletterConsent}.test.tsx",
    "src/components/clubs/organisms/ClubAccessGate.tsx",
    "src/components/clubs/__tests__/ClubAccessGate{,.funnel}.test.tsx",
    "src/components/interests/JoinUsForm.tsx",
    "src/components/interests/__tests__/joinUsForm.test.tsx",
    "src/hooks/useNewsletterSettings.ts",
    "src/lib/builder/registry.tsx",
    "src/lib/{contact.functions,newsletter-campaigns.functions}.ts",
    "src/lib/__tests__/{contactFunctions,newsletterCampaignSend,newsletterCampaignsFunctionsGaps}.test.ts",
    "src/lib/i18n-{club-gate,interests,public-auth,public}.ts",
    "src/lib/i18n-newsletter-measurement{,-head}.ts",
    "src/routes/{api.public.newsletter.measurement.ts,newsletter.measurement.tsx,-api.public.newsletter.measurement.test.ts}",
    "src/routes/{api.public.newsletter.unsubscribe.ts,newsletter.unsubscribe.tsx,-api.public.newsletter.unsubscribe.test.ts}",
    "src/routes/__tests__/{newsletterMeasurementPage,newsletterConsentPages}.test.tsx",
    // (Integrator I9d-Y2, 2026-10-22) Panel (Y2-C): treść zgody z jawnym
    // oznaczeniem „mój tekst obejmuje pomiar", „Poproś o zgodę na pomiar"
    // i edytor treści tego maila, dymki pomiaru w statystykach kampanii,
    // ścieżek i rejestrze wskaźników, ostrzeżenie etykiety zgody w popupie,
    // unieważnienie podglądu po zmianie wspólnego przełącznika pomiaru.
    "src/components/admin/newsletter/measurement/**",
    "src/components/admin/newsletter/molecules/CampaignEngagementCard.tsx",
    "src/components/admin/newsletter/__tests__/CampaignEngagementCard.test.tsx",
    "src/components/admin/popups/signup/FieldsTab.tsx",
    "src/components/admin/popups/signup/__tests__/FieldsTabConsentLabel.test.tsx",
    "src/lib/admin/journeys/journeyMutations.ts",
    "src/lib/admin/journeys/__tests__/journeyMutations.test.ts",
    "src/lib/analytics/semantic/metrics.ts",
    "src/lib/i18n-admin-{newsletter-measurement,measurement-hint,journeys-list,journeys-results,revenue-email}.ts",
    "src/routes/admin.newsletter.{overview,email-content}.tsx",
    "src/routes/__tests__/adminNewsletterCampaignRoutes.test.tsx",
  ],
};

// ─── Globy ──────────────────────────────────────────────────────────────────

const REGEX_SPECIAL = /[.+^$()|[\]\\]/;

/**
 * Glob -> wyrażenie regularne zakotwiczone na całej ścieżce. Bez zależności
 * (skrypty mają tylko typy `node`). Obsługuje `**` (dowolna liczba
 * segmentów, także zero: `a/**\/b` pasuje do `a/b`), `*` (znaki poza `/`),
 * `?` (jeden znak poza `/`) i `{a,b}` (alternatywy, także puste i
 * zagnieżdżone). Pozostałe znaki są literałami (`$` w nazwach tras).
 */
export function globToRegExp(glob: string): RegExp {
  let out = "";
  let depth = 0;
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        const slashAfter = glob[i + 2] === "/";
        out += slashAfter ? "(?:[^/]*/)*" : ".*";
        i += slashAfter ? 2 : 1;
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else if (ch === "{") {
      depth += 1;
      out += "(?:";
    } else if (ch === "}" && depth > 0) {
      depth -= 1;
      out += ")";
    } else if (ch === "," && depth > 0) {
      out += "|";
    } else if (REGEX_SPECIAL.test(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  if (depth !== 0) throw new Error(`Niedomknięta klamra w globie: ${glob}`);
  return new RegExp(`^${out}$`);
}

const manifestRegexCache = new Map<HubSliceId, readonly RegExp[]>();

function manifestRegexes(slice: HubSliceId): readonly RegExp[] {
  let cached = manifestRegexCache.get(slice);
  if (!cached) {
    cached = HUB_SLICE_MANIFESTS[slice].map(globToRegExp);
    manifestRegexCache.set(slice, cached);
  }
  return cached;
}

/** Wszystkie wycinki, których manifest obejmuje ścieżkę (kolejność planu). */
export function slicesOfPath(path: string): HubSliceId[] {
  return HUB_SLICE_IDS.filter((slice) => manifestRegexes(slice).some((re) => re.test(path)));
}

/**
 * Wycinek równoległy (S1-S8) będący właścicielem ścieżki albo `null`.
 * Manifesty S są rozłączne, więc wynik jest jednoznaczny.
 */
export function sliceOfPath(path: string): HubSliceId | null {
  return slicesOfPath(path).find((slice) => HUB_PARALLEL_SLICES.includes(slice)) ?? null;
}

// ─── Kontrola diffu wycinka ─────────────────────────────────────────────────

export interface SliceDiffResult {
  readonly slice: HubSliceId;
  /** Pliki spoza manifestu wycinka. */
  readonly outsideManifest: readonly string[];
  /** Pliki współdzielone zmienione przez wycinek równoległy bez przydziału. */
  readonly shared: readonly string[];
  /** Migracje supabase poza blokiem wersji wycinka. */
  readonly migrationsOutsideBlock: readonly string[];
}

const SUPABASE_MIGRATION = /^supabase\/migrations\/(\d{14})_[a-z0-9_]+\.sql$/;

/** Czy diff wycinka mieści się w jego manifeście, bloku i regułach plików współdzielonych. */
export function checkSliceDiff(slice: HubSliceId, paths: readonly string[]): SliceDiffResult {
  const parallel = HUB_PARALLEL_SLICES.includes(slice);
  const regexes = manifestRegexes(slice);
  const block = HUB_VERSION_BLOCKS[slice];
  const outsideManifest: string[] = [];
  const shared: string[] = [];
  const migrationsOutsideBlock: string[] = [];
  for (const path of [...new Set(paths)].sort()) {
    const granted = HUB_SHARED_FILE_GRANTS[path]?.includes(slice) ?? false;
    if (parallel && HUB_SHARED_FILES.includes(path) && !granted) {
      shared.push(path);
      continue;
    }
    if (!regexes.some((re) => re.test(path))) outsideManifest.push(path);
    const migration = SUPABASE_MIGRATION.exec(path);
    if (migration && (block === undefined || !migration[1].startsWith(block))) {
      migrationsOutsideBlock.push(path);
    }
  }
  return { slice, outsideManifest, shared, migrationsOutsideBlock };
}

export function sliceDiffFailed(result: SliceDiffResult): boolean {
  return (
    result.outsideManifest.length > 0 ||
    result.shared.length > 0 ||
    result.migrationsOutsideBlock.length > 0
  );
}

// ─── Analiza migracji ───────────────────────────────────────────────────────

/** Migracja do analizy: nazwa pliku (`20261020090000_x.sql`) i treść. */
export interface HubMigrationFile {
  readonly name: string;
  readonly sql: string;
}

export type HubDeliveryViolationKind =
  | "bez-wlasciciela"
  | "zly-blok"
  | "funkcja-w-dwoch-blokach"
  | "brak-cialo-z"
  | "zly-cialo-z"
  | "rejestr-cialo-z-nieaktualny"
  | "brak-naglowka"
  | "za-duza"
  | "brak-revoke"
  | "brak-grantu"
  | "grant-dla-klienta"
  | "funkcja-poza-public"
  | "brak-pg-harness-exclude";

export interface HubDeliveryViolation {
  readonly kind: HubDeliveryViolationKind;
  readonly file: string;
  readonly detail: string;
}

export interface HubFunctionDefinition {
  readonly name: string;
  readonly file: string;
  readonly block: string;
}

export interface HubDeliveryReport {
  /** Pliki z bloku huba, które przeszły analizę. */
  readonly files: readonly string[];
  readonly functions: readonly HubFunctionDefinition[];
  readonly violations: readonly HubDeliveryViolation[];
}

/** Limit Lovable (`MIGRATION_MAX_BYTES` w migrationSize.ts): 45 KiB. */
export const HUB_MIGRATION_MAX_BYTES = 45 * 1024;

const MIGRATION_NAME = /^(\d{14})_[A-Za-z0-9_-]+\.sql$/;
// Schemat opcjonalny, identyfikatory gołe albo w cudzysłowach (grupy: 2 -
// schemat, 4 - nazwa). Wzorzec z samym `public.` był furtką: `CREATE FUNCTION
// _x(` (ląduje w `public` przez search_path) i `"public"."_x"(` omijały
// rejestr właścicieli, CIALO-Z, REVOKE i GRANT naraz.
const CREATE_FUNCTION =
  /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:("?)([A-Za-z0-9_]+)\1\s*\.\s*)?("?)([A-Za-z0-9_]+)\3\s*\(/gi;
const CIALO_Z = /--[ \t]*CIALO-Z:[ \t]*(\d{14})/g;
const PG_HARNESS_EXCLUDE = /^--[ \t]*pg-harness:[ \t]*exclude[ \t]*$/m;
const CLUB_TOUCH = /public\.(?:club_|admin_club_)/;
const CLIENT_FORBIDDEN_KINDS: readonly HubFunctionKind[] = ["service", "internal", "trigger"];
/** Role klienta, które nie dostają EXECUTE w żadnej grupie macierzy (§4.4). */
const ROLES_NEVER_GRANTED = ["public", "anon"] as const;
/**
 * Role, z których REVOKE jest obowiązkowy. `authenticated` jest tu dla
 * funkcji serwisowych, wewnętrznych i wyzwalaczy, bo produkcyjne `ALTER
 * DEFAULT PRIVILEGES … GRANT ALL ON FUNCTIONS TO anon, authenticated`
 * (scripts/pgtap-local/stub.sql) nadaje mu EXECUTE JAWNIE - `REVOKE … FROM
 * PUBLIC, anon` go nie zdejmuje (klasa błędu naprawiana w 20261007120500).
 */
const REVOKE_REQUIRED_STRICT = ["public", "anon", "authenticated"] as const;

const HEADER_LABELS: readonly (readonly [string, RegExp])[] = [
  ["DEFEKT", /\bDEFEKT\b/],
  ["ZMIANA", /\bZMIANA\b/],
  // Bez `\b` na końcu: bez flagi `u` granica słowa nie widzi „Ć"/„Ó" jako liter.
  ["KOLEJNOŚĆ", /\bKOLEJNO(?:ŚĆ|SC)/],
  ["IDEMPOTENTNA", /\bIDEMPOTENTNA\b/],
  ["DOWÓD", /\bDOW(?:Ó|O)D/],
];

/** Wersja migracji z nazwy pliku albo `null` (nazwa spoza konwencji). */
export function migrationVersion(name: string): string | null {
  return MIGRATION_NAME.exec(name)?.[1] ?? null;
}

/** Czy wersja należy do bloku huba [from, until). */
export function isHubVersion(version: string): boolean {
  return version >= HUB_VERSION_RANGE.from && version < HUB_VERSION_RANGE.until;
}

/** Wycinek, którego blok obejmuje wersję, albo `null`. */
export function sliceOfVersion(version: string): HubSliceId | null {
  const entry = Object.entries(HUB_VERSION_BLOCKS).find(([, prefix]) => version.startsWith(prefix));
  return entry ? (entry[0] as HubSliceId) : null;
}

/**
 * Treść SQL z komentarzami zamienionymi na spacje (nowe linie i długość
 * zachowane - pozycje trafień pasują do pliku). Napisy w apostrofach
 * i identyfikatory w cudzysłowach zostają; ciała `$$...$$` są kodem, więc
 * komentarze w nich też znikają.
 */
export function maskSqlComments(sql: string): string {
  const out = sql.split("");
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k += 1) if (out[k] !== "\n") out[k] = " ";
  };
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === '"') {
      // `E'...'` dopuszcza `\'` - bez tego jeden taki napis rozjechałby
      // stan „w napisie" do końca pliku i bramka przestałaby widzieć kod.
      const escapes = ch === "'" && /[Ee]/.test(sql[i - 1] ?? "") && !/\w/.test(sql[i - 2] ?? "");
      let j = i + 1;
      while (j < sql.length) {
        if (escapes && sql[j] === "\\") j += 2;
        else if (sql[j] === ch) {
          if (sql[j + 1] === ch) j += 2;
          else break;
        } else j += 1;
      }
      i = j + 1;
    } else if (ch === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? sql.length : end;
      blank(i, stop);
      i = stop;
    } else if (ch === "/" && sql[i + 1] === "*") {
      let depth = 1;
      let j = i + 2;
      while (j < sql.length && depth > 0) {
        if (sql[j] === "/" && sql[j + 1] === "*") {
          depth += 1;
          j += 2;
        } else if (sql[j] === "*" && sql[j + 1] === "/") {
          depth -= 1;
          j += 2;
        } else j += 1;
      }
      blank(i, j);
      i = j;
    } else {
      i += 1;
    }
  }
  return out.join("");
}

/** Nagłówek = wiodące linie komentarza (do pierwszej instrukcji). */
function leadingHeader(sql: string): string {
  const lines: string[] = [];
  for (const line of sql.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("--")) lines.push(trimmed);
    else break;
  }
  return lines.join("\n");
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

interface FunctionHit {
  readonly name: string;
  /** Schemat z definicji (małe litery) albo `null`, gdy go nie podano. */
  readonly schema: string | null;
  readonly at: number;
}

function functionHits(code: string): FunctionHit[] {
  return [...code.matchAll(CREATE_FUNCTION)].map((m) => ({
    name: m[4].toLowerCase(),
    schema: m[2]?.toLowerCase() ?? null,
    at: m.index ?? 0,
  }));
}

/** `GRANT`/`REVOKE` uprawnień do funkcji, rozłożony na cele i role. */
interface FunctionPrivilegeStatement {
  readonly action: "grant" | "revoke";
  /** Nazwy funkcji z listy celów (małe litery); `null` = `ALL FUNCTIONS IN SCHEMA`. */
  readonly functions: readonly string[] | null;
  /** Role małymi literami (`public` = PUBLIC), bez `CASCADE`/`WITH GRANT OPTION`. */
  readonly roles: readonly string[];
}

const PRIVILEGE_HEAD =
  /\b(GRANT|REVOKE)\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE)\s+ON\s+(?:(ALL\s+(?:FUNCTIONS|ROUTINES)\s+IN\s+SCHEMA\s)|(?:FUNCTION|ROUTINE)\s+)/gi;
const QUALIFIED_NAME = /^(?:"?[A-Za-z0-9_]+"?\s*\.\s*)?"?([A-Za-z0-9_]+)"?\s*/;

/**
 * Instrukcje uprawnień do funkcji z (zamaskowanego) SQL. Lista celów jest
 * czytana skanerem z licznikiem nawiasów, a nie wyrażeniem: przy GRANT na
 * kilka funkcji naraz (`ON FUNCTION public.a(uuid), public.b(uuid) TO …`)
 * wyrażenie widziało wyłącznie PIERWSZĄ - druga dostawała EXECUTE niezauważona.
 */
function functionPrivilegeStatements(code: string): FunctionPrivilegeStatement[] {
  const out: FunctionPrivilegeStatement[] = [];
  for (const head of code.matchAll(PRIVILEGE_HEAD)) {
    const action = head[1].toLowerCase() === "grant" ? "grant" : "revoke";
    const keyword = action === "grant" ? "TO" : "FROM";
    let i = (head.index ?? 0) + head[0].length;
    let functions: string[] | null = [];
    if (head[2] !== undefined) {
      // `ON ALL FUNCTIONS IN SCHEMA x[, y] TO|FROM …` - lista schematów
      // zostaje w `code` i przeskakuje ją wzorzec końca niżej.
      functions = null;
    } else {
      for (;;) {
        const name = QUALIFIED_NAME.exec(code.slice(i));
        if (name === null) break;
        functions.push(name[1].toLowerCase());
        i += name[0].length;
        if (code[i] === "(") {
          let depth = 0;
          do {
            if (code[i] === "(") depth += 1;
            else if (code[i] === ")") depth -= 1;
            i += 1;
          } while (depth > 0 && i < code.length);
        }
        const comma = /^\s*,\s*/.exec(code.slice(i));
        if (comma === null) break;
        i += comma[0].length;
      }
    }
    const skip = functions === null ? "[^;]*?\\s" : "\\s*";
    const tail = new RegExp(`^${skip}${keyword}\\s+([^;]+);`, "i").exec(code.slice(i));
    if (tail === null) continue;
    const roles = tail[1]
      .split(",")
      .map((segment) => (segment.trim().split(/\s+/)[0] ?? "").replace(/"/g, "").toLowerCase())
      .filter((role) => role !== "");
    out.push({ action, functions, roles });
  }
  return out;
}

function privilegesFor(
  statements: readonly FunctionPrivilegeStatement[],
  action: FunctionPrivilegeStatement["action"],
  fn: string,
): (readonly string[])[] {
  return statements
    .filter((s) => s.action === action && s.functions !== null && s.functions.includes(fn))
    .map((s) => s.roles);
}

export interface HubDeliveryOptions {
  /**
   * Sprawdź, czy `HUB_CIALO_Z` wskazuje NAJNOWSZĄ definicję sprzed huba.
   * Ma sens tylko na pełnym zestawie migracji repozytorium (runner, test) -
   * na fiksturze z kilkoma plikami każdy wpis wyglądałby na nieaktualny.
   */
  readonly verifyCialoZRegistry?: boolean;
}

/**
 * Wersja CIALO-Z, której rejestr rezerwy I9 oczekuje od redefinicji `name`
 * w pliku `version` (wpis jednowartościowy - każdy plik; mapa - wpis pliku,
 * brak wpisu = `undefined`).
 */
export function hubI9RedefinitionCialoZ(name: string, version: string): string | undefined {
  const entry = HUB_I9_REDEFINITIONS[name];
  if (entry === undefined) return undefined;
  return typeof entry === "string" ? entry : entry[version];
}

/** Czy definicja w pliku wycinka `slice` to dozwolona redefinicja w rezerwie I9. */
function isI9Redefinition(name: string, slice: HubSliceId | null): boolean {
  const owner = HUB_FUNCTION_OWNERS[name];
  return (
    slice === "I9" &&
    owner !== undefined &&
    owner !== "I9" &&
    Object.hasOwn(HUB_I9_REDEFINITIONS, name)
  );
}

/**
 * Analiza migracji bloku huba. `migrations` może zawierać także pliki sprzed
 * huba - wtedy analiza wie, które funkcje istniały wcześniej (redefinicja bez
 * wpisu w `HUB_CIALO_Z` = naruszenie).
 */
export function analyzeHubDelivery(
  migrations: readonly HubMigrationFile[],
  options: HubDeliveryOptions = {},
): HubDeliveryReport {
  const violations: HubDeliveryViolation[] = [];
  const functions: HubFunctionDefinition[] = [];
  const files: string[] = [];
  const preHubLatest = new Map<string, string>();
  const hubLatest = new Map<string, string>();
  const sorted = [...migrations].sort((a, b) => a.name.localeCompare(b.name));

  for (const file of sorted) {
    const version = migrationVersion(file.name);
    if (version === null || version >= HUB_VERSION_RANGE.from) continue;
    for (const hit of functionHits(maskSqlComments(file.sql))) {
      if (hit.schema === null || hit.schema === "public") preHubLatest.set(hit.name, version);
    }
  }

  for (const file of sorted) {
    const version = migrationVersion(file.name);
    if (version === null || !isHubVersion(version)) continue;
    files.push(file.name);
    const fileSlice = sliceOfVersion(version);
    const code = maskSqlComments(file.sql);
    const add = (kind: HubDeliveryViolationKind, detail: string): void => {
      violations.push({ kind, file: file.name, detail });
    };

    const header = leadingHeader(file.sql);
    const missing = HEADER_LABELS.filter(([, re]) => !re.test(header)).map(([label]) => label);
    if (missing.length > 0) add("brak-naglowka", `nagłówek PL bez: ${missing.join(", ")}`);

    const bytes = utf8Bytes(file.sql);
    if (bytes > HUB_MIGRATION_MAX_BYTES) {
      add("za-duza", `${bytes} B > ${HUB_MIGRATION_MAX_BYTES} B (scripts/split-migration.ts)`);
    }

    if (fileSlice !== "S4" && CLUB_TOUCH.test(file.sql) && !PG_HARNESS_EXCLUDE.test(file.sql)) {
      add(
        "brak-pg-harness-exclude",
        "dotyka public.club_/public.admin_club_ poza wycinkiem S4 - wymagany znacznik `-- pg-harness: exclude`",
      );
    }

    const markers = [...file.sql.matchAll(CIALO_Z)].map((m) => ({
      version: m[1],
      at: m.index ?? 0,
    }));
    const hits = functionHits(code);
    const privileges = functionPrivilegeStatements(code);
    for (const s of privileges) {
      // `GRANT … ON ALL FUNCTIONS IN SCHEMA … TO authenticated` obchodzi
      // macierz dla KAŻDEJ funkcji schematu - w migracji huba nigdy.
      if (s.action === "grant" && s.functions === null) {
        if (s.roles.some((r) => r === "authenticated" || r === "anon" || r === "public")) {
          add("grant-dla-klienta", `GRANT … ON ALL FUNCTIONS IN SCHEMA … TO ${s.roles.join(", ")}`);
        }
      }
    }
    const seen = new Set<string>();
    hits.forEach((hit, index) => {
      if (hit.schema !== "public") {
        add(
          "funkcja-poza-public",
          `CREATE FUNCTION ${hit.schema === null ? "" : `${hit.schema}.`}${hit.name}: funkcja huba wymaga jawnego schematu \`public.<nazwa>\` (rejestr, REVOKE i GRANT dotyczą public)`,
        );
        // Bez schematu funkcja i tak ląduje w `public` (search_path migracji),
        // więc reszta reguł obowiązuje; inny schemat - poza zakresem rejestru.
        if (hit.schema !== null) return;
      }
      functions.push({ name: hit.name, file: file.name, block: version.slice(0, 10) });
      const owner = HUB_FUNCTION_OWNERS[hit.name];
      const i9Redefinition = isI9Redefinition(hit.name, fileSlice);
      if (owner === undefined) {
        add("bez-wlasciciela", `public.${hit.name} nie ma wpisu w HUB_FUNCTION_OWNERS`);
      } else if (owner !== fileSlice && !i9Redefinition) {
        add(
          "zly-blok",
          `public.${hit.name} należy do ${owner} (blok ${HUB_VERSION_BLOCKS[owner] ?? "brak"}), plik jest w bloku ${version.slice(0, 10)}`,
        );
      }

      // Znacznik CIALO-Z odnosi się do definicji, przed którą stoi (między
      // poprzednią definicją w pliku a tą).
      const previous = index > 0 ? hits[index - 1].at : -1;
      const marker = markers.filter((m) => m.at > previous && m.at < hit.at).at(-1);
      const expected = HUB_CIALO_Z[hit.name];
      const existedBefore = preHubLatest.has(hit.name);
      // Redefinicja w rezerwie I9 przepisuje ciało z NAJNOWSZEJ definicji
      // w hubie (niżej), nie sprzed huba - `HUB_CIALO_Z` opisuje tylko
      // pierwszą redefinicję w wycinku właściciela.
      if (!i9Redefinition && (expected !== undefined || existedBefore)) {
        if (marker === undefined) {
          add(
            "brak-cialo-z",
            `public.${hit.name} redefiniuje funkcję sprzed huba - brak \`-- CIALO-Z: ${expected ?? preHubLatest.get(hit.name)}\``,
          );
        } else if (expected === undefined) {
          add("brak-cialo-z", `public.${hit.name} nie ma wpisu w HUB_CIALO_Z`);
        } else if (marker.version !== expected) {
          add("zly-cialo-z", `public.${hit.name}: CIALO-Z ${marker.version}, rejestr ${expected}`);
        }
      }
      if (i9Redefinition) {
        // Redefinicja funkcji innego wycinka w I9: ciało przepisane z NAJNOWSZEJ
        // definicji w hubie - rejestr i znacznik muszą ją wskazywać.
        const registered = hubI9RedefinitionCialoZ(hit.name, version);
        // Funkcja sprzed huba bez redefinicji w wycinku: najnowsza sprzed huba.
        const latestInHub = hubLatest.get(hit.name) ?? preHubLatest.get(hit.name);
        if (registered === undefined) {
          // Mapa wersji bez wpisu tego pliku: każda kolejna redefinicja w I9
          // musi zostać zarejestrowana z własnym CIALO-Z.
          add(
            "brak-cialo-z",
            `HUB_I9_REDEFINITIONS.${hit.name} nie ma wpisu dla pliku ${version} (najnowsza wcześniejsza definicja w hubie: ${latestInHub ?? "brak"})`,
          );
        } else if (marker === undefined) {
          add(
            "brak-cialo-z",
            `public.${hit.name} redefiniuje funkcję huba - brak \`-- CIALO-Z: ${registered}\``,
          );
        } else if (marker.version !== registered) {
          add(
            "zly-cialo-z",
            `public.${hit.name}: CIALO-Z ${marker.version}, rejestr ${registered}`,
          );
        }
        if (registered !== undefined && latestInHub !== registered) {
          add(
            "zly-cialo-z",
            `HUB_I9_REDEFINITIONS.${hit.name} = ${registered}, najnowsza wcześniejsza definicja w hubie: ${latestInHub ?? "brak"}`,
          );
        }
      }

      if (seen.has(hit.name)) return;
      seen.add(hit.name);
      const kind = HUB_FUNCTION_KINDS[hit.name];
      // Funkcja bez wpisu (już `bez-wlasciciela`) dostaje regułę najostrzejszą.
      const strict = kind === undefined || CLIENT_FORBIDDEN_KINDS.includes(kind);
      const required: readonly string[] = strict ? REVOKE_REQUIRED_STRICT : ROLES_NEVER_GRANTED;
      const revoked = new Set(privilegesFor(privileges, "revoke", hit.name).flat());
      const notRevoked = required.filter((role) => !revoked.has(role));
      if (notRevoked.length > 0) {
        add(
          "brak-revoke",
          `brak \`REVOKE ALL ON FUNCTION public.${hit.name}(…) FROM ${required.map((r) => (r === "public" ? "PUBLIC" : r)).join(", ")}\` w tym pliku (bez: ${notRevoked.join(", ")})`,
        );
      }
      if (kind === undefined) return;
      const grants = privilegesFor(privileges, "grant", hit.name);
      if (!strict && !grants.some((roles) => roles.includes("authenticated"))) {
        // RPC panelu i czytelnika żyje z JAWNEGO grantu, nie z domyślnego ACL
        // platformy - inaczej działa albo nie zależnie od środowiska.
        add(
          "brak-grantu",
          `public.${hit.name} (${kind}): brak jawnego \`GRANT EXECUTE ON FUNCTION … TO authenticated\``,
        );
      }
      for (const roles of grants) {
        // anon i PUBLIC nie dostają EXECUTE w żadnej grupie macierzy (§4.4).
        const toAnon = roles.some((r) => (ROLES_NEVER_GRANTED as readonly string[]).includes(r));
        const toAuthenticated = roles.includes("authenticated");
        if (toAnon || (toAuthenticated && strict)) {
          add("grant-dla-klienta", `public.${hit.name} (${kind}): GRANT … TO ${roles.join(", ")}`);
        }
      }
    });
    // Najnowsza definicja w hubie liczy się dopiero PO pliku - redefinicja
    // I9 porównuje się z wersją sprzed siebie, nie ze sobą.
    for (const hit of hits)
      if (hit.schema === null || hit.schema === "public") hubLatest.set(hit.name, version);
  }

  const blocksByFunction = new Map<string, Set<string>>();
  for (const def of functions) {
    // Redefinicja w rezerwie I9 (rejestr wyżej) nie jest „drugim blokiem".
    if (def.block === HUB_VERSION_BLOCKS.I9 && isI9Redefinition(def.name, "I9")) continue;
    const blocks = blocksByFunction.get(def.name) ?? new Set<string>();
    blocks.add(def.block);
    blocksByFunction.set(def.name, blocks);
  }
  for (const [name, blocks] of blocksByFunction) {
    if (blocks.size > 1) {
      const where = functions.filter((d) => d.name === name).map((d) => d.file);
      violations.push({
        kind: "funkcja-w-dwoch-blokach",
        file: where[where.length - 1],
        detail: `public.${name} zdefiniowana w blokach ${[...blocks].sort().join(", ")}: ${where.join(", ")}`,
      });
    }
  }

  // Rejestr CIALO-Z musi wskazywać NAJNOWSZĄ definicję sprzed huba: nowsza
  // definicja na `main` znaczy, że wycinek przepisałby nieaktualne ciało.
  if (options.verifyCialoZRegistry === true) {
    for (const [name, expected] of Object.entries(HUB_CIALO_Z)) {
      const latest = preHubLatest.get(name);
      if (latest !== expected) {
        violations.push({
          kind: "rejestr-cialo-z-nieaktualny",
          file: "src/lib/ci/hubDelivery.ts",
          detail: `HUB_CIALO_Z.${name} = ${expected}, najnowsza definicja sprzed huba: ${latest ?? "brak"}`,
        });
      }
    }
  }

  return { files, functions, violations };
}

export function hubDeliveryFailed(report: HubDeliveryReport): boolean {
  return report.violations.length > 0;
}

/** Raport PL dla runnera i komunikatu testu. */
export function renderHubDeliveryReport(report: HubDeliveryReport): string {
  const head = `${report.files.length} plików w bloku huba, ${report.functions.length} definicji funkcji`;
  if (report.violations.length === 0) return `✓ Dostawa huba: ${head}.`;
  const lines = [`✗ Dostawa huba: ${head}, ${report.violations.length} naruszeń:`];
  for (const v of report.violations) lines.push(`  [${v.kind}] ${v.file}: ${v.detail}`);
  return lines.join("\n");
}

/** Raport PL kontroli diffu wycinka. */
export function renderSliceDiff(result: SliceDiffResult): string {
  if (!sliceDiffFailed(result)) return `✓ Wycinek ${result.slice}: diff mieści się w manifeście.`;
  const lines = [`✗ Wycinek ${result.slice}: diff poza regułami.`];
  for (const p of result.outsideManifest) lines.push(`  [poza-manifestem] ${p}`);
  for (const p of result.shared)
    lines.push(`  [plik-wspoldzielony] ${p} (zmiana tylko przez I0/I9)`);
  for (const p of result.migrationsOutsideBlock) lines.push(`  [migracja-poza-blokiem] ${p}`);
  return lines.join("\n");
}
