import { describe, expect, it } from "vitest";
import { isPeopleSectionKind, peopleColumnCount } from "@/lib/builder/sectionKind";
import type { SectionChild } from "@/lib/builder/types";

// `BuilderRenderer` pyta `isPeopleSectionKind` o KAŻDĄ sekcję strony, żeby
// nadać jej układ siatki osób. Dokument przychodzi z bazy, więc dziecko sekcji
// może mieć kształt spoza typu (stara rewizja, widget wpięty wprost pod
// sekcję). Kontrakt: takie dziecko NIE robi z sekcji siatki osób i nie
// przerywa liczenia kolumn - render strony nie może się od niego wywrócić.

const widget = (type: string) => ({ id: `w-${type}`, kind: "widget", type, content: {} });
const kolumna = (...types: string[]) => ({
  id: "c",
  kind: "column",
  span: { desktop: 6 },
  children: types.map(widget),
});

const nieznane = { id: "x", kind: "widget", type: "team-member", content: {} };

describe("sectionKind - dziecko sekcji o nieznanym rodzaju", () => {
  it("widget wpięty wprost pod sekcję nie czyni jej siatką osób", () => {
    const children = [kolumna("team-member"), nieznane] as unknown as SectionChild[];
    expect(isPeopleSectionKind(children)).toBe(false);
  });

  it("nieznane dziecko na początku nie zeruje liczby kolumn kolejnej warstwy", () => {
    const children = [
      nieznane,
      { id: "in", kind: "inner-section", columns: [kolumna("team-member"), kolumna("text")] },
    ] as unknown as SectionChild[];
    expect(peopleColumnCount(children)).toBe(2);
  });

  it("same nieznane dzieci dają zero kolumn", () => {
    expect(peopleColumnCount([nieznane, nieznane] as unknown as SectionChild[])).toBe(0);
  });
});
