import { describe, expect, it } from "vitest";
import { ENTITY_SELECT_COLS, TAKEAWAYS_SELECT_COLS } from "@/lib/queries/public";

/**
 * Kontrakt selectu: sekcja "dowiesz się, że..." działa end-to-end tylko wtedy,
 * gdy kolumny są POBIERANE dla każdej encji, która je renderuje. Render w
 * `routes/$.tsx` nie ma bramki `isPost`, więc wypadnięcie kolumn ze selectu
 * STRON cicho zabiłoby sekcję na stronach - dokładnie ten wniosek dwa audyty
 * (07-30, 08-01) zapisały jako fakt, choć kod działał.
 */
describe("kontrakt kolumn takeaways w selectach encji", () => {
  const expected = ["takeaways_pl", "takeaways_en", "takeaways_variant"] as const;

  it("stała kolumn zawiera dokładnie trzy pola sekcji", () => {
    const cols = TAKEAWAYS_SELECT_COLS.split(",").map((c) => c.trim());
    expect(cols).toEqual([...expected]);
  });

  for (const entity of ["post", "page", "homepage"] as const) {
    it(`select encji "${entity}" pobiera wszystkie kolumny sekcji`, () => {
      const select = ENTITY_SELECT_COLS[entity];
      for (const col of expected) {
        expect(select).toContain(col);
      }
    });
  }

  it("select strony niesie też własne pola stron (szablon/nagłówek)", () => {
    expect(ENTITY_SELECT_COLS.page).toContain("template_type");
    expect(ENTITY_SELECT_COLS.page).toContain("header_override");
  });

  it("select wpisu niesie pola postowe, a select strony ich nie udaje", () => {
    expect(ENTITY_SELECT_COLS.post).toContain("read_minutes");
    expect(ENTITY_SELECT_COLS.post).toContain("post_format");
    expect(ENTITY_SELECT_COLS.page).not.toContain("read_minutes");
    expect(ENTITY_SELECT_COLS.page).not.toContain("post_format");
  });

  it("żaden select encji nie ciągnie kolumn body - te idą przez gated RPC", () => {
    for (const select of Object.values(ENTITY_SELECT_COLS)) {
      expect(select).not.toContain("content_pl");
      expect(select).not.toContain("content_en");
      expect(select).not.toContain("builder_data");
      expect(select).not.toContain("blocks_data");
    }
  });
});
