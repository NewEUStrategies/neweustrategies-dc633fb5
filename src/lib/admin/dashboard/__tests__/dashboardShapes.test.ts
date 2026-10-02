// Uzupełnienie testów pulpitu o to, czego dotychczasowe pliki nie wykonywały:
//   * parsery w PEŁNYM kształcie (listy serii, krajów, kampanii, ścieżek) -
//     `parse.test.ts` sprawdza przeżycie złych danych, nie mapowanie pól;
//   * kwant „teraz", który trzyma stabilny klucz zapytania;
//   * klucze i18n zakładek okresu, formatowanie liczb i kwot, odwrót nazw krajów.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseAudienceReport,
  parseContentReport,
  parseCrmReport,
  parseMarketingReport,
  parseRealtimeReport,
  parseTrafficReport,
} from "../parse";
import { comparisonLabelKey, periodLabelKey, quantizeNow, rangeQuantumMs } from "../period";
import { formatCount, formatMoneyCents } from "../compare";
import { countryNamer } from "../labels";

describe("parsery pulpitu - pełny kształt", () => {
  it("ruch: serie, kraje (tylko ważne kody ISO), ścieżki, źródła i języki", () => {
    const r = parseTrafficReport({
      current: { pageViews: 10, events: 2, sessions: 4, visitors: 3, members: 1, countries: 2 },
      series: [{ bucket: "2026-06-01 00:00", page_views: "7", sessions: 3, visitors: 2 }],
      countries: [
        { code: "pl", sessions: 3, page_views: 9 },
        { code: "XYZ", sessions: 1 },
        { code: "", sessions: 1 },
        "śmieć",
      ],
      topPaths: [{ path: "/a", views: 5, sessions: 2 }],
      topReferrers: [{ host: "google.com", sessions: 2 }],
      languages: [{ lang: "pl", sessions: 3 }],
    });
    expect(r.current.pageViews).toBe(10);
    expect(r.series).toEqual([
      { bucket: "2026-06-01 00:00", pageViews: 7, sessions: 3, visitors: 2 },
    ]);
    expect(r.countries).toEqual([{ code: "PL", sessions: 3, pageViews: 9 }]);
    expect(r.topPaths).toEqual([{ path: "/a", views: 5, sessions: 2 }]);
    expect(r.topReferrers).toEqual([{ host: "google.com", sessions: 2 }]);
    expect(r.languages).toEqual([{ lang: "pl", sessions: 3 }]);
  });

  it("CRM: etapy, źródła, kraje, seria i sumy", () => {
    const r = parseCrmReport({
      current: { newLeads: 3, won: 1, lost: 0, hot: 2, consented: 3 },
      stages: [{ stage: "new", leads: 2 }],
      sources: [{ source: "form", leads: 2 }],
      countries: [
        { code: "de", leads: 1 },
        { code: "1A", leads: 9 },
      ],
      series: [{ bucket: "2026-06-01 00:00", leads: 2 }],
      totals: { leads: 40, companies: 5, tasksOpen: 3, tasksOverdue: 1, tasksDone: 7 },
    });
    expect(r.current).toEqual({ newLeads: 3, won: 1, lost: 0, hot: 2, consented: 3 });
    expect(r.stages).toEqual([{ stage: "new", leads: 2 }]);
    expect(r.sources).toEqual([{ source: "form", leads: 2 }]);
    expect(r.countries).toEqual([{ code: "DE", leads: 1 }]);
    expect(r.series).toEqual([{ bucket: "2026-06-01 00:00", leads: 2 }]);
    expect(r.totals).toEqual({
      leads: 40,
      companies: 5,
      tasksOpen: 3,
      tasksOverdue: 1,
      tasksDone: 7,
    });
  });

  it("marketing: seria zapisów, kampanie i kwoty TYLKO z poprawnym kodem waluty", () => {
    const r = parseMarketingReport({
      current: {
        revenue: [
          { currency: "pln", cents: "12300", orders: 2 },
          { currency: "", cents: 999 },
          { currency: "EURO", cents: 1 },
        ],
        donations: [{ currency: "EUR", cents: 500, orders: 1 }],
      },
      series: [{ bucket: "2026-06-01 00:00", subscribed: 4 }],
      campaigns: [
        {
          name: "Czerwiec",
          sent_count: 100,
          failed_count: 2,
          recipient_count: 102,
          finished_at: "2026-06-02T00:00:00Z",
          opens: 40,
          clicks: 9,
        },
      ],
      totals: { subscribers: 900, pending: 12 },
    });
    expect(r.current.revenue).toEqual([{ currency: "PLN", cents: 12300, orders: 2 }]);
    expect(r.current.donations).toEqual([{ currency: "EUR", cents: 500, orders: 1 }]);
    expect(r.series).toEqual([{ bucket: "2026-06-01 00:00", subscribed: 4 }]);
    expect(r.campaigns).toEqual([
      {
        name: "Czerwiec",
        sentCount: 100,
        failedCount: 2,
        recipientCount: 102,
        finishedAt: "2026-06-02T00:00:00Z",
        opens: 40,
        clicks: 9,
      },
    ]);
    expect(r.totals).toEqual({ subscribers: 900, pending: 12 });
  });

  it("audytorium: seria, warstwy, role i sumy", () => {
    const r = parseAudienceReport({
      series: [{ bucket: "2026-06-01 00:00", signups: 3 }],
      tiers: [{ tier: "pro", members: 5 }],
      roles: [{ role: "editor", people: 2 }],
      totals: { users: 100, members: 20, subscriptions: 15, clubMembers: 8, pendingComments: 4 },
    });
    expect(r.series).toEqual([{ bucket: "2026-06-01 00:00", signups: 3 }]);
    expect(r.tiers).toEqual([{ tier: "pro", members: 5 }]);
    expect(r.roles).toEqual([{ role: "editor", people: 2 }]);
    expect(r.totals).toEqual({
      users: 100,
      members: 20,
      subscriptions: 15,
      clubMembers: 8,
      pendingComments: 4,
    });
  });

  it("na żywo: minuty, ścieżki i kraje", () => {
    const r = parseRealtimeReport({
      activeSessions: 3,
      activeMembers: 1,
      windowSessions: 9,
      windowViews: 20,
      perMinute: [{ bucket: "12:01", sessions: 2, page_views: 4 }],
      paths: [{ path: "/", sessions: 2 }],
      countries: [
        { code: "PL", sessions: 2 },
        { code: "??", sessions: 1 },
      ],
    });
    expect(r).toEqual({
      activeSessions: 3,
      activeMembers: 1,
      windowSessions: 9,
      windowViews: 20,
      perMinute: [{ bucket: "12:01", sessions: 2, pageViews: 4 }],
      paths: [{ path: "/", sessions: 2 }],
      countries: [{ code: "PL", sessions: 2 }],
    });
  });

  it("treść: okna, najczęściej czytane i sumy", () => {
    const r = parseContentReport({
      current: { published: 2, views: 30, readers: 12 },
      previous: { published: 1 },
      topPosts: [{ slug: "a", title: "A", views: 10, readers: 4 }],
      totals: { posts: 50, published: 40, drafts: 8, scheduled: 2 },
    });
    expect(r.current).toEqual({ published: 2, views: 30, readers: 12 });
    expect(r.previous).toEqual({ published: 1, views: 0, readers: 0 });
    expect(r.topPosts).toEqual([{ slug: "a", title: "A", views: 10, readers: 4 }]);
    expect(r.totals).toEqual({ posts: 50, published: 40, drafts: 8, scheduled: 2 });
  });
});

describe("kwant „teraz” i klucze okresów", () => {
  it.each([
    ["realtime", 15_000],
    ["today", 60_000],
    ["week", 300_000],
    ["month", 300_000],
    ["prev-month", 900_000],
    ["quarter", 900_000],
    ["half-year", 900_000],
    ["year", 900_000],
  ] as const)("%s: kwant %i ms", (period, ms) => {
    expect(rangeQuantumMs(period)).toBe(ms);
  });

  it("dwa renderu w obrębie jednego kwantu dają TO SAMO „teraz” - klucz zapytania stoi", () => {
    const base = Date.UTC(2026, 5, 15, 12, 0, 0);
    expect(quantizeNow("today", base + 1_000)).toBe(quantizeNow("today", base + 59_000));
    expect(quantizeNow("today", base + 61_000)).toBe(base + 60_000);
    expect(quantizeNow("realtime", base + 14_999)).toBe(base);
  });

  it("klucze i18n zakładki i opisu odniesienia", () => {
    expect(periodLabelKey("month")).toBe("adminDashboard.period.month");
    expect(comparisonLabelKey("year")).toBe("adminDashboard.comparison.year");
  });
});

describe("formatowanie i nazwy krajów", () => {
  afterEach(() => vi.restoreAllMocks());

  it("licznik zaokrąglany do całości z separatorem tysięcy języka", () => {
    const norm = (value: string) => value.replace(/\s/g, " ");
    expect(norm(formatCount(12345.6, "pl"))).toBe("12 346");
    expect(formatCount(12345.4, "en")).toBe("12,345");
  });

  it("kwota w pełnych jednostkach; pusta waluta to PLN", () => {
    const norm = (value: string) => value.replace(/\s/g, " ");
    expect(norm(formatMoneyCents(123456, "EUR", "pl"))).toBe("1235 €");
    expect(norm(formatMoneyCents(123456, "", "en"))).toBe("PLN 1,235");
  });

  it("środowisko bez ICU: konstruktor rzuca - nazwa kraju wraca jako kod", () => {
    vi.spyOn(Intl, "DisplayNames").mockImplementation(() => {
      throw new RangeError("no ICU");
    });
    expect(countryNamer("pl")("DE")).toBe("DE");
  });

  it("kod, którego ICU nie umie nazwać, wraca jako kod", () => {
    const of = vi.fn(() => undefined);
    vi.spyOn(Intl, "DisplayNames").mockImplementation(
      () => ({ of }) as unknown as Intl.DisplayNames,
    );
    expect(countryNamer("en")("QQ")).toBe("QQ");
  });
});
