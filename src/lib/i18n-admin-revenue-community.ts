// i18n huba „Przychód i lejek" - nakładka SPOŁECZNOŚCI (S4): przekroje
// wydarzeń (`admin_revenue_events_summary`) i klubów
// (`admin_revenue_clubs_summary`).
//
// Etykieta i definicja KAŻDEGO pola DTO (`src/lib/revenue/community/dto.ts`)
// - definicja jest tym, co karta pokazuje w podpowiedzi, więc mówi dokładnie
// to samo co agregat SQL: kohorta wydarzeń po dacie startu, zgłoszenia
// dopuszczone, no-show po zakończeniu, przychód netto bez sumowania walut,
// kluby bez tajnych, członkowie jako osoby.
//
// Prefiks `adminRevenue` jest pod TWARDĄ bramką parytetu
// (`src/__tests__/i18nParity.gate.test.ts`): brak albo napis identyczny
// w PL i EN zapala CI - stąd np. „Uczestnicy obecni" / „Attended".
// Gałąź `adminRevenue.community` scala się głęboko z rdzeniem huba.
//
// UWAGA NA ARKUSZ CSS (jak S1): pliki `src/lib/i18n-*.ts` skanuje generator
// arkusza publicznego - napisy nie są nazwami klas narzędziowych.
//
// IMPORT WYŁĄCZNIE Z KOMPONENTÓW (zakładka Społeczność woła `ensureI18n()`).
import i18n from "@/lib/i18n";

export const revenueCommunityPl = {
  adminRevenue: {
    community: {
      title: "Społeczność",
      subtitle:
        "Wydarzenia i kluby w wybranym okresie: frekwencja, przychód z biletów i zgłoszenia.",
      noData: "Brak danych",
      state: {
        forbidden: "Przekroje społeczności widzą administratorzy i redaktorzy.",
        unavailable: "Dane społeczności pojawią się po zakończeniu wdrożenia.",
        moneyHidden: "Kwoty przychodu widzą wyłącznie administratorzy.",
        clubsDisabled: "Moduł klubów jest wyłączony w ustawieniach społeczności.",
      },
      events: {
        heading: "Wydarzenia",
        cohortHint:
          "Wydarzenia (bez szkiców) rozpoczynające się w wybranym okresie. Przychód obejmuje całą sprzedaż biletów tych wydarzeń, także sprzed okresu.",
        eventsCount: {
          label: "Wydarzenia w okresie",
          hint: "Opublikowane wydarzenia z datą startu w okresie.",
        },
        registrations: {
          label: "Zgłoszenia dopuszczone",
          hint: "Zgłoszenia zatwierdzone, obecne i nieobecne - bez anulowanych, odrzuconych i listy rezerwowej.",
        },
        attended: {
          label: "Uczestnicy obecni",
          hint: "Zgłoszenia z odnotowaną obecnością (skan na bramce, ręczne odhaczenie, dołączenie do transmisji).",
        },
        noShow: {
          label: "Nieobecni",
          hint: "Status „nieobecny” albo zgłoszenie dopuszczone bez obecności po zakończeniu wydarzenia.",
        },
        attendanceRate: {
          label: "Frekwencja",
          hint: "Obecni podzieleni przez zgłoszenia dopuszczone. Bez zgłoszeń - brak danych, nie zero.",
        },
        noShowRate: {
          label: "Odsetek nieobecnych",
          hint: "Nieobecni podzieleni przez zgłoszenia dopuszczone.",
        },
        paid: {
          label: "Opłacone konwersje",
          hint: "Zgłoszenia prowadzących i pakiety z co najmniej jednym zapłaconym zamówieniem.",
        },
        planPool: {
          label: "Bilety z puli planu",
          hint: "Zgłoszenia rozliczone pulą biletów w planie członkowskim (bez płatności za bilet).",
        },
        revenue: {
          label: "Przychód netto z biletów",
          hint: "Zamówienia zapłacone minus zwroty, osobno w każdej walucie - ta sama liczba co raport lejka w studiu wydarzenia (zakres „od początku”).",
        },
        table: {
          event: "Wydarzenie",
          startsAt: "Start",
          openStudio: "Otwórz w studiu wydarzenia",
          empty: "W wybranym okresie nie zaczyna się żadne wydarzenie.",
        },
      },
      clubs: {
        heading: "Kluby",
        scopeHint:
          "Kluby aktywne i archiwalne bez klubów tajnych - sam fakt ich istnienia jest poufny.",
        clubsCount: { label: "Kluby", hint: "Kluby objęte przekrojem (bez tajnych i szkiców)." },
        members: {
          label: "Członkowie",
          hint: "Osoby z aktywnym członkostwem - ktoś w dwóch klubach to jedna osoba.",
        },
        activeMembers: {
          label: "Aktywni członkowie",
          hint: "Członkowie, którzy w okresie pisali albo czytali klub.",
        },
        contributors: {
          label: "Współtwórcy",
          hint: "Członkowie, którzy w okresie założyli wątek albo odpowiedzieli (bez wpisów usuniętych i ukrytych).",
        },
        applications: {
          heading: "Zgłoszenia do klubów",
          submitted: { label: "Złożone", hint: "Zgłoszenia wysłane w okresie." },
          accepted: { label: "Przyjęte", hint: "Zgłoszenia przyjęte w okresie." },
          rejected: { label: "Odrzucone", hint: "Zgłoszenia odrzucone w okresie." },
          pending: {
            label: "Czekające na decyzję",
            hint: "Zgłoszenia otwarte teraz (stan bieżący).",
          },
        },
        decisionHours: {
          label: "Mediana czasu decyzji",
          hint: "Połowa decyzji z okresu zapadła szybciej niż w tym czasie (od zgłoszenia do przyjęcia lub odrzucenia).",
          unit: "{{value}} godz.",
        },
        table: {
          club: "Klub",
          empty: "Brak klubów objętych przekrojem.",
        },
      },
    },
  },
};

export const revenueCommunityEn: typeof revenueCommunityPl = {
  adminRevenue: {
    community: {
      title: "Community",
      subtitle:
        "Events and clubs in the selected period: attendance, ticket revenue and applications.",
      noData: "No data",
      state: {
        forbidden: "Community breakdowns are visible to administrators and editors.",
        unavailable: "Community data will appear once the rollout is complete.",
        moneyHidden: "Revenue amounts are visible to administrators only.",
        clubsDisabled: "The clubs module is turned off in community settings.",
      },
      events: {
        heading: "Events",
        cohortHint:
          "Events (excluding drafts) starting in the selected period. Revenue covers all ticket sales for these events, including sales before the period.",
        eventsCount: {
          label: "Events in the period",
          hint: "Published events with a start date in the period.",
        },
        registrations: {
          label: "Admitted registrations",
          hint: "Approved, attended and no-show registrations - excluding cancelled, rejected and waitlisted ones.",
        },
        attended: {
          label: "Attended",
          hint: "Registrations with recorded attendance (gate scan, manual check-in, joining the stream).",
        },
        noShow: {
          label: "No-shows",
          hint: "No-show status, or an admitted registration without attendance after the event ended.",
        },
        attendanceRate: {
          label: "Attendance rate",
          hint: "Attended divided by admitted registrations. Without registrations - no data, not zero.",
        },
        noShowRate: {
          label: "No-show rate",
          hint: "No-shows divided by admitted registrations.",
        },
        paid: {
          label: "Paid conversions",
          hint: "Lead registrations and packages with at least one paid order.",
        },
        planPool: {
          label: "Plan pool tickets",
          hint: "Registrations settled from the membership plan ticket pool (no ticket payment).",
        },
        revenue: {
          label: "Net ticket revenue",
          hint: "Paid orders minus refunds, separately in each currency - the same number as the funnel report in the event studio (“all time” range).",
        },
        table: {
          event: "Event name",
          startsAt: "Starts",
          openStudio: "Open in the event studio",
          empty: "No event starts in the selected period.",
        },
      },
      clubs: {
        heading: "Clubs",
        scopeHint:
          "Active and archived clubs excluding secret clubs - their very existence is confidential.",
        clubsCount: {
          label: "Clubs covered",
          hint: "Clubs in the breakdown (excluding secret clubs and drafts).",
        },
        members: {
          label: "Members",
          hint: "People with an active membership - someone in two clubs counts once.",
        },
        activeMembers: {
          label: "Active members",
          hint: "Members who posted in or read the club during the period.",
        },
        contributors: {
          label: "Contributors",
          hint: "Members who started a thread or replied during the period (excluding deleted and hidden posts).",
        },
        applications: {
          heading: "Club applications",
          submitted: { label: "Submitted", hint: "Applications sent during the period." },
          accepted: { label: "Accepted", hint: "Applications accepted during the period." },
          rejected: { label: "Rejected", hint: "Applications rejected during the period." },
          pending: {
            label: "Awaiting decision",
            hint: "Applications open right now (current state).",
          },
        },
        decisionHours: {
          label: "Median time to decision",
          hint: "Half of the decisions in the period were made faster than this (from application to acceptance or rejection).",
          unit: "{{value}} h",
        },
        table: {
          club: "Club name",
          empty: "No clubs in the breakdown.",
        },
      },
    },
  },
};

// Rejestracja jawna (komponent woła `ensureI18n()`) ORAZ przy imporcie:
// bramki parytetu i dryfu kluczy ładują nakładki globem i liczą na efekt
// importu, a flaga chroni przed powtórnym głębokim scalaniem przy renderze.
let registered = false;
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", revenueCommunityPl, true, true);
  i18n.addResourceBundle("en", "translation", revenueCommunityEn, true, true);
}
ensureI18n();
