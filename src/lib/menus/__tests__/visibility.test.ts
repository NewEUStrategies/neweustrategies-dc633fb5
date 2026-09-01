import { describe, expect, it } from "vitest";
import {
  filterMenuItemsForViewer,
  isVisibleForViewer,
  normalizeMenuVisibility,
} from "../visibility";

describe("normalizeMenuVisibility", () => {
  it("przepuszcza znane wartości", () => {
    expect(normalizeMenuVisibility("guest")).toBe("guest");
    expect(normalizeMenuVisibility("auth")).toBe("auth");
    expect(normalizeMenuVisibility("all")).toBe("all");
  });

  it("nieznane / puste sprowadza do 'all' (pozycja nie znika przez literówkę)", () => {
    expect(normalizeMenuVisibility(null)).toBe("all");
    expect(normalizeMenuVisibility("members")).toBe("all");
    expect(normalizeMenuVisibility(7)).toBe("all");
  });
});

describe("isVisibleForViewer", () => {
  it("'guest' widzą tylko niezalogowani", () => {
    expect(isVisibleForViewer({ visibility: "guest" }, false)).toBe(true);
    expect(isVisibleForViewer({ visibility: "guest" }, true)).toBe(false);
  });

  it("'auth' widzą tylko zalogowani", () => {
    expect(isVisibleForViewer({ visibility: "auth" }, true)).toBe(true);
    expect(isVisibleForViewer({ visibility: "auth" }, false)).toBe(false);
  });

  it("'all' widzą wszyscy", () => {
    expect(isVisibleForViewer({ visibility: "all" }, true)).toBe(true);
    expect(isVisibleForViewer({ visibility: null }, false)).toBe(true);
  });
});

describe("filterMenuItemsForViewer", () => {
  const items = [
    { id: "a", parent_id: null, visibility: "all" as const },
    { id: "register", parent_id: null, visibility: "guest" as const },
    { id: "register-child", parent_id: "register", visibility: "all" as const },
    { id: "profile", parent_id: null, visibility: "auth" as const },
  ];

  it("gość nie widzi pozycji tylko-dla-zalogowanych", () => {
    expect(filterMenuItemsForViewer(items, false).map((i) => i.id)).toEqual([
      "a",
      "register",
      "register-child",
    ]);
  });

  it("zalogowany nie widzi 'Zarejestruj się' ANI jego dzieci", () => {
    expect(filterMenuItemsForViewer(items, true).map((i) => i.id)).toEqual(["a", "profile"]);
  });

  it("kaskada działa, gdy dziecko wyprzedza rodzica na liście", () => {
    const unordered = [
      { id: "child", parent_id: "hidden", visibility: "all" as const },
      { id: "hidden", parent_id: null, visibility: "guest" as const },
    ];
    expect(filterMenuItemsForViewer(unordered, true)).toEqual([]);
  });
});
