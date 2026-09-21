import { describe, expect, it } from "vitest";
import { runMemberSyncBatch } from "../memberSyncBatch";

const rows = Array.from({ length: 2501 }, (_, i) => ({
  id: String(i + 1).padStart(6, "0"),
  email: `member-${i}@example.test`,
}));
const readPage = async (cursor: string | null, limit: number) =>
  rows.filter((row) => cursor === null || row.id > cursor).slice(0, limit);
const snapshot = (id: string) => ({
  leadId: id,
  stage: "new",
  companyId: null,
  companyName: null,
  companyCreated: false,
});

describe("member CRM batch checkpoints", () => {
  it("processes more than 2000 profiles and resumes at a failed member without omissions", async () => {
    let cursor: string | null = null;
    let rejectId: string | null = "001217";
    const synced = new Set<string>();
    let sawFailure = false;
    for (let page = 0; page < 120; page += 1) {
      const result = await runMemberSyncBatch({
        cursor,
        limit: 25,
        readPage,
        sync: async (id) => {
          if (id === rejectId) return null;
          synced.add(id);
          return snapshot(id);
        },
      });
      cursor = result.nextCursor;
      if (result.errors) {
        sawFailure = true;
        expect(cursor).toBe("001216");
        expect(synced.has("001217")).toBe(false);
        rejectId = null;
      }
      if (result.done) break;
    }
    expect(sawFailure).toBe(true);
    expect([...synced]).toEqual(rows.map((row) => row.id));
  });

  it("distinguishes skipped profiles, successful leads and created companies", async () => {
    const result = await runMemberSyncBatch({
      cursor: null,
      limit: 25,
      readPage: async () => [
        { id: "1", email: null },
        { id: "2", email: "a@example.test" },
      ],
      sync: async (id) => ({ ...snapshot(id), companyCreated: true }),
    });
    expect(result).toEqual({
      people: 1,
      companies: 1,
      skipped: 1,
      errors: 0,
      nextCursor: "2",
      done: true,
    });
  });

  it("does not acknowledge a database read failure", async () => {
    await expect(
      runMemberSyncBatch({
        cursor: "100",
        limit: 25,
        readPage: async () => {
          throw new Error("database unavailable");
        },
        sync: async (id) => snapshot(id),
      }),
    ).rejects.toThrow("database unavailable");
  });
});
