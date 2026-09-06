import { describe, expect, it, vi } from "vitest";
import { readPagedRows } from "../pagedRows.server";

describe("readPagedRows", () => {
  it.each([100, 500])("reads all 1,203 rows with a server cap of %i", async (cap) => {
    const rows = Array.from({ length: 1203 }, (_, id) => ({ id }));
    const fetchPage = vi.fn(async (from: number, to: number) => ({
      data: rows.slice(from, Math.min(to + 1, from + cap)),
      error: null,
      count: rows.length,
    }));
    expect((await readPagedRows(fetchPage)).data).toEqual(rows);
    expect(fetchPage).toHaveBeenCalledTimes(Math.ceil(rows.length / cap));
    expect(fetchPage.mock.calls[1][0]).toBe(cap);
  });

  it("keeps reading short pages without a count until the server returns empty", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ data: [1, 2], error: null })
      .mockResolvedValueOnce({ data: [3], error: null, count: null })
      .mockResolvedValueOnce({ data: null, error: null });
    expect((await readPagedRows(fetchPage)).data).toEqual([1, 2, 3]);
    expect(fetchPage.mock.calls).toEqual([
      [0, 499],
      [2, 501],
      [3, 502],
    ]);
  });

  it("rejects a later page failure instead of publishing an incomplete list", async () => {
    const error = { message: "permission denied", code: "42501" };
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ data: [1], error: null })
      .mockResolvedValueOnce({ data: null, error });
    await expect(readPagedRows(fetchPage)).rejects.toBe(error);
  });

  it("rejects a malformed server response", async () => {
    await expect(
      readPagedRows(vi.fn().mockResolvedValue({ data: {}, error: null })),
    ).rejects.toThrow("PostgREST page must contain an array");
  });
});
