// Molekuła: LISTWA PASKA ZAKŁADEK - sam rysunek paska, bez źródła pozycji.
//
// PO CO ODDZIELIĆ RYSUNEK OD POZYCJI. `EventTabsNav` bierze pozycje z RPC
// `event_menu`, a to RPC ma w ciele `AND e.status = 'published'` - wydarzenie
// w statusie `draft` oddaje mu pustkę. Podgląd w studiu (który zwykle patrzy
// właśnie na szkic) nie może więc zamontować tamtego organizmu, a pasek
// zakładek MUSI w podglądzie być: jego brak był całą treścią zgłoszenia
// „nadal jest stary layout”. Bez tego podziału podgląd rysowałby drugi pasek
// z drugim zestawem klas - czyli znowu drugi silnik.
//
// TU MIESZKA WYŁĄCZNIE TO, CO JEST WSPÓLNE: znacznik `<nav>/<ul>`, wyśrodkowanie
// i klasy pozycji. Co jest pozycją (odnośnik na stronie publicznej, napis
// w podglądzie) rozstrzyga wołający, bo to jest różnica ZAMIERZONA, nie rozjazd.
//
// WZORZEC: docs/zrzuty/swapcard-2026-08-23/38-preview-event-home-desktop.png
// (i identycznie 39, 40). Zawijanie zamiast przewijania: sześć krótkich napisów
// mieści się na telefonie w dwóch rzędach, a poziomy pasek przewijany chowałby
// ostatnią zakładkę poza ekranem bez żadnego znaku, że tam jest.
import type { ReactNode } from "react";

/** Klasa pozycji paska - wspólna dla odnośnika strony i napisu w podglądzie. */
export const EVENT_TAB_CLASS =
  "inline-block whitespace-nowrap rounded-[6px] px-1 py-4 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

// Pogrubienie NIE zmienia rozmiaru napisu, więc pasek nie drga przy przejściu
// między zakładkami; kolor bierze `--foreground`, bo `--primary` jest w jasnym
// motywie prawie czernią, a w ciemnym prawie bielą i nie niesie tu żadnej treści.
export const EVENT_TAB_ACTIVE_CLASS = "font-semibold text-foreground";

export function EventTabsBar({
  label,
  children,
}: {
  /** Etykieta dostępności - napis, nie klucz: molekuła nie zna słownika. */
  label: string;
  /** Pozycje paska jako `<li>` - patrz nagłówek pliku. */
  children: ReactNode;
}) {
  return (
    <nav aria-label={label} className="border-b border-border">
      <ul className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-6 px-4">
        {children}
      </ul>
    </nav>
  );
}
