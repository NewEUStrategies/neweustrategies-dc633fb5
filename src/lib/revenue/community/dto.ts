// KSZTAŁT PRZEKROJÓW SPOŁECZNOŚCI HUBA „PRZYCHÓD I LEJEK" (S4):
// wydarzenia (`admin_revenue_events_summary`) i kluby
// (`admin_revenue_clubs_summary`).
//
// MODUŁ CZYSTO TYPOWY - zero wartości w runtime, więc import typu z tego
// pliku (zakładka Społeczność S7, migawka S6) nie zmienia grafu chunków.
//
// `null` ≠ 0 i ≠ []. Kwoty wydarzeń są `null` dla editora (macierz ról huba:
// pieniądze widzi admin) - to „brak danych", nie „zero przychodu". Mediana
// czasu decyzji jest `null`, gdy w oknie nie zapadła żadna decyzja. Pusta
// lista walut (`[]`) znaczy natomiast „admin, ale w oknie nikt nie zapłacił".

/** Przychód netto biletów w jednej walucie (minor units, bez sumowania walut). */
export interface RevenueEventMoney {
  currency: string;
  ticketRevenueNetMinor: number;
}

/** Wiersz wydarzenia z okna (kohorta po `starts_at`, bez szkiców). */
export interface RevenueEventSummaryRow {
  eventId: string;
  slug: string;
  titlePl: string;
  titleEn: string;
  startsAt: string;
  status: string;
  /** Zgłoszenia dopuszczone (`approved`, `attended`, `no_show`). */
  registrations: number;
  /** Konwersje z przychodem (prowadzący i pakiety z zamówieniem). */
  paid: number;
  attended: number;
  noShow: number;
  /** Zgłoszenia rozliczone pulą biletów planu. */
  planPool: number;
  /** `null` = kwot nie pokazujemy tej roli (editor). */
  byCurrency: RevenueEventMoney[] | null;
}

export interface RevenueEventsSummaryDto {
  since: string;
  until: string;
  /** Czy rola widzi kwoty (admin). */
  moneyVisible: boolean;
  eventsCount: number;
  registrations: number;
  paid: number;
  attended: number;
  noShow: number;
  planPool: number;
  /** Suma per waluta z TYCH SAMYCH wierszy co `events` (spójność z konstrukcji). */
  byCurrency: RevenueEventMoney[] | null;
  events: RevenueEventSummaryRow[];
}

/** Lejek zgłoszeń do klubów w oknie (otwarte - stan na teraz). */
export interface RevenueClubApplications {
  submitted: number;
  accepted: number;
  rejected: number;
  pending: number;
}

/** Wiersz klubu (bez tajnych i szkiców). */
export interface RevenueClubSummaryRow {
  clubId: string;
  slug: string;
  namePl: string;
  nameEn: string;
  members: number;
  activeMembers: number;
  contributors: number;
  applicationsSubmitted: number;
  applicationsAccepted: number;
  applicationsRejected: number;
}

export interface RevenueClubsSummaryDto {
  since: string;
  until: string;
  /** Przełącznik modułu klubów - wyłączony = notka zamiast pustej sekcji. */
  clubsEnabled: boolean;
  clubsCount: number;
  /** Osoby (nie członkostwa) z aktywnym członkostwem. */
  members: number;
  activeMembers: number;
  contributors: number;
  applications: RevenueClubApplications;
  /** Mediana godzin od zgłoszenia do decyzji; `null` bez decyzji w oknie. */
  decisionHoursMedian: number | null;
  clubs: RevenueClubSummaryRow[];
}

/**
 * Wynik odczytu dla panelu. Odmowa roli i brak funkcji w bazie są STANAMI
 * karty, nie wyjątkami (wzorzec S1): autor bez dostępu i okno wdrożenia
 * migracji nie są awarią, którą ponowienie naprawi.
 */
export type RevenueEventsSummaryRead =
  | { state: "ready"; summary: RevenueEventsSummaryDto }
  /** 42501 - rola bez dostępu (autor). */
  | { state: "forbidden" }
  /** Funkcji jeszcze nie ma w bazie (migracja w drodze). */
  | { state: "unavailable" };

export type RevenueClubsSummaryRead =
  | { state: "ready"; summary: RevenueClubsSummaryDto }
  | { state: "forbidden" }
  | { state: "unavailable" };
