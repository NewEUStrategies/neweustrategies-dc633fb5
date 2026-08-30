import { describe, expect, it } from "vitest";
import {
  buildPublishReadiness,
  type ReadinessCheckKey,
  type ReadinessEvent,
  type ReadinessInput,
} from "@/lib/events/publishReadiness";

const completeEvent: ReadinessEvent = {
  titlePl: "Kongres",
  titleEn: "Congress",
  startsAt: "2026-09-01T08:00:00Z",
  endsAt: "2026-09-01T16:00:00Z",
  timezone: "Europe/Warsaw",
  format: "onsite",
  city: "Bruksela",
  addressLine: "Rue de la Loi 1",
  onlineUrl: null,
  coverUrl: "https://cdn.test/cover.jpg",
  descriptionPl: "Opis",
  descriptionEn: "Description",
  status: "draft",
  registrationMode: "free",
};

function input(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    event: completeEvent,
    sessions: [{ status: "published", speakers_count: 2, room_id: "room-1", format: "onsite" }],
    conflictCount: 0,
    roomCount: 1,
    ticketTypeCount: 0,
    ...overrides,
  };
}

function failedKeys(report: ReturnType<typeof buildPublishReadiness>): ReadinessCheckKey[] {
  return report.checks.filter((item) => !item.passed).map((item) => item.key);
}

describe("buildPublishReadiness", () => {
  it("pozwala publikować kompletne wydarzenie", () => {
    const report = buildPublishReadiness(input());
    expect(failedKeys(report)).toEqual([]);
    expect(report.canPublish).toBe(true);
    expect(report.passedCount).toBe(report.totalCount);
  });

  it("blokuje publikację bez okładki, adresu i strefy", () => {
    const report = buildPublishReadiness(
      input({
        event: { ...completeEvent, coverUrl: " ", addressLine: null, timezone: null },
      }),
    );
    expect(report.canPublish).toBe(false);
    expect(report.blockers.map((item) => item.key).sort()).toEqual(["cover", "timezone", "venue"]);
  });

  it("nie wymaga adresu dla wydarzenia online, ale ostrzega o braku linku", () => {
    const report = buildPublishReadiness(
      input({
        event: { ...completeEvent, format: "online", city: null, addressLine: null },
        roomCount: 0,
      }),
    );
    expect(report.canPublish).toBe(true);
    expect(failedKeys(report)).toContain("onlineUrl");
    expect(failedKeys(report)).not.toContain("rooms");
  });

  it("odrzuca koniec przed początkiem", () => {
    const report = buildPublishReadiness(
      input({ event: { ...completeEvent, endsAt: "2026-08-01T08:00:00Z" } }),
    );
    expect(report.blockers.map((item) => item.key)).toContain("schedule");
  });

  it("liczy sesje bez prelegenta, bez sali i szkice - pomijając odwołane", () => {
    const report = buildPublishReadiness(
      input({
        sessions: [
          { status: "published", speakers_count: 0, room_id: null, format: "onsite" },
          { status: "draft", speakers_count: 1, room_id: "room-1", format: "onsite" },
          { status: "published", speakers_count: 0, room_id: null, format: "online" },
          { status: "cancelled", speakers_count: 0, room_id: null, format: "onsite" },
        ],
      }),
    );
    const byKey = new Map(report.checks.map((item) => [item.key, item]));
    expect(byKey.get("sessions")?.count).toBe(3);
    expect(byKey.get("sessionDrafts")?.count).toBe(1);
    expect(byKey.get("sessionSpeakers")?.count).toBe(2);
    expect(byKey.get("sessionRooms")?.count).toBe(1);
  });

  it("traktuje kolizje agendy jako blokadę", () => {
    const report = buildPublishReadiness(input({ conflictCount: 2 }));
    expect(report.canPublish).toBe(false);
    const conflicts = report.blockers.find((item) => item.key === "conflicts");
    expect(conflicts?.count).toBe(2);
    expect(conflicts?.section).toBe("contentConflicts");
  });

  it("wymaga typu biletu tylko przy płatnej rejestracji", () => {
    const free = buildPublishReadiness(input());
    expect(failedKeys(free)).not.toContain("tickets");

    const paid = buildPublishReadiness(
      input({ event: { ...completeEvent, registrationMode: "paid" } }),
    );
    expect(failedKeys(paid)).toContain("tickets");

    const paidWithTicket = buildPublishReadiness(
      input({ event: { ...completeEvent, registrationMode: "paid" }, ticketTypeCount: 2 }),
    );
    expect(failedKeys(paidWithTicket)).not.toContain("tickets");
  });
});
