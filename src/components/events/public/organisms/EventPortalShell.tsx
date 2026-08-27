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
//
// ── TŁO STRONY MALUJE TA POWŁOKA, I TO JEST POPRAWKA DEFEKTU ────────────────
// CO BYŁO ZEPSUTE. Slot „Tło strony” nadpisuje `--background` POD atrybutem
// `[data-event-branding]`, czyli na tym elemencie i w jego wnętrzu. Widoczne tło
// strony malowało natomiast `body` (`styles.css`: `body { background-color:
// var(--color-background) }`), a `body` jest PRZODKIEM tego elementu - kaskada
// nadpisania nie ma jak dojechać w górę drzewa. Ta powłoka nie miała ani jednej
// klasy tła, w całym portalu wydarzenia nie było ani jednego `bg-background`,
// więc redaktor ustawiał kolor, a uczestnik widział tło motywu serwisu.
// Najgorsze było to, że KANWA PODGLĄDU dokłada sobie `bg-background` na tym
// samym elemencie - w studiu kolor więc BYŁ widoczny i wyglądało to na działające.
//
// DLACZEGO `bg-background`, A NIE `--event-page-bg`. Generator wypuszcza dla tego
// slotu obie zmienne (`--event-page-bg` jako uchwyt dla komponentów wydarzenia
// i `--background` jako token semantyczny). Sięgamy po TOKEN, bo daje trzy rzeczy
// naraz, których uchwyt nie daje: (1) wydarzenie BEZ brandingu dostaje dokładnie
// dzisiejszy kolor - token jest wtedy odziedziczony z motywu, więc powłoka maluje
// to samo, co `body`, i nie ma ani przezroczystej dziury, ani innego odcienia;
// (2) `@theme inline` w `styles.css` wkleja `var(--background)` wprost do
// utility, więc nadpisanie NA TYM elemencie działa (przez `--color-background`
// z `:root` by nie zadziałało - podstawienie zmiennej zachodzi tam, gdzie jest
// zadeklarowana); (3) kanwa podglądu już dziś stawia tu tę samą klasę, więc
// podgląd i strona zaczynają malować tło JEDNĄ deklaracją, a nie dwiema.
//
// `min-h-full` PILNUJE, ŻEBY NIE ZOSTAŁ PAS. Powłoka jest zwykłym blokiem
// wewnątrz `main.flex-1` (`SiteChrome`), a `main` rozciąga się do dołu okna.
// Bez `min-height` krótka treść (np. zakładka z jedną tabelą) zostawiłaby pod
// powłoką pas w kolorze `body`, czyli motywu serwisu, tuż pod tłem wydarzenia.
// `100%` liczy się względem `main`, który ma wysokość z układu flex. W kanwie
// podglądu rodzic ma wysokość `auto`, więc procent nie ma do czego się odnieść
// i reguła jest tam bezpiecznym nic-nie-robieniem - kanwa dalej rośnie z treści.
//
// OBRAZ TŁA RYSUJEMY, A NIE UKRYWAMY KONTROLKĘ. `--event-bg-image` przechodzi
// w generatorze przez zamknięty alfabet `SAFE_IMAGE_URL` i wychodzi już jako
// gotowe `url("…")`, więc czytamy TĘ zmienną i nie zakładamy drugiej ścieżki dla
// adresu (żadnego `style={{ backgroundImage: … }}` z surowej kolumny). Brak
// obrazu daje `none`, czyli dzisiejszy stan. Ryzyko kontrastu (zdjęcie pod
// tekstem) zostaje po stronie redaktora ŚWIADOMIE: od tej zmiany podgląd studia
// rysuje ten sam obraz w tym samym miejscu, więc redaktor widzi skutek przed
// publikacją - a to jest dokładnie ta pętla, której brakowało przy kolorze tła.
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
      className={cn(
        "min-h-full bg-background bg-top bg-no-repeat bg-cover [background-image:var(--event-bg-image,none)] pb-12 md:pb-16",
        className,
      )}
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
