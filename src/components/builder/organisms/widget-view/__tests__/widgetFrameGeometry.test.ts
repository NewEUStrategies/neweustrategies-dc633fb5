// Ramka widgetu (`frame.ts`): styl zewnętrznego `div[data-w-id]` i odczyt
// treści, czyli to, co `ChromeWidgetView` wstawia do `style` na kanwie i na
// stronie publicznej.
//
// Dowodzimy kontraktów widocznych dla redakcji:
//  * szerokość/wysokość z panelu „Zaawansowane": desktop prowadzi, węższe
//    urządzenia przycinają piksele do kolumny, proporcja obrazu wygrywa z
//    wysokością, a kotwica pozioma i układ „inline" zwężają widget do treści -
//    z wyjątkami (wyszukiwarka, slider, lista wpisów, karuzela, separator);
//  * wyrównanie pionowe w kolumnie (auto-marginesy, „stretch" bez gubienia
//    wysokości ustawionej w panelu);
//  * `styleToCSS`: light/dark różnią WYŁĄCZNIE kolory (reguła z AGENTS.md o
//    wspólnej geometrii), a kolor ustawiony tylko dla light jest w dark
//    odwracany, chyba że redakcja jawnie wybrała kolor dark;
//  * getterzy treści nie przepuszczają do widoku wartości złego typu.
//
// Moduł jest czysty - bez granic do mockowania.
import { describe, expect, it } from "vitest";
import type { CommonStyle, Device, WidgetNode } from "@/lib/builder/types";
import {
  getBool,
  getNum,
  getStr,
  getStrArr,
  getWidgetFrameStyle,
  hiddenOnDevice,
  normalizeNewsletterVariant,
  styleToCSS,
} from "../frame";

const widget = (over: Partial<WidgetNode> & Record<string, unknown> = {}): WidgetNode =>
  ({ id: "w1", kind: "widget", type: "text", content: {}, ...over }) as WidgetNode;

const frame = (over: Record<string, unknown>, device: Device = "desktop") =>
  getWidgetFrameStyle(widget(over), device);

describe("getWidgetFrameStyle - szerokość", () => {
  it("bez ustawień widget wypełnia kolumnę i nie rozpycha jej", () => {
    expect(frame({})).toEqual({
      width: "100%",
      minWidth: 0,
      maxWidth: "100%",
      boxSizing: "border-box",
    });
  });

  it("piksele z desktopu obowiązują wprost, a na węższych urządzeniach są przycinane do kolumny", () => {
    const adv = { advanced: { width: 320 } };
    expect(frame(adv, "desktop").width).toBe(320);
    expect(frame(adv, "tablet").width).toBe("min(100%, 320px)");
    expect(frame({ advanced: { width: "24rem" } }, "mobile").width).toBe("min(100%, 24rem)");
    expect(frame({ advanced: { width: "50%" } }, "mobile").width).toBe("50%");
  });

  it("brak wartości dla urządzenia bierze desktop (mobile responsywne do desktopu)", () => {
    const adv = { advanced: { width: { desktop: 600, mobile: 300 } } };
    expect(frame(adv, "tablet").width).toBe("min(100%, 600px)");
    expect(frame(adv, "mobile").width).toBe("min(100%, 300px)");
  });

  it("kotwica pozioma i układ inline zwężają widget do treści", () => {
    const centered = frame({ type: "button", style: { selfJustify: "center" } });
    expect(centered).toMatchObject({ width: "auto", alignSelf: "center" });
    expect(frame({ style: { selfJustify: "start" } }).alignSelf).toBe("flex-start");
    expect(frame({ style: { selfJustify: "end" } }).alignSelf).toBe("flex-end");
    expect(frame({ style: { selfJustify: "auto" } }).alignSelf).toBeUndefined();
    expect(frame({ advanced: { layout: "inline" } })).toMatchObject({
      width: "auto",
      flex: "0 0 auto",
    });
    // Jawny maxWidth jest szerokością zwężonego widgetu.
    expect(frame({ style: { selfJustify: "center", maxWidth: "480px" } }).width).toBe("480px");
  });

  it("separator i odstęp zawsze pokazują pełną szerokość, nawet wyśrodkowane", () => {
    for (const type of ["divider", "spacer"]) {
      const style = frame({ type, style: { selfJustify: "center" } });
      expect(style.width).toBe("100%");
      expect(style.alignSelf).toBeUndefined();
    }
  });

  it("wyszukiwarka wypełnia kolumnę także zakotwiczona i w układzie inline", () => {
    const style = frame({
      type: "search-button",
      style: { selfJustify: "end" },
      advanced: { layout: "inline" },
    });
    expect(style).toMatchObject({ width: "100%", flexBasis: "100%", alignSelf: "flex-end" });
    expect(style.flex).toBeUndefined();
    expect(frame({ type: "search-button", advanced: { width: 280 } }).width).toBe(280);
  });

  it("slider bez szerokości wypełnia rząd, a z maxWidth bierze go jako szerokość", () => {
    expect(frame({ type: "slider" })).toMatchObject({ width: "100%", flexBasis: "100%" });
    const capped = frame({ type: "slider", style: { maxWidth: "800px" } });
    expect(capped.width).toBe("800px");
    expect(capped.flexBasis).toBeUndefined();
  });

  it("lista wpisów i karuzela zawsze zajmują całą kolumnę", () => {
    for (const type of ["post-list", "carousel"]) {
      const style = frame({
        type,
        style: { selfJustify: "center" },
        advanced: { layout: "inline" },
      });
      expect(style).toMatchObject({ width: "100%", maxWidth: "100%", flexBasis: "100%" });
    }
  });
});

describe("getWidgetFrameStyle - wysokość i wyrównanie pionowe", () => {
  it("wysokość z desktopu obowiązuje na mobile; procent i brak wartości jej nie ustawiają", () => {
    expect(frame({ advanced: { height: { desktop: 240 } } }, "mobile").height).toBe(240);
    expect(frame({ advanced: { height: "auto" } }).height).toBe("auto");
    const percent = frame({ advanced: { height: "50%" }, style: { minHeight: "120px" } });
    expect(percent.height).toBeUndefined();
    expect(percent.minHeight).toBe("120px");
  });

  it("proporcja obrazu wygrywa z wysokością, a „auto” oddaje ją panelowi", () => {
    const ratio = { type: "image", advanced: { height: 300 } };
    expect(frame({ ...ratio, content: { ratio: "16/9" } }).height).toBeUndefined();
    expect(frame({ ...ratio, content: { ratio: "auto" } }).height).toBe(300);
  });

  it("„stretch” rozciąga widget bez wysokości, a wysokość z panelu zostaje", () => {
    expect(frame({ style: { selfAlign: "stretch" } })).toMatchObject({
      alignSelf: "stretch",
      flexGrow: 1,
      height: "auto",
    });
    expect(frame({ style: { selfAlign: "stretch" }, advanced: { height: 200 } })).toMatchObject({
      height: 200,
      flexGrow: 0,
      flexShrink: 0,
    });
    // Kotwica pozioma nie jest nadpisywana przez rozciągnięcie.
    expect(frame({ style: { selfAlign: "stretch", selfJustify: "end" } }).alignSelf).toBe(
      "flex-end",
    );
  });

  it("start/środek/koniec kolumny idą auto-marginesami, „auto” zostawia kolumnie", () => {
    const margins = (selfAlign: string) => {
      const s = frame({ style: { selfAlign } });
      return [s.marginTop, s.marginBottom];
    };
    expect(margins("start")).toEqual([0, "auto"]);
    expect(margins("center")).toEqual(["auto", "auto"]);
    expect(margins("end")).toEqual(["auto", 0]);
    expect(margins("auto")).toEqual([undefined, undefined]);
  });

  it("ukrycie na urządzeniu dotyczy tylko zaznaczonych urządzeń", () => {
    const adv = { hideOn: { mobile: true } };
    expect(hiddenOnDevice(adv, "mobile")).toBe(true);
    expect(hiddenOnDevice(adv, "desktop")).toBe(false);
    expect(hiddenOnDevice(undefined, "mobile")).toBe(false);
  });
});

describe("styleToCSS - light/dark różnią tylko kolory", () => {
  /** Dawny dokument: geometria i typografia zapisane osobno dla trybów. */
  const legacy = {
    bgColor: "#111111",
    textColor: { light: "#202020", dark: "#e0e0e0" },
    borderStyle: { light: "solid", dark: "dashed" },
    borderWidth: { dark: "3px" },
    borderColor: { light: "#333333" },
    padding: { light: { desktop: "8px", mobile: "4px" }, dark: { desktop: "40px" } },
    margin: { desktop: "0 auto" },
    borderRadius: { light: "6px", dark: "24px" },
    boxShadow: { dark: "0 0 0 1px red" },
    align: { desktop: "center", mobile: "left" },
    maxWidth: "640px",
    minHeight: "80px",
    opacity: 0,
    typography: {
      light: { fontWeight: "700", fontSize: { desktop: "40px" }, letterSpacing: "0.1em" },
      dark: { fontWeight: "300" },
    },
  } as unknown as CommonStyle;

  const COLORS = ["background", "color", "borderColor"];

  it("przełączenie trybu zmienia wyłącznie kolory - geometria i typografia stoją", () => {
    const light = styleToCSS(legacy, "desktop", "light") as Record<string, unknown>;
    const dark = styleToCSS(legacy, "desktop", "dark") as Record<string, unknown>;
    const strip = (css: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(css).filter(([k]) => !COLORS.includes(k)));
    expect(strip(dark)).toEqual(strip(light));
    expect(strip(light)).toEqual({
      padding: "8px",
      margin: "0 auto",
      textAlign: "center",
      borderRadius: "6px",
      maxWidth: "640px",
      minHeight: "80px",
      borderStyle: "solid",
      borderWidth: "3px",
      boxShadow: "0 0 0 1px red",
      opacity: 0,
      fontWeight: "700",
      letterSpacing: "0.1em",
    });
  });

  it("kolor tylko z light jest w dark odwracany, jawny kolor dark wygrywa", () => {
    const light = styleToCSS(legacy, "desktop", "light");
    const dark = styleToCSS(legacy, "desktop", "dark");
    expect([light.background, dark.background]).toEqual(["#111111", "rgb(238, 238, 238)"]);
    expect([light.color, dark.color]).toEqual(["#202020", "#e0e0e0"]);
    expect([light.borderColor, dark.borderColor]).toEqual(["#333333", "rgb(204, 204, 204)"]);
  });

  it("rozmiar czcionki nie trafia na ramkę (idzie szablonem typografii)", () => {
    expect(styleToCSS(legacy, "desktop").fontSize).toBeUndefined();
  });

  it("wartości responsywne biorą urządzenie, a bez obramowania nie ma jego koloru", () => {
    const style = {
      padding: { desktop: "24px", mobile: "12px" },
      align: { desktop: "right" },
      borderStyle: "none",
      borderColor: "#000",
    } as CommonStyle;
    const mobile = styleToCSS(style, "mobile");
    expect(mobile).toEqual({ padding: "12px", textAlign: "right" });
    expect(styleToCSS({ borderStyle: "dotted" }, "desktop")).toEqual({
      borderStyle: "dotted",
      borderWidth: "1px",
    });
    expect(styleToCSS(undefined, "desktop")).toEqual({});
  });
});

describe("getterzy treści - zły typ nigdy nie dociera do widoku", () => {
  const content = {
    title: "Tytuł",
    count: 7,
    numericText: "7",
    tags: ["a", 2, null, "b"],
    obj: { a: 1 },
  };

  it("tekst, liczba i lista zwracają wartość albo bezpieczny domyślny", () => {
    expect(getStr(content, "title")).toBe("Tytuł");
    expect(getStr(content, "count")).toBe("");
    expect(getStr(content, "obj")).toBe("");
    expect(getNum(content, "count", 3)).toBe(7);
    expect(getNum(content, "numericText", 3)).toBe(3);
    expect(getStrArr(content, "tags")).toEqual(["a", "b"]);
    expect(getStrArr(content, "title")).toEqual([]);
  });

  it("flaga rozumie zapisy z importu (napisy i 0/1), resztę zostawia domyślnej", () => {
    const flag = (v: unknown, dflt?: boolean) => getBool({ v } as never, "v", dflt);
    expect([flag(" TRUE "), flag("1"), flag("yes"), flag(1)]).toEqual([true, true, true, true]);
    expect([flag("false", true), flag("0", true), flag("No", true), flag(0, true)]).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect([flag("może", true), flag(2), flag(null, true), flag(undefined)]).toEqual([
      true,
      false,
      true,
      false,
    ]);
  });

  it("dawne polskie etykiety wariantu newslettera mapują się na identyfikatory", () => {
    expect(normalizeNewsletterVariant("sama ikona")).toBe("icon-only");
    expect(normalizeNewsletterVariant("ikona + tekst")).toBe("icon");
    expect(normalizeNewsletterVariant("inline (email + przycisk)")).toBe("inline");
    expect(normalizeNewsletterVariant("karta z formularzem")).toBe("card");
    expect(normalizeNewsletterVariant("card")).toBe("card");
  });
});
