// SYSTEM WYKRESÓW (specyfikacja 2026-10) w renderze: pasmo optimum i cel,
// paleta ról, etykiety przy końcu linii, legenda przełączająca serie, wiersze
// oceny w tooltipie, panel z przyciskami i przypisami, okno punktu, suwak
// zakresu i przypisy wykresu w sekcji przypisów artykułu.
//
// Każdy test pilnuje jednej reguły, która w renderze może zginąć po cichu:
// wykres dalej się rysuje, tylko przestaje mówić to, co obiecuje specyfikacja.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Json } from "@/lib/content-model/json";
import type { BlocksDoc } from "@/lib/blocks/types";
import { parseChartConfig } from "@/lib/charts/parse";
import { BAR_MAX } from "@/lib/charts/geometry";
import { Chart } from "../Chart";
import { CartesianChart } from "../CartesianChart";
import { BlocksRenderer } from "@/components/blocks/BlocksRenderer";

afterEach(cleanup);

const cfg = (data: Record<string, Json>) => parseChartConfig(data);
const all = (root: ParentNode, sel: string): Element[] => [...root.querySelectorAll(sel)];

const ZRODLO = {
  id: "bench",
  author: "Eurostat",
  title: "Benchmark CTR",
  container: "",
  publisher: "Eurostat",
  published: "2026-01-10",
  accessed: "2026-10-09",
  url: "https://example.org/benchmark",
  reliability: "A",
};

const WSKAZNIK: Record<string, Json> = {
  kind: "line",
  title: "CTR spada od 3 tygodni",
  unit: "%",
  categories: ["T1", "T2", "T3", "T4"],
  series: [{ name: "CTR", values: [4.2, 3.8, 3.1, 2.4] }],
  direction: "higher",
  provenance: "D",
  band: { min: 3, max: 5, sourceId: "bench" },
  target: { value: 4.5 },
  sources: [ZRODLO],
  animate: false,
};

describe("pasmo optimum i linia celu", () => {
  it("pasmo ze źródłem jest rysowane z etykietą „przedział”, a cel z etykietą „cel X”", () => {
    const { container } = render(<CartesianChart config={cfg(WSKAZNIK)} lang="pl" />);
    const band = container.querySelector("[data-role='optimum-band']");
    expect(band).not.toBeNull();
    expect(band?.textContent).toBe("przedział");
    const target = container.querySelector("[data-role='target']");
    expect(target?.textContent).toBe("cel 4,5%");
    expect(target?.querySelector("line")?.getAttribute("class")).toBe("neh-target-line");
  });

  it("pasmo BEZ źródła nie jest rysowane - przedział zgadywany nie istnieje", () => {
    const { container } = render(
      <CartesianChart config={cfg({ ...WSKAZNIK, sources: [] })} lang="pl" />,
    );
    expect(container.querySelector("[data-role='optimum-band']")).toBeNull();
  });

  it("pasmo demonstracyjne jest podpisane „optimum (demo)”", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({ ...WSKAZNIK, sources: [], band: { min: 3, max: 5, demo: true } })}
        lang="pl"
      />,
    );
    expect(container.querySelector("[data-role='optimum-band']")?.textContent).toBe(
      "optimum (demo)",
    );
  });

  it("jednostka stoi jako nazwa osi nad osią wartości", () => {
    const { container } = render(<CartesianChart config={cfg(WSKAZNIK)} lang="pl" />);
    expect(container.querySelector("[data-role='axis-unit']")?.textContent).toBe("%");
  });
});

describe("tooltip - wiersze oceny i źródło", () => {
  it("wskaźnik dostaje Zmianę, Status ze słowem i Znaczenie oraz linię źródła", () => {
    const { container } = render(<CartesianChart config={cfg(WSKAZNIK)} lang="pl" />);
    const el = container.querySelector<HTMLElement>("[role='img']") as HTMLElement;
    fireEvent.keyDown(el, { key: "ArrowRight" });
    fireEvent.keyDown(el, { key: "ArrowRight" }); // T2: 3,8% po 4,2%
    const tip = container.querySelector(".neh-tooltip") as HTMLElement;
    expect(tip.querySelector(".neh-tip-head")?.textContent).toBe("T2");
    const facts = all(tip, ".neh-tip-facts dt").map((d) => d.textContent);
    expect(facts).toEqual(["Zmiana", "Status", "Znaczenie"]);
    const values = all(tip, ".neh-tip-facts dd").map((d) => d.textContent);
    expect(values[0]).toBe("-9,5%");
    expect(values[1]).toBe("✓ w normie");
    expect(tip.querySelector(".neh-tip-source")?.textContent).toBe("Źródło: Twoje dane");
  });

  it("wykres bez kierunku i pasma nie ocenia - zostaje sama zmiana", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({ ...WSKAZNIK, direction: null, band: null, provenance: null })}
        lang="pl"
      />,
    );
    const el = container.querySelector<HTMLElement>("[role='img']") as HTMLElement;
    fireEvent.keyDown(el, { key: "ArrowRight" });
    fireEvent.keyDown(el, { key: "ArrowRight" });
    const tip = container.querySelector(".neh-tooltip") as HTMLElement;
    expect(all(tip, ".neh-tip-facts dt").map((d) => d.textContent)).toEqual(["Zmiana"]);
    expect(tip.querySelector(".neh-tip-source")).toBeNull();
  });
});

describe("panel wykresu", () => {
  it("podtytuł niesie jednostkę, źródło z literą pochodzenia i numer przypisu", () => {
    const { container } = render(<Chart config={cfg(WSKAZNIK)} lang="pl" />);
    const sub = container.querySelector(".neh-panel-sub") as HTMLElement;
    expect(sub.textContent).toBe("%. Źródło: Twoje dane (D)1");
    expect(within(sub).getByRole("button", { name: "Przypis 1 - pokaż źródło" })).toBeTruthy();
  });

  it("figure jest nazwany tytułem, a znaczek „demo” stoi przy danych demonstracyjnych", () => {
    const { container } = render(<Chart config={cfg({ ...WSKAZNIK, demo: true })} lang="pl" />);
    const figure = container.querySelector("figure") as HTMLElement;
    const titleId = figure.getAttribute("aria-labelledby") ?? "";
    expect(document.getElementById(titleId)?.textContent).toContain("CTR spada od 3 tygodni");
    expect(container.querySelector(".neh-badge")?.textContent).toBe("demo");
    expect(container.querySelector(".neh-panel-sub")?.textContent).toContain("Źródło: dane demo");
  });

  it("przyciski po prawej: jak czytać, powiększ, PNG, SVG", () => {
    render(<Chart config={cfg(WSKAZNIK)} lang="pl" />);
    expect(screen.getByRole("button", { name: "Jak czytać ten wykres" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Powiększ wykres" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Zapisz wykres jako PNG" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Zapisz wykres jako SVG" })).toBeTruthy();
  });

  it("„i” otwiera okno z opisem elementów, kolorów, pasma i listą źródeł", () => {
    render(<Chart config={cfg(WSKAZNIK)} lang="pl" />);
    fireEvent.click(screen.getByRole("button", { name: "Jak czytać ten wykres" }));
    const dialog = document.querySelector("dialog.neh-dialog[open]") as HTMLElement;
    expect(dialog.textContent).toContain("Jak czytać wykres");
    expect(dialog.textContent).toContain("Jedna seria w akcencie");
    expect(dialog.textContent).toContain("Pasmo i cel");
    expect(dialog.textContent).toContain("Benchmark CTR");
  });

  it("przypis otwiera okno z opisem, wiarygodnością, datami i linkiem", () => {
    render(<Chart config={cfg(WSKAZNIK)} lang="pl" />);
    fireEvent.click(screen.getByRole("button", { name: "Przypis 1 - pokaż źródło" }));
    const dialog = [...document.querySelectorAll("dialog.neh-dialog[open]")].at(-1) as HTMLElement;
    expect(dialog.textContent).toContain("Przypis 1");
    expect(dialog.textContent).toContain("A - źródło pierwotne");
    expect(dialog.textContent).toContain("2026-01-10");
    expect(dialog.textContent).toContain("2026-10-09");
    const link = within(dialog).getByRole("link", { name: "Otwórz źródło w nowej karcie" });
    expect(link.getAttribute("href")).toBe("https://example.org/benchmark");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(within(dialog).getByRole("button", { name: "Kopiuj link" })).toBeTruthy();
  });

  it("ramka „Jak czytać” stoi obok wykresu z trzema częściami", () => {
    const { container } = render(
      <Chart
        config={cfg({
          ...WSKAZNIK,
          notesShows: "Spadek CTR.",
          notesSurprising: "Spadek mimo wzrostu wyświetleń.",
          notesHidden: "Nie pokazuje pozycji w wynikach.",
        })}
        lang="pl"
      />,
    );
    const aside = container.querySelector("aside.neh-read") as HTMLElement;
    expect(all(aside, "dt").map((d) => d.textContent)).toEqual([
      "Co pokazuje",
      "Co zaskakuje",
      "Czego nie pokazuje",
    ]);
  });

  it("wariant osadzony (karta pulpitu) nie dokłada przycisków ani drugiej karty", () => {
    render(<Chart config={cfg({ ...WSKAZNIK, title: "" })} lang="pl" variant="embedded" />);
    expect(screen.queryByRole("button", { name: "Powiększ wykres" })).toBeNull();
  });
});

describe("okno punktu - definicja wskaźnika i kliknięta wartość", () => {
  it("Enter na punkcie otwiera okno z wartością, statusem, kierunkiem i przedziałem", () => {
    const { container } = render(
      <Chart
        config={cfg({
          ...WSKAZNIK,
          metric: {
            name: "CTR",
            formula: "kliknięcia / wyświetlenia",
            reading: "Porównuj z pozycją.",
          },
        })}
        lang="pl"
      />,
    );
    const el = container.querySelector<HTMLElement>("[role='img']") as HTMLElement;
    fireEvent.keyDown(el, { key: "ArrowRight" });
    fireEvent.keyDown(el, { key: "ArrowRight" });
    fireEvent.keyDown(el, { key: "ArrowRight" });
    fireEvent.keyDown(el, { key: "ArrowRight" }); // T4: 2,4% - poniżej przedziału
    fireEvent.keyDown(el, { key: "Enter" });
    const dialog = [...document.querySelectorAll("dialog.neh-dialog[open]")].at(-1) as HTMLElement;
    expect(dialog.textContent).toContain("CTR · T4");
    const terms = all(dialog, "dt").map((d) => d.textContent);
    expect(terms).toEqual([
      "Wartość",
      "Status",
      "Zmiana",
      "Jednostka",
      "Kierunek",
      "Przedział",
      "Wzór",
    ]);
    expect(dialog.textContent).toContain("▼ poniżej przedziału");
    expect(dialog.textContent).toContain("wyżej znaczy lepiej");
    expect(dialog.textContent).toContain("Porównuj z pozycją.");
  });
});

describe("serie: paleta ról, legenda, etykiety przy końcu linii", () => {
  const DWIE: Record<string, Json> = {
    kind: "line",
    categories: ["a", "b", "c", "d"],
    series: [
      { name: "Główna", values: [1, 2, 3, 4] },
      { name: "Porównanie", values: [2, 2, 2, 2] },
    ],
    animate: false,
  };

  it("2-4 serie linii: nazwy przy końcu linii zamiast legendy", () => {
    const { container } = render(<Chart config={cfg(DWIE)} lang="pl" />);
    expect(all(container, "[data-role='end-label']").map((t) => t.textContent)).toEqual([
      "Główna",
      "Porównanie",
    ]);
    expect(container.querySelector(".neh-legend")).toBeNull();
  });

  it("pierwsza seria w akcencie, druga w łupku", () => {
    const { container } = render(<CartesianChart config={cfg(DWIE)} lang="pl" />);
    const lines = all(container, "path.neh-line").map((l) => l.getAttribute("stroke"));
    expect(lines).toEqual(["var(--chart-accent)", "var(--chart-s-main)"]);
  });

  it("pozycja legendy ukrywa i pokazuje serię", () => {
    const { container } = render(
      <Chart
        config={cfg({
          kind: "bar",
          categories: ["a", "b", "c"],
          series: [
            { name: "A", values: [1, 2, 3] },
            { name: "B", values: [3, 2, 1] },
          ],
          animate: false,
        })}
        lang="pl"
      />,
    );
    const button = within(container.querySelector(".neh-legend") as HTMLElement).getAllByRole(
      "button",
    )[1];
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(all(container, "[data-series-group]")).toHaveLength(2);
    fireEvent.click(button);
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(all(container, "[data-series-group]")).toHaveLength(1);
    fireEvent.click(button);
    expect(all(container, "[data-series-group]")).toHaveLength(2);
  });

  it("ostatniej widocznej serii nie da się ukryć", () => {
    const { container } = render(
      <Chart
        config={cfg({
          kind: "bar",
          categories: ["a", "b"],
          series: [
            { name: "A", values: [1, 2] },
            { name: "B", values: [2, 1] },
          ],
          animate: false,
        })}
        lang="pl"
      />,
    );
    const buttons = within(container.querySelector(".neh-legend") as HTMLElement).getAllByRole(
      "button",
    );
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    expect(all(container, "[data-series-group]")).toHaveLength(1);
  });
});

describe("słupki", () => {
  it("pełne, najwyżej 22 px, ujemna wartość pojedynczej serii w czerwieni", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "bar",
          categories: ["a", "b"],
          series: [{ name: "Saldo", values: [5, -3] }],
          animate: false,
        })}
        lang="pl"
      />,
    );
    const bars = all(container, "path[data-role='bar']");
    expect(bars[0].getAttribute("fill")).toBe("var(--chart-accent)");
    expect(bars[1].getAttribute("fill")).toBe("var(--chart-negative)");
    const xs = [...(bars[0].getAttribute("d") ?? "").matchAll(/h(-?[\d.]+)/g)].map((m) =>
      Math.abs(Number(m[1])),
    );
    expect(Math.max(...xs)).toBeLessThanOrEqual(BAR_MAX);
  });

  it("trzecia seria ma ukośne kreskowanie - czytelna bez koloru", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "bar",
          categories: ["a", "b"],
          series: [
            { name: "A", values: [1, 2] },
            { name: "B", values: [2, 1] },
            { name: "C", values: [3, 3] },
          ],
          animate: false,
        })}
        lang="pl"
      />,
    );
    expect(all(container, "path[data-role='bar-hatch']")).toHaveLength(2);
    expect(container.querySelector("pattern[id^='neh-bar-hatch-']")).not.toBeNull();
  });
});

describe("zakres osi powyżej 30 punktów", () => {
  const DLUGA: Record<string, Json> = {
    kind: "line",
    categories: Array.from({ length: 40 }, (_, i) => `D${i + 1}`),
    series: [{ name: "S", values: Array.from({ length: 40 }, (_, i) => i) }],
    animate: false,
  };

  it("suwak z dwoma uchwytami i oknem; klawiatura zawęża zakres", () => {
    const { container } = render(<CartesianChart config={cfg(DLUGA)} lang="pl" />);
    const sliders = screen.getAllByRole("slider");
    expect(sliders).toHaveLength(3);
    const start = screen.getByRole("slider", { name: "Początek zakresu" });
    for (let i = 0; i < 10; i++) fireEvent.keyDown(start, { key: "ArrowRight" });
    expect(start.getAttribute("aria-valuenow")).toBe("10");
    // Punkty powyżej progu nie są rysowane na stałe - 30 kategorii w oknie.
    expect(all(container, "path[data-role='series-point']")).toHaveLength(0);
  });

  it("krótka oś nie dostaje suwaka", () => {
    render(<CartesianChart config={cfg(WSKAZNIK)} lang="pl" />);
    expect(screen.queryAllByRole("slider")).toHaveLength(0);
  });
});

describe("przypisy wykresu w artykule", () => {
  it("źródła wykresu dostają numery z tej samej sekwencji co przypisy tekstu", () => {
    const doc: BlocksDoc = {
      version: 1,
      blocks: [
        { id: "p1", type: "paragraph", data: { html: "<p>Teza[fn]Przypis tekstu[/fn]</p>" } },
        { id: "c1", type: "chart", data: WSKAZNIK as Record<string, Json> },
      ],
    } as BlocksDoc;
    const { container } = render(<BlocksRenderer doc={doc} lang="pl" />);
    const list = all(container, "[data-footnotes-list] li").map((li) => li.textContent ?? "");
    expect(list).toHaveLength(2);
    expect(list[1]).toContain("Benchmark CTR");
    expect(list[1]).toContain("Dostęp 2026-10-09");
  });
});

describe("seria pod kursorem przygasza pozostałe", () => {
  it("kursor przy linii drugiej serii przygasza pierwszą i pogrubia drugą", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "line",
          categories: ["a", "b", "c", "d"],
          series: [
            { name: "Wysoka", values: [10, 10, 10, 10] },
            { name: "Niska", values: [2, 2, 2, 2] },
          ],
          animate: false,
        })}
        lang="pl"
      />,
    );
    const hit = container.querySelector("rect.neh-hit") as SVGRectElement;
    const width = Number(hit.getAttribute("width"));
    const height = Number(hit.getAttribute("height"));
    const top = Number(hit.getAttribute("y"));
    Object.defineProperty(hit, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height }),
    });
    // Pozycja linii „Niska" w pikselach rysunku - z pierwszego punktu serii.
    const point = all(container, "path[data-role='series-point']").find(
      (el) => el.getAttribute("data-marker") === "diamond",
    ) as Element;
    const y = Number(/L(-?[\d.]+) (-?[\d.]+)/.exec(point.getAttribute("d") ?? "")?.[2]);
    fireEvent.pointerMove(hit, { clientX: width * 0.5, clientY: y - top });
    const groups = all(container, "[data-series-group]");
    expect(groups[0].getAttribute("data-dimmed")).toBe("true");
    expect(groups[1].getAttribute("data-dimmed")).toBeNull();
    expect(groups[1].querySelector("path.neh-line")?.getAttribute("data-active")).toBe("true");
    // Puste tło niczego nie przygasza.
    fireEvent.pointerMove(hit, { clientX: width * 0.5, clientY: height * 0.45 });
    expect(all(container, "[data-dimmed='true']")).toHaveLength(0);
  });
});
