// Fabryka kluczy React Query dla całego ekosystemu monetyzacji (cennik,
// warstwy, plany, subskrypcje, nadania, organizacje, darowizny). Te same
// stałe konsumują hooki, mutacje panelu admina ORAZ mapa inwalidacji szyny
// zdarzeń (eventInvalidationMap) - zero dryfu literałów między modułami.
//
// Klucze per-user niosą uid (ta sama reguła co chatKeys/pendingCounterKeys):
// zmiana konta na jednym urządzeniu nie może serwować cudzej subskrypcji,
// zamówień ani warstwy z cache. Warianty `*All()` to prefiksy do inwalidacji
// (invalidateQueries dopasowuje prefiksem) - obejmują wszystkie uid-y.
export const billingKeys = {
  /** Katalog warstw członkostwa (publiczny, aktywne). */
  membershipTiers: () => ["membership-tiers"] as const,
  /** Aktywne plany cenowe (publiczny cennik + checkout). */
  plansActive: () => ["plans-active"] as const,
  /** Segmenty odbiorców Cennika 2.0. */
  pricingAudiences: () => ["pricing-audiences"] as const,
  /** FAQ cennika. */
  pricingFaq: () => ["pricing-faq"] as const,

  /** Warstwa bieżącego użytkownika (RPC current_membership_tier). */
  currentTier: (uid: string | undefined) => ["current-tier", uid ?? "anon"] as const,
  currentTierAll: () => ["current-tier"] as const,
  /** Aktywna subskrypcja bieżącego użytkownika. */
  mySubscription: (uid: string | undefined) => ["my-subscription", uid ?? "anon"] as const,
  mySubscriptionAll: () => ["my-subscription"] as const,
  /** Historia zamówień bieżącego użytkownika. */
  myOrders: (uid: string | undefined) => ["my-orders", uid ?? "anon"] as const,
  myOrdersAll: () => ["my-orders"] as const,
  /** Dokumenty rozliczeniowe bieżącego użytkownika (faktury/paragony). */
  myBillingDocuments: (uid: string | undefined) => ["my-billing-documents", uid ?? "anon"] as const,
  myBillingDocumentsAll: () => ["my-billing-documents"] as const,
  /** Nadania warstwy poza planem (membership_grants) bieżącego użytkownika. */
  myGrants: (uid: string | undefined) => ["my-grants", uid ?? "anon"] as const,
  myGrantsAll: () => ["my-grants"] as const,
  /** Darowizny bieżącego użytkownika. */
  myDonations: (uid: string | undefined) => ["my-donations", uid ?? "anon"] as const,
  myDonationsAll: () => ["my-donations"] as const,
  /** Organizacja członkowska bieżącego użytkownika (RPC my_organization). */
  myOrganization: (uid: string | undefined) => ["my-organization", uid ?? "anon"] as const,
  myOrganizationAll: () => ["my-organization"] as const,
  /** Miejsca organizacji (widok właściciela). */
  orgSeats: (orgId: string | null | undefined) => ["org-seats", orgId ?? "none"] as const,
  orgSeatsAll: () => ["org-seats"] as const,

  /** Członkostwo dopasowane do leada CRM (RPC crm_lead_membership). */
  crmLeadMembership: (leadId: string) => ["crm-lead-membership", leadId] as const,
  crmLeadMembershipAll: () => ["crm-lead-membership"] as const,

  admin: {
    /** Pełny katalog warstw w panelu (też nieaktywne). */
    membershipTiers: () => ["admin", "membership-tiers"] as const,
    /** Plany w panelach membership/paywall. */
    plans: () => ["admin", "plans-active"] as const,
    /** Nadania warstw w panelu membership. */
    membershipGrants: () => ["admin", "membership-grants"] as const,
    pricingAudiences: () => ["admin", "pricing-audiences"] as const,
    pricingFaq: () => ["admin", "pricing-faq"] as const,
    /** Lista organizacji członkowskich. */
    memberOrgs: () => ["admin", "member-orgs"] as const,
    /** Szczegół organizacji (prefiks bez id inwaliduje wszystkie). */
    memberOrg: (orgId: string) => ["admin", "member-org", orgId] as const,
    memberOrgAll: () => ["admin", "member-org"] as const,
    /** Miejsca organizacji w panelu admina. */
    orgSeats: (orgId: string) => ["admin", "org-seats", orgId] as const,
    orgSeatsAll: () => ["admin", "org-seats"] as const,
    /** Organizacje członkowskie połączone z kartoteką firmy CRM. */
    crmCompanyMemberOrgs: (companyId: string) =>
      ["admin", "crm-company-member-orgs", companyId] as const,
    crmCompanyMemberOrgsAll: () => ["admin", "crm-company-member-orgs"] as const,
    /** Pulpit monetyzacji (prefiks obejmuje filtry dat/planów). */
    monetization: () => ["admin", "monetization"] as const,
    /** Rejestr darowizn w panelu. */
    donations: () => ["admin", "donations"] as const,
    /** Subskrypcje wszystkich użytkowników (lista /admin/users). */
    allUserSubscriptions: () => ["all-user-subscriptions"] as const,
  },
} as const;
