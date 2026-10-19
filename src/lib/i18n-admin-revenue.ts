// i18n huba „Przychód i lejek" (`/admin/revenue`) - rdzeń wspólny wszystkich
// zakładek (PL/EN).
//
// TO JEST TYLKO RDZEŃ (wycinek I0): nazwa huba, grupy paska, etykiety
// zakładek, okresów i segmentów oraz kilka napisów stanów. Treści zakładek,
// diagnoz, wskaźników i ścieżek dokładają WŁASNE nakładki wycinków S1-S8
// (SPEC §6.7) pod tym samym prefiksem `adminRevenue.*` - stąd głębokie
// scalanie (`addResourceBundle(…, true, true)`), które nie nadpisuje gałęzi
// dołożonych przez inną nakładkę.
//
// DLACZEGO OD PIERWSZEGO DNIA POD TWARDĄ BRAMKĄ PARYTETU. Hub mówi
// o pieniądzach i o tym, komu czego nie pokazać: surowy klucz zamiast
// `Przychód` na pasku zakładek albo zamiast zdania „dostępne dla
// administratorów" zostawia operatora bez odpowiedzi, gdzie jest i co może.
// `adminRevenue` i `adminJourneys` są w `GATED_PREFIXES`
// (`src/__tests__/i18nParity.gate.test.ts`), więc każdy brak albo napis
// nieprzetłumaczony (PL = EN) zapala CI.
//
// UWAGA NA ARKUSZ CSS. Pliki `src/lib/i18n-*.ts` skanuje generator arkusza
// PUBLICZNEGO, więc słowo, które jest jednocześnie klasą Tailwinda, dokłada
// regułę do CSS każdej strony czytelnika. Napisy niżej są dobrane tak, żeby
// żadne nie było nazwą klasy narzędziowej (zapas arkusza: ułamek kilobajta).
//
// IMPORT WYŁĄCZNIE Z KOMPONENTÓW. Plik trasy nie importuje słownika (bramka
// `adminRouteDictionaryImports.gate.test.ts`): import w powłoce trasy zostaje
// w chunku wejściowym każdej strony. Komponenty wołają `ensureI18n()`.
import i18n from "@/lib/i18n";

const pl = {
  adminRevenue: {
    title: "Przychód i lejek",
    subtitle: "Cennik, paywall, lejek, retencja i ścieżki komunikacji w jednym miejscu.",
    group: {
      monitor: "Monitoruj",
      fix: "Napraw",
      automate: "Automatyzuj",
      understand: "Rozumiej",
    },
    tab: {
      overview: "Kokpit",
      mrr: "Przychód",
      funnel: "Lejek",
      retention: "Retencja",
      community: "Społeczność",
      diagnostics: "Diagnostyka",
      offer: "Oferta",
      access: "Dostęp",
      journeys: "Ścieżki",
      metrics: "Wskaźniki",
      inputs: "Dane wejściowe",
    },
    // Okresy pulpitu brzmią TAK SAMO jak na kokpicie panelu
    // (`i18n-admin-dashboard.ts`) - to ta sama arytmetyka kalendarza
    // (`resolveDashboardRange`), więc inna nazwa sugerowałaby inne okno.
    period: {
      week: "Ten tydzień",
      month: "Ten miesiąc",
      "prev-month": "Poprzedni miesiąc",
      quarter: "Kwartał",
      "half-year": "Półrocze",
      year: "Rok",
      ltm: "Ostatnie 12 miesięcy",
      custom: "Własny zakres",
    },
    segment: {
      all: "Wszystkie segmenty",
      b2c_individual: "Klienci indywidualni",
      b2c_reduced: "Klienci z ulgą",
      b2b_institution: "Instytucje",
    },
    common: {
      pending: "Ta sekcja huba jest w przygotowaniu.",
      loading: "Wczytywanie sekcji…",
      roleGate:
        "Hub przychodu i lejka jest dostępny dla administratorów i redaktorów. Poproś administratora o rolę redaktora, jeśli potrzebujesz tych danych.",
      notFound: "Nie ma takiej zakładki huba.",
      refresh: "Odśwież dane",
    },
  },
};

const en: typeof pl = {
  adminRevenue: {
    title: "Revenue and funnel",
    subtitle: "Pricing, paywall, funnel, retention and communication journeys in one place.",
    group: {
      monitor: "Monitor",
      fix: "Fix",
      automate: "Automate",
      understand: "Understand",
    },
    tab: {
      overview: "Overview",
      mrr: "Revenue",
      funnel: "Funnel",
      retention: "Retention",
      community: "Community",
      diagnostics: "Diagnostics",
      offer: "Offer",
      access: "Access",
      journeys: "Journeys",
      metrics: "Metrics",
      inputs: "Inputs",
    },
    period: {
      week: "This week",
      month: "This month",
      "prev-month": "Previous month",
      quarter: "Quarter",
      "half-year": "Half-year",
      year: "Year",
      ltm: "Last 12 months",
      custom: "Custom range",
    },
    segment: {
      all: "All segments",
      b2c_individual: "Individual customers",
      b2c_reduced: "Reduced-price customers",
      b2b_institution: "Institutions",
    },
    common: {
      pending: "This hub section is being prepared.",
      loading: "Loading section…",
      roleGate:
        "The revenue and funnel hub is available to administrators and editors. Ask an administrator for the editor role if you need this data.",
      notFound: "This hub tab does not exist.",
      refresh: "Refresh data",
    },
  },
};

// Rejestracja jawna (komponent woła `ensureI18n()`) ORAZ przy imporcie:
// bramki parytetu i dryfu kluczy ładują nakładki globem i liczą na efekt
// importu, a flaga chroni przed powtórnym głębokim scalaniem przy każdym
// renderze.
let registered = false;
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", pl, true, true);
  i18n.addResourceBundle("en", "translation", en, true, true);
}
ensureI18n();
