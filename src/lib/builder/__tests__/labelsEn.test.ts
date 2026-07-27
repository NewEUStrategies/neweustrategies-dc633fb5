/**
 * Guard: every Polish label that the builder's data modules feed straight into
 * the editor UI must have an English rendering in `BUILDER_LABELS_EN`.
 *
 * The widget palette, the properties panel and the variant pickers are driven
 * by plain data (WIDGET_SCHEMAS / WIDGETS / *_VARIANTS), whose labels are
 * authored in Polish. `builderLabel()` maps them to English for EN admins; this
 * test fails when a new Polish label lands without a translation, which would
 * otherwise silently leak Polish into the English editor.
 */
import { describe, it, expect } from "vitest";
import { BUILDER_LABELS_EN, builderLabel } from "../labelsEn";
import { WIDGET_SCHEMAS } from "../schemas";
import { WIDGETS } from "../registry";
import { SLIDER_VARIANTS, NAV_ARROW_VARIANTS } from "../sliderVariants";
import { SECTION_LABEL_VARIANTS } from "../sectionLabelVariants";
import { ANIMATED_SHAPES, ANIMATED_MODES } from "../animatedHeadingVariants";
import { SIDEBAR_STYLES, SIDEBAR_ICON_FIELDS } from "../sidebarStyles";
import { DYNAMIC_TAG_GROUPS } from "../dynamicText";
import { EDIT_TARGET_META } from "../editTargets";
import { GLOBAL_COLOR_GROUPS, GLOBAL_COLOR_CATEGORIES } from "../globalColors";

/** Entries whose English rendering is legitimately the Polish source string. */
const IDENTICAL_IN_ENGLISH = new Set(["PLN (zł)"]);

/**
 * Strings that read as Polish and therefore need an English counterpart.
 * Words that are spelled the same in English (data, link, menu, slug, limit,
 * url) are deliberately absent - they would flag genuinely English labels such
 * as "Link Color" or "Header - Icons & Menu".
 */
const PL_DIACRITIC = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;
const PL_WORDS =
  /\b(aby|akcji|autor|autora|bez|brak|celu|czas|dane|dla|domyślnie|etykieta|firma|głos|ikona|ikony|imię|jest|karta|kolor|kolory|kolumny|komunikat|lewa|lewo|liczba|lista|mapa|między|nazwa|nie|obraz|obrazek|odstęp|opis|pole|pola|pozycja|prawa|prawo|przycisk|puste|rozmiar|siatka|sortowanie|strona|szerokość|tak|tekst|tło|treść|tytuł|ukryj|układ|użyj|wariant|wideo|widoczność|wpis|wpisu|wpisy|wybierz|wygląd|wysokość|zajawka|zdjęcie|źródło)\b/i;

function needsTranslation(s: string): boolean {
  const v = s.trim();
  if (v.length < 2) return false;
  return PL_DIACRITIC.test(v) || PL_WORDS.test(v);
}

/** Every user-visible label the data modules hand to the editor. */
function collectLabels(): Map<string, string> {
  const out = new Map<string, string>();
  const add = (value: string | undefined, origin: string) => {
    if (typeof value !== "string" || !value.trim()) return;
    if (!out.has(value)) out.set(value, origin);
  };

  for (const [type, fields] of Object.entries(WIDGET_SCHEMAS)) {
    for (const f of fields ?? []) {
      add(f.label, `WIDGET_SCHEMAS.${type}.${f.key}.label`);
      add(f.hint, `WIDGET_SCHEMAS.${type}.${f.key}.hint`);
      add(f.placeholder, `WIDGET_SCHEMAS.${type}.${f.key}.placeholder`);
      add(f.group, `WIDGET_SCHEMAS.${type}.${f.key}.group`);
      for (const o of f.options ?? []) add(o.label, `WIDGET_SCHEMAS.${type}.${f.key}.option`);
    }
  }
  for (const w of WIDGETS) add(w.label, `WIDGETS.${w.type}.label`);
  for (const v of SLIDER_VARIANTS) add(v.label, `SLIDER_VARIANTS.${v.value}`);
  for (const v of NAV_ARROW_VARIANTS) add(v.label, `NAV_ARROW_VARIANTS.${v.value}`);
  for (const v of SECTION_LABEL_VARIANTS) add(v.label, `SECTION_LABEL_VARIANTS.${v.value}`);
  for (const v of ANIMATED_SHAPES) add(v.label, `ANIMATED_SHAPES.${v.value}`);
  for (const v of ANIMATED_MODES) add(v.label, `ANIMATED_MODES.${v.value}`);
  for (const s of SIDEBAR_STYLES) {
    add(s.label, `SIDEBAR_STYLES.${s.id}.label`);
    add(s.hint, `SIDEBAR_STYLES.${s.id}.hint`);
  }
  for (const f of SIDEBAR_ICON_FIELDS) {
    add(f.label, `SIDEBAR_ICON_FIELDS.${f.key}.label`);
    add(f.hint, `SIDEBAR_ICON_FIELDS.${f.key}.hint`);
  }
  for (const g of DYNAMIC_TAG_GROUPS) {
    for (const tag of g.tags) add(tag.label, `DYNAMIC_TAG_GROUPS.${tag.token}`);
  }
  for (const [key, meta] of Object.entries(EDIT_TARGET_META)) {
    add(meta.label, `EDIT_TARGET_META.${key}.label`);
  }
  for (const c of GLOBAL_COLOR_CATEGORIES) add(c.label, `GLOBAL_COLOR_CATEGORIES.${c.id}`);
  for (const g of GLOBAL_COLOR_GROUPS) {
    add(g.label, `GLOBAL_COLOR_GROUPS.${g.id}.label`);
    for (const s of g.slots) {
      add(s.label, `GLOBAL_COLOR_GROUPS.${g.id}.${s.key}.label`);
      add(s.description, `GLOBAL_COLOR_GROUPS.${g.id}.${s.key}.description`);
    }
  }
  return out;
}

describe("builder data-module labels have English translations", () => {
  const labels = collectLabels();

  it("collects labels from every data module", () => {
    expect(labels.size).toBeGreaterThan(500);
  });

  it("every Polish-looking label is translated", () => {
    const missing = [...labels.entries()]
      .filter(([value]) => needsTranslation(value))
      .filter(([value]) => !(value in BUILDER_LABELS_EN))
      .map(([value, origin]) => `${origin}: ${JSON.stringify(value)}`);
    expect(missing, `untranslated builder labels:\n${missing.join("\n")}`).toEqual([]);
  });

  it("no translation entry is a leftover copy of the Polish source", () => {
    const identical = Object.entries(BUILDER_LABELS_EN)
      .filter(([pl, en]) => pl === en && PL_DIACRITIC.test(pl))
      .filter(([pl]) => !IDENTICAL_IN_ENGLISH.has(pl))
      .map(([pl]) => pl);
    expect(identical, `entries left untranslated: ${identical.join(", ")}`).toEqual([]);
  });

  it("no dictionary entry is dead weight", () => {
    const unused = Object.keys(BUILDER_LABELS_EN).filter((pl) => !labels.has(pl));
    expect(unused, `dictionary entries not used by any data module:\n${unused.join("\n")}`).toEqual(
      [],
    );
  });
});

describe("builderLabel", () => {
  it("passes Polish through untouched", () => {
    expect(builderLabel("Nagłówek", "pl")).toBe("Nagłówek");
  });

  it("translates for English", () => {
    expect(builderLabel("Nagłówek", "en")).toBe("Heading");
  });

  it("falls back to the source string when untranslated", () => {
    expect(builderLabel("Zupełnie nowa etykieta", "en")).toBe("Zupełnie nowa etykieta");
  });

  it("passes undefined through", () => {
    expect(builderLabel(undefined, "en")).toBeUndefined();
  });
});
