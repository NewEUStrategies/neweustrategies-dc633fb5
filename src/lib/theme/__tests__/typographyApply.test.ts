import { describe, it, expect } from "vitest";
import {
  stripInlineTypography,
  stripTypographyDeclarations,
  stripTypographyFromJson,
  buildTypographyPatch,
} from "@/lib/theme/typographyApply";

describe("typographyApply", () => {
  it("usuwa deklaracje typografii, zostawia resztę", () => {
    expect(stripTypographyDeclarations("color: red; font-size: 22px; margin: 0")).toBe(
      "color: red; margin: 0",
    );
    expect(stripTypographyDeclarations("line-height: 2; font-family: Arial")).toBe("");
  });

  it("czyści inline typografię w HTML zachowując pozostałe style", () => {
    const html = '<p style="font-size:22px;color:#111">A</p><p style="line-height:3">B</p>';
    expect(stripInlineTypography(html)).toBe('<p style="color:#111">A</p><p>B</p>');
  });

  it("czyści klucze typografii w JSON bloków", () => {
    const json = stripTypographyFromJson({
      blocks: [
        { type: "paragraph", fontSize: 22, data: { html: '<em style="line-height:3">x</em>' } },
      ],
    });
    expect(JSON.stringify(json)).not.toContain("fontSize");
    expect(JSON.stringify(json)).not.toContain("line-height");
  });

  it("zwraca null gdy wpis już dziedziczy motyw", () => {
    expect(
      buildTypographyPatch({
        id: "1",
        slug: "a",
        title: "A",
        content_pl: "<p>czysty</p>",
        content_en: null,
        blocks_data: null,
        builder_data: null,
      }),
    ).toBeNull();
  });

  it("zwraca patch dla wpisu z zaszytą typografią", () => {
    const patch = buildTypographyPatch({
      id: "1",
      slug: "a",
      title: "A",
      content_pl: '<p style="font-size:30px">x</p>',
      content_en: null,
      blocks_data: null,
      builder_data: null,
    });
    expect(patch?.content_pl).toBe("<p>x</p>");
    expect(patch?.content_en).toBeUndefined();
  });
});
