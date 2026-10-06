// Szablon typografii HW-2 (P2.4): tokeny `data-wt` i zmienne `--wt-*` liczone
// z typografii widgetu oraz podgląd na żywo w `<head>`.
//
// CO TEN PLIK DOWODZI (kontrakty z werdyktu html-weight:HW-2):
//  1. Każdy token niesie wszystkie trzy urządzenia - przełączenie urządzenia
//     nie zmienia danych ramki, a zagnieżdżony widget nie dziedziczy wartości
//     urządzenia od przodka.
//  2. Rozmiar ogólny (`fs`) zawsze idzie z tytułowym (`tfs`) o tej samej
//     wartości - reguły tytułu żyją wyłącznie w szablonie `tfs`.
//  3. Biała lista: wartość, której przeglądarka nie przyjmie bez zmian, kieruje
//     całą grupę rozmiarów do generatora (przez `var()` dałaby `unset`).
//  4. Właściwości spoza szablonu (krój, grubość, ...) zawsze idą generatorem.
//  5. Podgląd na żywo: reguła per identyfikator w `<head>` na zmiennych,
//     usuwana razem z typografią.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  broadcastWidgetTypography,
  buildLiveTypographyVarsCss,
  clearAllLiveWidgetTypography,
  subscribeWidgetTypography,
  widgetTypographyTemplate,
} from "../liveTypography";

afterEach(() => {
  clearAllLiveWidgetTypography();
  sessionStorage.clear();
});

describe("widgetTypographyTemplate - tokeny i zmienne", () => {
  it("bez typografii nie emituje niczego", () => {
    expect(widgetTypographyTemplate(undefined)).toEqual({
      tokens: undefined,
      vars: undefined,
      legacyFontSize: false,
      legacy: false,
    });
    expect(widgetTypographyTemplate({}).tokens).toBeUndefined();
  });

  it("rozmiar ogólny daje `fs tfs` z wartościami wszystkich urządzeń", () => {
    const t = widgetTypographyTemplate({ fontSize: { desktop: "22px", mobile: "16px" } });
    expect(t.tokens).toBe("fs tfs");
    expect(t.vars).toEqual({
      "--wt-fs-d": "22px",
      // Tablet bez wartości schodzi po łańcuchu urządzeń do desktopu.
      "--wt-fs-t": "22px",
      "--wt-fs-m": "16px",
      "--wt-tfs-d": "22px",
      "--wt-tfs-t": "22px",
      "--wt-tfs-m": "16px",
    });
    expect(t.legacy).toBe(false);
  });

  it("osobny rozmiar opisu daje `tfs dfs` bez rozmiaru ogólnego", () => {
    const t = widgetTypographyTemplate({
      fontSize: { desktop: "18px" },
      descriptionFontSize: { desktop: "14px", tablet: "13px" },
    });
    expect(t.tokens).toBe("tfs dfs");
    expect(t.vars).toMatchObject({
      "--wt-tfs-d": "18px",
      "--wt-dfs-d": "14px",
      "--wt-dfs-t": "13px",
      "--wt-dfs-m": "14px",
    });
    expect(t.vars).not.toHaveProperty("--wt-fs-d");
  });

  it("sam rozmiar opisu daje wyłącznie `dfs`", () => {
    expect(widgetTypographyTemplate({ descriptionFontSize: { mobile: "12px" } }).tokens).toBe(
      "dfs",
    );
  });

  it("odstęp tytuł-opis to token `g` (wartość niesie styl ramki)", () => {
    const t = widgetTypographyTemplate({ titleDescriptionGapPx: 12 });
    expect(t.tokens).toBe("g");
    expect(t.vars).toBeUndefined();
    expect(widgetTypographyTemplate({ titleDescriptionGapPx: 0 }).tokens).toBe("g");
  });

  it("pomija nieczytelne rozmiary (< 6 px) i schodzi po łańcuchu urządzeń", () => {
    const t = widgetTypographyTemplate({
      fontSize: { desktop: "20px", tablet: "1px", mobile: "2px" },
    });
    expect(t.vars).toMatchObject({
      "--wt-fs-d": "20px",
      "--wt-fs-t": "20px",
      "--wt-fs-m": "20px",
    });
  });

  it.each(["1.5rem", "110%", "0.9em", ".8em", "12pt", "4vw"])(
    "wartość %s z białej listy idzie szablonem",
    (value) => {
      const t = widgetTypographyTemplate({ fontSize: { desktop: value } });
      expect(t.tokens).toBe("fs tfs");
      expect(t.legacyFontSize).toBe(false);
    },
  );

  it.each(["16", "clamp(1rem, 2vw, 2rem)", "var(--x)", "calc(1rem + 2px)", "16PX", "big"])(
    "wartość %s spoza białej listy kieruje rozmiary do generatora",
    (value) => {
      const t = widgetTypographyTemplate({
        fontSize: { desktop: "18px" },
        descriptionFontSize: { desktop: value },
      });
      // Cała grupa rozmiarów (także poprawny tytuł) - bez mieszania dróg.
      expect(t.legacyFontSize).toBe(true);
      expect(t.legacy).toBe(true);
      expect(t.tokens).toBeUndefined();
      expect(t.vars).toBeUndefined();
    },
  );

  it.each([
    ["fontFamily", "Inter, sans-serif"],
    ["fontWeight", "700"],
    ["fontStyle", "italic"],
    ["lineHeight", "1.4"],
    ["letterSpacing", "0.02em"],
    ["textTransform", "uppercase"],
    ["textDecoration", "underline"],
    ["textAlign", "center"],
  ])("właściwość %s idzie generatorem, rozmiar dalej szablonem", (key, value) => {
    const t = widgetTypographyTemplate({ fontSize: { desktop: "16px" }, [key]: value });
    expect(t.legacy).toBe(true);
    expect(t.legacyFontSize).toBe(false);
    expect(t.tokens).toBe("fs tfs");
  });

  it("wynik nie zależy od urządzenia i jest deterministyczny (SSR = hydratacja)", () => {
    const typography = { fontSize: { desktop: "22px", tablet: "18px", mobile: "16px" } };
    expect(widgetTypographyTemplate(typography)).toEqual(widgetTypographyTemplate(typography));
  });
});

describe("podgląd na żywo - reguła per identyfikator w <head>", () => {
  const liveStyle = (id: string) =>
    document.getElementById(`builder-live-typography-style-${id}`) as HTMLStyleElement | null;

  it("zmienne szablonu w regule o specyficzności ramki", () => {
    expect(buildLiveTypographyVarsCss("w1", { fontSize: { desktop: "30px" } })).toBe(
      '[data-w-id="w1"][data-w-id][data-w-id]{--wt-fs-d:30px;--wt-fs-t:30px;--wt-fs-m:30px;' +
        "--wt-tfs-d:30px;--wt-tfs-t:30px;--wt-tfs-m:30px;}",
    );
    expect(buildLiveTypographyVarsCss("w1", { fontWeight: "700" })).toBe("");
  });

  it("broadcast zapisuje regułę na zmiennych, a wyczyszczenie ją usuwa", () => {
    broadcastWidgetTypography("w2", { fontSize: { desktop: "28px" } });
    expect(liveStyle("w2")?.textContent).toContain("--wt-fs-d:28px");
    expect(liveStyle("w2")?.textContent).not.toContain("!important");
    broadcastWidgetTypography("w2", undefined);
    expect(liveStyle("w2")).toBeNull();
  });

  it("właściwości spoza szablonu dociąga generator (leniwie) do tego samego bloku", async () => {
    broadcastWidgetTypography("w3", { fontSize: { desktop: "28px" }, fontWeight: "800" });
    await vi.waitFor(() =>
      expect(liveStyle("w3")?.textContent).toContain("font-weight:800 !important"),
    );
    expect(liveStyle("w3")?.textContent).toContain("--wt-fs-d:28px");
    // Rozmiar z białej listy nie wraca do reguł generatora.
    expect(liveStyle("w3")?.textContent).not.toMatch(/font-size:28px/);
  });

  it("spóźniony generator nie nadpisuje nowszej typografii", async () => {
    broadcastWidgetTypography("w4", { fontWeight: "800" });
    broadcastWidgetTypography("w4", { fontSize: { desktop: "20px" } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(liveStyle("w4")?.textContent).toContain("--wt-fs-d:20px");
    expect(liveStyle("w4")?.textContent).not.toContain("font-weight");
  });

  it("subskrybent dostaje typografię z tej karty i z migawki sesji", () => {
    const seen: unknown[] = [];
    const stop = subscribeWidgetTypography("w5", (t) => seen.push(t));
    broadcastWidgetTypography("w5", { fontSize: { desktop: "19px" } });
    stop();
    const late: unknown[] = [];
    const stopLate = subscribeWidgetTypography("w5", (t) => late.push(t));
    stopLate();
    expect(seen).toEqual([{ fontSize: { desktop: "19px" } }]);
    expect(late).toEqual([{ fontSize: { desktop: "19px" } }]);
  });
});
