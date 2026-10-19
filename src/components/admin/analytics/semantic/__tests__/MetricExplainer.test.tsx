// `MetricExplainer` - objaśnienie wskaźnika przy liczbie (SPEC §6.1, §6.5;
// karta S6: RTL + axe, Escape, `aria-labelledby`, stany `none`/`no_data`/
// `small_sample`).
//
// Klasy defektów, które łapie plik:
//   1. ZŁE OKNO NA ZŁYM EKRANIE. Dymek z dwunastoma sekcjami nad kafelkiem
//      telefonu wychodzi poza ekran - poniżej 640 px ma być arkusz od dołu,
//      a wybór zapada przy otwarciu (bez rozjazdu SSR).
//   2. FOKUS W NICOŚCI. Escape ma zamknąć okienko i oddać fokus ikonie -
//      inaczej użytkownik klawiatury zaczyna od początku strony.
//   3. OKNO BEZ NAZWY. Ikona stoi przy każdej liczbie; okienko `dialog` bez
//      `aria-labelledby` jest dla czytnika nieodróżnialne od sąsiednich.
//   4. OCENA BEZ PODSTAW. Churn przy n = 12 nie może dostać poziomu, a liczba
//      ułamkowa (0,042) musi być oceniana jako 4,2 pp, nie 0,042 %.
//   5. TREŚĆ Z NIEWŁAŚCIWEGO KONTEKSTU. Źródła i pasma należą do AKTYWNEGO
//      kontekstu; zmiana kontekstu idzie do wołającego (`?ctx=`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

const h = vi.hoisted(() => ({ fetchGroup: vi.fn() }));

vi.mock("@/lib/analytics/semantic/benchmarks/benchmarks.functions", () => ({
  getBenchmarkGroup: (...args: unknown[]) => h.fetchGroup(...args),
}));

import "@/test/i18nReal";
import { realT } from "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import "@/lib/i18n-admin-revenue-shell";
import { benchmarkIndexEntry } from "@/lib/analytics/semantic/benchmarks/index";
import { metricById } from "@/lib/analytics/semantic/metrics";
import { MetricExplainer } from "../molecules/MetricExplainer";
import { contextOf, localized, payloadFor } from "./benchmarkFixtures";

const CHURN = localized("retention", "logo_churn_monthly", "pl");
const NEWS = contextOf(CHURN, "logo_churn_monthly.news_b2c");

function withClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

/** Szerokość ekranu widziana przez `matchMedia("(min-width: 640px)")`. */
function viewport(wide: boolean): void {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: wide,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

async function open(name: string, lang: "pl" | "en" = "pl"): Promise<HTMLElement> {
  const button = screen.getByRole("button", {
    name: realT(lang)("adminRevenue.benchmark.help.open", { name }),
  });
  fireEvent.click(button);
  await act(async () => {});
  return button;
}

async function dialog(): Promise<HTMLElement> {
  return screen.findByRole("dialog");
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  viewport(true);
  h.fetchGroup.mockReset();
  h.fetchGroup.mockImplementation(async ({ data }: { data: { group: never; lang: never } }) =>
    payloadFor(data.group, data.lang),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MetricExplainer - okienko i fokus", () => {
  it("≥ 640 px: dymek (Popover) nazwany nagłówkiem wskaźnika", async () => {
    withClient(<MetricExplainer metricId="logo_churn_monthly" lang="pl" />);
    const button = await open(CHURN.abbr);
    const box = await dialog();
    expect(box.closest("[data-radix-popper-content-wrapper]")).not.toBeNull();
    const headingId = box.getAttribute("aria-labelledby");
    expect(headingId).toBeTruthy();
    await waitFor(() =>
      expect(document.getElementById(headingId ?? "")?.textContent).toContain(CHURN.abbr),
    );
    expect(button).toHaveAttribute("aria-expanded", "true");
  });

  it("< 640 px: arkusz od dołu (Sheet side=bottom), wybór przy otwarciu", async () => {
    viewport(false);
    withClient(<MetricExplainer metricId="logo_churn_monthly" lang="pl" />);
    await open(CHURN.abbr);
    const box = await dialog();
    expect(box.closest("[data-radix-popper-content-wrapper]")).toBeNull();
    expect(box.className).toContain("bottom-0");
    await waitFor(() =>
      expect(
        document.getElementById(box.getAttribute("aria-labelledby") ?? "")?.textContent,
      ).toContain(CHURN.abbr),
    );
  });

  it("Escape zamyka dymek i ODDAJE fokus ikonie", async () => {
    withClient(<MetricExplainer metricId="logo_churn_monthly" lang="pl" />);
    const button = await open(CHURN.abbr);
    const box = await dialog();
    fireEvent.keyDown(box, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(button).toHaveAttribute("aria-expanded", "false");
    // Radix oddaje fokus w następnym takcie (FocusScope przy odmontowaniu).
    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  it("Escape zamyka arkusz i oddaje fokus ikonie", async () => {
    viewport(false);
    withClient(<MetricExplainer metricId="logo_churn_monthly" lang="pl" />);
    const button = await open(CHURN.abbr);
    const box = await dialog();
    fireEvent.keyDown(box, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(button));
  });
});

describe("MetricExplainer - tryb krótki i pełny", () => {
  it("krótki: skrót z rozwinięciem, wzór monospace, jak czytać i „Więcej” - bez dźwigni", async () => {
    const t = realT("pl");
    withClient(<MetricExplainer metricId="logo_churn_monthly" lang="pl" />);
    await open(CHURN.abbr);
    const box = await dialog();
    await waitFor(() => expect(box.textContent).toContain(CHURN.interpretation));
    expect(box.textContent).toContain(CHURN.expansion);
    expect(box.querySelector("code")?.textContent).toBe(CHURN.formula);
    expect(box.querySelector("code")?.className).toContain("font-mono");
    expect(
      within(box).getByRole("button", { name: t("adminRevenue.benchmark.explainer.more") }),
    ).toBeInTheDocument();
    expect(box.textContent).not.toContain(CHURN.levers);
  });

  it("„Więcej” bez wołającego rozwija pełne sekcje w miejscu", async () => {
    const t = realT("pl");
    withClient(<MetricExplainer metricId="logo_churn_monthly" lang="pl" />);
    await open(CHURN.abbr);
    const box = await dialog();
    fireEvent.click(
      await within(box).findByRole("button", { name: t("adminRevenue.benchmark.explainer.more") }),
    );
    await waitFor(() => expect(box.textContent).toContain(CHURN.levers));
    for (const key of [
      "definition",
      "formula",
      "measures",
      "reading",
      "levers",
      "caveats",
      "benchmark",
      "provenance",
      "sources",
    ]) {
      expect(box.textContent, key).toContain(t(`adminRevenue.benchmark.explainer.${key}`));
    }
    // Definicja z rejestru metryk, pochodzenie z powiązania autorytatywnego.
    expect(box.textContent).toContain(metricById("logo_churn_monthly").definitionPl);
    expect(box.textContent).toContain(metricById("logo_churn_monthly").bindings[0].formula);
    expect(box.textContent).toContain(t("adminAnalytics.semantic.authoritative"));
    // Skala i pasma aktywnego (domyślnego) kontekstu.
    expect(within(box).getByRole("img")).toBeInTheDocument();
    expect(box.textContent).toContain(t("adminRevenue.benchmark.confidence.medium"));
  });

  it("„Więcej” z `onOpenFull` oddaje pełny widok wołającemu i zamyka dymek", async () => {
    const t = realT("pl");
    const onOpenFull = vi.fn();
    withClient(<MetricExplainer metricId="logo_churn_monthly" lang="pl" onOpenFull={onOpenFull} />);
    await open(CHURN.abbr);
    const box = await dialog();
    fireEvent.click(
      await within(box).findByRole("button", { name: t("adminRevenue.benchmark.explainer.more") }),
    );
    await act(async () => {});
    expect(onOpenFull).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("pary obowiązkowe: LTV/CAC pokazuje skróty wskaźników, bez których jest mylący", async () => {
    const t = realT("pl");
    const ratio = localized("economics", "ltv_cac_ratio", "pl");
    expect(ratio.pairs.length).toBeGreaterThan(0);
    withClient(<MetricExplainer metricId="ltv_cac_ratio" lang="pl" mode="full" />);
    await open(ratio.abbr);
    const box = await dialog();
    await waitFor(() =>
      expect(box.textContent).toContain(t("adminRevenue.benchmark.explainer.pairs")),
    );
    for (const key of ratio.pairs) {
      expect(box.textContent).toContain(benchmarkIndexEntry(key)?.abbr ?? "∅");
    }
  });

  it("źródła wyłącznie AKTYWNEGO kontekstu, w jego kolejności", async () => {
    withClient(
      <MetricExplainer
        metricId="logo_churn_monthly"
        lang="pl"
        mode="full"
        ctx={NEWS.id}
        onCtxChange={() => {}}
      />,
    );
    await open(CHURN.abbr);
    const box = await dialog();
    await waitFor(() => expect(box.querySelectorAll("[data-source]").length).toBeGreaterThan(0));
    const shown = [...box.querySelectorAll("[data-source]")].map((el) =>
      el.getAttribute("data-source"),
    );
    expect(shown).toEqual(NEWS.sourceIds.slice(0, 12));
  });

  it("zmiana kontekstu idzie do wołającego (`?ctx=`)", async () => {
    const onCtxChange = vi.fn();
    withClient(
      <MetricExplainer
        metricId="logo_churn_monthly"
        lang="pl"
        mode="full"
        ctx={NEWS.id}
        onCtxChange={onCtxChange}
      />,
    );
    await open(CHURN.abbr);
    const box = await dialog();
    const select = await within(box).findByRole("combobox");
    fireEvent.keyDown(select, { key: "ArrowDown" });
    const other = CHURN.contexts.find((c) => c.id !== NEWS.id);
    fireEvent.click(await screen.findByRole("option", { name: other?.label }));
    expect(onCtxChange).toHaveBeenCalledWith(other?.id);
  });
});

describe("MetricExplainer - „teraz” i ocena", () => {
  it("ułamek 0,042 to 4,2 pp churnu: ocena „normalny” w kontekście news B2C", async () => {
    const t = realT("pl");
    withClient(
      <MetricExplainer
        metricId="logo_churn_monthly"
        lang="pl"
        value={0.042}
        n={400}
        segment="b2c_individual"
      />,
    );
    await open(CHURN.abbr);
    const box = await dialog();
    await waitFor(() => expect(box.querySelector('[data-tier="normal"]')).not.toBeNull());
    expect(box.textContent).toContain(t("adminRevenue.benchmark.explainer.now"));
    expect(box.textContent).toContain(NEWS.label);
  });

  it("mała próba: ocena wstrzymana słowem, skala bez znacznika", async () => {
    const t = realT("pl");
    withClient(
      <MetricExplainer metricId="logo_churn_monthly" lang="pl" value={0.042} n={12} mode="full" />,
    );
    await open(CHURN.abbr);
    const box = await dialog();
    await waitFor(() => expect(box.querySelector('[data-tier="none"]')).not.toBeNull());
    expect(box.querySelector('[data-tier="none"]')?.textContent).toBe(
      t("adminRevenue.benchmark.state.small_sample"),
    );
    expect(box.querySelector('[data-scale-state="small_sample"]')).not.toBeNull();
    expect(box.querySelector("[data-marker]")).toBeNull();
  });

  it("pusta baza (n = 0): „brak danych”, nie mała próba", async () => {
    const t = realT("pl");
    withClient(
      <MetricExplainer metricId="logo_churn_monthly" lang="pl" value={0} n={0} mode="full" />,
    );
    await open(CHURN.abbr);
    const box = await dialog();
    await waitFor(() => expect(box.querySelector('[data-why="no_data"]')).not.toBeNull());
    expect(box.querySelector('[data-scale-state="no_data"]')?.textContent).toContain(
      t("adminRevenue.benchmark.state.no_data"),
    );
  });

  it("kwota MRR wobec pasma realizacji planu: „inna wielkość”, bez poziomu", async () => {
    withClient(<MetricExplainer metricId="mrr" lang="pl" value={1_000_000} currency="PLN" />);
    await open("MRR");
    const box = await dialog();
    await waitFor(() => expect(box.querySelector('[data-tier="none"]')).not.toBeNull());
    expect(box.querySelectorAll("[data-dot]")).toHaveLength(0);
  });
});

describe("MetricExplainer - wskaźniki bez benchmarku i bez metryki", () => {
  it("metryka bez benchmarku: definicja z rejestru i jawny komunikat, bez zapytania", async () => {
    const t = realT("pl");
    withClient(<MetricExplainer metricId="sessions" lang="pl" mode="full" />);
    await open("Sesje");
    const box = await dialog();
    expect(box.textContent).toContain(metricById("sessions").definitionPl);
    expect(box.textContent).toContain(t("adminRevenue.benchmark.explainer.noBenchmark"));
    expect(h.fetchGroup).not.toHaveBeenCalled();
  });

  it("wpis bez metryki (NPS): „system tego nie mierzy” z powodem", async () => {
    const t = realT("pl");
    const nps = localized("community", "nps", "pl");
    withClient(<MetricExplainer benchKey="nps" lang="pl" mode="full" />);
    await open("NPS");
    const box = await dialog();
    await waitFor(() => expect(box.querySelector("[data-explainer-no-metric]")).not.toBeNull());
    expect(box.querySelector("[data-explainer-no-metric]")?.textContent).toContain(
      t("adminRevenue.benchmark.dictionary.noMetric"),
    );
    expect(box.textContent).toContain(nps.noMetricReason ?? "∅");
  });

  it("błąd odczytu: `role=alert` i „Spróbuj ponownie” ponawia zapytanie", async () => {
    const t = realT("pl");
    // `retry: 1` z fabryki zapytań: błąd widać po DRUGIEJ porażce.
    h.fetchGroup.mockRejectedValue(new Error("network"));
    withClient(<MetricExplainer metricId="arr" lang="pl" />);
    await open("ARR");
    const box = await dialog();
    const alert = await within(box).findByRole("alert", {}, { timeout: 5000 });
    expect(alert.textContent).toContain(t("adminRevenue.benchmark.explainer.error"));
    expect(h.fetchGroup).toHaveBeenCalledTimes(2);
    h.fetchGroup.mockImplementation(async ({ data }: { data: { group: never; lang: never } }) =>
      payloadFor(data.group, data.lang),
    );
    fireEvent.click(
      within(alert).getByRole("button", { name: t("adminRevenue.benchmark.explainer.retry") }),
    );
    await waitFor(() => expect(within(box).queryByRole("alert")).toBeNull());
    expect(h.fetchGroup).toHaveBeenCalledTimes(3);
  });
});

describe("MetricExplainer - język i dostępność", () => {
  it("EN: treść benchmarku i napisy po angielsku, zapytanie o grupę w EN", async () => {
    await i18n.changeLanguage("en");
    const en = realT("en");
    const churnEn = localized("retention", "logo_churn_monthly", "en");
    withClient(<MetricExplainer metricId="logo_churn_monthly" lang="en" mode="full" />);
    await open(churnEn.abbr, "en");
    const box = await dialog();
    await waitFor(() => expect(box.textContent).toContain(churnEn.levers));
    expect(box.textContent).toContain(en("adminRevenue.benchmark.explainer.levers"));
    expect(box.textContent).not.toContain(CHURN.levers);
    expect(h.fetchGroup).toHaveBeenCalledWith({ data: { group: "retention", lang: "en" } });
  });

  it("pełny dymek bez naruszeń axe", async () => {
    withClient(
      <MetricExplainer metricId="logo_churn_monthly" lang="pl" mode="full" value={0.03} n={100} />,
    );
    await open(CHURN.abbr);
    const box = await dialog();
    await waitFor(() => expect(box.querySelector("[data-source]")).not.toBeNull());
    expect(summarize(await axeViolations(document.body))).toBe("");
  });

  it("arkusz na telefonie bez naruszeń axe", async () => {
    viewport(false);
    withClient(<MetricExplainer metricId="arr" lang="pl" />);
    await open("ARR");
    const box = await dialog();
    await waitFor(() =>
      expect(box.textContent).toContain(localized("revenue", "arr", "pl").interpretation),
    );
    // Arkusz jest modalny: Radix ukrywa resztę strony (`aria-hidden`), więc
    // axe sprawdzamy na oknie - nie na tle, które czytnik i tak pomija.
    expect(summarize(await axeViolations(box))).toBe("");
  });
});
