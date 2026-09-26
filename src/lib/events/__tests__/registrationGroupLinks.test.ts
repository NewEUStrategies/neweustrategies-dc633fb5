// Powiązania grupy w panelu zgłoszeń: odczyt RPC i reguły plakietek/przycisku.
//
// DLACZEGO TEN TEST ISTNIEJE. Panel do 20260926100000 nie wiedział, który
// wiersz jest gościem czyjej grupy ani czy bilet wyszedł - a jedyna wskazówka,
// `has_qr` z listy, jest prawdą dla gościa bezpłatnego od chwili dopisania.
// Przycisk „Wyślij bilet ponownie" MUSI mieć ten sam warunek co odmowa bazy
// (`ticket_not_issuable`): przycisk, który baza odrzuci, uczy organizatora,
// że panel kłamie.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseRpcStub } from "@/test/supabase/rpc";
import type { RegistrationGroupLink } from "@/lib/events/registrationsApi";

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

const { fetchRegistrationGroupLinks } = await import("@/lib/events/registrationsApi");
const { canResendTicket, groupLeadName, holdsTicket } =
  await import("@/lib/events/registrationRows");

const EVENT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const LEAD = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function link(over: Partial<RegistrationGroupLink> = {}): RegistrationGroupLink {
  return {
    registration_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    group_lead_registration_id: null,
    lead_first_name: null,
    lead_last_name: null,
    guest_count: 0,
    payment_status: "not_required",
    ticket_code_sent_at: null,
    ...over,
  };
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

describe("fetchRegistrationGroupLinks", () => {
  it("woła RPC panelu z identyfikatorem wydarzenia i oddaje wiersze", async () => {
    const rows = [link({ group_lead_registration_id: LEAD, lead_first_name: "Anna" })];
    h.rpc?.setData("admin_event_registration_group_links", rows);
    await expect(fetchRegistrationGroupLinks(EVENT)).resolves.toEqual(rows);
    expect(h.rpc?.lastCall("admin_event_registration_group_links")?.arg("p_event_id")).toBe(EVENT);
  });

  it("pusta odpowiedź to pusta lista, nie `null`", async () => {
    h.rpc?.setData("admin_event_registration_group_links", null);
    await expect(fetchRegistrationGroupLinks(EVENT)).resolves.toEqual([]);
  });

  it("odmowa bazy (bramka roli) rzuca - panel pokaże ją zdaniem", async () => {
    h.rpc?.setError("admin_event_registration_group_links", "forbidden: admin role required");
    await expect(fetchRegistrationGroupLinks(EVENT)).rejects.toMatchObject({
      message: "forbidden: admin role required",
    });
  });
});

describe("holdsTicket - kiedy plakietka biletu coś znaczy", () => {
  it.each(["approved", "attended"])("„%s” trzyma bilet", (status) => {
    expect(holdsTicket(status)).toBe(true);
  });

  it.each(["pending", "waitlist", "rejected", "cancelled", "no_show", "draft"])(
    "„%s” nie trzyma biletu",
    (status) => {
      expect(holdsTicket(status)).toBe(false);
    },
  );
});

describe("canResendTicket - lustro `ticket_not_issuable`", () => {
  it.each(["paid", "not_required"])("przyjęty i rozliczony (%s) - przycisk jest", (payment) => {
    expect(canResendTicket("approved", link({ payment_status: payment }))).toBe(true);
    expect(canResendTicket("attended", link({ payment_status: payment }))).toBe(true);
  });

  it.each(["unpaid", "refunded", "partially_refunded"])(
    "przyjęty, ale %s - przycisku nie ma",
    (payment) => {
      expect(canResendTicket("approved", link({ payment_status: payment }))).toBe(false);
    },
  );

  it("nieprzyjęty - przycisku nie ma, choć rozliczenia nie trzeba", () => {
    expect(canResendTicket("pending", link())).toBe(false);
  });

  it("bez wiersza powiązań (zapytanie w locie) rozliczenia nie znamy - przycisku nie ma", () => {
    expect(canResendTicket("approved", null)).toBe(false);
  });
});

describe("groupLeadName - plakietka gościa", () => {
  it("gość dostaje imię i nazwisko prowadzącego", () => {
    expect(
      groupLeadName(
        link({
          group_lead_registration_id: LEAD,
          lead_first_name: "Anna",
          lead_last_name: "Nowak",
        }),
      ),
    ).toBe("Anna Nowak");
  });

  it("brak części nazwiska nie zostawia spacji na brzegu", () => {
    expect(groupLeadName(link({ group_lead_registration_id: LEAD, lead_first_name: "Anna" }))).toBe(
      "Anna",
    );
    expect(groupLeadName(link({ group_lead_registration_id: LEAD }))).toBe("");
  });

  it("prowadzący i wiersz bez powiązań nie są gośćmi", () => {
    expect(groupLeadName(link({ guest_count: 2 }))).toBeNull();
    expect(groupLeadName(null)).toBeNull();
  });
});
