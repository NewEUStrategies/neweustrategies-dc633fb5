// Ikony social - podświetlenie po najechaniu.
//
// Regresje przypięte tutaj:
//  1. IKONA NIE ROZJAŚNIAŁA SIĘ W LIGHT MODE. Kafelek trzyma kolor w atrybucie
//     `style`, a reguła hovera była zapisana klasą `group-hover:![color:etc]` -
//     składnią ważności z Tailwinda 3, która w wersji 4 NIE GENERUJE żadnego
//     CSS. Efekt: wiersz robił się kolorowy, ikona zostawała ciemna. Dziś kolor
//     ikony na hoverze idzie z arkusza instancji, z `!important`.
//  2. USTAWIENIE DZIAŁAŁO TYLKO W JEDNYM UKŁADZIE - kafelek w układzie „rząd"
//     nie dostawał nic z konfiguracji hovera.
//  3. PODGLĄD W PANELU NIE POKAZYWAŁ HOVERU (miniatura nie ma kursora), więc
//     kolory dobierało się na ślepo. Wymuszony stan MUSI iść tą samą regułą co
//     `:hover`, inaczej podgląd kłamie.
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { WidgetContent, WidgetNode } from "@/lib/builder/types";
import { WIDGET_SCHEMAS } from "@/lib/builder/schemas";
import { renderSimpleWidget } from "../SimpleWidgets";
import {
  SB_CHIP,
  SB_ROW,
  SB_TILE,
  SOCIAL_HOUSE_GRADIENTS,
  SOCIAL_HOVER_ICON_MODES,
  SOCIAL_HOVER_PREVIEW_ATTR,
  SOCIAL_HOUSE_TONES,
  SOCIAL_ROW_HOVER_MODES,
  socialHoverGradient,
  socialHoverIconColor,
  socialHoverStyle,
  type SocialHoverPlan,
} from "../socialHover";

function paint(content: WidgetContent): HTMLElement {
  const node: WidgetNode = { id: "soc-hover", kind: "widget", type: "social-icons", content };
  return render(<>{renderSimpleWidget(node, "pl", undefined, false)}</>).container;
}

const LINKS: WidgetContent = {
  facebook: "https://facebook.com/nes",
  youtube: "https://youtube.com/@nes",
};

const sheet = (container: HTMLElement): string =>
  [...container.querySelectorAll("style")].map((s) => s.textContent ?? "").join("");

const plan = (over: Partial<SocialHoverPlan> = {}): SocialHoverPlan => ({
  mode: "brand",
  tone: "amber",
  iconMode: "auto",
  rowColor: "",
  iconColor: "",
  ...over,
});

describe("social-icons - ikona po najechaniu jest jasna także w light mode", () => {
  it("wymusza kolor ikony regułą arkusza, nie klasą (inline style trzeba przebić)", () => {
    const css = sheet(paint({ ...LINKS, layout: "list" }));
    expect(css).toMatch(new RegExp(`\\.${SB_CHIP}[^{]*\\{color:var\\(--sb-ico-h\\)!important\\}`));
    expect(css).toContain(`.${SB_CHIP} svg`);
    expect(css).not.toContain("group-hover");
  });

  it.each(["inherit", "dark", "official", "brand", "custom", "light"])(
    "rozjaśnia ikonę na hoverze niezależnie od colorMode %s",
    (colorMode) => {
      const container = paint({ ...LINKS, layout: "list", colorMode, customColor: "#123456" });
      const row = container.querySelector(`.${SB_ROW}`) as HTMLElement;
      // Ton hovera jedzie zmienną wiersza, więc reguła arkusza rozwiązuje go
      // do bieli bez względu na to, co kafelek ma w `style`.
      expect(row.style.getPropertyValue("--sb-ico-h")).toBe("#ffffff");
    },
  );

  it("nie zostawia w kodzie martwej składni ważności z Tailwinda 3", () => {
    const container = paint({ ...LINKS, layout: "list" });
    expect(container.innerHTML).not.toContain(":!");
  });
});

describe("social-icons - hover jest ustawieniem, w obu układach", () => {
  it.each(SOCIAL_ROW_HOVER_MODES)("stosuje tryb %s w liście i w rzędzie", (rowHover) => {
    const list = paint({ ...LINKS, layout: "list", rowHover });
    const row = list.querySelector(`.${SB_ROW}`) as HTMLElement;
    const expected = socialHoverGradient(plan({ mode: rowHover }), "facebook") ?? "none";
    expect(row.style.getPropertyValue("--sb-grad")).toBe(expected);

    const rowLayout = paint({ ...LINKS, rowHover });
    const tile = rowLayout.querySelector("a") as HTMLElement;
    expect(tile.style.getPropertyValue("--sb-grad")).toBe(expected);
    // Kafelek w układzie „rząd" bierze tę samą regułę tła co wiersz listy.
    if (rowHover !== "none") expect(tile.className).toContain(SB_TILE);
  });

  it.each(SOCIAL_HOVER_ICON_MODES)("stosuje ton ikony %s", (hoverIconMode) => {
    const container = paint({
      ...LINKS,
      layout: "list",
      hoverIconMode,
      hoverIconColor: "#00ff88",
    });
    const row = container.querySelector(`.${SB_ROW}`) as HTMLElement;
    const expected =
      socialHoverIconColor(plan({ iconMode: hoverIconMode, iconColor: "#00ff88" }), "facebook") ??
      "currentColor";
    expect(row.style.getPropertyValue("--sb-ico-h")).toBe(expected);
  });

  it("bierze oficjalny kolor marki per platforma w trybie „official”", () => {
    const container = paint({ ...LINKS, layout: "list", hoverIconMode: "official" });
    const rows = [...container.querySelectorAll(`.${SB_ROW}`)] as HTMLElement[];
    const tones = rows.map((r) => r.style.getPropertyValue("--sb-ico-h"));
    expect(tones).toContain("#1877F2"); // Facebook
    expect(tones).toContain("#FF0000"); // YouTube
    // Newsletter to nasza marka - nie ma oficjalnego koloru obcego serwisu.
    expect(tones).toContain("var(--brand)");
  });

  it("odrzuca niebezpieczny własny kolor zamiast wpisać go w CSS", () => {
    const container = paint({
      ...LINKS,
      layout: "list",
      rowHover: "custom",
      rowHoverColor: "url(javascript:alert(1))",
      hoverIconMode: "custom",
      hoverIconColor: "expression(alert(1))",
    });
    expect(container.innerHTML).not.toContain("javascript:");
    expect(container.innerHTML).not.toContain("expression(");
  });

  it("nie generuje arkusza, gdy hover nie zmienia niczego", () => {
    expect(socialHoverStyle(plan({ mode: "none", iconMode: "keep" }))).toBeNull();
    const container = paint({ ...LINKS, layout: "list", rowHover: "none", hoverIconMode: "keep" });
    expect(container.querySelector("style")).toBeNull();
  });
});

describe("social-icons - podgląd hovera w panelu używa tej samej reguły", () => {
  it("dopisuje selektor wymuszonego stanu obok :hover i :focus-visible", () => {
    const css = sheet(paint({ ...LINKS, layout: "list" }));
    const { uid } = socialHoverStyle(plan())!;
    expect(css).toContain(`.${uid} .${SB_ROW}:hover`);
    expect(css).toContain(`.${uid} .${SB_ROW}:focus-visible`);
    expect(css).toContain(`[${SOCIAL_HOVER_PREVIEW_ATTR}] .${uid} .${SB_ROW}`);
  });

  it("nadaje kontenerowi klasę instancji, którą celują reguły", () => {
    const container = paint({ ...LINKS, layout: "list" });
    const { uid } = socialHoverStyle(plan())!;
    expect((container.firstElementChild as HTMLElement).className).toContain(uid);
  });

  it("zmiana ustawienia zmienia arkusz (podgląd nie może zostać w tyle)", () => {
    const amber = sheet(paint({ ...LINKS, layout: "list", rowHover: "house" }));
    const outline = sheet(paint({ ...LINKS, layout: "list", rowHover: "outline" }));
    expect(amber).not.toBe(outline);
    expect(outline).toContain("border-color:var(--brand)");
  });
});

describe("social-icons - tonacje firmowego gradientu", () => {
  it("każda tonacja ze schematu ma rampę w rendererze", () => {
    const field = (WIDGET_SCHEMAS["social-icons"] ?? []).find((f) => f.key === "newsletterTone");
    expect(field?.options?.map((o) => o.value).sort()).toEqual([...SOCIAL_HOUSE_TONES].sort());
    for (const tone of SOCIAL_HOUSE_TONES)
      expect(SOCIAL_HOUSE_GRADIENTS[tone]).toContain("var(--brand)");
  });

  it("wiersz newslettera bierze wybraną tonację, a nie paletę obcej marki", () => {
    const container = paint({ ...LINKS, layout: "list", newsletterTone: "ember" });
    const rows = [...container.querySelectorAll(`.${SB_ROW}`)] as HTMLElement[];
    const newsletter = rows[rows.length - 1];
    expect(newsletter.style.getPropertyValue("--sb-grad")).toBe(SOCIAL_HOUSE_GRADIENTS.ember);
  });

  it("tryb „firmowy pomarańcz” daje jedną tonację wszystkim wierszom", () => {
    const container = paint({
      ...LINKS,
      layout: "list",
      rowHover: "house",
      newsletterTone: "cognac",
    });
    const grads = [...container.querySelectorAll(`.${SB_ROW}`)].map((r) =>
      (r as HTMLElement).style.getPropertyValue("--sb-grad"),
    );
    expect(new Set(grads)).toEqual(new Set([SOCIAL_HOUSE_GRADIENTS.cognac]));
  });

  it("każda rampa jest ciepła i kończy się ciemno (białe CTA musi być czytelne)", () => {
    for (const tone of SOCIAL_HOUSE_TONES) {
      const ramp = SOCIAL_HOUSE_GRADIENTS[tone];
      // Ostatni przystanek miesza najmniej brandu - im mniej, tym ciemniej.
      const mixes = [...ramp.matchAll(/var\(--brand\) (\d+)%/g)].map((m) => Number(m[1]));
      expect(mixes.length).toBeGreaterThanOrEqual(3);
      expect(mixes[mixes.length - 1]).toBeLessThan(mixes[0]);
      expect(mixes[0]).toBeLessThanOrEqual(70);
    }
  });
});

describe("social-icons - CTA per język", () => {
  it("panel oferuje CTA w PL i EN (klucze, które czyta renderer)", () => {
    const ctaFields = (WIDGET_SCHEMAS["social-icons"] ?? []).filter((f) => f.key.startsWith("cta"));
    expect(ctaFields.length).toBeGreaterThan(0);
    for (const field of ctaFields) expect(field.type).toBe("i18nText");
  });

  it("używa wersji językowej, a nie drugiego języka", () => {
    const content: WidgetContent = {
      ...LINKS,
      layout: "list",
      ctaFacebook_pl: "Polub nas",
      ctaFacebook_en: "Like us",
    };
    expect(paint(content).textContent).toContain("Polub nas");
    expect(paint(content).textContent).not.toContain("Like us");
  });

  it("czyta klucz bezjęzykowy tylko wtedy, gdy nie ma ŻADNEJ wersji językowej", () => {
    // Treść sprzed migracji - musi się dalej renderować.
    const legacy = paint({ ...LINKS, layout: "list", ctaFacebook: "Zajrzyj" });
    expect(legacy.textContent).toContain("Zajrzyj");

    // Gdy istnieje wersja EN, puste PL NIE podstawia starej etykiety ani
    // angielskiego tekstu - wraca wbudowane CTA w języku strony.
    const localized = paint({
      ...LINKS,
      layout: "list",
      ctaFacebook: "Zajrzyj",
      ctaFacebook_en: "Peek",
    });
    expect(localized.textContent).not.toContain("Zajrzyj");
    expect(localized.textContent).not.toContain("Peek");
    expect(localized.textContent).toContain("Polub to");
  });
});
