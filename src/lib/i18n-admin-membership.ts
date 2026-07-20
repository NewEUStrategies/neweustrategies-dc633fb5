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
    deleteTitle: "Usuń warstwę",
    deleteDefaultDisabled: "Nie można usunąć warstwy domyślnej",
    deleteConfirm: 'Usunąć warstwę "{{key}}"? Operacji nie można cofnąć.',
    fields: {
      namePl: "Nazwa PL",
      nameEn: "Name EN",
      descriptionPl: "Opis PL",
      descriptionEn: "Description EN",
      rank: "Ranga",
      active: "Aktywna",
      default: "Domyślna",
      featuresJson: "features (JSON)",
      featuresHint:
        "Flagi: qa_priority (pytania warstwy na górze /qa), pro_briefings (wstęp na wydarzenia kind=briefing dla członków).",
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
    deleteTitle: "Delete tier",
    deleteDefaultDisabled: "Cannot delete default tier",
    deleteConfirm: 'Delete tier "{{key}}"? This cannot be undone.',
    fields: {
      namePl: "Nazwa PL",
      nameEn: "Name EN",
      descriptionPl: "Opis PL",
      descriptionEn: "Description EN",
      rank: "Rank",
      active: "Active",
      default: "Default",
      featuresJson: "features (JSON)",
      featuresHint:
        "Flags: qa_priority (tier's questions ranked first on /qa), pro_briefings (grants entry to members-only kind=briefing events).",
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
