// Zasoby i18n macierzy uprawnień (/admin/permissions).
//
// Etykiety są tu, a nie w danych: wiersze macierzy powstają z bramek SQL i z
// rejestru capabilities (klucze techniczne), więc warstwa językowa musi być
// osobna - inaczej nie dałoby się mieć PL i EN bez duplikowania kontraktu.
// Klucz wiersza rolowego: `adminPermissions.rows.<id>` (src/lib/authz/permissionRows.ts),
// klucz flagi warstwy: `adminPermissions.caps.<flaga>` (lib/billing/capabilities).
// Kompletność obu zestawów pilnuje test parytetu - nowa bramka bez tłumaczenia
// obleje CI, więc na stronie nigdy nie pojawi się surowy klucz.
import i18n from "@/lib/i18n";

const adminPermissionsPl = {
  adminPermissions: {
    title: "Macierz uprawnień",
    subtitle:
      "Zakres możliwości ról systemowych i warstw członkostwa - generowany z bramek w bazie, nie wpisany ręcznie.",
    sourceTitle: "Skąd biorą się te dane",
    sourceBody:
      "Kolumny ról wynikają ze snapshotu bramek SQL (funkcje SECURITY DEFINER i polityki RLS) odtworzonego z migracji. Kolumny warstw czytają flagi features warstw bieżącego obszaru roboczego. Rozjazd między stroną a bazą blokuje CI (test parytetu), a snapshot odświeża `bun run generate:authz-snapshot`.",
    generatedFrom:
      "Snapshot: {{migrations}} migracji, {{functions}} funkcji, {{policies}} polityk RLS.",
    rlsNote:
      "Dostęp egzekwuje baza: RLS i funkcje SECURITY DEFINER. Ta strona pokazuje, co te bramki naprawdę mówią - nie deklarację produktową.",
    tenantNote:
      "Widok jest zawężony do warstw bieżącego obszaru roboczego (tenant_id) - dane innej firmy nie są tu dostępne.",

    kpi: {
      rows: "Pozycje w macierzy",
      enforced: "Z realną bramką",
      decorative: "Bez bramki (deklaracja)",
      tiers: "Warstwy obszaru roboczego",
      gatesWithoutCallerTenant: "Bramki bez current_tenant_id()",
    },

    groups: {
      tenant: "Obszar roboczy i konfiguracja",
      users: "Użytkownicy i role",
      content: "Treści i publikacja",
      community: "Wydarzenia i społeczność",
      monitoring: "Monitoring regulacyjny",
      monetization: "Monetyzacja i analityka",
      membership: "Zakres warstw członkostwa",
    },

    levels: {
      full: "Pełny",
      partial: "Własne",
      none: "Brak",
      not_applicable: "Nie dotyczy",
    },
    levelHints: {
      full: "Bramka wymienia tę rolę (albo warstwa ma tę flagę włączoną).",
      partial: "Bramka przepuszcza, ale wyłącznie dla własnych rekordów.",
      none: "Bramka nie przepuszcza.",
      not_applicable:
        "Ta pozycja nie zależy od tej kolumny - bramka rolowa nie patrzy na warstwę, a bramka warstwy nie patrzy na rolę (poza jawnym obejściem).",
    },

    enforcement: {
      enforced: "Egzekwowana",
      decorative: "Dekoracyjna",
      enforcedHint: "Istnieje bramka w bazie, która czyta tę pozycję.",
      decorativeHint:
        "Żadna bramka nie czyta tej flagi - dziś to obietnica marketingowa, nie ograniczenie systemu.",
    },

    gateMode: {
      any: "alternatywa",
      all: "warunek twardy",
      mixed: "mieszana",
      none: "brak",
      anyHint: "Wystarczy jedna z wymienionych ról (gałąź OR).",
      allHint: "Rola jest wymagana bezwarunkowo (assert w ciele funkcji).",
      mixedHint: "Bramka łączy warunek twardy z alternatywami - zobacz źródło SQL.",
      noneHint: "Bramka nie wymienia żadnej roli.",
    },

    tenant: {
      caller: "tenant wołającego",
      row: "tenant wiersza",
      none: "bez tenanta",
      callerHint: "Bramka woła current_tenant_id() - wiąże dane z obszarem roboczym wołającego.",
      rowHint:
        "Bramka porównuje kolumny tenant_id (spójność wiersz-wiersz), ale nie wiąże ich z obszarem roboczym wołającego.",
      noneHint: "Bramka nie odwołuje się do tenanta - pozycja do przeglądu w audycie.",
    },

    gate: {
      function: "funkcja",
      policy: "polityka RLS",
      definer: "SECURITY DEFINER",
      definerHint: "Funkcja omija RLS, więc jej własna bramka roli jest jedynym ograniczeniem.",
      label: "Bramka",
      none: "brak bramki",
      provenance: "Migracja",
      provenanceHint:
        "Migracje są forward-only, więc prawem jest OSTATNIA definicja tej bramki. Plik z tą definicją:",
    },

    toolbar: {
      search: "Szukaj pozycji lub bramki…",
      searchLabel: "Szukaj w macierzy uprawnień",
      actorAll: "Wszystkie kolumny",
      actorRole: "Role",
      actorTier: "Warstwy",
      onlyEnforced: "Tylko z bramką",
      groupAll: "Wszystkie sekcje",
      reset: "Wyczyść filtry",
      results: "{{count}} pozycji",
      results_one: "{{count}} pozycja",
      results_few: "{{count}} pozycje",
      results_many: "{{count}} pozycji",
    },

    table: {
      capability: "Pozycja",
      caption: "Macierz uprawnień: role systemowe i warstwy członkostwa",
      legend: "Legenda",
      flagColumn: "Flaga",
      quotaUnit: "{{count}} / mies.",
      quotaNone: "Brak puli",
    },

    empty: {
      rows: "Brak pozycji dla tych filtrów.",
      tiers:
        "Ten obszar roboczy nie ma aktywnych warstw członkostwa - macierz pokazuje tylko role systemowe.",
      loading: "Wczytywanie warstw obszaru roboczego…",
      error: "Nie udało się wczytać warstw obszaru roboczego.",
    },

    roles: {
      super_admin: {
        name: "Super-Admin",
        desc: "Rola najwyższego zaufania. Bramki wymieniają ją jawnie - nie dziedziczy uprawnień Admina.",
      },
      admin: {
        name: "Admin",
        desc: "Operacyjny właściciel obszaru roboczego: użytkownicy, role, rozliczenia, konfiguracja.",
      },
      editor: {
        name: "Editor",
        desc: "Redakcja i moderacja treści oraz społeczności w całym obszarze roboczym.",
      },
      author: {
        name: "Autor / Prelegent",
        desc: "Własne treści i wydarzenia; poza własnymi rekordami bramki nie przepuszczają.",
      },
      user: {
        name: "Użytkownik",
        desc: "Zalogowane konto bez roli redakcyjnej - zakres wynika wyłącznie z warstwy członkostwa.",
      },
    },
    roleBadge: "rola",
    tierBadge: "warstwa",
    tierDefaultBadge: "domyślna",
    tierRank: "ranga {{rank}}",

    rows: {
      tenant_pin: "Przypisanie profilu do obszaru roboczego",
      integration_secrets: "Sekrety integracji i webhooków",
      crm_secrets: "Sekrety integracji CRM",
      scheduler_health: "Stan harmonogramu zadań",
      content_password: "Hasło dostępu do treści",

      users_list: "Lista użytkowników obszaru roboczego",
      users_detail: "Karta użytkownika (dane kontaktowe)",
      roles_assign: "Nadawanie i odbieranie ról",
      user_consents: "Zgody użytkownika i ich historia",
      profile_verification: "Weryfikacja profilu (odznaka, dożywotni VIP eksperta)",
      verification_domains: "Domeny weryfikacji organizacji",
      profile_privileged_columns: "Firma w profilu (kolumna chroniona)",
      badges_grant: "Nadawanie odznak profilu",
      avatar_replace: "Podmiana avatara użytkownika",
      org_seats: "Limit miejsc w organizacji",

      editorial_scope: "Zakres redakcyjny (panel i treści)",
      publish: "Publikacja treści",
      comments_moderate: "Moderacja komentarzy",
      comments_owner_edit: "Edycja komentarza po opublikowaniu",
      legal_publish: "Publikacja wersji dokumentów prawnych",
      related_signals: "Sygnały doboru treści powiązanych",

      event_access: "Dostęp do wydarzenia i nagrania",
      qa_summary: "Publikacja podsumowania sesji Q&A",
      poll_results: "Wyniki ankiet społeczności",
      presence: "Obecność użytkowników przy treści",
      chat_moderation: "Moderacja wiadomości czatu",
      community_stats: "Statystyki społeczności",
      expert_requests_switch: "Przełącznik zapytań do eksperta",
      resource_download: "Autoryzacja pobrania zasobu",
      clubs_structure: "Struktura klubów dyskusyjnych",
      clubs_access: "Dostęp do klubu i działu",

      monetization_dashboard: "Pulpit monetyzacji",
      engagement_overview: "Przegląd zaangażowania",
      metering_preview: "Podgląd wpływu limitu meteringu",
      metering_user_count: "Licznik meteringu użytkownika",
      coupons_analytics: "Analityka kuponów B2B",
      coupons_bulk: "Masowe generowanie kuponów",
      gift_links_admin: "Rejestr linków podarunkowych",
      gift_link_revoke: "Unieważnienie linku podarunkowego",
      payment_status_guard: "Zmiana statusu zamówienia płatności",
      crm_backfill: "Przeliczenie leadów CRM",
      membership_grant: "Nadanie warstwy poza planem",
      membership_grants_list: "Rejestr nadań warstw",
    },

    caps: {
      premium_content: "Treści premium",
      regulatory_monitoring: "Monitoring regulacyjny (tracker)",
      pro_briefings: "Briefingi Pro",
      recordings: "Nagrania wydarzeń",
      qa_priority: "Priorytet pytań w Q&A",
      chat_enabled: "Rozmowy prywatne (DM)",
      chat_direct_gated: "DM do ekspertów bez zapytania",
      chat_inmail_quota_5: "Pula InMaili: 5 miesięcznie",
      chat_inmail_quota_2: "Pula InMaili: 2 miesięcznie",
      events_members: "Wydarzenia członkowskie",
      member_library: "Biblioteka członkowska",
      early_access: "Wczesny dostęp do raportów",
      working_groups: "Grupy robocze",
      corporate_seats: "Miejsca dla organizacji",
      vip_concierge: "Konsjerż VIP",
      teaching_licence: "Licencja dydaktyczna",
      strategic_partner: "Partner strategiczny",
      general_partner: "Partner generalny",
      presidents_circle: "President's Circle",
      supporter_updates: "Aktualizacje dla wspierających",
      gift_links: "Linki podarunkowe",
      chatham_house_events: "Spotkania w regule Chatham House",
    },

    quotas: {
      expert_request_quota: "Zapytania do eksperta - pula miesięczna",
      included_event_tickets: "Bilety wliczone w plan - pula roczna na członka",
      included_event_tickets_org: "Bilety wliczone w plan - pula roczna na organizację",
      event_ticket_discount_pct: "Zniżka na wydarzenia biletowane (%)",
    },
  },
};

const adminPermissionsEn = {
  adminPermissions: {
    title: "Permissions matrix",
    subtitle:
      "The capability scope of system roles and membership tiers - generated from the database gates, not typed by hand.",
    sourceTitle: "Where this data comes from",
    sourceBody:
      "Role columns come from a snapshot of the SQL gates (SECURITY DEFINER functions and RLS policies) reconstructed from the migrations. Tier columns read the features flags of the current workspace's tiers. Any drift between this page and the database fails CI (parity test), and `bun run generate:authz-snapshot` refreshes the snapshot.",
    generatedFrom:
      "Snapshot: {{migrations}} migrations, {{functions}} functions, {{policies}} RLS policies.",
    rlsNote:
      "Access is enforced by the database: RLS and SECURITY DEFINER functions. This page shows what those gates actually say - not a product promise.",
    tenantNote:
      "The view is scoped to the current workspace's tiers (tenant_id) - another company's data is not reachable here.",

    kpi: {
      rows: "Matrix entries",
      enforced: "Backed by a gate",
      decorative: "No gate (declaration)",
      tiers: "Workspace tiers",
      gatesWithoutCallerTenant: "Gates without current_tenant_id()",
    },

    groups: {
      tenant: "Workspace & configuration",
      users: "Users & roles",
      content: "Content & publishing",
      community: "Events & community",
      monitoring: "Regulatory monitoring",
      monetization: "Monetisation & analytics",
      membership: "Membership tier scope",
    },

    levels: {
      full: "Full",
      partial: "Own",
      none: "None",
      not_applicable: "N/A",
    },
    levelHints: {
      full: "The gate names this role (or the tier has this flag enabled).",
      partial: "The gate lets this role through, but only for its own records.",
      none: "The gate does not let this role through.",
      not_applicable:
        "This entry does not depend on that column - a role gate ignores tiers, and a tier gate ignores roles unless it declares an explicit bypass.",
    },

    enforcement: {
      enforced: "Enforced",
      decorative: "Decorative",
      enforcedHint: "A database gate reads this entry.",
      decorativeHint:
        "No gate reads this flag - today it is a marketing promise, not a system constraint.",
    },

    gateMode: {
      any: "alternative",
      all: "hard requirement",
      mixed: "mixed",
      none: "none",
      anyHint: "Any one of the listed roles is enough (an OR branch).",
      allHint: "The role is required unconditionally (an assert in the function body).",
      mixedHint: "The gate combines a hard requirement with alternatives - check the SQL source.",
      noneHint: "The gate names no role at all.",
    },

    tenant: {
      caller: "caller's tenant",
      row: "row tenant",
      none: "no tenant",
      callerHint: "The gate calls current_tenant_id() - it binds data to the caller's workspace.",
      rowHint:
        "The gate compares tenant_id columns (row-to-row consistency) but does not bind them to the caller's workspace.",
      noneHint: "The gate makes no reference to a tenant - an item to review during the audit.",
    },

    gate: {
      function: "function",
      policy: "RLS policy",
      definer: "SECURITY DEFINER",
      definerHint: "The function bypasses RLS, so its own role gate is the only constraint.",
      label: "Gate",
      none: "no gate",
      provenance: "Migration",
      provenanceHint:
        "Migrations are forward-only, so the LAST definition of this gate is the law. The file holding it:",
    },

    toolbar: {
      search: "Search an entry or a gate…",
      searchLabel: "Search the permissions matrix",
      actorAll: "All columns",
      actorRole: "Roles",
      actorTier: "Tiers",
      onlyEnforced: "Gated only",
      groupAll: "All sections",
      reset: "Clear filters",
      results: "{{count}} entries",
      results_one: "{{count}} entry",
    },

    table: {
      capability: "Entry",
      caption: "Permissions matrix: system roles and membership tiers",
      legend: "Legend",
      flagColumn: "Flag",
      quotaUnit: "{{count}} / month",
      quotaNone: "No pool",
    },

    empty: {
      rows: "No entries match these filters.",
      tiers: "This workspace has no active membership tiers - the matrix shows system roles only.",
      loading: "Loading the workspace tiers…",
      error: "Could not load the workspace tiers.",
    },

    roles: {
      super_admin: {
        name: "Super-Admin",
        desc: "The highest-trust role. Gates name it explicitly - it does not inherit Admin's permissions.",
      },
      admin: {
        name: "Admin",
        desc: "The operational owner of the workspace: users, roles, billing, configuration.",
      },
      editor: {
        name: "Editor",
        desc: "Editorial and moderation scope across the whole workspace.",
      },
      author: {
        name: "Author / Speaker",
        desc: "Own content and events; beyond their own records the gates do not let them through.",
      },
      user: {
        name: "User",
        desc: "A signed-in account with no editorial role - its scope comes purely from the membership tier.",
      },
    },
    roleBadge: "role",
    tierBadge: "tier",
    tierDefaultBadge: "default",
    tierRank: "rank {{rank}}",

    rows: {
      tenant_pin: "Pinning a profile to a workspace",
      integration_secrets: "Integration and webhook secrets",
      crm_secrets: "CRM integration secrets",
      scheduler_health: "Job scheduler health",
      content_password: "Content access password",

      users_list: "Workspace user list",
      users_detail: "User record (contact data)",
      roles_assign: "Granting and revoking roles",
      user_consents: "User consents and their history",
      profile_verification: "Profile verification (badge, expert lifetime VIP)",
      verification_domains: "Organisation verification domains",
      profile_privileged_columns: "Profile company link (protected column)",
      badges_grant: "Granting profile badges",
      avatar_replace: "Replacing a user avatar",
      org_seats: "Organisation seat limit",

      editorial_scope: "Editorial scope (panel and content)",
      publish: "Publishing content",
      comments_moderate: "Moderating comments",
      comments_owner_edit: "Editing a comment after publication",
      legal_publish: "Publishing legal document versions",
      related_signals: "Related-content signals",

      event_access: "Event and recording access",
      qa_summary: "Publishing a Q&A session summary",
      poll_results: "Community poll results",
      presence: "User presence on content",
      chat_moderation: "Chat message moderation",
      community_stats: "Community statistics",
      expert_requests_switch: "Expert request switch",
      resource_download: "Authorising a resource download",
      clubs_structure: "Discussion club structure",
      clubs_access: "Club and section access",

      monetization_dashboard: "Monetisation dashboard",
      engagement_overview: "Engagement overview",
      metering_preview: "Metering limit impact preview",
      metering_user_count: "User metering counter",
      coupons_analytics: "B2B coupon analytics",
      coupons_bulk: "Bulk coupon generation",
      gift_links_admin: "Gift link register",
      gift_link_revoke: "Revoking a gift link",
      payment_status_guard: "Changing a payment order status",
      crm_backfill: "CRM lead backfill",
      membership_grant: "Granting a tier off-plan",
      membership_grants_list: "Tier grant register",
    },

    caps: {
      premium_content: "Premium content",
      regulatory_monitoring: "Regulatory monitoring (tracker)",
      pro_briefings: "Pro briefings",
      recordings: "Event recordings",
      qa_priority: "Q&A question priority",
      chat_enabled: "Private messages (DM)",
      chat_direct_gated: "DM to experts without a request",
      chat_inmail_quota_5: "InMail pool: 5 per month",
      chat_inmail_quota_2: "InMail pool: 2 per month",
      events_members: "Member events",
      member_library: "Member library",
      early_access: "Early access to reports",
      working_groups: "Working groups",
      corporate_seats: "Organisation seats",
      vip_concierge: "VIP concierge",
      teaching_licence: "Teaching licence",
      strategic_partner: "Strategic partner",
      general_partner: "General partner",
      presidents_circle: "President's Circle",
      supporter_updates: "Supporter updates",
      gift_links: "Gift links",
      chatham_house_events: "Chatham House Rule meetings",
    },

    quotas: {
      expert_request_quota: "Expert requests - monthly pool",
      included_event_tickets: "Included tickets - yearly pool per member",
      included_event_tickets_org: "Included tickets - yearly pool per organisation",
      event_ticket_discount_pct: "Ticketed event discount (%)",
    },
  },
};

i18n.addResourceBundle("pl", "translation", adminPermissionsPl, true, true);
i18n.addResourceBundle("en", "translation", adminPermissionsEn, true, true);

/**
 * No-op wołany w komponencie trasy zamiast side-effectowego importu modułu -
 * nazwane wiązanie pozwala splitterowi trzymać ten słownik w chunku trasy.
 */
export function ensureI18n(): void {}
