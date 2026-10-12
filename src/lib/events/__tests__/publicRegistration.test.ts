// Kontrakt PUBLICZNEGO zapisu: parser odpowiedzi, ładunek zapisu, mapowanie odmów.
//
// DLACZEGO TEN TEST ISTNIEJE. Baza czyta pola ładunku po nazwie i nie
// protestuje przeciw polu, którego nie zna. `ticket_id` zamiast
// `ticket_type_id` kończy się zapisem BEZ biletu i toastem sukcesu - błąd
// przechodzi przez `tsc`, przez przegląd i przez interfejs.
//
// DRUGI POWÓD: `manage_token` wraca RAZ. Baza trzyma tylko jego SHA-256, więc
// zgubienie go w parserze to utrata jedynej drogi rezygnacji gościa bez konta.
//
// TRZECI (REG-04): zapis idzie przez funkcję serwerową, a odpowiedź
// niezweryfikowanego wołającego to stałe `check_email` - przeglądarka nie może
// z niej wyczytać ani identyfikatora, ani klucza, ani tego, czy adres już był
// zapisany. Odmowy przychodzą WARTOŚCIĄ i muszą dać to samo zdanie, co dawny
// wyjątek bazy.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseRpcStub } from "@/test/supabase/rpc";
import { fail } from "@/test/supabase/chain";
import { REGISTER_FOR_CLIENT_RPC } from "@/test/events/registrationServerFn";
import {
  parseRegistrationForm,
  parseRegistrationFormTickets,
  hasHiddenTickets,
  isTicketSelectable,
  requiredTermIds,
  requiresTicketChoice,
  withRevealedTickets,
  EMPTY_REGISTRATION_FORM,
} from "@/lib/events/registrationFormSurface";
import { registrationFailure } from "@/lib/events/publicRegistrationErrors";
import {
  EVENT_REGISTER_REFUSALS,
  REGISTRATION_PAYLOAD_KEYS,
  registrationPayload,
} from "@/lib/events/registrationPayload";
import { eventRegistrationEn, eventRegistrationPl } from "@/lib/i18n-event-registration";
import { EVENT_CONSENT_TEXT_VERSION } from "@/lib/events/consentTexts";

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

vi.mock("@/lib/events/eventRegistration.functions", async () =>
  (await import("@/test/events/registrationServerFn")).registrationServerFnStub(() => h.rpc),
);

const api = await import("@/lib/events/publicRegistrationApi");

/** Klucze, które może nieść `p_payload` - kontrakt B1a (REG_DESIGN §2). */
const REGISTER_KEYS = new Set<string>(REGISTRATION_PAYLOAD_KEYS);

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

  it("czyta limit grupy i tryb podatku biletu", () => {
    const form = parseRegistrationForm({
      ...formPayload,
      tickets: [
        {
          ...formPayload.tickets[0],
          group_registration_enabled: true,
          group_max_size: 25,
          tax_mode: "exclusive",
        },
      ],
    } as never);
    expect(form.tickets[0]?.groupMaxSize).toBe(25);
    expect(form.tickets[0]?.taxMode).toBe("exclusive");
  });

  it("starszy backend bez limitu grupy i podatku dostaje wartości domyślne kolumn", () => {
    const form = parseRegistrationForm(formPayload as never);
    expect(form.tickets[0]?.groupMaxSize).toBe(10);
    expect(form.tickets[0]?.taxMode).toBe("inclusive");
    const odd = parseRegistrationForm({
      ...formPayload,
      tickets: [{ ...formPayload.tickets[0], group_max_size: 999, tax_mode: "kosmos" }],
    } as never);
    expect(odd.tickets[0]?.groupMaxSize).toBe(50);
    expect(odd.tickets[0]?.taxMode).toBe("inclusive");
  });
});

describe("formularz bez biletów ukrytych (REG-05) i po zakończeniu wydarzenia (REG-13)", () => {
  it("czyta `has_hidden_tickets` i `requires_ticket` - wybór wymagany także przy pustej liście", () => {
    const form = parseRegistrationForm({
      ...formPayload,
      tickets: [],
      has_hidden_tickets: true,
      requires_ticket: true,
    } as never);
    expect(form.tickets).toEqual([]);
    expect(hasHiddenTickets(form)).toBe(true);
    expect(requiresTicketChoice(form)).toBe(true);
  });

  it("starszy backend bez kluczy: flagi liczone z listy (bilety ukryte jeszcze na niej są)", () => {
    const form = parseRegistrationForm({
      ...formPayload,
      tickets: [{ ...formPayload.tickets[0], is_hidden: true }],
    } as never);
    expect(form.hasHiddenTickets).toBe(true);
    expect(form.requiresTicket).toBe(true);
    const plain = parseRegistrationForm({ ...formPayload, tickets: [] } as never);
    expect(hasHiddenTickets(plain)).toBe(false);
    expect(requiresTicketChoice(plain)).toBe(false);
  });

  it("`event_ended` to znany powód zamknięcia, nie `unknown`", () => {
    const form = parseRegistrationForm({
      ...formPayload,
      is_open: false,
      closed_reason: "event_ended",
    } as never);
    expect(form.closedReason).toBe("event_ended");
    expect(eventRegistrationPl.eventRegistration.closed.event_ended).toBeTruthy();
    expect(eventRegistrationEn.eventRegistration.closed.event_ended).toBeTruthy();
  });

  it("bilety odsłonięte kodem mają kształt biletu formularza i dochodzą na koniec listy raz", () => {
    const revealed = parseRegistrationFormTickets([
      { ...formPayload.tickets[0], id: "t-vip", key: "vip", is_hidden: true, price_cents: 9900 },
      { id: "", key: "bez-id" },
      "śmieć",
    ]);
    expect(revealed.map((ticket) => ticket.id)).toEqual(["t-vip"]);
    expect(revealed[0]?.isHidden).toBe(true);
    expect(revealed[0]?.effectivePriceCents).toBe(9900);

    const form = parseRegistrationForm(formPayload as never);
    const merged = withRevealedTickets(form, [...revealed, ...revealed]);
    expect(merged.tickets.map((ticket) => ticket.id)).toEqual([TICKET, "t-vip"]);
    // Bilet już obecny zostaje w wersji formularza; pusta lista nie zmienia nic.
    expect(withRevealedTickets(form, [{ ...form.tickets[0]!, namePl: "inna" }])).toBe(form);
    expect(withRevealedTickets(form, [])).toBe(form);
  });
});

describe("ładunek zapisu (`registrationPayload`)", () => {
  it("niesie wyłącznie klucze z kontraktu - z językiem i wersją tekstów zgód", () => {
    const payload = registrationPayload({
      eventSlug: "kongres",
      firstName: "Anna",
      lastName: "Kowalska",
      email: "anna@example.com",
      ticketTypeId: TICKET,
      answers: [{ key: "diet", value: ["vege"] }],
      acceptedTermIds: [TERM],
      consentDataProcessing: true,
      lang: "en",
    });
    expect(Object.keys(payload).filter((key) => !REGISTER_KEYS.has(key))).toEqual([]);
    expect(payload.ticket_type_id).toBe(TICKET);
    expect(payload.answers).toEqual({ diet: ["vege"] });
    expect(payload.accepted_term_ids).toEqual([TERM]);
    expect(payload.lang).toBe("en");
    expect(payload.consent_text_version).toBe(EVENT_CONSENT_TEXT_VERSION);
  });

  it("nie zna skrótu adresu ani przeglądarki - liczy je serwer", () => {
    expect(REGISTER_KEYS.has("ip_hash")).toBe(false);
    expect(REGISTER_KEYS.has("user_agent")).toBe(false);
    expect(REGISTER_KEYS.has("tenant_id")).toBe(false);
    expect(REGISTER_KEYS.has("person_id")).toBe(false);
  });

  it("kod dostępu i kod odsłaniający jadą przycięte; puste nie jadą wcale", () => {
    const base = {
      eventSlug: "kongres",
      firstName: "Anna",
      lastName: "Kowalska",
      email: "anna@example.com",
      consentDataProcessing: true,
    };
    const full = registrationPayload({ ...base, accessCode: "  PARTNER-7 ", revealCode: " VIP " });
    expect(full.access_code).toBe("PARTNER-7");
    expect(full.reveal_code).toBe("VIP");
    for (const empty of ["", "   ", null, undefined]) {
      const payload = registrationPayload({ ...base, accessCode: empty, revealCode: empty });
      expect("access_code" in payload).toBe(false);
      expect("reveal_code" in payload).toBe(false);
    }
  });

  it("pomija nieustawione pola opcjonalne, ale wysyła jawny null; brak języka = pl", () => {
    const payload = registrationPayload({
      eventSlug: "kongres",
      firstName: "Anna",
      lastName: "Kowalska",
      email: "anna@example.com",
      companyText: null,
      consentDataProcessing: true,
    });
    expect("phone" in payload).toBe(false);
    expect("company_text" in payload).toBe(true);
    expect(payload.company_text).toBeNull();
    expect(payload.consent_marketing).toBe(false);
    expect(payload.lang).toBe("pl");
  });
});

describe("publicRegistrationApi", () => {
  const INPUT = {
    eventSlug: "kongres",
    firstName: "Anna",
    lastName: "Kowalska",
    email: "anna@example.com",
    consentDataProcessing: true,
  };

  beforeEach(() => {
    h.rpc = supabaseRpcStub();
    h.rpc.setData("event_registration_form", formPayload);
    h.rpc.setData(REGISTER_FOR_CLIENT_RPC, {
      ok: true,
      outcome: "registered",
      registration_id: REG,
      person_id: "p-1",
      status: "waitlist",
      decision_source: "capacity",
      waitlist_position: 3,
      ticket_type_id: TICKET,
      qr_token: "qr-z-chwili-zapisu",
      manage_token: "manage-secret",
      account_linked: false,
      consent_confirmation_required: true,
      quote_valid_until: "2099-09-01T10:00:00Z",
    });
    h.rpc.setData("event_registration_cancel", {
      registration_id: REG,
      status: "cancelled",
      promoted_from_waitlist: 1,
    });
  });

  it("zapis idzie przez funkcję serwerową - przeglądarka nie woła `event_register`", async () => {
    await api.submitRegistration({ ...INPUT, ticketTypeId: TICKET });
    expect(h.rpc?.names()).toEqual([REGISTER_FOR_CLIENT_RPC]);
    expect(h.rpc?.callsFor("event_register")).toEqual([]);
    const payload = h.rpc?.lastCall(REGISTER_FOR_CLIENT_RPC)?.arg("p_payload") as Record<
      string,
      unknown
    >;
    expect(payload.ticket_type_id).toBe(TICKET);
    expect(payload.lang).toBe("pl");
  });

  it("atrybucja jedzie obok ładunku - `null`, gdy wołający jej nie podał", async () => {
    await api.submitRegistration(INPUT);
    expect(h.rpc?.lastCall(REGISTER_FOR_CLIENT_RPC)?.arg("attribution")).toBeNull();
    const attribution = { first: null, last: null, ad_consent: true };
    await api.submitRegistration({ ...INPUT, attribution });
    expect(h.rpc?.lastCall(REGISTER_FOR_CLIENT_RPC)?.arg("attribution")).toEqual(attribution);
  });

  it("zweryfikowany właściciel: klucz, kolejka, powiązanie z kontem, zgody i termin ceny", async () => {
    const outcome = await api.submitRegistration(INPUT);
    expect(outcome.kind).toBe("registered");
    if (outcome.kind !== "registered") return;
    expect(outcome.result.status).toBe("waitlist");
    expect(outcome.result.waitlistPosition).toBe(3);
    expect(outcome.result.manageToken).toBe("manage-secret");
    expect(outcome.result.accountLinked).toBe(false);
    expect(outcome.result.consentConfirmationRequired).toBe(true);
    expect(outcome.result.quoteValidUntil).toBe("2099-09-01T10:00:00Z");
    // Kod QR z chwili zapisu NIE trafia do modelu: serwer od razu wydaje
    // bilet mailem, co ten kod rotuje - pokazany przestałby wpuszczać.
    expect("qrToken" in outcome.result).toBe(false);
    expect(JSON.stringify(outcome)).not.toContain("qr-z-chwili-zapisu");
  });

  it("odpowiedź neutralna to `check_email` bez żadnej treści", async () => {
    h.rpc?.setData(REGISTER_FOR_CLIENT_RPC, { ok: true, outcome: "check_email" });
    expect(await api.submitRegistration(INPUT)).toEqual({ kind: "check_email" });
  });

  it("odmowa WARTOŚCIĄ rzuca kod z ogonem - albo z „registration refused”", async () => {
    h.rpc?.setData(REGISTER_FOR_CLIENT_RPC, {
      ok: false,
      error: "terms_required",
      detail: `${TERM},${EVENT}`,
    });
    await expect(api.submitRegistration(INPUT)).rejects.toThrow(`terms_required: ${TERM},${EVENT}`);
    h.rpc?.setData(REGISTER_FOR_CLIENT_RPC, { ok: false, error: "event_ended" });
    await expect(api.submitRegistration(INPUT)).rejects.toThrow(
      /^event_ended: registration refused$/,
    );
    h.rpc?.setData(REGISTER_FOR_CLIENT_RPC, { ok: false });
    await expect(api.submitRegistration(INPUT)).rejects.toThrow(/^unknown: /);
  });

  it("odpowiedź bez identyfikatora zapisu nie udaje sukcesu", async () => {
    h.rpc?.setData(REGISTER_FOR_CLIENT_RPC, {
      ok: true,
      outcome: "registered",
      status: "approved",
    });
    await expect(api.submitRegistration(INPUT)).rejects.toThrow(/unknown/);
  });

  it("nieznany status z bazy czytamy jako oczekujący, nie zatwierdzony", async () => {
    h.rpc?.setData(REGISTER_FOR_CLIENT_RPC, {
      ok: true,
      outcome: "registered",
      registration_id: REG,
      status: "kosmos",
    });
    const outcome = await api.submitRegistration(INPUT);
    expect(outcome.kind === "registered" ? outcome.result.status : null).toBe("pending");
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

  it("klucz biletu z linku jedzie do formularza; stara baza bez argumentu dostaje pytanie po staremu", async () => {
    await api.fetchRegistrationForm("kongres", " vip ");
    expect(h.rpc?.lastCall("event_registration_form")?.args).toEqual({
      p_event_slug: "kongres",
      p_ticket_key: "vip",
    });

    h.rpc = supabaseRpcStub();
    h.rpc.setResponse("event_registration_form", (call) =>
      call.has("p_ticket_key")
        ? fail("function not found", "PGRST202")
        : { data: formPayload, error: null },
    );
    const form = await api.fetchRegistrationForm("kongres", "vip");
    expect(form.event?.id).toBe(EVENT);
    expect(h.rpc.callsFor("event_registration_form").map((call) => call.keys())).toEqual([
      ["p_event_slug", "p_ticket_key"],
      ["p_event_slug"],
    ]);
  });

  it("inny błąd formularza z kluczem NIE jest powodem do ponowienia bez klucza", async () => {
    h.rpc?.setError("event_registration_form", "rate_limited: za dużo prób", "P0001");
    await expect(api.fetchRegistrationForm("kongres", "vip")).rejects.toThrow(/rate_limited/);
    expect(h.rpc?.callsFor("event_registration_form")).toHaveLength(1);
  });

  it("bez klucza formularz pytany jest jednym argumentem", async () => {
    await api.fetchRegistrationForm("kongres");
    await api.fetchRegistrationForm("kongres", "  ");
    expect(h.rpc?.callsFor("event_registration_form").map((call) => call.keys())).toEqual([
      ["p_event_slug"],
      ["p_event_slug"],
    ]);
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

  it.each(EVENT_REGISTER_REFUSALS.filter((code) => code !== "unknown"))(
    "odmowa `%s` z serwera zapisu ma własne zdanie w PL i EN",
    (code) => {
      const failure = registrationFailure(new Error(`${code}: registration refused`));
      expect(failure.key).not.toBe("eventRegistration.errors.unknown");
      const key = failure.key.replace("eventRegistration.errors.", "");
      const pl = eventRegistrationPl.eventRegistration.errors as Record<string, string>;
      const en = eventRegistrationEn.eventRegistration.errors as Record<string, string>;
      expect(pl[key], `brak PL: ${key}`).toBeTruthy();
      expect(en[key], `brak EN: ${key}`).toBeTruthy();
    },
  );

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
