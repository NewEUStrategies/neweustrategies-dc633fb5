import { describe, expect, it } from "vitest";
import {
  MOBILE_BOTTOM_BAR_DEFAULTS,
  activeBottomBarIndex,
  bottomBarLabel,
  clampOffset,
  clampRadius,
  safeBarColor,
  visibleBottomBarItems,
} from "../config";

describe("mobileBottomBar config", () => {
  it("odrzuca kolory z próbą wstrzyknięcia CSS", () => {
    expect(safeBarColor("#ff8c00", "#000")).toBe("#ff8c00");
    expect(safeBarColor("red", "#000")).toBe("red");
    expect(safeBarColor("red;} body{display:none", "#000")).toBe("#000");
    expect(safeBarColor("", "#000")).toBe("#000");
  });

  it("przycina wartości liczbowe do zakresu", () => {
    expect(clampOffset(999)).toBe(40);
    expect(clampOffset(-5)).toBe(0);
    expect(clampRadius("abc")).toBe(26);
  });

  it("pomija pozycje wyłączone i sanityzuje adresy", () => {
    const cfg = {
      ...MOBILE_BOTTOM_BAR_DEFAULTS,
      items: [
        { ...MOBILE_BOTTOM_BAR_DEFAULTS.items[0], enabled: false },
        { ...MOBILE_BOTTOM_BAR_DEFAULTS.items[1], href: "javascript:alert(1)" },
      ],
    };
    const items = visibleBottomBarItems(cfg);
    expect(items).toHaveLength(1);
    expect(items[0].href).toBe("/");
  });

  it("wybiera etykietę zgodną z językiem, z fallbackiem", () => {
    const item = { ...MOBILE_BOTTOM_BAR_DEFAULTS.items[0], label_en: "" };
    expect(bottomBarLabel(item, "pl")).toBe("Start");
    expect(bottomBarLabel(item, "en")).toBe("Start");
  });

  it("dopasowuje aktywną pozycję po najdłuższym prefiksie", () => {
    const items = visibleBottomBarItems(MOBILE_BOTTOM_BAR_DEFAULTS);
    expect(activeBottomBarIndex(items, "/")).toBe(0);
    expect(activeBottomBarIndex(items, "/analizy/wpis")).toBe(1);
    expect(activeBottomBarIndex(items, "/nieznana")).toBe(-1);
  });
});
