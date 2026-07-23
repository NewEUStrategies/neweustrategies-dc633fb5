// Rozstrzyganie członkostwa leada - lustro reguł RPC current_membership_tier:
// max(subskrypcje, nadania, miejsca organizacji) -> warstwa domyślna.
import { describe, it, expect } from "vitest";
import {
  resolveLeadMembership,
  type LeadGrantInput,
  type LeadOrgInput,
  type LeadSubscriptionInput,
  type MembershipTierLite,
} from "@/lib/crm/membershipSummary";

const NOW = new Date("2026-07-22T12:00:00Z");
const PAST = "2026-01-01T00:00:00Z";
const FUTURE = "2027-01-01T00:00:00Z";
const EXPIRED = "2026-06-01T00:00:00Z";

const TIERS: MembershipTierLite[] = [
  { key: "reader", rank: 0, name_pl: "Essential", name_en: "Essential", is_default: true },
  { key: "member", rank: 10, name_pl: "Plus", name_en: "Plus", is_default: false },
  { key: "pro", rank: 20, name_pl: "Pro", name_en: "Pro", is_default: false },
  { key: "corporate", rank: 30, name_pl: "Enterprise", name_en: "Enterprise", is_default: false },
];

function sub(overrides: Partial<LeadSubscriptionInput> = {}): LeadSubscriptionInput {
  return {
    id: "s1",
    status: "active",
    started_at: PAST,
    current_period_end: FUTURE,
    canceled_at: null,
    plan: {
      id: "p1",
      name_pl: "Plus rocznie",
      name_en: "Plus yearly",
      interval: "year",
      tier_key: "member",
    },
    ...overrides,
  };
}

function grant(overrides: Partial<LeadGrantInput> = {}): LeadGrantInput {
  return {
    tier_key: "pro",
    source: "manual",
    starts_at: PAST,
    expires_at: FUTURE,
    revoked_at: null,
    ...overrides,
  };
}

function seat(overrides: Partial<LeadOrgInput> = {}): LeadOrgInput {
  return {
    claimed_at: PAST,
    org: {
      id: "o1",
      name: "ACME",
      tier_key: "corporate",
      status: "active",
      starts_at: PAST,
      expires_at: null,
    },
    ...overrides,
  };
}

function resolve(input: {
  subscriptions?: LeadSubscriptionInput[];
  grants?: LeadGrantInput[];
  orgSeats?: LeadOrgInput[];
  tiers?: MembershipTierLite[];
}) {
  return resolveLeadMembership({
    now: NOW,
    userId: "u1",
    tiers: input.tiers ?? TIERS,
    subscriptions: input.subscriptions ?? [],
    grants: input.grants ?? [],
    orgSeats: input.orgSeats ?? [],
  });
}

describe("resolveLeadMembership", () => {
  it("bez żadnych źródeł zwraca warstwę domyślną tenantu", () => {
    const out = resolve({});
    expect(out.tier?.key).toBe("reader");
    expect(out.source).toBe("default");
    expect(out.subscription).toBeNull();
    expect(out.organization).toBeNull();
    expect(out.active_grants).toBe(0);
  });

  it("aktywna subskrypcja nadaje warstwę planu", () => {
    const out = resolve({ subscriptions: [sub()] });
    expect(out.tier?.key).toBe("member");
    expect(out.source).toBe("subscription");
    expect(out.subscription?.plan?.name_pl).toBe("Plus rocznie");
  });

  it("wygrywa najwyższa ranga spośród źródeł (organizacja > nadanie > subskrypcja)", () => {
    const out = resolve({ subscriptions: [sub()], grants: [grant()], orgSeats: [seat()] });
    expect(out.tier?.key).toBe("corporate");
    expect(out.source).toBe("organization");
    // Subskrypcja raportowana niezależnie od zwycięzcy (sprzedaż widzi plan).
    expect(out.subscription?.id).toBe("s1");
    expect(out.organization?.name).toBe("ACME");
    expect(out.active_grants).toBe(1);
  });

  it("wygasłe/cofnięte źródła nie liczą się do warstwy", () => {
    const out = resolve({
      subscriptions: [sub({ current_period_end: EXPIRED })],
      grants: [grant({ revoked_at: PAST }), grant({ expires_at: EXPIRED })],
      orgSeats: [
        seat({ claimed_at: null }),
        seat({ org: { ...seat().org!, status: "suspended" } }),
      ],
    });
    expect(out.tier?.key).toBe("reader");
    expect(out.source).toBe("default");
    expect(out.subscription).toBeNull();
    expect(out.active_grants).toBe(0);
    expect(out.organization).toBeNull();
  });

  it("subskrypcja bezterminowa (current_period_end null) jest aktywna", () => {
    const out = resolve({ subscriptions: [sub({ current_period_end: null })] });
    expect(out.tier?.key).toBe("member");
    expect(out.subscription?.current_period_end).toBeNull();
  });

  it("plan bez tier_key nie nadaje warstwy, ale subskrypcja jest raportowana", () => {
    const out = resolve({
      subscriptions: [sub({ plan: { ...sub().plan!, tier_key: null } })],
    });
    expect(out.tier?.key).toBe("reader");
    expect(out.source).toBe("default");
    expect(out.subscription?.id).toBe("s1");
  });

  it("nieznany tier_key (rozjazd katalogu) degraduje do warstwy domyślnej", () => {
    const out = resolve({ grants: [grant({ tier_key: "ghost" })] });
    expect(out.tier?.key).toBe("reader");
    // Nadanie wciąż aktywne w liczniku - admin widzi, że COŚ jest nadane,
    // nawet gdy klucz nie pasuje do katalogu.
    expect(out.active_grants).toBe(1);
  });

  it("najnowsza aktywna subskrypcja wygrywa w polu subscription", () => {
    const older = sub({ id: "s-old", started_at: "2025-01-01T00:00:00Z" });
    const newer = sub({ id: "s-new", started_at: "2026-05-01T00:00:00Z" });
    const out = resolve({ subscriptions: [older, newer] });
    expect(out.subscription?.id).toBe("s-new");
  });
});
