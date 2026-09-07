import { beforeEach, describe, expect, it } from "vitest";

import { MINIMIZED_VISIBLE_LIMIT, minimizedChatsStore } from "../minimizedChats";

describe("minimizedChatsStore", () => {
  beforeEach(() => minimizedChatsStore.reset());

  it("dodaje rozmowę na początek i nie duplikuje", () => {
    minimizedChatsStore.minimize({ id: "a", name: "Ala" });
    minimizedChatsStore.minimize({ id: "b", name: "Bob" });
    minimizedChatsStore.minimize({ id: "a", name: "Ala" });
    expect(minimizedChatsStore.getSnapshot().minimized.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("liczy nadmiar ponad dwie widoczne pigułki", () => {
    for (const id of ["a", "b", "c", "d"]) minimizedChatsStore.minimize({ id, name: id });
    const total = minimizedChatsStore.getSnapshot().minimized.length;
    expect(total - MINIMIZED_VISIBLE_LIMIT).toBe(2);
  });

  it("przywrócenie zdejmuje z paska i prosi o otwarcie", () => {
    minimizedChatsStore.minimize({ id: "a", name: "Ala" });
    minimizedChatsStore.restore("a");
    const state = minimizedChatsStore.getSnapshot();
    expect(state.minimized).toHaveLength(0);
    expect(state.requested).toBe("a");
    minimizedChatsStore.clearRequest();
    expect(minimizedChatsStore.getSnapshot().requested).toBeNull();
  });

  it("zamknięcie usuwa bez prośby o otwarcie", () => {
    minimizedChatsStore.minimize({ id: "a", name: "Ala" });
    minimizedChatsStore.remove("a");
    expect(minimizedChatsStore.getSnapshot()).toEqual({ minimized: [], requested: null });
  });
});
