import { describe, expect, it } from "vitest";
import {
  POST_STATUSES,
  evaluateTransition,
  isFirstPublish,
  isPostWorkflowStatus,
  isoToLocalInput,
  localInputToIso,
  statusOptionsFor,
} from "./workflow";

const publisher = { canPublish: true };
const writer = { canPublish: false };

describe("evaluateTransition", () => {
  it("lets a publisher publish and schedule from any status", () => {
    expect(evaluateTransition(publisher, "draft", "published")).toEqual({ ok: true });
    expect(
      evaluateTransition(publisher, "pending_review", "scheduled", "2026-07-03T10:00:00.000Z"),
    ).toEqual({ ok: true });
  });

  it("denies publishing and scheduling to non-publishers", () => {
    expect(evaluateTransition(writer, "draft", "published")).toEqual({
      ok: false,
      reason: "requires_publisher",
    });
    expect(evaluateTransition(writer, "draft", "scheduled", "2026-07-03T10:00:00.000Z")).toEqual({
      ok: false,
      reason: "requires_publisher",
    });
  });

  it("lets anyone submit for review, archive or go back to draft", () => {
    expect(evaluateTransition(writer, "draft", "pending_review")).toEqual({ ok: true });
    expect(evaluateTransition(writer, "pending_review", "draft")).toEqual({ ok: true });
    expect(evaluateTransition(writer, "draft", "archived")).toEqual({ ok: true });
  });

  it("does not gate a re-save that keeps the current status", () => {
    expect(evaluateTransition(writer, "published", "published")).toEqual({ ok: true });
  });

  it("requires publish_at for the scheduled target", () => {
    expect(evaluateTransition(publisher, "draft", "scheduled", null)).toEqual({
      ok: false,
      reason: "requires_publish_at",
    });
    expect(evaluateTransition(publisher, "draft", "scheduled", undefined)).toEqual({
      ok: false,
      reason: "requires_publish_at",
    });
  });
});

describe("isFirstPublish", () => {
  const firstPublishedAt = "2026-01-01T00:00:00.000Z";

  it("stamps on the first transition into published, from any status", () => {
    expect(isFirstPublish("draft", "published", null)).toBe(true);
    expect(isFirstPublish("pending_review", "published", null)).toBe(true);
    expect(isFirstPublish("scheduled", "published", null)).toBe(true);
  });

  it("never re-stamps a routine re-save of a published entity", () => {
    // The editor always re-sends status: "published" for a live post; fixing
    // a typo must not move the article to the top of the archive and feeds.
    expect(isFirstPublish("published", "published", firstPublishedAt)).toBe(false);
    // Even without a date, a same-status save is not a publication event.
    expect(isFirstPublish("published", "published", null)).toBe(false);
  });

  it("keeps the original date when re-publishing after an unpublish", () => {
    expect(isFirstPublish("draft", "published", firstPublishedAt)).toBe(false);
    expect(isFirstPublish("archived", "published", firstPublishedAt)).toBe(false);
    expect(isFirstPublish("pending_review", "published", firstPublishedAt)).toBe(false);
  });

  it("ignores transitions that do not target published", () => {
    expect(isFirstPublish("draft", "pending_review", null)).toBe(false);
    expect(isFirstPublish("published", "archived", firstPublishedAt)).toBe(false);
    expect(isFirstPublish("published", "draft", firstPublishedAt)).toBe(false);
    expect(isFirstPublish("draft", "scheduled", null)).toBe(false);
  });

  it("treats an empty-string date as never published", () => {
    expect(isFirstPublish("draft", "published", "")).toBe(true);
  });
});

describe("statusOptionsFor", () => {
  it("marks published and scheduled as publisher-only for writers", () => {
    const options = statusOptionsFor(writer);
    expect(options.map((o) => o.value)).toEqual([...POST_STATUSES]);
    const gated = options.filter((o) => o.publisherOnly).map((o) => o.value);
    expect(gated).toEqual(["scheduled", "published"]);
  });

  it("gates nothing for publishers", () => {
    expect(statusOptionsFor(publisher).every((o) => !o.publisherOnly)).toBe(true);
  });
});

describe("isPostWorkflowStatus", () => {
  it("accepts every workflow status and rejects unknown strings", () => {
    for (const status of POST_STATUSES) expect(isPostWorkflowStatus(status)).toBe(true);
    expect(isPostWorkflowStatus("deleted")).toBe(false);
    expect(isPostWorkflowStatus("")).toBe(false);
  });
});

describe("datetime-local conversions", () => {
  it("round-trips a local input value through ISO", () => {
    const local = "2026-07-03T14:30";
    const iso = localInputToIso(local);
    expect(iso).not.toBeNull();
    expect(isoToLocalInput(iso)).toBe(local);
  });

  it("returns empty/null for missing or invalid values", () => {
    expect(isoToLocalInput(null)).toBe("");
    expect(isoToLocalInput("not-a-date")).toBe("");
    expect(localInputToIso("")).toBeNull();
    expect(localInputToIso("not-a-date")).toBeNull();
  });
});
