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
// GRANICA WARSTW: zero Reacta, zero i18next, zero klienta bazy.
import {
  eventBrandingFromJson,
  EVENT_BRANDING_COLOR_SLOTS,
  type EventBrandingColorSlot,
} from "@/lib/events/eventBrandingDraft";

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

/** Deklaracje CSS dla wypełnionych slotów; pusty napis = nie ma czego wstawiać. */
export function eventBrandingCss(branding: unknown): string {
  const draft = eventBrandingFromJson(branding);
  const lines: string[] = [];
  for (const slot of EVENT_BRANDING_COLOR_SLOTS) {
    const value = draft.colors[slot];
    if (value === "") continue;
    for (const variable of SLOT_VARIABLES[slot]) lines.push(`${variable}:${value};`);
  }
  if (SAFE_IMAGE_URL.test(draft.backgroundImage)) {
    lines.push(`--event-bg-image:url("${draft.backgroundImage}");`);
  }
  if (lines.length === 0) return "";
  return `[${EVENT_BRANDING_ATTR}]{${lines.join("")}}`;
}
