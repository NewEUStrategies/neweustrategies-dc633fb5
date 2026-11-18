// BRAMKA KOLEJNOŚCI KOLUMN (CLS przy strumieniowanym HTML, PSI mobile 2026-11-18).
//
// PROBLEM. CSS `order` zmienia kolejność WIZUALNĄ kolumn, ale parser HTML wstawia
// je w kolejności DOKUMENTU i przeglądarka maluje to, co już wczytała. Strona
// główna ma w sekcji hero kolumny [A: order.mobile 2][B: slider, order.mobile 1]
// [C: order.mobile 3]. Gdy sekcja jedzie w powłoce SSR (a nie jako ukryty
// segment odsłaniany skryptem `$RC`), telefon maluje A na górze siatki, zanim
// dotrze B; po wczytaniu B reguła `order` stawia go przed A i A zjeżdża o
// wysokość slidera (~309 px). Zmierzone: CLS 0,13-0,32 na produkcji (4x CPU,
// 1,6 Mb/s) i deterministycznie 0,38-0,43 na artefakcie z przestojem strumienia
// przed kolumną B. Styl `order` stojący PRZED kolumnami (F29c) tego nie leczy:
// reguła działa od początku, brakuje tylko rodzeństwa, które ma ją wyprzedzić.
//
// MECHANIKA (bramka prefiksu). Kolumna X jest WSTRZYMANA, gdy w dokumencie PO niej
// stoi kolumna, która wizualnie ją wyprzedza (mniejszy `order`). Do czasu, aż
// parser przeczyta OSTATNIĄ taką kolumnę („domykającą"), X ma `visibility:
// hidden`; blok zwalniający stoi jako ostatnie dziecko slotu kolumny domykającej,
// więc działa dopiero po jej pełnym wczytaniu. Wtedy wszystkie wizualni
// poprzednicy X są kompletni, a X pojawia się od razu na swoim miejscu. Kolumny
// w kolejności (na stronie głównej slider B i kolumna C) nie czekają na nic -
// kandydat LCP maluje się tak samo wcześnie jak dotąd. Niewidoczny węzeł nie jest
// źródłem przesunięcia (Layout Instability liczy węzły z reprezentacją wizualną),
// a odsłonięcie to pojawienie się treści, nie jej ruch.
//
// NIEZMIENNIK. Bramka jest funkcją RENDEROWANYCH slotów (dokument + urządzenie
// renderu + dostęp + aktywna zakładka), a te są identyczne w SSR i pierwszym
// renderze klienta (oba liczą urządzenie desktop), więc HTML serwera i hydratacji
// się zgadza. Każde wstrzymanie ma zwolnienie w slocie, który JEST renderowany
// (kolumna domykająca pochodzi z tej samej listy) - nie wolno liczyć bramki z
// listy szerszej niż sloty, bo zwolnienie w nierenderowanej kolumnie chowałoby
// kolumnę na zawsze. Po zmianie urządzenia albo nawigacji SPA wstrzymanie
// i zwolnienia montują się razem, w jednym commicie. Zwolnienie ustawia
// `visibility: inherit`, czyli stan „bez reguły" (widoczność się dziedziczy),
// a nie `visible`: nie nadpisuje widoczności rodzica i niczego przed nim nie
// odsłania.
//
// ZAKRES DZIAŁANIA. Bramka pilnuje kolejności PARSOWANIA. Wzrost kolumny
// domykającej już po jej wczytaniu (granica Suspense dopełniana `$RC`, widget
// bez danych w budżecie SSR, obraz bez wymiarów, podmiana fontu) nadal może
// przesunąć odsłoniętą kolumnę - tak samo jak dziś, bramka tego nie pogarsza.
//
// ZAKRESY. Kolejność wizualna przy parsowaniu jest dziełem CSS, nie JS:
//   - telefon (`max-width: 767px`): reguły `!important` z `mobileColumnOrderCss`,
//     czyli `order.mobile ?? 0` dla kolumn z obiektem `order` i 0 dla reszty;
//     kolumny `hideOn.mobile` mają tam `display: none` i nikogo nie wyprzedzają;
//   - szerzej (`not all and (max-width: 767px)`, dokładne dopełnienie reguły
//     mobilnej, także przy ułamkowej szerokości 767-768 px): inline `order` z HTML-u serwera, który
//     renderuje desktop (`order.desktop`; tablet dostaje swój porządek dopiero po
//     hydratacji, więc przy parsowaniu też widzi desktopowy).
// Sekcja bez odwrócenia (także taka, której `order` tylko powtarza kolejność
// dokumentu) nie dostaje nic - zero bajtów.
//
// DLACZEGO `visibility`, A NIE `display`/`content-visibility`. `visibility` działa
// w każdej przeglądarce (także iOS < 18), nie walczy z `display` slotu (inline,
// `!important` z `styles.css`, `hideOn.mobile`), a wstrzymana kolumna zachowuje
// układ, więc obrazy leniwe i IntersectionObserver liczą geometrię normalnie.
// Reguły celują w SLOT kolumny (`[data-column-slot]`), węzeł wewnętrzny renderera,
// którego autor nie stylizuje.
//
// DLACZEGO NIE PRZESTAWIENIE DOM-U NA KOLEJNOŚĆ MOBILNĄ. Usunęłoby przyczynę, ale
// zmieniłoby kolejność czytania i fokusu na desktopie, sąsiedztwo `slot + slot`
// (separatory kolumn w `styles.css`) i kolejność rezerwacji wpisów przez listy
// z `UsedPostIdsProvider` - czyli treść strony, nie tylko jej malowanie.
import type { ColumnNode, InnerSectionNode } from "@/lib/builder/types";

type SectionChild = ColumnNode | InnerSectionNode;

/** Próg mobilnego układu siatki z `styles.css` (`@media (max-width: 767px)`). */
const MOBILE_MEDIA = "(max-width: 767px)";
/** Dokładne dopełnienie `MOBILE_MEDIA` (bez luki przy ułamkowej szerokości). */
const WIDE_MEDIA = "not all and (max-width: 767px)";

/**
 * Wartość `order` z bazy w postaci, którą przyjmuje CSS (`<integer>`), albo
 * `undefined`. Schemat przepuszcza `order` z jsonb bez koercji, a ułamek lub
 * napis w regule `!important` przeglądarka odrzuca (wygrywa wtedy inline
 * desktopowy) - jeden normalizator dla reguł CSS, stylu inline i bramki trzyma
 * model bramki zgodny z tym, co naprawdę maluje przeglądarka, i nie wpuszcza
 * surowego tekstu z bazy do arkusza.
 */
export function cssOrder(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isInteger(value) ? value : undefined;
  if (typeof value === "string" && /^-?\d{1,9}$/.test(value.trim())) return Number(value);
  return undefined;
}

/** Wartość atrybutu w selektorze `[attr="…"]`: cudzysłów i ukośnik nie wychodzą z napisu. */
export function cssAttrValue(value: string): string {
  return String(value)
    .replace(/["\\]/g, "\\$&")
    .replace(/[\n\r\f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `);
}

interface ParseRange {
  readonly media: string;
  /** Kolejność CSS dziecka przy parsowaniu; `null` = dziecko nie bierze udziału w układzie. */
  readonly order: (child: SectionChild) => number | null;
}

const RANGES: readonly ParseRange[] = [
  {
    media: MOBILE_MEDIA,
    order: (c) =>
      c.advanced?.hideOn?.mobile
        ? null
        : c.kind === "column" && c.order
          ? (cssOrder(c.order.mobile) ?? 0)
          : 0,
  },
  {
    media: WIDE_MEDIA,
    order: (c) => (c.kind === "column" && c.order ? (cssOrder(c.order.desktop) ?? 0) : 0),
  },
];

/**
 * Dla każdego dziecka: indeks OSTATNIEGO późniejszego rodzeństwa z mniejszą
 * kolejnością (kolumna domykająca) albo `-1`, gdy nic po nim go nie wyprzedza.
 * Remis zachowuje kolejność dokumentu (tak działa `order`), więc nie wstrzymuje.
 */
export function completingSiblings(orders: readonly (number | null)[]): number[] {
  return orders.map((own, i) => {
    if (own === null) return -1;
    for (let j = orders.length - 1; j > i; j--) {
      const other = orders[j];
      if (other !== null && other < own) return j;
    }
    return -1;
  });
}

/**
 * Reguły mobilnej kolejności kolumn sekcji (`@media (max-width: 767px)`), emitowane
 * PRZED kolumnami (F29c). Pusta wartość = sekcja nie ma żadnej kolumny z `order`.
 */
export function mobileColumnOrderCss(sectionId: string, children: readonly SectionChild[]): string {
  const rules = children
    .filter((c): c is ColumnNode => c.kind === "column" && !!c.order)
    .map(
      (c) =>
        `[data-sec-id="${cssAttrValue(sectionId)}"] [data-col-id="${cssAttrValue(c.id)}"]{order:${cssOrder(c.order?.mobile) ?? 0} !important;}`,
    )
    .join("");
  return rules ? `@media ${MOBILE_MEDIA}{${rules}}` : "";
}

export interface ColumnOrderGate {
  /** Blok PRZED kolumnami: wstrzymuje kolumny, które parser wstawiłby przed ich poprzednikami. */
  hold: string;
  /**
   * Bloki zwalniające wg identyfikatora kolumny domykającej: każdy stoi jako
   * OSTATNIE dziecko slotu tej kolumny, więc działa po jej pełnym wczytaniu.
   */
  release: ReadonlyMap<string, string>;
}

/**
 * Bramka malowania kolumn sekcji na czas parsowania - `null`, gdy w żadnym
 * zakresie szerokości kolejność CSS nie odwraca kolejności dokumentu.
 */
export function columnOrderGate(
  sectionId: string,
  children: readonly SectionChild[],
): ColumnOrderGate | null {
  const slot = (id: string) =>
    `[data-sec-id="${cssAttrValue(sectionId)}"] [data-column-slot][data-col-id="${cssAttrValue(id)}"]`;
  let hold = "";
  const release = new Map<string, string>();
  for (const range of RANGES) {
    const completing = completingSiblings(children.map(range.order));
    let held = "";
    const freed = new Map<string, string>();
    completing.forEach((j, i) => {
      if (j < 0) return;
      const own = children[i].id;
      const by = children[j].id;
      held += `${slot(own)}{visibility:hidden}`;
      freed.set(by, (freed.get(by) ?? "") + `${slot(own)}{visibility:inherit}`);
    });
    if (held) hold += `@media ${range.media}{${held}}`;
    for (const [by, rules] of freed) {
      release.set(by, (release.get(by) ?? "") + `@media ${range.media}{${rules}}`);
    }
  }
  return hold ? { hold, release } : null;
}
