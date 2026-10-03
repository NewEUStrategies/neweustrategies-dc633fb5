// PANELE KOKPITU - render z danymi, stan pusty i oba języki.
//
// CO DOWODZI TEN PLIK. Do tej zmiany z czternastu plików `admin/dashboard`
// renderował się w testach JEDEN (`DashboardSection`); pozostałe trzynaście
// stało na zerze funkcji. A to one niosą arytmetykę, którą operator czyta jako
// decyzję: deltę wobec okresu odniesienia, walutę wiodącą przychodu, kolejność
// lejka i mianownik każdego wskaźnika. Asercje idą więc NA WARTOŚĆ (napis,
// który zobaczy człowiek), a nie na obecność węzła.
//
// JĘZYK: PRAWDZIWY SŁOWNIK. Atrapa `react-i18next` podaje surowy kod języka,
// a `t` bierze z `@/test/i18nReal`, czyli z tej samej instancji i18next, której
// używa aplikacja - usunięcie klucza ze słownika oblewa ten plik. Fabryka
// `vi.mock` nic nie importuje (import `@/lib/i18n` z jej wnętrza zakleszcza
// plik - patrz `ReputationLevelChip.test.tsx`).
//
// ATRAPY: `ChartCard` i `ChoroplethMap`. Silnik wykresów i map ma własne
// testy; tutaj liczy się, CO panel do niego przekazuje - kategorie osi,
// serie i nagłówki eksportu CSV - więc atrapy zapisują swoje propsy.
//
// NAPRAWY PRZYPIĘTE TU ASERCJAMI:
//   * kolumna czasu w eksporcie CSV wszystkich pięciu szeregów dziedziczyła
//     nagłówek po sąsiedniej tabeli („Ścieżka", „Etap", „Poziom",
//     „Zakończona", tytuł wykresu) - arkusz podpisywał daty jako adresy stron;
//   * wskaźniki i udziały były sklejane `toFixed` + „%", więc polski pulpit
//     mieszał „42.0%" i „2.5" z „12 345".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ChartCardProps } from "@/components/admin/analytics/ChartCard";
import type { DataMapConfig } from "@/lib/charts/types";

const h = vi.hoisted(() => ({
  language: "pl",
  fixedT: null as null | typeof realT,
  charts: [] as ChartCardProps[],
  maps: [] as { config: DataMapConfig; lang: string }[],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: h.fixedT?.(h.language.startsWith("en") ? "en" : "pl"),
    i18n: { language: h.language },
    ready: true,
  }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, className, children }: { to: string; className?: string; children: unknown }) => (
    <a href={to} className={className}>
      {children as never}
    </a>
  ),
}));

vi.mock("@/components/admin/analytics/ChartCard", () => ({
  ChartCard: (props: ChartCardProps) => {
    h.charts.push(props);
    return <figure aria-label={props.title} data-testid="chart-card" />;
  },
}));

vi.mock("@/components/charts/ChoroplethMap", () => ({
  ChoroplethMap: (props: { config: DataMapConfig; lang: string }) => {
    h.maps.push(props);
    return <div data-testid="choropleth" />;
  },
}));

import { realT } from "@/test/i18nReal";
import { resolveDashboardRange } from "@/lib/admin/dashboard/period";
import { computeDelta } from "@/lib/admin/dashboard/compare";
import {
  parseAudienceReport,
  parseContentReport,
  parseCrmReport,
  parseMarketingReport,
  parseRealtimeReport,
  parseTrafficReport,
} from "@/lib/admin/dashboard/parse";
import type {
  AudienceReport,
  ContentReport,
  CrmReport,
  MarketingReport,
  RealtimeReport,
  TrafficReport,
} from "@/lib/admin/dashboard/types";
import { TrafficPanel } from "../TrafficPanel";
import { CrmPanel } from "../CrmPanel";
import { MarketingPanel } from "../MarketingPanel";
import { AudiencePanel } from "../AudiencePanel";
import { ContentPanel } from "../ContentPanel";
import { RealtimeStrip } from "../RealtimeStrip";
import { GeoPanel } from "../GeoPanel";
import { RankedList } from "../RankedList";
import { StatTile } from "../StatTile";
import { DeltaBadge } from "../DeltaBadge";
import { DashboardPeriodTabs } from "../DashboardPeriodTabs";

h.fixedT = realT;

const NBSP = " ";
// Środek marca, poza zmianą czasu - podpis zakresu nie zależy wtedy od strefy.
const RANGE = resolveDashboardRange("month", new Date(2026, 2, 15, 12).getTime());

beforeEach(() => {
  h.language = "pl";
  h.charts.length = 0;
  h.maps.length = 0;
});

afterEach(cleanup);

/** Kafelek po etykiecie - zwraca jego tekst w całości (wartość, delta, podpowiedź). */
function tile(label: string): HTMLElement {
  const labelNode = screen.getByText(label, { selector: "span" });
  const shell = labelNode.closest(".rounded-xl");
  if (!(shell instanceof HTMLElement)) throw new Error(`Brak kafelka "${label}"`);
  return shell;
}

function chart(title: string): ChartCardProps {
  const found = h.charts.filter((c) => c.title === title).at(-1);
  if (!found) throw new Error(`Brak wykresu "${title}"`);
  return found;
}

/* ------------------------------------------------------------------ ruch */

function trafficReport(over: Partial<TrafficReport> = {}): TrafficReport {
  const base = parseTrafficReport(null);
  return {
    ...base,
    current: {
      ...base.current,
      sessions: 12345,
      pageViews: 30864,
      visitors: 9000,
      members: 120,
      events: 40000,
    },
    previous: { ...base.previous, sessions: 10000, pageViews: 20000, visitors: 9000, members: 0 },
    series: [
      { bucket: "2026-03-01 00:00", sessions: 400, pageViews: 900, visitors: 300 },
      { bucket: "2026-03-02 00:00", sessions: 500, pageViews: 1100, visitors: 350 },
    ],
    topPaths: [
      { path: "/blog/a", views: 3000, sessions: 2000 },
      { path: "/blog/b", views: 1000, sessions: 800 },
    ],
    topReferrers: [],
    languages: [
      { lang: "pl", sessions: 11000 },
      { lang: "en", sessions: 500 },
    ],
    ...over,
  };
}

describe("TrafficPanel", () => {
  it("kafelki niosą wartość w formacie lokalnym i deltę wobec okresu odniesienia", () => {
    render(<TrafficPanel report={trafficReport()} range={RANGE} />);

    expect(tile("Sesje").textContent).toContain(`12${NBSP}345`);
    // 12 345 wobec 10 000 = +23%.
    expect(tile("Sesje").textContent).toContain("+23%");
    // Bez zmiany - odznaka „0%" z tonem płaskim, nie brak odznaki.
    expect(tile("Unikalni odwiedzający").textContent).toContain("9000");
    // Poprzednio zero zalogowanych: procent nie istnieje, odznaka mówi to wprost.
    expect(tile("Sesje zalogowanych").textContent).toContain("brak odniesienia");
  });

  it("odsłony na sesję idą przez locale - „2,5”, a nie „2.5”", () => {
    render(<TrafficPanel report={trafficReport()} range={RANGE} />);
    const perSession = tile("Odsłon na sesję");
    expect(perSession.textContent).toContain("2,5");
    expect(perSession.textContent).not.toContain("2.5");
  });

  it("bez sesji wskaźnik pochodny to kreska bez odznaki, nie zero", () => {
    const base = parseTrafficReport(null);
    render(<TrafficPanel report={{ ...base }} range={RANGE} />);
    const perSession = tile("Odsłon na sesję");
    expect(perSession.querySelector(".tabular-nums")?.textContent).toBe("-");
    expect(perSession.textContent).not.toContain("brak odniesienia");
  });

  it("wykres dostaje kubełki dzienne, dwie serie i eksport z kolumną czasu", () => {
    render(<TrafficPanel report={trafficReport()} range={RANGE} />);
    const card = chart("Ruch w czasie");
    expect(card.height).toBe(240);
    expect(card.csv?.headers).toEqual(["Początek przedziału", "Sesje", "Odsłony"]);
    expect(card.csv?.rows).toEqual([
      ["2026-03-01 00:00", 400, 900],
      ["2026-03-02 00:00", 500, 1100],
    ]);
    expect(JSON.stringify(card.config)).toContain("03-01");
  });

  it("puste źródła to wejścia bezpośrednie, a udział języka liczy się od sesji", () => {
    render(<TrafficPanel report={trafficReport()} range={RANGE} />);
    expect(screen.getByText("wejścia bezpośrednie")).toBeTruthy();
    const languages = screen.getByText("Język przeglądarki").closest("div");
    if (!(languages instanceof HTMLElement)) throw new Error("Brak karty języków");
    // 500 z 12 345 = 4,05% -> poniżej 10% z jedną cyfrą po przecinku.
    expect(within(languages).getByText("4,1%")).toBeTruthy();
    expect(within(languages).getByText("89%")).toBeTruthy();
  });

  it("źródła wejść są listą hostów z liczbą sesji", () => {
    render(
      <TrafficPanel
        report={trafficReport({ topReferrers: [{ host: "news.example.com", sessions: 321 }] })}
        range={RANGE}
      />,
    );
    const referrers = screen.getByText("Skąd przychodzą").closest("div");
    if (!(referrers instanceof HTMLElement)) throw new Error("Brak karty źródeł");
    expect(within(referrers).getByText("news.example.com")).toBeTruthy();
    expect(within(referrers).getByText("321")).toBeTruthy();
    expect(screen.queryByText("wejścia bezpośrednie")).toBeNull();
  });

  it("po angielsku: etykiety, kropka dziesiętna i nagłówek eksportu", () => {
    h.language = "en";
    render(<TrafficPanel report={trafficReport()} range={RANGE} />);
    expect(tile("Sessions").textContent).toContain("12,345");
    expect(tile("Views per session").textContent).toContain("2.5");
    expect(chart("Traffic over time").csv?.headers[0]).toBe("Interval start");
  });
});

/* ------------------------------------------------------------------- CRM */

function crmReport(over: Partial<CrmReport> = {}): CrmReport {
  const base = parseCrmReport(null);
  return {
    ...base,
    current: { ...base.current, newLeads: 40, won: 5, hot: 8 },
    previous: { ...base.previous, newLeads: 20, won: 5, hot: 10 },
    // Kolejność wejścia CELOWO pomieszana - lejek ma ją zignorować.
    stages: [
      { stage: "won", leads: 5 },
      { stage: "frozen", leads: 2 },
      { stage: "new", leads: 30 },
    ],
    sources: [
      { source: "newsletter", leads: 25 },
      { source: "partner_api", leads: 15 },
    ],
    series: [{ bucket: "2026-03-01 00:00", leads: 4 }],
    totals: { leads: 300, companies: 45, tasksOpen: 12, tasksOverdue: 3, tasksDone: 9 },
    ...over,
  };
}

describe("CrmPanel", () => {
  it("lejek idzie w kolejności etapów, a etap nieznany frontowi ląduje na końcu pod kluczem", () => {
    render(<CrmPanel report={crmReport()} range={RANGE} />);
    const funnel = chart("Lejek - stan na teraz");
    const stages = funnel.csv?.rows.map((row) => row[0]);
    expect(stages).toEqual([
      "Nowy",
      "Kontakt nawiązany",
      "Zakwalifikowany",
      "Oferta",
      "Wygrany",
      "Przegrany",
      "Archiwum",
      "frozen",
    ]);
    expect(funnel.csv?.rows.map((row) => row[1])).toEqual([30, 0, 0, 0, 5, 0, 0, 2]);
  });

  it("szereg nowych kontaktów eksportuje kolumnę czasu, nie „Etap”", () => {
    render(<CrmPanel report={crmReport()} range={RANGE} />);
    expect(chart("Nowe kontakty w czasie").csv?.headers).toEqual([
      "Początek przedziału",
      "Nowe kontakty",
    ]);
  });

  it("kafelki: delta przepływu, mianownik stanu i odnośnik do CRM", () => {
    render(<CrmPanel report={crmReport()} range={RANGE} />);
    expect(tile("Nowe kontakty").textContent).toContain("+100%");
    expect(tile("Nowe kontakty").getAttribute("href")).toBe("/admin/crm");
    expect(tile("Gorące").textContent).toContain("-20%");
    expect(tile("Kontakty łącznie").textContent).toContain("45 firmy");
    // Zadania po terminie to STAN - mianownik zamiast odznaki zmiany.
    expect(tile("Zadania po terminie").textContent).toContain("z 12 otwartych");
    expect(tile("Zadania po terminie").textContent).not.toContain("brak odniesienia");
  });

  it("źródło bez tłumaczenia pokazuje surowy klucz zamiast pustego wiersza", () => {
    render(<CrmPanel report={crmReport()} range={RANGE} />);
    expect(screen.getByText("Newsletter")).toBeTruthy();
    expect(screen.getByText("partner_api")).toBeTruthy();
  });
});

/* ------------------------------------------------------------- marketing */

function marketingReport(over: Partial<MarketingReport> = {}): MarketingReport {
  const base = parseMarketingReport(null);
  return {
    ...base,
    current: {
      ...base.current,
      subscribed: 50,
      unsubscribed: 10,
      sent: 1000,
      opens: 420,
      clicks: 35,
      popupViews: 0,
      adImpressions: 2000,
      adClicks: 40,
      orders: 7,
      revenue: [
        { currency: "PLN", cents: 1_234_567, orders: 6 },
        { currency: "EUR", cents: 10_000, orders: 1 },
      ],
      donations: [{ currency: "EUR", cents: 50_000, orders: 2 }],
    },
    previous: {
      ...base.previous,
      subscribed: 40,
      unsubscribed: 5,
      sent: 1000,
      opens: 300,
      adImpressions: 1000,
      adClicks: 20,
      revenue: [
        { currency: "EUR", cents: 999_999, orders: 9 },
        { currency: "PLN", cents: 1_000_000, orders: 5 },
      ],
      donations: [],
    },
    series: [{ bucket: "2026-03-01 00:00", subscribed: 5 }],
    campaigns: [
      {
        name: "Marzec",
        sentCount: 1000,
        failedCount: 0,
        recipientCount: 1000,
        finishedAt: "2026-03-03",
        opens: 420,
        clicks: 35,
      },
      {
        name: "Pusta",
        sentCount: 0,
        failedCount: 0,
        recipientCount: 0,
        finishedAt: "2026-03-04",
        opens: 0,
        clicks: 0,
      },
    ],
    totals: { subscribers: 1500, pending: 3 },
    ...over,
  };
}

describe("MarketingPanel", () => {
  it("przychód w walucie wiodącej, delta w TEJ SAMEJ walucie, reszta walut policzona", () => {
    render(<MarketingPanel report={marketingReport()} range={RANGE} />);
    const revenue = tile("Przychód");
    expect(revenue.textContent).toContain(`12${NBSP}346${NBSP}zł`);
    // 12 345,67 zł wobec 10 000 zł (a NIE wobec wiodącego wtedy euro) = +23%.
    expect(revenue.textContent).toContain("+23%");
    expect(revenue.textContent).toContain("7 opłacone zamówienia");
    expect(revenue.textContent).toContain("+ 1 inne waluty");
    expect(revenue.getAttribute("href")).toBe("/admin/monetization");
  });

  it("darowizny mają własną walutę i bez odniesienia nie wymyślają procentu", () => {
    render(<MarketingPanel report={marketingReport()} range={RANGE} />);
    const donations = tile("Darowizny");
    expect(donations.textContent).toContain(`500${NBSP}€`);
    expect(donations.textContent).toContain("brak odniesienia");
  });

  it("darowizny porównują się z odniesieniem w swojej walucie, nie w walucie przychodu", () => {
    const base = marketingReport();
    render(
      <MarketingPanel
        report={{
          ...base,
          previous: {
            ...base.previous,
            donations: [
              { currency: "PLN", cents: 900_000, orders: 9 },
              { currency: "EUR", cents: 25_000, orders: 1 },
            ],
          },
        }}
        range={RANGE}
      />,
    );
    // 500 € wobec 250 € (a nie wobec 9000 zł) = +100%.
    expect(tile("Darowizny").textContent).toContain("+100%");
  });

  it("pusty okres wypisuje zero w walucie odniesienia, bez odznaki", () => {
    const base = marketingReport();
    render(
      <MarketingPanel
        report={{ ...base, current: { ...base.current, revenue: [], donations: [] } }}
        range={RANGE}
      />,
    );
    const revenue = tile("Przychód");
    expect(revenue.textContent).toContain(`0${NBSP}€`);
    expect(revenue.querySelector("svg.lucide-arrow-up-right")).toBeNull();
    expect(revenue.textContent).not.toContain("inne waluty");
  });

  it("bez żadnej płatności w obu okresach jednostką zera jest PLN", () => {
    const base = marketingReport();
    render(
      <MarketingPanel
        report={{
          ...base,
          current: { ...base.current, revenue: [], donations: [] },
          previous: { ...base.previous, revenue: [], donations: [] },
        }}
        range={RANGE}
      />,
    );
    expect(tile("Przychód").textContent).toContain(`0${NBSP}zł`);
    expect(tile("Darowizny").textContent).toContain(`0${NBSP}zł`);
  });

  it("wskaźniki z mianownikiem: procent po polsku, kreska przy pustym mianowniku", () => {
    render(<MarketingPanel report={marketingReport()} range={RANGE} />);
    expect(tile("Wskaźnik otwarć").textContent).toContain("42,0%");
    expect(tile("Wskaźnik otwarć").textContent).toContain("z 1000 wysłanych");
    // 42% wobec 30% = +40%.
    expect(tile("Wskaźnik otwarć").textContent).toContain("+40%");
    // Zero wyświetleń pop-upów: nie ma czego konwertować - kreska, nie „0%".
    const popup = tile("Konwersja pop-upów");
    expect(popup.querySelector(".tabular-nums")?.textContent).toBe("-");
    expect(popup.textContent).toContain("z 0 wyświetleń");
    // Poprzednio zero kliknięć przy 1000 wysyłek - procent odniesienia istnieje (0%).
    expect(tile("Wskaźnik kliknięć").textContent).toContain("3,5%");
    expect(tile("CTR reklam").textContent).toContain("2,0%");
  });

  it("wzrost wypisań jest złą wiadomością mimo strzałki w górę", () => {
    render(<MarketingPanel report={marketingReport()} range={RANGE} />);
    const unsub = tile("Wypisania");
    expect(unsub.textContent).toContain("+100%");
    expect(unsub.querySelector("[class*='--chart-negative-text']")).not.toBeNull();
    // Po polsku tysiące grupuje się dopiero od pięciu cyfr (`minimumGroupingDigits`).
    expect(tile("Przyrost netto").textContent).toContain("1500 subskrybenci");
  });

  it("tabela kampanii: procent otwarć po polsku, a kampania bez wysyłki bez procentu", () => {
    render(<MarketingPanel report={marketingReport()} range={RANGE} />);
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows[1]?.textContent).toContain("420 (42%)");
    expect(rows[2]?.textContent).not.toContain("%");
    expect(chart("Zapisy do newslettera w czasie").csv?.headers).toEqual([
      "Początek przedziału",
      "Nowe zapisy",
    ]);
  });

  it("bez kampanii w okresie tabela nie powstaje", () => {
    render(<MarketingPanel report={marketingReport({ campaigns: [] })} range={RANGE} />);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("po angielsku wskaźnik ma kropkę dziesiętną", () => {
    h.language = "en";
    render(<MarketingPanel report={marketingReport()} range={RANGE} />);
    expect(tile("Open rate").textContent).toContain("42.0%");
  });
});

/* ------------------------------------------------------------ użytkownicy */

function audienceReport(over: Partial<AudienceReport> = {}): AudienceReport {
  const base = parseAudienceReport(null);
  return {
    ...base,
    current: { ...base.current, signups: 30, registrations: 4, comments: 12 },
    previous: { ...base.previous, signups: 20, registrations: 4, comments: 0 },
    series: [{ bucket: "2026-03-01 00:00", signups: 3 }],
    tiers: [{ tier: "gold", members: 10 }],
    roles: [
      { role: "editor", people: 3 },
      { role: "moderator_x", people: 1 },
    ],
    totals: { users: 2000, members: 40, subscriptions: 25, clubMembers: 7, pendingComments: 6 },
    ...over,
  };
}

describe("AudiencePanel", () => {
  it("stan bez odznaki, przepływ z odznaką, moderacja w podpowiedzi", () => {
    render(<AudiencePanel report={audienceReport()} range={RANGE} />);
    expect(tile("Użytkownicy").textContent).toBe("Użytkownicy2000");
    expect(tile("Użytkownicy").getAttribute("href")).toBe("/admin/users");
    expect(tile("Nowe konta").textContent).toContain("+50%");
    expect(tile("Komentarze").textContent).toContain("6 komentarze do moderacji");
  });

  it("bez komentarzy w kolejce podpowiedź znika", () => {
    const report = audienceReport();
    render(
      <AudiencePanel
        report={{ ...report, totals: { ...report.totals, pendingComments: 0 } }}
        range={RANGE}
      />,
    );
    expect(tile("Komentarze").textContent).not.toContain("moderacji");
  });

  it("rola bez tłumaczenia zostaje pod kluczem, a eksport ma kolumnę czasu", () => {
    render(<AudiencePanel report={audienceReport()} range={RANGE} />);
    expect(screen.getByText("Redaktor")).toBeTruthy();
    expect(screen.getByText("moderator_x")).toBeTruthy();
    expect(screen.getByText("gold")).toBeTruthy();
    expect(chart("Nowe konta w czasie").csv?.headers).toEqual([
      "Początek przedziału",
      "Nowe konta",
    ]);
  });
});

/* ------------------------------------------------------------------ treść */

function contentReport(over: Partial<ContentReport> = {}): ContentReport {
  const base = parseContentReport(null);
  return {
    ...base,
    current: { published: 4, views: 1000, readers: 600 },
    previous: { published: 2, views: 800, readers: 600 },
    topPosts: [{ slug: "a", title: "Wpis A", views: 250, readers: 200 }],
    totals: { posts: 120, published: 100, drafts: 15, scheduled: 2 },
    ...over,
  };
}

describe("ContentPanel", () => {
  it("liczniki treści z deltą, mianownikiem i zaplanowanymi", () => {
    render(<ContentPanel report={contentReport()} />);
    expect(tile("Odsłony wpisów").textContent).toContain("+25%");
    expect(tile("Wpisy łącznie").textContent).toContain("100 opublikowane");
    expect(tile("Szkice").textContent).toContain("2 zaplanowane");
    expect(screen.getByText("Wpis A")).toBeTruthy();
    // 250 z 1000 odsłon = 25%.
    expect(screen.getByText("25%")).toBeTruthy();
  });

  it("bez zaplanowanych szkice nie mają podpowiedzi", () => {
    const report = contentReport();
    render(<ContentPanel report={{ ...report, totals: { ...report.totals, scheduled: 0 } }} />);
    expect(tile("Szkice").textContent).toBe("Szkice15");
  });
});

/* -------------------------------------------------------------- na żywo */

function realtimeReport(over: Partial<RealtimeReport> = {}): RealtimeReport {
  return {
    ...parseRealtimeReport(null),
    activeSessions: 7,
    activeMembers: 2,
    windowSessions: 40,
    windowViews: 90,
    perMinute: [{ bucket: "2026-03-15 12:01", sessions: 3, pageViews: 5 }],
    paths: [{ path: "/teraz", sessions: 4 }],
    countries: [{ code: "PL", sessions: 6 }],
    ...over,
  };
}

describe("RealtimeStrip", () => {
  it("ktoś jest: liczba, pulsująca kropka i brak komunikatu „nikogo”", () => {
    const { container } = render(<RealtimeStrip report={realtimeReport()} />);
    expect(screen.getByText("7")).toBeTruthy();
    expect(container.querySelector("[class*='animate-[ping']")).not.toBeNull();
    expect(screen.queryByText("Nikogo nie ma na stronie.")).toBeNull();
    // Zwinięty pasek nie rysuje wykresu minutowego.
    expect(h.charts).toHaveLength(0);
  });

  it("nikogo nie ma: kropka nie pulsuje, a pasek mówi, że pomiar żyje", () => {
    const { container } = render(<RealtimeStrip report={realtimeReport({ activeSessions: 0 })} />);
    expect(container.querySelector("[class*='animate-[ping']")).toBeNull();
    expect(screen.getByText("Nikogo nie ma na stronie.")).toBeTruthy();
  });

  it("rozwinięty: wykres minutowy z kolumną czasu w eksporcie i listy na żywo", () => {
    render(<RealtimeStrip report={realtimeReport()} expanded />);
    const card = chart("Ruch minuta po minucie");
    expect(card.csv?.headers).toEqual(["Początek przedziału", "Sesje", "Odsłony"]);
    expect(card.csv?.rows).toEqual([["2026-03-15 12:01", 3, 5]]);
    expect(JSON.stringify(card.config)).toContain("12:01");
    expect(screen.getByText("/teraz")).toBeTruthy();
    expect(screen.getByText("Polska")).toBeTruthy();
  });

  it("po angielsku nazwa kraju idzie za językiem panelu", () => {
    h.language = "en";
    render(<RealtimeStrip report={realtimeReport()} expanded />);
    expect(screen.getByText("Poland")).toBeTruthy();
    expect(chart("Traffic minute by minute").csv?.headers[0]).toBe("Interval start");
  });
});

/* ------------------------------------------------------------------ mapa */

describe("GeoPanel", () => {
  const traffic = [
    { code: "PL", sessions: 30 },
    { code: "US", sessions: 10 },
  ];
  const leads = [{ code: "DE", leads: 5 }];

  it("startuje od ŚWIATA i ruchu, z jednostką sesji", () => {
    render(<GeoPanel traffic={traffic} leads={leads} />);
    const map = h.maps.at(-1);
    expect(map?.config.region).toBe("world");
    expect(map?.config.unit).toBe(" sesji");
    expect(map?.config.values).toEqual([
      { id: "PL", value: 30 },
      { id: "US", value: 10 },
    ]);
    expect(screen.getByRole("button", { name: "Świat" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/Krajów w pomiarze/).textContent).toContain("2");
    expect(screen.getByText("75%")).toBeTruthy();
  });

  it("przełącznik źródła podmienia dane, jednostkę i nagłówek kolumny", () => {
    render(<GeoPanel traffic={traffic} leads={leads} />);
    fireEvent.click(screen.getByRole("button", { name: "Kontakty CRM" }));
    const map = h.maps.at(-1);
    expect(map?.config.unit).toBe(" kontaktów");
    expect(map?.config.values).toEqual([{ id: "DE", value: 5 }]);
    expect(screen.getByText("Niemcy")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Kontakty" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Kontakty CRM" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("przełącznik regionu przestawia mapę na Europę", () => {
    render(<GeoPanel traffic={traffic} leads={leads} />);
    fireEvent.click(screen.getByRole("button", { name: "Europa" }));
    expect(h.maps.at(-1)?.config.region).toBe("europe");
  });

  it("bez danych mówi, dlaczego - zamiast pustej mapy", () => {
    render(<GeoPanel traffic={[]} leads={[]} />);
    expect(screen.getByText("Brak danych geograficznych w tym okresie.")).toBeTruthy();
    expect(screen.queryByTestId("choropleth")).toBeNull();
  });
});

/* --------------------------------------------------------- klocki pulpitu */

describe("RankedList", () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({
    id: `r${i}`,
    label: `Pozycja ${i}`,
    value: 100 - i * 10,
    secondary: i,
  }));

  it("tnie do `maxRows`, mierzy pasek od lidera i pokazuje drugą kolumnę", () => {
    const { container } = render(
      <RankedList
        rows={rows}
        labelHeader="Etykieta"
        valueHeader="Wartość"
        secondaryHeader="Druga"
        maxRows={3}
      />,
    );
    expect(screen.getAllByRole("row")).toHaveLength(4);
    expect(screen.getByRole("columnheader", { name: "Druga" })).toBeTruthy();
    const bars = [...container.querySelectorAll<HTMLElement>("span[aria-hidden] > span")];
    expect(bars.map((b) => b.style.width)).toEqual(["100%", "90%", "80%"]);
    // Bez mianownika procent udziału się nie pojawia.
    expect(container.textContent).not.toContain("%");
  });

  it("wiersz bez drugiej liczby pokazuje w jej kolumnie zero, a nie pustą komórkę", () => {
    render(
      <RankedList
        rows={[{ id: "a", label: "A", value: 5 }]}
        labelHeader="E"
        valueHeader="W"
        secondaryHeader="Druga"
      />,
    );
    const cells = screen.getAllByRole("cell");
    expect(cells.map((c) => c.textContent)).toEqual(["0", "5"]);
  });

  it("pasek zerowej pozycji przy zerowym liderze ma szerokość zero", () => {
    const { container } = render(
      <RankedList rows={[{ id: "z", label: "Zero", value: 0 }]} labelHeader="E" valueHeader="W" />,
    );
    expect(container.querySelector<HTMLElement>("span[aria-hidden] > span")?.style.width).toBe(
      "0%",
    );
  });

  it("pusta lista daje komunikat domyślny albo podany", () => {
    const { rerender } = render(<RankedList rows={[]} labelHeader="E" valueHeader="W" />);
    expect(screen.getByText("Brak danych w tym okresie.")).toBeTruthy();
    rerender(<RankedList rows={[]} labelHeader="E" valueHeader="W" emptyLabel="nic" />);
    expect(screen.getByText("nic")).toBeTruthy();
  });
});

describe("StatTile i DeltaBadge", () => {
  it("kafelek z adresem jest prawdziwym odnośnikiem, bez adresu - prostokątem", () => {
    const { rerender, container } = render(<StatTile label="A" value="1" to="/admin/x" />);
    expect(screen.getByRole("link").getAttribute("href")).toBe("/admin/x");
    rerender(<StatTile label="A" value="1" hint="mianownik" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.textContent).toContain("mianownik");
  });

  it.each([
    ["positive", computeDelta(150, 100), "lucide-arrow-up-right", "+50%"],
    ["negative", computeDelta(50, 100), "lucide-arrow-down-right", "-50%"],
    ["flat", computeDelta(100, 100), "lucide-minus", "0,0%"],
    ["unknown", computeDelta(5, 0), "lucide-arrow-right", "brak odniesienia"],
  ] as const)("ton %s ma własną ikonę i napis", (tone, delta, icon, text) => {
    const { container } = render(<DeltaBadge delta={delta} />);
    expect(delta.tone).toBe(tone);
    expect(container.querySelector(`svg.${icon}`)).not.toBeNull();
    expect(container.textContent).toBe(text);
  });

  it("brak odniesienia tłumaczy się w dymku, a odniesienie pokazuje się na życzenie", () => {
    const { container, rerender } = render(<DeltaBadge delta={computeDelta(5, 0)} withBaseline />);
    expect(container.firstElementChild?.getAttribute("title")).toContain(
      "Poprzedni okres był pusty",
    );
    expect(container.textContent).not.toContain("poprzednio");
    rerender(<DeltaBadge delta={computeDelta(1500, 1000)} withBaseline />);
    expect(container.firstElementChild?.getAttribute("title")).toBeNull();
    expect(container.textContent).toContain("poprzednio: 1000");
  });
});

describe("DashboardPeriodTabs", () => {
  it("jeden przycisk na okres, stan w `aria-pressed` i podpis odniesienia", () => {
    const onChange = vi.fn();
    render(<DashboardPeriodTabs value="month" onChange={onChange} />);
    const group = screen.getByRole("group", { name: "Okres" });
    expect(within(group).getAllByRole("button")).toHaveLength(8);
    expect(screen.getByRole("button", { name: "Ten miesiąc" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByText("wobec poprzedniego miesiąca do tego samego dnia")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Rok" }));
    expect(onChange).toHaveBeenCalledWith("year");
  });
});
