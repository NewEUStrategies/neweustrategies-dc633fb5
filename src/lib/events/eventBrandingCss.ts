// Branding wydarzenia -> deklaracje CSS, zakres i mapowanie na tokeny.
//
// DLACZEGO OSOBNO OD KOMPONENTU. Odpowiednik motywu globalnego ma ten sam
// podział: regułę liczy `globalColorsToCss` w `lib/builder/globalColors.ts`,
// a `<style>` wstawia `components/DesignTokensStyle.tsx`. Trzymanie reguły
// przy komponencie znaczyłoby, że jedynym sposobem sprawdzenia, co wchodzi do
// arkusza, jest wyrenderowanie strony wydarzenia.
//
// NIGDY `:root`. Branding NALEŻY DO WYDARZENIA, a nie do serwisu: reguła
// wchodzi pod `[data-event-branding]`, czyli pod opakowanie tej jednej strony.
// Ten sam kod na `:root` przemalowałby nagłówek serwisu, stopkę i każdą inną
// zakładkę otwartą po powrocie z wydarzenia - kolor jednego kongresu zostałby
// kolorem marki.
//
// PUSTY SLOT NIE GENERUJE DEKLARACJI. `eventBrandingFromJson` degraduje śmieci
// i wartości spoza `#RRGGBB` do pustego napisu, a pusty slot znaczy
// DZIEDZICZENIE z motywu globalnego - deklaracja z pustą wartością wygrałaby
// kaskadę i zostawiła element bez koloru. Dlatego slot bez wartości jest
// pomijany, a nie zapisywany jako „nic".
//
// KONTRAST LICZYMY TUTAJ, A NIE W CSS. Slot „Kolor nawigacji” wchodzi na pasek
// zakładek jako TŁO, więc napis na tym pasku musi się dopasować do luminancji
// wybranego koloru - inaczej redaktor, który ustawi granat, dostaje granatowy
// pasek z szarym napisem z motywu i zakładki znikają. CSS nie umie policzyć
// luminancji (`color-contrast()` nie jest jeszcze wszędzie), a komponent paska
// NIE MA dostępu do koloru: `EventTabsBar` jest molekułą bez propsa brandingu,
// bo montuje ją i strona publiczna, i podgląd studia. Jedynym miejscem, w którym
// hex jest dostępny w JS-ie, jest ten generator - dlatego wypuszcza on parę
// zmiennych `--event-nav-fg` / `--event-nav-fg-muted`, a pasek tylko je czyta.
// Funkcja jest ta sama, co przy pigułkach kategorii i krążkach ikon
// (`pickTextColor`), a nie druga reguła progu.
//
// KLUCZ `appearance` (jasny / ciemny) JEST TU ŚWIADOMIE NIEOBSŁUGIWANY - to nie
// przeoczenie i nie brakująca linia. Motyw w tym serwisie wybiera CZYTELNIK:
// `ThemeProvider` trzyma wybór w `localStorage`, degraduje do
// `prefers-color-scheme` i przełącza klasę `.dark` na `<html>`, a skrypt
// przedhydratacyjny w `__root.tsx` zakłada ją przed pierwszym malowaniem.
// Wymuszenie motywu wydarzenia znaczyłoby założenie `.light` / `.dark` na
// opakowaniu portalu, a to daje trzy skutki, z których żaden nie jest do
// obrony bez decyzji właściciela:
//   1. `eventBrandingFromJson` degraduje BRAK klucza do `"light"`, a
//      `eventBrandingPayload` zapisuje `appearance` ZAWSZE - czyli każde
//      istniejące wydarzenie w bazie ma dziś zapisane „jasny”. Dociągnięcie
//      przełącznika przemalowałoby na jasno portal KAŻDEGO wydarzenia
//      czytelnikowi, który wybrał motyw ciemny. Nie ma stanu „dziedzicz”.
//   2. Zakres brandingu obejmuje wyłącznie portal wydarzenia, więc nagłówek
//      i stopka serwisu zostałyby ciemne wokół jasnej wyspy.
//   3. Wariant `dark` Tailwinda jest w `styles.css` zdefiniowany jako
//      `&:is(.dark *)`, czyli patrzy na PRZODKA. Klasa `.light` na opakowaniu
//      podmienia tokeny, ale NIE wyłącza reguł `dark:` z wnętrza portalu -
//      dostalibyśmy jasne tokeny pod ciemnymi utilities, czyli napis w kolorze
//      tła. Odwrotny kierunek psuje się tak samo.
// Poprawną odpowiedzią jest albo usunięcie kontrolki, albo dodanie jej trzeciego
// stanu („dziedzicz”) i migracja zapisanych wierszy - jedno i drugie dotyka
// panelu i RPC, czyli plików poza tą zmianą. Do tego czasu ten generator
// zostawia klucz w spokoju, a ten komentarz jest jedynym śladem, że to decyzja,
// a nie zapomniana linia.
//
// GRANICA WARSTW: zero Reacta, zero i18next, zero klienta bazy.
import {
  eventBrandingFromJson,
  EVENT_BRANDING_COLOR_SLOTS,
  type EventBrandingColorSlot,
} from "@/lib/events/eventBrandingDraft";
import { pickTextColor } from "@/lib/post/badgeContrast";

/**
 * Atrybut opakowania strony wydarzenia. Selektor atrybutowy zamiast klasy, bo
 * atrybut nie może przypadkiem trafić do `cn()` innego komponentu ani zostać
 * wygenerowany przez Tailwinda.
 */
const EVENT_BRANDING_ATTR = "data-event-branding";

/**
 * Atrybuty opakowania strony wydarzenia, gotowe do rozwinięcia w JSX.
 *
 * JEDNO ŹRÓDŁO PARY SELEKTOR/ATRYBUT. Gdyby trasa pisała `data-event-branding`
 * własnym literałem, zmiana nazwy atrybutu tutaj zostawiłaby stronę bez
 * kolorów i BEZ BŁĘDU - CSS po prostu przestałby pasować do niczego.
 */
export const eventBrandingScopeProps = { [EVENT_BRANDING_ATTR]: "" } as const;

/**
 * Slot brandingu -> zmienne CSS, które ma nadpisać.
 *
 * MAPOWANIE JEST JAWNE, tak samo jak `overrides` w `GLOBAL_COLOR_GROUPS`.
 * Każdy slot dostaje własną zmienną `--event-*` (żeby komponenty strony
 * wydarzenia mogły sięgnąć po nią wprost) ORAZ nadpisuje token semantyczny
 * shadcn, jeśli i tylko jeśli odpowiedniość jest jednoznaczna. Token, dla
 * którego trzeba by zgadywać (np. `--primary-foreground` przy zmienionym
 * `--primary`), nie jest nadpisywany: kontrast policzony na zgadywanie jest
 * gorszy od kontrastu z motywu.
 */
const SLOT_VARIABLES: Record<EventBrandingColorSlot, readonly string[]> = {
  // Pasek nawigacji podstron wydarzenia - własna zmienna, bo nagłówek serwisu
  // zostaje niezmieniony (i ma zostać: to nadal ten sam serwis).
  navigation: ["--event-nav"],
  main_action: ["--event-action", "--primary", "--ring"],
  text: ["--event-text", "--foreground"],
  blocks_background: ["--event-block-bg", "--card", "--popover"],
  page_background: ["--event-page-bg", "--background"],
};

/**
 * Adres obrazu tła sprawdzamy TUTAJ, a nie ufamy zapisowi.
 * `eventBrandingFromJson` waliduje kolory, ale obraz oddaje surowo
 * (`validateEventBranding` jest regułą FORMULARZA, nie parsera), a wiersz mógł
 * powstać przed tą walidacją albo obok niej. Wartość wchodzi do `url("…")`,
 * więc cudzysłów, nawias, ukośnik wsteczny i biały znak są tu wektorem
 * wyjścia z deklaracji - alfabet zamknięty jest jedynym zabezpieczeniem, które
 * nie zależy od tego, którędy dane weszły do bazy.
 */
const SAFE_IMAGE_URL = /^https:\/\/[^\s"'()\\]+$/;

/**
 * Udział koloru napisu w wersji „wyciszonej” paska zakładek (0-1).
 *
 * PO CO DRUGI ODCIEŃ. Dziś pasek odróżnia zakładkę bieżącą od pozostałych
 * DWOMA rzeczami naraz: grubością pisma (`font-semibold`) i kolorem
 * (`--foreground` kontra `--muted-foreground`). Gdyby na kolorowym pasku został
 * jeden odcień, połowa tego rozróżnienia by zniknęła. Mieszamy więc kolor napisu
 * W STRONĘ TŁA PASKA - a nie w stronę `transparent`, bo przezroczystość nad
 * obrazem tła daje odcień zależny od zdjęcia, czyli nieprzewidywalny.
 */
const NAV_MUTED_INK_SHARE = 0.7;

/**
 * Mieszanka dwóch kolorów `#RRGGBB` jako gotowy `#RRGGBB`.
 *
 * DLACZEGO LICZYMY TO W TS, A NIE `color-mix()` W CSS. `color-mix` jest
 * poprawnym CSS-em i w przeglądarce by zadziałał, ale wynik byłby wtedy
 * NIEMIERZALNY: happy-dom (środowisko testów) nie parsuje tej funkcji i oddaje
 * dla niej pusty napis, więc test „napis na pasku ma faktycznie ten kolor” nie
 * miałby jak zmierzyć piksela - a defekt, który tu naprawiamy, polegał dokładnie
 * na tym, że test mierzył NAPIS CSS zamiast skutku. Zwykły hex jest poza tym
 * o jedną zależność prostszy: nie zależy od wsparcia dla `color-mix` ani od
 * przestrzeni mieszania.
 *
 * Interpolacja jest w sRGB, bo obie wartości i tak przychodzą jako sRGB-owe
 * `#RRGGBB`, a wynik służy WYŁĄCZNIE do wyciszenia napisu o jeden stopień -
 * nie jest to konwersja barwna, przy której wybór przestrzeni cokolwiek zmienia.
 */
function mixHex(a: string, b: string, shareOfA: number): string {
  const channel = (offset: number) => {
    const mixed = Math.round(
      parseInt(a.slice(offset, offset + 2), 16) * shareOfA +
        parseInt(b.slice(offset, offset + 2), 16) * (1 - shareOfA),
    );
    return mixed.toString(16).padStart(2, "0");
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

/** Deklaracje CSS dla wypełnionych slotów; pusty napis = nie ma czego wstawiać. */
export function eventBrandingCss(branding: unknown): string {
  const draft = eventBrandingFromJson(branding);
  const lines: string[] = [];
  for (const slot of EVENT_BRANDING_COLOR_SLOTS) {
    const value = draft.colors[slot];
    if (value === "") continue;
    for (const variable of SLOT_VARIABLES[slot]) lines.push(`${variable}:${value};`);
  }
  // Napis paska nawigacji. Wartość jest tu ZAWSZE pełnym `#RRGGBB` (parser
  // degraduje wszystko inne do pustego napisu, a pusty slot nie wchodzi w ten
  // warunek), więc `pickTextColor` nie ma jak zwrócić wariantu „weź z motywu”
  // i oddaje czerń albo biel. Zmienne wychodzą TYLKO razem z `--event-nav`:
  // pasek bez własnego tła musi zostać przy kolorach motywu, a nie dostać
  // czerni na przezroczystym tle.
  const navigation = draft.colors.navigation;
  if (navigation !== "") {
    const ink = pickTextColor(navigation);
    lines.push(`--event-nav-fg:${ink};`);
    lines.push(`--event-nav-fg-muted:${mixHex(ink, navigation, NAV_MUTED_INK_SHARE)};`);
  }
  if (SAFE_IMAGE_URL.test(draft.backgroundImage)) {
    lines.push(`--event-bg-image:url("${draft.backgroundImage}");`);
  }
  if (lines.length === 0) return "";
  return `[${EVENT_BRANDING_ATTR}]{${lines.join("")}}`;
}
