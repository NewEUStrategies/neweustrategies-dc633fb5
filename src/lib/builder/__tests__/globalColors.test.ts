// Katalog kolorów globalnych + emiter CSS. To ten plik decyduje o wyglądzie
// KAŻDEJ strony budowanej builderem: `globalColorsToCss` idzie do <style> na
// :root montowanego w `__root.tsx`, a więc na każdej trasie publicznej.
// Przed tym testem miał 6,8% linii i 0 z 3 funkcji - czyli nic nie pilnowało ani
// spójności katalogu (65 slotów w 20 grupach), ani tego, co ląduje w CSS.
//
// Czego NIE testujemy: konkretnych wartości kolorów marki (to decyzja
// redakcyjna, nie kontrakt) - pilnujemy STRUKTURY katalogu i REGUŁ emisji.
import { describe, it, expect } from "vitest";
import {
  GLOBAL_COLOR_CATEGORIES,
  GLOBAL_COLOR_GROUPS,
  EMPTY_GLOBAL_COLORS,
  isSlotHoverable,
  globalColorsToCss,
  type GlobalColorSlot,
  type GlobalColorGroup,
  type GlobalColorsValue,
} from "../globalColors";

const ALL_SLOTS: ReadonlyArray<GlobalColorSlot> = GLOBAL_COLOR_GROUPS.flatMap((g) => g.slots);

/** Grupa syntetyczna - do testowania `isSlotHoverable` w izolacji od katalogu. */
function group(slots: Array<Partial<GlobalColorSlot> & { key: string }>): GlobalColorGroup {
  return {
    id: "g",
    label: "G",
    slots: slots.map((s) => ({ label: s.key, description: "", ...s })) as GlobalColorSlot[],
  };
}

describe("katalog kolorów globalnych - spójność", () => {
  it("ma 20 grup, 5 kategorii i 65 slotów", () => {
    // Liczby są kotwicą regresji: dodanie slotu jest świadomą decyzją i ma
    // przechodzić przez ten test razem z resztą kontraktu.
    expect(GLOBAL_COLOR_GROUPS).toHaveLength(20);
    expect(GLOBAL_COLOR_CATEGORIES).toHaveLength(5);
    expect(ALL_SLOTS).toHaveLength(65);
  });

  it("nie ma DWÓCH slotów o tym samym kluczu", () => {
    // Duplikat klucza to cicha kolizja: drugi slot nadpisuje `--gc-<key>`
    // pierwszego i jeden z pickerów w panelu przestaje cokolwiek robić.
    const keys = ALL_SLOTS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("każdy slot ma niepusty klucz i etykietę", () => {
    for (const s of ALL_SLOTS) {
      expect(s.key.length).toBeGreaterThan(0);
      expect(String(s.label).length).toBeGreaterThan(0);
    }
  });

  it("każda kategoria grupy wskazuje na ZADEKLAROWANĄ kategorię", () => {
    // Literówka w `category` wyrzuca całą grupę z zakładki w panelu - slot
    // istnieje, ale redaktor nie ma jak do niego dojść.
    const declared = new Set(GLOBAL_COLOR_CATEGORIES.map((c) => c.id));
    for (const g of GLOBAL_COLOR_GROUPS) {
      if (g.category) expect(declared).toContain(g.category);
    }
  });

  it("identyfikatory grup i kategorii są unikalne", () => {
    const gids = GLOBAL_COLOR_GROUPS.map((g) => g.id);
    const cids = GLOBAL_COLOR_CATEGORIES.map((c) => c.id);
    expect(new Set(gids).size).toBe(gids.length);
    expect(new Set(cids).size).toBe(cids.length);
  });

  it("klucze slotów nadają się na nazwę zmiennej CSS", () => {
    // `--gc-${key}` jest wstawiane do CSS bez żadnego czyszczenia, więc klucz
    // MUSI być bezpieczny już w katalogu.
    for (const s of ALL_SLOTS) expect(s.key).toMatch(/^[a-z0-9-]+$/);
  });

  it("nadpisania semantycznych tokenów też są bezpiecznymi nazwami zmiennych", () => {
    for (const s of ALL_SLOTS) {
      for (const o of s.overrides ?? []) expect(o).toMatch(/^--[a-z0-9-]+$/);
    }
  });

  it("EMPTY_GLOBAL_COLORS jest pustą wartością", () => {
    expect(EMPTY_GLOBAL_COLORS).toEqual({});
  });
});

describe("isSlotHoverable", () => {
  it("domyślnie slot JEST hoverowalny", () => {
    const g = group([{ key: "plain" }]);
    expect(isSlotHoverable(g.slots[0], g)).toBe(true);
  });

  it("`hoverable: false` wyłącza jawnie", () => {
    const g = group([{ key: "plain", hoverable: false }]);
    expect(isSlotHoverable(g.slots[0], g)).toBe(false);
  });

  it("`hoverable: true` włącza jawnie, nawet gdy inne reguły by wykluczyły", () => {
    // Jawne `true` wygrywa nad regułą sufiksu `-hover` i nad listą wyjątków.
    const g = group([{ key: "x-hover", hoverable: true }]);
    expect(isSlotHoverable(g.slots[0], g)).toBe(true);
    const g2 = group([{ key: "btn-bg", hoverable: true }]);
    expect(isSlotHoverable(g2.slots[0], g2)).toBe(true);
  });

  it("slot, który SAM jest wariantem hover, nie dostaje własnego hoveru", () => {
    const g = group([{ key: "link-hover" }]);
    expect(isSlotHoverable(g.slots[0], g)).toBe(false);
  });

  it("slot z siostrzanym `<key>-hover` w tej samej grupie nie dostaje hoveru", () => {
    // Para pickerów już istnieje jako osobny slot - druga byłaby duplikatem.
    const g = group([{ key: "link" }, { key: "link-hover" }]);
    expect(isSlotHoverable(g.slots[0], g)).toBe(false);
  });

  it("siostrzany slot liczy się TYLKO w obrębie tej samej grupy", () => {
    const a = group([{ key: "link" }]);
    expect(isSlotHoverable(a.slots[0], a)).toBe(true);
  });

  it("sloty z dedykowanymi parami hover (przycisk/pole/sidebar) są wyłączone", () => {
    const exempt = [
      "btn-bg",
      "btn-text",
      "input-bg",
      "input-text",
      "input-placeholder",
      "input-border",
      "sidebar-btn-bg",
      "sidebar-btn-text",
    ];
    for (const key of exempt) {
      const g = group([{ key }]);
      expect(isSlotHoverable(g.slots[0], g)).toBe(false);
    }
  });

  it("w prawdziwym katalogu hoverowalnych jest 45 z 65 slotów", () => {
    const n = GLOBAL_COLOR_GROUPS.flatMap((g) => g.slots.filter((s) => isSlotHoverable(s, g)));
    expect(n).toHaveLength(45);
  });
});

describe("globalColorsToCss - struktura wyjścia", () => {
  it("emituje blok :root,.light i blok .dark", () => {
    const out = globalColorsToCss({});
    expect(out).toContain(":root,.light{");
    expect(out).toContain(".dark{");
  });

  it("dla PUSTEJ wartości nadal emituje domyślne tokeny katalogu", () => {
    // Kluczowy kontrakt: strona bez zapisanych kolorów globalnych i tak dostaje
    // spójny motyw z `defaultLight`/`defaultDark`, a nie goły CSS.
    const out = globalColorsToCss({});
    expect(out.length).toBeGreaterThan(10_000);
    expect(out).toContain("--gc-header-icon:");
  });

  it("13 slotów bez `defaultLight` nie emituje zmiennej, dopóki użytkownik jej nie ustawi", () => {
    // Te sloty MUSZĄ milczeć: emisja pustej wartości nadpisałaby działający
    // token shadcn (np. --primary) niczym.
    const silent = [
      "btn-bg",
      "btn-text",
      "btn-hover-bg",
      "btn-hover-text",
      "switcher-light-icon",
      "switcher-light-bg",
      "switcher-dark-icon",
      "switcher-dark-bg",
      "bookmark-hover",
      "sponsor-label",
      "popular-counter",
      "live-blog",
      "toc-bg",
    ];
    const out = globalColorsToCss({});
    for (const key of silent) {
      expect(ALL_SLOTS.find((s) => s.key === key)?.defaultLight).toBeUndefined();
      expect(out).not.toContain(`--gc-${key}: `);
    }
  });

  it("dokłada mostek widgetowy z zerową specyficznością (`:where`)", () => {
    // `:where()` gwarantuje, że kolor ustawiony PER WIDGET zawsze wygrywa nad
    // globalnym - bez tego globalny motyw nadpisywałby ustawienia instancji.
    const out = globalColorsToCss({});
    expect(out).toContain(":where(");
    expect(out).toContain("@layer utilities");
  });
});

describe("globalColorsToCss - wartości użytkownika", () => {
  const val = (v: GlobalColorsValue) => globalColorsToCss(v);

  it("wartość light nadpisuje domyślną i trafia do bloku :root", () => {
    const out = val({ highlight: { light: "#ff0000" } });
    expect(out).toContain("--gc-highlight: #ff0000;");
  });

  it("wartość dark trafia do bloku .dark, nie do :root", () => {
    const out = val({ highlight: { dark: "#00ff00" } });
    const dark = out.slice(out.indexOf(".dark{"));
    expect(dark).toContain("--gc-highlight: #00ff00;");
  });

  // UWAGA na dobór slotu: `highlight` NIE jest hoverowalny, bo w katalogu
  // istnieje osobny slot `highlight-hover` - to on emituje `--gc-highlight-hover`
  // z własnego domyślnego koloru. Sloty do testów hoveru wyznaczamy więc
  // regułą, nie z palca.
  const hoverable = GLOBAL_COLOR_GROUPS.flatMap((g) =>
    g.slots.filter((s) => isSlotHoverable(s, g)),
  );

  it("emituje `--gc-<key>-hover` dla slotu hoverowalnego", () => {
    const slot = hoverable.find((s) => s.defaultLight);
    expect(slot).toBeDefined();
    const out = val({ [slot!.key]: { light: "#111111", hoverLight: "#222222" } });
    expect(out).toContain(`--gc-${slot!.key}-hover: #222222;`);
  });

  it("hover spada na wartość podstawową, gdy slot nie ma własnego domyślnego hoveru", () => {
    // Łańcuch: hoverLight użytkownika -> defaultHoverLight slotu -> wartość
    // podstawowa. Bez ostatniego ogniwa element traciłby kolor pod kursorem.
    const slot = hoverable.find((s) => s.defaultLight && !s.defaultHoverLight);
    expect(slot).toBeDefined();
    const out = val({ [slot!.key]: { light: "#123456" } });
    expect(out).toContain(`--gc-${slot!.key}-hover: #123456;`);
  });

  it("ŻADEN slot katalogu nie ustawia dziś `defaultHoverLight`/`defaultHoverDark`", () => {
    // To nie jest asercja o wyglądzie, a KOTWICA na martwą powierzchnię
    // konfiguracji: `GlobalColorSlot` deklaruje oba pola i `globalColorsToCss`
    // je czyta (środkowe ogniwo łańcucha hoverLight -> defaultHoverLight ->
    // wartość podstawowa), ale katalog nie wypełnia ich ani raz. Dopóki tak
    // jest, efektywny łańcuch ma DWA ogniwa i tylko tyle da się przetestować.
    // Gdy ktoś doda pierwszą wartość, ten test upadnie i przypomni o dopisaniu
    // przypadku na środkowe ogniwo.
    expect(ALL_SLOTS.filter((s) => s.defaultHoverLight)).toHaveLength(0);
    expect(ALL_SLOTS.filter((s) => s.defaultHoverDark)).toHaveLength(0);
  });

  it("nadpisuje TAKŻE semantyczne tokeny wskazane w `overrides`", () => {
    const slot = ALL_SLOTS.find((s) => (s.overrides ?? []).length > 0);
    expect(slot).toBeDefined();
    const out = val({ [slot!.key]: { light: "#abcdef" } });
    for (const o of slot!.overrides ?? []) expect(out).toContain(`${o}: #abcdef;`);
  });

  it("ignoruje wartość dark dla slotu bez `hasDark`", () => {
    // Slot bez `hasDark` ma JEDEN kolor na oba tryby - zapis z gałęzią dark
    // (np. pozostałość po zmianie katalogu) nie może się przecisnąć do CSS.
    const noDark = ALL_SLOTS.find((s) => !s.hasDark);
    expect(noDark).toBeDefined();
    const out = val({ [noDark!.key]: { dark: "#deadbe" } });
    expect(out).not.toContain("#deadbe");
  });

  it("slot bez `hasDark` przyjmuje wartość light normalnie", () => {
    const noDark = ALL_SLOTS.find((s) => !s.hasDark);
    const out = val({ [noDark!.key]: { light: "#c0ffee" } });
    expect(out).toContain(`--gc-${noDark!.key}: #c0ffee;`);
  });

  it("nieznany klucz slotu jest po prostu pomijany", () => {
    // Zapis z bazy może zawierać slot usunięty z katalogu - to nie może
    // wysypać emisji ani wstrzyknąć nieistniejącej zmiennej.
    const out = val({ "slot-ktory-nie-istnieje": { light: "#ff00ff" } });
    expect(out).not.toContain("#ff00ff");
    expect(out).toContain(":root,.light{");
  });

  it("pusty łańcuch traktuje jak brak wartości (dziedzicz z domyślnej)", () => {
    const out = val({ highlight: { light: "" } });
    const dflt = ALL_SLOTS.find((s) => s.key === "highlight")?.defaultLight;
    if (dflt) expect(out).toContain(`--gc-highlight: ${dflt};`);
  });
});

describe("globalColorsToCss - typografia slotów", () => {
  const typoSlot = ALL_SLOTS.find((s) => s.typography);

  it("katalog ma 24 sloty z typografią", () => {
    expect(ALL_SLOTS.filter((s) => s.typography)).toHaveLength(24);
  });

  it("emituje zmienne typografii TYLKO dla jawnie ustawionych pól", () => {
    // Domyślne wartości slotu celowo NIE są emitowane: nadpisałyby klasy
    // Tailwinda użyte w widgetach (np. text-base na h2 karty).
    expect(typoSlot).toBeDefined();
    const empty = globalColorsToCss({});
    expect(empty).not.toContain(`--gc-${typoSlot!.key}-size:`);

    const out = globalColorsToCss({
      [typoSlot!.key]: {
        fontFamily: "Georgia",
        fontSize: "18px",
        fontWeight: "700",
        fontStyle: "italic",
        textDecoration: "underline",
      },
    });
    expect(out).toContain(`--gc-${typoSlot!.key}-font: Georgia;`);
    expect(out).toContain(`--gc-${typoSlot!.key}-size: 18px;`);
    expect(out).toContain(`--gc-${typoSlot!.key}-weight: 700;`);
    expect(out).toContain(`--gc-${typoSlot!.key}-style: italic;`);
    expect(out).toContain(`--gc-${typoSlot!.key}-decoration: underline;`);
  });

  it("nie emituje typografii dla slotu, który jej nie deklaruje", () => {
    const plain = ALL_SLOTS.find((s) => !s.typography);
    expect(plain).toBeDefined();
    const out = globalColorsToCss({ [plain!.key]: { fontSize: "18px" } });
    expect(out).not.toContain(`--gc-${plain!.key}-size:`);
  });
});
