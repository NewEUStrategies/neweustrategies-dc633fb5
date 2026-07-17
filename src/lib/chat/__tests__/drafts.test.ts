// Szkice kompozytora: trwałość per użytkownik+rozmowa (localStorage),
// przełączanie kont bez wycieku cudzych szkiców, przycinanie po wieku i
// liczbie oraz powiadamianie subskrybentów (podgląd "Szkic:" na liście).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetDraftsForTests,
  clearDraft,
  draftSnapshot,
  getDraft,
  pruneDrafts,
  setDraft,
  subscribeDrafts,
  type ChatDraft,
} from "../drafts";

describe("chat drafts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    __resetDraftsForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores and returns a draft per conversation", () => {
    setDraft("u1", "c1", "w trakcie pisania");
    setDraft("u1", "c2", "inny wątek");
    expect(getDraft("u1", "c1")).toBe("w trakcie pisania");
    expect(getDraft("u1", "c2")).toBe("inny wątek");
    expect(getDraft("u1", "c3")).toBe("");
  });

  it("clears a draft (empty text = delete)", () => {
    setDraft("u1", "c1", "abc");
    clearDraft("u1", "c1");
    expect(getDraft("u1", "c1")).toBe("");
    setDraft("u1", "c1", "abc");
    setDraft("u1", "c1", "   ");
    expect(getDraft("u1", "c1")).toBe("");
  });

  it("clearing flushes to storage immediately (sent text must not resurrect)", () => {
    setDraft("u1", "c1", "wysłane zaraz");
    vi.advanceTimersByTime(500);
    clearDraft("u1", "c1");
    // NO timer advance: a reload right after send must not restore the text.
    expect(localStorage.getItem("nes.chat.drafts.u1") ?? "{}").not.toContain("wysłane zaraz");
  });

  it("account switch flushes the previous user's pending edits", () => {
    setDraft("u1", "c1", "niedokończony");
    // Debounce still pending - switching users must flush, not drop it.
    getDraft("u2", "c1");
    expect(localStorage.getItem("nes.chat.drafts.u1")).toContain("niedokończony");
  });

  it("persists to localStorage (debounced) and survives a reset", () => {
    setDraft("u1", "c1", "trwały szkic");
    vi.advanceTimersByTime(500);
    expect(localStorage.getItem("nes.chat.drafts.u1")).toContain("trwały szkic");
    // Symulacja przeładowania karty: stan modułu znika, storage zostaje.
    __resetDraftsForTests();
    expect(getDraft("u1", "c1")).toBe("trwały szkic");
  });

  it("scopes drafts per user (account switch swaps the map)", () => {
    setDraft("u1", "c1", "szkic użytkownika 1");
    vi.advanceTimersByTime(500);
    expect(getDraft("u2", "c1")).toBe("");
    setDraft("u2", "c1", "szkic użytkownika 2");
    vi.advanceTimersByTime(500);
    expect(getDraft("u1", "c1")).toBe("szkic użytkownika 1");
  });

  it("notifies subscribers on change (list preview updates live)", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDrafts(listener);
    setDraft("u1", "c1", "a");
    expect(listener).toHaveBeenCalled();
    const calls = listener.mock.calls.length;
    unsubscribe();
    setDraft("u1", "c1", "ab");
    expect(listener.mock.calls.length).toBe(calls);
  });

  it("draftSnapshot is safe without a user", () => {
    expect(draftSnapshot(undefined, "c1")).toBe("");
    setDraft("u1", "c1", "abc");
    expect(draftSnapshot("u1", "c1")).toBe("abc");
  });

  it("pruneDrafts drops stale and overflowing entries, newest first", () => {
    const now = 1_000_000_000_000;
    const entries: Array<readonly [string, ChatDraft]> = [
      ["fresh", { text: "a", updatedAt: now - 1000 }],
      ["stale", { text: "b", updatedAt: now - 40 * 24 * 3600 * 1000 }],
      ["empty", { text: "   ", updatedAt: now }],
      ["older", { text: "c", updatedAt: now - 2000 }],
    ];
    const pruned = pruneDrafts(entries, now);
    expect(pruned.map(([id]) => id)).toEqual(["fresh", "older"]);
    const capped = pruneDrafts(entries, now, 1);
    expect(capped.map(([id]) => id)).toEqual(["fresh"]);
  });
});
