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
  /** Subskrypcja u dostawcy płatności (tabela `subscriptions`, per środowisko). */
  myStripeSubscription: (uid: string | undefined, env: string) =>
    ["my-stripe-subscription", uid ?? "anon", env] as const,
  myStripeSubscriptionAll: () => ["my-stripe-subscription"] as const,
  /** Kwota najbliższego odnowienia z żywej subskrypcji u operatora (karta w profilu). */
  renewalCharge: (subscriptionId: string, env: string, priceId: string, quantity: number) =>
    ["renewal-charge", subscriptionId, env, priceId, quantity] as const,
  /**
   * Ta sama kwota dla strony „Mój plan" (/profile/plan), która zna tylko
   * wiersz uprawnienia, nie subskrypcję operatora - serwer i tak bierze ją
   * z sesji. Wiersz i `lookup_key` planu są w kluczu (jak cena i miejsca
   * w `renewalCharge`): po zmianie planu kwota starej pozycji nie może stać
   * w cache obok nazwy nowego planu. Wspólny prefiks z `renewalCharge`.
   */
  myRenewalCharge: (
    uid: string | undefined,
    env: string,
    subscriptionId: string | null | undefined,
    lookupKey: string | null | undefined,
  ) =>
    [
      "renewal-charge",
      "mine",
      uid ?? "anon",
      env,
      subscriptionId ?? "none",
      lookupKey ?? "none",
    ] as const,
  /**
   * Prefiks obu kwot odnowienia - do inwalidacji po zmianie planu
   * i synchronizacji (zaplanowany downgrade nie zmienia planu ani ceny
   * w kluczu, a odczyt operatora zmienia się na „kwota nieustalona").
   */
  renewalChargeAll: () => ["renewal-charge"] as const,
  /** Podgląd kosztu zmiany planu (kwota liczona przez operatora). */
  planChangePreview: (subscriptionId: string, targetPriceId: string, env: string) =>
    ["plan-change-preview", subscriptionId, targetPriceId, env] as const,
  /** Historia zamówień bieżącego użytkownika. */
  myOrders: (uid: string | undefined) => ["my-orders", uid ?? "anon"] as const,
  myOrdersAll: () => ["my-orders"] as const,
  /** Dokumenty rozliczeniowe bieżącego użytkownika (faktury/paragony). */
  myBillingDocuments: (uid: string | undefined) => ["my-billing-documents", uid ?? "anon"] as const,
  myBillingDocumentsAll: () => ["my-billing-documents"] as const,
  /** Podgląd domyślnej metody płatności (marka + 4 cyfry), per środowisko. */
  myPaymentMethod: (uid: string | undefined, env: string) =>
    ["my-payment-method", uid ?? "anon", env] as const,
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
    /** Subskrypcje u dostawcy płatności (panel /admin/billing). */
    stripeSubscriptions: () => ["admin", "stripe-subscriptions"] as const,
    /** Historia zdarzeń webhooka operatora płatności. */
    paymentWebhookEvents: () => ["admin", "payment-webhook-events"] as const,
    /** Dziennik przeniesienia subskrypcji na cenę katalogu v6.2. */
    subscriptionRepricingLog: () => ["admin", "subscription-repricing-log"] as const,
    /** Subskrypcje wszystkich użytkowników (lista /admin/users). */
    allUserSubscriptions: () => ["all-user-subscriptions"] as const,
    /**
     * Wszystkie plany najemcy, także nieaktywne - JEDEN odczyt dla
     * /admin/paywall i huba przychodu. To NOWY klucz, nie dzisiejszy literał:
     * wycinek S1 przenosi na niego paywall, który dziś czyta własne
     * `["admin-access-plans"]` (bramka literałów zna tamten klucz jako alias
     * przestarzały). Do tej chwili `access_plan.changed.v1` nie odświeża
     * listy planów paywalla.
     */
    plansAll: () => ["admin", "plans-all"] as const,
    /** Zamówienia w panelu /admin/billing - prefiks list ze statusem i środowiskiem. */
    paymentOrders: () => ["admin", "payment-orders"] as const,
    paymentOrdersList: (status: string, environment: string) =>
      ["admin", "payment-orders", status, environment] as const,
    /** Plany testowe diagnostyki płatności. */
    testPlans: () => ["admin", "billing", "test-plans"] as const,
    /** Ustawienia uruchamiania zadań billingu (`getJobRunnerSettings`) w /admin/billing. */
    jobRunner: () => ["admin", "billing", "job-runner"] as const,
    /**
     * Katalog członków (/admin/members). Prefiks `members()` obejmuje każdą
     * stronę i filtr - zmiana nadania albo subskrypcji odświeża całą listę.
     */
    members: () => ["admin-members"] as const,
    membersDirectory: <P>(params: P) => ["admin-members", params] as const,
    /** Płatności i nadania jednego członka (rozwinięcie wiersza). */
    memberBilling: (userId: string) => ["admin-member-billing", userId] as const,
    memberBillingAll: () => ["admin-member-billing"] as const,
    /**
     * Rejestr monetyzacji (darowizny, nadania, linki prezentowe) per
     * środowisko. Leży POD `monetization()`, więc reguła szyny unieważniająca
     * pulpit monetyzacji trafia też w rejestr - bez osobnego wpisu.
     */
    monetizationLedger: (environment: string) =>
      ["admin", "monetization", "ledger", environment] as const,
  },
} as const;
