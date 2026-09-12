import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

beforeEach(() => {
  vi.resetModules();
  sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe("minimized chat persistence", () => {
  it("restores valid entries while rejecting malformed session data", async () => {
    sessionStorage.setItem(
      "nes.chat.minimized",
      JSON.stringify([
        null,
        1,
        {},
        { id: 2, name: "Invalid" },
        { id: "bad", name: 2 },
        { id: "bad-avatar", name: "Invalid", avatarUrl: 4 },
        { id: "a", name: "A" },
        { id: "b", name: "B", avatarUrl: null },
        { id: "c", name: "C", avatarUrl: "https://example.org/avatar.png" },
      ]),
    );
    const { minimizedChatsStore: store } = await import("../minimizedChats");
    expect(store.getSnapshot().minimized.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });
  it.each(["broken JSON", "{}", "[]", ""])("ignores unusable storage (%s)", async (raw) => {
    sessionStorage.setItem("nes.chat.minimized", raw);
    const { minimizedChatsStore: store } = await import("../minimizedChats");
    expect(store.getSnapshot()).toEqual({ minimized: [], requested: null });
  });
  it("notifies subscribers, deduplicates entries and clears restore requests", async () => {
    const { minimizedChatsStore: store } = await import("../minimizedChats");
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    store.minimize({ id: "a", name: "Old" });
    store.minimize({ id: "b", name: "B" });
    store.minimize({ id: "a", name: "New" });
    expect(store.getSnapshot().minimized).toEqual([
      { id: "a", name: "New" },
      { id: "b", name: "B" },
    ]);
    store.restore("a");
    expect(store.getSnapshot().requested).toBe("a");
    store.clearRequest();
    store.clearRequest();
    store.remove("b");
    expect(store.getSnapshot()).toEqual({ minimized: [], requested: null });
    expect(listener).toHaveBeenCalledTimes(6);
    stop();
    store.reset();
    expect(listener).toHaveBeenCalledTimes(6);
    expect(JSON.parse(sessionStorage.getItem("nes.chat.minimized") ?? "null")).toEqual([]);
  });
  it("keeps the hook usable when storage writes fail", async () => {
    const { minimizedChatsStore: store, useMinimizedChats } = await import("../minimizedChats");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const { result } = renderHook(() => useMinimizedChats());
    act(() => store.minimize({ id: "a", name: "A" }));
    expect(result.current.minimized[0].name).toBe("A");
    expect(store.getServerSnapshot()).toEqual({ minimized: [], requested: null });
  });
});
