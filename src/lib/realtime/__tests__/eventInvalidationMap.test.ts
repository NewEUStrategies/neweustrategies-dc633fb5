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

  it("routes participant settings updates to the event's admin panel and public options", () => {
    const event = {
      ...eventOf("event.participant_settings.updated.v1"),
      payload: { event_id: "e1", keys: ["refund_mode"] },
    };
    expect(invalidationKeysFor(event, { userId: "u1" })).toEqual([
      ["admin-event-participant-settings", "e1"],
      ["event-participant-options"],
    ]);
  });

  it("degrades participant settings updates without event_id to the whole panel prefix", () => {
    const event = { ...eventOf("event.participant_settings.updated.v1"), payload: { keys: [] } };
    expect(invalidationKeysFor(event, { userId: "u1" })).toEqual([
      ["admin-event-participant-settings"],
      ["event-participant-options"],
    ]);
  });

  // Spec B.9 - zdarzenia torów B i C: DOKŁADNE listy kluczy (literały są
  // kontraktem z fabrykami kluczy torów; każdy tor przypina je w swoim teście).
  const REGISTRATION_KEYS = (eventId: string | null) => [
    eventId === null ? ["event-registrations"] : ["event-registrations", eventId],
    ["profile", "event-registrations"],
    ["account-menu", "my-events"],
    ["event-rsvp-counts"],
    ["public-event"],
    eventId === null
      ? ["admin-event-registration-money"]
      : ["admin-event-registration-money", eventId],
  ];

  it.each([
    "event.registration.offered.v1",
    "event.registration.offer_closed.v1",
    "event.registration.transfer_requested.v1",
    "event.registration.transfer_cancelled.v1",
    "event.registration.refund_requested.v1",
    "event.registration.refund_failed.v1",
  ])("%s: zgłoszenie + znaczniki pieniędzy wydarzenia", (type) => {
    const event = { ...eventOf(type), payload: { event_id: "e1", offer_id: "o1" } };
    expect(invalidationKeysFor(event, { userId: "u1" })).toEqual(REGISTRATION_KEYS("e1"));
    const bare = { ...eventOf(type), payload: {} };
    expect(invalidationKeysFor(bare, { userId: "u1" })).toEqual(REGISTRATION_KEYS(null));
  });

  it("transferred: to samo + panel „moje wydarzenie” (klucz po slugu - cała gałąź)", () => {
    const event = {
      ...eventOf("event.registration.transferred.v1"),
      payload: { event_id: "e1", transfer_id: "t1", kind: "participant" },
    };
    expect(invalidationKeysFor(event, { userId: "u1" })).toEqual([
      ...REGISTRATION_KEYS("e1"),
      ["event-me"],
    ]);
  });

  it.each(["event.certificate.issued.v1", "event.certificate.revoked.v1"])(
    "%s: lista certyfikatów wydarzenia i panel follow-up",
    (type) => {
      const event = { ...eventOf(type), payload: { event_id: "e1", registration_id: "r1" } };
      expect(invalidationKeysFor(event, { userId: "u1" })).toEqual([
        ["admin-event-certificates", "e1"],
        ["event-follow-up"],
      ]);
      expect(invalidationKeysFor({ ...eventOf(type), payload: {} }, { userId: "u1" })).toEqual([
        ["admin-event-certificates"],
        ["event-follow-up"],
      ]);
    },
  );

  it("survey.submitted: wyniki i statystyki follow-up wydarzenia", () => {
    const event = { ...eventOf("event.survey.submitted.v1"), payload: { event_id: "e1" } };
    expect(invalidationKeysFor(event, { userId: "u1" })).toEqual([
      ["admin-event-survey-results", "e1"],
      ["admin-event-follow-up-stats", "e1"],
    ]);
    const bare = { ...eventOf("event.survey.submitted.v1"), payload: {} };
    expect(invalidationKeysFor(bare, { userId: "u1" })).toEqual([
      ["admin-event-survey-results"],
      ["admin-event-follow-up-stats"],
    ]);
  });

  it("survey.questions_changed: pytania wydarzenia i panel follow-up", () => {
    const event = { ...eventOf("event.survey.questions_changed.v1"), payload: { event_id: "e1" } };
    expect(invalidationKeysFor(event, { userId: "u1" })).toEqual([
      ["admin-event-survey-questions", "e1"],
      ["event-follow-up"],
    ]);
    const bare = { ...eventOf("event.survey.questions_changed.v1"), payload: {} };
    expect(invalidationKeysFor(bare, { userId: "u1" })).toEqual([
      ["admin-event-survey-questions"],
      ["event-follow-up"],
    ]);
  });

  it("invalidates public, admin and reputation caches for badge grants", () => {
    const keys = invalidationKeysFor(eventOf("profile_badge.granted.v1"), { userId: "u1" });
    expect(keys).toContainEqual(["profile-badges"]);
    expect(keys).toContainEqual(["admin-badges"]);
    expect(keys).toContainEqual(["contributor-leaderboard"]);
    expect(keys).toContainEqual(["public", "experts-directory"]);
  });
});
