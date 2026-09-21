// KSZTAŁTY ODCZYTÓW PULPITU - jedno miejsce dla umowy między SQL-em a widokiem.
//
// Funkcje bazy zwracają `jsonb`, więc TypeScript nie zna ich kształtu i NIE MA
// jak go sprawdzić: `Returns: Json` w wygenerowanych typach znaczy dokładnie
// "cokolwiek". Te interfejsy są drugą połową umowy, a `parse.ts` jest miejscem,
// w którym jsonb do nich dochodzi - polem po polu, z wartością domyślną przy
// każdym. Dlatego pulpit nie ma ani jednego rzutowania wiersza i przeżyje
// zarówno starszą wersję funkcji w bazie, jak i pole, które dopiero dojdzie.

export interface TrafficTotals {
  pageViews: number;
  events: number;
  sessions: number;
  visitors: number;
  /** Sesje zalogowanych - ilu z ruchu to nasi ludzie, a nie przechodnie. */
  members: number;
  countries: number;
}

export interface TrafficPoint {
  bucket: string;
  pageViews: number;
  sessions: number;
  visitors: number;
}

export interface CountryDatum {
  /** ISO 3166-1 alpha-2, wielkimi literami - klucz mapy choropletowej. */
  code: string;
  sessions: number;
  pageViews: number;
}

export interface PathDatum {
  path: string;
  views: number;
  sessions: number;
}

export interface ReferrerDatum {
  host: string;
  sessions: number;
}

export interface LangDatum {
  lang: string;
  sessions: number;
}

export interface TrafficReport {
  current: TrafficTotals;
  previous: TrafficTotals;
  series: TrafficPoint[];
  countries: CountryDatum[];
  topPaths: PathDatum[];
  topReferrers: ReferrerDatum[];
  languages: LangDatum[];
}

export interface CrmTotals {
  newLeads: number;
  won: number;
  lost: number;
  hot: number;
  consented: number;
}

export interface CrmReport {
  current: CrmTotals;
  previous: CrmTotals;
  /** Stan lejka NA TERAZ - tabela leadów nie trzyma historii etapów. */
  stages: { stage: string; leads: number }[];
  sources: { source: string; leads: number }[];
  countries: { code: string; leads: number }[];
  series: { bucket: string; leads: number }[];
  totals: {
    leads: number;
    companies: number;
    tasksOpen: number;
    tasksOverdue: number;
    tasksDone: number;
  };
}

export interface MarketingTotals {
  subscribed: number;
  unsubscribed: number;
  sent: number;
  opens: number;
  clicks: number;
  popupViews: number;
  popupConversions: number;
  adImpressions: number;
  adClicks: number;
  orders: number;
  leadForms: number;
  /**
   * Pieniądze ROZBITE PO WALUCIE. Jedna liczba byłaby tu fałszem: zamówienia
   * niosą własną walutę, więc suma po całej tabeli dodaje złotówki do euro.
   * Lista jest posortowana malejąco, czyli pozycja zerowa to waluta wiodąca.
   */
  revenue: MoneyByCurrency[];
  donations: MoneyByCurrency[];
}

export interface MoneyByCurrency {
  /** ISO 4217, wielkimi literami. */
  currency: string;
  cents: number;
  orders: number;
}

export interface MarketingReport {
  current: MarketingTotals;
  previous: MarketingTotals;
  series: { bucket: string; subscribed: number }[];
  campaigns: {
    name: string;
    sentCount: number;
    failedCount: number;
    recipientCount: number;
    finishedAt: string;
    opens: number;
    clicks: number;
  }[];
  totals: { subscribers: number; pending: number };
}

export interface AudienceTotals {
  signups: number;
  memberships: number;
  registrations: number;
  comments: number;
}

export interface AudienceReport {
  current: AudienceTotals;
  previous: AudienceTotals;
  series: { bucket: string; signups: number }[];
  tiers: { tier: string; members: number }[];
  roles: { role: string; people: number }[];
  totals: {
    users: number;
    members: number;
    subscriptions: number;
    clubMembers: number;
    pendingComments: number;
  };
}

export interface RealtimeReport {
  /** Sesje widziane w ostatnich `REALTIME_ACTIVE_MINUTES` minutach. */
  activeSessions: number;
  activeMembers: number;
  windowSessions: number;
  windowViews: number;
  perMinute: { bucket: string; sessions: number; pageViews: number }[];
  paths: { path: string; sessions: number }[];
  countries: { code: string; sessions: number }[];
}

export interface ContentTotalsWindow {
  published: number;
  views: number;
  readers: number;
}

export interface ContentReport {
  current: ContentTotalsWindow;
  previous: ContentTotalsWindow;
  topPosts: { slug: string; title: string; views: number; readers: number }[];
  totals: { posts: number; published: number; drafts: number; scheduled: number };
}
