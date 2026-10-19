// `BenchmarkScale` - skala porządkowa pasm benchmarku z pozycją wartości
// (SPEC §6.1, AD-20; karta S6: RTL + axe dla kierunków `lower`, `range` oraz
// stanów `none`, `no_data`, `small_sample`).
//
// Klasy defektów:
//   1. SEGMENTY ≠ PASMA. Skala zawsze z pięcioma segmentami zgubiłaby dwa
//      pasma wskaźnika przedziałowego (7 pasm: udział planów rocznych) albo
//      dorysowała nieistniejące - V5.
//   2. ZNACZNIK W ZŁYM PAŚMIE. Pasma kierunku `lower` rosną od „optymalnego”
//      do „krytycznego”; szukanie po etykiecie zamiast po przedziale stawia
//      churn 8 % w „optymalnym”.
//   3. ZNACZNIK PRZY BRAKU OCENY. Mała próba albo brak danych nie mogą
//      rysować pozycji - to byłaby diagnoza bez podstaw.
//   4. OBRAZEK BEZ OPISU. `role="img"` musi powiedzieć słowami wszystko, co
//      rysunek: wartość, ocenę i każde pasmo; tabela pasm daje nawigację.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@/test/i18nReal";
import { realT } from "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import "@/lib/i18n-admin-revenue-shell";
import { formatBenchValue } from "@/lib/analytics/semantic/benchmarks/adapter";
import { BenchmarkScale } from "../molecules/BenchmarkScale";
import { contextOf, localized } from "./benchmarkFixtures";

const churnPl = localized("retention", "logo_churn_monthly", "pl");
/** Kierunek `lower`: optymalny < 2,7 … krytyczny ≥ 7 (% miesięcznie). */
const CHURN = contextOf(churnPl, "logo_churn_monthly.news_b2c");
/** Kierunek `range`, 7 pasm z powtórzonymi poziomami po obu stronach optimum. */
const ANNUAL = contextOf(
  localized("revenue", "annual_plan_share", "pl"),
  "annual_plan_share.b2c_media",
);

function marker(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>("[data-marker]");
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
});
afterEach(cleanup);

describe("BenchmarkScale - segmenty i znacznik", () => {
  it("liczba segmentów = liczba pasm kontekstu, każdy równej szerokości (5 i 7)", () => {
    const a = render(<BenchmarkScale context={CHURN} value={null} lang="pl" name="Churn" />);
    const five = a.container.querySelectorAll("[data-segment]");
    expect(five).toHaveLength(5);
    for (const s of five) expect(s.className).toContain("flex-1");
    a.unmount();
    const b = render(<BenchmarkScale context={ANNUAL} value={null} lang="pl" name="APS" />);
    expect(b.container.querySelectorAll("[data-segment]")).toHaveLength(7);
    expect(
      [...b.container.querySelectorAll("[data-segment]")].map((s) =>
        s.getAttribute("data-segment"),
      ),
    ).toEqual(ANNUAL.bands.map((band) => band.tier));
  });

  it("kierunek lower: churn 4,2 % stoi w środku pasma „normalny”, 8 % - w „krytycznym”", () => {
    const a = render(<BenchmarkScale context={CHURN} value={4.2} lang="pl" name="Churn" />);
    // Pasmo [3,5; 4,9) to trzeci z pięciu segmentów: (2 + 0,5) / 5 = 50 %.
    expect(marker(a.container)?.style.left).toBe("50%");
    a.unmount();
    const b = render(<BenchmarkScale context={CHURN} value={8} lang="pl" name="Churn" />);
    // Otwarty koniec (≥ 7) - znacznik pośrodku ostatniego segmentu.
    expect(marker(b.container)?.style.left).toBe("90%");
  });

  it("kierunek range: wartość w optimum stoi w piątym z siedmiu segmentów", () => {
    const { container } = render(
      <BenchmarkScale context={ANNUAL} value={52.5} lang="pl" name="APS" />,
    );
    // [45, 60) to piąty segment: (4 + 0,5) / 7.
    expect(Number.parseFloat(marker(container)?.style.left ?? "")).toBeCloseTo((4.5 / 7) * 100, 5);
    const t = realT("pl");
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
      t("adminRevenue.benchmark.tier.optimal"),
    );
  });

  it("pasmo-heurystyka (E) ma inne wypełnienie niż pasmo ze źródła (B)", () => {
    const { container } = render(
      <BenchmarkScale context={ANNUAL} value={null} lang="pl" name="APS" />,
    );
    const segs = [...container.querySelectorAll<HTMLElement>("[data-segment]")];
    const e = segs.find((s) => s.dataset.basis === "E");
    const b = segs.find((s) => s.dataset.basis === "B");
    expect(e?.style.backgroundImage).toContain("repeating-linear-gradient");
    expect(b?.style.backgroundImage ?? "").toBe("");
  });
});

describe("BenchmarkScale - opis słowny i tabela pasm", () => {
  it("`role=img` z nazwą: wskaźnik, wartość z oceną i KAŻDE pasmo z zakresem", () => {
    const t = realT("pl");
    render(<BenchmarkScale context={CHURN} value={4.2} lang="pl" name="Logo churn (M)" />);
    const label = screen.getByRole("img").getAttribute("aria-label") ?? "";
    expect(label).toContain(t("adminRevenue.benchmark.scale.label", { name: "Logo churn (M)" }));
    expect(label).toContain(formatBenchValue(4.2, CHURN, "pl"));
    expect(label).toContain(t("adminRevenue.benchmark.tier.normal"));
    for (const tier of ["optimal", "good", "normal", "weak", "critical"]) {
      expect(label).toContain(t(`adminRevenue.benchmark.tier.${tier}`));
    }
    // Otwarte końce opisane słowami, nie pustym „od - do”.
    expect(label).toContain(
      t("adminRevenue.benchmark.scale.openStart", { to: formatBenchValue(2.7, CHURN, "pl") }),
    );
    expect(label).toContain(
      t("adminRevenue.benchmark.scale.openEnd", { from: formatBenchValue(7, CHURN, "pl") }),
    );
  });

  it("tabela pasm dla czytnika: caption, nagłówki kolumn i wierszy, podstawa B/E", () => {
    const t = realT("pl");
    const { container } = render(
      <BenchmarkScale context={ANNUAL} value={null} lang="pl" name="APS" />,
    );
    const table = container.querySelector("table");
    expect(table?.className).toContain("sr-only");
    expect(within(table as HTMLElement).getAllByRole("columnheader")).toHaveLength(3);
    for (const th of within(table as HTMLElement).getAllByRole("columnheader")) {
      expect(th).toHaveAttribute("scope", "col");
    }
    expect(within(table as HTMLElement).getAllByRole("rowheader")).toHaveLength(7);
    expect(table?.querySelector("caption")?.textContent).toContain(ANNUAL.label);
    expect(table?.textContent).toContain(t("adminRevenue.benchmark.scale.basisE"));
    expect(table?.textContent).toContain(t("adminRevenue.benchmark.scale.basisB"));
  });

  it("w EN opis, zakresy i tabela są angielskie", async () => {
    await i18n.changeLanguage("en");
    const en = realT("en");
    const churnEn = contextOf(localized("retention", "logo_churn_monthly", "en"), CHURN.id);
    render(<BenchmarkScale context={churnEn} value={2} lang="en" name="Logo churn (M)" />);
    const label = screen.getByRole("img").getAttribute("aria-label") ?? "";
    expect(label).toContain(en("adminRevenue.benchmark.tier.optimal"));
    expect(label).not.toContain("optymalny");
    expect(label).toContain(formatBenchValue(2, churnEn, "en"));
  });
});

describe("BenchmarkScale - stany bez oceny", () => {
  it.each(["none", "no_data", "small_sample"] as const)(
    "stan %s: bez znacznika, powód słowem pod skalą i w opisie",
    (state) => {
      const t = realT("pl");
      const { container } = render(
        <BenchmarkScale context={CHURN} value={4.2} state={state} n={12} lang="pl" name="Churn" />,
      );
      expect(marker(container)).toBeNull();
      const note = container.querySelector(`[data-scale-state="${state}"]`);
      expect(note?.textContent).toContain(t(`adminRevenue.benchmark.state.${state}`));
      expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
        t(`adminRevenue.benchmark.state.${state}`),
      );
    },
  );

  it("mała próba podaje liczebność", () => {
    const t = realT("pl");
    const { container } = render(
      <BenchmarkScale context={CHURN} value={4.2} state="small_sample" n={23} lang="pl" name="C" />,
    );
    expect(container.textContent).toContain(t("adminRevenue.benchmark.scale.sample", { n: 23 }));
  });

  it("brak wartości: pasma bez znacznika, opis mówi „brak wartości”", () => {
    const t = realT("pl");
    const { container } = render(
      <BenchmarkScale context={CHURN} value={null} lang="pl" name="Churn" />,
    );
    expect(marker(container)).toBeNull();
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
      t("adminRevenue.benchmark.state.no_value"),
    );
  });

  it("wartość poza dziedziną pasm nie dostaje znacznika", () => {
    const { container } = render(
      <BenchmarkScale context={ANNUAL} value={-5} lang="pl" name="APS" />,
    );
    expect(marker(container)).toBeNull();
  });
});

describe("BenchmarkScale - dostępność i motywy", () => {
  it.each([
    ["lower", CHURN, 4.2],
    ["range", ANNUAL, 52.5],
  ] as const)("kierunek %s: brak naruszeń axe", async (_dir, ctx, value) => {
    const { container } = render(<BenchmarkScale context={ctx} value={value} lang="pl" name="X" />);
    expect(summarize(await axeViolations(container))).toBe("");
  });

  it("stan small_sample: brak naruszeń axe", async () => {
    const { container } = render(
      <BenchmarkScale context={CHURN} value={4} state="small_sample" n={5} lang="pl" name="X" />,
    );
    expect(summarize(await axeViolations(container))).toBe("");
  });

  it("kolory wyłącznie z tokenów ról - zero hex (ta sama geometria w obu motywach)", () => {
    const { container } = render(
      <BenchmarkScale context={ANNUAL} value={52.5} lang="pl" name="APS" />,
    );
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(container.innerHTML).toContain("var(--chart-");
  });
});
