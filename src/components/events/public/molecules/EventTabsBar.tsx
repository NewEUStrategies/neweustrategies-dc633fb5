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
// (i identycznie 39, 40) - jeden wyśrodkowany rząd napisów.
//
// ZAWSZE JEDEN RZĄD, PRZEWIJANY GDY SIĘ NIE MIEŚCI - I TO ODWRACA DAWNE
// ZAWIJANIE. Pasek jest przyklejony pod nagłówkiem serwisu (`EventPortalShell`,
// decyzja właściciela: zakładki mają być widoczne CAŁY CZAS), a dwa rzędy
// przyklejone na stałe zjadały ~100 px ekranu i rozjeżdżały się z wysokością,
// od której odsuwają się kotwice i inne przyklejone elementy
// (`--event-chrome-h` liczy jeden rząd). Dawny argument przeciw przewijaniu
// („ostatnia zakładka znika bez znaku") gasi `justify-center-safe`: pasek,
// który się mieści, stoi na środku (komputer), a dłuższy zaczyna się od
// krawędzi, ucina ostatnią pozycję w pół napisu i gaśnie na brzegach - widać,
// że jest dalej. Bieżąca zakładka jest przewijana na środek (`activeKey`),
// więc czytelnik nie szuka miejsca, w którym jest.
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
// KAŻDA WARTOŚĆ MA ODWRÓT DO MOTYWU. `var(--event-nav, red)` z drugim argumentem
// znaczy: wydarzenie bez tego slotu wygląda dokładnie jak dziś (tło
// przezroczyste, napis wyciszony z `--muted-foreground`, bieżący z
// `--foreground`). Generator wypuszcza `--event-nav*` wyłącznie razem, więc nie
// ma stanu „kolorowy napis na przezroczystym pasku”.
import { useEffect, useRef, type ReactNode } from "react";

// ── DLACZEGO W KLASIE BAZOWEJ NIE MA KOLORU NAPISU, I TO JEST POPRAWKA DEFEKTU ─
//
// CO BYŁO ZEPSUTE. Kolor WYCISZONY siedział tutaj, w klasie bazowej, a kolor
// bieżącej pozycji dojeżdżał osobno przez `activeProps`. TanStack Router SKLEJA
// `className` z `activeProps.className` ZWYKŁĄ SPACJĄ - bez `cn`, bez
// `tailwind-merge`. Sklejanie jest dosłowne i widać je w źródle routera
// (`node_modules/@tanstack/react-router/dist/esm/link.js`, `resolvedClassName`):
// baza, potem klasa aktywna, potem nieaktywna, rozdzielone spacją. Bieżący
// odnośnik miał więc DWIE klasy koloru napisu naraz. Oba to arbitralne utility
// o TEJ SAMEJ specyficzności, więc rozstrzygała KOLEJNOŚĆ W ARKUSZU - a Tailwind
// emituje arbitralny kolor tekstu z `--event-nav-fg-muted` PÓŹNIEJ niż
// ten z `--event-nav-fg` (pomiar na zbudowanym arkuszu: linie 7564
// i 7567). Czyli klasa WYCISZONA wygrywała i bieżąca zakładka na pasku
// z ustawionym kolorem nawigacji dostawała odcień wyciszony. Rozróżnienie
// „bieżąca / pozostałe”, zamierzone jako DWUSTOPNIOWE (grubość ORAZ odcień),
// zwijało się do samej grubości.
//
// DLACZEGO ROZDZIELENIE, A NIE PRZESTAWIENIE KOLEJNOŚCI. Kolejność emisji
// Tailwinda nie jest kontraktem: zmienia się z wersją, z kolejnością pierwszego
// wystąpienia klasy w plikach i z każdym refaktorem, który przeniesie te napisy
// do innego modułu. Poprawka „przestawmy klasy” byłaby zielona dzisiaj
// i zepsuta po dowolnym z tych zdarzeń, bez ani jednego czerwonego testu.
// Rozdzielenie usuwa PRZYCZYNĘ: w danym momencie na węźle obowiązuje DOKŁADNIE
// JEDNA klasa koloru napisu, więc nie ma kolizji, którą kolejność mogłaby
// rozstrzygnąć w złą stronę.
//
// KLASA BAZOWA NIE MA WIĘC ŻADNEGO KOLORU NAPISU i to jest wymóg wobec
// WOŁAJĄCEGO: każda powierzchnia paska MUSI dołożyć albo
// `EVENT_TAB_ACTIVE_CLASS`, albo `EVENT_TAB_INACTIVE_CLASS`. Konsumentów jest
// dwóch i oba to robią - `EventTabsNav` przez `activeProps`/`inactiveProps`
// routera, a podgląd studia (`EventPreviewCanvas`) przez `cn` z trójdzielnym
// wyborem, bo napis w podglądzie nie jest `Link`-iem i `inactiveProps` nie ma.
/** Klasa pozycji paska - wspólna dla odnośnika strony i napisu w podglądzie. */
export const EVENT_TAB_CLASS =
  "inline-block whitespace-nowrap rounded-[6px] px-1 py-4 text-sm transition-colors hover:text-[color:var(--event-nav-fg,var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

// Kolor pozycji NIEBIEŻĄCEJ - mieszanka koloru napisu z tłem paska, policzona
// w generatorze CSS (`lib/events/eventBrandingCss`), z odwrotem do
// `--muted-foreground` z motywu serwisu. Stoi OSOBNO od klasy bazowej właśnie
// po to, żeby nigdy nie współistniała z `EVENT_TAB_ACTIVE_CLASS` na jednym
// węźle - patrz komentarz nad `EVENT_TAB_CLASS`.
//
// ── WYCISZENIE PRZEZ MROCNOŚĆ, I DLACZEGO NIE PRZEZ SAM TOKEN ───────────────
// CO BYŁO NIEWIDOCZNE. Token `--muted-foreground` MA być drugim stopniem tuszu,
// ale globalne kolory serwisu ZAPISAŁY go jako dokładnie ten sam tusz co
// `--foreground` (`#131822` w jasnym motywie, `#F8F6F4` w ciemnym - pomiar
// `<style>` globalnych kolorów na żywej stronie). Na pasku bez własnego koloru
// nawigacji oba stopnie znaczyły więc to samo i jedyne, co odróżniało bieżącą
// pozycję, to grubość pisma.
//
// DLACZEGO MROCNOŚĆ, A NIE NOWY KOLOR. Globalny tusz serwisu jest wyborem
// redaktora i nie wolno go nadpisywać dla jednego paska; `opacity` nie zmienia
// żadnej barwy - bierze ten tusz, który jest na węźle, i kładzie go na tle
// strony. Działa tak samo na pasku przezroczystym i na pasku z kolorem
// wydarzenia, w obu motywach, i nie rusza geometrii: napisy stoją tam, gdzie
// stały. Współczynnik 0,62 jest liczony pod próg WCAG AA, nie pod gust:
// w jasnym motywie daje #6A6D72 na #F8F7F3 (4,8:1), w ciemnym #9B9897 na
// #141414 (6,7:1) - czyli pozycja wyciszona nadal jest tekstem, nie dekoracją.
//
// `hover:`/`focus-visible:` ZDEJMUJĄ MROCNOŚĆ, bo pozycja, w którą czytelnik
// celuje albo którą prowadzi klawiaturą, nie jest już „pozostałą”.
export const EVENT_TAB_INACTIVE_CLASS =
  "text-[color:var(--event-nav-fg-muted,var(--muted-foreground))] opacity-[0.62] hover:opacity-100 focus-visible:opacity-100";

// Pogrubienie NIE zmienia rozmiaru napisu, więc pasek nie drga przy przejściu
// między zakładkami; kolor bierze `--foreground`, bo `--primary` jest w jasnym
// motywie prawie czernią, a w ciemnym prawie bielą i nie niesie tu żadnej treści.
// Na pasku z kolorem wydarzenia ten sam wiersz bierze `--event-nav-fg`, czyli
// czerń albo biel policzoną z luminancji tła - a wyciszone pozycje mieszankę
// tego napisu z tłem paska, żeby rozróżnienie „bieżąca / pozostałe” zostało
// DWUSTOPNIOWE (grubość ORAZ odcień), tak jak jest w motywie serwisu.
//
// ── KRESKA POD BIEŻĄCĄ POZYCJĄ, I DLACZEGO WŁAŚNIE ONA ──────────────────────
// CO BYŁO ZA SŁABE. Bieżącą pozycję od pozostałych odróżniały WYŁĄCZNIE grubość
// i odcień napisu: `--foreground` przeciw `--muted-foreground`. Różnica jest,
// ale przy siedmiu długich nazwach w jednym rzędzie czytelnik jej szuka, zamiast
// zobaczyć - i to szukanie było treścią zgłoszenia.
//
// DLACZEGO KRESKA POD NAPEM, A NIE PIGUŁKA ZA NAPEM. Pigułka (tło pod napisem)
// ruszyłaby wysokością i rytmem rzędu oraz zderzyłaby się z `rounded-[6px]` i
// `px-1`, których pasek nie chce. Kreska nie rusza żadnej geometrii: napisy
// stoją dokładnie tam, gdzie stały, więc przejazd między zakładkami nadal nic
// nie przesuwa - a to jest warunek, od którego ten pasek zaczyna komentarz
// nad `EVENT_TAB_CLASS`. To także ten sam znak, którym serwis oznacza już
// wybranie (tusz akcentu pod linkiem w `styles.css`), więc nie wprowadza do
// paska nowego alfabetu.
//
// KRESKA JEST TA SAMA W OBU MOTYWACH, ZMIENIA SIĘ TYLKO JEJ TUSZ. Geometrycznie
// motywy są IDENTYCZNE - ten sam kształt, ta sama grubość, to samo położenie -
// więc przełączenie motywu nie przestawia paska. `--brand-ink` to akcent marki
// wspólny dla obu motywów; aktywną pozycję wyróżnia też pogrubienie
// i pełny neutralny kolor tekstu, bez przyciemniania pomarańczu.
//
// NA PASKU Z KOLOREM WYDARZENIA KRESKA BIERZE TUSZ POLICZONY Z TŁA.
// `var(--event-nav-fg, var(--brand-ink))`: gdy organizator ustawił kolor
// nawigacji, kreska dostaje czerń albo biel z luminancji tego tła (markowy
// pomarańcz na pomarańczowym pasku zniknąłby), a gdy go nie ustawił - akcent
// marki. `pointer-events-none`: kreska jest znakiem, nie uchwytem - klik
// należy do napisu.
export const EVENT_TAB_ACTIVE_CLASS =
  "relative font-semibold text-[color:var(--event-nav-fg,var(--foreground))] after:pointer-events-none after:absolute after:inset-x-1 after:bottom-0 after:h-[2px] after:rounded-full after:bg-[color:var(--event-nav-fg,var(--brand-ink))] after:content-['']";

export function EventTabsBar({
  label,
  activeKey,
  children,
}: {
  /** Etykieta dostępności - napis, nie klucz: molekuła nie zna słownika. */
  label: string;
  /**
   * Zmienia się przy przejściu między zakładkami (ścieżka strony). Pasek
   * przewijany na telefonie przesuwa wtedy bieżącą pozycję
   * (`aria-current="page"` z `Link` routera) na środek. Podgląd studia go nie
   * podaje - jego napisy nie są odnośnikami.
   */
  activeKey?: string;
  /** Pozycje paska jako `<li>` - patrz nagłówek pliku. */
  children: ReactNode;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const list = listRef.current;
    if (list === null || activeKey === undefined) return;
    const center = (): boolean => {
      const active = list.querySelector('[aria-current="page"]');
      if (active === null) return false;
      // Pasek, który się mieści (komputer, krótkie menu), nie ma czego przewijać.
      if (list.scrollWidth > list.clientWidth) {
        // Prostokąty, nie `offsetLeft`: przodkiem pozycjonowanym jest
        // przyklejona ramka powłoki, nie lista.
        const listBox = list.getBoundingClientRect();
        const activeBox = active.getBoundingClientRect();
        list.scrollLeft +=
          activeBox.left + activeBox.width / 2 - (listBox.left + listBox.width / 2);
      }
      return true;
    };
    center();
    // Pozycje dochodzą po pierwszym renderze („Nabór prelegentów" po zapytaniu
    // o fazę, „Mój profil" po hydratacji sesji): bieżąca może dojść później
    // albo zostać wypchnięta poza krawędź przez pozycję wstawioną przed nią.
    // Patrzymy do zmiany zakładki i centrujemy tylko pozycję niewidoczną -
    // przewinięcia czytelnika nie ruszamy.
    const observer = new MutationObserver(() => {
      const active = list.querySelector('[aria-current="page"]');
      if (active === null) return;
      const listBox = list.getBoundingClientRect();
      const activeBox = active.getBoundingClientRect();
      if (activeBox.left < listBox.left || activeBox.right > listBox.right) center();
    });
    observer.observe(list, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [activeKey]);

  // Komputer: pasek, który się nie mieści, przewija się ZWYKŁYM kółkiem myszy.
  // Kółko daje tylko ruch pionowy, a ukryty pasek przewijania nie ma uchwytu -
  // bez tego ostatnie zakładki byłyby osiągalne wyłącznie z Shiftem albo
  // gładzikiem. Na skraju listy kółko wraca do przewijania strony.
  useEffect(() => {
    const list = listRef.current;
    if (list === null) return;
    const onWheel = (event: WheelEvent) => {
      if (list.scrollWidth <= list.clientWidth) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const max = list.scrollWidth - list.clientWidth;
      const next = Math.min(max, Math.max(0, list.scrollLeft + event.deltaY));
      if (next === list.scrollLeft) return;
      event.preventDefault();
      list.scrollLeft = next;
    };
    list.addEventListener("wheel", onWheel, { passive: false });
    return () => list.removeEventListener("wheel", onWheel);
  }, []);

  return (
    // Tło na `<nav>`, a nie na `<ul>`: pasek nawigacji wydarzenia idzie przez
    // całą szerokość okna, a wyśrodkowana kolumna `max-w-5xl` jest tylko miarą
    // TREŚCI. Kolor położony na `<ul>` dałby kolorowy prostokąt w środku
    // i dwa pasy tła strony po bokach.
    <nav
      aria-label={label}
      className="border-b border-border bg-[color:var(--event-nav,transparent)]"
    >
      <ul
        ref={listRef}
        className="tabs-scroller mx-auto flex max-w-5xl items-center justify-center-safe gap-x-6 px-4 md:snap-none"
      >
        {children}
      </ul>
    </nav>
  );
}
