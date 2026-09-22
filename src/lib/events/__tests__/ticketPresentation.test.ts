import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));

import {
  duplicateTicketKey,
  matchesTicketSearch,
  ticketRegistrationUrl,
  ticketStatus,
} from "@/lib/events/ticketPresentation";
import {
  customPriceLabel,
  visibleTickets,
  type RegistrationFormTicket,
} from "@/lib/events/registrationFormSurface";
import type { EventTicketRow } from "@/lib/events/registrationsApi";

const row = (patch: Partial<EventTicketRow>): EventTicketRow =>
  ({
    id: "t1",
    key: "vip",
    name_pl: "Bilet VIP",
    name_en: "VIP pass",
    is_active: true,
    sales_from: null,
    sales_to: null,
    quota: null,
    sold_count: 0,
    availability: undefined,
    ...patch,
  }) satisfies Partial<EventTicketRow> as EventTicketRow;

describe("ticketPresentation", () => {
  it("builds the registration URL on the canonical host", () => {
    expect(ticketRegistrationUrl("forum 2026", "vip", "https://neweuropeanstrategies.com")).toBe(
      "https://neweuropeanstrategies.com/events/forum%202026/register?ticket=vip",
    );
  });

  it("derives status, preferring the database availability", () => {
    const now = new Date("2026-09-22T12:00:00Z");
    expect(ticketStatus(row({ is_active: false }), now)).toBe("inactive");
    expect(ticketStatus(row({ sales_from: "2026-10-01T00:00:00Z" }), now)).toBe("scheduled");
    expect(ticketStatus(row({ sales_to: "2026-09-01T00:00:00Z" }), now)).toBe("ended");
    expect(ticketStatus(row({ quota: 2, sold_count: 2 }), now)).toBe("sold_out");
    expect(ticketStatus(row({ availability: "sold_out" }), now)).toBe("sold_out");
    expect(ticketStatus(row({}), now)).toBe("on_sale");
  });

  it("finds a free duplicate key", () => {
    expect(duplicateTicketKey("vip", new Set(["vip"]))).toBe("vip_copy");
    expect(duplicateTicketKey("vip", new Set(["vip", "vip_copy"]))).toBe("vip_copy2");
    expect(duplicateTicketKey("x".repeat(49), new Set()).length).toBeLessThanOrEqual(49);
  });

  it("searches name in both languages and key", () => {
    expect(matchesTicketSearch(row({}), "pass")).toBe(true);
    expect(matchesTicketSearch(row({}), "bilet")).toBe(true);
    expect(matchesTicketSearch(row({}), "VIP")).toBe(true);
    expect(matchesTicketSearch(row({}), "student")).toBe(false);
  });
});

describe("public ticket visibility", () => {
  const ticket = (key: string, isHidden: boolean): RegistrationFormTicket =>
    ({ id: key, key, isHidden, priceLabelPl: " Gratis ", priceLabelEn: "" }) as RegistrationFormTicket;

  it("shows a hidden ticket only through its direct link", () => {
    const list = [ticket("open", false), ticket("secret", true)];
    expect(visibleTickets(list, null).map((entry) => entry.key)).toEqual(["open"]);
    expect(visibleTickets(list, "secret").map((entry) => entry.key)).toEqual(["open", "secret"]);
  });

  it("returns a custom price label per language", () => {
    expect(customPriceLabel(ticket("a", false), "pl")).toBe("Gratis");
    expect(customPriceLabel(ticket("a", false), "en")).toBeNull();
  });
});
