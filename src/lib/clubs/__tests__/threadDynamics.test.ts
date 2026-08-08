import { describe, expect, it } from "vitest";
import {
  DYNAMICS_BUCKETS,
  computeThreadDynamics,
  formatDurationShort,
} from "@/lib/clubs/threadDynamics";

const iso = (minutesFromBase: number) =>
  new Date(Date.parse("2026-08-01T10:00:00.000Z") + minutesFromBase * 60_000).toISOString();

describe("threadDynamics", () => {
  it("zwraca zera dla wątku bez odpowiedzi", () => {
    const d = computeThreadDynamics(iso(0), []);
    expect(d.total).toBe(0);
    expect(d.participants).toBe(0);
    expect(d.peak).toBe(0);
    expect(d.firstReplyMinutes).toBeNull();
    expect(d.lastActivityAt).toBeNull();
    expect(d.buckets).toHaveLength(DYNAMICS_BUCKETS);
  });

  it("liczy uczestników per autor, alias i wpis bez autorstwa", () => {
    const d = computeThreadDynamics(iso(0), [
      { created_at: iso(10), author_id: "a", author_name: "A" },
      { created_at: iso(20), author_id: "a", author_name: "A" },
      { created_at: iso(30), author_id: null, author_alias: "Sokół" },
      { created_at: iso(40), author_id: null },
      { created_at: iso(50), author_id: null },
    ]);
    expect(d.total).toBe(5);
    expect(d.participants).toBe(4);
  });

  it("liczy czas do pierwszej odpowiedzi i medianę przerw", () => {
    const d = computeThreadDynamics(iso(0), [
      { created_at: iso(30), author_id: "a" },
      { created_at: iso(60), author_id: "b" },
      { created_at: iso(120), author_id: "c" },
    ]);
    expect(d.firstReplyMinutes).toBe(30);
    expect(d.medianGapMinutes).toBe(45);
    expect(d.lastActivityAt).toBe(iso(120));
  });

  it("rozkłada odpowiedzi na słupki i zna szczyt", () => {
    const d = computeThreadDynamics(iso(0), [
      { created_at: iso(1), author_id: "a" },
      { created_at: iso(2), author_id: "b" },
      { created_at: iso(240), author_id: "c" },
    ]);
    expect(d.buckets).toHaveLength(DYNAMICS_BUCKETS);
    expect(d.buckets.reduce((s, b) => s + b.count, 0)).toBe(3);
    expect(d.peak).toBe(2);
    expect(d.buckets[DYNAMICS_BUCKETS - 1]?.count).toBe(1);
  });

  it("liczy aktywność z ostatnich 24 h względem `now`", () => {
    const now = Date.parse(iso(3000));
    const d = computeThreadDynamics(
      iso(0),
      [
        { created_at: iso(10), author_id: "a" },
        { created_at: iso(2000), author_id: "b" },
        { created_at: iso(2990), author_id: "c" },
      ],
      now,
    );
    expect(d.last24h).toBe(2);
  });

  it("formatuje czas trwania", () => {
    expect(formatDurationShort(null)).toBeNull();
    expect(formatDurationShort(42)).toBe("42 min");
    expect(formatDurationShort(180)).toBe("3 h");
    expect(formatDurationShort(60 * 24 * 5)).toBe("5 d");
  });
});
