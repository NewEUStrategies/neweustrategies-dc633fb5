// Atomy benchmarków: ikona objaśnienia, odznaka oceny, wybór kontekstu,
// przypis źródła (SPEC §6.1, §6.5; AD-20, K-08).
//
// PO CO. Ocena 5-stopniowa i przypisy to miejsca, w których POPRAWNIE
// policzona liczba może zostać BŁĘDNIE przeczytana:
//   1. ODZNAKA: kolor bez słowa (daltonizm), szare kropki udające najniższy
//      poziom przy braku oceny, słowo z niewłaściwego klucza;
//   2. IKONA: przycisk bez nazwy wskaźnika (kilkanaście nieodróżnialnych
//      „Objaśnień”), cel dotyku mniejszy niż 24 px, brak `aria-expanded`;
//   3. PRZYPIS: link bez autora i daty, brak ostrzeżenia, że liczba pochodzi
//      z fragmentu wyszukiwarki albo od dostawcy narzędzia.
// Napisy sprawdzamy prawdziwym słownikiem (PL i EN), treść - na prawdziwym
// rejestrze (fikstura `payloadFor` = odpowiedź server fn).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import type { BenchmarkEvaluation } from "@/lib/analytics/semantic/benchmarks/evaluate";
import type { LocalizedSource } from "@/lib/analytics/semantic/benchmarks/adapter";
import { tierOrder } from "@/lib/charts/benchmarkTier";
import { BenchmarkContextSelect } from "../atoms/BenchmarkContextSelect";
import { BenchmarkTierBadge } from "../atoms/BenchmarkTierBadge";
import { MetricHelpButton } from "../atoms/MetricHelpButton";
import { SourceCitation } from "../atoms/SourceCitation";
import { localized, payloadFor } from "./benchmarkFixtures";

function withClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
    queryClient,
  };
}

function rated(tier: Exclude<BenchmarkEvaluation["tier"], "none">): BenchmarkEvaluation {
  return {
    tier,
    band: { tier, min: 1, max: 2, basis: "B" },
    basis: "B",
    contextId: "x.y",
    direction: "higher",
    value: 1.5,
  };
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.fetchGroup.mockReset();
  h.fetchGroup.mockImplementation(async ({ data }: { data: { group: never; lang: never } }) =>
    payloadFor(data.group, data.lang),
  );
});
afterEach(cleanup);

describe("BenchmarkTierBadge - ocena kropkami i słowem", () => {
  it.each(tierOrder().map((tier, i) => [tier, i + 1] as const))(
    "%s: %i wypełnionych kropek z pięciu i słowo oceny",
    (tier, rank) => {
      const t = realT("pl");
      const { container } = render(<BenchmarkTierBadge evaluation={rated(tier)} />);
      const badge = container.querySelector(`[data-tier="${tier}"]`);
      expect(badge).not.toBeNull();
      expect(container.querySelectorAll("[data-dot]")).toHaveLength(5);
      expect(container.querySelectorAll('[data-dot="on"]')).toHaveLength(rank);
      // Kropki są dekoracją - dostępna treść to SAMO słowo.
      expect(
        container.querySelector('[aria-hidden="true"]')?.querySelectorAll("[data-dot]"),
      ).toHaveLength(5);
      expect(badge?.textContent).toBe(t(`adminRevenue.benchmark.tier.${tier}`));
    },
  );

  it("pięć poziomów to pięć RÓŻNYCH słów - żadne dwa nie zlewają się w jeden napis", () => {
    const words = tierOrder().map((tier) => {
      const view = render(<BenchmarkTierBadge evaluation={rated(tier)} />);
      const text = view.container.textContent;
      view.unmount();
      return text;
    });
    expect(new Set(words).size).toBe(5);
  });

  it("brak oceny NIE ma kropek - mówi powód słowem (nigdy szary poziom)", () => {
    const t = realT("pl");
    const { container } = render(
      <BenchmarkTierBadge evaluation={{ tier: "none", why: "small_sample", contextId: "x" }} />,
    );
    expect(container.querySelectorAll("[data-dot]")).toHaveLength(0);
    expect(container.querySelector('[data-tier="none"]')?.getAttribute("data-why")).toBe(
      "small_sample",
    );
    expect(container.textContent).toBe(t("adminRevenue.benchmark.state.small_sample"));
  });

  it("jawny język wygrywa z językiem interfejsu", () => {
    const en = realT("en");
    const { container } = render(<BenchmarkTierBadge evaluation={rated("optimal")} lang="en" />);
    expect(container.textContent).toBe(en("adminRevenue.benchmark.tier.optimal"));
  });

  it("geometria jest stała - motyw zmienia tylko kolor (tokeny ról, zero hex)", () => {
    const { container } = render(<BenchmarkTierBadge evaluation={rated("good")} size="md" />);
    const html = container.innerHTML;
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(html).toContain("var(--chart-");
    expect(container.querySelector('[data-dot="on"]')?.className).toContain("h-2 w-2");
  });

  it("nie wnosi naruszeń axe (ocena i brak oceny)", async () => {
    const { container } = render(
      <div>
        <BenchmarkTierBadge evaluation={rated("weak")} />
        <BenchmarkTierBadge evaluation={{ tier: "none", why: "currency_mismatch" }} />
      </div>,
    );
    expect(summarize(await axeViolations(container))).toBe("");
  });
});

describe("MetricHelpButton - wyzwalacz objaśnienia", () => {
  it("nazwa z wskaźnikiem, typ button, `aria-haspopup=dialog` i `aria-expanded`", () => {
    const t = realT("pl");
    withClient(<MetricHelpButton metricId="mrr" lang="pl" name="MRR" expanded={false} />);
    const button = screen.getByRole("button", {
      name: t("adminRevenue.benchmark.help.open", { name: "MRR" }),
    });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("cel dotyku 24 px wokół ikony 16 px (WCAG 2.5.8)", () => {
    withClient(<MetricHelpButton metricId="mrr" lang="pl" name="MRR" expanded />);
    const button = screen.getByRole("button");
    expect(button.className).toContain("h-6 w-6");
    expect(button.querySelector("svg")?.getAttribute("class")).toContain("h-4 w-4");
    expect(button).toHaveAttribute("aria-expanded", "true");
  });

  it("najechanie i fokus pobierają WSTĘPNIE grupę benchmarku wskaźnika", async () => {
    const { queryClient } = withClient(
      <MetricHelpButton
        metricId="logo_churn_monthly"
        lang="en"
        name="Logo churn"
        expanded={false}
      />,
    );
    fireEvent.pointerEnter(screen.getByRole("button"));
    await waitFor(() => expect(h.fetchGroup).toHaveBeenCalledTimes(1));
    expect(h.fetchGroup).toHaveBeenCalledWith({ data: { group: "retention", lang: "en" } });
    await waitFor(() =>
      expect(queryClient.getQueryData(["benchmarks", "retention", "en"])).toBeTruthy(),
    );
    // Drugi sygnał nie pobiera ponownie - treść jest w cache na całą sesję.
    fireEvent.focus(screen.getByRole("button"));
    await waitFor(() => expect(h.fetchGroup).toHaveBeenCalledTimes(1));
  });

  it("metryka bez benchmarku nie pobiera niczego", async () => {
    withClient(<MetricHelpButton metricId="sessions" lang="pl" name="Sesje" expanded={false} />);
    fireEvent.pointerEnter(screen.getByRole("button"));
    fireEvent.focus(screen.getByRole("button"));
    await new Promise((r) => setTimeout(r, 0));
    expect(h.fetchGroup).not.toHaveBeenCalled();
  });

  it("w EN etykieta przycisku jest angielska", () => {
    const en = realT("en");
    withClient(<MetricHelpButton benchKey="nps" lang="en" name="NPS" expanded={false} />);
    expect(
      screen.getByRole("button", { name: en("adminRevenue.benchmark.help.open", { name: "NPS" }) }),
    ).toBeInTheDocument();
  });

  it("nie wnosi naruszeń axe", async () => {
    const { container } = withClient(
      <MetricHelpButton metricId="arr" lang="pl" name="ARR" expanded={false} />,
    );
    expect(summarize(await axeViolations(container))).toBe("");
  });
});

describe("BenchmarkContextSelect - wspólny Select z etykietą", () => {
  const churn = localized("retention", "logo_churn_monthly", "pl");

  it("lista nazwana etykietą „Kontekst porównania” pokazuje bieżący kontekst", () => {
    const t = realT("pl");
    render(
      <BenchmarkContextSelect bench={churn} value={churn.contexts[1].id} onChange={() => {}} />,
    );
    const select = screen.getByRole("combobox", {
      name: t("adminRevenue.benchmark.explainer.context"),
    });
    expect(select).toHaveTextContent(churn.contexts[1].label);
  });

  it("wybór innego kontekstu oddaje jego identyfikator", async () => {
    const onChange = vi.fn();
    render(
      <BenchmarkContextSelect bench={churn} value={churn.contexts[0].id} onChange={onChange} />,
    );
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: churn.contexts[2].label }));
    expect(onChange).toHaveBeenCalledWith(churn.contexts[2].id);
  });

  it("jeden kontekst to brak wyboru - sam napis, bez pustej listy", () => {
    const single = { key: "x", contexts: [churn.contexts[0]] };
    render(
      <BenchmarkContextSelect bench={single} value={churn.contexts[0].id} onChange={() => {}} />,
    );
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText(churn.contexts[0].label)).toBeInTheDocument();
  });

  it("nie wnosi naruszeń axe", async () => {
    const { container } = render(
      <BenchmarkContextSelect bench={churn} value={churn.contexts[0].id} onChange={() => {}} />,
    );
    expect(summarize(await axeViolations(container))).toBe("");
  });
});

describe("SourceCitation - przypis chicagowski z odznakami jakości", () => {
  const sources = payloadFor("retention", "pl").sources;
  const pick = (pred: (s: LocalizedSource) => boolean): LocalizedSource => {
    const found = sources.find(pred);
    if (!found) throw new Error("fikstura: brak źródła o tej cesze");
    return found;
  };

  it("autor, tytuł jako dzieło, data publikacji, data dostępu i bezpieczny odsyłacz", () => {
    const s = pick((x) => x.verification === "full");
    const { container } = render(<SourceCitation source={s} lang="pl" />);
    expect(container.textContent).toContain(s.publisher);
    expect(container.querySelector("cite")?.textContent).toBe(s.title.replace(/[.]$/, ""));
    expect(container.textContent).toContain(`Dostęp ${s.accessed}`);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", new URL(s.url).toString());
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("fragment z wyszukiwarki i dostawca narzędzia mają odznaki słowne", () => {
    const t = realT("pl");
    const snippet = pick((x) => x.verification === "snippet");
    const vendor = pick((x) => x.vendor === true && x.verification === "full");
    const a = render(<SourceCitation source={snippet} lang="pl" />);
    expect(a.container.querySelector('[data-badge="snippet"]')?.textContent).toBe(
      t("adminRevenue.benchmark.source.snippet"),
    );
    a.unmount();
    const b = render(<SourceCitation source={vendor} lang="pl" />);
    expect(b.container.querySelector('[data-badge="vendor"]')?.textContent).toBe(
      t("adminRevenue.benchmark.source.vendor"),
    );
    expect(b.container.querySelector('[data-badge="snippet"]')).toBeNull();
  });

  it("źródło starsze niż 18 miesięcy ma znacznik, młodsze - nie", () => {
    const base = pick(() => true);
    const old = render(<SourceCitation source={{ ...base, ageMonths: 19 }} lang="pl" />);
    expect(old.container.querySelector('[data-badge="stale"]')).not.toBeNull();
    old.unmount();
    const fresh = render(<SourceCitation source={{ ...base, ageMonths: 18 }} lang="pl" />);
    expect(fresh.container.querySelector('[data-badge="stale"]')).toBeNull();
  });

  it("wiarygodność ma opis słowny dla czytnika, nie samą literę", () => {
    const t = realT("pl");
    const s = pick((x) => x.reliability === "C");
    const { container } = render(<SourceCitation source={s} lang="pl" />);
    expect(container.querySelector(".sr-only")?.textContent).toBe(
      t("adminRevenue.benchmark.source.reliability_C"),
    );
  });

  it("adres spoza http(s) nie staje się odsyłaczem", () => {
    const base = pick(() => true);
    render(<SourceCitation source={{ ...base, url: "javascript:alert(1)" }} lang="pl" />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("w EN przypis i odznaki są angielskie", () => {
    const en = realT("en");
    const s = payloadFor("retention", "en").sources.find((x) => x.verification === "snippet");
    if (!s) throw new Error("fikstura");
    const { container } = render(<SourceCitation source={s} lang="en" />);
    expect(container.textContent).toContain("Accessed");
    expect(container.textContent).toContain(en("adminRevenue.benchmark.source.snippet"));
  });

  it("nie wnosi naruszeń axe", async () => {
    const { container } = render(<SourceCitation source={pick(() => true)} lang="pl" />);
    expect(summarize(await axeViolations(container))).toBe("");
  });
});
