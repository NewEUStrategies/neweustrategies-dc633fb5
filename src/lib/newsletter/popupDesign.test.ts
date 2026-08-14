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

  it("domyślnie: siatka referencyjna, paleta ciemna, link do logowania", () => {
    const d = defaultPopupDesign();
    expect(d.gallery.grid).toBe("reference");
    expect(d.colorScheme).toBe("dark");
    expect(d.form.showLoginLink).toBe(true);
  });

  it("scala zapisane klucze z defaultami (bez gubienia reszty grupy)", () => {
    const d = resolvePopupDesign({
      colorScheme: "auto",
      gallery: { grid: "mosaic", showArrow: false },
      form: { align: "left", hintPl: "Wypełnij dane" },
    });
    expect(d.colorScheme).toBe("auto");
    expect(d.gallery.grid).toBe("mosaic");
    expect(d.gallery.showArrow).toBe(false);
    expect(d.gallery.showCorners).toBe(true);
    expect(d.form.align).toBe("left");
    expect(d.form.hintPl).toBe("Wypełnij dane");
    expect(d.form.loginLinkPl).toBe(defaultPopupDesign().form.loginLinkPl);
  });

  it("nie ma już rejestracji społecznościowej ani separatora", () => {
    const d = resolvePopupDesign({
      form: { socialEnabled: true, socialPosition: "bottom", dividerPl: "albo" },
    });
    expect(d.form).toEqual(defaultPopupDesign().form);
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
      form: { loginLinkPl: "   ", loginLinkHref: "" },
      gallery: { captionPrefixPl: "", logoUrl: "" },
    });
    expect(d.form.loginLinkPl).toBe("Masz już konto? Zaloguj się");
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

  it("domyślny gradient galerii startuje z tła panelu, nie z akcentu", () => {
    const dark = resolvePopupPalette(source(), "dark");
    expect(dark.gradFrom).toBe("#0b0b0f");
    expect(dark.gradTo).toBe("color-mix(in srgb, #fa9346 14%, #0b0b0f)");
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

  it("przedefiniowuje tokeny platformy, żeby popup był hermetyczny", () => {
    // Bez tego pola dziedziczyły motyw adminu: reguła autouzupełniania Chrome
    // maluje pole `var(--background)`, a nagłówek brał `var(--foreground)`.
    const vars = popupPaletteVars(resolvePopupPalette(source(), "dark"), 6);
    expect(vars["--background"]).toBe("#0b0b0f");
    expect(vars["--foreground"]).toBe("#ffffff");
    expect(vars["--ring"]).toBe("#fa9346");
    expect(vars["--primary"]).toBe("#fa9346");
    expect(vars["--muted-foreground"]).toBe("#a8a8b3");
    expect(vars["--border"]).toContain("var" in vars ? "" : "color-mix");
  });

  it("atrament na akcencie przechodzi na czytelny, gdy kontrast < 3:1", () => {
    // Historyczne wiersze: biała czcionka na jasnym pomarańczu (~2.2:1).
    const bad = resolvePopupPalette(source({ popup_accent_text_color: "#ffffff" }), "dark");
    expect(bad.accentFg).toBe("#141414");
    // Poprawny zapis zostaje nietknięty.
    const good = resolvePopupPalette(source({ popup_accent_text_color: "#141414" }), "dark");
    expect(good.accentFg).toBe("#141414");
    const onDarkAccent = resolvePopupPalette(
      source({ popup_accent_color: "#1b3a6b", popup_accent_text_color: "#ffffff" }),
      "dark",
    );
    expect(onDarkAccent.accentFg).toBe("#ffffff");
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

describe("kolory kontrolek (checkboxy + CTA)", () => {
  it("bez nadpisań tokeny płyną z palety", () => {
    const vars = popupPaletteVars(resolvePopupPalette(source(), "dark"), 6);
    expect(vars["--nl-cb-checked"]).toBe("#fa9346");
    expect(vars["--nl-cb-label"]).toBe("#a8a8b3");
    expect(vars["--nl-btn-bg"]).toBe("#fa9346");
    expect(vars["--nl-btn-fg"]).toBe(resolvePopupPalette(source(), "dark").accentFg);
  });

  it("nadpisania z panelu wygrywają dla właściwej palety", () => {
    const design = defaultPopupDesign();
    design.controls.dark = {
      ...design.controls.dark,
      checkboxChecked: "#22c55e",
      buttonBg: "#123456",
      buttonHoverBg: "#0f2a44",
    };
    const s = source({ popup_design: design });
    const dark = popupPaletteVars(resolvePopupPalette(s, "dark"), 6);
    expect(dark["--nl-cb-checked"]).toBe("#22c55e");
    expect(dark["--nl-cb-hover"]).toBe("#22c55e");
    expect(dark["--nl-btn-bg"]).toBe("#123456");
    expect(dark["--nl-btn-hover-bg"]).toBe("#0f2a44");

    const light = popupPaletteVars(resolvePopupPalette(s, "light"), 6);
    expect(light["--nl-btn-bg"]).toBe(design.light.accent);
  });

  it("resolvePopupDesign przepuszcza tylko stringi w controls", () => {
    const d = resolvePopupDesign({
      controls: { dark: { buttonBg: 7, checkboxLink: "  #fff  " }, light: null },
    });
    expect(d.controls.dark.buttonBg).toBe("");
    expect(d.controls.dark.checkboxLink).toBe("#fff");
    expect(d.controls.light.buttonBg).toBe("");
  });
});

describe("ikona CTA", () => {
  it("domyślnie user-plus", () => {
    expect(defaultPopupDesign().form.ctaIcon).toBe("user-plus");
  });

  it("pusty zapis zostaje pusty (świadome „bez ikony”)", () => {
    expect(resolvePopupDesign({ form: { ctaIcon: "" } }).form.ctaIcon).toBe("");
  });

  it("przepuszcza tylko kebab-case", () => {
    expect(resolvePopupDesign({ form: { ctaIcon: "Arrow Right" } }).form.ctaIcon).toBe("");
    expect(resolvePopupDesign({ form: { ctaIcon: "arrow-right" } }).form.ctaIcon).toBe(
      "arrow-right",
    );
    expect(resolvePopupDesign({ form: { ctaIcon: 12 } }).form.ctaIcon).toBe("user-plus");
  });
});
