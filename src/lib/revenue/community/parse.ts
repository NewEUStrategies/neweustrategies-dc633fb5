// JSONB przekrojów społeczności (S4) -> DTO, pole po polu.
//
// PARSER RZUCA, A NIE ZERUJE (jak S1, `revenue/email/parse.ts`): zero jest
// tu WYNIKIEM („0 obecnych"), a `null` znaczy „nie pokazujemy / nie da się
// policzyć". Zamiana braku albo śmiecia w 0 zamazałaby tę różnicę, a zły
// kształt to rozjazd kontraktu SQL <-> TS, który ma być głośny.
//
// Moduł bez zależności runtime: czyta go migawka huba (S6) po stronie
// serwera, a test parytetu porównuje stałe `// rpc-shape` z treścią migracji
// 20261020130700 (klucz występuje w `jsonb_build_object` jako `'klucz', `).
import type {
  RevenueClubApplications,
  RevenueClubSummaryRow,
  RevenueClubsSummaryDto,
  RevenueEventMoney,
  RevenueEventSummaryRow,
  RevenueEventsSummaryDto,
} from "./dto";

// rpc-shape: admin_revenue_events_summary
export const COMMUNITY_EVENTS_KEYS = {
  root: [
    "since",
    "until",
    "money_visible",
    "events_count",
    "registrations",
    "paid",
    "attended",
    "no_show",
    "plan_pool",
    "by_currency",
    "events",
  ],
  event: [
    "event_id",
    "slug",
    "title_pl",
    "title_en",
    "starts_at",
    "status",
    "registrations",
    "paid",
    "attended",
    "no_show",
    "plan_pool",
    "by_currency",
  ],
  money: ["currency", "ticket_revenue_net_minor"],
} as const;

// rpc-shape: admin_revenue_clubs_summary
export const COMMUNITY_CLUBS_KEYS = {
  root: [
    "since",
    "until",
    "clubs_enabled",
    "clubs_count",
    "members",
    "active_members",
    "contributors",
    "applications",
    "decision_hours_median",
    "clubs",
  ],
  applications: ["submitted", "accepted", "rejected", "pending"],
  club: [
    "club_id",
    "slug",
    "name_pl",
    "name_en",
    "members",
    "active_members",
    "contributors",
    "applications_submitted",
    "applications_accepted",
    "applications_rejected",
  ],
} as const;

/** Rozjazd kontraktu RPC: funkcja, ścieżka pola i powód. */
export class RevenueCommunityShapeError extends Error {
  readonly path: string;

  constructor(fn: string, path: string, reason: string) {
    super(`${fn}: ${path} - ${reason}`);
    this.name = "RevenueCommunityShapeError";
    this.path = path;
  }
}

type Bag = Readonly<Record<string, unknown>>;

function isBag(value: unknown): value is Bag {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Czytnik pól jednej funkcji - błąd niesie nazwę RPC i pełną ścieżkę. */
function reader(fn: string) {
  const fail = (path: string, reason: string): never => {
    throw new RevenueCommunityShapeError(fn, path, reason);
  };
  const present = (source: Bag, path: string, key: string): unknown => {
    if (!(key in source)) fail(`${path}${key}`, "brak pola");
    return source[key];
  };

  /**
   * Liczba całkowita >= 0. `count(*)` / `sum(bigint)` bywa w jsonb napisem
   * przy dużych wartościach - napis cyfr przyjmujemy, inny typ odrzucamy.
   */
  const count = (source: Bag, path: string, key: string): number => {
    const value = present(source, path, key);
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
  };

  const text = (source: Bag, path: string, key: string): string => {
    const value = present(source, path, key);
    if (typeof value !== "string") fail(`${path}${key}`, "oczekiwano napisu");
    return value as string;
  };

  const bool = (source: Bag, path: string, key: string): boolean => {
    const value = present(source, path, key);
    if (typeof value !== "boolean") fail(`${path}${key}`, "oczekiwano wartości logicznej");
    return value as boolean;
  };

  const bag = (source: Bag, path: string, key: string): Bag => {
    const value = present(source, path, key);
    if (!isBag(value)) fail(`${path}${key}`, "oczekiwano obiektu");
    return value as Bag;
  };

  const list = (source: Bag, path: string, key: string): readonly unknown[] => {
    const value = present(source, path, key);
    if (!Array.isArray(value)) fail(`${path}${key}`, "oczekiwano tablicy");
    return value as readonly unknown[];
  };

  /** Liczba nieujemna (może być ułamkowa, np. mediana godzin) albo `null`. */
  const nonNegativeOrNull = (source: Bag, path: string, key: string): number | null => {
    const value = present(source, path, key);
    if (value === null) return null;
    const parsed =
      typeof value === "number"
        ? value
        : typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim())
          ? Number(value)
          : Number.NaN;
    if (!Number.isFinite(parsed) || parsed < 0) {
      fail(`${path}${key}`, "oczekiwano liczby >= 0 albo null");
    }
    return parsed;
  };

  return { fail, count, text, bool, bag, list, nonNegativeOrNull };
}

const EVENTS_FN = "admin_revenue_events_summary";
const CLUBS_FN = "admin_revenue_clubs_summary";

function parseMoney(
  r: ReturnType<typeof reader>,
  source: Bag,
  path: string,
): RevenueEventMoney[] | null {
  if (!("by_currency" in source)) r.fail(`${path}by_currency`, "brak pola");
  const value = source.by_currency;
  if (value === null) return null;
  if (!Array.isArray(value)) return r.fail(`${path}by_currency`, "oczekiwano tablicy albo null");
  const seen = new Set<string>();
  return value.map((item, index) => {
    const at = `${path}by_currency[${index}].`;
    if (!isBag(item)) return r.fail(at, "oczekiwano obiektu");
    const currency = r.text(item, at, "currency");
    // Dwie pozycje tej samej waluty to rozjazd GROUP BY - suma byłaby
    // liczona dwa razy w każdym miejscu, które ją dodaje.
    if (seen.has(currency)) r.fail(`${at}currency`, "powtórzona waluta");
    seen.add(currency);
    return { currency, ticketRevenueNetMinor: r.count(item, at, "ticket_revenue_net_minor") };
  });
}

export function parseRevenueEventsSummary(raw: unknown): RevenueEventsSummaryDto {
  const r = reader(EVENTS_FN);
  if (!isBag(raw)) return r.fail("$", "oczekiwano obiektu");
  const events: RevenueEventSummaryRow[] = r.list(raw, "", "events").map((item, index) => {
    const at = `events[${index}].`;
    if (!isBag(item)) return r.fail(at, "oczekiwano obiektu");
    return {
      eventId: r.text(item, at, "event_id"),
      slug: r.text(item, at, "slug"),
      titlePl: r.text(item, at, "title_pl"),
      titleEn: r.text(item, at, "title_en"),
      startsAt: r.text(item, at, "starts_at"),
      status: r.text(item, at, "status"),
      registrations: r.count(item, at, "registrations"),
      paid: r.count(item, at, "paid"),
      attended: r.count(item, at, "attended"),
      noShow: r.count(item, at, "no_show"),
      planPool: r.count(item, at, "plan_pool"),
      byCurrency: parseMoney(r, item, at),
    };
  });
  return {
    since: r.text(raw, "", "since"),
    until: r.text(raw, "", "until"),
    moneyVisible: r.bool(raw, "", "money_visible"),
    eventsCount: r.count(raw, "", "events_count"),
    registrations: r.count(raw, "", "registrations"),
    paid: r.count(raw, "", "paid"),
    attended: r.count(raw, "", "attended"),
    noShow: r.count(raw, "", "no_show"),
    planPool: r.count(raw, "", "plan_pool"),
    byCurrency: parseMoney(r, raw, ""),
    events,
  };
}

export function parseRevenueClubsSummary(raw: unknown): RevenueClubsSummaryDto {
  const r = reader(CLUBS_FN);
  if (!isBag(raw)) return r.fail("$", "oczekiwano obiektu");
  const apps = r.bag(raw, "", "applications");
  const applications: RevenueClubApplications = {
    submitted: r.count(apps, "applications.", "submitted"),
    accepted: r.count(apps, "applications.", "accepted"),
    rejected: r.count(apps, "applications.", "rejected"),
    pending: r.count(apps, "applications.", "pending"),
  };
  const clubs: RevenueClubSummaryRow[] = r.list(raw, "", "clubs").map((item, index) => {
    const at = `clubs[${index}].`;
    if (!isBag(item)) return r.fail(at, "oczekiwano obiektu");
    return {
      clubId: r.text(item, at, "club_id"),
      slug: r.text(item, at, "slug"),
      namePl: r.text(item, at, "name_pl"),
      nameEn: r.text(item, at, "name_en"),
      members: r.count(item, at, "members"),
      activeMembers: r.count(item, at, "active_members"),
      contributors: r.count(item, at, "contributors"),
      applicationsSubmitted: r.count(item, at, "applications_submitted"),
      applicationsAccepted: r.count(item, at, "applications_accepted"),
      applicationsRejected: r.count(item, at, "applications_rejected"),
    };
  });
  return {
    since: r.text(raw, "", "since"),
    until: r.text(raw, "", "until"),
    clubsEnabled: r.bool(raw, "", "clubs_enabled"),
    clubsCount: r.count(raw, "", "clubs_count"),
    members: r.count(raw, "", "members"),
    activeMembers: r.count(raw, "", "active_members"),
    contributors: r.count(raw, "", "contributors"),
    applications,
    decisionHoursMedian: r.nonNegativeOrNull(raw, "", "decision_hours_median"),
    clubs,
  };
}

/**
 * Udział `part` w `whole` (0..1) albo `null` bez mianownika. Frekwencja
 * i no-show liczone z przekroju: „0 z 0" to brak danych, nie 0 %.
 */
export function communityShare(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null;
  return Math.min(1, Math.max(0, part / whole));
}
