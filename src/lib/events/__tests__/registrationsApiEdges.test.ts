// Brzegi warstwy API panelu zapisów: odmowy bazy, puste odpowiedzi, filtry.
//
// DLACZEGO TEN TEST ISTNIEJE. Kontrakt payloadów pilnuje `registrationsApi.test.ts`,
// kasowania - `registrationsApiDeletes.test.ts`. Żaden nie dotykał gałęzi, które
// w dniu wydarzenia decydują o tym, co organizator zobaczy, gdy baza odmówi albo
// odda `null`:
//   * ODMOWA MUSI RZUCIĆ. Połknięty błąd RPC to „zapisano" nad decyzją, której
//     nie ma, albo pusta lista zamiast komunikatu bramki roli.
//   * PUSTA ODPOWIEDŹ NIE MOŻE WYWRÓCIĆ EKRANU. PostgREST oddaje `null` dla
//     funkcji bez wiersza; `null.length` w liczniku stron to biały ekran.
//   * FILTR IDZIE DO BAZY TYLKO WTEDY, GDY JEST FILTREM. „Wszystkie" statusy
//     i fraza z samych spacji nie są filtrami - wysłane jako `p_status: 'all'`
//     albo `p_q: '  '` zwróciłyby inne wiersze.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({
  rpc: null as ReturnType<typeof import("@/test/supabase/rpc").supabaseRpcStub> | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie została ustawiona");
      return h.rpc.rpc(name, args);
    },
  },
}));

const api = await import("@/lib/events/registrationsApi");

const EVENT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function stub() {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie została ustawiona");
  return h.rpc;
}

const upsert: import("@/lib/events/registrationsApi").RegistrationUpsertInput = {
  id: null,
  eventId: EVENT,
  firstName: "Ewa",
  lastName: "Nowak",
  email: "ewa.nowak@example.org",
  phone: null,
  jobTitle: null,
  companyText: null,
  socialProfileUrl: null,
  ticketTypeId: null,
  groupId: null,
  status: null,
  answers: undefined,
  note: null,
};

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

describe("puste odpowiedzi bazy nie wywracają ekranu", () => {
  it("bilety i pola formularza bez wierszy to puste listy", async () => {
    stub().setData("admin_event_tickets_list", null);
    stub().setData("admin_event_registration_fields_list", null);
    await expect(api.fetchEventTickets(EVENT)).resolves.toEqual([]);
    await expect(api.fetchRegistrationFields(EVENT)).resolves.toEqual([]);
  });

  it("lista bez wierszy ma sumę 0, a wiersz bez `total_count` - też 0", async () => {
    stub().setData("admin_event_registrations_list", null);
    await expect(
      api.fetchRegistrations({ eventId: EVENT, ...api.DEFAULT_REGISTRATIONS_QUERY }),
    ).resolves.toEqual({ rows: [], total: 0 });

    stub().setData("admin_event_registrations_list", [{ id: ID, total_count: null }]);
    const page = await api.fetchRegistrations({
      eventId: EVENT,
      ...api.DEFAULT_REGISTRATIONS_QUERY,
    });
    expect(page.total).toBe(0);
  });

  it("liczniki, decyzja, promocja i odznaczenie bez danych oddają wartości neutralne", async () => {
    stub().setData("admin_event_registrations_counts", null);
    stub().setData("admin_event_registration_decide", null);
    stub().setData("admin_event_waitlist_promote", null);
    stub().setData("admin_event_registration_mark_notified", null);
    await expect(
      api.fetchRegistrationCounts({
        eventId: EVENT,
        ticketTypeId: null,
        groupId: null,
        q: "",
        from: null,
        to: null,
      }),
    ).resolves.toEqual({});
    await expect(
      api.decideRegistration({ registrationId: ID, action: "approve", note: null }),
    ).resolves.toEqual({});
    await expect(
      api.promoteFromWaitlist({
        eventId: EVENT,
        registrationId: null,
        ticketTypeId: null,
        count: 1,
      }),
    ).resolves.toEqual({});
    await expect(api.markRegistrationsNotified([ID])).resolves.toBe(0);
  });
});

describe("odmowa bazy rzuca - nikt nie zobaczy „zapisano” nad decyzją, której nie ma", () => {
  it.each([
    ["admin_event_ticket_delete", () => api.deleteEventTicket(ID)],
    [
      "admin_event_registrations_list",
      () => api.fetchRegistrations({ eventId: EVENT, ...api.DEFAULT_REGISTRATIONS_QUERY }),
    ],
    [
      "admin_event_registration_decide",
      () => api.decideRegistration({ registrationId: ID, action: "reject", note: "Powód" }),
    ],
    ["admin_event_registration_upsert", () => api.saveRegistration(upsert)],
    ["admin_event_registration_mark_notified", () => api.markRegistrationsNotified([ID])],
    [
      "admin_event_waitlist_promote",
      () =>
        api.promoteFromWaitlist({
          eventId: EVENT,
          registrationId: ID,
          ticketTypeId: null,
          count: 1,
        }),
    ],
  ] as const)("%s", async (name, call) => {
    stub().setError(name, "forbidden: admin role required");
    await expect(call()).rejects.toMatchObject({ message: "forbidden: admin role required" });
  });
});

describe("filtry idą do bazy tylko wtedy, gdy są filtrami", () => {
  it("konkretny status i fraza (przycięta) trafiają do argumentów", async () => {
    stub().setData("admin_event_registrations_list", []);
    await api.fetchRegistrations({
      eventId: EVENT,
      ...api.DEFAULT_REGISTRATIONS_QUERY,
      status: "pending",
      q: "  Kowalska ",
    });
    const call = stub().lastCall("admin_event_registrations_list");
    expect(call?.arg("p_status")).toBe("pending");
    expect(call?.arg("p_q")).toBe("Kowalska");
  });
});

describe("zapis organizatora", () => {
  it("nowy wpis niesie wydarzenie - bez niego baza nie wie, gdzie go założyć", async () => {
    stub().setData("admin_event_registration_upsert", ID);
    await expect(api.saveRegistration(upsert)).resolves.toBe(ID);
    const payload = stub().lastCall("admin_event_registration_upsert")?.arg("p_payload");
    // `registration_id: null` = nowy wpis; `event_id` mówi, gdzie go założyć.
    expect(payload).toMatchObject({ registration_id: null, event_id: EVENT, first_name: "Ewa" });
  });
});

describe("pola formularza zapisu", () => {
  const field: import("@/lib/events/registrationsApi").RegistrationFieldInput = {
    id: ID,
    eventId: EVENT,
    key: "sector",
    fieldType: "select",
    labelPl: "Sektor",
    labelEn: "Sector",
    helpPl: "",
    helpEn: "",
    consentUrlPl: "",
    consentUrlEn: "",
    isRequired: true,
    options: [],
    sortOrder: 0,
    isQualifying: false,
    qualifyOperator: "none",
    qualifyValue: null,
    qualifyOutcome: "approval",
    isActive: true,
  };

  it("edycja istniejącego pola NIE wysyła wydarzenia ani klucza (klucz jest niezmienny)", async () => {
    stub().setData("admin_event_registration_field_upsert", ID);
    await expect(api.saveRegistrationField(field)).resolves.toBe(ID);
    const payload = stub().lastCall("admin_event_registration_field_upsert")?.arg("p_payload");
    expect(payload).not.toHaveProperty("event_id");
    expect(payload).not.toHaveProperty("key");
  });

  it("odmowa zapisu pola i odczytu pól rzuca", async () => {
    stub().setError("admin_event_registration_field_upsert", "duplicate_key: sector");
    stub().setError("admin_event_registration_fields_list", "forbidden: admin role required");
    await expect(api.saveRegistrationField(field)).rejects.toMatchObject({
      message: "duplicate_key: sector",
    });
    await expect(api.fetchRegistrationFields(EVENT)).rejects.toMatchObject({
      message: "forbidden: admin role required",
    });
  });
});

describe("odmowy biletów i liczników", () => {
  it("odmowa zapisu biletu i odczytu liczników rzuca", async () => {
    stub().setError("admin_event_ticket_upsert", "quota_below_sold: 12");
    stub().setError("admin_event_registrations_counts", "forbidden: admin role required");
    await expect(
      api.saveEventTicket({
        id: null,
        eventId: EVENT,
        key: "vip",
        namePl: "VIP",
        nameEn: "VIP",
        descriptionPl: "",
        descriptionEn: "",
        priceCents: 0,
        currency: "PLN",
        quota: 1,
        salesFrom: null,
        salesTo: null,
        minTierRank: 0,
        requiresApproval: false,
        groupId: null,
        isActive: true,
        sortOrder: 0,
        earlyBirdPriceCents: null,
        earlyBirdUntil: null,
        accessCodeHint: "",
        waitlistEnabled: true,
        benefitsPl: [],
        benefitsEn: [],
        priceSchedule: [],
      }),
    ).rejects.toMatchObject({ message: "quota_below_sold: 12" });
    await expect(
      api.fetchRegistrationCounts({
        eventId: EVENT,
        ticketTypeId: null,
        groupId: null,
        q: "",
        from: null,
        to: null,
      }),
    ).rejects.toMatchObject({ message: "forbidden: admin role required" });
  });
});

describe("kod dostępu biletu", () => {
  it("nowy kod dostępu biletu jedzie jawnie (baza zapisze jego skrót)", async () => {
    stub().setData("admin_event_ticket_upsert", ID);
    await api.saveEventTicket({
      id: ID,
      eventId: EVENT,
      key: "vip",
      namePl: "VIP",
      nameEn: "VIP",
      descriptionPl: "",
      descriptionEn: "",
      priceCents: 0,
      currency: "PLN",
      quota: null,
      salesFrom: null,
      salesTo: null,
      minTierRank: 0,
      requiresApproval: false,
      groupId: null,
      isActive: true,
      sortOrder: 0,
      earlyBirdPriceCents: null,
      earlyBirdUntil: null,
      accessCode: "KOD-2026",
      accessCodeHint: "",
      waitlistEnabled: true,
      benefitsPl: [],
      benefitsEn: [],
      priceSchedule: [],
    });
    expect(stub().lastCall("admin_event_ticket_upsert")?.arg("p_payload")).toMatchObject({
      access_code: "KOD-2026",
    });
  });
});
