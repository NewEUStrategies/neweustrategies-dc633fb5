// Reguły paginacji biblioteki mediów (menedżer + picker).
//
// Trzy błędy, których nie widać na małej bibliotece testowej:
//   1. „następna strona" przy dokładnie `pageSize` wierszach (pusty request
//      i przycisk, który nic nie dociąga),
//   2. kursor bez rozstrzygnięcia po `id` - pliki z jednego importu mają ten
//      sam znacznik czasu i część z nich wypadałaby między stronami,
//   3. fraza wyszukiwania z `%` / `_` działająca jak symbol wieloznaczny.
import { describe, expect, it } from "vitest";
import { MEDIA_PAGE_SIZE, ilikeContains, keysetAfter, toMediaPage } from "../mediaPage";

const row = (id: string, created_at = "2026-01-01T00:00:00.000Z") => ({ id, created_at });

describe("toMediaPage", () => {
  it("nadmiarowy wiersz oznacza następną stronę i NIE trafia do bieżącej", () => {
    const page = toMediaPage([row("a"), row("b"), row("c")], 2);
    expect(page.rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(page.nextCursor).toEqual({ createdAt: "2026-01-01T00:00:00.000Z", id: "b" });
  });

  it("dokładnie `pageSize` wierszy to OSTATNIA strona", () => {
    expect(toMediaPage([row("a"), row("b")], 2).nextCursor).toBeNull();
  });

  it("pusta odpowiedź to pusta, ostatnia strona", () => {
    expect(toMediaPage([], 2)).toEqual({ rows: [], nextCursor: null });
  });

  it("domyślny rozmiar strony to MEDIA_PAGE_SIZE", () => {
    const rows = Array.from({ length: MEDIA_PAGE_SIZE + 1 }, (_, i) => row(`r${i}`));
    expect(toMediaPage(rows).rows).toHaveLength(MEDIA_PAGE_SIZE);
  });
});

describe("keysetAfter", () => {
  it("starszy znacznik ALBO ten sam znacznik z mniejszym id", () => {
    expect(keysetAfter({ createdAt: "2026-01-01T00:00:00+00:00", id: "abc" })).toBe(
      'created_at.lt."2026-01-01T00:00:00+00:00",and(created_at.eq."2026-01-01T00:00:00+00:00",id.lt."abc")',
    );
  });

  it("wartości są cytowane - kropki i dwukropki znacznika nie rozbijają filtra", () => {
    const filter = keysetAfter({ createdAt: "2026-01-01T10:20:30.123Z", id: "x" });
    expect(filter).toContain('"2026-01-01T10:20:30.123Z"');
  });
});

describe("ilikeContains", () => {
  it("zwykła fraza dostaje symbole wieloznaczne z obu stron", () => {
    expect(ilikeContains("raport")).toBe("%raport%");
  });

  it("escapuje `%`, `_` i znak ucieczki", () => {
    expect(ilikeContains("100%")).toBe("%100\\%%");
    expect(ilikeContains("a_b")).toBe("%a\\_b%");
    expect(ilikeContains("c:\\d")).toBe("%c:\\\\d%");
  });
});
