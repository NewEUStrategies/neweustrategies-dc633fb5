// Kontrakt strony /support: dokument opublikowany w panelu ma wygrywać
// z wbudowanym formularzem, ale tylko wtedy, gdy faktycznie coś zawiera.
// Testujemy predykat na strukturach body, bo to on decyduje o przełączeniu
// widoku (i o tym, że pusta strona nie „zjada" formularza darowizn).
import { describe, expect, it } from "vitest";

import { hasRenderableBody } from "@/lib/access/gating";

const empty = {
  content_pl: null,
  content_en: null,
  builder_data: null,
  blocks_data: null,
};

describe("/support - wybór źródła treści", () => {
  it("pusta strona nie przesłania formularza darowizn", () => {
    expect(hasRenderableBody(empty)).toBe(false);
    expect(hasRenderableBody({ ...empty, builder_data: { sections: [] } })).toBe(false);
  });

  it("dokument buildera z sekcją przejmuje widok", () => {
    const doc = {
      ...empty,
      builder_data: {
        sections: [{ id: "s1", columns: [{ id: "c1", width: 12, widgets: [] }] }],
      },
    };
    expect(hasRenderableBody(doc)).toBe(true);
  });

  it("treść blokowa w dowolnym języku też przejmuje widok", () => {
    expect(
      hasRenderableBody({
        ...empty,
        blocks_data: { pl: { blocks: [{ type: "paragraph" }] } },
      }),
    ).toBe(true);
  });

  it("legacy HTML również liczy się jako treść", () => {
    expect(hasRenderableBody({ ...empty, content_pl: "<p>Wesprzyj nas</p>" })).toBe(true);
  });
});
