// Gate against event-bus contract drift: every event type the DATABASE emits
// via emit_domain_event(...) must be declared in the frontend catalog
// (DOMAIN_EVENT_TYPES) - otherwise invalidationKeysFor() returns [] and that
// module's cross-module live invalidation silently no-ops. This scans the
// migrations directly (source of truth) rather than trusting the catalog.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DOMAIN_EVENT_TYPES } from "@/lib/realtime/domainEvents";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const EVENT_TYPE_RE = /'([a-z_]+\.[a-z_]+\.v\d+)'/;

function emittedEventTypes(): string[] {
  const found = new Set<string>();
  for (const file of readdirSync(MIGRATIONS_DIR)) {
    if (!file.endsWith(".sql")) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    if (!sql.includes("emit_domain_event")) continue;
    // For each emit_domain_event(...) call, the first `<agg>.<verb>.vN` literal
    // in the statement is the event_type argument.
    const segments = sql.split("emit_domain_event");
    for (let i = 1; i < segments.length; i++) {
      const stmt = segments[i].split(";")[0];
      const m = stmt.match(EVENT_TYPE_RE);
      if (m) found.add(m[1]);
    }
  }
  return [...found].sort();
}

describe("domain event catalog vs DB emitters", () => {
  it("declares every event type emitted by a migration", () => {
    const emitted = emittedEventTypes();
    const catalog = new Set<string>(DOMAIN_EVENT_TYPES);
    const missing = emitted.filter((t) => !catalog.has(t));
    expect(
      missing,
      `Emitted in migrations but missing from DOMAIN_EVENT_TYPES (+ add an eventInvalidationMap rule): ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("finds the expected emitters (sanity: the scan actually matched something)", () => {
    expect(emittedEventTypes().length).toBeGreaterThanOrEqual(10);
  });
});
