import { describe, expect, it } from "vitest";
import {
  REVISION_FIELDS,
  REVISION_MIN_INTERVAL_MS,
  pickRestorableFields,
  pickRevisionSnapshot,
  revisionTouches,
  shouldSnapshot,
} from "./revisions";

describe("revisionTouches", () => {
  it("detects content-bearing fields", () => {
    expect(revisionTouches({ title_pl: "Nowy tytuł" })).toBe(true);
    expect(revisionTouches({ blocks_data: { pl: { version: 1, blocks: [] } } })).toBe(true);
    expect(revisionTouches({ status: "pending_review" })).toBe(true);
  });

  it("ignores non-content fields", () => {
    expect(revisionTouches({ slug: "new-slug" })).toBe(false);
    expect(revisionTouches({ parent_page_id: "x", publish_at: "2026-07-03" })).toBe(false);
    expect(revisionTouches({})).toBe(false);
  });
});

describe("pickRevisionSnapshot / pickRestorableFields", () => {
  const row = {
    id: "post-1",
    tenant_id: "tenant-1",
    slug: "hello",
    title_pl: "Cześć",
    title_en: "Hello",
    content_pl: "<p>Treść</p>",
    status: "published",
    editor: "blocks",
    search_vector: "tsvector-noise",
  };

  it("keeps only snapshot fields (no id/tenant/slug/search noise)", () => {
    const snapshot = pickRevisionSnapshot(row);
    expect(Object.keys(snapshot).sort()).toEqual(REVISION_FIELDS.filter((f) => f in row).sort());
    expect(snapshot).not.toHaveProperty("id");
    expect(snapshot).not.toHaveProperty("tenant_id");
    expect(snapshot).not.toHaveProperty("slug");
    expect(snapshot).not.toHaveProperty("search_vector");
  });

  it("never restores status - restoring content must not (un)publish", () => {
    const restorable = pickRestorableFields(pickRevisionSnapshot(row));
    expect(restorable).not.toHaveProperty("status");
    expect(restorable).toHaveProperty("title_pl", "Cześć");
    expect(restorable).toHaveProperty("content_pl", "<p>Treść</p>");
  });
});

describe("shouldSnapshot", () => {
  const now = Date.parse("2026-07-02T12:00:00.000Z");

  it("writes the first snapshot and honours the throttle window", () => {
    expect(shouldSnapshot(null, now)).toBe(true);
    const justNow = new Date(now - 30_000).toISOString();
    expect(shouldSnapshot(justNow, now)).toBe(false);
    const longAgo = new Date(now - REVISION_MIN_INTERVAL_MS).toISOString();
    expect(shouldSnapshot(longAgo, now)).toBe(true);
  });

  it("force bypasses the throttle and bad timestamps fail open", () => {
    const justNow = new Date(now - 1_000).toISOString();
    expect(shouldSnapshot(justNow, now, true)).toBe(true);
    expect(shouldSnapshot("garbage", now)).toBe(true);
  });
});
