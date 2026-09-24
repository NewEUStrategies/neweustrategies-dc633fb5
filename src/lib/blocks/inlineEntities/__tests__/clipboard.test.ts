import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseInlineEntityClipboard,
  recallCopiedInlineEntities,
  rememberCopiedInlineEntities,
  serializeInlineEntityClipboard,
} from "../clipboard";
import { company, person } from "./fixtures";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("inline entity clipboard envelope", () => {
  it("round-trips entities", () => {
    const raw = serializeInlineEntityClipboard([company(), person()], 1000);
    expect(parseInlineEntityClipboard(raw, 1000)).toEqual([company(), person()]);
  });

  it("rejects garbage, wrong versions and invalid records", () => {
    expect(parseInlineEntityClipboard(null)).toEqual([]);
    expect(parseInlineEntityClipboard("{not json")).toEqual([]);
    expect(parseInlineEntityClipboard('"str"')).toEqual([]);
    expect(parseInlineEntityClipboard(JSON.stringify({ v: 2, entities: [company()] }))).toEqual([]);
    expect(
      parseInlineEntityClipboard(
        JSON.stringify({ v: 1, at: 0, entities: [{ id: "x" }, company()] }),
      ),
    ).toEqual([company()]);
  });

  it("expires stale envelopes when a max age is given", () => {
    const raw = serializeInlineEntityClipboard([company()], 0);
    expect(parseInlineEntityClipboard(raw, 10_000, 5_000)).toEqual([]);
  });
});

describe("localStorage fallback", () => {
  it("remembers and recalls requested ids only", () => {
    rememberCopiedInlineEntities([company(), person()]);
    expect(recallCopiedInlineEntities(["ie_maya0001"])).toEqual([person()]);
    expect(recallCopiedInlineEntities([])).toEqual([]);
  });

  it("does nothing for an empty copy and survives storage failures", () => {
    rememberCopiedInlineEntities([]);
    expect(window.localStorage.length).toBe(0);
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => rememberCopiedInlineEntities([company()])).not.toThrow();
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(recallCopiedInlineEntities(["ie_acme0001"])).toEqual([]);
  });
});
