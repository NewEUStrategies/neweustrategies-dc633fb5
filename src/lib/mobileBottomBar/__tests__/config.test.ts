import { describe, expect, it } from "vitest";
import {
  DEFAULT_BAR_RADIUS,
  MAX_BOTTOM_BAR_ITEMS,
  MOBILE_BOTTOM_BAR_DEFAULTS,
  activeBottomBarIndex,
  bottomBarHref,
  bottomBarLabel,
  clampOffset,
  clampRadius,
  itemAccent,
  newBottomBarItem,
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
        { ...MOBILE_BOTTOM_BAR_DEFAULTS.items[1], id: "item-custom", href: "javascript:alert(1)" },
      ],
    };
    const items = visibleBottomBarItems(cfg);
    expect(items).toHaveLength(1);
    expect(items[0].href).toBe("/");
  });

  // Zapisana konfiguracja tenanta bywa starsza niż moduły serwisu (pasek
  // pamiętał "/reading-list" pod pozycją klubów). Skróty systemowe muszą
  // trafiać w swój moduł niezależnie od tego, co leży w bazie.
  it("naprawia adres znanych pozycji do kanonicznego", () => {
    const items = visibleBottomBarItems({
      ...MOBILE_BOTTOM_BAR_DEFAULTS,
      items: [
        { ...MOBILE_BOTTOM_BAR_DEFAULTS.items[3], href: "/reading-list" },
        { ...MOBILE_BOTTOM_BAR_DEFAULTS.items[0], href: "/siec" },
      ],
    });
    expect(items.map((i) => i.href)).toEqual(["/club", "/network"]);
  });

  it("dodaje prefiks języka tylko tam, gdzie treść jest lokalizowana", () => {
    const [network, chats, home, clubs, profile] = visibleBottomBarItems(
      MOBILE_BOTTOM_BAR_DEFAULTS,
    );
    expect(bottomBarHref(home, "pl")).toBe("/");
    expect(bottomBarHref(home, "en")).toBe("/en");
    expect(bottomBarHref(network, "en")).toBe("/en/network");
    expect(bottomBarHref(clubs, "en")).toBe("/en/club");
    // /messages i /profile to powierzchnie osobiste - nigdy nie są prefiksowane.
    expect(bottomBarHref(chats, "en")).toBe("/messages");
    expect(bottomBarHref(profile, "en")).toBe("/profile");
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
    expect(activeBottomBarIndex(items, "/club")).toBe(3);
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

  it("jest włączony, pigułkowy i ma pięć pozycji", () => {
    expect(MOBILE_BOTTOM_BAR_DEFAULTS.enabled).toBe(true);
    // 20 px = 2em z referencji przy jej bazie 10 px.
    expect(MOBILE_BOTTOM_BAR_DEFAULTS.radius).toBe(DEFAULT_BAR_RADIUS);
    expect(DEFAULT_BAR_RADIUS).toBe(20);
    expect(items).toHaveLength(5);
    expect(items.length).toBeLessThanOrEqual(MAX_BOTTOM_BAR_ITEMS);
  });

  it("domyślnie jest bez podpisów - tak jak referencja", () => {
    expect(MOBILE_BOTTOM_BAR_DEFAULTS.show_labels).toBe(false);
  });

  it("trzyma stronę główną DOKŁADNIE na środku", () => {
    const middle = Math.floor(items.length / 2);
    expect(items[middle].id).toBe("home");
    expect(items[middle].href).toBe("/");
    expect(activeBottomBarIndex(items, "/")).toBe(middle);
  });

  it("kolejność to sieć / czaty / start / kluby / profil", () => {
    expect(items.map((i) => i.id)).toEqual(["network", "chats", "home", "clubs", "profile"]);
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

describe("newBottomBarItem - pozycja dodawana w panelu", () => {
  it("dostaje UNIKALNY identyfikator w tej samej milisekundzie", () => {
    // Administrator klika „+" kilka razy pod rząd. Identyfikator wchodzi do
    // klucza Reacta i do dopasowania aktywnej pozycji, więc duplikat oznaczałby
    // dwie pozycje nie do rozróżnienia i podświetlenie na złej ikonie.
    const a = newBottomBarItem(0);
    const b = newBottomBarItem(1);
    expect(a.id).not.toBe(b.id);
    expect(a.id.startsWith("item-")).toBe(true);
  });

  it("nowa pozycja jest OD RAZU poprawna: włączona, z adresem i kolorami", () => {
    const item = newBottomBarItem(0);
    expect(item).toMatchObject({ enabled: true, href: "/", icon: "circle", badge: "none" });
    // Kolory na oba motywy - wybór należy do kaskady CSS, nie do JS.
    expect(safeBarColor(item.color, "#000")).toBe(item.color);
    expect(safeBarColor(item.color_dark, "#000")).toBe(item.color_dark);
  });

  it("nowa pozycja przechodzi przez filtr widoczności paska", () => {
    // Gdyby nie przechodziła, dodanie pozycji w panelu nie dawałoby żadnego
    // efektu na telefonie - a panel pokazywałby ją jako dodaną.
    const item = newBottomBarItem(0);
    const visible = visibleBottomBarItems({ ...MOBILE_BOTTOM_BAR_DEFAULTS, items: [item] });
    expect(visible).toHaveLength(1);
    expect(visible[0].href).toBe("/");
  });

  it("ma etykiety w obu językach - żaden telefon nie zobaczy pustej pozycji", () => {
    const item = newBottomBarItem(0);
    expect(bottomBarLabel(item, "pl")).toBe("Nowa pozycja");
    expect(bottomBarLabel(item, "en")).toBe("New item");
  });
});
