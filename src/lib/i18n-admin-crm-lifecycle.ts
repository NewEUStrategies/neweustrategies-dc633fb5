// Zasoby i18n cyklu życia kontaktu CRM (hub S4): etapy cyklu życia, segmenty
// (`source_type`), źródła wpisów historii, karta historii etapów, zmiana
// etapu z panelu i filtry listy (cykl życia, segment, tagi, właściciel).
//
// Side-effect import w komponencie: import "@/lib/i18n-admin-crm-lifecycle";
// Obiekty pl/en są eksportowane - test parytetu pilnuje identycznego drzewa
// kluczy, a komponenty z prop `lang` (lista CRM) czytają etykiety wprost.
import i18n from "@/lib/i18n";

export const crmLifecyclePl = {
  adminCrm: {
    lifecycle: {
      title: "Cykl życia",
      stages: {
        subscriber: "Subskrybent",
        lead: "Lead",
        registered: "Zarejestrowany",
        mql: "MQL",
        sql: "SQL",
        opportunity: "Szansa sprzedaży",
        customer: "Klient",
        former_customer: "Były klient",
        other: "Inny",
      },
      stageHints: {
        subscriber: "Zapisany na newsletter, bez innych sygnałów.",
        lead: "Zostawił dane kontaktowe (formularz, wydarzenie, import).",
        registered: "Ma konto w serwisie.",
        mql: "Zakwalifikowany marketingowo - zaangażowanie wskazuje na zainteresowanie ofertą.",
        sql: "Zakwalifikowany sprzedażowo - handlowiec potwierdził potrzebę.",
        opportunity: "Toczy się rozmowa o konkretnej ofercie.",
        customer: "Płaci - etap nadaje wyłącznie billing.",
        former_customer: "Płacił, subskrypcja zakończona - etap nadaje wyłącznie billing.",
        other: "Kontakt spoza lejka (partner, media, dostawca).",
      },
      segments: {
        manual: "Dodany ręcznie",
        contact_form: "Formularz kontaktowy",
        newsletter: "Newsletter",
        registered: "Rejestracja konta",
        event_participant: "Uczestnik wydarzenia",
        event_cfp: "Zgłoszenie wystąpienia",
        speaker: "Prelegent",
        club_application: "Zgłoszenie do klubu",
        careers: "Rekrutacja",
        expert: "Ekspert",
        paid_subscriber: "Klient płacący",
      },
      historySources: {
        manual: "Ręcznie",
        bulk: "Zmiana zbiorcza",
        billing: "Billing",
        journey: "Ścieżka",
        workflow: "Przepis",
        import: "Import",
        system: "System",
        backfill: "Odtworzone przy wdrożeniu",
      },
      dimensions: {
        crm_stage: "Etap sprzedaży",
        lifecycle: "Cykl życia",
      },
      crmStages: {
        new: "Nowy",
        contacted: "Kontakt nawiązany",
        qualified: "Zakwalifikowany",
        proposal: "Oferta",
        won: "Wygrany",
        lost: "Przegrany",
        archived: "Zarchiwizowany",
      },
      history: {
        title: "Historia etapów",
        description:
          "Każda zmiana etapu sprzedaży i cyklu życia - kto, kiedy i skąd. Wpisy „odtworzone przy wdrożeniu” pochodzą z dziennika audytu.",
        empty: "Brak zmian etapów dla tego kontaktu.",
        loadError: "Nie udało się wczytać historii etapów.",
        retry: "Spróbuj ponownie",
        filterAll: "Wszystkie",
        initial: "start",
        by: "przez {{who}}",
        viaJourney: "ścieżka",
        showMore: "Pokaż starsze ({{count}})",
        showLess: "Zwiń",
        changeLabel: "{{from}} → {{to}}",
      },
      change: {
        label: "Zmień etap cyklu życia",
        placeholder: "Wybierz etap",
        billingOwned: "Etapy „Klient” i „Były klient” nadaje wyłącznie billing (płatność).",
        saved: "Etap cyklu życia zmieniony",
        skipped: {
          billing_owned: "Etapu klienta nie można ustawić ręcznie - nadaje go płatność.",
          unchanged: "Kontakt jest już na tym etapie.",
          precedence: "Etap ustawił billing - ręczna zmiana nie ma pierwszeństwa.",
          backward: "Cofnięcie etapu zostało zablokowane.",
        },
        error: "Nie udało się zmienić etapu: {{message}}",
      },
      filters: {
        lifecycle: "Cykl życia",
        segment: "Segment",
        tags: "Tagi",
        owner: "Właściciel",
        any: "Dowolny",
        tagsPlaceholder: "Wybierz albo wpisz tag",
        tagsAdd: "Dodaj tag",
        tagsHint: "Kontakt ma co najmniej jeden z wybranych tagów.",
        ownerAny: "Dowolny właściciel",
        ownerLoading: "Wczytywanie zespołu...",
        ownerEmpty: "Brak osób w zespole CRM",
        selected: "{{count}} wybr.",
        legacySource: "Źródło (stary widok)",
        remove: "Usuń {{value}}",
      },
    },
  },
};

export const crmLifecycleEn: typeof crmLifecyclePl = {
  adminCrm: {
    lifecycle: {
      title: "Lifecycle",
      stages: {
        subscriber: "Subscriber",
        lead: "Lead",
        registered: "Registered",
        mql: "MQL",
        sql: "SQL",
        opportunity: "Opportunity",
        customer: "Customer",
        former_customer: "Former customer",
        other: "Other",
      },
      stageHints: {
        subscriber: "Subscribed to the newsletter, no other signals.",
        lead: "Left contact details (form, event, import).",
        registered: "Has an account on the site.",
        mql: "Marketing qualified - engagement suggests interest in the offer.",
        sql: "Sales qualified - a salesperson confirmed the need.",
        opportunity: "A conversation about a specific offer is under way.",
        customer: "Paying - set by billing only.",
        former_customer: "Used to pay, subscription ended - set by billing only.",
        other: "Contact outside the funnel (partner, media, vendor).",
      },
      segments: {
        manual: "Added manually",
        contact_form: "Contact form",
        newsletter: "Newsletter",
        registered: "Account sign-up",
        event_participant: "Event attendee",
        event_cfp: "Call for papers",
        speaker: "Speaker",
        club_application: "Club application",
        careers: "Careers",
        expert: "Expert",
        paid_subscriber: "Paying customer",
      },
      historySources: {
        manual: "Manual",
        bulk: "Bulk change",
        billing: "Billing",
        journey: "Journey",
        workflow: "Recipe",
        import: "Import",
        system: "System",
        backfill: "Restored at rollout",
      },
      dimensions: {
        crm_stage: "Sales stage",
        lifecycle: "Lifecycle",
      },
      crmStages: {
        new: "New",
        contacted: "Contacted",
        qualified: "Qualified",
        proposal: "Proposal",
        won: "Won",
        lost: "Lost",
        archived: "Archived",
      },
      history: {
        title: "Stage history",
        description:
          "Every change of the sales stage and lifecycle - who, when and from where. Entries “restored at rollout” come from the audit log.",
        empty: "No stage changes for this contact.",
        loadError: "Could not load the stage history.",
        retry: "Try again",
        filterAll: "All",
        initial: "start",
        by: "by {{who}}",
        viaJourney: "journey",
        showMore: "Show older ({{count}})",
        showLess: "Collapse",
        changeLabel: "{{from}} → {{to}}",
      },
      change: {
        label: "Change lifecycle stage",
        placeholder: "Pick a stage",
        billingOwned: "“Customer” and “Former customer” are set by billing (payment) only.",
        saved: "Lifecycle stage changed",
        skipped: {
          billing_owned: "A customer stage cannot be set manually - payment sets it.",
          unchanged: "The contact is already at this stage.",
          precedence: "Billing set this stage - a manual change does not take precedence.",
          backward: "Moving the stage back was blocked.",
        },
        error: "Could not change the stage: {{message}}",
      },
      filters: {
        lifecycle: "Lifecycle",
        segment: "Segment",
        tags: "Tags",
        owner: "Owner",
        any: "Any",
        tagsPlaceholder: "Pick or type a tag",
        tagsAdd: "Add tag",
        tagsHint: "The contact has at least one of the selected tags.",
        ownerAny: "Any owner",
        ownerLoading: "Loading the team...",
        ownerEmpty: "No one in the CRM team",
        selected: "{{count}} selected",
        legacySource: "Source (old view)",
        remove: "Remove {{value}}",
      },
    },
  },
};

/** Słownik dla komponentów z prop `lang` (lista CRM nie używa i18next). */
export function crmLifecycleDict(lang: "pl" | "en") {
  return (lang === "en" ? crmLifecycleEn : crmLifecyclePl).adminCrm.lifecycle;
}

i18n.addResourceBundle("pl", "translation", crmLifecyclePl, true, true);
i18n.addResourceBundle("en", "translation", crmLifecycleEn, true, true);
