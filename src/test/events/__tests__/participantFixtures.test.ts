// Fabryki obiektów uczestnika - zgodność z parserami produkcyjnymi.
//
// Fabryka, która buduje obiekt w kształcie INNYM niż parser API, dawałaby
// testom torów A/B/C dane, których produkcja nigdy nie wytworzy. Dlatego każdą
// fabrykę porównujemy z wynikiem prawdziwego parsera dla równoważnej
// odpowiedzi RPC, a nadpisania i brak współdzielonego stanu - osobno.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import { parseParticipantSettings } from "@/lib/events/participantSettings";
import { fetchMyRegistrations } from "@/lib/events/participantTicketsApi";
import { fetchRegistrationManageView } from "@/lib/events/publicRegistrationApi";
import { fetchMyEventProfile } from "@/lib/events/myEventProfileApi";
import {
  PARTICIPANT_EVENT_SLUG,
  PARTICIPANT_IDS,
  makeEventParticipantOptions,
  makeMyEventRegistrationSummary,
  makeParticipantRegistration,
  makeParticipantSettings,
  makeRegistrationManageView,
} from "@/test/events/participantFixtures";

beforeEach(() => {
  rpc.mockReset();
});

describe("makeParticipantRegistration", () => {
  it("= wynik parsera event_my_registrations dla równoważnego wiersza", async () => {
    rpc.mockResolvedValue({
      data: {
        registrations: [
          {
            registration_id: PARTICIPANT_IDS.registration,
            event_id: PARTICIPANT_IDS.event,
            ticket_type_id: PARTICIPANT_IDS.ticketType,
            status: "approved",
            payment_status: "paid",
            created_at: "2030-05-01T10:00:00.000Z",
            paid_at: "2030-05-01T10:05:00.000Z",
            notify_email: true,
            notify_sms: false,
            event_slug: PARTICIPANT_EVENT_SLUG,
            event_title_pl: "Forum 2030",
            event_title_en: "Forum 2030",
            event_starts_at: "2030-06-10T08:00:00.000Z",
            event_ends_at: "2030-06-10T16:00:00.000Z",
            event_timezone: "Europe/Warsaw",
            order_status: "paid",
            amount_cents: 12000,
            refunded_amount_cents: 0,
            currency: "PLN",
            webhooks: [],
          },
        ],
      },
      error: null,
    });
    await expect(fetchMyRegistrations()).resolves.toEqual([makeParticipantRegistration()]);
  });

  it("nadpisania i świeże tablice", () => {
    const a = makeParticipantRegistration({ status: "waitlist", waitlistPosition: 3 });
    expect(a.status).toBe("waitlist");
    expect(a.waitlistPosition).toBe(3);
    a.webhooks.push({
      id: "w",
      eventType: "x",
      status: "processed",
      occurredAt: null,
      processedAt: null,
      retryCount: 0,
    });
    expect(makeParticipantRegistration().webhooks).toEqual([]);
  });
});

describe("makeRegistrationManageView", () => {
  it("= wynik parsera event_registration_manage_view", async () => {
    rpc.mockResolvedValue({
      data: {
        ok: true,
        registration_id: PARTICIPANT_IDS.registration,
        event_id: PARTICIPANT_IDS.event,
        event_slug: PARTICIPANT_EVENT_SLUG,
        ticket_type_id: PARTICIPANT_IDS.ticketType,
        status: "approved",
        payment_status: "paid",
        amount_cents: 12000,
        currency: "PLN",
        owned_by_caller: false,
      },
      error: null,
    });
    await expect(fetchRegistrationManageView({ manageToken: "t" })).resolves.toEqual(
      makeRegistrationManageView(),
    );
    expect(makeRegistrationManageView({ ownedByCaller: true }).ownedByCaller).toBe(true);
  });
});

describe("makeParticipantSettings", () => {
  it("= parser ustawień dla odpowiedzi bez wiersza (same DEFAULT-y)", () => {
    expect(parseParticipantSettings({ event_id: PARTICIPANT_IDS.event })).toEqual(
      makeParticipantSettings(),
    );
  });

  it("nadpisania i brak współdzielonej tablicy wyprzedzeń", () => {
    const a = makeParticipantSettings({ hasRow: true, refundMode: "none" });
    expect(a).toMatchObject({ hasRow: true, refundMode: "none" });
    a.reminderEventLeadsMinutes.push(15);
    expect(makeParticipantSettings().reminderEventLeadsMinutes).toEqual([1440, 60]);
  });
});

describe("makeEventParticipantOptions", () => {
  it("nadpisania", () => {
    expect(makeEventParticipantOptions({ certificateEnabled: true }).certificateEnabled).toBe(true);
    expect(makeEventParticipantOptions().refundMode).toBe("policy");
  });
});

describe("makeMyEventRegistrationSummary", () => {
  it("= `registration` z parsera event_my_event_profile dla równoważnego wiersza", async () => {
    rpc.mockResolvedValue({
      data: {
        profile: null,
        account: null,
        registration: {
          registration_id: PARTICIPANT_IDS.registration,
          status: "approved",
          payment_status: "paid",
          directory_opt_out: false,
          notify_email: true,
          notify_sms: false,
          groups: [],
        },
      },
      error: null,
    });
    const panel = await fetchMyEventProfile(PARTICIPANT_EVENT_SLUG);
    expect(panel.registration).toEqual(makeMyEventRegistrationSummary());
  });

  it("nadpisuje tylko podane pola i nie dzieli stanu między wywołaniami", () => {
    const waitlist = makeMyEventRegistrationSummary({ status: "waitlist" });
    expect(waitlist.status).toBe("waitlist");
    expect(waitlist.paymentStatus).toBe("paid");
    expect(makeMyEventRegistrationSummary().groups).not.toBe(
      makeMyEventRegistrationSummary().groups,
    );
  });
});
