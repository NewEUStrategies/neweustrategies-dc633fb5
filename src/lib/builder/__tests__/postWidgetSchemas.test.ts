// GUARD KLASY BŁĘDU: ustawienie widgetu `post-*` nieosiągalne z panelu albo
// nieczytane przez renderer.
//
// Dwie regresje, które ten plik zamyka:
//   1. LUKA EDYTORA - żaden z dziewięciu widgetów dynamicznych nie miał wpisu
//      w `WIDGET_SCHEMAS`, więc panel właściwości pokazywał "Brak edytowalnych
//      pól", a defaulty z rejestru (tag, wariant, separator, limit...) były
//      nieosiągalne z UI.
//   2. MARTWE KLUCZE - rejestr zapisywał `variant` (tagi / kategorie / karta
//      autora), `showSocial` i `showCaption`, których renderer w ogóle nie
//      czytał. Klucz bez czytelnika to ustawienie, które "nic nie robi".
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { WIDGET_SCHEMAS } from "../schemas";
import { WIDGETS } from "../registry";
import type { WidgetType } from "../types";

const DYNAMIC_POST_WIDGETS: ReadonlyArray<WidgetType> = [
  "post-title",
  "post-meta",
  "post-tags-dyn",
  "post-categories-dyn",
  "post-author-card",
  "post-breadcrumbs",
  "post-cover",
  "post-excerpt",
  "archive-title",
];

/** Klucze i18n są zapisywane jako `${key}_pl` / `${key}_en`. */
const I18N_TYPES = new Set(["i18nText", "i18nHtml", "i18nStringArray"]);

function schemaKeys(type: WidgetType): Set<string> {
  const out = new Set<string>();
  for (const field of WIDGET_SCHEMAS[type] ?? []) {
    out.add(field.key);
    if (I18N_TYPES.has(field.type)) {
      out.add(`${field.key}_pl`);
      out.add(`${field.key}_en`);
    }
  }
  return out;
}

const RENDERER_SOURCE = readFileSync(
  resolve(process.cwd(), "src/components/builder/organisms/widget-view/DynamicTagWidgets.tsx"),
  "utf8",
);

describe("schematy widgetów dynamicznych (post-* / archive-title)", () => {
  it.each(DYNAMIC_POST_WIDGETS.map((type) => [type] as const))(
    '"%s" ma niepusty schemat (panel nie pokazuje już "brak edytowalnych pól")',
    (type) => {
      expect(WIDGET_SCHEMAS[type]?.length ?? 0).toBeGreaterThan(0);
    },
  );

  it.each(DYNAMIC_POST_WIDGETS.map((type) => [type] as const))(
    'każdy default rejestru "%s" jest edytowalny z panelu',
    (type) => {
      const def = WIDGETS.find((w) => w.type === type);
      expect(def, `brak widgetu ${type} w rejestrze`).toBeDefined();
      const keys = schemaKeys(type);
      for (const key of Object.keys(def?.defaults() ?? {})) {
        expect(keys.has(key), `klucz "${key}" widgetu ${type} nie ma pola w WIDGET_SCHEMAS`).toBe(
          true,
        );
      }
    },
  );

  it("przełączniki są prawdziwymi booleanami (`bool`), nie selectem 0/1", () => {
    for (const type of DYNAMIC_POST_WIDGETS) {
      for (const field of WIDGET_SCHEMAS[type] ?? []) {
        if (!/^show|^require|^rounded$|^linkTo/.test(field.key)) continue;
        expect(field.type, `${type}.${field.key} powinno być typu "bool"`).toBe("bool");
        const values = (field.options ?? []).map((o) => o.value);
        expect(values).not.toContain("0");
      }
    }
  });

  it("każdy default rejestru ma czytelnika w rendererze (koniec martwych kluczy)", () => {
    for (const type of DYNAMIC_POST_WIDGETS) {
      const def = WIDGETS.find((w) => w.type === type);
      for (const key of Object.keys(def?.defaults() ?? {})) {
        // i18n: renderer czyta bazę klucza (pickI18n), nie sufiks _pl/_en.
        const base = key.replace(/_(pl|en)$/, "");
        expect(
          RENDERER_SOURCE.includes(`c.${base}`) || RENDERER_SOURCE.includes(`"${base}"`),
          `renderer nie czyta klucza "${key}" widgetu ${type}`,
        ).toBe(true);
      }
    }
  });

  it("selecty wariantów wystawiają dokładnie warianty, które renderer umie narysować", () => {
    const variantsOf = (type: WidgetType) =>
      (WIDGET_SCHEMAS[type] ?? []).find((f) => f.key === "variant")?.options?.map((o) => o.value) ??
      [];
    expect(variantsOf("post-tags-dyn")).toEqual(["pill", "outline", "text"]);
    expect(variantsOf("post-categories-dyn")).toEqual(["pill", "outline", "text"]);
    expect(variantsOf("post-author-card")).toEqual(["card", "inline", "centered"]);
    for (const variant of ["pill", "outline", "text", "card", "inline", "centered"]) {
      expect(RENDERER_SOURCE).toContain(`"${variant}"`);
    }
  });
});
