// Drzewo odpowiedzi i projekcja autora.
//
// Dwie rzeczy, które muszą działać, bo ich awaria jest widoczna dla
// użytkownika jako utrata danych albo jako wyciek tożsamości:
//   1. odpowiedź, której rodzic zniknął (ukryty przez moderację), nie może
//      zniknąć razem z nim,
//   2. komponent nie może samodzielnie decydować o anonimowości - dostaje
//      albo imię, albo alias, bo baza już rozstrzygnęła, co wolno pokazać.
import { describe, expect, it } from "vitest";
import { buildClubReplyTree, toAuthorLabel, type ClubReplyRow } from "../types";

function reply(overrides: Partial<ClubReplyRow> & { id: string }): ClubReplyRow {
  return {
    id: overrides.id,
    parent_id: overrides.parent_id ?? null,
    depth: overrides.depth ?? 0,
    body: overrides.body ?? "treść",
    status: overrides.status ?? "visible",
    is_anonymous: overrides.is_anonymous ?? false,
    author_id: overrides.author_id ?? "u1",
    author_name: overrides.author_name ?? "Anna Kowalska",
    author_avatar: overrides.author_avatar ?? null,
    author_slug: overrides.author_slug ?? null,
    author_alias: overrides.author_alias ?? null,
    reaction_count: overrides.reaction_count ?? 0,
    created_at: overrides.created_at ?? "2026-08-08T10:00:00Z",
    edited_at: overrides.edited_at ?? null,
    is_resolution: overrides.is_resolution ?? false,
  };
}

describe("buildClubReplyTree", () => {
  it("płaska lista bez rodziców daje same korzenie", () => {
    const tree = buildClubReplyTree([reply({ id: "a" }), reply({ id: "b" })]);
    expect(tree).toHaveLength(2);
    expect(tree.every((n) => n.children.length === 0)).toBe(true);
  });

  it("składa dwa poziomy zagnieżdżenia", () => {
    const tree = buildClubReplyTree([
      reply({ id: "a" }),
      reply({ id: "b", parent_id: "a", depth: 1 }),
      reply({ id: "c", parent_id: "b", depth: 2 }),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].reply.id).toBe("a");
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].reply.id).toBe("b");
    expect(tree[0].children[0].children[0].reply.id).toBe("c");
  });

  // Sedno: moderator ukrył rodzica, więc nie ma go w zbiorze. Dziecko musi
  // wylądować na poziomie głównym, a nie zniknąć - zniknięcie wygląda jak
  // utrata danych, nie jak moderacja.
  it("sierota po ukrytym rodzicu ląduje na poziomie głównym, nie znika", () => {
    const tree = buildClubReplyTree([
      reply({ id: "a" }),
      reply({ id: "sierota", parent_id: "usuniety", depth: 1 }),
    ]);
    expect(tree).toHaveLength(2);
    expect(tree.map((n) => n.reply.id)).toContain("sierota");
  });

  it("zachowuje kolejność wejściową na każdym poziomie", () => {
    const tree = buildClubReplyTree([
      reply({ id: "a" }),
      reply({ id: "a1", parent_id: "a", depth: 1 }),
      reply({ id: "a2", parent_id: "a", depth: 1 }),
      reply({ id: "b" }),
    ]);
    expect(tree.map((n) => n.reply.id)).toEqual(["a", "b"]);
    expect(tree[0].children.map((n) => n.reply.id)).toEqual(["a1", "a2"]);
  });

  it("nie zapętla się na wpisie wskazującym samego siebie", () => {
    const tree = buildClubReplyTree([reply({ id: "a", parent_id: "a" })]);
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(0);
  });

  it("pusta lista daje puste drzewo", () => {
    expect(buildClubReplyTree([])).toEqual([]);
  });
});

const ANON = "Uczestnik {{alias}}";
const UNKNOWN = "Konto usunięte";

describe("toAuthorLabel", () => {
  it("wpis podpisany daje imię, awatar i link do profilu", () => {
    const label = toAuthorLabel(
      {
        author_id: "u1",
        author_name: "Anna Kowalska",
        author_avatar: "https://x/a.png",
        author_slug: "anna-kowalska",
        author_alias: null,
      },
      ANON,
      UNKNOWN,
    );
    expect(label).toEqual({
      kind: "named",
      name: "Anna Kowalska",
      avatarUrl: "https://x/a.png",
      profileSlug: "anna-kowalska",
    });
  });

  // Chatham House: baza zwróciła alias zamiast imienia. Etykieta NIE MOŻE
  // nieść awatara ani slugu profilu - jedno i drugie deanonimizuje.
  it("alias nie niesie ani awatara, ani linku do profilu", () => {
    const label = toAuthorLabel(
      {
        author_id: null,
        author_name: null,
        author_avatar: null,
        author_slug: null,
        author_alias: "C",
      },
      ANON,
      UNKNOWN,
    );
    expect(label.kind).toBe("alias");
    expect(label.name).toBe("Uczestnik C");
    expect(label.avatarUrl).toBeNull();
    expect(label.profileSlug).toBeNull();
  });

  // Gdyby baza kiedykolwiek zwróciła OBIE wartości naraz, alias ma wygrać:
  // pomyłka w stronę anonimowości jest odwracalna, w drugą stronę nie.
  it("gdy przyjdzie i alias, i imię - wygrywa alias", () => {
    const label = toAuthorLabel(
      {
        author_id: "u1",
        author_name: "Anna Kowalska",
        author_avatar: "https://x/a.png",
        author_slug: "anna-kowalska",
        author_alias: "C",
      },
      ANON,
      UNKNOWN,
    );
    expect(label.kind).toBe("alias");
    expect(label.name).toBe("Uczestnik C");
    expect(label.avatarUrl).toBeNull();
    expect(label.profileSlug).toBeNull();
  });

  it("brak imienia i aliasu to konto usunięte, nie pusty string", () => {
    const label = toAuthorLabel(
      {
        author_id: null,
        author_name: null,
        author_avatar: null,
        author_slug: null,
        author_alias: null,
      },
      ANON,
      UNKNOWN,
    );
    expect(label).toEqual({
      kind: "unknown",
      name: "Konto usunięte",
      avatarUrl: null,
      profileSlug: null,
    });
  });

  it("pusty alias traktuje się jak brak aliasu", () => {
    const label = toAuthorLabel(
      {
        author_id: "u1",
        author_name: "Anna Kowalska",
        author_avatar: null,
        author_slug: null,
        author_alias: "",
      },
      ANON,
      UNKNOWN,
    );
    expect(label.kind).toBe("named");
  });
});
