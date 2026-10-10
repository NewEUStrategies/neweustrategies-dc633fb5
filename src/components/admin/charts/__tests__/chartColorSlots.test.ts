// BRAMKA PRÓBNIKA KOLORU SERII (kontrakt PR2, „Colour picker behaviour" (c)).
//
// Próbnik oferuje WYŁĄCZNIE sloty, które:
//   * mają co najmniej 3:1 na płycie wykresu w OBU motywach,
//   * leżą odcieniem (OKLCh) poza pasmem 30-110° w OBU motywach - poza
//     pomarańczem marki, bursztynem, ochrą i żółcią (decyzja właściciela:
//     żadnego bursztynu ani żółci w kolorach danych).
// Lista jest WYLICZANA z `palette.ts`; ta bramka liczy regułę niezależnie,
// w obie strony (każdy slot z listy ją spełnia, każdy spoza listy - nie),
// i przypina wynik, żeby zmiana odcienia slotu była widoczna w przeglądzie.
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import "@/lib/i18n-chart-data-editor";
import {
  CHART_PLATE,
  CHART_SLOTS,
  CONTRAST_MIN,
  contrastRatio,
  oklchOf,
} from "@/lib/charts/palette";
import { ROLE } from "@/lib/charts/roles";
import { FOCUS_SERIES_MAX } from "@/lib/charts/seriesStyle";
import { CHART_KINDS } from "@/lib/charts/types";
import { KIND_CAPS } from "@/lib/charts/kindCaps";
import {
  FOCUS_ROLE_KEYS,
  PICKER_OTHER,
  PICKER_RECOMMENDED,
  PICKER_SLOTS,
  SLOT_NAME_KEYS,
  effectivePalette,
  seriesSwatches,
  slotNameKey,
} from "../chartColorSlots";

/** Reguła liczona TU, niezależnie od modułu. */
function przechodzi(light: string, dark: string): boolean {
  const kontrast =
    contrastRatio(light, CHART_PLATE.light) >= CONTRAST_MIN.graphic &&
    contrastRatio(dark, CHART_PLATE.dark) >= CONTRAST_MIN.graphic;
  const wPasmie = (hex: string) => {
    const { c, h } = oklchOf(hex);
    return c >= 0.03 && h >= 30 && h <= 110;
  };
  return kontrast && !wPasmie(light) && !wPasmie(dark);
}

describe("próbnik koloru serii - lista slotów", () => {
  it("każdy slot z listy spełnia regułę, a każdy spoza listy - nie", () => {
    for (const s of CHART_SLOTS) {
      expect(PICKER_SLOTS.includes(s.slot), `slot ${s.slot} (${s.key})`).toBe(
        przechodzi(s.light, s.dark),
      );
    }
  });

  it("lista jest przypięta - zmiana odcienia slotu ma być widoczna w przeglądzie", () => {
    expect([...PICKER_SLOTS]).toEqual([3, 4, 8, 14, 20, 21, 11, 12, 13, 17, 1, 7, 10, 16]);
  });

  it("pomarańcz marki i rodzina bursztynu i żółci są poza próbnikiem", () => {
    // ochra (= akcent marki), terakota, cytryna, morela, brzoskwinia,
    // piaskowy, karmel, miód
    for (const slot of [2, 6, 15, 18, 22, 23, 24, 27]) {
      expect(PICKER_SLOTS, `slot ${slot}`).not.toContain(slot);
    }
  });

  it("grupy próbnika dzielą listę bez reszty i bez powtórzeń", () => {
    expect([...PICKER_RECOMMENDED, ...PICKER_OTHER].sort((a, b) => a - b)).toEqual(
      [...PICKER_SLOTS].sort((a, b) => a - b),
    );
    expect(PICKER_RECOMMENDED).toEqual([3, 4, 8, 14, 20, 21]);
  });

  it.each(["pl", "en"] as const)("każdy slot próbnika ma nazwę w słowniku (%s)", (jezyk) => {
    for (const slot of PICKER_SLOTS) {
      const key = slotNameKey(slot);
      expect(key, `slot ${slot}`).not.toBeNull();
      expect(i18n.exists(key ?? "", { lng: jezyk }), `${key} (${jezyk})`).toBe(true);
    }
    // Mapa nie trzyma nazw slotów spoza próbnika - martwych wpisów.
    const nazwyProbnika = PICKER_SLOTS.map((n) => CHART_SLOTS[n - 1].key).sort();
    expect(Object.keys(SLOT_NAME_KEYS).sort()).toEqual(nazwyProbnika);
  });

  it("slot spoza próbnika (zapis sprzed PR2) nie ma nazwy z próbnika", () => {
    expect(slotNameKey(2)).toBeNull();
  });
});

describe("próbka serii - kolor NARYSOWANY", () => {
  const serie = [{ colorSlot: 3 }, { colorSlot: 4 }, { colorSlot: 8 }];

  it("pod paletą ról seria wyróżniona ma akcent, a pozostałe - role tła", () => {
    const probki = seriesSwatches(serie, 2, "focus");
    expect(probki[2]).toEqual({ color: ROLE.acc, role: 0 });
    expect(probki[0].role).toBe(1);
    expect(probki[0].color).toBe(ROLE.sMain);
    expect(probki[1].role).toBe(2);
  });

  it("pod paletą kategorialną próbka to slot serii i nie ma roli", () => {
    const probki = seriesSwatches(serie, 2, "categorical");
    expect(probki.map((p) => p.color)).toEqual([
      "var(--chart-3)",
      "var(--chart-4)",
      "var(--chart-8)",
    ]);
    expect(probki.every((p) => p.role === null)).toBe(true);
  });

  it("seria od rangi FOCUS_SERIES_MAX bierze swój slot także pod paletą ról", () => {
    const duzo = Array.from({ length: FOCUS_SERIES_MAX + 1 }, (_, i) => ({ colorSlot: i + 1 }));
    const probki = seriesSwatches(duzo, 0, "focus");
    expect(probki[FOCUS_SERIES_MAX]).toEqual({
      color: `var(--chart-${FOCUS_SERIES_MAX + 1})`,
      role: null,
    });
  });

  it("etykiety ról: jedna na rangę palety ról, w obu językach", () => {
    expect(FOCUS_ROLE_KEYS).toHaveLength(FOCUS_SERIES_MAX);
    for (const key of FOCUS_ROLE_KEYS) {
      expect(i18n.exists(key, { lng: "pl" }) && i18n.exists(key, { lng: "en" }), key).toBe(true);
    }
  });

  it("rodzaj, w którym paleta nic nie zmienia, maluje sloty jak paleta kategorialna", () => {
    for (const kind of CHART_KINDS) {
      expect(effectivePalette(kind, "focus"), kind).toBe(
        KIND_CAPS[kind].palette ? "focus" : "categorical",
      );
      expect(effectivePalette(kind, "categorical"), kind).toBe("categorical");
    }
  });
});
