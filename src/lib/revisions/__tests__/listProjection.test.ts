import { describe, expect, it } from "vitest";
import {
  PRE_RESTORE_NOTE,
  REVISION_LIST_FIELDS,
  isPreRestoreEntry,
  projectRevisionList,
  projectRevisionListItem,
  type RevisionRow,
} from "../listProjection";

function row(over: Partial<RevisionRow> = {}): RevisionRow {
  return {
    id: "rev-1",
    created_at: "2026-08-18T10:00:00.000Z",
    author_id: "user-1",
    note: null,
    snapshot: { title_pl: "Tytuł", title_en: "Title", status: "draft", editor: "blocks" },
    ...over,
  };
}

describe("projectRevisionListItem", () => {
  it("wystawia identyfikator, czas, autora i notę wprost z wiersza", () => {
    const item = projectRevisionListItem(row({ note: "ręczna kopia" }));
    expect(item.id).toBe("rev-1");
    expect(item.created_at).toBe("2026-08-18T10:00:00.000Z");
    expect(item.author_id).toBe("user-1");
    expect(item.note).toBe("ręczna kopia");
  });

  it("wyciąga z migawki DOKŁADNIE cztery pola listy", () => {
    const item = projectRevisionListItem(row());
    expect(item.title_pl).toBe("Tytuł");
    expect(item.title_en).toBe("Title");
    expect(item.status).toBe("draft");
    expect(item.editor).toBe("blocks");
  });

  it("REGRESJA: migawka NIE wychodzi na wylot", () => {
    // Lista ma do 50 wierszy, a każda migawka to komplet 40 pól wpisu razem
    // z dokumentem buildera i blokami obu języków. Przepuszczenie ich zamieniłoby
    // listę historii w transfer liczony w megabajtach - i to przy każdym
    // otwarciu panelu wersji.
    const item = projectRevisionListItem(
      row({ snapshot: { title_pl: "T", content_pl: "x".repeat(100_000), blocks_data: { a: 1 } } }),
    );
    expect("snapshot" in item).toBe(false);
    expect("content_pl" in item).toBe(false);
    expect("blocks_data" in item).toBe(false);
    expect(Object.keys(item).sort()).toEqual(
      ["author_id", "created_at", "editor", "id", "note", "status", "title_en", "title_pl"].sort(),
    );
  });

  it("wpuszcza WYŁĄCZNIE napisy - reszta schodzi na null", () => {
    // `snapshot` to `jsonb` bez schematu: historyczne wiersze mogą nieść pod tą
    // samą nazwą liczbę, obiekt albo null (kolumna zmieniła typ, migracja
    // dopisała pole). Wpuszczenie takiej wartości rozjeżdża typ pozycji listy,
    // a panel renderuje „[object Object]" zamiast tytułu.
    const item = projectRevisionListItem(
      row({
        snapshot: {
          title_pl: 42,
          title_en: { pl: "obiekt" },
          status: null,
          editor: ["blocks"],
        },
      }),
    );
    for (const field of REVISION_LIST_FIELDS) {
      expect(item[field], `${field} powinno zejść na null`).toBeNull();
    }
  });

  it("pusty i brakujący snapshot dają nulle, nie wyjątek", () => {
    expect(projectRevisionListItem(row({ snapshot: {} })).title_pl).toBeNull();
    expect(projectRevisionListItem(row({ snapshot: null })).status).toBeNull();
    expect(projectRevisionListItem(row({ snapshot: undefined })).editor).toBeNull();
  });

  it("pusty napis jest wartością, nie brakiem", () => {
    // Redaktor mógł skasować tytuł EN i zapisać - historia ma pokazać, że
    // w tej wersji było pusto, a nie że pola nie zarejestrowano.
    expect(projectRevisionListItem(row({ snapshot: { title_en: "" } })).title_en).toBe("");
  });
});

describe("projectRevisionList", () => {
  it("zachowuje kolejność otrzymaną z bazy (najnowsze pierwsze)", () => {
    const items = projectRevisionList([
      row({ id: "b", created_at: "2026-08-18T12:00:00.000Z" }),
      row({ id: "a", created_at: "2026-08-18T10:00:00.000Z" }),
    ]);
    expect(items.map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("brak wierszy daje pustą listę, nie null", () => {
    expect(projectRevisionList(null)).toEqual([]);
    expect(projectRevisionList(undefined)).toEqual([]);
    expect(projectRevisionList([])).toEqual([]);
  });
});

describe("isPreRestoreEntry", () => {
  it("rozpoznaje kopię bezpieczeństwa sprzed przywracania", () => {
    // Ta kopia jest JEDYNYM śladem stanu, który przywracanie nadpisało -
    // panel musi umieć ją odróżnić od zwykłej migawki autozapisu.
    expect(isPreRestoreEntry({ note: PRE_RESTORE_NOTE })).toBe(true);
  });

  it("nie myli jej ze zwykłą notą ani z brakiem noty", () => {
    expect(isPreRestoreEntry({ note: null })).toBe(false);
    expect(isPreRestoreEntry({ note: "przed publikacją" })).toBe(false);
    expect(isPreRestoreEntry({ note: "pre_restore " })).toBe(false);
  });
});
