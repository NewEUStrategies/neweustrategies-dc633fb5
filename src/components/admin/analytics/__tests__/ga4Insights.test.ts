// Silnik interpretacji dashboardu GA4 (`buildGa4Insights`) - pierwszy test tego pliku.
//
// PO CO. Ten moduł niczego nie renderuje i o nic nie pyta bazy: zamienia surowe
// raporty Data API na osiem wpisów, a KAŻDY z nich niesie trzy niezależne
// decyzje - czy w ogóle powstać, jaką dostać `severity` (kolor paska
// w `InsightSection`) i którą listę rekomendacji pokazać. Wszystkie trzy to
// progi liczbowe (-10 / +15 / 0.6 / 0.4 / 0.9 / 0.35 / „więcej niż 3 wiersze"),
// a taki kod psuje się CICHO: przestawiony znak porównania albo zamieniona
// kolejność `if`-ów nie wywraca dashboardu - podsuwa administratorowi odwrotną
// rekomendację przy niezmienionym wyglądzie ekranu. Liczby dalej się
// wyświetlają, więc bez testu nikt tego nie zauważy.
//
// KLASY DEFEKTÓW, KTÓRE TEN PLIK ŁAPIE:
//   * blok powstaje mimo braku danych albo znika mimo danych - bramki
//     `rows.length > 3`, `rows.length` i `Object.keys(engage).length`;
//   * `severity` rozjeżdża się z listą `fixes`: to DWA osobne łańcuchy `if`-ów
//     nad tymi samymi liczbami (sesje: severity łamie się na -15, a lista fiksów
//     na -10), więc każdy jest sprawdzany oddzielnie;
//   * arytmetyka bez danych - dzielenie przez zero i `indexOf` zwracający -1 dla
//     metryki nieobecnej w `metricHeaders`. Obie ścieżki muszą dać liczbę,
//     nie `NaN` w tytule widocznym dla użytkownika;
//   * sortowanie: trend dzieli okno po DACIE z wymiaru, a nie po kolejności
//     wierszy w tablicy - Data API nie gwarantuje porządku, więc wiersze
//     wchodzą tu celowo pomieszane;
//   * brak klucza w słowniku. Asercje idą przez `realT("pl")` i `realT("en")`,
//     czyli tę samą instancję i18next, którą widzi użytkownik: usunięty klucz
//     wypada w tytule surowym `adminAnalytics.…`, a brak klucza EN cicho spada
//     na polski fallback - jedno i drugie oblewa test.
import { describe, expect, it } from "vitest";
import type { Ga4Report, Ga4Row } from "@/lib/analytics/ga4.functions";
import { realT } from "@/test/i18nReal";
import type { Insight } from "../InsightSection";
import { buildGa4Insights } from "../ga4Insights";

type BuildParams = Parameters<typeof buildGa4Insights>[0];
type Lang = "pl" | "en";

const B = "adminAnalytics.ga4.insights";

/** Metryki, o które `Ga4BiDashboard` pyta dla raportu dobowego. */
const CORE = ["sessions", "activeUsers", "screenPageViews", "engagementRate"];

function report(
  metricHeaders: string[],
  opts: { totals?: Array<string | number>; rows?: Ga4Row[] } = {},
): Ga4Report {
  return {
    configured: true,
    dimensionHeaders: ["dim"],
    metricHeaders,
    rows: opts.rows ?? [],
    totals: (opts.totals ?? []).map(String),
  };
}

function row(dim: string, ...metrics: Array<string | number>): Ga4Row {
  return { dims: [dim], metrics: metrics.map(String) };
}

/** Raport dobowy z totalami CORE_METRICS - baza obu bezwarunkowych KPI. */
function coreTotals(
  sessions: number,
  activeUsers = 0,
  screenPageViews = 0,
  engagementRate = 0,
  rows: Ga4Row[] = [],
): Ga4Report {
  return report(CORE, { totals: [sessions, activeUsers, screenPageViews, engagementRate], rows });
}

function build(over: Partial<Omit<BuildParams, "t">> = {}, lang: Lang = "pl"): Insight[] {
  return buildGa4Insights({
    dateReport: undefined,
    prevReport: undefined,
    sourceReport: undefined,
    countryReport: undefined,
    deviceReport: undefined,
    pageReport: undefined,
    engagementReport: undefined,
    windowDays: 28,
    ...over,
    t: realT(lang),
  });
}

function ids(insights: Insight[]): string[] {
  return insights.map((i) => i.id);
}

function byId(insights: Insight[], id: string): Insight {
  const found = insights.find((i) => i.id === id);
  if (!found) throw new Error(`Brak wpisu "${id}"; są: [${ids(insights).join(", ")}]`);
  return found;
}

/** Lista rekomendacji prosto ze słownika - asercja gałęzi bez kopiowania treści. */
function dictFixes(path: string, lang: Lang = "pl"): string[] {
  return realT(lang)(`${B}.${path}`, { returnObjects: true }) as string[];
}

/** Napis ze słownika z interpolacją - do asercji tytułów o dokładnej treści. */
function dictText(path: string, vars: Record<string, unknown> = {}, lang: Lang = "pl"): string {
  return realT(lang)(`${B}.${path}`, vars);
}

/**
 * Każdy wpis musi być gotowym tekstem dla użytkownika: żadnego surowego klucza
 * (i18next zwraca klucz, gdy go nie ma), żadnego niepodstawionego `{{…}}`,
 * żadnego `NaN` i niepustej listy rekomendacji.
 */
function expectRenderable(insights: Insight[]): void {
  expect(insights.length).toBeGreaterThan(0);
  for (const i of insights) {
    for (const text of [i.element, i.title, i.detail]) {
      expect(typeof text).toBe("string");
      expect(text).not.toContain("adminAnalytics.");
      expect(text).not.toContain("{{");
      expect(text).not.toContain("NaN");
      expect(text.trim()).not.toBe("");
    }
    expect(Array.isArray(i.fixes)).toBe(true);
    expect(i.fixes.length).toBeGreaterThan(0);
    for (const fix of i.fixes) {
      expect(typeof fix).toBe("string");
      expect(fix).not.toContain("adminAnalytics.");
      expect(fix).not.toContain("{{");
    }
  }
}

/** Pełny dashboard - wszystkie osiem bloków naraz. */
function fullDashboard(): Partial<Omit<BuildParams, "t">> {
  return {
    dateReport: coreTotals(1200, 900, 3000, 0.55, [
      row("20260104", 200, 150, 500, 0.5),
      row("20260101", 180, 140, 460, 0.5),
      row("20260106", 220, 160, 520, 0.5),
      row("20260103", 190, 145, 470, 0.5),
      row("20260105", 210, 155, 510, 0.5),
      row("20260102", 200, 150, 540, 0.5),
    ]),
    prevReport: coreTotals(1000, 800, 2500, 0.5),
    sourceReport: report(["sessions"], {
      rows: [row("(direct)", 50), row("google", 30), row("newsletter", 20)],
    }),
    countryReport: report(["sessions"], { rows: [row("Poland", 60), row("Germany", 40)] }),
    deviceReport: report(["sessions"], { rows: [row("mobile", 70), row("desktop", 30)] }),
    pageReport: report(["screenPageViews", "engagementRate"], {
      rows: [row("/a", 100, 0.5), row("/b", 80, 0.2)],
    }),
    engagementReport: report(
      [
        "engagementRate",
        "averageSessionDuration",
        "screenPageViewsPerSession",
        "bounceRate",
        "eventCount",
      ],
      { totals: [0.55, 95.4, 2.4, 0.35, 4000] },
    ),
  };
}

describe("buildGa4Insights - bramki emisji", () => {
  it("pusty dashboard (wszystkie raporty undefined) daje tylko dwa bezwarunkowe KPI", () => {
    const insights = build();

    expect(ids(insights)).toEqual(["kpi-sessions", "kpi-engagement"]);
    expect(insights[0].title).toBe(dictText("sessions.titleNoDelta", { sessions: 0 }));
    expect(insights[0].severity).toBe("info");
    expect(insights[0].fixes).toEqual(dictFixes("sessions.fixesStable"));
    expect(insights[1].severity).toBe("warn");
    expectRenderable(insights);
  });

  it("raporty obecne, ale bez wierszy i bez nagłówków metryk: nadal tylko dwa KPI", () => {
    const empty = report(["sessions"], { totals: [0] });
    const insights = build({
      dateReport: empty,
      sourceReport: empty,
      countryReport: empty,
      deviceReport: empty,
      pageReport: empty,
      engagementReport: report([], {}),
    });

    expect(ids(insights)).toEqual(["kpi-sessions", "kpi-engagement"]);
  });

  it("komplet raportów daje osiem wpisów w stałej kolejności emisji", () => {
    const insights = build(fullDashboard());

    expect(ids(insights)).toEqual([
      "kpi-sessions",
      "kpi-engagement",
      "trend",
      "sources",
      "countries",
      "devices",
      "engagement-radar",
      "top-pages",
    ]);
    expectRenderable(insights);
  });
});

describe("buildGa4Insights - KPI sesje", () => {
  it("brak poprzedniego okna (prev = 0) daje tytuł bez delty i severity info", () => {
    const insights = build({ dateReport: coreTotals(1234, 900), prevReport: coreTotals(0) });
    const kpi = byId(insights, "kpi-sessions");

    expect(kpi.title).toBe(dictText("sessions.titleNoDelta", { sessions: 1234 }));
    expect(kpi.title).toContain("1234");
    expect(kpi.severity).toBe("info");
    expect(kpi.detail).toContain("1234");
    expect(kpi.detail).toContain("900");
  });

  it("spadek o 20% to severity warn i lista fixesDown, z deltą i oknem w tytule", () => {
    const kpi = byId(
      build({ dateReport: coreTotals(100, 80), prevReport: coreTotals(125) }, "pl"),
      "kpi-sessions",
    );

    expect(kpi.severity).toBe("warn");
    expect(kpi.fixes).toEqual(dictFixes("sessions.fixesDown"));
    expect(kpi.title).toBe(dictText("sessions.titleDelta", { delta: "-20.0", days: 28 }));
    expect(kpi.title).toContain("-20.0");
    expect(kpi.title).toContain("28");
    expect(kpi.detail).toBe(dictText("sessions.detail", { sessions: 100, prev: 125, active: 80 }));
  });

  it("spadek o 12% NIE jest jeszcze ostrzeżeniem, ale już zmienia listę fiksów na fixesDown", () => {
    const kpi = byId(
      build({ dateReport: coreTotals(110), prevReport: coreTotals(125) }),
      "kpi-sessions",
    );

    // Progi są rozjechane celowo: severity łamie się na -15, lista fiksów na -10.
    expect(kpi.severity).toBe("info");
    expect(kpi.fixes).toEqual(dictFixes("sessions.fixesDown"));
  });

  it("dokładnie -10% to jeszcze fixesStable - próg fiksów jest ostry, nie domknięty", () => {
    const kpi = byId(
      build({ dateReport: coreTotals(90), prevReport: coreTotals(100) }),
      "kpi-sessions",
    );

    expect(kpi.fixes).toEqual(dictFixes("sessions.fixesStable"));
    expect(kpi.severity).toBe("info");
  });

  it("wzrost o 20% to severity good i lista fixesUp z dodatnim znakiem w tytule", () => {
    const kpi = byId(
      build({ dateReport: coreTotals(120), prevReport: coreTotals(100) }),
      "kpi-sessions",
    );

    expect(kpi.severity).toBe("good");
    expect(kpi.fixes).toEqual(dictFixes("sessions.fixesUp"));
    expect(kpi.title).toContain("+20.0");
  });

  it("dokładnie +15% jest już dobre, ale fiksy zostają stabilne", () => {
    const kpi = byId(
      build({ dateReport: coreTotals(115), prevReport: coreTotals(100) }),
      "kpi-sessions",
    );

    expect(kpi.severity).toBe("good");
    expect(kpi.fixes).toEqual(dictFixes("sessions.fixesStable"));
  });

  it("wzrost o 2% to info i fixesStable", () => {
    const kpi = byId(
      build({ dateReport: coreTotals(102), prevReport: coreTotals(100) }),
      "kpi-sessions",
    );

    expect(kpi.severity).toBe("info");
    expect(kpi.fixes).toEqual(dictFixes("sessions.fixesStable"));
  });

  it("nieliczbowa wartość metryki schodzi do zera, zamiast wpuścić NaN do tekstu KPI", () => {
    const kpi = byId(
      build({
        dateReport: report(CORE, { totals: ["brak", "3.5", "", "0.5"] }),
        prevReport: coreTotals(100),
      }),
      "kpi-sessions",
    );

    expect(kpi.title).not.toContain("NaN");
    expect(kpi.detail).toBe(dictText("sessions.detail", { sessions: 0, prev: 100, active: 3.5 }));
    expect(kpi.severity).toBe("warn");
  });

  it("trzy listy fiksów sesji różnią się między sobą - inaczej asercje gałęzi nic nie znaczą", () => {
    expect(dictFixes("sessions.fixesDown")).not.toEqual(dictFixes("sessions.fixesStable"));
    expect(dictFixes("sessions.fixesUp")).not.toEqual(dictFixes("sessions.fixesStable"));
    expect(dictFixes("sessions.fixesDown")).not.toEqual(dictFixes("sessions.fixesUp"));
  });
});

describe("buildGa4Insights - KPI zaangażowanie", () => {
  it("0.6 to próg 'good' i fiksy podtrzymujące", () => {
    const kpi = byId(build({ dateReport: coreTotals(100, 0, 0, 0.6) }), "kpi-engagement");

    expect(kpi.severity).toBe("good");
    expect(kpi.fixes).toEqual(dictFixes("engagement.fixesGood"));
    expect(kpi.title).toBe(dictText("engagement.title", { rate: "60.0" }));
  });

  it("0.4 to jeszcze info, ale nadal fiksy podtrzymujące - progi severity i fiksów są różne", () => {
    const kpi = byId(build({ dateReport: coreTotals(100, 0, 0, 0.4) }), "kpi-engagement");

    expect(kpi.severity).toBe("info");
    expect(kpi.fixes).toEqual(dictFixes("engagement.fixesGood"));
  });

  it("poniżej 0.4 to ostrzeżenie i lista naprawcza", () => {
    const kpi = byId(build({ dateReport: coreTotals(100, 0, 0, 0.39) }), "kpi-engagement");

    expect(kpi.severity).toBe("warn");
    expect(kpi.fixes).toEqual(dictFixes("engagement.fixesLow"));
    expect(kpi.title).toContain("39.0");
  });

  it("delta zaangażowania jest w punktach procentowych względem poprzedniego okna", () => {
    const kpi = byId(
      build({
        dateReport: coreTotals(100, 0, 0, 0.5),
        prevReport: coreTotals(100, 0, 0, 0.42),
      }),
      "kpi-engagement",
    );

    expect(kpi.detail).toBe(dictText("engagement.detail", { delta: "8.0" }));
    expect(kpi.detail).toContain("8.0");
  });

  it("spadek zaangażowania daje ujemną deltę, nie wartość bezwzględną", () => {
    const kpi = byId(
      build({
        dateReport: coreTotals(100, 0, 0, 0.3),
        prevReport: coreTotals(100, 0, 0, 0.5),
      }),
      "kpi-engagement",
    );

    expect(kpi.detail).toContain("-20.0");
  });
});

describe("buildGa4Insights - trend ruchu", () => {
  /** Cztery dni w pomieszanej kolejności: po dacie H1 = 20+10, H2 = 2+1. */
  const SHUFFLED_DAYS = [
    row("20260104", 1),
    row("20260102", 10),
    row("20260103", 2),
    row("20260101", 20),
  ];

  it("dokładnie trzy wiersze to za mało - blok trendu w ogóle nie powstaje", () => {
    const insights = build({
      dateReport: coreTotals(30, 0, 0, 0, [
        row("20260101", 10),
        row("20260102", 10),
        row("20260103", 10),
      ]),
    });

    expect(ids(insights)).not.toContain("trend");
  });

  it("czwarty wiersz przekracza próg i blok trendu się pojawia", () => {
    const insights = build({
      dateReport: coreTotals(40, 0, 0, 0, [
        row("20260101", 10),
        row("20260102", 10),
        row("20260103", 10),
        row("20260104", 10),
      ]),
    });

    expect(ids(insights)).toContain("trend");
  });

  it("okno dzieli się po DACIE z wymiaru, a nie po kolejności wierszy w tablicy", () => {
    const trend = byId(build({ dateReport: coreTotals(33, 0, 0, 0, SHUFFLED_DAYS) }), "trend");

    // Po dacie: H1 = 20 + 10 = 30, H2 = 2 + 1 = 3 -> -90%. Po kolejności
    // w tablicy wyszłoby H1 = 1 + 10 = 11, H2 = 2 + 20 = 22, czyli +100%.
    expect(trend.detail).toBe(dictText("trend.detail", { early: 30, late: 3 }));
    expect(trend.title).toContain("-90.0");
    expect(trend.severity).toBe("warn");
    expect(trend.fixes).toEqual(dictFixes("trend.fixesDown"));
  });

  it("pierwsza połowa okna bez ruchu daje tytuł 'brak danych' i domyślne fiksy", () => {
    const trend = byId(
      build({
        dateReport: coreTotals(10, 0, 0, 0, [
          row("20260101", 0),
          row("20260102", 0),
          row("20260103", 5),
          row("20260104", 5),
        ]),
      }),
      "trend",
    );

    expect(trend.title).toBe(dictText("trend.titleNoData"));
    expect(trend.severity).toBe("info");
    expect(trend.fixes).toEqual(dictFixes("trend.fixesDefault"));
  });

  it("spadek płytszy niż -10% zostaje przy domyślnych fiksach", () => {
    const trend = byId(
      build({
        dateReport: coreTotals(390, 0, 0, 0, [
          row("20260101", 100),
          row("20260102", 100),
          row("20260103", 95),
          row("20260104", 95),
        ]),
      }),
      "trend",
    );

    expect(trend.title).toContain("-5.0");
    expect(trend.fixes).toEqual(dictFixes("trend.fixesDefault"));
    // -5% mieści się w paśmie neutralnym classifyDelta (good od +5, warn od -15).
    expect(trend.severity).toBe("info");
  });

  it("metryka 'sessions' spoza metricHeaders nie wywraca trendu ani nie daje NaN", () => {
    const trend = byId(
      build({
        dateReport: report(["screenPageViews"], {
          totals: [100],
          rows: [
            row("20260101", 10),
            row("20260102", 10),
            row("20260103", 10),
            row("20260104", 10),
          ],
        }),
      }),
      "trend",
    );

    // indexOf -> -1, więc metrics[-1] jest undefined, a num() daje 0 dla obu połówek.
    expect(trend.title).toBe(dictText("trend.titleNoData"));
    expect(trend.detail).toBe(dictText("trend.detail", { early: 0, late: 0 }));
  });

  it("trend przy nieparzystej liczbie dni dzieli okno na RÓWNE połowy - płaski ruch to zero zmiany", () => {
    // Siedem dni po 10 sesji, czyli ruch DOKŁADNIE płaski. Przy podziale
    // `slice(0, floor(7/2))` / `slice(floor(7/2))` H1 miałoby trzy dni (30),
    // a H2 cztery (40) - silnik ogłaszałby +33.3% i podnosił severity do
    // "good" na danych, w których nic nie urosło (a symetrycznie ukrywał
    // realny spadek). Obie połowy mają teraz po trzy dni, dzień środkowy nie
    // wchodzi do żadnej, więc H1 = H2 = 30 i trend to dokładnie 0%.
    const flatWeek = [1, 2, 3, 4, 5, 6, 7].map((d) => row(`2026010${d}`, 10));
    const trend = byId(build({ dateReport: coreTotals(70, 0, 0, 0, flatWeek) }), "trend");

    expect(trend.title).toBe(dictText("trend.title", { delta: "+0.0" }));
    expect(trend.severity).toBe("info");
    expect(trend.detail).toBe(dictText("trend.detail", { early: 30, late: 30 }));
  });
});

describe("buildGa4Insights - źródła ruchu", () => {
  it("direct powyżej 60% to ostrzeżenie i fiksy o tagowaniu UTM, nawet gdy organic też jest niski", () => {
    const sources = byId(
      build({
        sourceReport: report(["sessions"], {
          rows: [row("(Direct)", 70), row("Google", 10), row("newsletter", 20)],
        }),
      }),
      "sources",
    );

    // Wielkość liter nie ma znaczenia: dopasowanie idzie po toLowerCase().
    expect(sources.severity).toBe("warn");
    expect(sources.fixes).toEqual(dictFixes("sources.fixesDirect"));
    expect(sources.title).toBe(dictText("sources.title", { direct: "70", organic: "10" }));
  });

  it("organic poniżej 20% przy niskim direct daje ostrzeżenie i fiksy SEO", () => {
    const sources = byId(
      build({
        sourceReport: report(["sessions"], {
          rows: [row("(direct)", 50), row("google", 10), row("referral", 40)],
        }),
      }),
      "sources",
    );

    expect(sources.severity).toBe("warn");
    expect(sources.fixes).toEqual(dictFixes("sources.fixesOrganic"));
  });

  it("zdrowy miks kanałów to observacja info i fiksy dywersyfikacyjne", () => {
    const sources = byId(
      build({
        sourceReport: report(["sessions"], {
          rows: [row("(direct)", 50), row("google", 30), row("newsletter", 20)],
        }),
      }),
      "sources",
    );

    expect(sources.severity).toBe("info");
    expect(sources.fixes).toEqual(dictFixes("sources.fixesDefault"));
  });

  it("podsumowanie wymienia TOP 3 wg sesji malejąco, a nie trzy pierwsze wiersze z raportu", () => {
    const sources = byId(
      build({
        sourceReport: report(["sessions"], {
          rows: [
            row("newsletter", 20),
            row("(direct)", 50),
            row("linkedin", 5),
            row("google", 30),
            row("x.example.com", 1),
          ],
        }),
      }),
      "sources",
    );

    expect(sources.detail).toBe(
      dictText("sources.detail", {
        count: 5,
        top3: "(direct) (50), google (30), newsletter (20)",
      }),
    );
    expect(sources.detail).toContain("5");
    expect(sources.detail).not.toContain("linkedin");
  });

  it("dopasowanie 'google' działa na pełnej nazwie kanału, nie tylko na dokładnym słowie", () => {
    const sources = byId(
      build({
        sourceReport: report(["sessions"], {
          rows: [row("Google Organic Search", 80), row("bing", 20)],
        }),
      }),
      "sources",
    );

    // organic = 80% -> ani direct > 60%, ani organic < 20%.
    expect(sources.title).toBe(dictText("sources.title", { direct: "0", organic: "80" }));
    expect(sources.severity).toBe("info");
  });

  it("suma sesji równa zero nie dzieli przez zero - udziały schodzą do 0%, bez NaN", () => {
    const sources = byId(
      build({
        sourceReport: report(["sessions"], { rows: [row("(direct)", 0), row("google", 0)] }),
      }),
      "sources",
    );

    expect(sources.title).toBe(dictText("sources.title", { direct: "0", organic: "0" }));
    expect(sources.title).not.toContain("NaN");
    expect(sources.severity).toBe("warn");
    expect(sources.fixes).toEqual(dictFixes("sources.fixesOrganic"));
  });

  it("brak metryki 'sessions' w nagłówkach daje zera zamiast NaN w tytule i w TOP 3", () => {
    const sources = byId(
      build({
        sourceReport: report(["screenPageViews"], {
          rows: [row("(direct)", 900), row("google", 100)],
        }),
      }),
      "sources",
    );

    expect(sources.title).not.toContain("NaN");
    expect(sources.detail).toBe(
      dictText("sources.detail", { count: 2, top3: "(direct) (0), google (0)" }),
    );
  });
});

describe("buildGa4Insights - kraje", () => {
  it("dominacja jednego kraju powyżej 90% to info i fiksy o drugim rynku", () => {
    const countries = byId(
      build({
        countryReport: report(["sessions"], { rows: [row("Poland", 95), row("Germany", 5)] }),
      }),
      "countries",
    );

    expect(countries.severity).toBe("info");
    expect(countries.fixes).toEqual(dictFixes("countries.fixesSingle"));
    expect(countries.title).toBe(dictText("countries.title", { country: "Poland", pct: "95" }));
    expect(countries.detail).toBe(dictText("countries.detail", { count: 2 }));
  });

  it("ruch rozłożony na kilka krajów to severity good i fiksy podtrzymujące", () => {
    const countries = byId(
      build({
        countryReport: report(["sessions"], {
          rows: [row("Poland", 60), row("Germany", 30), row("Czechia", 10)],
        }),
      }),
      "countries",
    );

    expect(countries.severity).toBe("good");
    expect(countries.fixes).toEqual(dictFixes("countries.fixesMulti"));
    expect(countries.title).toContain("60");
  });

  it("liderem jest kraj o największej liczbie sesji, a nie pierwszy wiersz raportu", () => {
    const countries = byId(
      build({
        countryReport: report(["sessions"], { rows: [row("Germany", 5), row("Poland", 95)] }),
      }),
      "countries",
    );

    expect(countries.title).toContain("Poland");
    expect(countries.title).not.toContain("Germany");
  });

  it("same zera w raportach krajów nie dają NaN ani dominacji", () => {
    const countries = byId(
      build({
        countryReport: report(["sessions"], { rows: [row("Poland", 0), row("Germany", 0)] }),
      }),
      "countries",
    );

    expect(countries.title).toBe(dictText("countries.title", { country: "Poland", pct: "0" }));
    expect(countries.severity).toBe("good");
  });
});

describe("buildGa4Insights - urządzenia", () => {
  it("mobile powyżej 60% przełącza listę fiksów, ale severity zostaje neutralne", () => {
    const devices = byId(
      build({
        deviceReport: report(["sessions"], {
          rows: [row("Mobile", 70), row("Desktop", 25), row("tablet", 5)],
        }),
      }),
      "devices",
    );

    // Blok urządzeń nigdy nie alarmuje - to obserwacja, nie problem.
    expect(devices.severity).toBe("info");
    expect(devices.fixes).toEqual(dictFixes("devices.fixesMobile"));
    expect(devices.title).toBe(dictText("devices.title", { pct: "70" }));
    expect(devices.detail).toBe(dictText("devices.detail", { mobile: 70, desktop: 25 }));
  });

  it("przewaga desktopu daje drugą listę fiksów", () => {
    const devices = byId(
      build({
        deviceReport: report(["sessions"], { rows: [row("mobile", 40), row("desktop", 60)] }),
      }),
      "devices",
    );

    expect(devices.fixes).toEqual(dictFixes("devices.fixesDesktop"));
    expect(devices.title).toContain("40");
  });

  it("raport bez wiersza mobile i desktop pokazuje zera zamiast pustych miejsc", () => {
    const devices = byId(
      build({
        deviceReport: report(["sessions"], { rows: [row("tablet", 30), row("smart tv", 10)] }),
      }),
      "devices",
    );

    expect(devices.title).toBe(dictText("devices.title", { pct: "0" }));
    expect(devices.detail).toBe(dictText("devices.detail", { mobile: 0, desktop: 0 }));
    expect(devices.fixes).toEqual(dictFixes("devices.fixesDesktop"));
  });
});

describe("buildGa4Insights - radar zaangażowania", () => {
  const RADAR_HEADERS = ["averageSessionDuration", "bounceRate", "screenPageViewsPerSession"];

  function radar(asd: number, bounce: number, spv: number): Ga4Report {
    return report(RADAR_HEADERS, { totals: [asd, bounce, spv] });
  }

  it("brak raportu zaangażowania: blok radaru nie powstaje", () => {
    expect(ids(build())).not.toContain("engagement-radar");
  });

  it("bounce powyżej 60% przy zdrowej liczbie odsłon to ostrzeżenie o odbiciach", () => {
    const insight = byId(build({ engagementReport: radar(120.6, 0.7, 2.5) }), "engagement-radar");

    expect(insight.severity).toBe("warn");
    expect(insight.fixes).toEqual(dictFixes("engagementRadar.fixesHighBounce"));
    expect(insight.title).toBe(
      dictText("engagementRadar.title", { asd: "121", spv: "2.50", bounce: "70" }),
    );
  });

  it("niski spv wygrywa z wysokim bounce przy doborze rekomendacji", () => {
    const insight = byId(build({ engagementReport: radar(30, 0.8, 1.2) }), "engagement-radar");

    // severity łapie bounce, ale lista fiksów sprawdza spv jako pierwsze.
    expect(insight.severity).toBe("warn");
    expect(insight.fixes).toEqual(dictFixes("engagementRadar.fixesLowSpv"));
  });

  it("sam niski spv przy dobrym bounce też ostrzega", () => {
    const insight = byId(build({ engagementReport: radar(45, 0.2, 1.49) }), "engagement-radar");

    expect(insight.severity).toBe("warn");
    expect(insight.fixes).toEqual(dictFixes("engagementRadar.fixesLowSpv"));
  });

  it("spv dokładnie 1.5 przy niskim bounce to już stan dobry", () => {
    const insight = byId(build({ engagementReport: radar(45, 0.2, 1.5) }), "engagement-radar");

    expect(insight.severity).toBe("good");
    expect(insight.fixes).toEqual(dictFixes("engagementRadar.fixesGood"));
    expect(insight.detail).toBe(dictText("engagementRadar.detail"));
  });

  it("raport zaangażowania bez metryk radaru podstawia zera zamiast pustych miejsc w tytule", () => {
    // Nagłówki są, ale żaden nie jest tym, którego radar szuka - trzy niezależne
    // fallbacki (`?? 0`) muszą dać liczby, a nie "undefined" w tytule.
    const insight = byId(
      build({ engagementReport: report(["eventCount"], { totals: [4000] }) }),
      "engagement-radar",
    );

    expect(insight.title).toBe(
      dictText("engagementRadar.title", { asd: "0", spv: "0.00", bounce: "0" }),
    );
    expect(insight.title).not.toContain("undefined");
    expect(insight.severity).toBe("warn");
    expect(insight.fixes).toEqual(dictFixes("engagementRadar.fixesLowSpv"));
  });

  it("radar nie powstaje, gdy raport ma nagłówki metryk, ale pusty zestaw totali", () => {
    // Okno bez ruchu: Data API oddaje nagłówki metryk i ZERO wierszy, więc
    // `totals` jest puste. Gdyby bramka sprawdzała nagłówki, a nie totale,
    // administrator dostawałby "0 odsł./sesja - dodaj related posty" na
    // danych, których nie ma. `totalsFromReport` mapuje więc tylko metryki
    // z realnym totalem, a bramka radaru pyta o tę mapę - tak samo jak
    // sąsiedni helper `ga4TotalsMap` (ga4.server.ts), który trzyma tę regułę
    // wprost: "brak danych" to nie to samo, co zmierzone zero.
    const insights = build({ engagementReport: report(RADAR_HEADERS, { totals: [] }) });

    expect(ids(insights)).not.toContain("engagement-radar");
  });
});

describe("buildGa4Insights - top strony", () => {
  const PAGE_HEADERS = ["screenPageViews", "engagementRate"];

  /** Dziesięć stron o malejących odsłonach; pierwsze `weak` mają słaby engagement. */
  function pages(weak: number): Ga4Report {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row(`/artykul-${i}`, 100 - i, i < weak ? 0.2 : 0.8),
    );
    return report(PAGE_HEADERS, { rows });
  }

  it("dwie słabe strony w TOP 10 to jeszcze obserwacja", () => {
    const top = byId(build({ pageReport: pages(2) }), "top-pages");

    expect(top.severity).toBe("info");
    expect(top.fixes).toEqual(dictFixes("topPages.fixesDefault"));
    expect(top.title).toBe(dictText("topPages.title", { strong: 8, weak: 2 }));
  });

  it("trzecia słaba strona przełącza blok w ostrzeżenie i listę naprawczą", () => {
    const top = byId(build({ pageReport: pages(3) }), "top-pages");

    expect(top.severity).toBe("warn");
    expect(top.fixes).toEqual(dictFixes("topPages.fixesWeak"));
    expect(top.title).toBe(dictText("topPages.title", { strong: 7, weak: 3 }));
  });

  it("engagement dokładnie 0.35 nie jest jeszcze słaby - próg jest ostry", () => {
    const top = byId(
      build({
        pageReport: report(PAGE_HEADERS, {
          rows: [row("/a", 100, 0.35), row("/b", 90, 0.35), row("/c", 80, 0.35)],
        }),
      }),
      "top-pages",
    );

    expect(top.severity).toBe("info");
    expect(top.title).toContain("0");
  });

  it("liczone są tylko strony z TOP 10 wg odsłon, nie cały raport", () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => row(`/mocna-${i}`, 100 - i, 0.8)),
      row("/ogon-1", 5, 0.01),
      row("/ogon-2", 4, 0.01),
      row("/ogon-3", 3, 0.01),
    ];
    const top = byId(build({ pageReport: report(PAGE_HEADERS, { rows }) }), "top-pages");

    expect(top.severity).toBe("info");
    expect(top.title).toBe(dictText("topPages.title", { strong: 10, weak: 0 }));
  });

  it("ranking idzie po odsłonach, więc słabe strony z końca raportu wchodzą do TOP 10 po sortowaniu", () => {
    const rows = [
      ...Array.from({ length: 9 }, (_, i) => row(`/mocna-${i}`, 10 + i, 0.8)),
      row("/wielka-slaba-1", 900, 0.1),
      row("/wielka-slaba-2", 800, 0.1),
      row("/wielka-slaba-3", 700, 0.1),
    ];
    const top = byId(build({ pageReport: report(PAGE_HEADERS, { rows }) }), "top-pages");

    expect(top.severity).toBe("warn");
    expect(top.fixes).toEqual(dictFixes("topPages.fixesWeak"));
  });

  it("brak metryk stron w nagłówkach nie daje NaN - wszystkie strony liczą się jako słabe", () => {
    const top = byId(
      build({
        pageReport: report(["sessions"], { rows: [row("/a", 10), row("/b", 5)] }),
      }),
      "top-pages",
    );

    expect(top.title).not.toContain("NaN");
    expect(top.severity).toBe("info");
  });

  it("tytuł top stron liczy 'zaangażowane' z realnej długości czołówki, nie z pełnej dziesiątki", () => {
    // Cztery strony, jedna słaba -> mocne są trzy. Przy „10 minus słabe"
    // silnik obiecywałby "9 zaangażowanych", czyli więcej mocnych stron, niż
    // raport w ogóle zawiera. Liczba mocnych schodzi więc z długości
    // faktycznie ocenionej czołówki (tu: cztery wiersze).
    const top = byId(
      build({
        pageReport: report(PAGE_HEADERS, {
          rows: [row("/a", 100, 0.8), row("/b", 90, 0.8), row("/c", 80, 0.8), row("/d", 70, 0.1)],
        }),
      }),
      "top-pages",
    );

    expect(top.title).toBe(dictText("topPages.title", { strong: 3, weak: 1 }));
  });
});

describe("buildGa4Insights - wiersze bez wartości wymiaru", () => {
  /** Wiersz, w którym Data API nie oddało `dimensionValues` - `dims` jest puste. */
  function bare(...metrics: Array<string | number>): Ga4Row {
    return { dims: [], metrics: metrics.map(String) };
  }

  it("brak wymiaru nie wywraca żadnego bloku - w tekstach lądują znaki zastępcze, nie undefined", () => {
    const insights = build({
      dateReport: coreTotals(40, 0, 0, 0, [bare(10), bare(10), bare(10), bare(10)]),
      sourceReport: report(["sessions"], { rows: [bare(60), bare(40)] }),
      countryReport: report(["sessions"], { rows: [bare(60), bare(40)] }),
      deviceReport: report(["sessions"], { rows: [bare(60), bare(40)] }),
    });

    expectRenderable(insights);
    for (const insight of insights) {
      expect(insight.title).not.toContain("undefined");
      expect(insight.detail).not.toContain("undefined");
    }
    // Bez nazwy kanału nic nie pasuje do "direct" ani "google": oba udziały to 0%.
    expect(byId(insights, "sources").title).toBe(
      dictText("sources.title", { direct: "0", organic: "0" }),
    );
    expect(byId(insights, "sources").detail).toBe(
      dictText("sources.detail", { count: 2, top3: "? (60), ? (40)" }),
    );
    expect(byId(insights, "countries").title).toBe(
      dictText("countries.title", { country: "?", pct: "60" }),
    );
    expect(byId(insights, "devices").detail).toBe(
      dictText("devices.detail", { mobile: 0, desktop: 0 }),
    );
  });
});

describe("buildGa4Insights - słownik PL/EN", () => {
  it("każdy z ośmiu bloków ma osobne etykiety i rekomendacje w obu językach", () => {
    const params = fullDashboard();
    const pl = build(params, "pl");
    const en = build(params, "en");

    expect(ids(en)).toEqual(ids(pl));
    expectRenderable(pl);
    expectRenderable(en);

    for (let i = 0; i < pl.length; i++) {
      // Brak klucza EN cofa i18next na fallback "pl" - wtedy napisy są
      // identyczne i ta asercja gaśnie. To jedyny tani detektor takiej dziury.
      expect(en[i].element, `element bloku ${pl[i].id} nie ma tłumaczenia EN`).not.toBe(
        pl[i].element,
      );
      expect(en[i].fixes, `fiksy bloku ${pl[i].id} nie mają tłumaczenia EN`).not.toEqual(
        pl[i].fixes,
      );
      expect(en[i].severity).toBe(pl[i].severity);
    }
  });

  it("liczby z raportu trafiają do tekstu w obu językach tak samo", () => {
    const params = fullDashboard();
    const pl = byId(build(params, "pl"), "kpi-sessions");
    const en = byId(build(params, "en"), "kpi-sessions");

    for (const insight of [pl, en]) {
      expect(insight.title).toContain("+20.0");
      expect(insight.title).toContain("28");
      expect(insight.detail).toContain("1200");
      expect(insight.detail).toContain("1000");
      expect(insight.detail).toContain("900");
    }
  });

  it("severity nie zależy od języka - decyzje liczy kod, nie słownik", () => {
    const params = {
      dateReport: coreTotals(50, 10, 100, 0.2),
      prevReport: coreTotals(200),
      sourceReport: report(["sessions"], { rows: [row("(direct)", 90), row("google", 10)] }),
    };

    expect(build(params, "pl").map((i) => i.severity)).toEqual(
      build(params, "en").map((i) => i.severity),
    );
    expect(byId(build(params, "en"), "kpi-sessions").severity).toBe("warn");
  });
});
