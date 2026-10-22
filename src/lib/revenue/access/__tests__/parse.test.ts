// Parser inwentarza dostępu (S3): kontrakt SQL <-> TS i klucze migracji.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCESS_INVENTORY_KEYS,
  AccessInventoryShapeError,
  parseAccessInventory,
} from "@/lib/revenue/access/parse";

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20261020120400_revenue_funnel_access.sql"),
  "utf8",
);

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    computed_at: "2026-10-19T12:00:00+00:00",
    total: 7,
    rows: [
      { entity_type: "post", mode: "paid", min_tier_rank: 0, metering_policy: "inherit", count: 3 },
      {
        entity_type: "post",
        mode: "members",
        min_tier_rank: 20,
        metering_policy: "inherit",
        count: 1,
      },
    ],
    by_mode: { public: 1, members: 1, paid: 4, password: 1 },
    tiers: [
      {
        key: "member",
        rank: 10,
        active: true,
        pricing_visible: true,
        cta_mode: "auto",
        offerable: true,
      },
      {
        key: "pro",
        rank: 20,
        active: true,
        pricing_visible: true,
        cta_mode: null,
        offerable: false,
      },
    ],
    dead_ends: {
      tier_without_offer: 1,
      paid_without_offer: 0,
      dangling_plans: 1,
      metered_tier_gated: 1,
    },
    hits_30d: [{ reason: "tier_rank", accounts: 1, visitors: 0, hits: 1 }],
    ...overrides,
  };
}

describe("parseAccessInventory", () => {
  it("mapuje kształt SQL na DTO", () => {
    const dto = parseAccessInventory(raw());
    expect(dto.total).toBe(7);
    expect(dto.rows[1]).toEqual({
      entityType: "post",
      mode: "members",
      minTierRank: 20,
      meteringPolicy: "inherit",
      count: 1,
    });
    expect(dto.byMode).toEqual({ public: 1, members: 1, paid: 4, password: 1 });
    expect(dto.tiers[1]).toEqual({
      key: "pro",
      rank: 20,
      active: true,
      pricingVisible: true,
      ctaMode: null,
      offerable: false,
    });
    expect(dto.deadEnds).toEqual({
      tierWithoutOffer: 1,
      paidWithoutOffer: 0,
      danglingPlans: 1,
      meteredTierGated: 1,
    });
    expect(dto.hits30d).toEqual([{ reason: "tier_rank", accounts: 1, visitors: 0, hits: 1 }]);
  });

  it.each([
    [
      "nieznany tryb",
      {
        rows: [
          {
            entity_type: "post",
            mode: "vip",
            min_tier_rank: 0,
            metering_policy: "inherit",
            count: 1,
          },
        ],
      },
    ],
    ["brak ślepego zaułka", { dead_ends: { tier_without_offer: 1 } }],
    ["liczność ujemna", { total: -1 }],
    [
      "offerable nie-boolean",
      {
        tiers: [
          {
            key: "x",
            rank: 1,
            active: true,
            pricing_visible: true,
            cta_mode: null,
            offerable: "yes",
          },
        ],
      },
    ],
    [
      "nieznany powód uderzenia",
      { hits_30d: [{ reason: "x", accounts: 0, visitors: 0, hits: 1 }] },
    ],
    ["zły znacznik czasu", { computed_at: "wczoraj" }],
  ])("zły kształt rzuca: %s", (_name, override) => {
    expect(() => parseAccessInventory(raw(override))).toThrow(AccessInventoryShapeError);
  });
});

describe("ACCESS_INVENTORY_KEYS = klucze migracji (rpc-shape)", () => {
  it("komentarz rpc-shape przy stałej", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/revenue/access/parse.ts"), "utf8");
    expect(source).toMatch(
      /\/\/ rpc-shape: admin_revenue_access_inventory\nexport const ACCESS_INVENTORY_KEYS/,
    );
  });

  it("każdy klucz kontraktu buduje migracja", () => {
    const all = Object.values(ACCESS_INVENTORY_KEYS).flat();
    expect(all.filter((key) => !MIGRATION.includes(`'${key}'`))).toEqual([]);
  });
});
