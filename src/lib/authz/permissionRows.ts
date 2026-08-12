// DEKLARACJA wierszy macierzy uprawnień - czysta lista bez logiki i bez importu
// snapshotu (generator snapshotu czyta ten plik, więc import w drugą stronę
// zrobiłby cykl).
//
// Wiersz NIE zawiera poziomów dostępu. Deklarujemy wyłącznie:
//   - `gateRef`  - którą bramkę SQL ten wiersz opisuje (`fn:...` / `policy:...`),
//   - `group`    - sekcję prezentacji,
//   - `scoped`   - role, którym bramka daje dostęp WYŁĄCZNIE do własnych rekordów
//                  (tego SQL nie mówi wprost, więc jest to jawne zawężenie;
//                  test parytetu pilnuje, że rola nadal przechodzi bramkę),
//   - `numeric`  - flagi liczbowe warstwy (limity) prezentowane jako wartość.
// Poziomy per rola i per warstwa wylicza src/lib/authz/permissionMatrix.ts ze
// snapshotu bramek i z `membership_tiers.features`.
import type { AppRole } from "@/lib/authz/roles";
import type { CapabilityGate } from "@/lib/billing/capabilities";

/** Sekcje macierzy. Etykiety w i18n: `adminPermissions.groups.<id>`. */
export const PERMISSION_GROUPS = [
  "tenant",
  "users",
  "content",
  "community",
  "monitoring",
  "monetization",
  "membership",
] as const;

export type PermissionGroupId = (typeof PERMISSION_GROUPS)[number];

export interface RolePermissionRow {
  /** Identyfikator wiersza; etykieta w i18n: `adminPermissions.rows.<id>`. */
  readonly id: string;
  readonly group: PermissionGroupId;
  /** Referencja bramki w snapshocie (`fn:nazwa/arność` albo `policy:tabela/nazwa`). */
  readonly gateRef: string;
  /** Role, które przechodzą bramkę tylko dla WŁASNYCH rekordów -> poziom częściowy. */
  readonly scoped?: readonly AppRole[];
}

/**
 * Wiersze rolowe: każdy opisuje jedną REALNĄ bramkę w bazie. Zbiór ról nie jest
 * tu wpisany - liczy go generator z ciała funkcji/polityki, więc zmiana bramki
 * (np. dopisanie `super_admin` do gałęzi OR) przechodzi do macierzy sama, a
 * usunięcie bramki wywala test parytetu jako referencja wisząca.
 */
export const ROLE_PERMISSION_ROWS: readonly RolePermissionRow[] = [
  // --- Tenant i konfiguracja -----------------------------------------------
  { id: "tenant_pin", group: "tenant", gateRef: "fn:profiles_pin_tenant_id/0" },
  { id: "integration_secrets", group: "tenant", gateRef: "fn:integration_endpoint_set_secret/2" },
  { id: "crm_secrets", group: "tenant", gateRef: "fn:crm_set_merydian_secret/2" },
  { id: "scheduler_health", group: "tenant", gateRef: "fn:job_scheduler_health/0" },
  { id: "content_password", group: "tenant", gateRef: "fn:admin_set_content_password/5" },

  // --- Użytkownicy i role --------------------------------------------------
  { id: "users_list", group: "users", gateRef: "fn:admin_list_users/0" },
  { id: "users_detail", group: "users", gateRef: "fn:admin_get_user/1" },
  { id: "roles_assign", group: "users", gateRef: "fn:change_user_role/2" },
  { id: "user_consents", group: "users", gateRef: "fn:admin_get_user_consent/1" },
  { id: "profile_verification", group: "users", gateRef: "fn:profiles_guard_verification/0" },
  {
    id: "verification_domains",
    group: "users",
    gateRef: "fn:admin_assert_verification_admin/0",
  },
  {
    id: "profile_privileged_columns",
    group: "users",
    gateRef: "fn:profiles_guard_privileged_columns/0",
  },
  { id: "badges_grant", group: "users", gateRef: "fn:admin_grant_profile_badge/3" },
  { id: "avatar_replace", group: "users", gateRef: "fn:admin_update_user_avatar/2" },
  { id: "org_seats", group: "users", gateRef: "fn:org_set_seats_limit/3" },

  // --- Treści i publikacja -------------------------------------------------
  { id: "editorial_scope", group: "content", gateRef: "fn:is_staff/0", scoped: ["author"] },
  { id: "publish", group: "content", gateRef: "fn:can_publish_content/1" },
  { id: "comments_moderate", group: "content", gateRef: "fn:comments_guard_update/0" },
  { id: "comments_owner_edit", group: "content", gateRef: "fn:tg_comments_owner_edit/0" },
  { id: "legal_publish", group: "content", gateRef: "fn:publish_legal_version/1" },
  { id: "related_signals", group: "content", gateRef: "fn:related_posts_signals/1" },

  // --- Wydarzenia i społeczność -------------------------------------------
  { id: "event_access", group: "community", gateRef: "fn:get_event_access/1" },
  { id: "qa_summary", group: "community", gateRef: "fn:publish_qa_session_summary/2" },
  { id: "poll_results", group: "community", gateRef: "fn:get_poll_results/1" },
  { id: "presence", group: "community", gateRef: "fn:can_access_entity_presence/2" },
  { id: "chat_moderation", group: "community", gateRef: "fn:admin_soft_delete_message/1" },
  { id: "community_stats", group: "community", gateRef: "fn:admin_community_stats/0" },
  {
    id: "expert_requests_switch",
    group: "community",
    gateRef: "fn:admin_set_expert_requests_enabled/2",
  },
  { id: "resource_download", group: "community", gateRef: "fn:authorize_resource_download/1" },
  // Kluby dyskusyjne. Macierz milczała o CAŁYM module, choć ma on dwie realne
  // bramki rolowe w bazie - a to macierz jest miejscem, w którym administrator
  // sprawdza, kto co może. Moduł nieopisany w macierzy wygląda jak moduł bez
  // uprawnień.
  //
  // Świadomie DWA wiersze, nie dwadzieścia: reszta RPC klubowych woła
  // `is_club_admin` albo `club_capabilities` zamiast rozwijać `has_role` u
  // siebie, więc wpisanie ich osobno powielałoby tę samą bramkę pod różnymi
  // nazwami - i pierwsza zmiana w jednym miejscu rozjechałaby dziewiętnaście
  // wierszy naraz.
  { id: "clubs_structure", group: "community", gateRef: "fn:is_club_admin/1" },
  { id: "clubs_access", group: "community", gateRef: "fn:club_capabilities/3" },

  // --- Monetyzacja i analityka --------------------------------------------
  { id: "monetization_dashboard", group: "monetization", gateRef: "fn:monetization_dashboard/4" },
  { id: "engagement_overview", group: "monetization", gateRef: "fn:get_engagement_overview/0" },
  { id: "metering_preview", group: "monetization", gateRef: "fn:metering_impact_preview/1" },
  {
    id: "metering_user_count",
    group: "monetization",
    gateRef: "fn:get_user_monthly_metering_count/1",
  },
  { id: "coupons_analytics", group: "monetization", gateRef: "fn:b2b_coupons_analytics/2" },
  {
    id: "coupons_bulk",
    group: "monetization",
    gateRef: "fn:bulk_generate_coupons_for_campaign/1",
  },
  { id: "gift_links_admin", group: "monetization", gateRef: "fn:list_gift_links_admin/4" },
  { id: "gift_link_revoke", group: "monetization", gateRef: "fn:revoke_gift_link_admin/1" },
  {
    id: "payment_status_guard",
    group: "monetization",
    gateRef: "fn:payment_orders_guard_status/0",
  },
  { id: "crm_backfill", group: "monetization", gateRef: "fn:crm_backfill_all_leads/0" },
  { id: "membership_grant", group: "monetization", gateRef: "fn:admin_grant_membership/4" },
  {
    id: "membership_grants_list",
    group: "monetization",
    gateRef: "fn:admin_list_membership_grants/0",
  },
];

/** Sekcja, w której ląduje wiersz flagi warstwy - wg obszaru egzekwowania. */
export const TIER_GATE_GROUP: Readonly<Record<CapabilityGate, PermissionGroupId>> = {
  content: "content",
  events: "community",
  qa: "community",
  chat: "community",
  tracker: "monitoring",
  none: "membership",
};

/** Referencje bramek dokumentowanych przez macierz - wejście generatora snapshotu. */
export const DOCUMENTED_ROLE_GATE_REFS: readonly string[] = ROLE_PERMISSION_ROWS.map(
  (row) => row.gateRef,
);
