// CO TEN PLIK DOWODZI: reguły zwijania gałęzi dyskusji są czyste, nie mutują
// wejścia i liczą CAŁĄ gałąź, a nie tylko dzieci bezpośrednie.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE: składania drzewa z płaskiej listy (to
// `buildClubReplyTree` / `buildCommentTree` i mają własne testy) ani renderu
// akordeonu (to `discussion.test.tsx`).
import { describe, expect, it } from "vitest";
import { countDescendants, revealBranch, toggleBranch } from "@/lib/discussion/branches";

interface Node {
  id: string;
  children: Node[];
}

function node(id: string, children: Node[] = []): Node {
  return { id, children };
}

describe("countDescendants", () => {
  it("liść nie ma potomków", () => {
    expect(countDescendants(node("a"))).toBe(0);
  });

  it("liczy dzieci bezpośrednie", () => {
    expect(countDescendants(node("a", [node("b"), node("c")]))).toBe(2);
  });

  it("liczy CAŁĄ gałąź, nie tylko jeden poziom", () => {
    const tree = node("a", [node("b", [node("c", [node("d")])]), node("e")]);
    expect(countDescendants(tree)).toBe(4);
  });
});

describe("toggleBranch", () => {
  it("zwinięcie dopisuje id do zbioru", () => {
    const next = toggleBranch(new Set<string>(), "r1", false);
    expect([...next]).toEqual(["r1"]);
  });

  it("rozwinięcie usuwa id ze zbioru", () => {
    const next = toggleBranch(new Set(["r1", "r2"]), "r1", true);
    expect([...next].sort()).toEqual(["r2"]);
  });

  it("nie mutuje wejścia - stan Reacta dostaje nową referencję", () => {
    const before = new Set(["r1"]);
    const next = toggleBranch(before, "r2", false);
    expect([...before]).toEqual(["r1"]);
    expect(next).not.toBe(before);
  });

  it("brak zmiany oddaje TEN SAM zbiór - zero zbędnych renderów", () => {
    const collapsed = new Set(["r1"]);
    expect(toggleBranch(collapsed, "r1", false)).toBe(collapsed);
    expect(toggleBranch(collapsed, "r2", true)).toBe(collapsed);
  });

  it("jest idempotentne", () => {
    const once = toggleBranch(new Set<string>(), "r1", false);
    const twice = toggleBranch(once, "r1", false);
    expect([...twice]).toEqual(["r1"]);
  });
});

describe("revealBranch", () => {
  it("zdejmuje gałąź ze zwiniętych po wysłaniu do niej odpowiedzi", () => {
    expect([...revealBranch(new Set(["r1", "r2"]), "r1")].sort()).toEqual(["r2"]);
  });

  it("odpowiedź bez rodzica (wątek główny) nie rusza stanu", () => {
    const collapsed = new Set(["r1"]);
    expect(revealBranch(collapsed, null)).toBe(collapsed);
  });
});
