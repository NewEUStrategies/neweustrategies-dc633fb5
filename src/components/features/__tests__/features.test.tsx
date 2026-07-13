// Render + a11y (axe) dla modułu NES Digital Features. happy-dom nie odpala
// IntersectionObservera, więc komponenty z animacją renderują stan KOŃCOWY
// ("static") - to, co widzi crawler / czytelnik bez JS. Mapa korytarzy zależy
// od React Query (geometria), więc jej render-test żyje osobno; tutaj czyste,
// bezsieciowe widoki.
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { axeViolations, summarize } from "@/test/axe";
import { Timeline } from "../Timeline";
import { SankeyDiagram } from "../SankeyDiagram";
import { CountryCompare } from "../CountryCompare";
import { RiskMatrix } from "../RiskMatrix";
import { IndicatorCard } from "../IndicatorCard";
import { RelationNetwork } from "../RelationNetwork";
import { SourceLibrary } from "../SourceLibrary";
import { MethodologyNote } from "../MethodologyNote";
import { parseBiText } from "@/lib/features/parse";

const bi = parseBiText;

describe("Timeline", () => {
  const config = {
    title: "Oś",
    description: "opis",
    source: "Źródło: test",
    animate: true,
    events: [
      { date: "2024", title: bi("A|A"), description: bi("da|da"), colorSlot: 1 },
      { date: "2025", title: bi("B|B"), description: bi(""), colorSlot: null },
    ],
  };
  it("renders each event as a list item", () => {
    const { container } = render(<Timeline config={config} lang="pl" />);
    expect(container.querySelectorAll("ol > li")).toHaveLength(2);
    expect(screen.getByText("2024")).toBeTruthy();
  });
  it("shows an empty state with no events", () => {
    render(<Timeline config={{ ...config, events: [] }} lang="en" />);
    expect(screen.getByText("No timeline events.")).toBeTruthy();
  });
  it("has no axe violations", async () => {
    const { container } = render(<Timeline config={config} lang="pl" />);
    const v = await axeViolations(container);
    expect(v, summarize(v)).toEqual([]);
  });
});

describe("SankeyDiagram", () => {
  const config = {
    title: "Przepływy",
    description: "",
    source: "",
    unit: " mld",
    height: 320,
    animate: true,
    flows: [
      { from: bi("A|A"), to: bi("C|C"), value: 10 },
      { from: bi("B|B"), to: bi("C|C"), value: 5 },
    ],
  };
  it("draws one band per flow and a data table row per flow", () => {
    const { container } = render(<SankeyDiagram config={config} lang="pl" />);
    expect(container.querySelectorAll("path.nes-sankey-band")).toHaveLength(2);
  });
  it("has no axe violations", async () => {
    const { container } = render(<SankeyDiagram config={config} lang="pl" />);
    const v = await axeViolations(container);
    expect(v, summarize(v)).toEqual([]);
  });
});

describe("CountryCompare", () => {
  const config = {
    title: "Porównanie",
    description: "",
    source: "",
    columns: [bi("PL"), bi("DE")],
    highlight: 0,
    showBars: true,
    rows: [
      { indicator: bi("Wydatki|Spending"), unit: "% PKB", values: [4.1, 2.1] },
      { indicator: bi("Gaz|Gas"), unit: "%", values: [62, null] },
    ],
  };
  it("renders a table with a header per column and rows per indicator", () => {
    const { container } = render(<CountryCompare config={config} lang="pl" />);
    expect(container.querySelectorAll("thead th")).toHaveLength(3); // wskaźnik + 2 kolumny
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
  });
  it("renders a dash for null values", () => {
    render(<CountryCompare config={config} lang="pl" />);
    expect(screen.getByText("—")).toBeTruthy();
  });
  it("has no axe violations", async () => {
    const { container } = render(<CountryCompare config={config} lang="en" />);
    const v = await axeViolations(container);
    expect(v, summarize(v)).toEqual([]);
  });
});

describe("RiskMatrix", () => {
  const config = {
    title: "Ryzyko",
    description: "",
    source: "",
    animate: true,
    axisXLabel: "",
    axisYLabel: "",
    items: [
      { name: bi("R1|R1"), description: bi(""), likelihood: 3, impact: 5 },
      { name: bi("R2|R2"), description: bi(""), likelihood: 4, impact: 2 },
    ],
  };
  it("renders a 5x5 grid (25 cells)", () => {
    const { container } = render(<RiskMatrix config={config} lang="pl" />);
    expect(container.querySelectorAll(".grid-cols-5 > div")).toHaveLength(25);
  });
  it("has no axe violations", async () => {
    const { container } = render(<RiskMatrix config={config} lang="pl" />);
    const v = await axeViolations(container);
    expect(v, summarize(v)).toEqual([]);
  });
});

describe("IndicatorCard", () => {
  const config = {
    label: "Indeks",
    value: "72,4",
    unit: "/100",
    delta: "+5,1",
    deltaLabel: "r/r",
    deltaArrow: "up" as const,
    deltaTone: "positive" as const,
    spark: [58, 61, 60, 64, 72.4],
    source: "Źródło: NES",
    href: "",
  };
  it("renders the value and delta", () => {
    render(<IndicatorCard config={config} />);
    expect(screen.getByText("72,4")).toBeTruthy();
    expect(screen.getByText("+5,1")).toBeTruthy();
  });
  it("renders as a link when href is set", () => {
    const { container } = render(<IndicatorCard config={{ ...config, href: "/tracker" }} />);
    expect(container.querySelector('a[href="/tracker"]')).not.toBeNull();
  });
  it("has no axe violations", async () => {
    const { container } = render(<IndicatorCard config={config} />);
    const v = await axeViolations(container);
    expect(v, summarize(v)).toEqual([]);
  });
});

describe("RelationNetwork", () => {
  const config = {
    title: "Sieć",
    description: "",
    source: "",
    height: 400,
    animate: true,
    edges: [
      { a: bi("A|A"), b: bi("B|B"), strength: 3, label: bi("rel|rel") },
      { a: bi("B|B"), b: bi("C|C"), strength: 2, label: bi("") },
    ],
    groups: [{ node: bi("A|A"), group: bi("G1|G1") }],
  };
  it("renders a node circle per unique node and an edge path per edge", () => {
    const { container } = render(<RelationNetwork config={config} lang="pl" />);
    expect(container.querySelectorAll("g.nes-network-node")).toHaveLength(3); // A,B,C
    expect(container.querySelectorAll("path.nes-network-edge")).toHaveLength(2);
  });
  it("has no axe violations", async () => {
    const { container } = render(<RelationNetwork config={config} lang="pl" />);
    const v = await axeViolations(container);
    expect(v, summarize(v)).toEqual([]);
  });
});

describe("SourceLibrary", () => {
  const config = {
    title: "Źródła",
    description: "",
    source: "",
    sort: "authored" as const,
    showSearch: true,
    entries: [
      {
        kind: bi("Raport|Report"),
        year: "2024",
        title: bi("Alfa|Alpha"),
        publisher: bi("KE|EC"),
        url: "https://x",
      },
      {
        kind: bi("Dane|Data"),
        year: "2025",
        title: bi("Beta|Beta"),
        publisher: bi("Eurostat"),
        url: "",
      },
    ],
  };
  it("lists all entries and filters by search query", () => {
    render(<SourceLibrary config={config} lang="pl" />);
    expect(screen.getByText("Alfa")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Szukaj w źródłach..."), { target: { value: "alfa" } });
    expect(screen.getByText("Alfa")).toBeTruthy();
    expect(screen.queryByText("Beta")).toBeNull();
  });
  it("has no axe violations", async () => {
    const { container } = render(<SourceLibrary config={config} lang="pl" />);
    const v = await axeViolations(container);
    expect(v, summarize(v)).toEqual([]);
  });
});

describe("MethodologyNote", () => {
  const config = {
    title: "Metodologia",
    version: "1.0",
    updated: "2026-07",
    html: "<p>Dane z Eurostatu.</p>",
    defaultOpen: true,
  };
  it("renders sanitized HTML content", () => {
    render(<MethodologyNote config={config} lang="pl" />);
    expect(screen.getByText("Dane z Eurostatu.")).toBeTruthy();
  });
  it("strips dangerous markup", () => {
    const { container } = render(
      <MethodologyNote
        config={{ ...config, html: "<p>ok</p><script>alert(1)</script>" }}
        lang="pl"
      />,
    );
    expect(container.querySelector("script")).toBeNull();
  });
  it("has no axe violations", async () => {
    const { container } = render(<MethodologyNote config={config} lang="en" />);
    const v = await axeViolations(container);
    expect(v, summarize(v)).toEqual([]);
  });
});
