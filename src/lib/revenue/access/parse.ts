// JSONB `admin_revenue_access_inventory` -> `AccessInventoryDto`.
//
// Parser RZUCA przy złym kształcie (jak lejek i zdrowie e-mail): zero
// w inwentarzu jest wynikiem („0 ślepych zaułków"), więc pole brakujące albo
// zdeformowane nie może po cichu zamienić się w zero.
import { PAYWALL_HIT_REASONS, type PaywallHitReason } from "@/lib/revenue/limits";
import type {
  AccessInventoryDto,
  AccessInventoryEntity,
  AccessInventoryHits,
  AccessInventoryMode,
  AccessInventoryPolicy,
  AccessInventoryRow,
  AccessInventoryTier,
} from "./dto";

// rpc-shape: admin_revenue_access_inventory
export const ACCESS_INVENTORY_KEYS = {
  root: ["computed_at", "total", "rows", "by_mode", "tiers", "dead_ends", "hits_30d"],
  row: ["entity_type", "mode", "min_tier_rank", "metering_policy", "count"],
  tier: ["key", "rank", "active", "pricing_visible", "cta_mode", "offerable"],
  deadEnds: ["tier_without_offer", "paid_without_offer", "dangling_plans", "metered_tier_gated"],
  hits: ["reason", "accounts", "visitors", "hits"],
} as const;

export const ACCESS_MODES: readonly AccessInventoryMode[] = [
  "public",
  "members",
  "paid",
  "password",
];
const POLICIES: readonly AccessInventoryPolicy[] = ["inherit", "metered", "exempt"];
const ENTITIES: readonly AccessInventoryEntity[] = ["post", "page", "media"];

export class AccessInventoryShapeError extends Error {
  readonly path: string;

  constructor(path: string, reason: string) {
    super(`admin_revenue_access_inventory: ${path} - ${reason}`);
    this.name = "AccessInventoryShapeError";
    this.path = path;
  }
}

type Bag = Readonly<Record<string, unknown>>;

function isBag(value: unknown): value is Bag {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(path: string, reason: string): never {
  throw new AccessInventoryShapeError(path, reason);
}

function count(source: Bag, path: string, key: string): number {
  if (!(key in source)) fail(`${path}${key}`, "brak pola");
  const value = source[key];
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value.trim())
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    fail(`${path}${key}`, "oczekiwano liczby całkowitej >= 0");
  }
  return parsed;
}

function flag(source: Bag, path: string, key: string): boolean {
  const value = source[key];
  if (typeof value !== "boolean") fail(`${path}${key}`, "oczekiwano boolean");
  return value;
}

function member<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    fail(path, `oczekiwano jednej z: ${allowed.join(", ")}`);
  }
  return value as T;
}

function array(source: Bag, key: string): readonly unknown[] {
  const value = source[key];
  if (!Array.isArray(value)) fail(key, "oczekiwano tablicy");
  return value;
}

function rows(raw: Bag): AccessInventoryRow[] {
  return array(raw, "rows").map((entry, i) => {
    const path = `rows[${i}].`;
    if (!isBag(entry)) fail(path, "oczekiwano obiektu");
    return {
      entityType: member(entry.entity_type, ENTITIES, `${path}entity_type`),
      mode: member(entry.mode, ACCESS_MODES, `${path}mode`),
      minTierRank: count(entry, path, "min_tier_rank"),
      meteringPolicy: member(entry.metering_policy, POLICIES, `${path}metering_policy`),
      count: count(entry, path, "count"),
    };
  });
}

function tiers(raw: Bag): AccessInventoryTier[] {
  return array(raw, "tiers").map((entry, i) => {
    const path = `tiers[${i}].`;
    if (!isBag(entry) || typeof entry.key !== "string") fail(`${path}key`, "oczekiwano napisu");
    const cta = entry.cta_mode;
    if (cta !== null && typeof cta !== "string") fail(`${path}cta_mode`, "oczekiwano napisu");
    return {
      key: entry.key,
      rank: count(entry, path, "rank"),
      active: flag(entry, path, "active"),
      pricingVisible: flag(entry, path, "pricing_visible"),
      ctaMode: (cta as string | null) ?? null,
      offerable: flag(entry, path, "offerable"),
    };
  });
}

function hits(raw: Bag): AccessInventoryHits[] {
  return array(raw, "hits_30d").map((entry, i) => {
    const path = `hits_30d[${i}].`;
    if (!isBag(entry)) fail(path, "oczekiwano obiektu");
    return {
      reason: member<PaywallHitReason>(entry.reason, PAYWALL_HIT_REASONS, `${path}reason`),
      accounts: count(entry, path, "accounts"),
      visitors: count(entry, path, "visitors"),
      hits: count(entry, path, "hits"),
    };
  });
}

export function parseAccessInventory(raw: unknown): AccessInventoryDto {
  if (!isBag(raw)) fail("$", "oczekiwano obiektu");
  const computedAt = raw.computed_at;
  if (typeof computedAt !== "string" || Number.isNaN(Date.parse(computedAt))) {
    fail("computed_at", "oczekiwano znacznika czasu ISO");
  }
  const byModeRaw = raw.by_mode;
  if (!isBag(byModeRaw)) fail("by_mode", "oczekiwano obiektu");
  const deadRaw = raw.dead_ends;
  if (!isBag(deadRaw)) fail("dead_ends", "oczekiwano obiektu");
  return {
    computedAt,
    total: count(raw, "", "total"),
    rows: rows(raw),
    byMode: {
      public: count(byModeRaw, "by_mode.", "public"),
      members: count(byModeRaw, "by_mode.", "members"),
      paid: count(byModeRaw, "by_mode.", "paid"),
      password: count(byModeRaw, "by_mode.", "password"),
    },
    tiers: tiers(raw),
    deadEnds: {
      tierWithoutOffer: count(deadRaw, "dead_ends.", "tier_without_offer"),
      paidWithoutOffer: count(deadRaw, "dead_ends.", "paid_without_offer"),
      danglingPlans: count(deadRaw, "dead_ends.", "dangling_plans"),
      meteredTierGated: count(deadRaw, "dead_ends.", "metered_tier_gated"),
    },
    hits30d: hits(raw),
  };
}
