// Zasoby i18n dla panelu adminowego /admin/membership: warstwy członkostwa,
// mapowanie planów, nadania off-plan, edytor benefitów, dialog nowej warstwy.
import i18n from "@/lib/i18n";

const adminMembershipPl = {
  adminMembership: {
    title: "Warstwy członkostwa",
    subtitle:
      "Warstwa decyduje o dostępie do funkcji społeczności (wydarzenia dla członków, briefingi Pro). Ranga: 0 = czytelnik, wyższa = szerszy dostęp.",
    newTier: "Nowa warstwa",
    rankBadge: "ranga",
    defaultBadge: "domyślna",
    inactiveBadge: "nieaktywna",
    deleteTitle: "Usuń warstwę",
    deleteDefaultDisabled: "Nie można usunąć warstwy domyślnej",
    deleteConfirm: 'Usunąć warstwę "{{key}}"? Operacji nie można cofnąć.',
    kpi: {
      tiers: "Warstwy (aktywne / wszystkie)",
      default: "Domyślna warstwa",
      mappedPlans: "Plany z warstwą",
      activeGrants: "Aktywne nadania",
    },
    tabs: {
      tiers: "Warstwy",
      mapping: "Mapowanie planów",
      grants: "Nadania",
      orgs: "Organizacje",
    },
    sections: {
      tiersTitle: "Katalog warstw",
      tiersDesc:
        "Nazwa, opis, benefity i bramki (capabilities) każdej warstwy. Kolejność wg rangi.",
    },
    groups: {
      naming: "Nazewnictwo i opis",
      status: "Ranga i status",
      benefits: "Benefity (per punkt)",
      capabilities: "Bramki i limity (capabilities)",
      grantForm: "Nowe nadanie",
    },

    fields: {
      namePl: "Nazwa PL",
      nameEn: "Name EN",
      descriptionPl: "Opis PL",
      descriptionEn: "Description EN",
      rank: "Ranga",
      active: "Aktywna",
      default: "Domyślna",
      featuresJson: "features (JSON)",
      featuresKnown: "Flagi z rejestru capabilities (kliknij, aby przełączyć)",
      featuresHint:
        "Zielone flagi mają realną bramkę w systemie, szare są dziś deklaracją marketingową (najedź, aby zobaczyć punkt egzekwowania). Surowy JSON obsługuje flagi niestandardowe.",
    },
    expertRequest: {
      label: "Zapytania do eksperta - pula miesięczna",
      unit: "zapytań / miesiąc",
      directNote: "Warstwa pisze do ekspertów bezpośrednio (chat_direct_gated) - bez limitu.",
      hint: "Miesięczna pula sformalizowanych zapytań do ekspertów i VIP-ów (0 = brak). Egzekwowana serwerowo per tenant przez send_expert_request; ta sama liczba pokazuje się w cenniku.",
    },
    save: "Zapisz",
    toast: {
      tierSaved: "Zapisano warstwę",
      tierDeleted: "Usunięto warstwę",
      tierCreated: "Utworzono warstwę",
      planMappingSaved: "Zapisano mapowanie planu",
      grantSuccess: "Nadano warstwę",
      grantRevoked: "Cofnięto nadanie",
      featuresInvalid: "Pole features nie jest poprawnym JSON-em",
      noTenant: "Brak tenantu",
      noAccount: "Nie znaleziono konta o tym e-mailu",
      unknownTier: "Nieznana warstwa",
    },
    mapping: {
      heading: "Mapowanie planów na warstwy",
      hint: "Aktywna subskrypcja planu nadaje wskazaną warstwę. Plan bez warstwy daje tylko dostęp do treści (paywall).",
      noTier: "- bez warstwy -",
    },
    org: {
      heading: "Członkostwo organizacji",
      hint: "Członkostwo korporacyjne i partnerskie (wiele kont / miejsc) prowadzisz w osobnym panelu.",
      open: "Otwórz organizacje",
    },
    grants: {
      heading: "Nadania warstwy (poza planem)",
      newHeading: "Nowe nadanie",
      activeHeading: "Aktywne nadania",
      activeHint: "Konta, które mają nadaną warstwę poza subskrypcją planu.",
      revokedHeading: "Cofnięte nadania",
      revokedHint: "Historia cofniętych nadań (tylko do odczytu).",
      hint: "Nadaj warstwę bezpośrednio po e-mailu konta (sprzedaż fakturowa, członkostwo eksperckie/partnerskie, komplementarne). Pozostaw „miesiące” puste dla nadania bezterminowego.",
      tier: "Warstwa",
      tierSelect: "wybierz",
      months: "Miesiące",
      grant: "Nadaj",
      note: "Notatka (opcjonalnie)",
      empty: "Brak aktywnych nadań.",
      until: "do",
      noExpiry: "bezterminowo",
      revoked: "cofnięte",
      revoke: "Cofnij",
      sourceDonation: "darowizna",
      sourceImport: "import",
      sourceManual: "ręczne",
    },

    benefits: {
      heading: "Benefity (per punkt)",
      add: "Dodaj",
      empty: "Brak benefitów. Dodaj pierwszy punkt.",
      moveUp: "W górę",
      moveDown: "W dół",
      remove: "Usuń",
    },
    newTierDialog: {
      title: "Nowa warstwa",
      key: "Klucz (slug)",
      keyHint: "2-32 znaki: a-z, 0-9, _ lub -. Musi być unikalny.",
      rank: "Ranga",
      rankHint: "Wyższa ranga = szerszy dostęp. Standard: 0/10/20.",
      cancel: "Anuluj",
      create: "Utwórz",
    },
  },
};

const adminMembershipEn = {
  adminMembership: {
    title: "Membership tiers",
    subtitle:
      "The tier gates community features (member events, Pro briefings). Rank: 0 = reader, higher = more access.",
    newTier: "New tier",
    rankBadge: "rank",
    defaultBadge: "default",
    inactiveBadge: "inactive",
    deleteTitle: "Delete tier",
    deleteDefaultDisabled: "Cannot delete default tier",
    deleteConfirm: 'Delete tier "{{key}}"? This cannot be undone.',
    kpi: {
      tiers: "Tiers (active / total)",
      default: "Default tier",
      mappedPlans: "Plans with tier",
      activeGrants: "Active grants",
    },
    tabs: {
      tiers: "Tiers",
      mapping: "Plan mapping",
      grants: "Grants",
      orgs: "Organisations",
    },
    sections: {
      tiersTitle: "Tier catalogue",
      tiersDesc: "Name, description, benefits and capability gates for each tier. Ordered by rank.",
    },
    groups: {
      naming: "Naming and description",
      status: "Rank and status",
      benefits: "Benefits (per item)",
      capabilities: "Gates and limits (capabilities)",
      grantForm: "New grant",
    },

    fields: {
      namePl: "Nazwa PL",
      nameEn: "Name EN",
      descriptionPl: "Opis PL",
      descriptionEn: "Description EN",
      rank: "Rank",
      active: "Active",
      default: "Default",
      featuresJson: "features (JSON)",
      featuresKnown: "Flags from the capabilities registry (click to toggle)",
      featuresHint:
        "Green flags are enforced by a real gate in the system; grey ones are marketing-only today (hover to see the enforcement point). The raw JSON accepts custom flags.",
    },
    expertRequest: {
      label: "Expert requests - monthly allowance",
      unit: "requests / month",
      directNote: "This tier messages experts directly (chat_direct_gated) - no limit.",
      hint: "Monthly allowance of formal requests to experts and VIPs (0 = none). Enforced server-side per tenant by send_expert_request; the same number shows on the pricing page.",
    },
    save: "Save",
    toast: {
      tierSaved: "Tier saved",
      tierDeleted: "Tier deleted",
      tierCreated: "Tier created",
      planMappingSaved: "Plan mapping saved",
      grantSuccess: "Membership granted",
      grantRevoked: "Grant revoked",
      featuresInvalid: "Features is not valid JSON",
      noTenant: "No tenant",
      noAccount: "No account with that email",
      unknownTier: "Unknown tier",
    },
    mapping: {
      heading: "Plan-to-tier mapping",
      hint: "An active subscription grants the mapped tier. A plan without a tier only unlocks content (paywall).",
      noTier: "- no tier -",
    },
    org: {
      heading: "Organisation membership",
      hint: "Corporate and partner membership (multiple accounts / seats) is managed in a separate panel.",
      open: "Open organisations",
    },
    grants: {
      heading: "Membership grants (off-plan)",
      hint: "Grant a tier directly by account email (invoice sales, expert/partner membership, complimentary). Leave “months” empty for an open-ended grant.",
      tier: "Tier",
      tierSelect: "select",
      months: "Months",
      grant: "Grant",
      note: "Note (optional)",
      empty: "No active grants.",
      until: "until",
      noExpiry: "no expiry",
      revoked: "revoked",
      revoke: "Revoke",
      sourceDonation: "donation",
      sourceImport: "import",
      sourceManual: "manual",
    },
    benefits: {
      heading: "Benefits (per item)",
      add: "Add",
      empty: "No benefits yet. Add the first item.",
      moveUp: "Move up",
      moveDown: "Move down",
      remove: "Remove",
    },
    newTierDialog: {
      title: "New tier",
      key: "Key (slug)",
      keyHint: "2-32 chars: a-z, 0-9, _ or -. Must be unique.",
      rank: "Rank",
      rankHint: "Higher rank = more access. Standard: 0/10/20.",
      cancel: "Cancel",
      create: "Create",
    },
  },
};

i18n.addResourceBundle("pl", "translation", adminMembershipPl, true, true);
i18n.addResourceBundle("en", "translation", adminMembershipEn, true, true);

/**
 * No-op wołany w komponencie trasy zamiast side-effectowego importu modułu.
 * Nazwane wiązanie pozwala splitterowi TanStacka przenieść cały bundle
 * tłumaczeń do chunka trasy - side-effectowy import w pliku trasy lądował
 * w eager-owym grafie wejściowym każdej strony. Rejestracja dzieje się przy
 * ewaluacji modułu (przed renderem komponentu), dokładnie jak wcześniej.
 */
export function ensureI18n(): void {}
