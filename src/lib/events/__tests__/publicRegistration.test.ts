// Kontrakt PUBLICZNEGO zapisu: parser odpowiedzi, payload RPC, mapowanie odmów.
//
// DLACZEGO TEN TEST ISTNIEJE. `event_register` czyta pola payloadu po nazwie i
// nie protestuje przeciw polu, którego nie zna. `ticket_id` zamiast
// `ticket_type_id` kończy się zapisem BEZ biletu i toastem sukcesu - błąd
// przechodzi przez `tsc`, przez przegląd i przez interfejs.
//
// DRUGI POWÓD: `manage_token` wraca RAZ. Baza trzyma tylko jego SHA-256, więc
// zgubienie go w parserze to utrata jedynej drogi rezygnacji gościa bez konta.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseRpcStub } from "@/test/supabase/rpc";
import {
  parseRegistrationForm,
  isTicketSelectable,
  requiredTermIds,
  requiresTicketChoice,
  EMPTY_REGISTRATION_FORM,
} from "@/lib/events/registrationFormSurface";
import { registrationFailure } from "@/lib/events/publicRegistrationErrors";

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

const api = await import("@/lib/events/publicRegistrationApi");

/** Klucze CZYTANE przez `event_register` (migracja 20260824090214). */
const REGISTER_KEYS = new Set([
  "event_slug",
  "event_id",
  "ticket_type_id",
  "first_name",
  "last_name",
  "email",
  "phone",
  "job_title",
  "company_text",
  "social_profile_url",
  "answers",
  "accepted_term_ids",
  "consent_marketing",
  "consent_partner_sharing",
  "consent_data_processing",
  "ip_hash",
  "user_agent",
]);

const EVENT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TICKET = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const TERM = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const REG = "dddddddd-dddd-dddd-dddd-dddddddddddd";

const formPayload = {
  event: {
    id: EVENT,
    slug: "kongres",
    title_pl: "Kongres",
    title_en: "Congress",
    starts_at: "2026-09-01T08:00:00+00:00",
    ends_at: "2026-09-01T16:00:00+00:00",
    timezone: "Europe/Warsaw",
    registration_mode: "form",
    registration_flow: "approval",
    external_registration_url: null,
    capacity: null,
    seats_left: null,
    rsvp_opens_at: null,
  },
  is_open: true,
  closed_reason: null,
  fields: [
    {
      id: "f-1",
      key: "diet",
      field_type: "select",
      label_pl: "Dieta",
      label_en: "Diet",
      help_pl: "",
      help_en: "",
      is_required: true,
      options: [{ value: "vege", label_pl: "Wegetariańska", label_en: "Vegetarian" }, "standard"],
      sort_order: 10,
    },
  ],
  tickets: [
    {
      id: TICKET,
      key: "regular",
      name_pl: "Zwykły",
      name_en: "Regular",
      description_pl: "",
      description_en: "",
      price_cents: 0,
      currency: "EUR",
      requires_approval: false,
      min_tier_rank: 0,
      sales_from: null,
      sales_to: null,
      seats_left: null,
      availability: "on_sale",
      tier_locked: false,
      sort_order: 10,
    },
  ],
  terms: [
    {
      id: TERM,
      key: "rodo",
      label_pl: "RODO",
      label_en: "GDPR",
      body_pl: "",
      body_en: "",
      external_url: null,
      is_required: true,
      version: 2,
      sort_order: 10,
    },
  ],
};

describe("parseRegistrationForm", () => {
  it("czyta wydarzenie, pola, bilety i zgody z jednej odpowiedzi", () => {
    const form = parseRegistrationForm(formPayload as never);
    expect(form.event?.id).toBe(EVENT);
    expect(form.isOpen).toBe(true);
    expect(form.closedReason).toBeNull();
    expect(form.fields[0]?.fieldType).toBe("select");
    expect(form.fields[0]?.options.map((option) => option.value)).toEqual(["vege", "standard"]);
    expect(requiresTicketChoice(form)).toBe(true);
    expect(requiredTermIds(form)).toEqual([TERM]);
  });

  it("brak limitu miejsc zostaje nullem, nie zerem", () => {
    const form = parseRegistrationForm(formPayload as never);
    expect(form.event?.capacity).toBeNull();
    expect(form.tickets[0]?.seatsLeft).toBeNull();
  });

  it("nieczytelna odpowiedź degraduje do zapisu zamkniętego", () => {
    expect(parseRegistrationForm(null)).toEqual(EMPTY_REGISTRATION_FORM);
    expect(parseRegistrationForm({ is_open: true } as never).isOpen).toBe(false);
  });

  it("nieznany powód zamknięcia i nieznana dostępność nie udają dostępnych", () => {
    const closed = parseRegistrationForm({
      ...formPayload,
      is_open: false,
      closed_reason: "kosmos",
      tickets: [{ ...formPayload.tickets[0], availability: "kosmos" }],
    } as never);
    expect(closed.closedReason).toBe("unknown");
    expect(closed.tickets[0]?.availability).toBe("ended");
    expect(isTicketSelectable(closed.tickets[0]!)).toBe(false);
  });

  it("bilet za wysoką rangą nie jest wybieralny, choć jest widoczny", () => {
    const form = parseRegistrationForm({
      ...formPayload,
      tickets: [{ ...formPayload.tickets[0], tier_locked: true }],
    } as never);
    expect(form.tickets).toHaveLength(1);
    expect(isTicketSelectable(form.tickets[0]!)).toBe(false);
  });
});

describe("publicRegistrationApi", () => {
  beforeEach(() => {
    h.rpc = supabaseRpcStub();
    h.rpc.setData("event_registration_form", formPayload);
    h.rpc.setData("event_register", {
      registration_id: REG,
      person_id: "p-1",
      status: "waitlist",
      decision_source: "capacity",
      waitlist_position: 3,
      ticket_type_id: TICKET,
      qr_token: null,
      manage_token: "manage-secret",
    });
    h.rpc.setData("event_registration_cancel", {
      registration_id: REG,
      status: "cancelled",
      promoted_from_waitlist: 1,
    });
  });

  it("wysyła wyłącznie klucze czytane przez funkcję bazy", async () => {
    await api.submitRegistration({
      eventSlug: "kongres",
      firstName: "Anna",
      lastName: "Kowalska",
      email: "anna@example.com",
      ticketTypeId: TICKET,
      answers: [{ key: "diet", value: ["vege"] }],
      acceptedTermIds: [TERM],
      consentDataProcessing: true,
    });
    const payload = h.rpc?.lastCall("event_register")?.arg("p_payload") as Record<string, unknown>;
    expect(Object.keys(payload).filter((key) => !REGISTER_KEYS.has(key))).toEqual([]);
    expect(payload.ticket_type_id).toBe(TICKET);
    expect(payload.answers).toEqual({ diet: ["vege"] });
    expect(payload.accepted_term_ids).toEqual([TERM]);
  });

  it("pomija nieustawione pola opcjonalne, ale wysyła jawny null", async () => {
    await api.submitRegistration({
      eventSlug: "kongres",
      firstName: "Anna",
      lastName: "Kowalska",
      email: "anna@example.com",
      companyText: null,
      consentDataProcessing: true,
    });
    const call = h.rpc?.lastCall("event_register");
    expect(call?.has("p_payload")).toBe(true);
    const payload = call?.arg("p_payload") as Record<string, unknown>;
    expect("phone" in payload).toBe(false);
    expect("company_text" in payload).toBe(true);
    expect(payload.company_text).toBeNull();
    expect(payload.consent_marketing).toBe(false);
  });

  it("oddaje jednorazowy klucz zarządzania i pozycję na liście oczekujących", async () => {
    const result = await api.submitRegistration({
      eventSlug: "kongres",
      firstName: "Anna",
      lastName: "Kowalska",
      email: "anna@example.com",
      consentDataProcessing: true,
    });
    expect(result.status).toBe("waitlist");
    expect(result.waitlistPosition).toBe(3);
    expect(result.manageToken).toBe("manage-secret");
    expect(result.qrToken).toBeNull();
  });

  it("odpowiedź bez identyfikatora zapisu nie udaje sukcesu", async () => {
    h.rpc?.setData("event_register", { status: "approved" });
    await expect(
      api.submitRegistration({
        eventSlug: "kongres",
        firstName: "Anna",
        lastName: "Kowalska",
        email: "anna@example.com",
        consentDataProcessing: true,
      }),
    ).rejects.toThrow(/unknown/);
  });

  it("rezygnacja przez token nie wysyła pustego identyfikatora", async () => {
    const result = await api.cancelRegistration({ manageToken: "manage-secret" });
    const payload = h.rpc?.lastCall("event_registration_cancel")?.arg("p_payload") as Record<
      string,
      unknown
    >;
    expect("registration_id" in payload).toBe(false);
    expect(payload.manage_token).toBe("manage-secret");
    expect(result.promotedFromWaitlist).toBe(1);
  });

  it("nieznany status z bazy czytamy jako oczekujący, nie zatwierdzony", async () => {
    h.rpc?.setData("event_register", { registration_id: REG, status: "kosmos" });
    const result = await api.submitRegistration({
      eventSlug: "kongres",
      firstName: "Anna",
      lastName: "Kowalska",
      email: "anna@example.com",
      consentDataProcessing: true,
    });
    expect(result.status).toBe("pending");
  });
});

describe("registrationFailure", () => {
  it("mapuje odmowy bazy na klucze i18n", () => {
    expect(registrationFailure(new Error("ticket_required: pick one")).key).toBe(
      "eventRegistration.errors.ticketRequired",
    );
    expect(registrationFailure({ message: "rate_limited: slow down" }).key).toBe(
      "eventRegistration.errors.rateLimited",
    );
  });

  it("liczy brakujące pola i zgody z listy kluczy, nie pokazuje UUID-ów", () => {
    const failure = registrationFailure(new Error(`terms_required: ${TERM},${EVENT}`));
    expect(failure.key).toBe("eventRegistration.errors.termsRequired");
    expect(failure.params).toEqual({ count: 2 });
    expect(registrationFailure(new Error("missing_required_fields: diet,vat")).params).toEqual({
      count: 2,
    });
  });

  it("nieznany klucz wraca do zdania ogólnego", () => {
    expect(registrationFailure(new Error("violates check constraint")).key).toBe(
      "eventRegistration.errors.unknown",
    );
    expect(registrationFailure(null).key).toBe("eventRegistration.errors.unknown");
  });
});
