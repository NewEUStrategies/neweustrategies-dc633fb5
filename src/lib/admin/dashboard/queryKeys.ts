// KLUCZE ZAPYTAŃ PULPITU - wydzielone z hooków, żeby dały się sprawdzić testem.
//
// PO CO OSOBNY MODUŁ NA CZTERY LINIE. Bo niesie inwariant, którego zgubienie
// nie jest widoczne ani w typach, ani na ekranie: klucz musi zawierać TENANTA.
// Dane są zawsze poprawne (funkcje bazy biorą tenanta z profilu wołającego,
// nigdy z tego klucza), ale klucz decyduje o tym, CO POKAŻE CACHE. Bez tenanta
// wejście na pulpit po przełączeniu obszaru roboczego wyrysowałoby liczby
// POPRZEDNIEGO najemcy - z właściwego okna, z właściwą etykietą i całkowicie
// cudze - aż do pierwszego odświeżenia w tle.
//
// Poprzedni pulpit trzymał tenanta w kluczu (`["admin-stats", tenantId]`) i miał
// na to test (`platformDashboardRoute.test.tsx`: "nie pokazuje zapamiętanych
// liczb poprzedniego tenanta"). Przeprowadzka na funkcje agregujące nie ma prawa
// tego zgubić, a w hooku - opakowanym w `useQuery` i wymagającym DOM-u - ten
// jeden argument łatwo wypada bez śladu. Tutaj jest zwykłą funkcją i zwykłą
// asercją.
import type { DashboardRange } from "./period";

/** Dziedzina pulpitu - jedna sekcja, jedno zapytanie, jeden klucz. */
export type DashboardDomain = "traffic" | "crm" | "marketing" | "audience" | "content" | "realtime";

/**
 * Klucz zapytania okresowego.
 *
 * Zawiera OBIE granice okna, bo dwa okresy potrafią zacząć się w tym samym
 * momencie i różnić dopiero końcem - kwartał i półrocze są 1 stycznia
 * nierozróżnialne po samym początku, a nazwa okresu nie wystarcza, bo okno
 * rośnie razem z zegarem.
 */
export function dashboardQueryKey(
  tenantId: string,
  domain: DashboardDomain,
  range: DashboardRange,
  extra?: readonly (string | number)[],
): readonly unknown[] {
  return [
    "admin-dashboard",
    domain,
    tenantId,
    ...(extra ?? []),
    range.period,
    range.current.sinceIso,
    range.current.untilIso,
  ];
}

/**
 * Klucz podglądu na żywo. Osobny, bo nie ma okna okresowego - okno liczy zegar
 * BAZY, a nie klient; do klucza wchodzą więc same parametry okna w minutach.
 */
export function realtimeQueryKey(
  tenantId: string,
  activeMinutes: number,
  windowMinutes: number,
): readonly unknown[] {
  return ["admin-dashboard", "realtime", tenantId, activeMinutes, windowMinutes];
}
