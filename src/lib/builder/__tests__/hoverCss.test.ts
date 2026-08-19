// `hoverCss` buduje zakresowany blok `:hover` dla JEDNEGO widgetu i wstrzykuje
// go do arkusza instancji. Do tej pory nie miał ani jednego testu, mimo że
// decyduje o tym, czy ustawienia hoveru z panelu w ogóle coś robią - a jego
// wynik ląduje w CSS strony publicznej.
//
// Testujemy tu kontrakt, nie wygląd: kiedy blok NIE powstaje (brak hoveru, brak
// reguł, wykastrowane id), jak działa rozróżnienie light/dark, jak wybierany
// jest rozmiar czcionki per urządzenie i że identyfikator selektora jest
// czyszczony (to jedyne miejsce w tej funkcji, gdzie dane użytkownika trafiają
// w POZYCJĘ SELEKTORA, a nie wartości deklaracji).
import { describe, it, expect } from "vitest";
import { hoverCss } from "../hoverCss";
import type { CommonStyle, HoverStyle, Device, Mode } from "../types";

/** CommonStyle z hoverem podanym „na płasko" (kontrakt starszych zapisów). */
function flat(hover: HoverStyle): CommonStyle {
  return { hover } as unknown as CommonStyle;
}

/** CommonStyle z hoverem rozbitym na tryby (Themed<HoverStyle>). */
function themed(light?: HoverStyle, dark?: HoverStyle): CommonStyle {
  return { hover: { light, dark } } as unknown as CommonStyle;
}

const css = (
  style: CommonStyle | undefined,
  device: Device = "desktop",
  mode: Mode = "light",
  id = "w1",
) => hoverCss(id, style, device, mode);

describe("hoverCss - kiedy blok NIE powstaje", () => {
  it("zwraca pustkę bez stylu i bez hoveru", () => {
    expect(css(undefined)).toBe("");
    expect(css({} as CommonStyle)).toBe("");
  });

  it("zwraca pustkę, gdy hover istnieje, ale nie niesie ŻADNEJ reguły", () => {
    // Pusty obiekt hoveru to realny stan zapisu: panel tworzy gałąź, zanim
    // redaktor cokolwiek w niej ustawi. Emisja `:hover{}` byłaby śmieciem.
    expect(css(flat({}))).toBe("");
  });

  it("zwraca pustkę, gdy hover ma tylko `scale: 1` (brak efektu)", () => {
    // scale === 1 jest jawnie pomijane - to wartość neutralna.
    expect(css(flat({ scale: 1 }))).toBe("");
  });

  it("zwraca pustkę, gdy identyfikator po oczyszczeniu jest pusty", () => {
    // Id z samych znaków niedozwolonych znika w całości. Bez tego strażnika
    // powstałby selektor `[data-w-id=""]` łapiący każdy widget bez id.
    expect(hoverCss('"', flat({ bgColor: "red" }), "desktop", "light")).toBe("");
    expect(hoverCss("", flat({ bgColor: "red" }), "desktop", "light")).toBe("");
  });

  it("zwraca pustkę, gdy obie gałęzie trybów są puste", () => {
    expect(css(themed(undefined, undefined))).toBe("");
  });
});

describe("hoverCss - dziedziczenie między trybami", () => {
  // `pickMode` celowo robi `v[mode] ?? v[other]`: hover ustawiony tylko w jednym
  // trybie obowiązuje TEŻ w drugim (kontrakt „dziedzicz, zamiast gubić efekt").
  // Pilnujemy tego jawnie, bo to jedyna reguła tej funkcji, której nie widać
  // w jej własnym ciele - siedzi w `themed.ts`.
  it("hover tylko dla dark działa również w light", () => {
    expect(css(themed(undefined, { bgColor: "red" }), "desktop", "light")).toContain(
      "background: red",
    );
  });

  it("hover tylko dla light działa również w dark", () => {
    expect(css(themed({ bgColor: "red" }, undefined), "desktop", "dark")).toContain(
      "background: red",
    );
  });
});

describe("hoverCss - selektor i przejście", () => {
  it("emituje przejście na widgecie i reguły na `:hover`", () => {
    const out = css(flat({ bgColor: "#fff" }));
    expect(out).toBe(
      '[data-w-id="w1"]{transition: all 200ms ease-out}[data-w-id="w1"]:hover{background: #fff}',
    );
  });

  it("domyślny czas przejścia to 200 ms, a `transitionMs` go nadpisuje", () => {
    expect(css(flat({ bgColor: "#fff" }))).toContain("all 200ms");
    expect(css(flat({ bgColor: "#fff", transitionMs: 750 }))).toContain("all 750ms");
  });

  it("`transitionMs: 0` jest respektowane (a nie zamieniane na domyślne 200)", () => {
    // `?? 200` zamiast `|| 200` - zero jest poprawną, celową wartością.
    expect(css(flat({ bgColor: "#fff", transitionMs: 0 }))).toContain("all 0ms");
  });

  it("czyści identyfikator do [a-zA-Z0-9_-], żeby nie dało się wyjść z selektora", () => {
    const out = hoverCss('w1"]{color:red}[x', flat({ bgColor: "#fff" }), "desktop", "light");
    expect(out).toContain('[data-w-id="w1colorredx"]');
    expect(out).not.toContain("{color:red}[x");
  });
});

describe("hoverCss - tryby light / dark", () => {
  it("czyta gałąź odpowiadającą trybowi", () => {
    const style = themed({ bgColor: "#fff" }, { bgColor: "#000" });
    expect(css(style, "desktop", "light")).toContain("background: #fff");
    expect(css(style, "desktop", "dark")).toContain("background: #000");
  });

  it("wartość płaska obowiązuje w OBU trybach", () => {
    const style = flat({ bgColor: "#abc" });
    expect(css(style, "desktop", "light")).toContain("background: #abc");
    expect(css(style, "desktop", "dark")).toContain("background: #abc");
  });

  it("domyślnym trybem jest light", () => {
    const style = themed({ bgColor: "#fff" }, { bgColor: "#000" });
    expect(hoverCss("w1", style, "desktop")).toContain("background: #fff");
  });
});

describe("hoverCss - pełny zestaw deklaracji", () => {
  it("mapuje każde pole hoveru na właściwą własność CSS", () => {
    const out = css(
      flat({
        bgColor: "#111",
        textColor: "#222",
        borderRadius: "8px",
        shadow: "0 1px 2px #000",
      }),
    );
    expect(out).toContain("background: #111");
    expect(out).toContain("color: #222");
    expect(out).toContain("border-radius: 8px");
    expect(out).toContain("box-shadow: 0 1px 2px #000");
  });

  it("składa translateY i scale w JEDNĄ deklarację transform", () => {
    // Dwie osobne deklaracje `transform` wykluczałyby się w kaskadzie -
    // druga wygrywa i jeden z efektów cicho przepada.
    const out = css(flat({ translateY: "-4px", scale: 1.05 }));
    expect(out).toContain("transform: translateY(-4px) scale(1.05)");
    expect(out.match(/transform:/g)).toHaveLength(1);
  });

  it("emituje transform także wtedy, gdy ustawiono tylko jedną z osi", () => {
    expect(css(flat({ translateY: "2px" }))).toContain("transform: translateY(2px)");
    expect(css(flat({ scale: 0.9 }))).toContain("transform: scale(0.9)");
  });

  it("pomija `scale` równe 1, ale zachowuje translateY obok niego", () => {
    const out = css(flat({ translateY: "3px", scale: 1 }));
    expect(out).toContain("transform: translateY(3px)");
    expect(out).not.toContain("scale(");
  });

  it("mapuje całą typografię hoveru", () => {
    const out = css(
      flat({
        typography: {
          fontFamily: "Georgia",
          fontWeight: "700",
          fontStyle: "italic",
          lineHeight: "1.4",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          textDecoration: "underline",
        },
      } as HoverStyle),
    );
    expect(out).toContain("font-family: Georgia");
    expect(out).toContain("font-weight: 700");
    expect(out).toContain("font-style: italic");
    expect(out).toContain("line-height: 1.4");
    expect(out).toContain("letter-spacing: 0.05em");
    expect(out).toContain("text-transform: uppercase");
    expect(out).toContain("text-decoration: underline");
  });

  it("puste `typography` nie tworzy bloku samo z siebie", () => {
    expect(css(flat({ typography: {} } as HoverStyle))).toBe("");
  });
});

describe("hoverCss - rozmiar czcionki per urządzenie", () => {
  const withSizes = (sizes: Record<string, string>) =>
    flat({ typography: { fontSize: sizes } } as unknown as HoverStyle);

  it("bierze wartość dla żądanego urządzenia, gdy istnieje", () => {
    const style = withSizes({ desktop: "20px", tablet: "18px", mobile: "16px" });
    expect(css(style, "desktop")).toContain("font-size: 20px");
    expect(css(style, "tablet")).toContain("font-size: 18px");
    expect(css(style, "mobile")).toContain("font-size: 16px");
  });

  it("spada na desktop, gdy brak wartości dla urządzenia", () => {
    const style = withSizes({ desktop: "20px" });
    expect(css(style, "mobile")).toContain("font-size: 20px");
    expect(css(style, "tablet")).toContain("font-size: 20px");
  });

  it("spada na tablet, a potem na mobile, gdy brak desktopu", () => {
    expect(css(withSizes({ tablet: "18px" }), "desktop")).toContain("font-size: 18px");
    expect(css(withSizes({ mobile: "16px" }), "desktop")).toContain("font-size: 16px");
  });

  it("nie emituje `font-size`, gdy zestaw rozmiarów jest pusty", () => {
    expect(css(withSizes({}))).toBe("");
  });
});
