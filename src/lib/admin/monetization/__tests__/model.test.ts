import { describe, expect, it } from "vitest";

import {
  ENVIRONMENT_FILTERS,
  MONETIZATION_SECTIONS,
  donationEnvironmentIndex,
  filterLedger,
  giftLinkStatus,
  grantEnvironment,
  grantStatus,
  maskEmail,
  maskGiftCode,
  matchesEnvironment,
  normalizeEnvironment,
  summarizeLedger,
  type DonationLedgerRow,
  type GiftLinkLedgerRow,
  type GrantLedgerRow,
} from "@/lib/admin/monetization/model";

const NOW = new Date("2026-09-01T12:00:00.000Z");

function donation(over: Partial<DonationLedgerRow> = {}): DonationLedgerRow {
  return {
    id: "d1",
    amountCents: 5000,
    currency: "PLN",
    status: "paid",
    recurring: false,
    donorEmail: "anna.kowalska@example.com",
    environment: "live",
    createdAt: "2026-08-01T10:00:00.000Z",
    paidAt: "2026-08-01T10:01:00.000Z",
    ...over,
  };
}

function grant(over: Partial<GrantLedgerRow> = {}): GrantLedgerRow {
  return {
    id: "g1",
    userId: "u1",
    tierKey: "pro",
    source: "donation",
    note: null,
    sourceDonationId: "d1",
    startsAt: "2026-08-01T10:00:00.000Z",
    expiresAt: null,
    revokedAt: null,
    createdAt: "2026-08-01T10:00:00.000Z",
    ...over,
  };
}

function link(over: Partial<GiftLinkLedgerRow> = {}): GiftLinkLedgerRow {
  return {
    id: "l1",
    code: "abcdef123456",
    postId: "p1",
    createdAt: "2026-08-01T10:00:00.000Z",
    expiresAt: null,
    revokedAt: null,
    redemptionCount: 0,
    maxRedemptions: 5,
    ...over,
  };
}

describe("normalizeEnvironment", () => {
  it.each([
    ["live", "live"],
    ["production", "live"],
    ["  LIVE ", "live"],
    ["sandbox", "sandbox"],
    ["test", "sandbox"],
    ["", "unknown"],
    ["staging", "unknown"],
  ])("mapuje %s", (raw, expected) => {
    expect(normalizeEnvironment(raw)).toBe(expected);
  });

  it("null i undefined dają unknown", () => {
    expect(normalizeEnvironment(null)).toBe("unknown");
    expect(normalizeEnvironment(undefined)).toBe("unknown");
  });
});

describe("matchesEnvironment", () => {
  it("filtr all przepuszcza wszystko", () => {
    for (const env of ["live", "sandbox", "unknown"] as const) {
      expect(matchesEnvironment(env, "all")).toBe(true);
    }
  });

  it("unknown nigdy nie znika przy zawężeniu", () => {
    expect(matchesEnvironment("unknown", "live")).toBe(true);
    expect(matchesEnvironment("unknown", "sandbox")).toBe(true);
  });

  it("zawęża do wybranego środowiska", () => {
    expect(matchesEnvironment("live", "live")).toBe(true);
    expect(matchesEnvironment("live", "sandbox")).toBe(false);
    expect(matchesEnvironment("sandbox", "live")).toBe(false);
    expect(matchesEnvironment("sandbox", "sandbox")).toBe(true);
  });
});

describe("grantEnvironment", () => {
  const index = donationEnvironmentIndex([
    donation({ id: "d-live", environment: "live" }),
    donation({ id: "d-sandbox", environment: "sandbox" }),
  ]);

  it("dziedziczy po darowiźnie źródłowej", () => {
    expect(grantEnvironment({ sourceDonationId: "d-live" }, index)).toBe("live");
    expect(grantEnvironment({ sourceDonationId: "d-sandbox" }, index)).toBe("sandbox");
  });

  it("nadanie ręczne i nieznana darowizna dają unknown", () => {
    expect(grantEnvironment({ sourceDonationId: null }, index)).toBe("unknown");
    expect(grantEnvironment({ sourceDonationId: "brak" }, index)).toBe("unknown");
  });
});

describe("filterLedger", () => {
  const ledger = {
    donations: [
      donation({ id: "d-live", environment: "live" }),
      donation({ id: "d-sandbox", environment: "sandbox" }),
      donation({ id: "d-legacy", environment: "unknown" }),
    ],
    grants: [
      grant({ id: "g-live", sourceDonationId: "d-live" }),
      grant({ id: "g-sandbox", sourceDonationId: "d-sandbox" }),
      grant({ id: "g-manual", sourceDonationId: null }),
    ],
    giftLinks: [link()],
  };

  it("all zwraca komplet", () => {
    const out = filterLedger(ledger, "all");
    expect(out.donations).toHaveLength(3);
    expect(out.grants).toHaveLength(3);
  });

  it("live zostawia live + legacy/ręczne", () => {
    const out = filterLedger(ledger, "live");
    expect(out.donations.map((d) => d.id)).toEqual(["d-live", "d-legacy"]);
    expect(out.grants.map((g) => g.id)).toEqual(["g-live", "g-manual"]);
  });

  it("sandbox zostawia sandbox + legacy/ręczne", () => {
    const out = filterLedger(ledger, "sandbox");
    expect(out.donations.map((d) => d.id)).toEqual(["d-sandbox", "d-legacy"]);
    expect(out.grants.map((g) => g.id)).toEqual(["g-sandbox", "g-manual"]);
  });

  it("linki prezentowe są bezśrodowiskowe i nie znikają", () => {
    expect(filterLedger(ledger, "sandbox").giftLinks).toHaveLength(1);
    expect(filterLedger(ledger, "live").giftLinks).toHaveLength(1);
  });
});

describe("grantStatus", () => {
  it("cofnięcie ma pierwszeństwo", () => {
    expect(grantStatus(grant({ revokedAt: "2026-08-10T00:00:00.000Z" }), NOW)).toBe("revoked");
  });
  it("zaplanowany, wygasły, aktywny", () => {
    expect(grantStatus(grant({ startsAt: "2026-10-01T00:00:00.000Z" }), NOW)).toBe("scheduled");
    expect(grantStatus(grant({ expiresAt: "2026-08-15T00:00:00.000Z" }), NOW)).toBe("expired");
    expect(grantStatus(grant({ expiresAt: "2026-10-15T00:00:00.000Z" }), NOW)).toBe("active");
    expect(grantStatus(grant(), NOW)).toBe("active");
  });
});

describe("giftLinkStatus", () => {
  it("unieważnienie > wygaśnięcie > wyczerpanie", () => {
    expect(giftLinkStatus(link({ revokedAt: "2026-08-02T00:00:00.000Z" }), NOW)).toBe("revoked");
    expect(giftLinkStatus(link({ expiresAt: "2026-08-02T00:00:00.000Z" }), NOW)).toBe("expired");
    expect(giftLinkStatus(link({ redemptionCount: 5, maxRedemptions: 5 }), NOW)).toBe("exhausted");
  });
  it("cap 0 oznacza brak limitu", () => {
    expect(giftLinkStatus(link({ redemptionCount: 99, maxRedemptions: 0 }), NOW)).toBe("active");
  });
  it("link w budżecie jest aktywny", () => {
    expect(giftLinkStatus(link({ redemptionCount: 1 }), NOW)).toBe("active");
  });
});

describe("summarizeLedger", () => {
  it("sumuje osobno per waluta i liczy statusy", () => {
    const summary = summarizeLedger(
      {
        donations: [
          donation({ id: "a", amountCents: 1000, currency: "pln" }),
          donation({ id: "b", amountCents: 2500, currency: "PLN" }),
          donation({ id: "c", amountCents: 4000, currency: "EUR" }),
          donation({ id: "d", status: "pending" }),
          donation({ id: "e", status: "failed" }),
        ],
        grants: [grant(), grant({ id: "g2", revokedAt: "2026-08-02T00:00:00.000Z" })],
        giftLinks: [link(), link({ id: "l2", revokedAt: "2026-08-02T00:00:00.000Z" })],
      },
      NOW,
    );
    expect(summary.paidTotals).toEqual([
      { currency: "EUR", amountCents: 4000, count: 1 },
      { currency: "PLN", amountCents: 3500, count: 2 },
    ]);
    expect(summary.donationCount).toBe(5);
    expect(summary.pendingCount).toBe(1);
    expect(summary.activeGrants).toBe(1);
    expect(summary.activeGiftLinks).toBe(1);
  });

  it("pusty rejestr daje zera", () => {
    const summary = summarizeLedger({ donations: [], grants: [], giftLinks: [] }, NOW);
    expect(summary.paidTotals).toEqual([]);
    expect(summary.donationCount).toBe(0);
  });
});

describe("maskowanie danych", () => {
  it("skraca adres e-mail", () => {
    expect(maskEmail("anna.kowalska@example.com")).toBe("an***@example.com");
    expect(maskEmail("ab@example.com")).toBe("ab@example.com");
    expect(maskEmail("@example.com")).toBe("***");
    expect(maskEmail(null)).toBeNull();
  });
  it("skraca kod prezentowy", () => {
    expect(maskGiftCode("abcdef123456")).toBe("abcdef...");
    expect(maskGiftCode("abc")).toBe("abc");
  });
});

describe("stałe kolejności", () => {
  it("filtry i sekcje mają stabilną kolejność", () => {
    expect(ENVIRONMENT_FILTERS).toEqual(["all", "live", "sandbox"]);
    expect(MONETIZATION_SECTIONS).toEqual(["donations", "grants", "giftLinks"]);
  });
});
