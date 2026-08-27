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
//
// ── TU DOJEŻDŻA SLOT „KOLOR NAWIGACJI”, I TO JEST POPRAWKA DEFEKTU ──────────
// CO BYŁO ZEPSUTE. `--event-nav` był jedyną zmienną brandingu BEZ ani jednego
// czytelnika w repozytorium: panel zapisywał kolor, RPC go utrwalało, generator
// wypuszczał deklarację, a pasek zakładek dalej brał klasy z tokenów serwisu.
// Redaktor ustawiał kolor nawigacji i nie zmieniał niczego.
//
// DLACZEGO WŁAŚNIE TEN PASEK. Nagłówek serwisu ZOSTAJE niezmieniony - to nadal
// ten sam serwis, a nie strona jednego kongresu (patrz `SLOT_VARIABLES`
// w `lib/events/eventBrandingCss`). Pasek zakładek jest jedyną powierzchnią,
// która jest nawigacją TEGO wydarzenia, więc jest jedynym miejscem, w którym
// „kolor nawigacji” ma znaczenie.
//
// KONTRAST NIE JEST ZGADYWANY. Napis bierze `--event-nav-fg`, a nie
// `--foreground`: gdyby brał token motywu, granatowy pasek dostałby w jasnym
// motywie ciemnoszary napis, czyli zakładki zniknęłyby. Kolor napisu liczy
// `pickTextColor` (ta sama funkcja, co przy pigułkach kategorii i krążkach ikon)
// w generatorze CSS - TAM jest hex, a ta molekuła świadomie nie zna brandingu,
// bo montuje ją zarówno strona publiczna, jak i podgląd studia.
//
// KAŻDA WARTOŚĆ MA ODWRÓT DO MOTYWU. `var(--event-nav, …)` z drugim argumentem
// znaczy: wydarzenie bez tego slotu wygląda dokładnie jak dziś (tło
// przezroczyste, napis wyciszony z `--muted-foreground`, bieżący z
// `--foreground`). Generator wypuszcza `--event-nav*` wyłącznie razem, więc nie
// ma stanu „kolorowy napis na przezroczystym pasku”.
import type { ReactNode } from "react";

/** Klasa pozycji paska - wspólna dla odnośnika strony i napisu w podglądzie. */
export const EVENT_TAB_CLASS =
  "inline-block whitespace-nowrap rounded-[6px] px-1 py-4 text-sm text-[color:var(--event-nav-fg-muted,var(--muted-foreground))] transition-colors hover:text-[color:var(--event-nav-fg,var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

// Pogrubienie NIE zmienia rozmiaru napisu, więc pasek nie drga przy przejściu
// między zakładkami; kolor bierze `--foreground`, bo `--primary` jest w jasnym
// motywie prawie czernią, a w ciemnym prawie bielą i nie niesie tu żadnej treści.
// Na pasku z kolorem wydarzenia ten sam wiersz bierze `--event-nav-fg`, czyli
// czerń albo biel policzoną z luminancji tła - a wyciszone pozycje mieszankę
// tego napisu z tłem paska, żeby rozróżnienie „bieżąca / pozostałe” zostało
// DWUSTOPNIOWE (grubość ORAZ odcień), tak jak jest w motywie serwisu.
export const EVENT_TAB_ACTIVE_CLASS =
  "font-semibold text-[color:var(--event-nav-fg,var(--foreground))]";

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
    // Tło na `<nav>`, a nie na `<ul>`: pasek nawigacji wydarzenia idzie przez
    // całą szerokość okna, a wyśrodkowana kolumna `max-w-5xl` jest tylko miarą
    // TREŚCI. Kolor położony na `<ul>` dałby kolorowy prostokąt w środku
    // i dwa pasy tła strony po bokach.
    <nav
      aria-label={label}
      className="border-b border-border bg-[color:var(--event-nav,transparent)]"
    >
      <ul className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-6 px-4">
        {children}
      </ul>
    </nav>
  );
}
