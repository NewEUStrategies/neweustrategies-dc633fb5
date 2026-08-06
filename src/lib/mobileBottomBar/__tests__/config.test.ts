import { describe, expect, it } from "vitest";
import {
  DEFAULT_BAR_RADIUS,
  MAX_BOTTOM_BAR_ITEMS,
  MOBILE_BOTTOM_BAR_DEFAULTS,
  activeBottomBarIndex,
  bottomBarLabel,
  clampOffset,
  clampRadius,
  itemAccent,
  normalizeBadgeSource,
  safeBarColor,
  visibleBottomBarItems,
  type MobileBottomBarItem,
} from "../config";

/** Tłumacz-atrapa: zwraca klucz, gdy nie zna hasła - dokładnie jak i18next. */
const translate =
  (dict: Record<string, string>) =>
  (key: string): string =>
    dict[key] ?? key;

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
    expect(clampRadius("abc")).toBe(DEFAULT_BAR_RADIUS);
    expect(clampRadius(6)).toBe(6);
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

  it("normalizuje nieznane źródło licznika do 'none'", () => {
    expect(normalizeBadgeSource("chat")).toBe("chat");
    expect(normalizeBadgeSource("network")).toBe("network");
    expect(normalizeBadgeSource("wat")).toBe("none");
    expect(normalizeBadgeSource(undefined)).toBe("none");
    const [first] = visibleBottomBarItems({
      ...MOBILE_BOTTOM_BAR_DEFAULTS,
      items: [{ ...MOBILE_BOTTOM_BAR_DEFAULTS.items[0], badge: undefined }],
    });
    expect(first.badge).toBe("none");
  });

  it("bierze etykietę z i18n, gdy administrator nie nadpisał tekstu", () => {
    const t = translate({
      "mobileBottomBar.itemLabels.home": "Start",
      "mobileBottomBar.itemLabels.homeEn": "Home",
    });
    const item: MobileBottomBarItem = {
      ...MOBILE_BOTTOM_BAR_DEFAULTS.items[2],
      label_pl: "",
      label_en: "",
    };
    expect(bottomBarLabel(item, "pl", t)).toBe("Start");
    // Brak tłumacza (np. render bez i18n) nie może wyświetlić surowego klucza.
    expect(bottomBarLabel(item, "pl")).toBe("");
  });

  it("nadpisanie administratora wygrywa z kluczem i18n", () => {
    const t = translate({ "mobileBottomBar.itemLabels.home": "Start" });
    const item: MobileBottomBarItem = {
      ...MOBILE_BOTTOM_BAR_DEFAULTS.items[2],
      label_pl: "Główna",
      label_en: "Main",
    };
    expect(bottomBarLabel(item, "pl", t)).toBe("Główna");
    expect(bottomBarLabel(item, "en", t)).toBe("Main");
  });

  it("spada na drugi język, gdy brak i tłumaczenia, i własnej etykiety", () => {
    const item: MobileBottomBarItem = {
      ...MOBILE_BOTTOM_BAR_DEFAULTS.items[0],
      label_key: undefined,
      label_pl: "Sieć",
      label_en: "",
    };
    expect(bottomBarLabel(item, "en")).toBe("Sieć");
  });

  it("dopasowuje aktywną pozycję po najdłuższym prefiksie", () => {
    const items = visibleBottomBarItems(MOBILE_BOTTOM_BAR_DEFAULTS);
    expect(activeBottomBarIndex(items, "/network")).toBe(0);
    expect(activeBottomBarIndex(items, "/messages")).toBe(1);
    expect(activeBottomBarIndex(items, "/")).toBe(2);
    expect(activeBottomBarIndex(items, "/reading-list")).toBe(3);
    expect(activeBottomBarIndex(items, "/profile/bookmarks")).toBe(4);
    expect(activeBottomBarIndex(items, "/nieznana")).toBe(-1);
  });

  it("ignoruje prefiks języka, query i slash na końcu", () => {
    const items = visibleBottomBarItems(MOBILE_BOTTOM_BAR_DEFAULTS);
    // Wersja EN serwuje treść pod /en/* - bez normalizacji pasek gasł na
    // każdej angielskiej stronie (regresja, którą ten test pilnuje).
    expect(activeBottomBarIndex(items, "/en")).toBe(2);
    expect(activeBottomBarIndex(items, "/en/")).toBe(2);
    expect(activeBottomBarIndex(items, "/en/network")).toBe(0);
    expect(activeBottomBarIndex(items, "/network/")).toBe(0);
    expect(activeBottomBarIndex(items, "/network?tab=invites")).toBe(0);
  });

  it("nie myli prefiksu ze ścieżką o tym samym początku", () => {
    const items = visibleBottomBarItems(MOBILE_BOTTOM_BAR_DEFAULTS);
    // "/networking" nie jest podstroną "/network".
    expect(activeBottomBarIndex(items, "/networking")).toBe(-1);
  });

  it("wybiera akcent zależnie od motywu, z fallbackiem ciemny -> jasny", () => {
    const item: MobileBottomBarItem = {
      ...MOBILE_BOTTOM_BAR_DEFAULTS.items[0],
      color: "#2f6df6",
      color_dark: "#7aa7ff",
    };
    expect(itemAccent(item, "light", "var(--brand)")).toBe("#2f6df6");
    expect(itemAccent(item, "dark", "var(--brand)")).toBe("#7aa7ff");
    expect(itemAccent({ ...item, color_dark: undefined }, "dark", "var(--brand)")).toBe("#2f6df6");
    expect(itemAccent(undefined, "dark", "var(--brand)")).toBe("var(--brand)");
    // Kolor z próbą wstrzyknięcia nie może przejść do atrybutu style.
    expect(itemAccent({ ...item, color_dark: "#fff;}" }, "dark", "var(--brand)")).toBe("#2f6df6");
  });
});

describe("mobileBottomBar - kontrakt domyślnego paska", () => {
  const items = visibleBottomBarItems(MOBILE_BOTTOM_BAR_DEFAULTS);

  it("jest włączony, zaokrąglony na 6 px i ma pięć pozycji", () => {
    expect(MOBILE_BOTTOM_BAR_DEFAULTS.enabled).toBe(true);
    expect(MOBILE_BOTTOM_BAR_DEFAULTS.radius).toBe(6);
    expect(items).toHaveLength(5);
    expect(items.length).toBeLessThanOrEqual(MAX_BOTTOM_BAR_ITEMS);
  });

  it("trzyma stronę główną DOKŁADNIE na środku", () => {
    const middle = Math.floor(items.length / 2);
    expect(items[middle].id).toBe("home");
    expect(items[middle].href).toBe("/");
    expect(activeBottomBarIndex(items, "/")).toBe(middle);
  });

  it("kolejność to sieć / czaty / start / zapisane / profil", () => {
    expect(items.map((i) => i.id)).toEqual(["network", "chats", "home", "saved", "profile"]);
  });

  it("każda pozycja ma akcent na oba motywy i klucz i18n", () => {
    for (const item of items) {
      expect(item.label_key, item.id).toMatch(/^mobileBottomBar\.itemLabels\./);
      expect(safeBarColor(item.color, ""), item.id).not.toBe("");
      expect(safeBarColor(item.color_dark, ""), item.id).not.toBe("");
    }
  });

  it("liczniki wiszą tylko tam, gdzie mają sens", () => {
    const byId = Object.fromEntries(items.map((i) => [i.id, i.badge]));
    expect(byId.chats).toBe("chat");
    expect(byId.network).toBe("network");
    expect(byId.home).toBe("none");
  });
});
