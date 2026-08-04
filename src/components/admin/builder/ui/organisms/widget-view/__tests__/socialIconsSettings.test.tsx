// Ikony social: każde ustawienie z panelu musi realnie działać, w KAŻDYM
// układzie.
//
// Regresje przypięte tutaj:
//  1. renderer czytał `ctaSpotify`, ale schemat nie miał takiego pola - CTA
//     Spotify było nieedytowalne (martwe ustawienie w drugą stronę),
//  2. układ „lista" ignorował `gap`, `bgMode` i `customBgColor` - te same
//     kontrolki działały tylko w układzie „rząd",
//  3. przy domyślnym `themeAdapt: "auto"` wybór colorMode dark/light był
//     no-opem (zawsze currentColor), więc kontrolka wyglądała na zepsutą.
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { WidgetContent, WidgetNode } from "@/lib/builder/types";
import { WIDGET_SCHEMAS } from "@/lib/builder/schemas";
import { renderSimpleWidget } from "../SimpleWidgets";

function Social({ content }: { content: WidgetContent }) {
  const node: WidgetNode = { id: "soc-1", kind: "widget", type: "social-icons", content };
  return <>{renderSimpleWidget(node, "pl", undefined, false)}</>;
}

const paint = (content: WidgetContent) => render(<Social content={content} />).container;

const ALL_LINKS: WidgetContent = {
  facebook: "https://facebook.com/nes",
  twitter: "https://x.com/nes",
  youtube: "https://youtube.com/@nes",
  instagram: "https://instagram.com/nes",
  linkedin: "https://linkedin.com/company/nes",
  spotify: "https://open.spotify.com/artist/nes",
};

const ctaFields = (WIDGET_SCHEMAS["social-icons"] ?? []).filter((f) => f.key.startsWith("cta"));

describe("social-icons - CTA dla każdej obsługiwanej platformy", () => {
  it("declares a CTA field for every platform the renderer supports", () => {
    expect(ctaFields.map((f) => f.key).sort()).toEqual([
      "ctaFacebook",
      "ctaInstagram",
      "ctaLinkedin",
      "ctaNewsletter",
      "ctaSpotify",
      "ctaX",
      "ctaYoutube",
    ]);
  });

  it("shows every schema CTA field in the list layout (no orphan keys)", () => {
    const content: WidgetContent = { ...ALL_LINKS, layout: "list" };
    for (const field of ctaFields) content[field.key] = `CTA-${field.key}`;
    const container = paint(content);

    for (const field of ctaFields) {
      expect(container.textContent).toContain(`CTA-${field.key}`);
    }
  });

  it("keeps the CTA fields editable only for the list layout", () => {
    for (const field of ctaFields) {
      expect(field.visibleWhen?.({ layout: "list" })).toBe(true);
      expect(field.visibleWhen?.({ layout: "row" })).toBe(false);
    }
  });

  it("renders the newsletter row with a localized default CTA", () => {
    const container = paint({ ...ALL_LINKS, layout: "list" });
    expect(container.textContent).toContain("Newsletter");
    expect(container.textContent).toContain("Obserwuj");
  });
});

describe("social-icons - układ listy honoruje te same ustawienia co rząd", () => {
  it("applies the gap between rows", () => {
    const container = paint({ ...ALL_LINKS, layout: "list", gap: 12 });
    const list = container.firstElementChild as HTMLElement;
    expect(list.style.gap).toBe("12px");
  });

  it("paints the custom icon background in the list layout too", () => {
    const list = paint({
      facebook: ALL_LINKS.facebook,
      layout: "list",
      bgMode: "custom",
      customBgColor: "#001122",
    });
    const chip = list.querySelector("a > span") as HTMLElement;
    expect(chip.style.backgroundColor).toBe("#001122");

    const rowLayout = paint({
      facebook: ALL_LINKS.facebook,
      bgMode: "custom",
      customBgColor: "#001122",
    });
    expect((rowLayout.querySelector("a") as HTMLElement).style.backgroundColor).toBe("#001122");
  });

  it("uses the official brand background with contrast text in the list layout", () => {
    const container = paint({
      facebook: ALL_LINKS.facebook,
      layout: "list",
      bgMode: "official",
      colorMode: "official",
    });
    const chip = container.querySelector("a > span") as HTMLElement;
    expect(chip.style.backgroundColor).toBe("#1877F2");
    expect(chip.style.color).toBe("#fff");
  });

  it("rejects an unsafe custom background instead of writing it into CSS", () => {
    const container = paint({
      facebook: ALL_LINKS.facebook,
      bgMode: "custom",
      customBgColor: "url(javascript:alert(1))",
    });
    expect((container.querySelector("a") as HTMLElement).style.backgroundColor).toBe("");
    expect(container.innerHTML).not.toContain("javascript:");
  });
});

describe("social-icons - jawny colorMode wygrywa z adaptacją motywu", () => {
  it.each([
    ["dark", "#0a0a0a"],
    ["light", "#ffffff"],
  ])("keeps colorMode %s effective with the default themeAdapt", (colorMode, expected) => {
    const container = paint({ facebook: ALL_LINKS.facebook, colorMode });
    expect((container.querySelector("a") as HTMLElement).style.color).toBe(expected);
  });

  it.each(["auto", "off", "force-light", "force-dark"])(
    "resolves the same explicit color for themeAdapt %s",
    (themeAdapt) => {
      const container = paint({ facebook: ALL_LINKS.facebook, colorMode: "dark", themeAdapt });
      expect((container.querySelector("a") as HTMLElement).style.color).toBe("#0a0a0a");
    },
  );

  it("leaves the inherited mode on the theme ink (no inline colour)", () => {
    // Bez jawnego colorMode ikona DZIEDZICZY `text-foreground` kontenera:
    // ciemny atrament w light mode, biel w dark mode. Tak wygląda publiczna
    // strona kontaktu i tak MUSI wyglądać kanwa - żaden token pośredni, bo
    // domieszka marki liczona `color-mix` rozjeżdżała oba widoki.
    const container = paint({ facebook: ALL_LINKS.facebook });
    expect((container.querySelector("a") as HTMLElement).style.color).toBe("");
  });

  it("keeps the official mode on the RAW brand colour", () => {
    const container = paint({ facebook: ALL_LINKS.facebook, colorMode: "official" });
    expect((container.querySelector("a") as HTMLElement).style.color).toBe("#1877F2");
  });

  it("documents the precedence in the editor hints", () => {
    const fields = WIDGET_SCHEMAS["social-icons"] ?? [];
    expect(fields.find((f) => f.key === "colorMode")?.hint).toBeTruthy();
    expect(fields.find((f) => f.key === "themeAdapt")?.hint).toBeTruthy();
  });
});
