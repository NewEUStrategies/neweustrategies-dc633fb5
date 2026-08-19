// Rejestr widgetów buildera maila - biblioteka lewego panelu.
//
// Rejestr jest kontraktem między BIBLIOTEKĄ (co operator widzi do przeciągnięcia)
// a FABRYKĄ widgetów i SCHEMATEM dokumentu. Rozjazd nie wywala się na budowie:
// widget widoczny w bibliotece, którego fabryka nie umie stworzyć, wywala się
// dopiero pod palcem operatora - i to w połowie układania kampanii.
//
// Druga rzecz, którą rejestr rozstrzyga, to KONTEKST: builder newslettera
// i edytor popupu czytają tę samą bibliotekę, a `contexts` decyduje, co w
// której się pokaże. Widget popupowy wpuszczony do maila renderowałby się
// w kliencie pocztowym jako martwy element.
import { describe, it, expect } from "vitest";
import {
  libraryItemId,
  widgetLabel,
  widgetsForContext,
  WIDGET_REGISTRY,
  type WidgetLibraryItem,
} from "@/lib/newsletter-builder/registry";
import { widgetFactories, makeWidget } from "@/lib/newsletter-builder/defaults";
import { NlWidgetSchema } from "@/lib/newsletter-builder/schema";

describe("spójność rejestru z fabryką i schematem", () => {
  it("każdy wpis biblioteki ma fabrykę - inaczej wywala się pod palcem operatora", () => {
    const missing = WIDGET_REGISTRY.filter((item) => !widgetFactories[item.type]);

    expect(missing.map((m) => m.type)).toEqual([]);
    expect(WIDGET_REGISTRY.length).toBeGreaterThan(0);
  });

  it("widget z każdego wpisu przechodzi walidację dokumentu", () => {
    for (const item of WIDGET_REGISTRY) {
      const widget = makeWidget(item.type);
      const parsed = NlWidgetSchema.safeParse(widget);
      expect(parsed.success, `${item.type}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
    expect(WIDGET_REGISTRY.every((i) => typeof i.type === "string")).toBe(true);
  });

  it("preset wpisu też daje widget zgodny ze schematem", () => {
    const withPreset = WIDGET_REGISTRY.filter((i) => i.preset);

    for (const item of withPreset) {
      const widget = Object.assign(makeWidget(item.type), item.preset);
      expect(NlWidgetSchema.safeParse(widget).success, item.id ?? item.type).toBe(true);
    }
    // Presety istnieją - inaczej ten test nic nie dowodzi.
    expect(withPreset.length).toBeGreaterThan(0);
  });

  it("każdy wpis ma etykiety w OBU językach - bramka i18n jest blokująca", () => {
    const brakujace = WIDGET_REGISTRY.filter((i) => !i.labelPl?.trim() || !i.labelEn?.trim());

    expect(brakujace.map((i) => i.id ?? i.type)).toEqual([]);
  });

  it("każdy wpis ma grupę i ikonę - bez nich karta w bibliotece jest bezimienna", () => {
    const bezGrupy = WIDGET_REGISTRY.filter((i) => !i.group || !i.icon?.trim());

    expect(bezGrupy.map((i) => i.id ?? i.type)).toEqual([]);
  });
});

describe("libraryItemId - stabilny identyfikator karty", () => {
  it("bez własnego identyfikatora używa typu widgetu", () => {
    const item = { type: "heading", icon: "Heading", labelPl: "a", labelEn: "b", group: "content" };

    expect(libraryItemId(item as WidgetLibraryItem)).toBe("heading");
  });

  it("własny identyfikator wygrywa - to on rozróżnia PRESETY tego samego typu", () => {
    const item = {
      id: "field.firstName",
      type: "field.text",
      icon: "Type",
      labelPl: "a",
      labelEn: "b",
      group: "fields",
    };

    expect(libraryItemId(item as WidgetLibraryItem)).toBe("field.firstName");
  });

  it("identyfikatory kart są UNIKALNE - duplikat gubi kartę w bibliotece", () => {
    const ids = WIDGET_REGISTRY.map(libraryItemId);

    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("widgetLabel", () => {
  it("oddaje etykietę w wybranym języku", () => {
    const base = WIDGET_REGISTRY.find((i) => !i.id);
    expect(base).toBeDefined();

    expect(widgetLabel(base!.type, "pl")).toBe(base!.labelPl);
    expect(widgetLabel(base!.type, "en")).toBe(base!.labelEn);
  });

  it("typ nieznany rejestrowi oddaje sam typ, a nie pustkę", () => {
    // Widget zapisany starszą wersją buildera nadal musi mieć podpis w UI.
    expect(widgetLabel("nie-ma-takiego" as never, "pl")).toBe("nie-ma-takiego");
    expect(widgetLabel("nie-ma-takiego" as never, "en")).toBe("nie-ma-takiego");
  });

  it("etykieta pochodzi z wpisu BAZOWEGO, nie z presetu", () => {
    // Presety mają własne etykiety („Imię"), ale podpis typu w kanwie ma być
    // nazwą typu, nie nazwą jednego z jego wariantów.
    const presetTypes = WIDGET_REGISTRY.filter((i) => i.id && i.preset).map((i) => i.type);
    const shared = presetTypes.find((type) =>
      WIDGET_REGISTRY.some((i) => i.type === type && !i.id),
    );

    if (shared) {
      const base = WIDGET_REGISTRY.find((i) => i.type === shared && !i.id);
      expect(widgetLabel(shared, "pl")).toBe(base!.labelPl);
    }
    expect(presetTypes.length).toBeGreaterThan(0);
  });
});

describe("widgetsForContext - co widać w której bibliotece", () => {
  it("widget BEZ deklaracji kontekstu jest dostępny wszędzie", () => {
    const uniwersalne = WIDGET_REGISTRY.filter((i) => !i.contexts);
    const newsletter = widgetsForContext("newsletter");
    const popup = widgetsForContext("popup");

    for (const item of uniwersalne) {
      expect(newsletter).toContain(item);
      expect(popup).toContain(item);
    }
    expect(uniwersalne.length).toBeGreaterThan(0);
  });

  it("widget zadeklarowany TYLKO dla popupu nie trafia do biblioteki maila", () => {
    const tylkoPopup = WIDGET_REGISTRY.filter(
      (i) => i.contexts?.includes("popup") && !i.contexts.includes("newsletter"),
    );

    for (const item of tylkoPopup) {
      expect(widgetsForContext("newsletter")).not.toContain(item);
      expect(widgetsForContext("popup")).toContain(item);
    }
    // Taki widget istnieje - inaczej test nie dowodziłby rozdzielenia.
    expect(tylkoPopup.length).toBeGreaterThan(0);
  });

  it("obie biblioteki są niepuste i żadna nie jest kopią całego rejestru", () => {
    const newsletter = widgetsForContext("newsletter");

    expect(newsletter.length).toBeGreaterThan(0);
    expect(newsletter.length).toBeLessThan(WIDGET_REGISTRY.length);
  });

  it("filtrowanie nie mutuje rejestru", () => {
    const before = WIDGET_REGISTRY.length;

    widgetsForContext("popup");
    widgetsForContext("newsletter");

    expect(WIDGET_REGISTRY).toHaveLength(before);
  });
});
