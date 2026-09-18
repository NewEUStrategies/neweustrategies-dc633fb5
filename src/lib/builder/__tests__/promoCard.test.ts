// Model widgetu „Karta promocyjna": rekomendacja rozmiaru okładki, adres CTA
// i parytet wartości domyślnych między modelem, rejestrem i schematem.
//
// Rekomendacja rozmiaru jest tu jedyną arytmetyką, która potrafi po cichu
// skłamać (skala ekranu, granice, proporcja kadru), a adres CTA jedyną regułą
// pierwszeństwa - obie dostają więc osobne przypadki zamiast jednego
// „happy path". Reszta to bramka parytetu: liczba wpisana w trzech miejscach
// przestaje być jedną liczbą przy pierwszej edycji, jeśli nikt jej nie pilnuje.
import { describe, expect, it } from "vitest";
import {
  PROMO_CARD_DEFAULTS,
  PROMO_CARD_FULL_WIDTH,
  PROMO_CARD_RATIOS,
  promoCardAspect,
  promoCardCtaHref,
  promoCardCtaLabel,
  promoCardImageSize,
  promoCardRatio,
} from "../promoCard";
import { WIDGETS } from "../registry";
import { widgetQueryOptionsList } from "../prefetch";
import { eventByIdQueryOptions } from "../eventsQuery";
import { WIDGET_SCHEMAS } from "../schemas";

describe("promoCardRatio", () => {
  it("przepuszcza każdą znaną proporcję", () => {
    for (const ratio of PROMO_CARD_RATIOS) expect(promoCardRatio(ratio)).toBe(ratio);
  });

  it("sprowadza śmieciowe wejście do wartości domyślnej", () => {
    expect(promoCardRatio("16/9")).toBe(PROMO_CARD_DEFAULTS.ratio);
    expect(promoCardRatio(undefined)).toBe(PROMO_CARD_DEFAULTS.ratio);
    expect(promoCardRatio(42)).toBe(PROMO_CARD_DEFAULTS.ratio);
  });
});

describe("promoCardAspect", () => {
  it("daje wartość gotową dla CSS `aspect-ratio`", () => {
    expect(promoCardAspect("16:9")).toBe("16 / 9");
    expect(promoCardAspect("1:1")).toBe("1 / 1");
  });

  it("kadr o stałej wysokości nie ma proporcji", () => {
    expect(promoCardAspect("auto")).toBeNull();
  });
});

describe("promoCardImageSize - rekomendacja przy wgrywaniu", () => {
  it("liczy dwukrotność szerokości renderu (ekrany o podwójnej gęstości)", () => {
    expect(promoCardImageSize("16:9", 512).width).toBe(1000);
  });

  it("wysokość wynika z WYBRANEJ proporcji, nie z wartości domyślnej", () => {
    expect(promoCardImageSize("16:9", 512).height).toBe(563);
    expect(promoCardImageSize("1:1", 512).height).toBe(1000);
    expect(promoCardImageSize("3:4", 512).height).toBe(1333);
  });

  it("karta bez limitu szerokości liczy się od szerokości kolumny treści", () => {
    const full = promoCardImageSize("16:9", 0);
    // 1200 × 2 = 2400, czyli górna granica - i tak ma zostać: prosimy o plik,
    // który wystarczy na najszerszy układ, bo zmniejszyć obraz da się bez straty.
    expect(full.width).toBe(Math.min(2400, PROMO_CARD_FULL_WIDTH * 2));
  });

  it("nie schodzi poniżej sensownego minimum ani powyżej maksimum", () => {
    expect(promoCardImageSize("16:9", 120).width).toBe(800);
    expect(promoCardImageSize("16:9", 1600).width).toBe(2400);
  });

  it("kadr o stałej wysokości liczy wysokość z pola, nie z proporcji", () => {
    expect(promoCardImageSize("auto", 512, 300).height).toBe(600);
  });
});

describe("promoCardCtaHref", () => {
  it("tryb ręczny prowadzi pod wpisany adres", () => {
    expect(promoCardCtaHref("link", "https://nes.eu/raport", "")).toBe("https://nes.eu/raport");
  });

  it("tryb wydarzenia buduje adres strony wydarzenia", () => {
    expect(promoCardCtaHref("event", "", "forum-2026")).toBe("/events/forum-2026");
  });

  it("wpisany adres ma pierwszeństwo także w trybie wydarzenia", () => {
    expect(promoCardCtaHref("event", "https://rejestracja.example/x", "forum-2026")).toBe(
      "https://rejestracja.example/x",
    );
  });

  it("brak adresu i brak wydarzenia = brak przycisku (nie `#`)", () => {
    expect(promoCardCtaHref("link", "   ", "")).toBe("");
    expect(promoCardCtaHref("event", "", "  ")).toBe("");
  });
});

describe("promoCardCtaLabel", () => {
  it("mówi w języku widoku i różnicuje tryby", () => {
    expect(promoCardCtaLabel("event", "pl")).toBe("Zobacz wydarzenie");
    expect(promoCardCtaLabel("event", "en")).toBe("View event");
    expect(promoCardCtaLabel("link", "pl")).not.toBe(promoCardCtaLabel("event", "pl"));
  });
});

describe("parytet wartości domyślnych", () => {
  const registryDefaults = () => {
    const entry = WIDGETS.find((w) => w.type === "promo-card");
    if (!entry) throw new Error("brak widgetu promo-card w rejestrze");
    return entry.defaults();
  };

  it("rejestr wstawia kartę bez zmyślonej treści", () => {
    const d = registryDefaults();
    expect(d.title_pl).toBe("");
    expect(d.title_en).toBe("");
    expect(d.subtitle_pl).toBe("");
    expect(d.image).toBe("");
    expect(d.href).toBe("");
    expect(d.eventId).toBe("");
  });

  it("rejestr i model mówią o tych samych wartościach", () => {
    const d = registryDefaults();
    for (const [key, value] of Object.entries(PROMO_CARD_DEFAULTS)) {
      expect(d[key], `rejestr: ${key}`).toBe(value);
    }
  });

  it("schemat powtarza liczby modelu wszędzie, gdzie deklaruje `default`", () => {
    const schema = WIDGET_SCHEMAS["promo-card"] ?? [];
    const declared = (key: string) => schema.find((f) => f.key === key && "default" in f)?.default;
    for (const key of ["heightPx", "maxWidth", "radius", "overlayAlphaTop", "overlayAlphaBottom"]) {
      const model = PROMO_CARD_DEFAULTS[key as keyof typeof PROMO_CARD_DEFAULTS];
      expect(declared(key), `schemat: ${key}`).toBe(model);
    }
  });

  it("każdy klucz treści ma swoją kontrolkę w panelu", () => {
    const schemaKeys = new Set((WIDGET_SCHEMAS["promo-card"] ?? []).map((f) => f.key));
    for (const key of Object.keys(registryDefaults())) {
      const base = key.replace(/_(pl|en)$/, "");
      expect(schemaKeys.has(base), `brak kontrolki dla ${base}`).toBe(true);
    }
  });

  it("rekomendacja rozmiaru okładki jest podpięta pod pole obrazu", () => {
    const field = (WIDGET_SCHEMAS["promo-card"] ?? []).find((f) => f.key === "image");
    // Zmiana kadru MUSI zmieniać rekomendację - inaczej podpowiedź kłamie
    // dokładnie wtedy, gdy redakcja najbardziej jej potrzebuje.
    expect(field?.recommendedSize?.({ ratio: "16:9", maxWidth: 512 })).toEqual(
      promoCardImageSize("16:9", 512),
    );
    expect(field?.recommendedSize?.({ ratio: "1:1", maxWidth: 512 })?.height).toBe(1000);
  });

  it("żaden wariant reakcji na kursor nie obiecuje przesunięcia karty", () => {
    const hover = (WIDGET_SCHEMAS["promo-card"] ?? []).find((f) => f.key === "hover");
    const values = (hover?.options ?? []).map((o) => o.value);
    // Bramka intencji: nazwy „lift" / „tilt" / „slide" wróciłyby razem z
    // `transform` na karcie, czyli z defektem, przez który ten widget powstał.
    for (const forbidden of ["lift", "tilt", "slide", "move", "rotate"]) {
      expect(
        values.some((v) => v.includes(forbidden)),
        `wariant ${forbidden}`,
      ).toBe(false);
    }
  });
});

// ── Prefetch SSR ─────────────────────────────────────────────────────────────
// Nagłówek widoku obiecuje, że serwer grzeje TO SAMO zapytanie, które widok
// czyta po hydratacji. Obietnica bez bramki zestarzeje się przy pierwszym
// refaktorze rejestru, więc stoi tu jako test - razem z kierunkiem odwrotnym
// (karta z ręcznym adresem NIE MA prawa kosztować zapytania).
describe("prefetch SSR karty promocyjnej", () => {
  const widget = (content: Record<string, unknown>) =>
    ({
      kind: "widget",
      id: "w-promo",
      type: "promo-card",
      content,
      style: {},
      advanced: {},
    }) as unknown as Parameters<typeof widgetQueryOptionsList>[0];

  it("tryb wydarzenia grzeje wydarzenie po id", () => {
    const keys = widgetQueryOptionsList(widget({ mode: "event", eventId: "ev-1" }), "pl").map(
      (o) => o.queryKey,
    );
    expect(keys).toContainEqual(eventByIdQueryOptions("ev-1").queryKey);
  });

  it("tryb ręcznego adresu nie wysyła żadnego zapytania", () => {
    expect(widgetQueryOptionsList(widget({ mode: "link", href: "/raport" }), "pl")).toEqual([]);
  });

  it("wybrany tryb wydarzenia BEZ wydarzenia też nie wysyła zapytania", () => {
    expect(widgetQueryOptionsList(widget({ mode: "event", eventId: "" }), "pl")).toEqual([]);
  });
});
