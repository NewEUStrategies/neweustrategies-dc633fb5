import i18n from "./i18n";

// Overlay dla katalogu członków (/admin/members): lista osób z planem,
// historią płatności i ręczną zmianą planu niezależną od operatora płatności.

const pl = {
  adminMembers: {
    title: "Członkowie",
    subtitle:
      "Kto ma jaki plan, skąd ten plan wynika i ile zapłacił. Plan można nadać ręcznie - działa nawet bez płatności online.",
    refresh: "Odśwież",
    filters: {
      search: "Szukaj po adresie, nazwie lub firmie",
      tier: "Plan",
      allTiers: "Wszystkie plany",
    },
    table: {
      member: "Członek",
      tier: "Plan",
      source: "Podstawa",
      paid: "Zapłacono",
      lastPayment: "Ostatnia płatność",
      crm: "CRM",
      actions: "Akcje",
      empty: "Brak członków spełniających kryteria.",
      loading: "Wczytywanie...",
      page: "Strona {{page}} z {{pages}}",
      prev: "Poprzednia",
      next: "Następna",
      count: "{{count}} osób",
      never: "Brak",
    },
    source: {
      grant: "Nadanie ręczne",
      subscription: "Subskrypcja",
      default: "Plan domyślny",
    },
    details: {
      show: "Szczegóły",
      hide: "Ukryj",
      payments: "Płatności",
      grants: "Historia nadań",
      noPayments: "Brak płatności.",
      noGrants: "Brak nadań.",
      invoice: "Faktura",
      revoked: "Cofnięte",
      until: "do {{date}}",
      forever: "bezterminowo",
    },
    grant: {
      open: "Zmień plan",
      title: "Ręczna zmiana planu",
      description:
        "Nadanie ma pierwszeństwo przed subskrypcją. Użyj go, gdy płatność przyszła poza platformą.",
      tier: "Nowy plan",
      months: "Czas trwania",
      monthsOption: "{{count}} mies.",
      forever: "Bezterminowo",
      note: "Notatka (opcjonalnie)",
      submit: "Nadaj plan",
      cancel: "Anuluj",
      revoke: "Cofnij nadanie",
      success: "Plan został zaktualizowany.",
      revoked: "Nadanie zostało cofnięte.",
      error: "Nie udało się zmienić planu.",
    },
    crm: {
      open: "Kontakt w CRM",
      missing: "Brak w CRM",
      noCompany: "Bez firmy",
      sync: "Synchronizuj z CRM",
      syncing: "Synchronizuję...",
      synced: "Zsynchronizowano: {{people}} osób, nowych firm: {{companies}}.",
      syncError: "Synchronizacja z CRM nie powiodła się.",
      pending:
        "Część danych CRM wymaga ponowienia synchronizacji. Zapisane zmiany planów są zachowane - użyj przycisku Synchronizuj z CRM.",
    },
    error: "Nie udało się wczytać listy członków.",
  },
};

const en = {
  adminMembers: {
    title: "Members",
    subtitle:
      "Who is on which plan, why they are on it, and how much they paid. Plans can be set manually - no online payment required.",
    refresh: "Refresh",
    filters: {
      search: "Search by email, name or company",
      tier: "Plan",
      allTiers: "All plans",
    },
    table: {
      member: "Member",
      tier: "Plan",
      source: "Basis",
      paid: "Paid",
      lastPayment: "Last payment",
      crm: "CRM",
      actions: "Actions",
      empty: "No members match these filters.",
      loading: "Loading...",
      page: "Page {{page}} of {{pages}}",
      prev: "Previous",
      next: "Next",
      count: "{{count}} people",
      never: "None",
    },
    source: {
      grant: "Manual grant",
      subscription: "Subscription",
      default: "Default plan",
    },
    details: {
      show: "Details",
      hide: "Hide",
      payments: "Payments",
      grants: "Grant history",
      noPayments: "No payments.",
      noGrants: "No grants.",
      invoice: "Invoice",
      revoked: "Revoked",
      until: "until {{date}}",
      forever: "no end date",
    },
    grant: {
      open: "Change plan",
      title: "Manual plan change",
      description:
        "A grant takes precedence over a subscription. Use it when payment arrived outside the platform.",
      tier: "New plan",
      months: "Duration",
      monthsOption: "{{count}} mo.",
      forever: "No end date",
      note: "Note (optional)",
      submit: "Grant plan",
      cancel: "Cancel",
      revoke: "Revoke grant",
      success: "Plan updated.",
      revoked: "Grant revoked.",
      error: "Could not change the plan.",
    },
    crm: {
      open: "CRM contact",
      missing: "Not in CRM",
      noCompany: "No company",
      sync: "Sync with CRM",
      syncing: "Syncing...",
      synced: "Synced {{people}} people, {{companies}} new companies.",
      syncError: "CRM sync failed.",
      pending:
        "Some CRM data needs another sync attempt. Saved plan changes are preserved - use Sync with CRM.",
    },
    error: "Could not load the member list.",
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

export {};
