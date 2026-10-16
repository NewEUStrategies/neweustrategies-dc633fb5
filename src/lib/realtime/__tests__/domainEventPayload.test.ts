// Odczyt payloadu zdarzenia domenowego. Kolumna `payload` jest typowana jako
// `Json`, więc w wierszu może przyjść tablica, napis, liczba albo null -
// reguły inwalidacji (eventInvalidationMap) czytają z niej identyfikatory
// i nie mogą się wywrócić na kształcie innym niż obiekt.
import { describe, expect, it } from "vitest";
import { eventPayload, eventPayloadText, type DomainEventRow } from "@/lib/realtime/domainEvents";

function eventWith(payload: DomainEventRow["payload"]): DomainEventRow {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    tenant_id: "00000000-0000-0000-0000-000000000002",
    aggregate_type: "comment",
    aggregate_id: "00000000-0000-0000-0000-000000000003",
    event_type: "comment.created.v1",
    payload,
    correlation_id: null,
    actor_id: null,
    created_at: new Date(0).toISOString(),
  };
}

describe("eventPayload", () => {
  it("oddaje obiekt payloadu bez zmian", () => {
    expect(eventPayload(eventWith({ post_id: "p1", n: 2 }))).toEqual({ post_id: "p1", n: 2 });
  });

  it("tablica, napis, liczba i null dają pusty obiekt zamiast wyjątku", () => {
    for (const payload of [["p1"], "p1", 7, null, true]) {
      expect(eventPayload(eventWith(payload))).toEqual({});
    }
  });
});

describe("eventPayloadText", () => {
  it("czyta pole tekstowe", () => {
    expect(eventPayloadText(eventWith({ post_id: "p1" }), "post_id")).toBe("p1");
  });

  it("brak pola, wartość nie-tekstowa albo payload nie-obiekt dają pusty napis", () => {
    expect(eventPayloadText(eventWith({ post_id: 5 }), "post_id")).toBe("");
    expect(eventPayloadText(eventWith({}), "post_id")).toBe("");
    expect(eventPayloadText(eventWith(["post_id"]), "post_id")).toBe("");
  });
});
