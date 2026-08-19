import { describe, it, expect, vi, afterEach } from "vitest";
import {
  addWidget,
  defaultSettingsFor,
  deleteWidget,
  draftFromLayout,
  initialSelection,
  moveWidget,
  newWidget,
  pickDefaultLayout,
  resolveReadingPanelSettings,
  selectionAfterDelete,
  toggleHidden,
  updateWidgetSettings,
} from "@/lib/sidebarBuilder/draft";
import {
  DEFAULT_READING_PANEL_SETTINGS,
  SOCIAL_KEYS,
  widgetsArraySchema,
  type SidebarLayout,
  type SidebarWidget,
  type SidebarWidgetType,
} from "@/lib/sidebarBuilder/types";

// Reduktor draftu sidebara. Cała ta logika żyła w domknięciach komponentu
// (0 z 58 funkcji pokrytych), więc każda reguła była tu wyłącznie w komentarzu.
// Reguła najdroższa w skutkach: PATCH CZĘŚCIOWY nie ma prawa zgubić pól
// nietkniętych. Sidebar trzyma osiem przełączników udostępniania w obiekcie
// `social`; jeden spread za mało i inspektor, wysyłając jeden klucz, kasuje
// pozostałe siedem przycisków - bez błędu, bez ostrzeżenia, tylko strona bez
// udostępniania.

const WIDGET_TYPES: SidebarWidgetType[] = [
  "reading-panel",
  "tags",
  "author-card",
  "related-posts",
  "newsletter",
  "ad-slot",
];

const widget = (id: string, type: SidebarWidgetType = "tags"): SidebarWidget => ({
  id,
  type,
  hidden: false,
  settings: {},
});

const layoutOf = (
  widgets: SidebarWidget[],
  overrides: Partial<SidebarLayout> = {},
): SidebarLayout => ({
  id: "layout-1",
  tenant_id: "tenant-1",
  name: "Domyślny",
  is_default: true,
  widgets,
  ...overrides,
});

const ids = (layout: SidebarLayout): string[] => layout.widgets.map((w) => w.id);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("defaultSettingsFor", () => {
  it("panel czytania dostaje PEŁNY zestaw domyślnych przełączników", () => {
    expect(defaultSettingsFor("reading-panel")).toEqual(DEFAULT_READING_PANEL_SETTINGS);
  });

  it("panel czytania dostaje KOPIĘ, nie referencję (dwa panele nie dzielą ustawień)", () => {
    const a = defaultSettingsFor("reading-panel");
    const b = defaultSettingsFor("reading-panel");
    expect(a).not.toBe(b);
    expect(a).not.toBe(DEFAULT_READING_PANEL_SETTINGS);
  });

  it.each(["tags", "author-card", "related-posts", "newsletter", "ad-slot"] as const)(
    "typ %s startuje z pustymi ustawieniami",
    (type) => {
      expect(defaultSettingsFor(type)).toEqual({});
    },
  );
});

describe("newWidget", () => {
  it.each(WIDGET_TYPES)("dla typu %s daje widget z domyślnymi ustawieniami", (type) => {
    const w = newWidget(type, `id-${type}`);
    expect(w).toEqual({
      id: `id-${type}`,
      type,
      hidden: false,
      settings: defaultSettingsFor(type),
    });
  });

  it.each(WIDGET_TYPES)("widget typu %s przechodzi walidację przed zapisem", (type) => {
    expect(() => widgetsArraySchema.parse([newWidget(type, "w-1")])).not.toThrow();
  });

  it("BEZ podanego id sięga po crypto.randomUUID", () => {
    const spy = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValue("00000000-0000-4000-8000-000000000000");
    expect(newWidget("tags").id).toBe("00000000-0000-4000-8000-000000000000");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("nowy widget NIE jest ukryty (inaczej redaktor dodaje coś niewidocznego)", () => {
    expect(newWidget("tags", "w-1").hidden).toBe(false);
  });
});

describe("draftFromLayout", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
  ])("%s daje brak draftu", (_l, input) => {
    expect(draftFromLayout(input)).toBeNull();
  });

  it("odczepia tablicę widgetów od danych zapytania", () => {
    const source = layoutOf([widget("w-1")]);
    const draft = draftFromLayout(source);
    expect(draft).toEqual(source);
    expect(draft).not.toBe(source);
    expect(draft?.widgets).not.toBe(source.widgets);
  });

  it("układ BEZ widgetów daje draft z pustą tablicą, nie null", () => {
    expect(draftFromLayout(layoutOf([]))?.widgets).toEqual([]);
  });
});

describe("pickDefaultLayout", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["pusta lista", []],
  ])("%s daje brak układu", (_l, input) => {
    expect(pickDefaultLayout(input)).toBeNull();
  });

  it("wybiera układ oznaczony jako domyślny, nawet gdy nie jest pierwszy", () => {
    const a = layoutOf([], { id: "a", is_default: false });
    const b = layoutOf([], { id: "b", is_default: true });
    expect(pickDefaultLayout([a, b])?.id).toBe("b");
  });

  it("BEZ układu domyślnego bierze pierwszy z listy", () => {
    const a = layoutOf([], { id: "a", is_default: false });
    const b = layoutOf([], { id: "b", is_default: false });
    expect(pickDefaultLayout([a, b])?.id).toBe("a");
  });

  it("przy wielu domyślnych bierze pierwszy domyślny (stan bazy bywa niespójny)", () => {
    const a = layoutOf([], { id: "a", is_default: true });
    const b = layoutOf([], { id: "b", is_default: true });
    expect(pickDefaultLayout([a, b])?.id).toBe("a");
  });
});

describe("initialSelection", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
  ])("%s daje brak zaznaczenia", (_l, input) => {
    expect(initialSelection(input)).toBeNull();
  });

  it("układ PUSTY daje brak zaznaczenia", () => {
    expect(initialSelection(layoutOf([]))).toBeNull();
  });

  it("zaznacza pierwszy widget układu", () => {
    expect(initialSelection(layoutOf([widget("w-1"), widget("w-2")]))).toBe("w-1");
  });
});

describe("addWidget", () => {
  it("dokłada widget do PUSTEGO sidebara", () => {
    const out = addWidget(layoutOf([]), widget("w-1"));
    expect(ids(out)).toEqual(["w-1"]);
  });

  it("dokłada widget na KONIEC istniejącej listy", () => {
    const out = addWidget(layoutOf([widget("w-1"), widget("w-2")]), widget("w-3"));
    expect(ids(out)).toEqual(["w-1", "w-2", "w-3"]);
  });

  it.each(WIDGET_TYPES)("dodany widget typu %s niesie ustawienia domyślne", (type) => {
    const out = addWidget(layoutOf([]), newWidget(type, "w-new"));
    expect(out.widgets[0].settings).toEqual(defaultSettingsFor(type));
  });

  it("NIE mutuje układu źródłowego", () => {
    const source = layoutOf([widget("w-1")]);
    addWidget(source, widget("w-2"));
    expect(ids(source)).toEqual(["w-1"]);
  });

  it("zwraca nowy obiekt układu i nową tablicę widgetów", () => {
    const source = layoutOf([widget("w-1")]);
    const out = addWidget(source, widget("w-2"));
    expect(out).not.toBe(source);
    expect(out.widgets).not.toBe(source.widgets);
  });

  it("zachowuje metadane układu (nazwa, najemca, flaga domyślności)", () => {
    const out = addWidget(layoutOf([], { name: "Wariant B", is_default: false }), widget("w-1"));
    expect(out.name).toBe("Wariant B");
    expect(out.tenant_id).toBe("tenant-1");
    expect(out.is_default).toBe(false);
  });
});

describe("moveWidget", () => {
  const three = () => layoutOf([widget("a"), widget("b"), widget("c")]);

  it("przesuwa w GÓRĘ ze środka", () => {
    expect(ids(moveWidget(three(), "b", -1))).toEqual(["b", "a", "c"]);
  });

  it("przesuwa w DÓŁ ze środka", () => {
    expect(ids(moveWidget(three(), "b", 1))).toEqual(["a", "c", "b"]);
  });

  it("przesuwa w GÓRĘ z ostatniej pozycji", () => {
    expect(ids(moveWidget(three(), "c", -1))).toEqual(["a", "c", "b"]);
  });

  it("przesuwa w DÓŁ z pierwszej pozycji", () => {
    expect(ids(moveWidget(three(), "a", 1))).toEqual(["b", "a", "c"]);
  });

  it("w GÓRĘ z pozycji 0 to no-op - zwraca układ REFERENCYJNIE", () => {
    const source = three();
    expect(moveWidget(source, "a", -1)).toBe(source);
  });

  it("w DÓŁ z ostatniej pozycji to no-op - zwraca układ REFERENCYJNIE", () => {
    const source = three();
    expect(moveWidget(source, "c", 1)).toBe(source);
  });

  it.each([-1, 1] as const)("id NIEISTNIEJĄCE to no-op (kierunek %i), nie wyjątek", (dir) => {
    const source = three();
    expect(moveWidget(source, "nie-ma", dir)).toBe(source);
  });

  it.each([-1, 1] as const)("układ z JEDNYM widgetem nie daje się przesunąć (%i)", (dir) => {
    const source = layoutOf([widget("a")]);
    expect(moveWidget(source, "a", dir)).toBe(source);
  });

  it.each([-1, 1] as const)("układ PUSTY to no-op (%i)", (dir) => {
    const source = layoutOf([]);
    expect(moveWidget(source, "a", dir)).toBe(source);
  });

  it("dwa przesunięcia w przeciwne strony wracają do stanu wyjściowego", () => {
    const once = moveWidget(three(), "b", 1);
    expect(ids(moveWidget(once, "b", -1))).toEqual(["a", "b", "c"]);
  });

  it("NIE mutuje układu źródłowego przy realnym ruchu", () => {
    const source = three();
    moveWidget(source, "b", 1);
    expect(ids(source)).toEqual(["a", "b", "c"]);
  });

  it("zachowuje ustawienia przesuwanych widgetów", () => {
    const source = layoutOf([
      { ...widget("a"), settings: { x: 1 } },
      { ...widget("b"), settings: { y: 2 } },
    ]);
    const out = moveWidget(source, "a", 1);
    expect(out.widgets.map((w) => w.settings)).toEqual([{ y: 2 }, { x: 1 }]);
  });
});

describe("deleteWidget", () => {
  it("usuwa widget istniejący", () => {
    expect(ids(deleteWidget(layoutOf([widget("a"), widget("b")]), "a"))).toEqual(["b"]);
  });

  it("usuwa OSTATNI widget, zostawiając pustą tablicę", () => {
    expect(ids(deleteWidget(layoutOf([widget("a")]), "a"))).toEqual([]);
  });

  it("id NIEISTNIEJĄCE to no-op, nie wyjątek - zwraca układ referencyjnie", () => {
    const source = layoutOf([widget("a")]);
    expect(deleteWidget(source, "nie-ma")).toBe(source);
  });

  it("układ PUSTY to no-op", () => {
    const source = layoutOf([]);
    expect(deleteWidget(source, "a")).toBe(source);
  });

  it("NIE mutuje układu źródłowego", () => {
    const source = layoutOf([widget("a"), widget("b")]);
    deleteWidget(source, "a");
    expect(ids(source)).toEqual(["a", "b"]);
  });

  it("usuwa TYLKO wskazany widget, gdy typy się powtarzają", () => {
    const source = layoutOf([widget("a", "tags"), widget("b", "tags"), widget("c", "tags")]);
    expect(ids(deleteWidget(source, "b"))).toEqual(["a", "c"]);
  });
});

describe("toggleHidden", () => {
  it("ukrywa widget widoczny", () => {
    const out = toggleHidden(layoutOf([widget("a")]), "a");
    expect(out.widgets[0].hidden).toBe(true);
  });

  it("odkrywa widget ukryty", () => {
    const source = layoutOf([{ ...widget("a"), hidden: true }]);
    expect(toggleHidden(source, "a").widgets[0].hidden).toBe(false);
  });

  it("widget BEZ pola hidden traktuje jak widoczny", () => {
    const source = layoutOf([{ id: "a", type: "tags", settings: {} }]);
    expect(toggleHidden(source, "a").widgets[0].hidden).toBe(true);
  });

  it("PODWÓJNE przełączenie wraca do stanu wyjściowego (idempotencja)", () => {
    const source = layoutOf([widget("a")]);
    const twice = toggleHidden(toggleHidden(source, "a"), "a");
    expect(twice.widgets[0].hidden).toBe(false);
    expect(twice).toEqual(source);
  });

  it("id NIEISTNIEJĄCE to no-op - zwraca układ referencyjnie", () => {
    const source = layoutOf([widget("a")]);
    expect(toggleHidden(source, "nie-ma")).toBe(source);
  });

  it("nie rusza POZOSTAŁYCH widgetów", () => {
    const source = layoutOf([widget("a"), { ...widget("b"), hidden: true }]);
    const out = toggleHidden(source, "a");
    expect(out.widgets.map((w) => w.hidden)).toEqual([true, true]);
  });

  it("zachowuje ustawienia przełączanego widgetu", () => {
    const source = layoutOf([{ ...widget("a"), settings: { showToc: false } }]);
    expect(toggleHidden(source, "a").widgets[0].settings).toEqual({ showToc: false });
  });

  it("NIE mutuje układu źródłowego", () => {
    const source = layoutOf([widget("a")]);
    toggleHidden(source, "a");
    expect(source.widgets[0].hidden).toBe(false);
  });
});

describe("updateWidgetSettings - patch częściowy", () => {
  const panel = (): SidebarLayout =>
    layoutOf([
      {
        id: "rp",
        type: "reading-panel",
        hidden: false,
        settings: { ...DEFAULT_READING_PANEL_SETTINGS },
      },
    ]);

  it("patch JEDNEGO pola nie gubi pól nietkniętych", () => {
    const out = updateWidgetSettings(panel(), "rp", { showToc: false });
    expect(out.widgets[0].settings).toEqual({
      ...DEFAULT_READING_PANEL_SETTINGS,
      showToc: false,
    });
  });

  it.each(["showToc", "showProgress", "showSaveLater", "showPrint", "showPdf"])(
    "patch pola %s zmienia TYLKO je",
    (key) => {
      const out = updateWidgetSettings(panel(), "rp", { [key]: false });
      const settings = out.widgets[0].settings as Record<string, unknown>;
      expect(settings[key]).toBe(false);
      const others = Object.keys(DEFAULT_READING_PANEL_SETTINGS).filter(
        (k) => k !== key && k !== "social",
      );
      for (const other of others) {
        expect(settings[other], `pole ${other} zostało zgubione`).toBe(true);
      }
    },
  );

  it("patch PUSTY nie zmienia niczego w treści ustawień", () => {
    const out = updateWidgetSettings(panel(), "rp", {});
    expect(out.widgets[0].settings).toEqual(DEFAULT_READING_PANEL_SETTINGS);
  });

  it("patch wartością fałszywą (false) faktycznie ją zapisuje", () => {
    const out = updateWidgetSettings(panel(), "rp", { showPdf: false });
    expect((out.widgets[0].settings as Record<string, unknown>).showPdf).toBe(false);
  });

  it("patch wartością 0 zapisuje 0, nie traktuje jej jako braku", () => {
    const out = updateWidgetSettings(layoutOf([widget("a")]), "a", { limit: 0 });
    expect(out.widgets[0].settings).toEqual({ limit: 0 });
  });

  it("patch wartością pustego stringa zapisuje pusty string", () => {
    const out = updateWidgetSettings(layoutOf([widget("a")]), "a", { slot: "" });
    expect(out.widgets[0].settings).toEqual({ slot: "" });
  });

  it("patch wartością null zapisuje null", () => {
    const out = updateWidgetSettings(layoutOf([widget("a")]), "a", { slot: null });
    expect(out.widgets[0].settings).toEqual({ slot: null });
  });

  it("dokłada klucz, którego wcześniej nie było", () => {
    const out = updateWidgetSettings(layoutOf([widget("a")]), "a", { nowy: "x" });
    expect(out.widgets[0].settings).toEqual({ nowy: "x" });
  });

  it("dwa kolejne patche NAWARSTWIAJĄ się, nie nadpisują wzajemnie", () => {
    const once = updateWidgetSettings(layoutOf([widget("a")]), "a", { x: 1 });
    const twice = updateWidgetSettings(once, "a", { y: 2 });
    expect(twice.widgets[0].settings).toEqual({ x: 1, y: 2 });
  });

  it("id NIEISTNIEJĄCE to no-op - zwraca układ referencyjnie", () => {
    const source = layoutOf([widget("a")]);
    expect(updateWidgetSettings(source, "nie-ma", { x: 1 })).toBe(source);
  });

  it("nie rusza ustawień POZOSTAŁYCH widgetów", () => {
    const source = layoutOf([
      { ...widget("a"), settings: { x: 1 } },
      { ...widget("b"), settings: { y: 2 } },
    ]);
    const out = updateWidgetSettings(source, "a", { x: 9 });
    expect(out.widgets[1].settings).toEqual({ y: 2 });
  });

  it("NIE mutuje ustawień źródłowych", () => {
    const source = layoutOf([{ ...widget("a"), settings: { x: 1 } }]);
    updateWidgetSettings(source, "a", { x: 9 });
    expect(source.widgets[0].settings).toEqual({ x: 1 });
  });

  it("zachowuje typ i widoczność widgetu", () => {
    const source = layoutOf([{ ...widget("a", "ad-slot"), hidden: true }]);
    const out = updateWidgetSettings(source, "a", { slot: "top" });
    expect(out.widgets[0].type).toBe("ad-slot");
    expect(out.widgets[0].hidden).toBe(true);
  });
});

describe("resolveReadingPanelSettings", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["pusty obiekt", {}],
  ])("%s daje pełne ustawienia domyślne", (_l, input) => {
    expect(resolveReadingPanelSettings(input)).toEqual(DEFAULT_READING_PANEL_SETTINGS);
  });

  it("nadpisuje tylko podane przełączniki funkcji", () => {
    const out = resolveReadingPanelSettings({ showToc: false });
    expect(out.showToc).toBe(false);
    expect(out.showProgress).toBe(true);
    expect(out.showPdf).toBe(true);
  });

  it("SCALA mapę social DWUPOZIOMOWO - patch z jednym kluczem nie kasuje reszty", () => {
    // To jest ten błąd, którego szukamy: pojedynczy spread zostawiłby
    // `social` z JEDNYM kluczem i siedem przycisków udostępniania zniknęłoby.
    const out = resolveReadingPanelSettings({ social: { x: false } });
    expect(out.social.x).toBe(false);
    expect(Object.keys(out.social).sort()).toEqual([...SOCIAL_KEYS].sort());
    expect(out.social.facebook).toBe(true);
    expect(out.social.linkedin).toBe(true);
  });

  it("brak klucza social zostawia pełną mapę domyślną", () => {
    const out = resolveReadingPanelSettings({ showToc: false });
    expect(out.social).toEqual(DEFAULT_READING_PANEL_SETTINGS.social);
  });

  it("social równe null nie wysypuje scalania", () => {
    expect(resolveReadingPanelSettings({ social: null }).social).toEqual(
      DEFAULT_READING_PANEL_SETTINGS.social,
    );
  });

  it.each([...SOCIAL_KEYS])("wyłączenie kanału %s nie rusza pozostałych", (key) => {
    const out = resolveReadingPanelSettings({ social: { [key]: false } });
    expect(out.social[key]).toBe(false);
    for (const other of SOCIAL_KEYS.filter((k) => k !== key)) {
      expect(out.social[other], `kanał ${other} zmienił wartość`).toBe(
        DEFAULT_READING_PANEL_SETTINGS.social[other],
      );
    }
  });

  it("zwraca NOWY obiekt (mapa social nie jest współdzielona z domyślną)", () => {
    const out = resolveReadingPanelSettings({});
    expect(out).not.toBe(DEFAULT_READING_PANEL_SETTINGS);
    expect(out.social).not.toBe(DEFAULT_READING_PANEL_SETTINGS.social);
  });
});

describe("selectionAfterDelete", () => {
  it("usunięcie ZAZNACZONEGO widgetu czyści zaznaczenie", () => {
    expect(selectionAfterDelete("a", "a")).toBeNull();
  });

  it("usunięcie INNEGO widgetu zostawia zaznaczenie", () => {
    expect(selectionAfterDelete("a", "b")).toBe("a");
  });

  it("brak zaznaczenia zostaje brakiem zaznaczenia", () => {
    expect(selectionAfterDelete(null, "a")).toBeNull();
  });
});
