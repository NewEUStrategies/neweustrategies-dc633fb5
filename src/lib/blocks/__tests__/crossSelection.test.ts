import { describe, it, expect } from "vitest";
import {
  currentSelectionRange,
  extendSelection,
  extendSelectionToEdge,
  isPrintableKey,
  isSameSelection,
  makeSelectionRange,
  moveSelection,
} from "@/lib/blocks/crossSelection";

const IDS = ["a", "b", "c", "d", "e"] as const;

const key = (
  k: string,
  mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {},
) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });

describe("makeSelectionRange", () => {
  it("buduje ciągły zakres od kotwicy do ogniska", () => {
    expect(makeSelectionRange(IDS, "b", "d")).toEqual({
      anchorId: "b",
      focusId: "d",
      ids: ["b", "c", "d"],
    });
  });

  it("zachowuje kierunek zaznaczania (ognisko nad kotwicą)", () => {
    const range = makeSelectionRange(IDS, "d", "b");
    expect(range?.anchorId).toBe("d");
    expect(range?.focusId).toBe("b");
    expect(range?.ids).toEqual(["b", "c", "d"]);
  });

  it("zwija się do żywego końca, gdy drugi blok zniknął", () => {
    expect(makeSelectionRange(IDS, "zz", "c")).toEqual({
      anchorId: "c",
      focusId: "c",
      ids: ["c"],
    });
  });

  it("zwraca null, gdy oba końce są poza dokumentem", () => {
    expect(makeSelectionRange(IDS, "zz", "yy")).toBeNull();
  });
});

describe("extendSelection (Shift+strzałki)", () => {
  it("rozszerza zaznaczenie w dół o jeden blok", () => {
    expect(extendSelection(IDS, { anchorId: "b", focusId: "b" }, 1)?.ids).toEqual(["b", "c"]);
  });

  it("rozszerza zaznaczenie w górę o jeden blok", () => {
    expect(extendSelection(IDS, { anchorId: "c", focusId: "c" }, -1)?.ids).toEqual(["b", "c"]);
  });

  it("ZAWĘŻA zaznaczenie, gdy kierunek jest odwrotny do dotychczasowego", () => {
    const wide = makeSelectionRange(IDS, "b", "d");
    expect(wide?.ids).toEqual(["b", "c", "d"]);
    const narrowed = extendSelection(IDS, wide!, -1);
    expect(narrowed?.ids).toEqual(["b", "c"]);
    expect(narrowed?.anchorId).toBe("b");
    const collapsed = extendSelection(IDS, narrowed!, -1);
    expect(collapsed?.ids).toEqual(["b"]);
  });

  it("przechodzi przez kotwicę na drugą stronę", () => {
    const range = extendSelection(IDS, { anchorId: "c", focusId: "c" }, -1);
    const crossed = extendSelection(IDS, range!, -1);
    expect(crossed?.ids).toEqual(["a", "b", "c"]);
    expect(crossed?.anchorId).toBe("c");
    expect(crossed?.focusId).toBe("a");
  });

  it("nie robi nic na krawędzi dokumentu", () => {
    expect(extendSelection(IDS, { anchorId: "a", focusId: "a" }, -1)).toBeNull();
    expect(extendSelection(IDS, { anchorId: "e", focusId: "e" }, 1)).toBeNull();
  });

  it("zwraca null, gdy ognisko zniknęło z dokumentu", () => {
    expect(extendSelection(IDS, { anchorId: "a", focusId: "zz" }, 1)).toBeNull();
  });
});

describe("extendSelectionToEdge (Shift+Home/End)", () => {
  it("sięga początku dokumentu", () => {
    expect(extendSelectionToEdge(IDS, { anchorId: "c", focusId: "c" }, -1)?.ids).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("sięga końca dokumentu", () => {
    expect(extendSelectionToEdge(IDS, { anchorId: "c", focusId: "c" }, 1)?.ids).toEqual([
      "c",
      "d",
      "e",
    ]);
  });

  it("nie robi nic, gdy ognisko już jest na krawędzi", () => {
    expect(extendSelectionToEdge(IDS, { anchorId: "c", focusId: "a" }, -1)).toBeNull();
    expect(extendSelectionToEdge(IDS, { anchorId: "c", focusId: "e" }, 1)).toBeNull();
  });

  it("nie robi nic w pustym dokumencie", () => {
    expect(extendSelectionToEdge([], { anchorId: "a", focusId: "a" }, 1)).toBeNull();
  });
});

describe("moveSelection (zwykłe strzałki w trybie blokowym)", () => {
  it("zwija zaznaczenie do sąsiedniego bloku", () => {
    expect(moveSelection(IDS, { anchorId: "b", focusId: "d" }, 1)).toEqual({
      anchorId: "e",
      focusId: "e",
      ids: ["e"],
    });
  });

  it("zatrzymuje się na krawędzi (zaznaczenie zostaje jednoblokowe)", () => {
    expect(moveSelection(IDS, { anchorId: "a", focusId: "a" }, -1)?.ids).toEqual(["a"]);
  });
});

describe("currentSelectionRange", () => {
  it("używa zapamiętanych końców, gdy nadal są w zaznaczeniu", () => {
    const range = currentSelectionRange(IDS, ["b", "c", "d"], { anchorId: "d", focusId: "b" });
    expect(range).toEqual({ anchorId: "d", focusId: "b", ids: ["b", "c", "d"] });
  });

  it("odtwarza końce ze skrajnych bloków, gdy podpowiedź jest nieaktualna", () => {
    const range = currentSelectionRange(IDS, ["b", "c"], { anchorId: "e", focusId: "e" });
    expect(range).toEqual({ anchorId: "b", focusId: "c", ids: ["b", "c"] });
  });

  it("porządkuje zaznaczenie punktowe według kolejności dokumentu", () => {
    expect(currentSelectionRange(IDS, ["d", "a"])?.ids).toEqual(["a", "d"]);
  });

  it("zwraca null przy pustym zaznaczeniu", () => {
    expect(currentSelectionRange(IDS, [])).toBeNull();
  });

  it("ignoruje id, których nie ma już w dokumencie", () => {
    expect(currentSelectionRange(IDS, ["b", "zz"])?.ids).toEqual(["b"]);
  });
});

describe("isSameSelection", () => {
  it("porównuje po kolejności i długości", () => {
    expect(isSameSelection(["a", "b"], ["a", "b"])).toBe(true);
    expect(isSameSelection(["a", "b"], ["b", "a"])).toBe(false);
    expect(isSameSelection(["a"], ["a", "b"])).toBe(false);
    expect(isSameSelection([], [])).toBe(true);
  });
});

describe("isPrintableKey", () => {
  it("przyjmuje znaki (także spację i znaki wielobajtowe)", () => {
    expect(isPrintableKey(key("a"))).toBe(true);
    expect(isPrintableKey(key(" "))).toBe(true);
    expect(isPrintableKey(key("ą"))).toBe(true);
    expect(isPrintableKey(key("😀"))).toBe(true);
  });

  it("odrzuca klawisze sterujące i skróty z modyfikatorami", () => {
    expect(isPrintableKey(key("Enter"))).toBe(false);
    expect(isPrintableKey(key("ArrowDown"))).toBe(false);
    expect(isPrintableKey(key("Backspace"))).toBe(false);
    expect(isPrintableKey(key("a", { ctrlKey: true }))).toBe(false);
    expect(isPrintableKey(key("a", { metaKey: true }))).toBe(false);
    expect(isPrintableKey(key("a", { altKey: true }))).toBe(false);
  });
});
