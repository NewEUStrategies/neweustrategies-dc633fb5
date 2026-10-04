// Bramka wariantu "kinetic-signal-notch" (23) w katalogu etykiety sekcji.
//
// PO CO
// Katalog `SECTION_LABEL_VARIANTS` jest jednym źródłem prawdy dla panelu i dla
// renderera, ale NIE pilnuje, czy nowy wpis ma cokolwiek pod spodem: dopisany
// bez `case` w `SectionLabelRender` wariant renderuje pusty fragment, a dopisany
// bez tłumaczenia w `labelsEn.ts` wlewa polski do angielskiego panelu. Ten plik
// zamyka obie dziury na konkretnym wariancie: trzy paski sygnału, akcent w
// zmiennej CSS, podkreślenie akcji, posłuszeństwo `showRule` / `gapY` / `arrow`
// oraz obecność stylów i kontrolek.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import type { ComponentProps } from "react";

// AppLink woła `useRouter()`. Podmieniamy WYŁĄCZNIE go, żeby reszta modułu
// została prawdziwa (ten sam wzorzec co w variantRenderers.test.tsx).
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useRouter: () => ({
      navigate: () => Promise.resolve(),
      preloadRoute: () => Promise.resolve(),
    }),
  };
});

import {
  readSectionLabelProps,
  SectionLabelRender,
  SECTION_LABEL_VARIANTS,
  type SectionLabelVariant,
} from "@/lib/builder/sectionLabelVariants";

const V: SectionLabelVariant = "kinetic-signal-notch";

const stylesCss = readFileSync("src/styles.css", "utf8");
const editorSrc = readFileSync(
  "src/components/admin/builder/ui/organisms/widget-properties/SectionLabelEditor.tsx",
  "utf8",
);

// `label`/`action` są wymagane w RenderProps, więc helper podaje ich wartości
// domyślne. `action: null` oznacza „brak akcji” (renderer traktuje pusty tekst
// jak jej brak), a `undefined` zostawia domyślny „więcej”.
type VariantProps = Omit<
  ComponentProps<typeof SectionLabelRender>,
  "variant" | "accent" | "label" | "action"
> & { action?: string | null };

function renderVariant(props: VariantProps = {}) {
  const { action, ...rest } = props;
  return render(
    <SectionLabelRender
      label="Najnowszy raport"
      action={action === null ? "" : "więcej"}
      accent="#FA9346"
      variant={V}
      {...rest}
    />,
  );
}

afterEach(() => cleanup());

describe("katalog wariantów", () => {
  it("ma unikalne wartości i wpis 23 bez półpauzy", () => {
    const values = SECTION_LABEL_VARIANTS.map((v) => v.value);
    expect(new Set(values).size).toBe(values.length);
    const entry = SECTION_LABEL_VARIANTS.find((v) => v.value === V);
    expect(entry?.label).toMatch(/^23 - /);
    for (const v of SECTION_LABEL_VARIANTS) {
      expect(v.label).not.toContain("\u2014");
    }
  });

  it("ma tłumaczenie etykiety wariantu na angielski", () => {
    const labels = readFileSync("src/lib/builder/labelsEn.ts", "utf8");
    const pl = SECTION_LABEL_VARIANTS.find((v) => v.value === V)?.label ?? "";
    expect(labels).toContain(pl);
    expect(labels).toContain("23 - Kinetic Signal Notch (three signal bars + animated action)");
  });

  it("ma style w arkuszu globalnym i kontrolki w panelu", () => {
    expect(stylesCss).toContain(".nes-kinetic-bar {");
    expect(stylesCss).toContain(".nes-kinetic-action:hover");
    expect(stylesCss).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.nes-kinetic-bar/);
    const extra = editorSrc.match(/const EXTRA_VARIANTS = \[([\s\S]*?)\]/);
    expect(extra?.[1]).toContain(`"${V}"`);
  });
});

describe("Kinetic Signal Notch", () => {
  it("rysuje trzy paski sygnału w akcencie", () => {
    const { container } = renderVariant();
    const bars = [...container.querySelectorAll<HTMLElement>(".nes-kinetic-bar")];
    expect(bars).toHaveLength(3);
    for (const bar of bars) {
      expect(bar.style.background || bar.style.backgroundColor).toMatch(
        /#FA9346|rgb\(250, 147, 70\)/i,
      );
      expect(bar.style.height).toBe("3px");
    }
    // Kreski sa identyczne: ta sama dlugosc (grubosc rowniez - height wyzej).
    const widths = bars.map((bar) => bar.className.match(/(?:^|\s)(w-[0-9.]+)(?:\s|$)/)?.[1]);
    expect(new Set(widths).size).toBe(1);
  });

  it("utrzymuje sygnał i tytuł w jednym wierszu, a akcję nad nimi", () => {
    const { container } = renderVariant();
    const row = container.querySelector<HTMLElement>(".nes-kinetic-row");
    const title = container.querySelector<HTMLElement>("[data-title-root]");
    const action = container.querySelector<HTMLElement>(".nes-kinetic-action");

    expect(row?.className).toContain("items-center");
    expect(row?.className).not.toContain("flex-wrap");
    expect(row?.className).not.toContain("grid-cols");
    expect(title?.className).toContain("whitespace-nowrap");
    // Ciasny tracking tytułu - litery blisko siebie.
    expect(title?.className).toContain("tracking-[0.08em]");
    // Akcja wisi NAD wierszem sygnału, nie w nim.
    expect(row?.contains(action ?? null)).toBe(false);
    expect(row?.previousElementSibling?.contains(action ?? null)).toBe(true);
  });

  it("akcja stoi po lewej, nisko nad wierszem i w neutralnej szarości", () => {
    const { container } = renderVariant();
    const row = container.querySelector<HTMLElement>(".nes-kinetic-row");
    const holder = row?.previousElementSibling as HTMLElement | null;
    // "przesuń na lewą stronę" - akcja startuje od lewej krawędzi widgetu.
    expect(holder?.className).toContain("justify-start");
    expect(holder?.className).not.toContain("justify-end");
    // "nieco niżej" + "bliżej trzech kresek" - minimalny oddech nad wierszem.
    expect(holder?.style.marginBottom).toBe("2px");
    // "bardziej szarawy" - ton akcji to token, nie kolor w komponencie.
    expect(stylesCss).toMatch(/--nes-kinetic-action: oklch\(/);
    expect(stylesCss).toContain("color: var(--nes-kinetic-action");
  });

  it("akcja jest linkiem niosącym akcent w zmiennej --nes-accent", () => {
    const { container } = renderVariant({ href: "/raporty" });
    const link = container.querySelector<HTMLAnchorElement>("a.nes-kinetic-action");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("/raporty");
    expect(link?.getAttribute("data-description-root")).not.toBeNull();
    const style = link?.getAttribute("style") ?? "";
    expect(style).toContain("--nes-accent");
    expect(style).toContain("#FA9346");
  });

  it("akcja nie ma podkreślenia, a chevron dzieli kolor i wysokość tekstu", () => {
    const { container } = renderVariant({ href: "/raporty" });
    const link = container.querySelector("a.nes-kinetic-action");
    // "usuń podkreślenie" - żaden element akcji nie rysuje linii od lewej.
    expect(link?.querySelector("[class*='group-hover/link:w-full']")).toBeNull();
    const svg = link?.querySelector("svg");
    expect(svg?.querySelector("polyline")).not.toBeNull();
    expect(svg?.querySelector('path[d="M5 12h14"]')).toBeNull();
    // Chevron w em, ale o 1 px nizszy niz czcionka akcji, zeby rownal wysokosci
    // liter „wiecej”. Bez przesuniecia w osi Y - wycentrowanie w inline-flex trafia
    // w pas miedzys highose x a linia bazowa liter.
    const svgStyle = svg?.getAttribute("style") ?? "";
    expect(svgStyle).toContain("height: calc(1em - 1px)");
    expect(svgStyle).toContain("width: calc(1.1em - 1px)");
    const svgClass = svg?.getAttribute("class") ?? "";
    expect(svgClass).not.toMatch(/(^|\s)-?(top|bottom|translate)-/);
    // Kolor z currentColor (ten sam co tekst), a nie z osobnej klasy.
    expect(svg?.getAttribute("stroke")).toBe("currentColor");
    expect(stylesCss).toMatch(/\.nes-kinetic-action svg \{[^}]*color: inherit;/);
    // „subtelny ptaszek" - kreska chevronu jest celowo cienka i bez pogrubienia,
    // wyraźnie cieńsza niż pasek sygnału; stroke-width liczy się w pikselach
    // ekranu (vector-effect), więc skalowanie viewBoxa jej nie pogrubia.
    const bar = container.querySelector<HTMLElement>(".nes-kinetic-bar");
    expect(bar?.style.height).toBe("3px");
    const stroke = Number(svg?.getAttribute("stroke-width"));
    expect(stroke).toBeGreaterThan(0);
    expect(svg?.getAttribute("stroke-width")).toBe("0.85");
    expect(stroke).toBeLessThanOrEqual(1);
    const barH = Number((bar?.style.height ?? "").replace(/[^0-9.]/g, ""));
    expect(barH).toBe(3);
    expect(stroke).toBeLessThan(barH);
    expect(svg?.querySelector("polyline")?.getAttribute("vector-effect")).toBe(
      "non-scaling-stroke",
    );
  });

  it("akcja jest minuskulowa, nie pogrubiona i mniejsza od tytułu", () => {
    const { container } = renderVariant();
    const action = container.querySelector<HTMLElement>(".nes-kinetic-action");
    expect(action?.className).not.toContain("uppercase");
    // "powiększ o 1px" + "nie ma być pogrubione" - 11px / 9px, font-normal.
    expect(action?.className).toContain("text-[11px]");
    expect(action?.className).toContain("font-normal");
    expect(action?.className).not.toContain("font-medium");
    // Wnetrze akcji wyjete z globalnej typografii Theme Designu, zeby nie
    // dziedziczylo pogrubienia opisu (waga 800).
    expect(action?.getAttribute("data-typography-exempt")).not.toBeNull();
    // Theme Design per widget (selektor `[data-w-id]x3 [data-description-root]`,
    // 0-4-0 + !important) narzuca „więcej" rozmiar (12 px) i wagę (800) opisu.
    // Kinetic musi więc mieć konkretniejszy selektor (0-5-0) z !important.
    const kineticRule =
      /\[data-w-id\]\[data-w-id\]\[data-w-id\] \.nes-kinetic-shell \.nes-kinetic-action(?: span)? \{([^}]*)\}/g;
    const rules = [...stylesCss.matchAll(kineticRule)].map((m) => m[1]);
    expect(rules.length).toBeGreaterThanOrEqual(2);
    expect(rules.some((r) => /font-size: 11px !important;/.test(r))).toBe(true);
    expect(rules.some((r) => /font-size: 9px !important;/.test(r))).toBe(true);
    expect(rules.some((r) => /font-weight: 400 !important;/.test(r))).toBe(true);
  });

  it("ustawienie strzałki żyje: none zdejmuje ikonę, chevron daje znak", () => {
    const none = renderVariant({ arrow: "none" });
    expect(none.container.querySelector("svg")).toBeNull();
    expect(none.container.textContent).toContain("więcej");
    none.unmount();

    const chevron = renderVariant({ arrow: "chevron" });
    expect(chevron.container.textContent).toContain("\u203A");
    expect(chevron.container.querySelector("svg")).toBeNull();
    chevron.unmount();

    const long = renderVariant({ arrow: "long" });
    expect(long.container.textContent).toContain("\u27F6");
    long.unmount();
  });

  it("linia pod rzędem słucha showRule, a jej oddech słucha gapY", () => {
    const withRule = renderVariant({ showRule: true });
    expect(withRule.container.querySelector(".border-b")).not.toBeNull();
    withRule.unmount();

    const noRule = renderVariant({ showRule: false });
    expect(noRule.container.querySelector(".border-b")).toBeNull();
    noRule.unmount();

    const airy = renderVariant({ showRule: true, gapY: "20px" });
    const row = airy.container.querySelector<HTMLElement>(".border-b");
    expect(row?.style.paddingBottom).toBe("20px");
    airy.unmount();
  });

  it("nie rysuje linii pod etykietą, dopóki opcja „Pokaż linię” nie zostanie włączona", () => {
    // Widget na stronie nie zapisuje `showRule` - liczy się domysł z
    // `readSectionLabelProps`. Kinetic ma go wyłączonym (żadnego podkreślenia
    // pod etykietą), a „Pokaż linię" w panelu go przywraca.
    const base = { variant: V, label_pl: "Najnowszy raport" };
    expect(readSectionLabelProps(base, "pl").showRule).toBe(false);
    expect(readSectionLabelProps({ ...base, showRule: true }, "pl").showRule).toBe(true);
    // Pozostałe warianty nie zmieniają zachowania.
    expect(
      readSectionLabelProps({ variant: "left-bar", label_pl: "Sekcja" }, "pl").showRule,
    ).toBe(true);
  });

  it("akcja nie dostaje podkreślenia w żadnym stanie", () => {
    // `text-decoration` spływa z rodzica na potomnych, więc podkreślenie
    // nadane całemu widżetowi (hover Theme Designu) wylądowałoby pod
    // „więcej". Własne `none` na akcji to odcina.
    expect(stylesCss).toMatch(/\.nes-kinetic-action\s*\{[^}]*text-decoration:\s*none/);
  });

  it("nadpisuje kolor i rozmiar tytułu", () => {
    const { container } = renderVariant({ labelColor: "#123456", labelSize: "16px" });
    const title = container.querySelector<HTMLElement>("[data-title-root]");
    expect(title?.style.color).toMatch(/#123456|rgb\(18, 52, 86\)/i);
    expect(title?.style.fontSize).toBe("16px");
  });

  it("płytkę podglądu (sm) rysuje bez linku", () => {
    const { container } = renderVariant({ size: "sm", href: "/raporty" });
    expect(container.querySelectorAll(".nes-kinetic-bar")).toHaveLength(3);
    expect(container.querySelector("a.nes-kinetic-action")).toBeNull();
    expect(container.querySelector("span.nes-kinetic-action")).not.toBeNull();
    // W pigułce paski mają 2 px, a kreska ptaszka pozostaje od nich cieńsza (0,7 px).
    expect(container.querySelector<HTMLElement>(".nes-kinetic-bar")?.style.height).toBe("2px");
    expect(container.querySelector("svg")?.getAttribute("stroke-width")).toBe("0.7");
  });

  it("bez akcji rysuje sam tytuł z sygnałem", () => {
    const { container } = renderVariant({ action: null });
    expect(container.querySelector(".nes-kinetic-action")).toBeNull();
    expect(container.querySelectorAll(".nes-kinetic-bar")).toHaveLength(3);
    expect(container.textContent).toContain("Najnowszy raport");
  });
});
