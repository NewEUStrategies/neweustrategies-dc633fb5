// `FunnelBars` - wspólny organizm lejka (SPEC §6.1, §6.2): lejek huba, lejek
// reklam wydarzenia (`AdsFunnelBars` = nakładka) i przejścia kroków ścieżki.
//
// Klasy defektów:
//   1. PASKI NIE ZWĘŻAJĄ SIĘ - szerokość względem poprzedniego kroku.
//   2. ZEROWY MIANOWNIK = „0%” albo „NaN%” zamiast kreski.
//   3. ILORAZ MIĘDZY STRUMIENIAMI - wizyty (analityka ze zgodą) dzielone przez
//      rejestracje (księga) to dwie populacje; ma być powód, nie procent.
//   4. BRAK DANYCH JAKO ZERO - krok z `null` musi mówić „-”, nie „0”.
//   5. TEKSTY Z KOMPONENTU - lejek nie ma własnego słownika; teksty i formaty
//      podaje wołający (nakładka reklam odtwarza swój DOM).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import "@/test/i18nReal";
import { realT } from "@/test/i18nReal";
import { axeViolations, summarize } from "@/test/axe";
import "@/lib/i18n-admin-revenue-shell";
import { FunnelBars, type FunnelBarsLabels, type FunnelBarsStep } from "../FunnelBars";

const LABELS: FunnelBarsLabels = {
  list: "Lejek subskrypcji",
  empty: "Brak ruchu w oknie",
  ofPrevious: (percent) => `${percent} poprzedniego kroku`,
  crossStream: "Nieporównywalne źródła - dwie liczby, bez ilorazu",
};

function widths(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLDivElement>("[aria-hidden='true'] > div")].map(
    (bar) => bar.style.width,
  );
}

afterEach(cleanup);

describe("FunnelBars - lista, paski i udziały", () => {
  const steps: FunnelBarsStep[] = [
    { key: "reg", label: "Rejestracja", value: 400 },
    { key: "hit", label: "Paywall", value: 100 },
    { key: "paid", label: "Płatność", value: 10 },
  ];

  it("lista nazwana przez wołającego, wiersz = etykieta + wartość jako tekst", () => {
    render(<FunnelBars steps={steps} labels={LABELS} />);
    const list = screen.getByRole("list", { name: LABELS.list });
    const items = list.querySelectorAll("li");
    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toBe("Rejestracja400");
  });

  it("szerokość względem PIERWSZEGO kroku, udział względem POPRZEDNIEGO", () => {
    const { container } = render(<FunnelBars steps={steps} labels={LABELS} />);
    expect(widths(container)).toEqual(["100%", "25%", "3%"]);
    expect(screen.getByText("25% poprzedniego kroku")).toBeInTheDocument();
    expect(screen.getByText("10% poprzedniego kroku")).toBeInTheDocument();
  });

  it("jawny `rate` z danych wygrywa z ilorazem wartości; `null` = kreska", () => {
    render(
      <FunnelBars
        steps={[
          { key: "a", label: "A", value: 100 },
          { key: "b", label: "B", value: 50, rate: 0.42 },
          { key: "c", label: "C", value: 5, rate: null },
        ]}
        labels={LABELS}
      />,
    );
    expect(screen.getByText("42% poprzedniego kroku")).toBeInTheDocument();
    expect(screen.getByText("— poprzedniego kroku")).toBeInTheDocument();
  });

  it("zerowy mianownik to kreska, nie 0% ani NaN%", () => {
    const { container } = render(
      <FunnelBars
        steps={[
          { key: "a", label: "A", value: 10 },
          { key: "b", label: "B", value: 0 },
          { key: "c", label: "C", value: 0 },
        ]}
        labels={LABELS}
      />,
    );
    expect(screen.getByText("0% poprzedniego kroku")).toBeInTheDocument();
    expect(screen.getByText("— poprzedniego kroku")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/NaN|Infinity/);
  });

  it("krok bez danych (`null`): „-” zamiast zera, pusty pasek, brak ilorazu", () => {
    const { container } = render(
      <FunnelBars
        steps={[
          { key: "a", label: "A", value: 100 },
          { key: "b", label: "B", value: null },
          { key: "c", label: "C", value: 20 },
        ]}
        labels={LABELS}
      />,
    );
    const items = container.querySelectorAll("li");
    expect(items[1]?.textContent).toContain("B-");
    expect(widths(container)).toEqual(["100%", "0%", "20%"]);
    expect(screen.getAllByText("— poprzedniego kroku")).toHaveLength(2);
  });

  it("granica strumieni: powód zamiast procentu (iloraz dwóch populacji nie istnieje)", () => {
    render(
      <FunnelBars
        steps={[
          { key: "v", label: "Wizyty", value: 10_000, stream: "first_party" },
          { key: "r", label: "Rejestracje", value: 400, stream: "lifecycle" },
          { key: "p", label: "Płatności", value: 40, stream: "lifecycle" },
        ]}
        labels={LABELS}
      />,
    );
    expect(screen.getByText(LABELS.crossStream ?? "∅")).toBeInTheDocument();
    expect(screen.getByText("10% poprzedniego kroku")).toBeInTheDocument();
    expect(screen.queryByText("4% poprzedniego kroku")).toBeNull();
  });

  it("same zera albo brak kroków - zdanie wołającego zamiast pustych pasków", () => {
    render(<FunnelBars steps={[{ key: "a", label: "A", value: 0 }]} labels={LABELS} />);
    expect(screen.getByText(LABELS.empty)).toBeInTheDocument();
    cleanup();
    render(<FunnelBars steps={[]} labels={LABELS} />);
    expect(screen.getByText(LABELS.empty)).toBeInTheDocument();
  });
});

describe("FunnelBars - formaty, odnośniki, ocena, warianty", () => {
  it("formatery wstrzykiwane: wartość i udział w formacie wołającego", () => {
    render(
      <FunnelBars
        steps={[
          { key: "a", label: "A", value: 12_345 },
          { key: "b", label: "B", value: 1_234 },
        ]}
        labels={LABELS}
        formatValue={(v) => v.toLocaleString("pl-PL")}
        formatRate={(r) => (r === null ? "-" : `${(r * 100).toFixed(1)} %`)}
      />,
    );
    expect(screen.getByText("12 345")).toBeInTheDocument();
    expect(screen.getByText("10.0 % poprzedniego kroku")).toBeInTheDocument();
  });

  it("krok z `href` prowadzi do szczegółów; ocena benchmarku słowem pod udziałem", () => {
    const t = realT("pl");
    render(
      <FunnelBars
        steps={[
          { key: "a", label: "Checkout", value: 100, href: "/admin/revenue/funnel" },
          {
            key: "b",
            label: "Płatność",
            value: 30,
            benchmark: {
              tier: "weak",
              band: { tier: "weak", min: 25, max: 38, basis: "B" },
              basis: "B",
              contextId: "x",
              direction: "higher",
              value: 30,
            },
          },
        ]}
        labels={LABELS}
      />,
    );
    expect(screen.getByRole("link", { name: "Checkout" })).toHaveAttribute(
      "href",
      "/admin/revenue/funnel",
    );
    expect(screen.getByText(t("adminRevenue.benchmark.tier.weak"))).toBeInTheDocument();
  });

  it("orientacja pozioma: karty kroków; wariant zwarty: niższe paski, bez oceny", () => {
    const { container } = render(
      <FunnelBars
        steps={[
          { key: "a", label: "A", value: 10 },
          { key: "b", label: "B", value: 5, benchmark: { tier: "none", why: "small_sample" } },
        ]}
        labels={LABELS}
        orientation="horizontal"
        variant="compact"
      />,
    );
    expect(container.querySelector("ol")?.className).toContain("grid");
    expect(container.querySelector("li")?.className).toContain("border");
    expect(container.querySelector("[aria-hidden='true']")?.className).toContain("h-1.5");
    expect(container.querySelector("[data-tier]")).toBeNull();
  });

  it("nie wnosi naruszeń axe", async () => {
    const { container } = render(
      <FunnelBars
        steps={[
          { key: "a", label: "A", value: 100, href: "/admin/revenue/funnel" },
          { key: "b", label: "B", value: 40, benchmark: { tier: "none", why: "no_benchmark" } },
        ]}
        labels={LABELS}
      />,
    );
    expect(summarize(await axeViolations(container))).toBe("");
  });
});
