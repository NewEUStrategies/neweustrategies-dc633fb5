// Gate against event-bus contract drift: every event type the DATABASE emits
// via emit_domain_event(...) must be declared in the frontend catalog
// (DOMAIN_EVENT_TYPES) - otherwise invalidationKeysFor() returns [] and that
// module's cross-module live invalidation silently no-ops. This scans the
// migrations directly (source of truth) rather than trusting the catalog.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DOMAIN_AGGREGATE_TYPES, DOMAIN_EVENT_TYPES } from "@/lib/realtime/domainEvents";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
// Nazwa zdarzenia ma CO NAJMNIEJ dwa człony przed `.vN`, ale moduł wydarzeń
// emituje też trzyczłonowe (`event.registration.created.v1`). Sztywne dwa
// człony sprawiały, że bramka nie widziała tych sześciu emiterów i świeciła
// na zielono mimo braku reguł inwalidacji.
const EVENT_TYPE_RE = /'([a-z_]+(?:\.[a-z_]+)+\.v\d+)'/;

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

// Spec B.9: Foundation deklaruje z góry WSZYSTKIE dwanaście zdarzeń funkcji
// uczestnika F1-F5 (tory tylko emitują - katalog jest dla nich zamrożony).
// Emitery torów B i C pojawią się w ich migracjach; ta lista pilnuje, że
// żaden literał nie zniknie ani nie zmieni nazwy przed ich scaleniem.
describe("zdarzenia funkcji uczestnika F1-F5 (spec B.9)", () => {
  const PARTICIPANT_EVENT_TYPES = [
    "event.participant_settings.updated.v1",
    "event.registration.offered.v1",
    "event.registration.offer_closed.v1",
    "event.registration.transfer_requested.v1",
    "event.registration.transfer_cancelled.v1",
    "event.registration.transferred.v1",
    "event.registration.refund_requested.v1",
    "event.registration.refund_failed.v1",
    "event.certificate.issued.v1",
    "event.certificate.revoked.v1",
    "event.survey.submitted.v1",
    "event.survey.questions_changed.v1",
  ];

  it("wszystkie dwanaście typów jest w katalogu", () => {
    const catalog = new Set<string>(DOMAIN_EVENT_TYPES);
    expect(PARTICIPANT_EVENT_TYPES.filter((type) => !catalog.has(type))).toEqual([]);
    expect(new Set(DOMAIN_EVENT_TYPES).size).toBe(DOMAIN_EVENT_TYPES.length);
  });

  it("agregaty event_participant_settings, event_certificate i event_survey są w katalogu", () => {
    for (const aggregate of ["event_participant_settings", "event_certificate", "event_survey"]) {
      expect(DOMAIN_AGGREGATE_TYPES).toContain(aggregate);
    }
  });
});
