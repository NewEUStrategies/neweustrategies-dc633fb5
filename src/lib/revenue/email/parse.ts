// JSONB `admin_revenue_email_health` -> `RevenueEmailHealthDto`, pole po polu.
//
// DLACZEGO PARSER RZUCA, A NIE ZERUJE. Pulpit ogólny (`admin/dashboard/parse.ts`)
// degraduje brakujące pole do zera, bo tam „zero sesji" i „brak pola" kończą
// się tym samym kafelkiem. Tu zero jest WYNIKIEM (np. „0 odbić"), a `null`
// znaczy „nie da się policzyć" - parser, który zamienia brak albo śmieć w 0,
// zamazałby dokładnie tę różnicę, dla której agregat istnieje. Zły kształt
// to rozjazd kontraktu SQL <-> TS, więc ma być głośny.
//
// Moduł bez zależności runtime: czyta go także migawka huba (S6) po stronie
// serwera, a test parytetu porównuje `EMAIL_HEALTH_KEYS` z treścią migracji.
import type {
  RevenueEmailCampaignHealth,
  RevenueEmailDoiHealth,
  RevenueEmailHealthDto,
  RevenueEmailListHealth,
} from "./dto";

// rpc-shape: admin_revenue_email_health
export const EMAIL_HEALTH_KEYS = {
  root: ["since", "until", "campaigns", "list", "doi"],
  campaigns: [
    "sent",
    "delivered",
    "unique_opens",
    "unique_clicks",
    "hard_bounces",
    "soft_bounces",
    "complaints",
    "unsubscribes",
  ],
  list: ["start", "end", "new", "unsubscribed", "net_growth"],
  doi: ["started", "confirmed_7d"],
} as const;

/** Rozjazd kontraktu RPC: ścieżka pola i powód. */
export class RevenueEmailHealthShapeError extends Error {
  readonly path: string;

  constructor(path: string, reason: string) {
    super(`admin_revenue_email_health: ${path} - ${reason}`);
    this.name = "RevenueEmailHealthShapeError";
    this.path = path;
  }
}

type Bag = Readonly<Record<string, unknown>>;

function isBag(value: unknown): value is Bag {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function section(source: Bag, key: string): Bag {
  const value = source[key];
  if (!isBag(value)) throw new RevenueEmailHealthShapeError(key, "oczekiwano obiektu");
  return value;
}

/**
 * Liczba całkowita z jsonb. `count(*)` to `bigint`, który przy bardzo dużych
 * wartościach bywa napisem - napis cyfr przyjmujemy, każdy inny typ odrzucamy.
 */
function integer(source: Bag, path: string, key: string, allowNegative: boolean): number | null {
  if (!(key in source)) throw new RevenueEmailHealthShapeError(`${path}.${key}`, "brak pola");
  const value = source[key];
  if (value === null) return null;
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^-?\d+$/.test(value.trim())
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || (!allowNegative && parsed < 0)) {
    throw new RevenueEmailHealthShapeError(`${path}.${key}`, "oczekiwano liczby całkowitej >= 0");
  }
  return parsed;
}

function count(source: Bag, path: string, key: string): number | null {
  return integer(source, path, key, false);
}

/** Pole, którego agregat nigdy nie zwraca jako `null`. */
function requiredCount(source: Bag, path: string, key: string, allowNegative = false): number {
  const value = integer(source, path, key, allowNegative);
  if (value === null) throw new RevenueEmailHealthShapeError(`${path}.${key}`, "null niedozwolony");
  return value;
}

function isoInstant(source: Bag, key: string): string {
  const value = source[key];
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new RevenueEmailHealthShapeError(key, "oczekiwano znacznika czasu ISO");
  }
  return value;
}

function campaigns(raw: Bag): RevenueEmailCampaignHealth {
  const c = section(raw, "campaigns");
  return {
    sent: requiredCount(c, "campaigns", "sent"),
    delivered: count(c, "campaigns", "delivered"),
    uniqueOpens: count(c, "campaigns", "unique_opens"),
    uniqueClicks: count(c, "campaigns", "unique_clicks"),
    hardBounces: count(c, "campaigns", "hard_bounces"),
    softBounces: count(c, "campaigns", "soft_bounces"),
    complaints: count(c, "campaigns", "complaints"),
    unsubscribes: count(c, "campaigns", "unsubscribes"),
  };
}

function list(raw: Bag): RevenueEmailListHealth {
  const l = section(raw, "list");
  return {
    start: requiredCount(l, "list", "start"),
    end: requiredCount(l, "list", "end"),
    new: requiredCount(l, "list", "new"),
    unsubscribed: requiredCount(l, "list", "unsubscribed"),
    netGrowth: requiredCount(l, "list", "net_growth", true),
  };
}

function doi(raw: Bag): RevenueEmailDoiHealth {
  const d = section(raw, "doi");
  return {
    started: requiredCount(d, "doi", "started"),
    confirmed7d: count(d, "doi", "confirmed_7d"),
  };
}

/** Parser wyniku RPC; rzuca `RevenueEmailHealthShapeError` przy złym kształcie. */
export function parseRevenueEmailHealth(raw: unknown): RevenueEmailHealthDto {
  if (!isBag(raw)) throw new RevenueEmailHealthShapeError("$", "oczekiwano obiektu");
  return {
    since: isoInstant(raw, "since"),
    until: isoInstant(raw, "until"),
    campaigns: campaigns(raw),
    list: list(raw),
    doi: doi(raw),
  };
}
