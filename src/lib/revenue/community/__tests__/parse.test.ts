// Parsery przekrojów społeczności (S4): kształt pole po polu, `null` ≠ 0,
// stałe `// rpc-shape` = klucze, które naprawdę buduje migracja, i znaczniki
// harnessów w plikach migracji (pg-harness wciąga migracje klubowe po treści).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMMUNITY_CLUBS_KEYS,
  COMMUNITY_EVENTS_KEYS,
  RevenueCommunityShapeError,
  communityShare,
  parseRevenueClubsSummary,
  parseRevenueEventsSummary,
} from "@/lib/revenue/community/parse";
import { REVENUE_CLUBS_KEYS, REVENUE_EVENTS_KEYS } from "@/lib/analytics/semantic/revenueRaw";

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
const AGGREGATES_SQL = readFileSync(
  join(MIGRATIONS, "20261020130700_revenue_community_aggregates.sql"),
  "utf8",
);

const EVENT_ROW = {
  event_id: "e1",
  slug: "kongres",
  title_pl: "Kongres",
  title_en: "Congress",
  starts_at: "2026-10-10T08:00:00+00:00",
  status: "published",
  registrations: 4,
  paid: 2,
  attended: 2,
  no_show: 2,
  plan_pool: 1,
  by_currency: [
    { currency: "EUR", ticket_revenue_net_minor: 10000 },
    { currency: "PLN", ticket_revenue_net_minor: 30000 },
  ],
};

const EVENTS_RAW = {
  since: "2026-09-19T00:00:00+00:00",
  until: "2026-10-20T00:00:00+00:00",
  money_visible: true,
  events_count: 1,
  registrations: 4,
  paid: 2,
  attended: 2,
  no_show: 2,
  plan_pool: 1,
  by_currency: EVENT_ROW.by_currency,
  events: [EVENT_ROW],
};

const CLUBS_RAW = {
  since: "2026-09-19T00:00:00+00:00",
  until: "2026-10-20T00:00:00+00:00",
  clubs_enabled: true,
  clubs_count: 2,
  members: 3,
  active_members: 2,
  contributors: 1,
  applications: { submitted: 4, accepted: 1, rejected: 1, pending: 2 },
  decision_hours_median: 18,
  clubs: [
    {
      club_id: "c1",
      slug: "energia",
      name_pl: "Energia",
      name_en: "Energy",
      members: 3,
      active_members: 2,
      contributors: 1,
      applications_submitted: 3,
      applications_accepted: 1,
      applications_rejected: 1,
    },
  ],
};

describe("parseRevenueEventsSummary", () => {
  it("mapuje cały kształt (admin z kwotami)", () => {
    const dto = parseRevenueEventsSummary(EVENTS_RAW);
    expect(dto).toMatchObject({
      moneyVisible: true,
      eventsCount: 1,
      registrations: 4,
      paid: 2,
      attended: 2,
      noShow: 2,
      planPool: 1,
      byCurrency: [
        { currency: "EUR", ticketRevenueNetMinor: 10000 },
        { currency: "PLN", ticketRevenueNetMinor: 30000 },
      ],
    });
    expect(dto.events[0]).toMatchObject({ eventId: "e1", titleEn: "Congress", noShow: 2 });
  });

  it("editor: kwoty null zostają null (brak danych, nie zero)", () => {
    const dto = parseRevenueEventsSummary({
      ...EVENTS_RAW,
      money_visible: false,
      by_currency: null,
      events: [{ ...EVENT_ROW, by_currency: null }],
    });
    expect(dto.byCurrency).toBeNull();
    expect(dto.events[0].byCurrency).toBeNull();
  });

  it("admin bez sprzedaży: pusta lista walut, nie null", () => {
    expect(parseRevenueEventsSummary({ ...EVENTS_RAW, by_currency: [] }).byCurrency).toEqual([]);
  });

  it("bigint jako napis cyfr jest przyjmowany", () => {
    expect(parseRevenueEventsSummary({ ...EVENTS_RAW, registrations: "4" }).registrations).toBe(4);
  });

  it("brak pola, ujemna liczba i powtórzona waluta są głośne", () => {
    const { paid: _paid, ...withoutPaid } = EVENTS_RAW;
    expect(() => parseRevenueEventsSummary(withoutPaid)).toThrow(RevenueCommunityShapeError);
    expect(() => parseRevenueEventsSummary({ ...EVENTS_RAW, attended: -1 })).toThrow(/attended/);
    expect(() =>
      parseRevenueEventsSummary({
        ...EVENTS_RAW,
        by_currency: [
          { currency: "PLN", ticket_revenue_net_minor: 1 },
          { currency: "PLN", ticket_revenue_net_minor: 2 },
        ],
      }),
    ).toThrow(/powtórzona waluta/);
    expect(() => parseRevenueEventsSummary(null)).toThrow(/admin_revenue_events_summary/);
  });
});

describe("parseRevenueClubsSummary", () => {
  it("mapuje cały kształt", () => {
    const dto = parseRevenueClubsSummary(CLUBS_RAW);
    expect(dto).toMatchObject({
      clubsEnabled: true,
      clubsCount: 2,
      members: 3,
      activeMembers: 2,
      contributors: 1,
      applications: { submitted: 4, accepted: 1, rejected: 1, pending: 2 },
      decisionHoursMedian: 18,
    });
    expect(dto.clubs[0]).toMatchObject({ slug: "energia", applicationsRejected: 1 });
  });

  it("mediana bez decyzji = null; ułamkowa mediana z numeric (napis) przyjęta", () => {
    expect(
      parseRevenueClubsSummary({ ...CLUBS_RAW, decision_hours_median: null }).decisionHoursMedian,
    ).toBeNull();
    expect(
      parseRevenueClubsSummary({ ...CLUBS_RAW, decision_hours_median: "18.50" })
        .decisionHoursMedian,
    ).toBe(18.5);
  });

  it("brak sekcji zgłoszeń jest głośny", () => {
    const { applications: _a, ...rest } = CLUBS_RAW;
    expect(() => parseRevenueClubsSummary(rest)).toThrow(/applications/);
  });
});

describe("communityShare", () => {
  it("0 z 0 to brak danych, nie 0 %", () => {
    expect(communityShare(0, 0)).toBeNull();
    expect(communityShare(1, 4)).toBe(0.25);
    expect(communityShare(5, 4)).toBe(1);
  });
});

describe("rpc-shape = klucze migracji 20261020130700", () => {
  it("komentarze rpc-shape przy stałych", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/revenue/community/parse.ts"), "utf8");
    expect(source).toMatch(
      /\/\/ rpc-shape: admin_revenue_events_summary\nexport const COMMUNITY_EVENTS_KEYS/,
    );
    expect(source).toMatch(
      /\/\/ rpc-shape: admin_revenue_clubs_summary\nexport const COMMUNITY_CLUBS_KEYS/,
    );
  });

  it("każdy klucz parsera jest budowany przez SQL (`'klucz', `)", () => {
    const keys = [
      ...Object.values(COMMUNITY_EVENTS_KEYS).flat(),
      ...Object.values(COMMUNITY_CLUBS_KEYS).flat(),
    ];
    for (const key of keys) expect(AGGREGATES_SQL, key).toContain(`'${key}', `);
  });

  it("kontrakt migawki S6 jest podzbiorem kształtu (REVENUE_EVENTS_KEYS / REVENUE_CLUBS_KEYS)", () => {
    const events = new Set<string>([...COMMUNITY_EVENTS_KEYS.root, ...COMMUNITY_EVENTS_KEYS.money]);
    for (const key of Object.values(REVENUE_EVENTS_KEYS).flat())
      expect(events.has(key), key).toBe(true);
    const clubs = new Set<string>([
      ...COMMUNITY_CLUBS_KEYS.root,
      ...COMMUNITY_CLUBS_KEYS.applications,
    ]);
    for (const key of Object.values(REVENUE_CLUBS_KEYS).flat())
      expect(clubs.has(key), key).toBe(true);
  });
});

describe("znaczniki harnessów w migracjach S4", () => {
  it("przekroje huba: `pg-harness: exclude` (czytają CRM i wydarzenia spoza atrapy klubów)", () => {
    expect(AGGREGATES_SQL).toMatch(/^--\s*pg-harness:\s*exclude\s*$/m);
  });

  it("migracja klubowa 20261020130500 jest wciągana przez pg-harness (bez wykluczenia)", () => {
    const sql = readFileSync(
      join(MIGRATIONS, "20261020130500_club_application_events.sql"),
      "utf8",
    );
    expect(sql).toMatch(/public\.(club_|admin_club_)/);
    expect(sql).not.toMatch(/^--\s*pg-harness:\s*exclude\s*$/m);
  });

  it("migracja obecności 20261020130600 ma `events-harness: include`", () => {
    const sql = readFileSync(
      join(MIGRATIONS, "20261020130600_event_attended_revenue_net.sql"),
      "utf8",
    );
    expect(sql).toMatch(/events-harness: include/);
  });

  it("pozostałe migracje S4 nie zawierają wyzwalaczy selektorów harnessów", () => {
    for (const file of [
      "20261020130000_crm_lifecycle_history.sql",
      "20261020130100_crm_user_id_profile_writer.sql",
      "20261020130200_workflow_actions_v2.sql",
      "20261020130300_workflow_engine_fixes.sql",
      "20261020130400_crm_dashboard_fixes.sql",
    ]) {
      const sql = readFileSync(join(MIGRATIONS, file), "utf8");
      expect(sql, file).not.toMatch(/public\.(club_|admin_club_)|discussion_clubs/);
      expect(sql, file).not.toMatch(
        /public\.admin_event_|events_tenant_id_key|events-harness: include|FUNCTION public\.event_[a-z_]+\(/,
      );
    }
  });
});
