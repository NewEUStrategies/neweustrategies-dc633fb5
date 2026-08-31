// i18n panelu monetyzacji (PL/EN). Rejestracja przez `ensureI18n()` wołane
// w komponencie trasy - słownik jedzie w chunku panelu, nie w entry.
import i18n from "./i18n";

export const adminMonetizationPl = {
  adminMonetization: {
    title: "Monetyzacja",
    intro:
      "Wpłaty, przydziały członkostwa i linki prezentowe jednego najemcy. Rejestr jest zawężony do domeny, na której pracujesz.",
    loading: "Wczytywanie rejestru...",
    error: "Nie udało się wczytać rejestru.",
    retry: "Spróbuj ponownie",
    tenantMissing: "Ta domena nie jest przypisana do żadnego najemcy - rejestr jest pusty.",
    environment: {
      label: "Środowisko",
      all: "Wszystkie",
      live: "Produkcyjne",
      sandbox: "Testowe",
      unknown: "Nieokreślone",
    },
    summary: {
      paid: "Wpłaty rozliczone",
      donations: "Wpłaty łącznie",
      pending: "Oczekujące",
      grants: "Aktywne przydziały",
      giftLinks: "Aktywne linki",
      noPaid: "Brak rozliczonych wpłat",
    },
    sections: {
      donations: "Wpłaty",
      grants: "Przydziały członkostwa",
      giftLinks: "Linki prezentowe",
    },
    empty: "Brak wierszy dla wybranego środowiska.",
    donations: {
      amount: "Kwota",
      status: "Status",
      donor: "Darczyńca",
      recurring: "Cykliczna",
      created: "Utworzono",
      anonymous: "Anonimowo",
      yes: "Tak",
      no: "Nie",
    },
    grants: {
      tier: "Warstwa",
      source: "Źródło",
      status: "Status",
      period: "Okres",
      note: "Notatka",
      indefinite: "Bezterminowo",
      statuses: {
        active: "Aktywny",
        revoked: "Cofnięty",
        expired: "Wygasły",
        scheduled: "Zaplanowany",
      },
    },
    giftLinks: {
      code: "Kod",
      status: "Status",
      redemptions: "Kliknięcia",
      unlimited: "Bez limitu",
      created: "Utworzono",
      statuses: {
        active: "Aktywny",
        revoked: "Unieważniony",
        expired: "Wygasły",
        exhausted: "Wyczerpany",
      },
    },
  },
};

export const adminMonetizationEn = {
  adminMonetization: {
    title: "Monetisation",
    intro:
      "Donations, membership grants and gift links for a single tenant. The ledger is scoped to the domain you are working on.",
    loading: "Loading ledger...",
    error: "The ledger could not be loaded.",
    retry: "Try again",
    tenantMissing: "This domain is not mapped to a tenant - the ledger is empty.",
    environment: {
      label: "Environment",
      all: "All",
      live: "Live",
      sandbox: "Sandbox",
      unknown: "Unspecified",
    },
    summary: {
      paid: "Settled donations",
      donations: "Donations total",
      pending: "Pending",
      grants: "Active grants",
      giftLinks: "Active links",
      noPaid: "No settled donations",
    },
    sections: {
      donations: "Donations",
      grants: "Membership grants",
      giftLinks: "Gift links",
    },
    empty: "No rows for the selected environment.",
    donations: {
      amount: "Amount",
      status: "Status",
      donor: "Donor",
      recurring: "Recurring",
      created: "Created",
      anonymous: "Anonymous",
      yes: "Yes",
      no: "No",
    },
    grants: {
      tier: "Tier",
      source: "Source",
      status: "Status",
      period: "Period",
      note: "Note",
      indefinite: "Indefinite",
      statuses: {
        active: "Active",
        revoked: "Revoked",
        expired: "Expired",
        scheduled: "Scheduled",
      },
    },
    giftLinks: {
      code: "Code",
      status: "Status",
      redemptions: "Redemptions",
      unlimited: "Unlimited",
      created: "Created",
      statuses: {
        active: "Active",
        revoked: "Revoked",
        expired: "Expired",
        exhausted: "Exhausted",
      },
    },
  },
};

i18n.addResourceBundle("pl", "translation", adminMonetizationPl, true, true);
i18n.addResourceBundle("en", "translation", adminMonetizationEn, true, true);

/** No-op wołany w komponencie trasy - patrz i18n-donate.ts. */
export function ensureI18n(): void {}
