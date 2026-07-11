// Mapa inwalidacji: kompletność (każdy typ zdarzenia z katalogu ma regułę)
// i odporność (nieznany typ zdarzenia nie wywraca konsumenta).
import { describe, it, expect } from "vitest";
import { DOMAIN_EVENT_TYPES, type DomainEventRow } from "@/lib/realtime/domainEvents";
import { eventInvalidationMap, invalidationKeysFor } from "@/lib/realtime/eventInvalidationMap";

function eventOf(eventType: string): DomainEventRow {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    tenant_id: "00000000-0000-0000-0000-000000000002",
    aggregate_type: eventType.split(".")[0],
    aggregate_id: "00000000-0000-0000-0000-000000000003",
    event_type: eventType,
    payload: { post_id: "p1", lead_id: "l1" },
    correlation_id: null,
    actor_id: null,
    created_at: new Date(0).toISOString(),
  };
}

describe("eventInvalidationMap", () => {
  it("covers every domain event type from the catalog", () => {
    const missing = DOMAIN_EVENT_TYPES.filter((type) => !(type in eventInvalidationMap));
    expect(missing).toEqual([]);
  });

  it("every rule returns at least one non-empty query key", () => {
    for (const type of DOMAIN_EVENT_TYPES) {
      const keys = invalidationKeysFor(eventOf(type), { userId: "u1" });
      expect(keys.length, `rule for ${type}`).toBeGreaterThan(0);
      for (const key of keys) {
        expect(Array.isArray(key), `key of ${type} is an array`).toBe(true);
        expect(key.length, `key of ${type} non-empty`).toBeGreaterThan(0);
      }
    }
  });

  it("returns no keys for an unknown event type instead of throwing", () => {
    expect(invalidationKeysFor(eventOf("hologram.materialized.v9"), { userId: "u1" })).toEqual([]);
  });

  it("routes comment events to the post-scoped comments key", () => {
    const keys = invalidationKeysFor(eventOf("comment.created.v1"), { userId: "u1" });
    expect(keys).toContainEqual(["comments", "p1"]);
  });
});
