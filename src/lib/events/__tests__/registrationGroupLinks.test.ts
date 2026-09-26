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
const { canResendTicket, groupLeadName, holdsTicket, ticketBadge } =
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
    ticket_code_undeliverable_at: null,
    ...over,
  };
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

const PAGE = ["cccccccc-cccc-cccc-cccc-cccccccccccc", LEAD] as const;

describe("fetchRegistrationGroupLinks", () => {
  it("woła RPC panelu z wydarzeniem i wierszami strony, oddaje wiersze", async () => {
    const rows = [link({ group_lead_registration_id: LEAD, lead_first_name: "Anna" })];
    h.rpc?.setData("admin_event_registration_group_links", rows);
    await expect(fetchRegistrationGroupLinks(EVENT, PAGE)).resolves.toEqual(rows);
    const call = h.rpc?.lastCall("admin_event_registration_group_links");
    expect(call?.arg("p_event_id")).toBe(EVENT);
    expect(call?.arg("p_registration_ids")).toEqual([...PAGE]);
  });

  it("pusta strona nie pyta bazy wcale - i nie ciągnie całego wydarzenia", async () => {
    await expect(fetchRegistrationGroupLinks(EVENT, [])).resolves.toEqual([]);
    expect(h.rpc?.lastCall("admin_event_registration_group_links")).toBeUndefined();
  });

  it("pusta odpowiedź to pusta lista, nie `null`", async () => {
    h.rpc?.setData("admin_event_registration_group_links", null);
    await expect(fetchRegistrationGroupLinks(EVENT, PAGE)).resolves.toEqual([]);
  });

  it("odmowa bazy (bramka roli) rzuca - panel pokaże ją zdaniem", async () => {
    h.rpc?.setError("admin_event_registration_group_links", "forbidden: admin role required");
    await expect(fetchRegistrationGroupLinks(EVENT, PAGE)).rejects.toMatchObject({
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
  it.each(["paid", "partially_refunded", "not_required"])(
    "przyjęty i rozliczony (%s) - przycisk jest",
    (payment) => {
      expect(canResendTicket("approved", link({ payment_status: payment }))).toBe(true);
      expect(canResendTicket("attended", link({ payment_status: payment }))).toBe(true);
    },
  );

  it.each(["unpaid", "refunded"])("przyjęty, ale %s - przycisku nie ma", (payment) => {
    expect(canResendTicket("approved", link({ payment_status: payment }))).toBe(false);
  });

  it("nieprzyjęty - przycisku nie ma, choć rozliczenia nie trzeba", () => {
    expect(canResendTicket("pending", link())).toBe(false);
  });

  it("bez wiersza powiązań (zapytanie w locie) rozliczenia nie znamy - przycisku nie ma", () => {
    expect(canResendTicket("approved", null)).toBe(false);
  });
});

describe("ticketBadge - plakietka biletu", () => {
  it("przyjęty i rozliczony: wysłany albo niewysłany - wg znacznika wysyłki", () => {
    expect(ticketBadge("approved", link())).toBe("notSent");
    expect(ticketBadge("attended", link({ payment_status: "paid" }))).toBe("notSent");
    expect(ticketBadge("approved", link({ ticket_code_sent_at: "2026-09-26T10:00:00Z" }))).toBe(
      "sent",
    );
  });

  it("adres z listy wykluczeń: „nie dotarł” ma pierwszeństwo przed „wysłany”", () => {
    // Niedoręczalny adres zamyka wysyłkę JAK wysłaną (znacznik stoi, żeby cron
    // nie rotował kodu co tick) - bez pierwszeństwa panel kłamałby „wysłany”.
    const stamp = "2026-09-26T10:00:00Z";
    expect(
      ticketBadge(
        "approved",
        link({ ticket_code_sent_at: stamp, ticket_code_undeliverable_at: stamp }),
      ),
    ).toBe("undeliverable");
    expect(
      ticketBadge(
        "attended",
        link({ payment_status: "paid", ticket_code_undeliverable_at: stamp }),
      ),
    ).toBe("undeliverable");
  });

  it("przyjęty, ale nieoplacony: bilet po wpłacie - nie „niewysłany”", () => {
    expect(ticketBadge("approved", link({ payment_status: "unpaid" }))).toBe("awaitingPayment");
  });

  it("przyjęty, ale zwrócony: bez plakietki - biletu nie ma i nie będzie", () => {
    expect(ticketBadge("approved", link({ payment_status: "refunded" }))).toBeNull();
  });

  it("zwrot częściowy to korekta ceny - bilet zostaje, plakietka jak przy opłaconym", () => {
    expect(ticketBadge("approved", link({ payment_status: "partially_refunded" }))).toBe("notSent");
    expect(
      ticketBadge(
        "attended",
        link({ payment_status: "partially_refunded", ticket_code_sent_at: "2026-09-26T10:00:00Z" }),
      ),
    ).toBe("sent");
  });

  it("nieprzyjęty albo bez wiersza powiązań: bez plakietki", () => {
    expect(ticketBadge("pending", link())).toBeNull();
    expect(ticketBadge("pending", link({ payment_status: "unpaid" }))).toBeNull();
    expect(ticketBadge("approved", null)).toBeNull();
    expect(ticketBadge("waitlist", null)).toBeNull();
  });

  it("opłacony wiersz w kolejce: „opłacone - czeka na miejsce”, także po korekcie ceny", () => {
    // Wpłata przyszła po wyczerpaniu puli (20260926150000). Bez plakietki
    // wiersz wyglądał jak zwykły rezerwowy, a pieniądze leżały bez ruchu.
    expect(ticketBadge("waitlist", link({ payment_status: "paid" }))).toBe("paidWaitlisted");
    expect(ticketBadge("waitlist", link({ payment_status: "partially_refunded" }))).toBe(
      "paidWaitlisted",
    );
  });

  it("opłacony wiersz bez decyzji: „opłacone - czeka na decyzję” (wpłata nie jest akceptacją)", () => {
    expect(ticketBadge("pending", link({ payment_status: "paid" }))).toBe("paidAwaitingDecision");
    expect(ticketBadge("draft", link({ payment_status: "paid" }))).toBe("paidAwaitingDecision");
  });

  it("wpłata na zgłoszeniu zamkniętym: „opłacone - zgłoszenie zamknięte” - do zwrotu", () => {
    expect(ticketBadge("cancelled", link({ payment_status: "paid" }))).toBe("paidClosed");
    expect(ticketBadge("rejected", link({ payment_status: "paid" }))).toBe("paidClosed");
  });

  it("bez pieniędzy u organizatora wiersz bez miejsca nie ma plakietki „opłacone”", () => {
    // Bezpłatny (`not_required`) albo nieopłacony wiersz w kolejce po prostu
    // czeka - „opłacone" byłoby nieprawdą. `no_show` miał miejsce i jest
    // rozliczony, więc nic na organizatora nie czeka.
    expect(ticketBadge("waitlist", link({ payment_status: "unpaid" }))).toBeNull();
    expect(ticketBadge("waitlist", link({ payment_status: "not_required" }))).toBeNull();
    expect(ticketBadge("cancelled", link({ payment_status: "refunded" }))).toBeNull();
    expect(ticketBadge("no_show", link({ payment_status: "paid" }))).toBeNull();
  });

  it("plakietka „niewysłany” stoi dokładnie tam, gdzie przycisk ponownej wysyłki", () => {
    for (const status of ["approved", "attended", "pending", "cancelled"]) {
      for (const payment of ["paid", "partially_refunded", "not_required", "unpaid", "refunded"]) {
        for (const sent of [null, "2026-09-26T10:00:00Z"]) {
          for (const undeliverable of [null, "2026-09-26T10:00:00Z"]) {
            const row = link({
              payment_status: payment,
              ticket_code_sent_at: sent,
              ticket_code_undeliverable_at: undeliverable,
            });
            const badge = ticketBadge(status, row);
            expect(badge === "notSent" || badge === "sent" || badge === "undeliverable").toBe(
              canResendTicket(status, row),
            );
          }
        }
      }
    }
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
