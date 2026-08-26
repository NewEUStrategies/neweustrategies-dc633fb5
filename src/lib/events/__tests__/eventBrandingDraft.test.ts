// Testy brandingu jednego wydarzenia.
//
// CALA MECHANIKA TEGO EKRANU TO „KLUCZ NIEOBECNY = DZIEDZICZENIE". Slot pusty
// nie znaczy „bialy", tylko „wez z motywu serwisu" - i to jest jedyny powod,
// dla ktorego zapisany branding sprzed roku nadal wyglada jak dzisiejsza marka.
// Regula zyje w dwoch funkcjach naraz (`eventBrandingFromJson` degraduje smiec
// do pustego slotu, `eventBrandingPayload` pustego slotu NIE zapisuje), wiec
// testujemy obie strony razem.
import { describe, expect, it } from "vitest";
import {
  EMPTY_EVENT_BRANDING,
  EVENT_BRANDING_COLOR_SLOTS,
  eventBrandingDirty,
  eventBrandingFromJson,
  eventBrandingPayload,
  validateEventBranding,
  type EventBrandingDraft,
} from "@/lib/events/eventBrandingDraft";

function branding(patch: Partial<EventBrandingDraft> = {}): EventBrandingDraft {
  return {
    appearance: "light",
    colors: { ...EMPTY_EVENT_BRANDING.colors },
    backgroundImage: "",
    ...patch,
  };
}

describe("odczyt brandingu z kolumny jsonb", () => {
  it("wartosc, ktora nie jest obiektem, degraduje do pustego brandingu zamiast rzucac", () => {
    for (const value of [null, undefined, [], ["#FF8800"], "tekst", 42, true]) {
      expect(eventBrandingFromJson(value)).toEqual(EMPTY_EVENT_BRANDING);
    }
  });

  it("pusty branding jest KOPIA, a nie wspoldzielonym obiektem stalej", () => {
    // Inaczej edycja jednego wydarzenia przestawialaby domyslne kolory
    // wszystkich pozostalych w tej samej sesji przegladarki.
    const first = eventBrandingFromJson(null);
    first.colors.navigation = "#FF8800";
    expect(EMPTY_EVENT_BRANDING.colors.navigation).toBe("");
    expect(eventBrandingFromJson(null).colors.navigation).toBe("");
  });

  it("kolor spoza wzorca #RRGGBB degraduje do slotu dziedziczonego", () => {
    const draft = eventBrandingFromJson({
      navigation: "#FFF",
      main_action: "red",
      text: "#GGGGGG",
      blocks_background: "FF8800",
      page_background: 42,
    });
    expect(draft.colors).toEqual(EMPTY_EVENT_BRANDING.colors);
  });

  it("kolor zapisany malymi literami normalizuje sie do wielkich", () => {
    const draft = eventBrandingFromJson({ navigation: "  #ff8800  ", text: "#0a0B0c" });
    expect(draft.colors.navigation).toBe("#FF8800");
    expect(draft.colors.text).toBe("#0A0B0C");
  });

  it("nieznany tryb wygladu wraca do `light`", () => {
    expect(eventBrandingFromJson({ appearance: "neon" }).appearance).toBe("light");
    expect(eventBrandingFromJson({ appearance: 1 }).appearance).toBe("light");
    expect(eventBrandingFromJson({}).appearance).toBe("light");
    expect(eventBrandingFromJson({ appearance: "dark" }).appearance).toBe("dark");
  });

  it("obraz tla obcina biale znaki, a wartosc nietekstowa daje pusty napis", () => {
    expect(eventBrandingFromJson({ background_image: "  https://e.org/t.jpg " }).backgroundImage) //
      .toBe("https://e.org/t.jpg");
    expect(eventBrandingFromJson({ background_image: 7 }).backgroundImage).toBe("");
  });

  it("czyta tylko znane sloty i ignoruje klucze nadmiarowe", () => {
    const draft = eventBrandingFromJson({ navigation: "#112233", accent: "#445566" });
    expect(Object.keys(draft.colors).sort()).toEqual([...EVENT_BRANDING_COLOR_SLOTS].sort());
    expect(draft.colors.navigation).toBe("#112233");
  });
});

describe("ladunek zapisu brandingu", () => {
  it("slot pusty NIE trafia do obiektu - to jest cale dziedziczenie", () => {
    // Zapisany klucz z wartoscia domyslna zamrozilby wyglad wydarzenia na
    // dzisiejszej wersji marki; brak klucza pozwala mu isc za motywem serwisu.
    const payload = eventBrandingPayload(branding({ colors: { ...EMPTY_EVENT_BRANDING.colors } }));
    expect(Object.keys(payload)).toEqual(["appearance"]);
    for (const slot of EVENT_BRANDING_COLOR_SLOTS) {
      expect(payload).not.toHaveProperty(slot);
    }
  });

  it("tryb wygladu jest ZAWSZE - on nie podlega dziedziczeniu", () => {
    expect(eventBrandingPayload(branding())["appearance"]).toBe("light");
    expect(eventBrandingPayload(branding({ appearance: "dark" }))["appearance"]).toBe("dark");
  });

  it("wpisany slot wchodzi wielkimi literami i bez bialych znakow", () => {
    const payload = eventBrandingPayload(
      branding({
        colors: { ...EMPTY_EVENT_BRANDING.colors, navigation: " #ff8800 ", text: "#0a0b0c" },
      }),
    );
    expect(payload).toEqual({ appearance: "light", navigation: "#FF8800", text: "#0A0B0C" });
  });

  it("obraz tla wchodzi tylko wtedy, gdy jest niepusty", () => {
    expect(eventBrandingPayload(branding({ backgroundImage: "   " }))).not.toHaveProperty(
      "background_image",
    );
    expect(
      eventBrandingPayload(branding({ backgroundImage: " https://e.org/t.jpg " }))[
        "background_image"
      ],
    ).toBe("https://e.org/t.jpg");
  });
});

describe("walidacja brandingu", () => {
  it("odrzuca kolor spoza #RRGGBB i wskazuje WLASCIWY slot", () => {
    const errors = validateEventBranding(
      branding({ colors: { ...EMPTY_EVENT_BRANDING.colors, main_action: "#FF88" } }),
    );
    expect(errors.map((error) => error.slot)).toEqual(["main_action"]);
    expect(errors[0]?.messageKey).toBe("adminEvents.branding.errors.colorInvalid");
  });

  it("slot pusty nie jest bledem - to zadanie dziedziczenia", () => {
    expect(validateEventBranding(branding())).toEqual([]);
  });

  it("przyjmuje obraz tla po https, a odrzuca po http", () => {
    expect(validateEventBranding(branding({ backgroundImage: "https://e.org/t.jpg" }))).toEqual([]);
    const errors = validateEventBranding(branding({ backgroundImage: "http://e.org/t.jpg" }));
    expect(errors.map((error) => error.slot)).toEqual(["backgroundImage"]);
    expect(errors[0]?.messageKey).toBe("adminEvents.branding.errors.imageInvalid");
  });

  it("odrzuca obraz tla, ktory nie jest adresem", () => {
    expect(
      validateEventBranding(branding({ backgroundImage: "tlo.jpg" })).map((error) => error.slot),
    ).toEqual(["backgroundImage"]);
  });

  it("zbiera bledy ze wszystkich slotow naraz", () => {
    const errors = validateEventBranding(
      branding({
        colors: { ...EMPTY_EVENT_BRANDING.colors, navigation: "red", text: "#12345" },
        backgroundImage: "http://e.org/t.jpg",
      }),
    );
    expect(errors.map((error) => error.slot)).toEqual(["navigation", "text", "backgroundImage"]);
  });
});

describe("wykrycie zmian brandingu", () => {
  it("roznica wylacznie w zapisie koloru NIE jest zmiana", () => {
    const a = branding({ colors: { ...EMPTY_EVENT_BRANDING.colors, navigation: "#ff8800" } });
    const b = branding({ colors: { ...EMPTY_EVENT_BRANDING.colors, navigation: " #FF8800 " } });
    expect(eventBrandingDirty(a, b)).toBe(false);
  });

  it("zdjecie koloru ze slotu jest zmiana, bo zmienia sie zbior kluczy", () => {
    const a = branding({ colors: { ...EMPTY_EVENT_BRANDING.colors, navigation: "#FF8800" } });
    expect(eventBrandingDirty(a, branding())).toBe(true);
  });

  it("zmiana trybu wygladu i obrazu tla jest zmiana", () => {
    expect(eventBrandingDirty(branding(), branding({ appearance: "dark" }))).toBe(true);
    expect(
      eventBrandingDirty(branding(), branding({ backgroundImage: "https://e.org/t.jpg" })),
    ).toBe(true);
  });

  it("ten sam branding nie jest brudny wzgledem samego siebie", () => {
    expect(eventBrandingDirty(branding(), branding())).toBe(false);
  });
});
