// Branding wydarzenia MIERZONY NA PIKSELU, a nie na napisie CSS.
//
// PO CO TEN PLIK ISTNIEJE - i to jest w nim najważniejsze zdanie. Branding miał
// już test: `lib/events/__tests__/eventPublicPresentation.test.ts` utrwalał, że
// generator PRODUKUJE `--event-bg-image`, `--event-nav` i `--background`.
// Wszystkie trzy asercje były zielone przez cały czas, gdy trzy z pięciu slotów
// panelu NIE ROBIŁY NIC: `--event-nav` i `--event-bg-image` nie miały ani jednego
// czytelnika w repozytorium, a `--background` był nadpisywany WEWNĄTRZ opakowania
// wydarzenia, podczas gdy widoczne tło strony malował `body`, czyli PRZODEK tego
// opakowania. Test, który mierzy napis wychodzący z generatora, nie ma jak tego
// zobaczyć - bo napis był poprawny. Dlatego ten plik MONTUJE powłokę i pyta
// o WARTOŚĆ OBLICZONĄ na konkretnym węźle.
//
// JAK TO JEST MIERZALNE BEZ TAILWINDA. W testach nie ma przejazdu Tailwinda,
// więc klasy utility są tu samymi nazwami. Podstawiamy więc arkusz zastępczy,
// który wiąże KONKRETNY token klasy z deklaracją, jakiej Tailwind dla niej
// wypuszcza - selektorem `[class~="…"]`, żeby nie escapować nawiasów w nazwach
// klas dowolnych. To wiązanie jest częścią dowodu, a nie obejściem: jeśli ktoś
// usunie albo przechrzci klasę w kodzie produkcyjnym, reguła przestanie pasować
// do węzła, wartość obliczona spadnie do wartości motywu i test się zaczerwieni.
// Deklaracje klas DOWOLNYCH (`bg-[color:var(…)]`, `[background-image:var(…)]`)
// są przy tym wprost odczytane z nazwy klasy - Tailwind nie ma tam swobody.
//
// TOKENY MOTYWU są tu zadeklarowane na `:root` tak jak w `styles.css` - dzięki
// temu przypadek „wydarzenie BEZ brandingu" ma mierzalną wartość odniesienia
// i widać, że pusty branding NIE zostawia przezroczystej dziury.
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { EventPortalShell } from "@/components/events/public/organisms/EventPortalShell";
import {
  EventTabsBar,
  EVENT_TAB_ACTIVE_CLASS,
  EVENT_TAB_CLASS,
} from "@/components/events/public/molecules/EventTabsBar";
import { DARK_TEXT, LIGHT_TEXT } from "@/lib/post/badgeContrast";
import { cn } from "@/lib/utils";

/** Wartości motywu serwisu - odpowiednik bloku `:root, .light` z `styles.css`. */
const THEME_BACKGROUND = "#fafaf9";
const THEME_FOREGROUND = "#1a1a1a";
const THEME_MUTED_FOREGROUND = "#767676";

/**
 * Arkusz zastępczy: token klasy -> deklaracja, jaką wypuszcza dla niej Tailwind.
 *
 * KAŻDY WPIS JEST ASERCJĄ. Klucz to dokładny token klasy, który MUSI stać na
 * węźle malującym; wartość to deklaracja, którą ten token niesie. Selektor
 * `[class~=…]` dopasowuje token listy klas bez escapowania `[`, `(`, `,` - a przy
 * klasach dowolnych deklaracja jest po prostu treścią nawiasu z nazwy klasy.
 */
const TAILWIND_STUB: ReadonlyArray<readonly [string, string]> = [
  // Tło strony wydarzenia. `@theme inline` w `styles.css` wkleja `var(--background)`
  // wprost do utility, więc nadpisanie tokenu NA TYM elemencie działa.
  ["bg-background", "background-color:var(--background)"],
  ["[background-image:var(--event-bg-image,none)]", "background-image:var(--event-bg-image,none)"],
  ["bg-[color:var(--event-nav,transparent)]", "background-color:var(--event-nav,transparent)"],
  [
    "text-[color:var(--event-nav-fg,var(--foreground))]",
    "color:var(--event-nav-fg,var(--foreground))",
  ],
  [
    "text-[color:var(--event-nav-fg-muted,var(--muted-foreground))]",
    "color:var(--event-nav-fg-muted,var(--muted-foreground))",
  ],
];

function mountStyleEnvironment(): void {
  const themeTokens = document.createElement("style");
  themeTokens.textContent = `:root{--background:${THEME_BACKGROUND};--foreground:${THEME_FOREGROUND};--muted-foreground:${THEME_MUTED_FOREGROUND}}`;
  const utilities = document.createElement("style");
  utilities.textContent = TAILWIND_STUB.map(
    ([token, declaration]) => `[class~="${token}"]{${declaration}}`,
  ).join("");
  document.head.append(themeTokens, utilities);
}

/** Luminancja względna (te same wagi sRGB, co `pickTextColor`) dla `#RRGGBB`. */
function luminance(hex: string): number {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Powłoka z paskiem zakładek - dwie pozycje, bo pasek MUSI odróżniać bieżącą.
 *
 * Pozycje wstawia wołający (tu: napisy), dokładnie jak podgląd studia - molekuła
 * paska nie zna ani routera, ani brandingu, więc kolor musi do niej dojechać
 * zmienną CSS, a nie propsem.
 */
function mountPortal(branding: unknown) {
  mountStyleEnvironment();
  const view = render(
    <EventPortalShell
      branding={branding}
      backSlot={<span>powrot</span>}
      titleSlot={<span>Kongres</span>}
      tabsSlot={
        <EventTabsBar label="zakladki wydarzenia">
          <li>
            {/* `cn` DOKŁADNIE jak w miejscach wołających: `tailwind-merge` musi
                rozstrzygnąć dwie klasy koloru napisu na rzecz aktywnej, inaczej
                bieżąca zakładka dostałaby odcień wyciszony. */}
            <span className={cn(EVENT_TAB_CLASS, EVENT_TAB_ACTIVE_CLASS)}>Przeglad</span>
          </li>
          <li>
            <span className={EVENT_TAB_CLASS}>Prelegenci</span>
          </li>
        </EventTabsBar>
      }
    >
      <p>tresc zakladki</p>
    </EventPortalShell>,
  );
  const shell = view.container.querySelector<HTMLElement>("[data-testid='event-portal-shell']");
  const tabs = view.container.querySelector<HTMLElement>("nav");
  const activeTab = view.container.querySelector<HTMLElement>("nav li:first-child span");
  const idleTab = view.container.querySelector<HTMLElement>("nav li:last-child span");
  if (shell === null || tabs === null || activeTab === null || idleTab === null) {
    throw new Error("powloka wydarzenia nie zamontowala paska zakladek");
  }
  return { ...view, shell, tabs, activeTab, idleTab };
}

describe("branding wydarzenia dojezdza do uczestnika, nie tylko do arkusza", () => {
  it("tlo strony maluje WEZEL Z ZAKRESEM brandingu, a nie przodek poza zakresem", () => {
    const { shell } = mountPortal({ page_background: "#102030" });
    // Ten sam węzeł niesie zakres i malowanie - to jest cała treść poprawki.
    // Nadpisanie `--background` na przodku (`body`) nie miałoby jak zejść w dół
    // do zakresu, a nadpisanie w zakresie nie miało jak wejść w górę do `body`.
    expect(shell.hasAttribute("data-event-branding")).toBe(true);
    expect(getComputedStyle(shell).backgroundColor).toBe("#102030");
  });

  it("wydarzenie BEZ brandingu ma tlo motywu - ani innego koloru, ani dziury", () => {
    const { shell, container } = mountPortal(null);
    // Brak brandingu = brak arkusza wydarzenia. Powłoka maluje wtedy TOKEN
    // MOTYWU, czyli dokładnie ten kolor, który maluje `body` - więc krótka treść
    // nie zostawia pod powłoką pasa w innym kolorze, a przezroczystości nie ma
    // wcale (przezroczysta powłoka nad obrazem tła serwisu wyglądałaby inaczej).
    expect(container.querySelector("style[data-event-branding-tokens]")).toBeNull();
    expect(getComputedStyle(shell).backgroundColor).toBe(THEME_BACKGROUND);
    expect(getComputedStyle(shell).backgroundImage).toBe("none");
  });

  it("obraz tla jest RYSOWANY na powloce, a nie tylko deklarowany w arkuszu", () => {
    const { shell } = mountPortal({ background_image: "https://cdn.example.org/tlo.jpg" });
    expect(getComputedStyle(shell).backgroundImage).toBe('url("https://cdn.example.org/tlo.jpg")');
  });

  it("adres obrazu spoza `https://` nie dojezdza nigdzie - walidacja generatora zostaje", () => {
    // Ta asercja pilnuje, że dociągnięcie obrazu do widoku NIE otworzyło drugiej
    // ścieżki dla adresu: rysunek czyta WYŁĄCZNIE `--event-bg-image`, czyli to,
    // co przeszło przez zamknięty alfabet w generatorze.
    const { shell } = mountPortal({ background_image: 'https://a/x.jpg");body{display:none' });
    expect(getComputedStyle(shell).backgroundImage).toBe("none");
  });

  it("kolor nawigacji maluje pasek zakladek, a napis zostaje czytelny na ciemnym", () => {
    const { tabs, activeTab, idleTab } = mountPortal({ navigation: "#0F172A" });
    expect(getComputedStyle(tabs).backgroundColor).toBe("#0F172A");
    // Napis bieżącej zakładki: biel policzona z luminancji tła, a nie
    // `--foreground` z motywu (w jasnym motywie prawie czerń na granacie).
    expect(getComputedStyle(activeTab).color).toBe(LIGHT_TEXT);
    // Pozostałe zakładki są WYCISZONE, ale nadal po stronie napisu, a nie tła:
    // rozróżnienie „bieżąca / pozostałe" ma zostać dwustopniowe, jak w motywie.
    const idle = luminance(getComputedStyle(idleTab).color);
    expect(idle).toBeLessThan(luminance(LIGHT_TEXT));
    expect(idle).toBeGreaterThan(luminance("#0F172A"));
  });

  it("kolor nawigacji na jasnym tle daje CIEMNY napis - prog liczony, nie zgadniety", () => {
    const { tabs, activeTab } = mountPortal({ navigation: "#FFFFFF" });
    expect(getComputedStyle(tabs).backgroundColor).toBe("#FFFFFF");
    expect(getComputedStyle(activeTab).color).toBe(DARK_TEXT);
  });

  it("pasek BEZ koloru nawigacji wyglada jak dzis - tlo przezroczyste, napisy z motywu", () => {
    const { tabs, activeTab, idleTab } = mountPortal({ main_action: "#123456" });
    expect(getComputedStyle(tabs).backgroundColor).toBe("transparent");
    expect(getComputedStyle(activeTab).color).toBe(THEME_FOREGROUND);
    expect(getComputedStyle(idleTab).color).toBe(THEME_MUTED_FOREGROUND);
  });
});
