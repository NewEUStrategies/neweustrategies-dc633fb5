// Słownik PUBLICZNEJ STRONY RAPORTU DLA SPONSORA (`/events/$slug/sponsor-report`),
// PL/EN.
//
// DLACZEGO NIE NAKŁADKA PANELU. Tę stronę otwiera sponsor bez konta - jedzie
// w publicznym chunku, a nakładka panelu (`i18n-admin-event-sponsor-report.ts`)
// wciągnęłaby do niego słownik studia. Klucze miejsc (`placements.*`) są tym
// samym camelCase wartości `event_sponsor_exposures.placement`, co w panelu,
// ale teksty mówią do sponsora, nie do organizatora.
import i18n from "@/lib/i18n";

export const eventSponsorReportPl = {
  eventSponsorReport: {
    title: "Raport dla sponsora",
    loading: "Wczytywanie raportu…",
    missingToken: "Ten link jest niepełny. Otwórz go ponownie z wiadomości od organizatora.",
    notFound: "Nie znaleziono raportu. Sprawdź, czy link jest kompletny.",
    expired: "Ten link wygasł albo został odwołany. Poproś organizatora o nowy.",
    rateLimited: "Za dużo prób w krótkim czasie. Spróbuj ponownie za kilka minut.",
    error: "Nie udało się wczytać raportu. Spróbuj ponownie.",
    retry: "Spróbuj ponownie",
    eventLabel: "Wydarzenie",
    generatedAt: "Stan na {{date}}",
    validUntil: "Link ważny do {{date}}",
    consentNote:
      "Liczymy wyłącznie odwiedzających, którzy zgodzili się na pomiar marketingowy. Wyświetlenie to Twój logotyp, materiał albo reklama widoczne co najmniej w połowie przez sekundę; wartości unikalne liczą jedną sesję raz dziennie.",
    kpi: {
      label: "Podsumowanie",
      views: "Wyświetlenia (unikalne)",
      viewsHint: "Łącznie: {{count}}",
      clicks: "Kliknięcia (unikalne)",
      clicksHint: "Łącznie: {{count}}",
      ctr: "CTR",
      ctrHint: "Kliknięcia unikalne / wyświetlenia unikalne",
      materialOpens: "Otwarcia materiałów",
      leads: "Zebrane kontakty",
      leadsHint: "Ze zgodą na przekazanie: {{count}}",
      meetings: "Spotkania odbyte",
      meetingsHint: "Umówione: {{count}}",
    },
    placements: {
      homeStrip: "Pas partnerów na stronie głównej",
      partnersSection: "Sekcja „Partnerzy”",
      partnersTab: "Zakładka „Partnerzy”",
      agendaSession: "Sesja w agendzie",
      agendaTrack: "Ścieżka w agendzie",
      materials: "Materiały",
      homeAd: "Reklama na stronie głównej",
    },
    chart: {
      title: "Dzień po dniu",
      views: "Wyświetlenia",
      clicks: "Kliknięcia",
      leads: "Nowe kontakty",
      empty: "Brak pomiarów.",
    },
    table: {
      title: "Gdzie Cię widziano",
      placement: "Miejsce",
      views: "Wyświetlenia",
      clicks: "Kliknięcia",
      ctr: "CTR",
      materialOpens: "Materiały",
      empty: "Brak pomiarów.",
    },
    leads: {
      title: "Zebrane kontakty",
      hint: "Dane kontaktowe tylko osób, które zgodziły się na przekazanie danych partnerom. Pozostałe wiersze pokazują jedynie skan, notatkę i ocenę Twojej obsługi stoiska.",
      notIncluded: "Organizator udostępnił raport bez listy kontaktów.",
      empty: "Nie zebrano jeszcze kontaktów.",
      downloadCsv: "Pobierz kontakty (CSV)",
      downloadXlsx: "Pobierz kontakty (XLSX)",
      prefix: "kontakty",
    },
    download: {
      title: "Pobierz",
      metricsCsv: "Pobierz metryki (CSV)",
      metricsXlsx: "Pobierz metryki (XLSX)",
      prefix: "raport-sponsora",
      sheetName: "Raport",
      failed: "Nie udało się przygotować pliku.",
      columns: {
        day: "Dzień",
        viewsUnique: "Wyświetlenia (unikalne)",
        clicksUnique: "Kliknięcia (unikalne)",
        ctr: "CTR (%)",
        materialOpens: "Otwarcia materiałów",
        leadsNew: "Nowe kontakty",
      },
    },
  },
} as const;

export const eventSponsorReportEn = {
  eventSponsorReport: {
    title: "Sponsor report",
    loading: "Loading the report…",
    missingToken: "This link is incomplete. Open it again from the organiser's message.",
    notFound: "The report was not found. Check that the link is complete.",
    expired: "This link has expired or was revoked. Ask the organiser for a new one.",
    rateLimited: "Too many attempts in a short time. Try again in a few minutes.",
    error: "The report could not be loaded. Try again.",
    retry: "Try again",
    eventLabel: "Event",
    generatedAt: "As of {{date}}",
    validUntil: "Link valid until {{date}}",
    consentNote:
      "Only visitors who agreed to marketing measurement are counted. An impression is your logo, material or ad at least half visible for one second; unique values count one session once a day.",
    kpi: {
      label: "Summary",
      views: "Impressions (unique)",
      viewsHint: "Total: {{count}}",
      clicks: "Clicks (unique)",
      clicksHint: "Total: {{count}}",
      ctr: "CTR",
      ctrHint: "Unique clicks / unique impressions",
      materialOpens: "Material opens",
      leads: "Collected contacts",
      leadsHint: "With sharing consent: {{count}}",
      meetings: "Meetings held",
      meetingsHint: "Scheduled: {{count}}",
    },
    placements: {
      homeStrip: "Partner strip on the home page",
      partnersSection: "“Partners” section",
      partnersTab: "“Partners” tab",
      agendaSession: "Agenda session",
      agendaTrack: "Agenda track",
      materials: "Materials",
      homeAd: "Home page ad",
    },
    chart: {
      title: "Day by day",
      views: "Impressions",
      clicks: "Clicks",
      leads: "New contacts",
      empty: "No measurements.",
    },
    table: {
      title: "Where you were seen",
      placement: "Placement",
      views: "Impressions",
      clicks: "Clicks",
      ctr: "CTR",
      materialOpens: "Materials",
      empty: "No measurements.",
    },
    leads: {
      title: "Collected contacts",
      hint: "Contact details only for people who agreed to share their data with partners. Other rows show only the scan, the note and the rating of your booth staff.",
      notIncluded: "The organiser shared the report without the contact list.",
      empty: "No contacts collected yet.",
      downloadCsv: "Download contacts (CSV)",
      downloadXlsx: "Download contacts (XLSX)",
      prefix: "contacts",
    },
    download: {
      title: "Download",
      metricsCsv: "Download metrics (CSV)",
      metricsXlsx: "Download metrics (XLSX)",
      prefix: "sponsor-report",
      sheetName: "Report",
      failed: "The file could not be prepared.",
      columns: {
        day: "Day",
        viewsUnique: "Impressions (unique)",
        clicksUnique: "Clicks (unique)",
        ctr: "CTR (%)",
        materialOpens: "Material opens",
        leadsNew: "New contacts",
      },
    },
  },
} as const;

i18n.addResourceBundle("pl", "translation", eventSponsorReportPl, true, true);
i18n.addResourceBundle("en", "translation", eventSponsorReportEn, true, true);

/** Rejestracja dzieje się przy imporcie; wywołanie dokumentuje zależność. */
export function ensureEventSponsorReportI18n(): void {}
