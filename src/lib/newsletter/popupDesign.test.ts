import { describe, it, expect } from "vitest";
import {
  GALLERY_BLOCKS,
  colorLuminance,
  defaultPopupDesign,
  effectivePopupMode,
  galleryBackground,
  isDarkSurface,
  popupPaletteVars,
  resolveGalleryOrder,
  resolvePopupDesign,
  resolvePopupPalette,
  type PopupColorSource,
} from "@/lib/newsletter/popupDesign";

const source = (overrides: Partial<PopupColorSource> = {}): PopupColorSource => ({
  popup_bg_color: "#0b0b0f",
  popup_text_color: "#ffffff",
  popup_muted_color: "#a8a8b3",
  popup_accent_color: "#fa9346",
  popup_accent_text_color: "#141414",
  popup_overlay_color: "rgba(8,8,12,0.72)",
  popup_showcase_grad_from: null,
  popup_showcase_grad_to: null,
  popup_design: defaultPopupDesign(),
  ...overrides,
});

describe("resolvePopupDesign", () => {
  it("zwraca komplet defaultów dla pustej/śmieciowej wartości", () => {
    for (const raw of [null, undefined, 42, "x", []]) {
      const d = resolvePopupDesign(raw);
      expect(d).toEqual(defaultPopupDesign());
    }
  });

  it("zachowuje 6px rounding i platformowy styl etykiet jako domyślne", () => {
    const d = defaultPopupDesign();
    expect(d.form.labelStyle).toBe("floating");
    expect(d.gallery.grid).toBe("reference");
    expect(d.colorScheme).toBe("dark");
  });

  it("scala zapisane klucze z defaultami (bez gubienia reszty grupy)", () => {
    const d = resolvePopupDesign({
      colorScheme: "auto",
      gallery: { grid: "mosaic", showArrow: false },
      form: { labelStyle: "inline", dividerPl: "albo" },
    });
    expect(d.colorScheme).toBe("auto");
    expect(d.gallery.grid).toBe("mosaic");
    expect(d.gallery.showArrow).toBe(false);
    expect(d.gallery.showCorners).toBe(true);
    expect(d.form.labelStyle).toBe("inline");
    expect(d.form.dividerPl).toBe("albo");
    expect(d.form.dividerEn).toBe(defaultPopupDesign().form.dividerEn);
  });

  it("odrzuca wartości poza zakresem i nieznane enumy", () => {
    const d = resolvePopupDesign({
      colorScheme: "neon",
      panel: { maxWidthPx: 99999, shadow: -20, split: "diagonal" },
      gallery: { gradientAngle: 900, gapPx: 999, inactiveDim: 5000, logoHeightPx: 0 },
      form: { titleSizePx: 4, maxWidthPx: 10, align: "justify" },
    });
    expect(d.colorScheme).toBe("dark");
    expect(d.panel.maxWidthPx).toBe(1600);
    expect(d.panel.shadow).toBe(0);
    expect(d.panel.split).toBe("half");
    expect(d.gallery.gradientAngle).toBe(360);
    expect(d.gallery.gapPx).toBe(32);
    expect(d.gallery.inactiveDim).toBe(100);
    expect(d.gallery.logoHeightPx).toBe(12);
    expect(d.form.titleSizePx).toBe(18);
    expect(d.form.maxWidthPx).toBe(280);
    expect(d.form.align).toBe("center");
  });

  it("puste etykiety wracają do defaultu, ale puste prefiksy zostają puste", () => {
    const d = resolvePopupDesign({
      form: { dividerPl: "   ", loginLinkHref: "" },
      gallery: { captionPrefixPl: "", logoUrl: "" },
    });
    expect(d.form.dividerPl).toBe("lub");
    expect(d.form.loginLinkHref).toBe("/login");
    expect(d.gallery.captionPrefixPl).toBe("");
    expect(d.gallery.logoUrl).toBe("");
  });
});

describe("resolveGalleryOrder", () => {
  it("uzupełnia brakujące bloki w domyślnej kolejności", () => {
    expect(resolveGalleryOrder(["dots"])).toEqual([
      "dots",
      ...GALLERY_BLOCKS.filter((b) => b !== "dots"),
    ]);
  });

  it("usuwa duplikaty i nieznane id-ki", () => {
    expect(resolveGalleryOrder(["grid", "grid", "nope", 7, "brand"])).toEqual([
      "grid",
      "brand",
      "caption",
      "tagline",
      "dots",
    ]);
  });

  it("dla śmieci zwraca pełną domyślną kolejność", () => {
    expect(resolveGalleryOrder(null)).toEqual([...GALLERY_BLOCKS]);
  });
});

describe("paleta", () => {
  it("wariant ciemny czyta kolumny, jasny czyta popup_design.light", () => {
    const s = source();
    const dark = resolvePopupPalette(s, "dark");
    expect(dark.bg).toBe("#0b0b0f");
    expect(dark.accent).toBe("#fa9346");
    expect(dark.onDark).toBe(true);
    expect(dark.mode).toBe("dark");

    const light = resolvePopupPalette(s, "light");
    expect(light.bg).toBe("#ffffff");
    expect(light.onDark).toBe(false);
    expect(light.mode).toBe("light");
  });

  it("gradient dziedziczy akcent i tło, gdy kolumny są puste", () => {
    const dark = resolvePopupPalette(source(), "dark");
    expect(dark.gradFrom).toBe("#fa9346");
    expect(dark.gradTo).toBe("#0b0b0f");
  });

  it("jawne kolory gradientu wygrywają", () => {
    const dark = resolvePopupPalette(
      source({ popup_showcase_grad_from: "#123456", popup_showcase_grad_to: "#654321" }),
      "dark",
    );
    expect(galleryBackground(dark, 160)).toBe("linear-gradient(160deg, #123456 0%, #654321 78%)");
  });

  it("onDark wynika z luminancji tła, nie z nazwy wariantu", () => {
    const s = source({ popup_bg_color: "#fafafa" });
    expect(resolvePopupPalette(s, "dark").onDark).toBe(false);
  });

  it("eksponuje tokeny --nl-* razem z promieniem", () => {
    const vars = popupPaletteVars(resolvePopupPalette(source(), "dark"), 6);
    expect(vars["--nl-bg"]).toBe("#0b0b0f");
    expect(vars["--nl-radius"]).toBe("6px");
    expect(vars["--brand"]).toBe("#fa9346");
    expect(vars["--brand-foreground"]).toBe("#141414");
  });
});

describe("effectivePopupMode", () => {
  it("auto podąża za motywem strony, jawny wybór go ignoruje", () => {
    const design = defaultPopupDesign();
    expect(effectivePopupMode({ ...design, colorScheme: "auto" }, "light")).toBe("light");
    expect(effectivePopupMode({ ...design, colorScheme: "auto" }, "dark")).toBe("dark");
    expect(effectivePopupMode({ ...design, colorScheme: "light" }, "dark")).toBe("light");
    expect(effectivePopupMode({ ...design, colorScheme: "dark" }, "light")).toBe("dark");
  });
});

describe("colorLuminance / isDarkSurface", () => {
  it("liczy luminancję dla #rgb, #rrggbb i rgb()", () => {
    expect(colorLuminance("#000000")).toBe(0);
    expect(colorLuminance("#ffffff")).toBe(1);
    expect(colorLuminance("#fff")).toBe(1);
    expect(colorLuminance("rgb(255, 255, 255)")).toBe(1);
    expect(colorLuminance("rgba(0,0,0,0.5)")).toBe(0);
  });

  it("nieznany format nie wysadza wyliczeń - traktujemy jak ciemne tło", () => {
    expect(colorLuminance("var(--whatever)")).toBeNull();
    expect(isDarkSurface("var(--whatever)")).toBe(true);
  });

  it("rozpoznaje jasne i ciemne powierzchnie", () => {
    expect(isDarkSurface("#0b0b0f")).toBe(true);
    expect(isDarkSurface("#ffffff")).toBe(false);
  });
});
