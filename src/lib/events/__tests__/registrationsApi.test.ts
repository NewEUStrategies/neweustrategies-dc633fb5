// Kontrakt payloadów panelu zapisów/biletów wobec funkcji bazy.
//
// DLACZEGO TEN TEST ISTNIEJE. Funkcje modułu przyjmują JEDEN argument
// `p_payload jsonb` i czytają z niego pola po nazwie. Postgres NIE ODRZUCA pola,
// którego nie zna - po prostu je pomija. `id` zamiast `registration_id`
// w `admin_event_registration_upsert` nie kończy się błędem, tylko utworzeniem
// DRUGIEGO zapisu przy „edycji", z prawdziwym toastem sukcesu. Taka pomyłka
// przechodzi przez `tsc`, przez przegląd i przez interfejs.
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

/** Klucze CZYTANE przez funkcje bazy (stan migracji 20260823150000). */
const KONTRAKT: Record<string, readonly string[]> = {
  admin_event_ticket_upsert: [
    "access_code",
    "access_code_hint",
    "benefits_en",
    "benefits_pl",
    "price_schedule",
    "currency",
    "early_bird_price_cents",
    "early_bird_until",
    "waitlist_enabled",
    "description_en",
    "description_pl",
    "event_id",
    "group_id",
    "id",
    "is_active",
    "key",
    "min_tier_rank",
    "name_en",
    "name_pl",
    "price_cents",
    "quota",
    "requires_approval",
    "sales_from",
    "sales_to",
    "sort_order",
  ],
  admin_event_registration_field_upsert: [
    "consent_url_en",
    "consent_url_pl",
    "event_id",
    "field_type",
    "help_en",
    "help_pl",
    "id",
    "is_active",
    "is_qualifying",
    "is_required",
    "key",
    "label_en",
    "label_pl",
    "options",
    "qualify_operator",
    "qualify_outcome",
    "qualify_value",
    "sort_order",
  ],
  admin_event_registration_decide: ["action", "note", "registration_id"],
  admin_event_registration_upsert: [
    "answers",
    "company_id",
    "company_text",
    "email",
    "event_id",
    "first_name",
    "group_id",
    "job_title",
    "last_name",
    "note",
    "notes",
    "person_id",
    "phone",
    "registration_id",
    "social_profile_url",
    "source",
    "status",
    "ticket_type_id",
  ],
  admin_event_registration_mark_notified: ["registration_ids"],
  admin_event_waitlist_promote: ["count", "event_id", "registration_id", "ticket_type_id"],
};

const EVENT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function sentKeys(name: string): string[] {
  const call = h.rpc?.lastCall(name);
  expect(call, `brak wywołania RPC ${name}`).toBeDefined();
  const p = call?.arg("p_payload");
  expect(p !== null && typeof p === "object", `${name}: payload nie jest obiektem`).toBe(true);
  return Object.keys(p as Record<string, unknown>).sort();
}

function outsideContract(name: string, sent: string[]): string[] {
  const known = new Set(KONTRAKT[name]);
  return sent.filter((key) => !known.has(key));
}

const ticket: import("@/lib/events/registrationsApi").EventTicketInput = {
  id: null,
  eventId: EVENT,
  key: "standard",
  namePl: "Standard",
  nameEn: "Standard",
  descriptionPl: "",
  descriptionEn: "",
  priceCents: 12000,
  currency: "PLN",
  quota: 120,
  salesFrom: null,
  salesTo: null,
  minTierRank: 0,
  requiresApproval: false,
  groupId: null,
  isActive: true,
  sortOrder: 100,
  earlyBirdPriceCents: null,
  earlyBirdUntil: null,
  accessCodeHint: "",
  waitlistEnabled: true,
  benefitsPl: ["Lunch", "Materiały"],
  benefitsEn: ["Lunch", "Materials"],
  priceSchedule: [
    {
      labelPl: "Early bird",
      labelEn: "Early bird",
      from: null,
      to: "2026-09-01T10:00:00.000Z",
      priceCents: 9000,
    },
  ],
};

const field: import("@/lib/events/registrationsApi").RegistrationFieldInput = {
  id: null,
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
  options: ["public", "private"],
  sortOrder: 100,
  isQualifying: true,
  qualifyOperator: "in",
  qualifyValue: ["public"],
  qualifyOutcome: "approval",
  isActive: true,
};

describe("registrationsApi - kontrakt payloadów", () => {
  beforeEach(() => {
    h.rpc = supabaseRpcStub();
    for (const name of Object.keys(KONTRAKT)) h.rpc.setData(name, ID);
    h.rpc.setData("admin_event_registration_mark_notified", 3);
    h.rpc.setData("admin_event_waitlist_promote", { promoted: 2 });
    h.rpc.setData("admin_event_registration_decide", { status: "approved" });
    h.rpc.setData("admin_event_tickets_list", []);
    h.rpc.setData("admin_event_registration_fields_list", []);
    h.rpc.setData("admin_event_registrations_list", []);
    h.rpc.setData("admin_event_registrations_counts", { all: 0 });
  });

  it("bilet: nowy wiersz wysyła klucz i wydarzenie, edycja już nie", async () => {
    await api.saveEventTicket(ticket);
    const created = sentKeys("admin_event_ticket_upsert");
    expect(outsideContract("admin_event_ticket_upsert", created)).toEqual([]);
    expect(created).toContain("key");
    expect(created).toContain("event_id");

    await api.saveEventTicket({ ...ticket, id: ID, key: "ignored" });
    const edited = sentKeys("admin_event_ticket_upsert");
    // Klucz jest niezmienny po zapisie - wysłanie go udawałoby zmianę.
    expect(edited).not.toContain("key");
    expect(edited).not.toContain("event_id");
    expect(edited).toContain("id");
  });

  it("bilet: `quota: null` jest WYSYŁANE jako null, bo zdejmuje limit", async () => {
    await api.saveEventTicket({ ...ticket, id: ID, quota: null });
    const call = h.rpc?.lastCall("admin_event_ticket_upsert");
    const p = call?.arg("p_payload") as Record<string, unknown>;
    expect("quota" in p).toBe(true);
    expect(p.quota).toBeNull();
  });

  it("pole formularza: pełny kontrakt kwalifikacji", async () => {
    await api.saveRegistrationField(field);
    const sent = sentKeys("admin_event_registration_field_upsert");
    expect(outsideContract("admin_event_registration_field_upsert", sent)).toEqual([]);
    expect(sent).toContain("qualify_operator");
    expect(sent).toContain("qualify_value");
    expect(sent).toContain("qualify_outcome");
  });

  it("decyzja: identyfikator, akcja i uzasadnienie", async () => {
    await api.decideRegistration({ registrationId: ID, action: "reject", note: "poza profilem" });
    const sent = sentKeys("admin_event_registration_decide");
    expect(sent).toEqual(["action", "note", "registration_id"]);
  });

  it("edycja zapisu identyfikuje wiersz przez `registration_id`, nie `id`", async () => {
    await api.saveRegistration({
      id: ID,
      eventId: EVENT,
      firstName: "Anna",
      lastName: "Kowalska",
      email: "anna@example.com",
      phone: null,
      jobTitle: null,
      companyText: null,
      socialProfileUrl: null,
      ticketTypeId: null,
      groupId: null,
      status: null,
      answers: undefined,
      note: null,
    });
    const call = h.rpc?.lastCall("admin_event_registration_upsert");
    const p = call?.arg("p_payload") as Record<string, unknown>;
    expect(p.registration_id).toBe(ID);
    expect("id" in p).toBe(false);
    // `status: null` i `answers: undefined` są pomijane - brak klucza znaczy
    // „zostaw jak było", a jawny null wyczyściłby wartość.
    expect("status" in p).toBe(false);
    expect("answers" in p).toBe(false);
    expect(outsideContract("admin_event_registration_upsert", Object.keys(p).sort())).toEqual([]);
  });

  it("lista: filtr `all` nie wysyła statusu, a puste wyszukiwanie nie wysyła frazy", async () => {
    await api.fetchRegistrations({
      eventId: EVENT,
      ...api.DEFAULT_REGISTRATIONS_QUERY,
      q: "   ",
    });
    const call = h.rpc?.lastCall("admin_event_registrations_list");
    expect(call?.has("p_status")).toBe(false);
    expect(call?.has("p_q")).toBe(false);
    expect(call?.arg("p_limit")).toBe(25);
  });

  it("lista: suma bierze się z okna `total_count`, pusta strona zwraca zero", async () => {
    h.rpc?.setData("admin_event_registrations_list", [
      { id: ID, total_count: 42 },
      { id: EVENT, total_count: 42 },
    ]);
    const page = await api.fetchRegistrations({
      eventId: EVENT,
      ...api.DEFAULT_REGISTRATIONS_QUERY,
    });
    expect(page.total).toBe(42);
    expect(page.rows).toHaveLength(2);

    h.rpc?.setData("admin_event_registrations_list", []);
    const empty = await api.fetchRegistrations({
      eventId: EVENT,
      ...api.DEFAULT_REGISTRATIONS_QUERY,
    });
    expect(empty.total).toBe(0);
  });

  it("powiadomienia rezerwy: lista identyfikatorów pod kluczem `registration_ids`", async () => {
    const count = await api.markRegistrationsNotified([ID, EVENT]);
    expect(count).toBe(3);
    const call = h.rpc?.lastCall("admin_event_registration_mark_notified");
    const p = call?.arg("p_payload") as Record<string, unknown>;
    expect(p.registration_ids).toEqual([ID, EVENT]);
  });

  it("promocja z rezerwy: bez wskazanego wiersza wysyła liczbę osób", async () => {
    await api.promoteFromWaitlist({
      eventId: EVENT,
      registrationId: null,
      ticketTypeId: null,
      count: 10,
    });
    const sent = sentKeys("admin_event_waitlist_promote");
    expect(outsideContract("admin_event_waitlist_promote", sent)).toEqual([]);
    expect(sent).toContain("count");
  });

  it("odmowa bazy jest przekazywana dalej, a nie zamieniana na pustą listę", async () => {
    h.rpc?.setError("admin_event_tickets_list", "forbidden: not an editor", "42501");
    await expect(api.fetchEventTickets(EVENT)).rejects.toThrow(/forbidden/);
  });
});
