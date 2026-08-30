import { describe, expect, it } from "vitest";

import { awaitsPayment, bucketOf, groupMyEvents } from "@/lib/events/myEventsGrouping";
import type { ParticipantRegistration } from "@/lib/events/participantTicketsApi";

function registration(overrides: Partial<ParticipantRegistration> = {}): ParticipantRegistration {
  const base: ParticipantRegistration = {
    registrationId: "r1",
    status: "approved",
    paymentStatus: "paid",
    createdAt: null,
    cancelledAt: null,
    paidAt: null,
    waitlistPosition: null,
    promotedAt: null,
    notifyEmail: true,
    notifySms: false,
    cancelReason: null,
    decisionSource: null,
    eventSlug: "szczyt",
    eventTitlePl: "Szczyt",
    eventTitleEn: "Summit",
    eventStartsAt: "2026-10-01T09:00:00.000Z",
    eventEndsAt: null,
    eventTimezone: "Europe/Warsaw",
    orderStatus: "paid",
    amountCents: 19900,
    refundedCents: 0,
    currency: "PLN",
    webhooks: [],
  };
  return { ...base, ...overrides };
}

const NOW = new Date("2026-09-01T00:00:00.000Z");

describe("myEventsGrouping", () => {
  it("granicą jest start wydarzenia, nie status zgłoszenia", () => {
    expect(bucketOf(registration({ cancelledAt: "2026-08-20T00:00:00.000Z" }), NOW)).toBe(
      "upcoming",
    );
    expect(bucketOf(registration({ eventStartsAt: "2026-01-01T00:00:00.000Z" }), NOW)).toBe("past");
  });

  it("wydarzenie bez terminu zostaje wśród nadchodzących", () => {
    expect(bucketOf(registration({ eventStartsAt: null }), NOW)).toBe("upcoming");
  });

  it("nadchodzące rosnąco, minione malejąco", () => {
    const groups = groupMyEvents(
      [
        registration({ registrationId: "a", eventStartsAt: "2026-12-01T00:00:00.000Z" }),
        registration({ registrationId: "b", eventStartsAt: "2026-10-01T00:00:00.000Z" }),
        registration({ registrationId: "c", eventStartsAt: "2026-05-01T00:00:00.000Z" }),
        registration({ registrationId: "d", eventStartsAt: "2026-07-01T00:00:00.000Z" }),
      ],
      NOW,
    );
    expect(groups.upcoming.map((entry) => entry.registrationId)).toEqual(["b", "a"]);
    expect(groups.past.map((entry) => entry.registrationId)).toEqual(["d", "c"]);
  });

  it("wydarzenie w toku trafia do koszyka „bieżące”", () => {
    expect(
      bucketOf(
        registration({
          eventStartsAt: "2026-08-31T09:00:00.000Z",
          eventEndsAt: "2026-09-02T18:00:00.000Z",
        }),
        NOW,
      ),
    ).toBe("current");
    // Bez daty końca liczy się doba od startu.
    expect(bucketOf(registration({ eventStartsAt: "2026-08-31T20:00:00.000Z" }), NOW)).toBe(
      "current",
    );
    expect(bucketOf(registration({ eventStartsAt: "2026-08-25T20:00:00.000Z" }), NOW)).toBe("past");
  });

  it("do zapłaty jest tylko żywe zgłoszenie z kwotą i bez opłacenia", () => {
    expect(awaitsPayment(registration({ paymentStatus: "unpaid", orderStatus: "pending" }))).toBe(
      true,
    );
    expect(awaitsPayment(registration())).toBe(false);
    expect(awaitsPayment(registration({ amountCents: 0 }))).toBe(false);
    expect(
      awaitsPayment(
        registration({
          paymentStatus: "unpaid",
          orderStatus: "pending",
          cancelledAt: "2026-08-01T00:00:00.000Z",
        }),
      ),
    ).toBe(false);
  });
});
