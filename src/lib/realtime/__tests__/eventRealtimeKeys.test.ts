// Zgodność literałów w mapie inwalidacji z fabrykami kluczy modułu wydarzeń.
//
// DLACZEGO TEN TEST ISTNIEJE. `eventInvalidationMap` nie importuje fabryk
// (`meetingKeys`, `onsiteKeys`, `sponsorKeys`), bo te mieszkają w plikach
// hooków - import wciągnąłby React Query i całą warstwę zapytań modułu do
// pliku, który czyta konsument szyny zdarzeń. Ceną za to jest literał, a
// literał milczy: zmiana korzenia klucza w fabryce nie oblewa niczego,
// a inwalidacja po prostu przestaje trafiać. Panel organizatora nadal
// wygląda poprawnie - tylko nie odświeża się po zdarzeniu, co widać dopiero
// w dniu wydarzenia. Ten test zamienia to milczenie w czerwoną bramkę.
import { describe, expect, it } from "vitest";
import { invalidationKeysFor } from "@/lib/realtime/eventInvalidationMap";
import type { DomainEventRow } from "@/lib/realtime/domainEvents";
import { meetingKeys } from "@/lib/events/useMeetings";
import { myMeetingKeys } from "@/lib/events/useMyMeetings";
import { onsiteKeys } from "@/lib/events/useEventOnsite";
import { sponsorKeys } from "@/lib/events/useEventSponsors";

const EVENT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CTX = { userId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" };

function domainEvent(type: string, payload: Record<string, unknown>): DomainEventRow {
  return {
    id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    tenant_id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    aggregate_type: type.split(".")[0],
    aggregate_id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
    event_type: type,
    payload,
    actor_id: null,
    created_at: "2026-09-01T10:00:00.000Z",
  } as unknown as DomainEventRow;
}

/** Odwzorowanie dopasowania TanStack Query: klucz pasuje po PRZEDROSTKU. */
function includesPrefix(keys: readonly unknown[][], prefix: readonly unknown[]): boolean {
  return keys.some((key) => prefix.every((part, index) => Object.is(key[index], part)));
}

describe("mapa inwalidacji modułu wydarzeń", () => {
  it("spotkania trafiają w gałąź wydarzenia w panelu I w gałąź uczestnika", () => {
    const keys = invalidationKeysFor(
      domainEvent("event_meeting.invited.v1", { event_id: EVENT_ID }),
      CTX,
    ) as unknown[][];
    expect(includesPrefix(keys, meetingKeys.event(EVENT_ID))).toBe(true);
    expect(includesPrefix(keys, myMeetingKeys.all)).toBe(true);
  });

  it("urządzenia skanujące trafiają w gałąź obsługi na miejscu", () => {
    const keys = invalidationKeysFor(
      domainEvent("event_scanner_device.revoked.v1", { event_id: EVENT_ID }),
      CTX,
    ) as unknown[][];
    expect(includesPrefix(keys, onsiteKeys.event(EVENT_ID))).toBe(true);
  });

  it("sponsorzy trafiają w panel I w stronę publiczną wydarzenia", () => {
    const keys = invalidationKeysFor(
      domainEvent("event_sponsor.published.v1", { event_id: EVENT_ID }),
      CTX,
    ) as unknown[][];
    expect(includesPrefix(keys, sponsorKeys.event(EVENT_ID))).toBe(true);
    expect(includesPrefix(keys, ["public-event"])).toBe(true);
  });

  it("payload bez `event_id` degraduje do CAŁEJ gałęzi modułu, a nie do pustki", () => {
    // Zdarzenie ze starszego backendu może nie nieść `event_id`. Zwrócenie
    // pustej listy byłoby cichym brakiem odświeżenia - szersze unieważnienie
    // jest tańsze niż nieaktualny ekran.
    const keys = invalidationKeysFor(
      domainEvent("event_meeting.accepted.v1", {}),
      CTX,
    ) as unknown[][];
    expect(includesPrefix(keys, meetingKeys.all)).toBe(true);
  });
});
