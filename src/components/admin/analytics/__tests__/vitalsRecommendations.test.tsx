// `VitalsRecommendations` - zamiana raportu Web Vitals na listę działań.
//
// PO CO. Ten komponent nie rysuje wykresu i nie robi zapytań: bierze gotowy
// `VitalsSummaryResult` i produkuje ZDANIA ROZKAZUJĄCE, które administrator
// wykona na produkcji. Klasa defektów, którą łapie ten plik, jest więc inna niż
// przy pulpitach - tu nic się nie wywraca, tu zmienia się TREŚĆ POLECENIA przy
// niezmienionym wyglądzie karty:
//
//   1. MAPOWANIE RATING -> GAŁĄŹ PLAYBOOKA. `SEG` tłumaczy "needs-improvement"
//      na "ni", a "poor" na "poor". Przestawienie tych dwóch wpisów podsuwa
//      przy metryce w strefie ostrzegawczej działania przewidziane dla awarii
//      (i odwrotnie) - karta wygląda identycznie, a instrukcja jest inna.
//   2. PRÓG PER ŚCIEŻKA. Wnioski per ścieżka powstają WYŁĄCZNIE dla "poor";
//      dopuszczenie "needs-improvement" zalałoby listę szumem i wypchnęło
//      prawdziwe awarie poza `slice(0, 12)`. Asercje idą na `VITAL_THRESHOLDS`
//      i `rateVital`, nie na wpisane liczby.
//   3. FORMAT WARTOŚCI. `fmt()` decyduje, czy operator zobaczy "4.20 s", czy
//      "4200 ms", i czy CLS dostanie trzy miejsca po przecinku. Zgubione
//      zaokrąglenie to nie literówka - to wartość, którą ktoś porówna z progiem
//      Google.
//   4. PUSTA LISTA DZIAŁAŃ. FID ma w słowniku pustą tablicę `fixes` (metryka
//      wycofana). Wniosek bez ani jednego działania jest gorszy niż jego brak,
//      więc strażnik `fixes.length === 0` musi go wyciąć.
//   5. ZERO UDAJĄCE POMIAR. Raport bez ani jednej próbki renderuje się dziś
//      jako "Wszystkie metryki w normie" - okno bez pomiaru nie odróżnia się od
//      okna zdrowego. Przypięte `it.fails`.
//   6. IZOLACJA WARSZTATÓW. Komponent jest bezstanowy, ale trzyma `useMemo` po
//      `report`; ponowny render z raportem innego warsztatu nie ma prawa
//      zostawić na ekranie ani jednej ścieżki poprzedniego.
//   7. SŁOWNIK. Każdy napis asertowany jest przez `realT("pl")` / `realT("en")`,
//      czyli tę samą instancję i18next, którą widzi użytkownik - usunięty klucz
//      wypada surowym `adminAnalytics.…`, a brak klucza EN cicho spada na
//      polszczyznę i test to widzi.
//
// ECHARTS: ten komponent nie renderuje `EChart`, więc nie ma czego atrapować -
// i biblioteka nie wchodzi do procesu testowego (patrz nagłówek `EChart.tsx`).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { VitalsSummaryResult } from "@/lib/observability/vitals.functions";
import type { VitalMetricSummary, VitalPathRow } from "@/lib/observability/aggregate";
import { VITAL_THRESHOLDS, rateVital, type VitalName } from "@/lib/observability/vitalsThresholds";
import type { AppLang } from "@/lib/i18n/localePath";

// `react-i18next` NIE JEST atrapowany: komponent jest dwujęzyczny, a
// przedmiotem dowodu jest to, że napisy przychodzą ZE SŁOWNIKA.
import "@/test/i18nReal";
import { realT } from "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { VitalsRecommendations } from "../VitalsRecommendations";

// ---------------------------------------------------------------------------
// Słownik
// ---------------------------------------------------------------------------

function vit(path: string, vars: Record<string, unknown> = {}, lang: AppLang = "pl"): string {
  return realT(lang)(`adminAnalytics.vitals.${path}`, vars);
}

function insight(path: string, vars: Record<string, unknown> = {}, lang: AppLang = "pl"): string {
  return realT(lang)(`adminAnalytics.insightSection.${path}`, vars);
}

interface Playbook {
  title: string;
  fixes: string[];
}

function playbook(metric: VitalName, seg: "ni" | "poor", lang: AppLang = "pl"): Playbook {
  const t = realT(lang);
  return {
    title: t(`adminAnalytics.vitals.playbook.${metric}.${seg}.title`),
    fixes: t(`adminAnalytics.vitals.playbook.${metric}.${seg}.fixes`, {
      returnObjects: true,
    }) as string[],
  };
}

// ---------------------------------------------------------------------------
// Dane
// ---------------------------------------------------------------------------

/** Ocena bierze się z PRAWDZIWEGO `rateVital` - progi nie są tu przepisywane. */
function metric(
  name: VitalName,
  p75: number,
  over: Partial<VitalMetricSummary> = {},
): VitalMetricSummary {
  return {
    metric: name,
    count: 100,
    p75,
    p50: p75,
    min: p75,
    max: p75,
    good: 60,
    needsImprovement: 30,
    poor: 10,
    rating: rateVital(name, p75),
    ...over,
  };
}

function pathRow(path: string, total: number, entries: Array<[VitalName, number]>): VitalPathRow {
  return {
    path,
    total,
    metrics: entries.map(([m, p75]) => ({
      metric: m,
      count: total,
      p75,
      rating: rateVital(m, p75),
    })),
  };
}

function report(over: Partial<VitalsSummaryResult> = {}): VitalsSummaryResult {
  const metrics = over.metrics ?? [];
  const total = metrics.reduce((a, m) => a + m.count, 0);
  return {
    windowDays: 7,
    total,
    windowTotal: total,
    capped: false,
    metrics,
    paths: [],
    trends: [],
    ...over,
  };
}

/** Raport "warsztatu A" - każda ścieżka niesie własny, rozpoznawalny prefiks. */
const WORKSPACE_A = report({
  metrics: [metric("LCP", 6000)],
  paths: [pathRow("/alfa-analizy/energia-w-regionie", 300, [["LCP", 6000]])],
});

/** Raport "warsztatu B" - rozłączny z A na każdym napisie. */
const WORKSPACE_B = report({
  metrics: [metric("INP", 900)],
  paths: [pathRow("/beta-raporty/klimat", 80, [["INP", 900]])],
});

// ---------------------------------------------------------------------------
// Narzędzia
// ---------------------------------------------------------------------------

/** Karty znalezisk: bezpośrednie dzieci PIERWSZEJ listy w karcie panelu. */
function findings(container: HTMLElement): HTMLElement[] {
  const list = container.querySelector("ul");
  if (!list) throw new Error("test: panel nie wyrenderował listy znalezisk");
  return Array.from(list.children) as HTMLElement[];
}

/** Działania naprawcze jednego znaleziska, bez znaku strzałki. */
function fixesOf(card: HTMLElement): string[] {
  return Array.from(card.querySelectorAll("ul > li")).map((li) =>
    (li.textContent ?? "").replace(/^→/, "").trim(),
  );
}

function titleOf(card: HTMLElement): string {
  return card.querySelector("span.font-semibold")?.textContent ?? "";
}

function panel(r: VitalsSummaryResult) {
  return render(<VitalsRecommendations report={r} />);
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe("VitalsRecommendations - brak znalezisk", () => {
  it("wszystkie metryki w strefie Good dają jedną kartę „w normie” i ZERO działań", () => {
    const { container } = panel(
      report({ metrics: [metric("LCP", 2000), metric("INP", 150), metric("CLS", 0.05)] }),
    );

    expect(screen.getByText(vit("allGood"))).toBeInTheDocument();
    expect(screen.getByText(vit("allGoodDetail"))).toBeInTheDocument();
    expect(container.querySelector("ul")).toBeNull();
  });

  it("metryka Good nie produkuje wniosku nawet przy fatalnym rozkładzie próbek", () => {
    // `metricFinding` patrzy WYŁĄCZNIE na `rating` p75. Rozkład (good/ni/poor)
    // trafia do opisu, ale nie może sam wywołać zalecenia - inaczej panel
    // krzyczałby przy każdej metryce z ogonem.
    panel(
      report({
        metrics: [metric("LCP", 2000, { good: 10, needsImprovement: 40, poor: 50 })],
      }),
    );

    expect(screen.getByText(vit("allGood"))).toBeInTheDocument();
  });

  it.fails("DEFEKT: raport BEZ ANI JEDNEJ próbki melduje „wszystkie metryki w normie”", () => {
    // Okno bez pomiaru i okno zdrowe to dwie różne informacje dla operatora.
    // Komponent dostaje `total`/`windowTotal` w propsie i mógłby je rozróżnić,
    // ale patrzy tylko na `metrics` - pusta tablica idzie tą samą ścieżką co
    // „wszystko zielone”. Administrator, któremu padł ingest beaconów, czyta
    // z ekranu potwierdzenie, że jest dobrze.
    panel(report({ metrics: [], paths: [], total: 0, windowTotal: 0 }));

    expect(screen.queryByText(vit("allGood"))).toBeNull();
  });
});

describe("VitalsRecommendations - mapowanie oceny na gałąź playbooka", () => {
  it("metryka „poor” dostaje tytuł i KOMPLET działań z gałęzi poor", () => {
    const pb = playbook("LCP", "poor");
    const { container } = panel(report({ metrics: [metric("LCP", 6000)] }));

    expect(screen.getByText(pb.title)).toBeInTheDocument();
    expect(fixesOf(findings(container)[0])).toEqual(pb.fixes);
  });

  it("metryka „needs-improvement” dostaje gałąź ni, a NIE gałąź poor", () => {
    // Dowód na `SEG`: obie gałęzie istnieją dla LCP i mają różne treści, więc
    // przestawienie mapowania nie schowa się za wspólnym tekstem.
    const ni = playbook("LCP", "ni");
    const poor = playbook("LCP", "poor");
    expect(ni.title).not.toBe(poor.title);

    const { container } = panel(report({ metrics: [metric("LCP", 3000)] }));

    expect(screen.getByText(ni.title)).toBeInTheDocument();
    expect(screen.queryByText(poor.title)).toBeNull();
    expect(fixesOf(findings(container)[0])).toEqual(ni.fixes);
  });

  it("granica Good/Needs jest wzięta z VITAL_THRESHOLDS, nie z literału", () => {
    const [good] = VITAL_THRESHOLDS.LCP;
    panel(report({ metrics: [metric("LCP", good)] }));
    expect(screen.getByText(vit("allGood"))).toBeInTheDocument();

    cleanup();
    panel(report({ metrics: [metric("LCP", good + 1)] }));
    expect(screen.getByText(playbook("LCP", "ni").title)).toBeInTheDocument();
  });

  it("FID ma pustą listę działań, więc mimo oceny „poor” NIE trafia na listę", () => {
    // Wniosek bez działania to sam alarm - strażnik `fixes.length === 0`
    // wycina wycofaną metrykę zamiast pokazywać pustą kartę.
    expect(playbook("FID", "poor").fixes).toEqual([]);

    panel(report({ metrics: [metric("FID", 900)] }));

    expect(screen.getByText(vit("allGood"))).toBeInTheDocument();
    expect(screen.queryByText(playbook("FID", "poor").title)).toBeNull();
  });
});

describe("VitalsRecommendations - format wartości w opisie", () => {
  it("CLS pokazuje trzy miejsca po przecinku, a nie milisekundy", () => {
    const m = metric("CLS", 0.42, { count: 40, good: 5, needsImprovement: 5, poor: 30 });
    panel(report({ metrics: [m] }));

    expect(
      screen.getByText(vit("globalDetail", { p75: "0.420", good: 5, ni: 5, poor: 30, count: 40 })),
    ).toBeInTheDocument();
  });

  it("wartość od sekundy w górę schodzi do sekund z dwoma miejscami", () => {
    const m = metric("LCP", 4200, { count: 12, good: 1, needsImprovement: 2, poor: 9 });
    panel(report({ metrics: [m] }));

    expect(
      screen.getByText(vit("globalDetail", { p75: "4.20 s", good: 1, ni: 2, poor: 9, count: 12 })),
    ).toBeInTheDocument();
  });

  it("wartość poniżej sekundy zostaje w zaokrąglonych milisekundach", () => {
    const m = metric("INP", 950.4, { count: 7, good: 1, needsImprovement: 1, poor: 5 });
    panel(report({ metrics: [m] }));

    expect(
      screen.getByText(vit("globalDetail", { p75: "950 ms", good: 1, ni: 1, poor: 5, count: 7 })),
    ).toBeInTheDocument();
  });

  it("wartość nieliczbowa daje myślnik zamiast „NaN ms”", () => {
    const m = metric("TTFB", Number.NaN, {
      rating: "poor",
      count: 3,
      good: 0,
      needsImprovement: 0,
      poor: 3,
    });
    panel(report({ metrics: [m] }));

    expect(
      screen.getByText(vit("globalDetail", { p75: "-", good: 0, ni: 0, poor: 3, count: 3 })),
    ).toBeInTheDocument();
  });
});

describe("VitalsRecommendations - wnioski per ścieżka", () => {
  it("ścieżka w strefie „poor” trafia na listę z progiem ze słownika progów", () => {
    const [, poorThreshold] = VITAL_THRESHOLDS.LCP;
    const { container } = panel(
      report({ paths: [pathRow("/analizy/energia", 240, [["LCP", 7000]])] }),
    );

    expect(
      screen.getByText(
        vit("pathTitle", { metric: "LCP", path: "/analizy/energia", value: "7.00 s" }),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        vit("pathDetail", { total: 240, threshold: `${poorThreshold / 1000}.00 s` }),
      ),
    ).toBeInTheDocument();
    expect(findings(container)).toHaveLength(1);
  });

  it("ścieżka w strefie ostrzegawczej jest POMIJANA - inaczej lista to szum", () => {
    const { container } = panel(
      report({
        paths: [
          pathRow("/o-nas", 90, [
            ["LCP", 3000],
            ["CLS", 0.15],
          ]),
        ],
      }),
    );

    expect(screen.getByText(vit("allGood"))).toBeInTheDocument();
    expect(container.querySelector("ul")).toBeNull();
  });

  it("lista działań per ścieżka jest przycięta do trzech pierwszych kroków", () => {
    // Globalnie LCP/poor ma cztery kroki; per ścieżka pokazujemy trzy, żeby
    // dziesięć ścieżek nie zamieniło panelu w ścianę tekstu.
    const pb = playbook("LCP", "poor");
    expect(pb.fixes.length).toBeGreaterThan(3);

    const { container } = panel(report({ paths: [pathRow("/analizy", 10, [["LCP", 9000]])] }));

    expect(fixesOf(findings(container)[0])).toEqual(pb.fixes.slice(0, 3));
  });

  it("ścieżka jest podpisana obok tytułu i oznaczona zakresem „ścieżka”", () => {
    const { container } = panel(
      report({ paths: [pathRow("/raporty/klimat", 44, [["INP", 900]])] }),
    );
    const card = findings(container)[0];

    expect(card).toHaveTextContent(vit("scopePath"));
    expect(card.querySelector("span.font-mono")?.textContent).toBe("/raporty/klimat");
  });

  it("wniosek globalny jest oznaczony zakresem „globalne”", () => {
    const { container } = panel(report({ metrics: [metric("LCP", 6000)] }));
    const card = findings(container)[0];

    expect(card).toHaveTextContent(vit("scopeGlobal"));
    expect(card.querySelector("span.font-mono")).toBeNull();
  });
});

describe("VitalsRecommendations - kolejność, plakietki i limit", () => {
  it("awarie idą przed ostrzeżeniami, niezależnie od kolejności w raporcie", () => {
    const { container } = panel(
      report({
        metrics: [metric("CLS", 0.15), metric("LCP", 6000)],
        paths: [pathRow("/analizy", 10, [["INP", 900]])],
      }),
    );

    const titles = findings(container).map(titleOf);
    expect(titles[0]).toBe(playbook("LCP", "poor").title);
    expect(titles[1]).toBe(vit("pathTitle", { metric: "INP", path: "/analizy", value: "900 ms" }));
    expect(titles[2]).toBe(playbook("CLS", "ni").title);
  });

  it("plakietki liczą awarie i ostrzeżenia osobno", () => {
    panel(
      report({
        metrics: [metric("LCP", 6000), metric("CLS", 0.15), metric("TTFB", 1000)],
        paths: [pathRow("/analizy", 10, [["INP", 900]])],
      }),
    );

    expect(screen.getByText(insight("badgeCritical", { count: 2 }))).toBeInTheDocument();
    expect(screen.getByText(insight("badgeWarn", { count: 2 }))).toBeInTheDocument();
  });

  it("plakietka znika, gdy dana klasa ciężkości nie ma ani jednego znaleziska", () => {
    panel(report({ metrics: [metric("LCP", 6000)] }));

    expect(screen.getByText(insight("badgeCritical", { count: 1 }))).toBeInTheDocument();
    expect(screen.queryByText(insight("badgeWarn", { count: 0 }))).toBeNull();
  });

  it("powyżej dwunastu znalezisk lista jest ucięta, a stopka podaje PEŁNĄ liczbę", () => {
    const paths = Array.from({ length: 10 }, (_, i) =>
      pathRow(`/sciezka-${i}`, 10 + i, [["LCP", 9000]]),
    );
    const { container } = panel(
      report({
        metrics: [
          metric("LCP", 6000),
          metric("INP", 900),
          metric("CLS", 0.5),
          metric("FCP", 4000),
          metric("TTFB", 3000),
        ],
        paths,
      }),
    );

    expect(findings(container)).toHaveLength(12);
    expect(screen.getByText(vit("moreFindings", { count: 15 }))).toBeInTheDocument();
  });

  it("dokładnie dwanaście znalezisk nie wywołuje stopki „pokazano 12 z…”", () => {
    const paths = Array.from({ length: 7 }, (_, i) => pathRow(`/s-${i}`, 5, [["LCP", 9000]]));
    const { container } = panel(
      report({
        metrics: [
          metric("LCP", 6000),
          metric("INP", 900),
          metric("CLS", 0.5),
          metric("FCP", 4000),
          metric("TTFB", 3000),
        ],
        paths,
      }),
    );

    expect(findings(container)).toHaveLength(12);
    expect(screen.queryByText(vit("moreFindings", { count: 12 }))).toBeNull();
  });
});

describe("VitalsRecommendations - izolacja warsztatów", () => {
  it("ponowny render z raportem warsztatu B nie zostawia ścieżek warsztatu A", () => {
    const { rerender, container } = render(<VitalsRecommendations report={WORKSPACE_A} />);
    expect(container.textContent ?? "").toContain("/alfa-analizy/energia-w-regionie");

    rerender(<VitalsRecommendations report={WORKSPACE_B} />);

    expect(container.textContent ?? "").not.toContain("alfa");
    expect(container.textContent ?? "").toContain("/beta-raporty/klimat");
  });

  it("świeży montaż nie dziedziczy niczego po poprzednim raporcie", () => {
    const first = render(<VitalsRecommendations report={WORKSPACE_A} />);
    first.unmount();

    const second = render(<VitalsRecommendations report={WORKSPACE_B} />);

    expect(second.container.textContent ?? "").not.toContain("alfa");
  });
});

describe("VitalsRecommendations - słownik PL/EN", () => {
  it("po przełączeniu na angielski tytuł i działania przychodzą z gałęzi EN", async () => {
    await i18n.changeLanguage("en");
    const en = playbook("LCP", "poor", "en");
    const pl = playbook("LCP", "poor", "pl");
    expect(en.title).not.toBe(pl.title);

    const { container } = panel(report({ metrics: [metric("LCP", 6000)] }));

    expect(screen.getByText(en.title)).toBeInTheDocument();
    expect(fixesOf(findings(container)[0])).toEqual(en.fixes);
  });

  it("angielski komunikat „wszystko w normie” nie spada na polski fallback", async () => {
    await i18n.changeLanguage("en");

    panel(report({ metrics: [metric("LCP", 2000)] }));

    expect(screen.getByText(vit("allGood", {}, "en"))).toBeInTheDocument();
    expect(screen.queryByText(vit("allGood", {}, "pl"))).toBeNull();
  });

  it("angielski opis per ścieżka niesie EN-owe etykiety zakresu", async () => {
    await i18n.changeLanguage("en");
    const { container } = panel(report({ paths: [pathRow("/reports", 12, [["INP", 900]])] }));

    expect(findings(container)[0]).toHaveTextContent(vit("scopePath", {}, "en"));
    expect(
      screen.getByText(
        vit("pathTitle", { metric: "INP", path: "/reports", value: "900 ms" }, "en"),
      ),
    ).toBeInTheDocument();
  });
});

describe("VitalsRecommendations - dostępność", () => {
  it("karta z listą znalezisk nie ma naruszeń axe", async () => {
    const { container } = panel(
      report({
        metrics: [metric("LCP", 6000), metric("CLS", 0.15)],
        paths: [pathRow("/analizy/energia", 240, [["INP", 900]])],
      }),
    );

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("karta „wszystko w normie” nie ma naruszeń axe", async () => {
    const { container } = panel(report({ metrics: [metric("LCP", 2000)] }));

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
