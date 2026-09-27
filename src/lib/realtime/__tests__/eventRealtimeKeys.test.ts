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
import { registrationKeys } from "@/lib/events/useEventRegistrations";
import { cfpKeys } from "@/lib/events/useEventCfp";
import { cfpMeKeys } from "@/lib/events/useCfpMe";
import { eventInvoiceKeys } from "@/lib/events/useEventInvoices";
import { myEventInvoiceKeys } from "@/lib/events/useMyEventInvoices";
import { seatingKeys } from "@/lib/events/useEventSeating";
import { mySeatsKey, ticketSeatsKey } from "@/lib/events/useMySeats";
import { sponsorReportKeys } from "@/lib/events/useSponsorReport";
import { eventCloneKeys } from "@/lib/events/useEventClone";
import { adminEventKeys } from "@/lib/events/useAdminEvents";

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

/** Czy któryś klucz inwalidacji jest przedrostkiem (gałęzią) podanego klucza zapytania. */
function coversKey(keys: readonly unknown[][], queryKey: readonly unknown[]): boolean {
  return keys.some((key) => key.every((part, index) => Object.is(queryKey[index], part)));
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

  it.each(["event_scanner_device.roster_downloaded.v1", "event_scanner_device.offline_changed.v1"])(
    "lista offline skanera (%s) odświeża urządzenia TEGO wydarzenia, nie cudzego",
    (type) => {
      const keys = invalidationKeysFor(
        domainEvent(type, { event_id: EVENT_ID }),
        CTX,
      ) as unknown[][];
      // Unieważniony klucz jest PRZEDROSTKIEM klucza listy urządzeń tego wydarzenia.
      const devices: readonly unknown[] = onsiteKeys.devices(EVENT_ID);
      expect(keys.some((key) => key.every((part, i) => Object.is(devices[i], part)))).toBe(true);
      expect(includesPrefix(keys, onsiteKeys.event("inne-wydarzenie"))).toBe(false);
    },
  );

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

  it("zgłoszenia trafiają w gałąź wydarzenia I w profil uczestnika", () => {
    // Sześć trzyczłonowych nazw (`event.registration.*`) było poza katalogiem,
    // więc `invalidationKeysFor` zwracało [] - listy zgłoszeń, liczniki miejsc
    // i "moje zgłoszenia" nie odświeżały się na żywo.
    for (const type of [
      "event.registration.created.v1",
      "event.registration.updated.v1",
      "event.registration.decided.v1",
      "event.registration.cancelled.v1",
      "event.registration.promoted.v1",
      "event.registration.payment.v1",
    ]) {
      const keys = invalidationKeysFor(
        domainEvent(type, { event_id: EVENT_ID }),
        CTX,
      ) as unknown[][];
      expect(includesPrefix(keys, registrationKeys.event(EVENT_ID)), type).toBe(true);
      expect(includesPrefix(keys, ["profile", "event-registrations"]), type).toBe(true);
      expect(includesPrefix(keys, ["account-menu", "my-events"]), type).toBe(true);
    }
  });

  it("link raportu sponsora trafia w raport TEGO wydarzenia i w karty firm, nie w stronę publiczną", () => {
    // Dopasowanie TanStack Query: unieważniony klucz jest PRZEDROSTKIEM klucza
    // zapytania - więc sprawdzamy klucze zapytań z fabryki raportu.
    const hitsQuery = (keys: readonly unknown[][], queryKey: readonly unknown[]) =>
      keys.some((key) => key.every((part, index) => Object.is(queryKey[index], part)));
    for (const type of [
      "event_sponsor_report_link.issued.v1",
      "event_sponsor_report_link.revoked.v1",
    ]) {
      const keys = invalidationKeysFor(
        domainEvent(type, { event_id: EVENT_ID, sponsor_id: "s", link_id: "l" }),
        CTX,
      ) as unknown[][];
      expect(hitsQuery(keys, sponsorReportKeys.links(EVENT_ID)), type).toBe(true);
      expect(hitsQuery(keys, sponsorReportKeys.company("firma")), type).toBe(true);
      expect(hitsQuery(keys, sponsorReportKeys.links("inne-wydarzenie")), type).toBe(false);
      expect(includesPrefix(keys, ["public-event"]), type).toBe(false);
    }
    const bezWydarzenia = invalidationKeysFor(
      domainEvent("event_sponsor_report_link.revoked.v1", {}),
      CTX,
    ) as unknown[][];
    expect(hitsQuery(bezWydarzenia, sponsorReportKeys.links("dowolne"))).toBe(true);
  });

  it("zmiany zgłoszeń (w tym wpłata i zwrot) odświeżają ekran faktur TEGO wydarzenia i profil kupującego", () => {
    // Zwrot z karty albo odwołanie po wystawieniu faktury zapala podpowiedź
    // korekty, a wpłata zmienia listę zamówień do zafakturowania - bez tych
    // kluczy studio pokazywało stan sprzed zmiany do ręcznego odświeżenia.
    for (const type of [
      "event.registration.created.v1",
      "event.registration.updated.v1",
      "event.registration.decided.v1",
      "event.registration.cancelled.v1",
      "event.registration.promoted.v1",
      "event.registration.payment.v1",
    ]) {
      const keys = invalidationKeysFor(
        domainEvent(type, { event_id: EVENT_ID }),
        CTX,
      ) as unknown[][];
      expect(includesPrefix(keys, eventInvoiceKeys.event(EVENT_ID)), type).toBe(true);
      expect(includesPrefix(keys, myEventInvoiceKeys.all), type).toBe(true);
      expect(includesPrefix(keys, eventInvoiceKeys.event("inne-wydarzenie")), type).toBe(false);
      expect(includesPrefix(keys, registrationKeys.event(EVENT_ID)), type).toBe(true);
    }
    const bezWydarzenia = invalidationKeysFor(
      domainEvent("event.registration.payment.v1", {}),
      CTX,
    ) as unknown[][];
    expect(includesPrefix(bezWydarzenia, eventInvoiceKeys.all)).toBe(true);
  });

  it("zgłoszenie bez `event_id` degraduje do całej gałęzi zgłoszeń", () => {
    const keys = invalidationKeysFor(
      domainEvent("event.registration.decided.v1", {}),
      CTX,
    ) as unknown[][];
    expect(includesPrefix(keys, registrationKeys.all)).toBe(true);
  });

  it("nabór prelegentów trafia w gałąź wydarzenia w panelu I w gałąź uczestnika", () => {
    // Pięć zdarzeń naboru (wysłanie, decyzja, wycofanie, odpowiedź prelegenta,
    // ocena recenzenta) zmienia listę i liczniki organizatora ORAZ „moje
    // zgłoszenia", panel prelegenta i kolejkę recenzenta.
    for (const type of [
      "event_cfp_submission.submitted.v1",
      "event_cfp_submission.decided.v1",
      "event_cfp_submission.withdrawn.v1",
      "event_cfp_submission.confirmed.v1",
      "event_cfp_review.saved.v1",
    ]) {
      const keys = invalidationKeysFor(
        domainEvent(type, { event_id: EVENT_ID, submission_id: "s-1" }),
        CTX,
      ) as unknown[][];
      expect(includesPrefix(keys, cfpKeys.event(EVENT_ID)), type).toBe(true);
      expect(includesPrefix(keys, cfpMeKeys.all), type).toBe(true);
    }
  });

  it("zdarzenie naboru bez `event_id` degraduje do całego korzenia panelu", () => {
    const keys = invalidationKeysFor(
      domainEvent("event_cfp_submission.submitted.v1", {}),
      CTX,
    ) as unknown[][];
    expect(includesPrefix(keys, cfpKeys.all)).toBe(true);
    expect(includesPrefix(keys, cfpMeKeys.all)).toBe(true);
  });

  it("faktury trafiają w gałąź wydarzenia w studiu I w profil kupującego", () => {
    // Wystawienie zmienia jednocześnie listę zamówień do zafakturowania,
    // listę dokumentów i kartę "Faktury za wydarzenia" kupującego.
    for (const type of ["event_invoice.issued.v1", "event_invoice.cancelled.v1"]) {
      const keys = invalidationKeysFor(
        domainEvent(type, { event_id: EVENT_ID, invoice_id: EVENT_ID }),
        CTX,
      ) as unknown[][];
      expect(includesPrefix(keys, eventInvoiceKeys.event(EVENT_ID)), type).toBe(true);
      expect(includesPrefix(keys, myEventInvoiceKeys.all), type).toBe(true);
      expect(includesPrefix(keys, eventInvoiceKeys.event("inne-wydarzenie")), type).toBe(false);
    }
  });

  it("faktura bez `event_id` degraduje do całej gałęzi faktur", () => {
    const keys = invalidationKeysFor(
      domainEvent("event_invoice.issued.v1", {}),
      CTX,
    ) as unknown[][];
    expect(includesPrefix(keys, eventInvoiceKeys.all)).toBe(true);
  });

  it("plan sali: przydział i zwolnienie trafiają w plan I w listę zgłoszeń TEGO wydarzenia", () => {
    for (const type of ["event_seat.assigned.v1", "event_seat.released.v1"]) {
      const keys = invalidationKeysFor(
        domainEvent(type, { event_id: EVENT_ID }),
        CTX,
      ) as unknown[][];
      expect(includesPrefix(keys, seatingKeys.event(EVENT_ID)), type).toBe(true);
      expect(includesPrefix(keys, registrationKeys.event(EVENT_ID)), type).toBe(true);
      // Para: inne wydarzenie zostaje nietknięte.
      expect(
        includesPrefix(keys, seatingKeys.event("ffffffff-ffff-ffff-ffff-ffffffffffff")),
        type,
      ).toBe(false);
    }
  });

  it("plan sali: zmiana układu odświeża wyłącznie plan, bez listy zgłoszeń", () => {
    const keys = invalidationKeysFor(
      domainEvent("event_seat_map.changed.v1", { event_id: EVENT_ID }),
      CTX,
    ) as unknown[][];
    expect(includesPrefix(keys, seatingKeys.event(EVENT_ID))).toBe(true);
    expect(includesPrefix(keys, registrationKeys.all)).toBe(false);
  });

  it("plan sali bez `event_id` degraduje do całych gałęzi planu i zgłoszeń", () => {
    const released = invalidationKeysFor(
      domainEvent("event_seat.released.v1", {}),
      CTX,
    ) as unknown[][];
    expect(includesPrefix(released, seatingKeys.all)).toBe(true);
    expect(includesPrefix(released, registrationKeys.all)).toBe(true);
    const changed = invalidationKeysFor(
      domainEvent("event_seat_map.changed.v1", {}),
      CTX,
    ) as unknown[][];
    expect(changed).toEqual([seatingKeys.all, ["event-me"], ["event-ticket-seats"]]);
  });

  it("plan sali: każda zmiana odświeża karty miejsc uczestnika (panel „Moje” i bilet)", () => {
    for (const type of [
      "event_seat.assigned.v1",
      "event_seat.released.v1",
      "event_seat_map.changed.v1",
    ]) {
      const keys = invalidationKeysFor(
        domainEvent(type, { event_id: EVENT_ID }),
        CTX,
      ) as unknown[][];
      // Payload nie niesie sluga - literał gałęzi musi być prefiksem kluczy z fabryk.
      expect(coversKey(keys, mySeatsKey("kongres")), type).toBe(true);
      expect(coversKey(keys, ticketSeatsKey("kongres")), type).toBe(true);
    }
  });
});

/** TanStack uniewaznia zapytanie, gdy klucz z mapy jest PRZEDROSTKIEM jego klucza. */
function invalidates(keys: readonly unknown[][], queryKey: readonly unknown[]): boolean {
  return keys.some((key) => key.every((part, index) => Object.is(queryKey[index], part)));
}

describe("klon edycji (event.cloned.v1)", () => {
  it("odswieza liste wydarzen i liste edycji ZRODLA, nie cudzego wydarzenia", () => {
    const keys = invalidationKeysFor(
      domainEvent("event.cloned.v1", {
        event_id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
        source_event_id: EVENT_ID,
      }),
      CTX,
    ) as unknown[][];
    expect(includesPrefix(keys, adminEventKeys.all)).toBe(true);
    expect(includesPrefix(keys, eventCloneKeys.event(EVENT_ID))).toBe(true);
    expect(invalidates(keys, eventCloneKeys.editions(EVENT_ID))).toBe(true);
    expect(invalidates(keys, eventCloneKeys.editions("99999999-9999-9999-9999-999999999999"))).toBe(
      false,
    );
  });

  it("bez zrodla w payloadzie degraduje do calego korzenia klonu", () => {
    const keys = invalidationKeysFor(domainEvent("event.cloned.v1", {}), CTX) as unknown[][];
    expect(keys).toContainEqual([...eventCloneKeys.all]);
    expect(invalidates(keys, eventCloneKeys.editions(EVENT_ID))).toBe(true);
  });
});
