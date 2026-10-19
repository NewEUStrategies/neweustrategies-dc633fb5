// Blok `:hover` widgetu (`hoverCss`) - to, co ramka (`ChromeWidgetView`) wkłada
// do `<StyleSink>` obok koloru i CSS-a autora.
//
// Dowodzimy kontraktów, które widzi czytelnik strony:
//  * reguła jest ZAWĘŻONA do `[data-w-id="…"]` instancji i nie da się z niej
//    wyjść przez identyfikator;
//  * light/dark różnią WYŁĄCZNIE kolory - zaokrąglenie, cień, ruch i typografia
//    hoveru są wspólne (reguła z AGENTS.md o wspólnej geometrii widgetów), także
//    dla dokumentów z dawnym zapisem `{ light: HoverStyle, dark: HoverStyle }`;
//  * hover bez efektu nie produkuje bloku (zero pustych `<style>` w HTML-u).
//
// Moduł jest czysty (bez I/O) - nie ma granic do mockowania; asercje idą po
// deklaracjach CSS rozbitych z wyniku, nie po całym napisie.
import { describe, expect, it } from "vitest";
import { hoverCss } from "../hoverCss";
import type { CommonStyle, HoverStyle } from "../types";

/** Styl widgetu z hoverem w dowolnym (także historycznym) kształcie. */
const withHover = (hover: unknown): CommonStyle => ({ hover }) as unknown as CommonStyle;

/** Deklaracje reguły `:hover` jako mapa własność -> wartość. */
function hoverDecls(css: string): Record<string, string> {
  const body = /:hover\{([^}]*)\}/.exec(css)?.[1] ?? "";
  return Object.fromEntries(
    body
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const i = d.indexOf(":");
        return [d.slice(0, i).trim(), d.slice(i + 1).trim()];
      }),
  );
}

const GEOMETRY = ["border-radius", "box-shadow", "transform", "font-size", "font-weight"];

describe("hoverCss - kiedy blok nie powstaje", () => {
  it("brak hoveru, hover bez reguł i samo `scale: 1` dają pusty napis", () => {
    expect(hoverCss("w1", undefined, "desktop")).toBe("");
    expect(hoverCss("w1", {}, "desktop")).toBe("");
    expect(hoverCss("w1", withHover({ transitionMs: 300 }), "desktop")).toBe("");
    expect(hoverCss("w1", withHover({ scale: 1, typography: {} }), "desktop")).toBe("");
    expect(hoverCss("w1", withHover({ light: undefined, dark: undefined }), "desktop")).toBe("");
  });

  it("identyfikator bez ani jednego bezpiecznego znaku nie daje reguły bez zasięgu", () => {
    expect(hoverCss('"]{}', withHover({ bgColor: "red" }), "desktop")).toBe("");
  });
});

describe("hoverCss - zasięg instancji i przejście", () => {
  it("przejście siedzi na widgecie, deklaracje na jego `:hover`", () => {
    const css = hoverCss("w-1_a", withHover({ bgColor: "#111" }), "desktop");
    expect(css).toBe(
      '[data-w-id="w-1_a"]{transition: all 200ms ease-out}[data-w-id="w-1_a"]:hover{background: #111}',
    );
  });

  it("znaki spoza [a-zA-Z0-9_-] wypadają z identyfikatora - nie ma wyjścia z selektora", () => {
    const css = hoverCss('a"] body{x} [b', withHover({ bgColor: "#111" }), "desktop");
    expect(css.startsWith('[data-w-id="abodyxb"]{')).toBe(true);
    expect(css).not.toContain("body{");
  });

  it("`transitionMs: 0` wyłącza animację zamiast wracać do 200 ms", () => {
    const css = hoverCss("w1", withHover({ bgColor: "#111", transitionMs: 0 }), "desktop");
    expect(css).toContain("{transition: all 0ms ease-out}");
  });
});

describe("hoverCss - light/dark różnią tylko kolory", () => {
  const hover: HoverStyle = {
    bgColor: { light: "#ffffff", dark: "#101010" } as unknown as string,
    textColor: { light: "#101010" } as unknown as string,
    borderRadius: "12px",
    shadow: "0 8px 24px rgba(0,0,0,.18)",
    translateY: "-2px",
    scale: 1.03,
    typography: { fontWeight: "700", fontSize: { desktop: "18px" } },
  };

  it("kolor z gałęzi trybu, a brak gałęzi bierze kolor drugiego trybu", () => {
    const light = hoverDecls(hoverCss("w1", withHover(hover), "desktop", "light"));
    const dark = hoverDecls(hoverCss("w1", withHover(hover), "desktop", "dark"));
    expect([light.background, dark.background]).toEqual(["#ffffff", "#101010"]);
    expect([light.color, dark.color]).toEqual(["#101010", "#101010"]);
  });

  it("geometria, ruch i typografia hoveru są identyczne w obu trybach", () => {
    const light = hoverDecls(hoverCss("w1", withHover(hover), "desktop", "light"));
    const dark = hoverDecls(hoverCss("w1", withHover(hover), "desktop", "dark"));
    for (const prop of GEOMETRY) expect(dark[prop]).toBe(light[prop]);
    expect(light.transform).toBe("translateY(-2px) scale(1.03)");
    expect(light["font-size"]).toBe("18px");
  });

  it("dawny zapis per tryb: kolor z gałęzi trybu, geometria wyłącznie z light", () => {
    // Dark niósł kiedyś własne zaokrąglenie i skalę - przełączenie trybu nie
    // może przesuwać ani powiększać karty, więc wygrywa geometria light.
    const legacy = {
      light: { bgColor: "#fafafa", borderRadius: "4px" },
      dark: { bgColor: "#0a0a0a", borderRadius: "20px", scale: 1.2 },
    };
    const light = hoverDecls(hoverCss("w1", withHover(legacy), "desktop", "light"));
    const dark = hoverDecls(hoverCss("w1", withHover(legacy), "desktop", "dark"));
    expect(light).toEqual({ background: "#fafafa", "border-radius": "4px" });
    expect(dark).toEqual({ background: "#0a0a0a", "border-radius": "4px" });
  });

  it("dawny zapis tylko dla dark działa także w light (bez utraty hoveru)", () => {
    const css = hoverCss("w1", withHover({ dark: { bgColor: "#222" } }), "desktop", "light");
    expect(hoverDecls(css)).toEqual({ background: "#222" });
  });
});

describe("hoverCss - typografia i ruch", () => {
  it("rozmiar czcionki: wartość urządzenia, potem desktop, tablet, mobile", () => {
    const size = (fontSize: Record<string, string>, device: "desktop" | "tablet" | "mobile") =>
      hoverDecls(
        hoverCss("w1", withHover({ typography: { fontSize } as HoverStyle["typography"] }), device),
      )["font-size"];
    expect(size({ desktop: "20px", mobile: "14px" }, "mobile")).toBe("14px");
    expect(size({ desktop: "20px" }, "tablet")).toBe("20px");
    expect(size({ tablet: "16px", mobile: "12px" }, "desktop")).toBe("16px");
    expect(size({ mobile: "12px" }, "tablet")).toBe("12px");
  });

  it("każde pole typografii trafia do swojej własności CSS", () => {
    const decls = hoverDecls(
      hoverCss(
        "w1",
        withHover({
          typography: {
            fontFamily: "Inter, sans-serif",
            fontStyle: "italic",
            lineHeight: "1.4",
            letterSpacing: "0.02em",
            textTransform: "uppercase",
            textDecoration: "underline",
          },
        }),
        "desktop",
      ),
    );
    expect(decls).toEqual({
      "font-family": "Inter, sans-serif",
      "font-style": "italic",
      "line-height": "1.4",
      "letter-spacing": "0.02em",
      "text-transform": "uppercase",
      "text-decoration": "underline",
    });
  });

  it("`scale: 1` nie wchodzi do transformacji, ale przesunięcie obok zostaje", () => {
    const decls = hoverDecls(hoverCss("w1", withHover({ translateY: "-4px", scale: 1 }), "mobile"));
    expect(decls).toEqual({ transform: "translateY(-4px)" });
  });
});
