// JSONB Z FUNKCJI BAZY -> KSZTAŁTY Z `types.ts`, pole po polu.
//
// DLACZEGO NIE RZUTOWANIE. `Returns: Json` nie niesie żadnej informacji
// o kształcie, więc `data as TrafficReport` byłoby obietnicą bez pokrycia -
// dokładnie tą klasą długu, którą pilnują bramki `check:unknown-casts`
// i `check:db-row-casts`. Odczyt polem po polu kosztuje kilkadziesiąt linii raz
// i daje w zamian własność, której rzutowanie nie da: pulpit działa, gdy baza
// ma STARSZĄ wersję funkcji (brakujące pole schodzi do zera), i nie wywraca
// się, gdy ma NOWSZĄ (nadmiarowe pole jest ignorowane). Przy migracjach
// jednokierunkowych, wdrażanych osobno od aplikacji, to nie jest ostrożność
// teoretyczna - to normalny stan przez kilka minut każdego wdrożenia.
import type {
  AudienceReport,
  AudienceTotals,
  ContentReport,
  ContentTotalsWindow,
  CountryDatum,
  CrmReport,
  CrmTotals,
  MarketingReport,
  MarketingTotals,
  MoneyByCurrency,
  RealtimeReport,
  TrafficPoint,
  TrafficReport,
  TrafficTotals,
} from "./types";

type Bag = Record<string, unknown>;

function bag(value: unknown): Bag {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Bag) : {};
}

/**
 * Liczba z jsonb. Postgres oddaje `count(*)` jako `bigint`, a sterownik
 * zamienia bigint w JSON na LICZBĘ albo NAPIS zależnie od wielkości - więc
 * czytanie samego `typeof === "number"` gubiłoby duże liczniki po cichu.
 */
function num(source: Bag, key: string): number {
  const value = source[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function text(source: Bag, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

function list(value: unknown): Bag[] {
  return Array.isArray(value) ? value.map(bag) : [];
}

/** Kod kraju albo `null` - mapa nie ma jak narysować pustego klucza. */
function countryCode(source: Bag, key = "code"): string | null {
  const raw = text(source, key).trim().toUpperCase();
  return /^[A-Z]{2}$/.test(raw) ? raw : null;
}

/* ------------------------------------------------------------------- ruch */

function trafficTotals(value: unknown): TrafficTotals {
  const b = bag(value);
  return {
    pageViews: num(b, "pageViews"),
    events: num(b, "events"),
    sessions: num(b, "sessions"),
    visitors: num(b, "visitors"),
    members: num(b, "members"),
    countries: num(b, "countries"),
  };
}

function trafficPoint(b: Bag): TrafficPoint {
  return {
    bucket: text(b, "bucket"),
    pageViews: num(b, "page_views"),
    sessions: num(b, "sessions"),
    visitors: num(b, "visitors"),
  };
}

export function parseTrafficReport(value: unknown): TrafficReport {
  const b = bag(value);
  return {
    current: trafficTotals(b.current),
    previous: trafficTotals(b.previous),
    series: list(b.series).map(trafficPoint),
    countries: list(b.countries).reduce<CountryDatum[]>((out, row) => {
      const code = countryCode(row);
      if (code)
        out.push({ code, sessions: num(row, "sessions"), pageViews: num(row, "page_views") });
      return out;
    }, []),
    topPaths: list(b.topPaths).map((row) => ({
      path: text(row, "path"),
      views: num(row, "views"),
      sessions: num(row, "sessions"),
    })),
    topReferrers: list(b.topReferrers).map((row) => ({
      host: text(row, "host"),
      sessions: num(row, "sessions"),
    })),
    languages: list(b.languages).map((row) => ({
      lang: text(row, "lang"),
      sessions: num(row, "sessions"),
    })),
  };
}

/* -------------------------------------------------------------------- CRM */

function crmTotals(value: unknown): CrmTotals {
  const b = bag(value);
  return {
    newLeads: num(b, "newLeads"),
    won: num(b, "won"),
    lost: num(b, "lost"),
    hot: num(b, "hot"),
    consented: num(b, "consented"),
  };
}

export function parseCrmReport(value: unknown): CrmReport {
  const b = bag(value);
  const totals = bag(b.totals);
  return {
    current: crmTotals(b.current),
    previous: crmTotals(b.previous),
    stages: list(b.stages).map((row) => ({ stage: text(row, "stage"), leads: num(row, "leads") })),
    sources: list(b.sources).map((row) => ({
      source: text(row, "source"),
      leads: num(row, "leads"),
    })),
    countries: list(b.countries).reduce<{ code: string; leads: number }[]>((out, row) => {
      const code = countryCode(row);
      if (code) out.push({ code, leads: num(row, "leads") });
      return out;
    }, []),
    series: list(b.series).map((row) => ({
      bucket: text(row, "bucket"),
      leads: num(row, "leads"),
    })),
    totals: {
      leads: num(totals, "leads"),
      companies: num(totals, "companies"),
      tasksOpen: num(totals, "tasksOpen"),
      tasksOverdue: num(totals, "tasksOverdue"),
      tasksDone: num(totals, "tasksDone"),
    },
  };
}

/* -------------------------------------------------------------- marketing */

function money(value: unknown): MoneyByCurrency[] {
  return list(value).reduce<MoneyByCurrency[]>((out, row) => {
    const currency = text(row, "currency").trim().toUpperCase();
    // Wiersz bez waluty nie jest kwotą, tylko liczbą - i nie ma jak go wypisać
    // ani dodać do żadnej innej, więc odpada tu, a nie w widoku.
    if (/^[A-Z]{3}$/.test(currency)) {
      out.push({ currency, cents: num(row, "cents"), orders: num(row, "orders") });
    }
    return out;
  }, []);
}

function marketingTotals(value: unknown): MarketingTotals {
  const b = bag(value);
  return {
    subscribed: num(b, "subscribed"),
    unsubscribed: num(b, "unsubscribed"),
    sent: num(b, "sent"),
    opens: num(b, "opens"),
    clicks: num(b, "clicks"),
    popupViews: num(b, "popupViews"),
    popupConversions: num(b, "popupConversions"),
    adImpressions: num(b, "adImpressions"),
    adClicks: num(b, "adClicks"),
    orders: num(b, "orders"),
    leadForms: num(b, "leadForms"),
    revenue: money(b.revenue),
    donations: money(b.donations),
  };
}

export function parseMarketingReport(value: unknown): MarketingReport {
  const b = bag(value);
  const totals = bag(b.totals);
  return {
    current: marketingTotals(b.current),
    previous: marketingTotals(b.previous),
    series: list(b.series).map((row) => ({
      bucket: text(row, "bucket"),
      subscribed: num(row, "subscribed"),
    })),
    campaigns: list(b.campaigns).map((row) => ({
      name: text(row, "name"),
      sentCount: num(row, "sent_count"),
      failedCount: num(row, "failed_count"),
      recipientCount: num(row, "recipient_count"),
      finishedAt: text(row, "finished_at"),
      opens: num(row, "opens"),
      clicks: num(row, "clicks"),
    })),
    totals: { subscribers: num(totals, "subscribers"), pending: num(totals, "pending") },
  };
}

/* ------------------------------------------------------------- audytorium */

function audienceTotals(value: unknown): AudienceTotals {
  const b = bag(value);
  return {
    signups: num(b, "signups"),
    memberships: num(b, "memberships"),
    registrations: num(b, "registrations"),
    comments: num(b, "comments"),
  };
}

export function parseAudienceReport(value: unknown): AudienceReport {
  const b = bag(value);
  const totals = bag(b.totals);
  return {
    current: audienceTotals(b.current),
    previous: audienceTotals(b.previous),
    series: list(b.series).map((row) => ({
      bucket: text(row, "bucket"),
      signups: num(row, "signups"),
    })),
    tiers: list(b.tiers).map((row) => ({ tier: text(row, "tier"), members: num(row, "members") })),
    roles: list(b.roles).map((row) => ({ role: text(row, "role"), people: num(row, "people") })),
    totals: {
      users: num(totals, "users"),
      members: num(totals, "members"),
      subscriptions: num(totals, "subscriptions"),
      clubMembers: num(totals, "clubMembers"),
      pendingComments: num(totals, "pendingComments"),
    },
  };
}

/* ---------------------------------------------------------------- na żywo */

export function parseRealtimeReport(value: unknown): RealtimeReport {
  const b = bag(value);
  return {
    activeSessions: num(b, "activeSessions"),
    activeMembers: num(b, "activeMembers"),
    windowSessions: num(b, "windowSessions"),
    windowViews: num(b, "windowViews"),
    perMinute: list(b.perMinute).map((row) => ({
      bucket: text(row, "bucket"),
      sessions: num(row, "sessions"),
      pageViews: num(row, "page_views"),
    })),
    paths: list(b.paths).map((row) => ({
      path: text(row, "path"),
      sessions: num(row, "sessions"),
    })),
    countries: list(b.countries).reduce<{ code: string; sessions: number }[]>((out, row) => {
      const code = countryCode(row);
      if (code) out.push({ code, sessions: num(row, "sessions") });
      return out;
    }, []),
  };
}

/* ------------------------------------------------------------------ treść */

function contentWindow(value: unknown): ContentTotalsWindow {
  const b = bag(value);
  return {
    published: num(b, "published"),
    views: num(b, "views"),
    readers: num(b, "readers"),
  };
}

export function parseContentReport(value: unknown): ContentReport {
  const b = bag(value);
  const totals = bag(b.totals);
  return {
    current: contentWindow(b.current),
    previous: contentWindow(b.previous),
    topPosts: list(b.topPosts).map((row) => ({
      slug: text(row, "slug"),
      title: text(row, "title"),
      views: num(row, "views"),
      readers: num(row, "readers"),
    })),
    totals: {
      posts: num(totals, "posts"),
      published: num(totals, "published"),
      drafts: num(totals, "drafts"),
      scheduled: num(totals, "scheduled"),
    },
  };
}
