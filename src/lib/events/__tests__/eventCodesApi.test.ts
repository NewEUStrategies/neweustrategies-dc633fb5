import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  emptyEventCodeDraft,
  eventCodeDraftIssue,
  eventCodeDraftToPayload,
  eventCodeRegistrationUrl,
  eventCodeRowToDraft,
  eventCodeStatus,
  type EventCodeRow,
} from "@/lib/events/eventCodesApi";

const base = () => ({ ...emptyEventCodeDraft("PLN"), code: "vip10", amount: "10" });

describe("eventCodeDraftIssue", () => {
  it("accepts a valid percent code", () => {
    expect(eventCodeDraftIssue(base())).toBeNull();
  });
  it("requires a code", () => {
    expect(eventCodeDraftIssue({ ...base(), code: " " })).toBe("code");
  });
  it("requires an effect", () => {
    expect(eventCodeDraftIssue({ ...base(), appliesDiscount: false })).toBe("noEffect");
    expect(
      eventCodeDraftIssue({ ...base(), appliesDiscount: false, revealsHidden: true }),
    ).toBeNull();
  });
  it("validates percent and amount", () => {
    expect(eventCodeDraftIssue({ ...base(), amount: "101" })).toBe("percent");
    expect(eventCodeDraftIssue({ ...base(), discountKind: "fixed", amount: "0" })).toBe("amount");
  });
  it("validates quantity, dates and tickets", () => {
    expect(eventCodeDraftIssue({ ...base(), quantity: "0" })).toBe("quantity");
    expect(
      eventCodeDraftIssue({
        ...base(),
        validFrom: "2026-10-02T10:00",
        validUntil: "2026-10-01T10:00",
      }),
    ).toBe("dates");
    expect(eventCodeDraftIssue({ ...base(), ticketScope: "specific" })).toBe("tickets");
  });
});

describe("eventCodeDraftToPayload", () => {
  it("scopes the code to the event and normalizes it", () => {
    const p = eventCodeDraftToPayload("ev1", { ...base(), discountKind: "fixed", amount: "19,99" });
    expect(p.code).toBe("VIP10");
    expect(p.event_ids).toEqual(["ev1"]);
    expect(p.discount_cents).toBe(1999);
    expect(p.discount_percent).toBeNull();
    expect(p.ticket_type_ids).toEqual([]);
  });
  it("reveal-only code carries no discount", () => {
    const p = eventCodeDraftToPayload("ev1", {
      ...base(),
      appliesDiscount: false,
      revealsHidden: true,
    });
    expect(p.discount_percent).toBeNull();
    expect(p.discount_cents).toBeNull();
    expect(p.applies_discount).toBe(false);
  });
});

describe("status, url, round trip", () => {
  const row: EventCodeRow = {
    id: "c1",
    code: "VIP10",
    name: null,
    description: null,
    active: true,
    appliesDiscount: true,
    revealsHidden: false,
    discountKind: "percent",
    discountPercent: 10,
    discountCents: null,
    currency: null,
    maxRedemptions: 2,
    redemptionsCount: 2,
    validFrom: null,
    validUntil: null,
    ticketTypeIds: ["t1"],
  };
  it("computes status", () => {
    expect(eventCodeStatus(row)).toBe("used_up");
    expect(eventCodeStatus({ ...row, active: false })).toBe("inactive");
    expect(eventCodeStatus({ ...row, maxRedemptions: null })).toBe("active");
  });
  it("builds the registration URL", () => {
    expect(eventCodeRegistrationUrl("https://neweuropeanstrategies.com", "summit", "VIP 10")).toBe(
      "https://neweuropeanstrategies.com/events/summit/register?code=VIP%2010",
    );
  });
  it("row to draft keeps scope", () => {
    const d = eventCodeRowToDraft(row);
    expect(d.ticketScope).toBe("specific");
    expect(d.amount).toBe("10");
  });
});
