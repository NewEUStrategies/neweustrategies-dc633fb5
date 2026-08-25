import { describe, expect, it } from "vitest";
import type { MyMeetingRow } from "@/lib/events/meetingsApi";
import {
  bucketMeetings,
  canCancel,
  canReschedule,
  canRespond,
  counterpartLabel,
  counterpartRole,
  isIncoming,
  meetingStatusI18nKey,
  meetingStatusTone,
  tableLabel,
} from "@/lib/events/myMeetingRows";

function row(overrides: Partial<MyMeetingRow> = {}): MyMeetingRow {
  return {
    id: "m-1",
    event_id: "e-1",
    side: "invitee",
    status: "invited",
    is_expired: false,
    starts_at: "2026-09-14T09:00:00Z",
    ends_at: "2026-09-14T09:20:00Z",
    expires_at: "2026-09-13T09:00:00Z",
    counterpart_registration_id: "r-2",
    counterpart_first_name: "Anna",
    counterpart_last_name: "Kowalska",
    counterpart_job_title: "Director",
    counterpart_company: "Acme",
    table_label: "Stolik 3",
    table_zone: "Foyer",
    table_seat: 2,
    topic: "Energia",
    sponsor_id: "",
    sponsor_name: "",
    invitation_message: "",
    decline_reason: "",
    cancel_reason: "",
    cancelled_side: "",
    responded_at: "",
    created_at: "2026-09-01T09:00:00Z",
    ...overrides,
  } as MyMeetingRow;
}

describe("myMeetingRows", () => {
  it("odpowiedziec moze tylko zaproszony, na otwarte i niewygasle zaproszenie", () => {
    expect(canRespond(row())).toBe(true);
    expect(canRespond(row({ side: "requester" }))).toBe(false);
    expect(canRespond(row({ is_expired: true }))).toBe(false);
    expect(canRespond(row({ status: "accepted" }))).toBe(false);
  });

  it("odwolac i przelozyc da sie spotkanie zywe, po obu stronach", () => {
    expect(canCancel(row({ side: "requester", status: "accepted" }))).toBe(true);
    expect(canReschedule(row({ status: "accepted" }))).toBe(true);
    expect(canCancel(row({ status: "cancelled" }))).toBe(false);
    expect(canCancel(row({ status: "invited", is_expired: true }))).toBe(false);
  });

  it("wygasle zaproszenie ma wlasny klucz statusu", () => {
    expect(meetingStatusI18nKey(row())).toBe("eventMeetings.status.invited");
    expect(meetingStatusI18nKey(row({ is_expired: true }))).toBe("eventMeetings.status.expired");
    expect(meetingStatusI18nKey(row({ status: "held" }))).toBe("eventMeetings.status.held");
  });

  it("koloruje statusy zgodnie z ich skutkiem", () => {
    expect(meetingStatusTone(row({ status: "accepted" }))).toBe("default");
    expect(meetingStatusTone(row({ status: "no_show" }))).toBe("destructive");
    expect(meetingStatusTone(row())).toBe("secondary");
  });

  it("nigdy nie sklada podpisu rozmowcy z brakow", () => {
    expect(counterpartLabel(row(), "Rozmówca")).toBe("Anna Kowalska");
    expect(
      counterpartLabel(row({ counterpart_first_name: "", counterpart_last_name: "" }), "Rozmówca"),
    ).toBe("Acme");
    expect(
      counterpartLabel(
        row({ counterpart_first_name: "", counterpart_last_name: "", counterpart_company: "" }),
        "Rozmówca",
      ),
    ).toBe("Rozmówca");
    expect(counterpartRole(row())).toBe("Director · Acme");
    expect(counterpartRole(row({ counterpart_job_title: "", counterpart_company: "" }))).toBeNull();
  });

  it("brak stolika zwraca null, zeby UI mogl napisac 'przydzielimy po potwierdzeniu'", () => {
    expect(tableLabel(row())).toBe("Stolik 3 · Foyer");
    expect(tableLabel(row({ table_zone: "" }))).toBe("Stolik 3");
    expect(tableLabel(row({ table_label: "" }))).toBeNull();
  });

  it("rozdziela kolejki, a stany zamkniete i wygasle wysyla do archiwum", () => {
    const rows = [
      row({ id: "a" }),
      row({ id: "b", side: "requester" }),
      row({ id: "c", status: "declined" }),
      row({ id: "d", is_expired: true }),
      row({ id: "e", side: "requester", status: "accepted" }),
    ];
    const buckets = bucketMeetings(rows);
    expect(buckets.incoming.map((item) => item.id)).toEqual(["a"]);
    expect(buckets.outgoing.map((item) => item.id)).toEqual(["b", "e"]);
    expect(buckets.archive.map((item) => item.id)).toEqual(["c", "d"]);
    expect(isIncoming(row())).toBe(true);
  });
});
