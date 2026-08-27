// Organizm: POWŁOKA PORTALU WYDARZENIA - chrome wspólny dla strony publicznej
// i dla podglądu w studiu.
//
// PO CO ISTNIEJE. Do tej zmiany chrome wydarzenia (zakres brandingu, powrót do
// katalogu, nazwa wydarzenia, pasek zakładek) był wpisany w `events.$slug.tsx`,
// a PODGLĄD W STUDIU rysował własny: jedną kolumnę `max-w-3xl`, własny `<h1>`,
// własną kartę informacji i własną kopię spisu podstron - bez paska zakładek
// i bez trzech kolumn. W repozytorium stały więc dwa niezależne rysunki tej samej
// strony (ryzyko nr 1 z `docs/PROJEKT_MODUL_EVENT_BUILDER_2026-08-23.md` §9.1),
// a właściciel zobaczył w podglądzie „stary layout”, mimo że nowy był na `main`.
// Ten plik jest jedynym miejscem, w którym ten chrome się rysuje.
//
// SLOTY, A NIE PROPSY TEKSTOWE - I TO JEST RÓŻNICA MECHANICZNA, NIE GUSTOWA.
// Na stronie publicznej powrót i nazwa są `<Link>`-ami routera. W podglądzie MUSZĄ
// być napisami: klik wyprowadziłby redaktora ze studia w połowie edycji
// (a `<Link>` bez `RouterProvider` po prostu rzuca). Slot przenosi tę decyzję
// do wołającego i pozwala trzymać w JEDNYM miejscu wszystko pozostałe.
//
// ZERO HOOKÓW ROUTERA W TYM PLIKU. `useParams`, `useNavigate` ani `Link` nie
// mogą tu wejść, bo podgląd studia żyje POZA drzewem tras - powłoka z takim
// hookiem byłaby niemontowalna dokładnie w tym miejscu, w którym jest potrzebna.
//
// BRANDING WCHODZI NA OPAKOWANIE, NIGDY NA `:root` - kolory jednego kongresu nie
// mogą przemalować nagłówka serwisu ani sąsiedniej zakładki. Zakres jest na
// POWŁOCE, więc obejmuje także pasek zakładek i każdą podstronę; inaczej przegląd
// byłby w barwach wydarzenia, a lista prelegentów w barwach serwisu. Zmienne CSS
// składa `EventBrandingStyle` (wspólny mechanizm, nie druga paleta).
//
// `className` I `style` SĄ DLA KANWY PODGLĄDU, nie dla ozdób. Kanwa studia ma
// STAŁĄ SZEROKOŚĆ WIRTUALNĄ (skalowaną przez rodzica) i własne tło, a to musi
// siedzieć na TYM SAMYM elemencie, co zakres brandingu: tło narysowane poza
// zakresem brałoby kolory motywu serwisu, a nie wydarzenia.
import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";
import { eventBrandingScopeProps } from "@/lib/events/eventBrandingCss";
import { EventBrandingStyle } from "@/components/events/public/atoms/EventBrandingStyle";

export function EventPortalShell({
  branding,
  backSlot,
  titleSlot,
  tabsSlot,
  className,
  style,
  children,
}: {
  /** Kolumna `events.branding` albo szkic w tym samym kształcie. */
  branding: unknown;
  /** Powrót do katalogu: `<Link>` na stronie, `<span>` w podglądzie. */
  backSlot: ReactNode;
  /** Nazwa wydarzenia - odnośnik, a NIE nagłówek: `h1` należy do treści zakładki. */
  titleSlot: ReactNode;
  /** Pasek zakładek (`EventTabsNav` na stronie, `EventTabsBar` w podglądzie). */
  tabsSlot: ReactNode;
  /** Dodatkowe klasy opakowania - patrz nagłówek (kanwa podglądu). */
  className?: string;
  /** Styl opakowania - szerokość wirtualna kanwy podglądu. */
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <div
      {...eventBrandingScopeProps}
      style={style}
      className={cn("pb-12 md:pb-16", className)}
      data-testid="event-portal-shell"
    >
      <EventBrandingStyle branding={branding} />

      <div className="mx-auto w-full max-w-5xl px-4 pt-10">
        {backSlot}
        {/* NAZWA WYDARZENIA W CHROME'IE, a nie tylko w treści przeglądu. Na
            zakładce „Prelegenci” nie ma okładki ani tytułu (zrzuty 39 i 40), więc
            bez tego wiersza czytelnik widziałby listę nazwisk bez informacji,
            czyje one są. Na przeglądzie stoi nad nią duży `h1` z tytułem - tak
            samo jak na wzorcu, gdzie nazwa jest i w pasku, i na banerze.
            Dwa `h1` na stronie to defekt SEO, więc tu jest akapit. */}
        <p className="mt-4">{titleSlot}</p>
      </div>

      <div className="mt-4">{tabsSlot}</div>

      {children}
    </div>
  );
}
