// Bramka na "ustawienia widmo": pola schematu, których ŻADEN renderer nie
// czyta. Każde takie pole to obietnica złożona redakcji i niedotrzymana -
// użytkownik przestawia kontrolkę, klika Zapisz i nic się nie dzieje.
//
// Reguła po naprawie:
//  - `heading.authorSizePx` / `heading.authorAvatarSizePx` NIE ISTNIEJĄ.
//    Były skopiowane ze schematu slidera; czyta je wyłącznie sliderVariants,
//    a renderer nagłówka nigdy o nich nie słyszał.
//  - `gallery.lightbox` ISTNIEJE i jest prawdziwym booleanem, bo funkcja
//    została dowieziona (GalleryLightbox), a nie wycięta.
//  - przełączniki TOC są `bool`, nie `select` z "0"/"1" (string "0" jest
//    prawdziwy - dokładnie tak gubiono wyłączone ustawienia).
import { describe, it, expect } from "vitest";
import { WIDGET_SCHEMAS, type SchemaField } from "../schemas";

const fieldsOf = (type: keyof typeof WIDGET_SCHEMAS): ReadonlyArray<SchemaField> =>
  WIDGET_SCHEMAS[type] ?? [];

const keysOf = (type: keyof typeof WIDGET_SCHEMAS): string[] => fieldsOf(type).map((f) => f.key);

describe("schemat nagłówka nie deklaruje pól slidera", () => {
  it.each(["authorSizePx", "authorAvatarSizePx"])("drops %s", (key) => {
    expect(keysOf("heading")).not.toContain(key);
  });

  it("keeps the heading fields that renderers really read", () => {
    const keys = keysOf("heading");
    for (const key of ["text", "subtitle", "sizePx", "subtitleSizePx", "variant"]) {
      expect(keys).toContain(key);
    }
  });
});

describe("gallery.lightbox jest dowiezione, nie usunięte", () => {
  const lightbox = fieldsOf("gallery").find((f) => f.key === "lightbox");

  it("stays in the schema", () => {
    expect(lightbox).toBeDefined();
  });

  it("is a real boolean switch instead of an on/off select", () => {
    expect(lightbox?.type).toBe("bool");
    expect(lightbox?.options).toBeUndefined();
    expect(lightbox?.default).toBe(false);
  });

  it("tells the editor what the switch actually does", () => {
    expect(lightbox?.hint).toBeTruthy();
  });
});

describe("przełączniki TOC są booleanami", () => {
  it.each(["showNumbers", "showProgress", "sticky"])("%s is a bool field", (key) => {
    const field = fieldsOf("toc").find((f) => f.key === key);
    expect(field?.type).toBe("bool");
    expect(typeof field?.default).toBe("boolean");
  });

  it("keeps numbering on by default", () => {
    expect(fieldsOf("toc").find((f) => f.key === "showNumbers")?.default).toBe(true);
  });
});
