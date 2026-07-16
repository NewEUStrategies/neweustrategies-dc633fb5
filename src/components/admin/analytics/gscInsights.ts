/**
 * Buduje listę interpretacji + rekomendacji dla dashboardu GSC.
 * Dostaje surowe wiersze i podsumowania - nie robi zapytań. Wołane z
 * `GscBiDashboard`. Każdy wpis odnosi się do konkretnego elementu
 * (KPI, trend, top zapytania, pozycja SERP, kraje, urządzenia, strony,
 * kalendarz), zgodnie z prośbą użytkownika o analitykę "dla każdego
 * elementu".
 */
import type { GscRow } from "@/lib/analytics/gsc.functions";
import { type Insight, pctDelta, classifyDelta } from "./InsightSection";

interface Totals {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface Params {
  totals: Totals;
  prevTotals: Totals;
  dateRows: GscRow[];
  queryRows: GscRow[];
  pageRows: GscRow[];
  countryRows: GscRow[];
  deviceRows: GscRow[];
  windowDays: number;
}

const CTR_BENCHMARK_BY_POS: Array<{ maxPos: number; expected: number }> = [
  { maxPos: 3, expected: 0.18 },
  { maxPos: 10, expected: 0.06 },
  { maxPos: 20, expected: 0.02 },
  { maxPos: Infinity, expected: 0.008 },
];

function expectedCtr(pos: number): number {
  const b = CTR_BENCHMARK_BY_POS.find((x) => pos <= x.maxPos);
  return b?.expected ?? 0.008;
}

export function buildGscInsights(p: Params): Insight[] {
  const out: Insight[] = [];
  const { totals, prevTotals, dateRows, queryRows, pageRows, countryRows, deviceRows } = p;

  // ── 1. KPI: kliknięcia ─────────────────────────────────────────────
  const dClicks = pctDelta(totals.clicks, prevTotals.clicks);
  out.push({
    id: "kpi-clicks",
    element: "KPI · Kliknięcia",
    severity: classifyDelta(dClicks, true),
    title:
      dClicks === null
        ? `Kliknięcia w oknie: ${totals.clicks}`
        : `Kliknięcia ${dClicks >= 0 ? "+" : ""}${dClicks.toFixed(1)}% vs poprzednie okno`,
    detail:
      `W bieżącym oknie ${p.windowDays} dni: ${totals.clicks} klik. ` +
      `Poprzednio: ${prevTotals.clicks}. Wyświetlenia: ${totals.impressions} (poprzednio ${prevTotals.impressions}).`,
    fixes:
      dClicks !== null && dClicks < -10
        ? [
            "Sprawdź w GSC Coverage czy nie wypadły ważne strony (soft 404 / noindex).",
            "Zweryfikuj czy zmieniłeś tytuły/meta description na TOP stronach - CTR mogło spaść.",
            "Uruchom `/admin/seo` i przeindeksuj strony z największym spadkiem impressions.",
          ]
        : dClicks !== null && dClicks > 20
          ? [
              "Utrwal trend: dodaj wewnętrzne linki do stron, które ostatnio zyskały.",
              "Zbierz nowe frazy z Top zapytań i rozwiń content pod długi ogon.",
            ]
          : [
              "Utrzymaj rytm publikacji - stabilny trend jest dobrą bazą do skalowania.",
            ],
  });

  // ── 2. KPI: CTR ────────────────────────────────────────────────────
  const dCtr = totals.ctr - prevTotals.ctr; // punkty procentowe
  const ctrGap = totals.ctr - expectedCtr(totals.position);
  out.push({
    id: "kpi-ctr",
    element: "KPI · CTR",
    severity:
      ctrGap < -0.02
        ? "warn"
        : ctrGap > 0.02
          ? "good"
          : Math.abs(dCtr) < 0.005
            ? "info"
            : dCtr < 0
              ? "warn"
              : "good",
    title: `CTR ${(totals.ctr * 100).toFixed(2)}% przy pozycji ${totals.position.toFixed(1)}`,
    detail:
      `Oczekiwany CTR dla tej pozycji: ~${(expectedCtr(totals.position) * 100).toFixed(1)}%. ` +
      `Twój CTR jest ${ctrGap >= 0 ? "wyższy" : "niższy"} o ${(Math.abs(ctrGap) * 100).toFixed(1)} pp. ` +
      `Zmiana vs poprzednie okno: ${(dCtr * 100).toFixed(2)} pp.`,
    fixes:
      ctrGap < 0
        ? [
            "Przepisz meta title na TOP stronach: dodaj korzyść + rok + brand na końcu (≤ 60 znaków).",
            "Popraw meta description: konkretna wartość + CTA (≤ 155 znaków).",
            "Wdroż FAQ / HowTo schema.org - często dają rich results w SERP.",
            "Sprawdź faktyczny snippet w SERP (site:) - czasem Google generuje własny opis; wtedy popraw H1/pierwszy akapit.",
          ]
        : [
            "Utrzymaj stylistykę tytułów - działa. Wprowadź ten sam wzorzec na słabszych stronach.",
          ],
  });

  // ── 3. KPI: pozycja ────────────────────────────────────────────────
  const dPos = totals.position - prevTotals.position;
  out.push({
    id: "kpi-position",
    element: "KPI · Śr. pozycja",
    severity: dPos <= -0.5 ? "good" : dPos >= 0.5 ? "warn" : "info",
    title: `Średnia pozycja: ${totals.position.toFixed(1)} (${dPos >= 0 ? "+" : ""}${dPos.toFixed(1)})`,
    detail:
      dPos > 0
        ? `Pozycja pogorszyła się o ${dPos.toFixed(1)} miejsc - spadek widoczności.`
        : dPos < 0
          ? `Pozycja poprawiła się o ${Math.abs(dPos).toFixed(1)} miejsc.`
          : `Pozycja stabilna względem poprzedniego okna.`,
    fixes:
      dPos > 0.5
        ? [
            "Zbadaj konkurencję TOP-3 pod Twoje TOP frazy (SEMrush SERP analysis).",
            "Zaktualizuj najstarsze wpisy z najlepszymi frazami: refresh treści + data modyfikacji.",
            "Dodaj wewnętrzne linki z filarowych stron do artykułów tracących pozycje.",
          ]
        : [
            "Utrzymaj tempo linkowania wewnętrznego i publikacji.",
          ],
  });

  // ── 4. Trend widoczności ───────────────────────────────────────────
  if (dateRows.length > 3) {
    const sorted = dateRows.slice().sort((a, b) => (a.keys[0] ?? "").localeCompare(b.keys[0] ?? ""));
    const half = Math.floor(sorted.length / 2);
    const early = sorted.slice(0, half).reduce((s, r) => s + r.clicks, 0);
    const late = sorted.slice(half).reduce((s, r) => s + r.clicks, 0);
    const trend = pctDelta(late, early);
    out.push({
      id: "trend",
      element: "Trend widoczności",
      severity: classifyDelta(trend, true),
      title:
        trend === null
          ? "Trend widoczności - brak dostatecznych danych"
          : `Druga połowa okna: ${trend >= 0 ? "+" : ""}${trend.toFixed(1)}% klik. vs pierwsza`,
      detail: `Kliknięcia H1: ${early}, H2: ${late}. Kierunek trendu w oknie ${p.windowDays} dni.`,
      fixes:
        trend !== null && trend < -10
          ? [
              "Sprawdź logi crawlowania w GSC - może pojawił się blok robots / 5xx.",
              "Zweryfikuj sitemap.xml (świeżość + brak 404).",
              "Uruchom URL Inspection dla stron które utraciły ruch.",
            ]
          : ["Analizuj korelację ze świętami / weekendami - w B2B typowy spadek weekendowy."],
    });
  }

  // ── 5. Top 15 zapytań ──────────────────────────────────────────────
  if (queryRows.length > 0) {
    const branded = queryRows
      .filter((r) => (r.keys[0] ?? "").toLowerCase().includes("new european"))
      .reduce((s, r) => s + r.clicks, 0);
    const brandedPct = totals.clicks > 0 ? branded / totals.clicks : 0;
    const zeroClickHigh = queryRows.filter((r) => r.clicks === 0 && r.impressions >= 20).length;
    out.push({
      id: "top-queries",
      element: "Top 15 zapytań",
      severity: brandedPct > 0.6 ? "warn" : zeroClickHigh > 5 ? "warn" : "info",
      title:
        brandedPct > 0.6
          ? `Ruch mocno brandowy (${(brandedPct * 100).toFixed(0)}%)`
          : `${zeroClickHigh} fraz z ≥20 wyśw. i 0 klik.`,
      detail:
        brandedPct > 0.6
          ? "Ponad połowa kliknięć pochodzi z fraz brandowych - brakuje widoczności generycznej."
          : `Wysokie impressions bez kliknięć = SERP snippet nie sprzedaje. Fraz: ${zeroClickHigh}.`,
      fixes:
        brandedPct > 0.6
          ? [
              "Zbuduj content pod generic long-tail (poradniki, case studies) w tematach z branży.",
              "Skorzystaj z SEMrush keyword research: filtruj KD < 30 i intent Informational.",
              "Zlinkuj artykuły filarowe (pillar page) z ich klastrami tematycznymi.",
            ]
          : [
              "Weź 5 fraz z 0-CTR i przepisz meta title + description z korzyścią / liczbą.",
              "Zbuduj FAQ na tych stronach - Google chętnie promuje snippet Q&A.",
            ],
    });
  }

  // ── 6. Pozycja SERP - histogram ────────────────────────────────────
  if (queryRows.length > 0) {
    const inWindow = { top3: 0, top10: 0, top20: 0, deep: 0 };
    for (const r of queryRows) {
      if (r.position <= 3) inWindow.top3 += r.impressions;
      else if (r.position <= 10) inWindow.top10 += r.impressions;
      else if (r.position <= 20) inWindow.top20 += r.impressions;
      else inWindow.deep += r.impressions;
    }
    const totalImp = inWindow.top3 + inWindow.top10 + inWindow.top20 + inWindow.deep;
    const top10Pct = totalImp > 0 ? (inWindow.top3 + inWindow.top10) / totalImp : 0;
    out.push({
      id: "position-histogram",
      element: "Rozkład pozycji SERP",
      severity: top10Pct >= 0.5 ? "good" : top10Pct >= 0.25 ? "info" : "warn",
      title: `${(top10Pct * 100).toFixed(0)}% wyświetleń w TOP 10`,
      detail:
        `TOP3: ${inWindow.top3}, TOP4-10: ${inWindow.top10}, TOP11-20: ${inWindow.top20}, 21+: ${inWindow.deep}. ` +
        `Grupa 11-20 to "striking distance" - najłatwiejszy zysk.`,
      fixes: [
        "Wypisz wszystkie zapytania z pozycji 11-20 - to najlepszy ROI. Dodaj sekcje tematyczne + linki wewnętrzne.",
        "Do najbardziej dochodowych fraz z TOP4-10 dodaj FAQ / listę + zaktualizuj rok w tytule.",
        top10Pct < 0.25
          ? "Rozważ backlinki tematyczne - bez off-site trudno wskoczyć z 20+ do TOP10."
          : "Utrzymuj świeżość - refresh co 6 miesięcy dla TOP fraz.",
      ],
    });
  }

  // ── 7. Kraje ───────────────────────────────────────────────────────
  if (countryRows.length > 0) {
    const sorted = countryRows.slice().sort((a, b) => b.clicks - a.clicks);
    const top = sorted[0];
    const topShare = totals.clicks > 0 ? top.clicks / totals.clicks : 0;
    out.push({
      id: "countries",
      element: "Kraje",
      severity: topShare > 0.9 ? "info" : "good",
      title: `Dominujący kraj: ${(top.keys[0] ?? "?").toUpperCase()} (${(topShare * 100).toFixed(0)}%)`,
      detail: `${sorted.length} krajów w wynikach. Top 3: ${sorted
        .slice(0, 3)
        .map((r) => `${(r.keys[0] ?? "?").toUpperCase()} ${r.clicks}`)
        .join(", ")}.`,
      fixes:
        topShare > 0.9
          ? [
              "Jeden rynek = jedno ryzyko. Rozważ wersję EN dla najsilniejszych treści (i18n już masz).",
              "Ustaw hreflang na przetłumaczonych stronach - Google poda właściwą wersję per kraj.",
            ]
          : [
              "Podłącz country-specific meta description dla topowych rynków.",
              "Uruchom Merchant/Business Profile w krajach z ≥5% ruchu (jeśli B2C).",
            ],
    });
  }

  // ── 8. Urządzenia ──────────────────────────────────────────────────
  if (deviceRows.length > 0) {
    const mobile = deviceRows.find((r) => (r.keys[0] ?? "").toLowerCase() === "mobile");
    const desktop = deviceRows.find((r) => (r.keys[0] ?? "").toLowerCase() === "desktop");
    const mobileClicks = mobile?.clicks ?? 0;
    const desktopClicks = desktop?.clicks ?? 0;
    const mobileCtr = mobile && mobile.impressions ? mobile.ctr : 0;
    const desktopCtr = desktop && desktop.impressions ? desktop.ctr : 0;
    const gap = desktopCtr - mobileCtr;
    out.push({
      id: "devices",
      element: "Urządzenia",
      severity: gap > 0.02 ? "warn" : "info",
      title: `Mobile ${mobileClicks} klik., desktop ${desktopClicks} klik.`,
      detail: `CTR: mobile ${(mobileCtr * 100).toFixed(2)}%, desktop ${(desktopCtr * 100).toFixed(2)}%. ${gap > 0.02 ? "Desktop wyraźnie przoduje - mobilny snippet nie działa." : "Równomierny rozkład CTR."}`,
      fixes:
        gap > 0.02
          ? [
              "Skróć meta title do 50 znaków (mobile SERP ucina wcześniej).",
              "Sprawdź LCP mobile w Web Vitals - wolne mobile = niższy CTR.",
              "Zweryfikuj sticky headery i cookie bar - blokują first paint na mobile.",
            ]
          : [
              "Utrzymuj responsywność. Warto przetestować AMP tylko jeśli publikujesz newsy.",
            ],
    });
  }

  // ── 9. Strony (treemap) ────────────────────────────────────────────
  if (pageRows.length > 0) {
    const withImpr = pageRows.filter((r) => r.impressions >= 30);
    const lowCtr = withImpr.filter((r) => r.ctr < expectedCtr(r.position) * 0.6);
    const winners = withImpr.filter((r) => r.ctr > expectedCtr(r.position) * 1.3);
    out.push({
      id: "pages",
      element: "Strony wg wyświetleń",
      severity: lowCtr.length > 3 ? "warn" : "info",
      title: `${lowCtr.length} stron znacząco poniżej benchmarku CTR, ${winners.length} powyżej`,
      detail: `Analiza ${withImpr.length} stron z ≥30 wyświetleń. Sortuj: kolor treemapy = CTR (zielone = mocne, czerwone = słabe).`,
      fixes: [
        "Weź 3 najsłabsze strony i przepisz H1 + meta title - najszybszy efekt.",
        "Ze zwycięzców skopiuj wzorzec: układ H1 + CTA + FAQ na słabsze strony.",
        "Wewnętrzne linki: z winnerów podlinkuj strony z niską widocznością - transfer autorytetu.",
      ],
    });
  }

  // ── 10. Kalendarz aktywności ───────────────────────────────────────
  if (dateRows.length >= 7) {
    const sorted = dateRows
      .slice()
      .sort((a, b) => (a.keys[0] ?? "").localeCompare(b.keys[0] ?? ""));
    const zeros = sorted.filter((r) => r.clicks === 0).length;
    const spikeIdx = sorted.reduce(
      (acc, r, i) => (r.clicks > sorted[acc].clicks ? i : acc),
      0,
    );
    const spike = sorted[spikeIdx];
    out.push({
      id: "calendar",
      element: "Aktywność dzienna",
      severity: zeros > sorted.length * 0.4 ? "warn" : "info",
      title:
        zeros > sorted.length * 0.4
          ? `${zeros}/${sorted.length} dni bez kliknięć`
          : `Szczyt: ${spike.clicks} klik. ${spike.keys[0] ?? ""}`,
      detail:
        zeros > sorted.length * 0.4
          ? "Duża liczba zerowych dni sugeruje wąską niszę lub problem z indeksacją długi czas."
          : `Największy szczyt aktywności w wybranym oknie: ${spike.keys[0] ?? "-"} (${spike.clicks} klik.).`,
      fixes:
        zeros > sorted.length * 0.4
          ? [
              "Zwiększ częstotliwość publikacji - target 2-3 posty tygodniowo daje ciągły dopływ impressions.",
              "Uruchom URL Inspection dla zerowych dni w kluczowych URL.",
              "Rozważ syndication (LinkedIn / newsletter) - dywersyfikuje źródła ruchu.",
            ]
          : [
              "Zbadaj co spowodowało szczyt - powtórz format / temat / dystrybucję.",
            ],
    });
  }

  return out;
}
