// Model siatki zespołu (`teamGrid.ts`): UKŁAD i TOŻSAMOŚĆ osób.
//
// Kolumny i zaokrąglenie czytają z tych funkcji OBIE strony - renderer
// (`TeamMemberGridWidget`) i panel (`TeamMemberGridEditor`). Ten plik przypina
// wspólną normalizację, bo rozjazd był realny (NAPRAWIONE 2026-10-18): panel
// liczył kolumny po swojemu i dla `columns: 5` pokazywał listę bez zaznaczonej
// opcji, podczas gdy strona rysowała 4 kolumny.
//
// Do tego klucz kafelka i alias zdjęcia: klucz osoby bez `id` musi zależeć od
// pozycji w DOKUMENCIE (nie na liście po odsianiu), żeby SSR i hydratacja
// nadały ten sam klucz temu samemu wpisowi. Moduł jest czysty - bez atrap.
import { describe, expect, it } from "vitest";
import {
  TEAM_GRID_DEFAULT_RADIUS,
  teamGridColumns,
  teamGridColumnsClass,
  teamGridMembers,
  teamGridRadius,
} from "../teamGrid";

describe("teamGridColumns - liczba kolumn, którą rysuje siatka", () => {
  it.each([
    [2, 2],
    [3, 3],
    [4, 4],
    [5, 4],
    [0, 2],
    [-3, 2],
    [2.4, 2],
    [3.6, 4],
  ])("%s -> %s", (columns, expected) => {
    expect(teamGridColumns({ columns })).toBe(expected);
  });

  it.each([
    ["brak klucza", {}],
    ["napis z importu", { columns: "4" }],
    ["null", { columns: null }],
    ["wartość logiczna", { columns: true }],
  ])("%s daje domyślne 3 kolumny", (_label, content) => {
    expect(teamGridColumns(content)).toBe(3);
  });

  it("każda znormalizowana wartość ma własną klasę siatki", () => {
    expect(teamGridColumnsClass(teamGridColumns({ columns: 2 }))).toBe("sm:grid-cols-2");
    expect(teamGridColumnsClass(teamGridColumns({ columns: 9 }))).toBe(
      "sm:grid-cols-2 lg:grid-cols-4",
    );
    expect(teamGridColumnsClass(teamGridColumns({}))).toBe("sm:grid-cols-2 lg:grid-cols-3");
  });
});

describe("teamGridRadius - zaokrąglenie w px", () => {
  it.each([
    [0, 0],
    [12, 12],
    [48, 48],
    [100, 48],
    [-5, 0],
    [7.5, 8],
  ])("%s -> %s", (radius, expected) => {
    expect(teamGridRadius({ radius })).toBe(expected);
  });

  it("brak liczby (także napis) daje wartość domyślną widgetu", () => {
    expect(teamGridRadius({})).toBe(TEAM_GRID_DEFAULT_RADIUS);
    expect(teamGridRadius({ radius: "12" })).toBe(TEAM_GRID_DEFAULT_RADIUS);
  });
});

describe("teamGridMembers - tożsamość i zdjęcie osoby", () => {
  it("osoba bez id dostaje klucz z pozycji w DOKUMENCIE, nie po odsianiu", () => {
    const members = teamGridMembers(
      { members: [{ name: "" }, "śmieć", { name: "Anna" }, { id: "m-jan", name: "Jan" }] },
      "pl",
    );
    expect(members.map((m) => [m.key, m.name])).toEqual([
      ["tmg-2", "Anna"],
      ["m-jan", "Jan"],
    ]);
  });

  it("czyta historyczny alias `photo`, gdy `avatar` jest pusty", () => {
    const [withAlias, withBoth] = teamGridMembers(
      {
        members: [
          { name: "Anna", photo: "https://cdn.example.org/a.jpg" },
          {
            name: "Jan",
            avatar: "https://cdn.example.org/nowe.jpg",
            photo: "https://cdn.example.org/stare.jpg",
          },
        ],
      },
      "pl",
    );
    expect(withAlias.avatar).toBe("https://cdn.example.org/a.jpg");
    expect(withBoth.avatar).toBe("https://cdn.example.org/nowe.jpg");
  });

  it("niebezpieczny link profilu nie przechodzi do renderu", () => {
    const [anna] = teamGridMembers(
      { members: [{ name: "Anna", profileHref: "javascript:alert(1)" }] },
      "pl",
    );
    expect(anna.profileHref).not.toMatch(/javascript/i);
  });
});
