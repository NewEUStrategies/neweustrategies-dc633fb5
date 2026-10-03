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

// INTERAKCJE CECH. Testy wyżej sprawdzają render i dostępność; podświetlenie
// (wskaźnik i klawiatura), filtr typów źródeł i sortowanie po roku nie miały
// wykonania. Podświetlenie z klawiatury jest tu kontraktem, nie ozdobą: węzeł
// sieci jest przystankiem tabulatora, więc fokus musi dawać ten sam skutek
// co najechanie - inaczej osoba z klawiaturą nie ma jak wyróżnić relacji.
describe("Interakcje cech", () => {
  const network = {
    title: "Sieć",
    description: "",
    source: "",
    height: 400,
    animate: false,
    edges: [
      { a: bi("A|A"), b: bi("B|B"), strength: 3, label: bi("rel|rel") },
      { a: bi("B|B"), b: bi("C|C"), strength: 2, label: bi("") },
    ],
    groups: [],
  };

  it("RelationNetwork: fokus i najechanie na węzeł przygaszają pozostałe, wyjście przywraca", () => {
    const { container } = render(<RelationNetwork config={network} lang="pl" />);
    const nodes = Array.from(container.querySelectorAll<SVGGElement>("g.nes-network-node"));
    const dimmed = () => nodes.filter((n) => n.hasAttribute("data-dim")).length;

    fireEvent.focus(nodes[0] as SVGGElement);
    expect(dimmed()).toBe(2);
    fireEvent.blur(nodes[0] as SVGGElement);
    expect(dimmed()).toBe(0);

    fireEvent.pointerEnter(nodes[1] as SVGGElement);
    expect(dimmed()).toBe(2);
    expect(nodes[1]?.hasAttribute("data-dim")).toBe(false);
    fireEvent.pointerLeave(nodes[1] as SVGGElement);
    expect(dimmed()).toBe(0);
  });

  it("SankeyDiagram: najechanie na wstęgę wyróżnia ją i przygasza resztę", () => {
    const sankey = {
      title: "Przepływy",
      description: "",
      source: "",
      unit: " mld",
      height: 320,
      animate: false,
      flows: [
        { from: bi("A|A"), to: bi("C|C"), value: 10 },
        { from: bi("B|B"), to: bi("C|C"), value: 5 },
      ],
    };
    const { container } = render(<SankeyDiagram config={sankey} lang="pl" />);
    const bands = Array.from(container.querySelectorAll<SVGPathElement>("path.nes-sankey-band"));
    fireEvent.pointerEnter(bands[0] as SVGPathElement);
    expect(bands[0]?.getAttribute("data-active")).toBe("true");
    expect(bands[1]?.getAttribute("data-dim")).toBe("true");
    fireEvent.pointerLeave(bands[0] as SVGPathElement);
    expect(bands.some((b) => b.hasAttribute("data-dim"))).toBe(false);
  });

  it("SourceLibrary: chipy typów filtrują, „Wszystkie” wraca, sortowanie od najnowszych", () => {
    render(
      <SourceLibrary
        config={{
          title: "Źródła",
          description: "",
          source: "",
          sort: "year-desc" as const,
          showSearch: false,
          entries: [
            {
              kind: bi("Raport|Report"),
              year: "2019",
              title: bi("Stary"),
              publisher: bi("KE"),
              url: "",
            },
            {
              kind: bi("Dane|Data"),
              year: "2025",
              title: bi("Nowy"),
              publisher: bi("GUS"),
              url: "",
            },
            {
              kind: bi("Raport|Report"),
              year: "brak",
              title: bi("Bez roku"),
              publisher: bi("X"),
              url: "",
            },
          ],
        }}
        lang="en"
      />,
    );
    const titles = () => screen.getAllByRole("listitem").map((r) => r.textContent ?? "");
    // Najnowszy pierwszy, rok nieliczbowy na końcu.
    expect(titles()[0]).toContain("Nowy");
    expect(titles().at(-1)).toContain("Bez roku");

    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    expect(screen.queryByText("Nowy")).toBeNull();
    expect(screen.getByRole("button", { name: "Report" }).getAttribute("aria-pressed")).toBe(
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("Nowy")).toBeTruthy();
  });
});
