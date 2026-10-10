// DRUGI NOŚNIK AKCENTU TAM, GDZIE GO BRAKOWAŁO - i tusz na akcencie.
//
// Akcent (#FA9346) ma na bieli 2,25:1. Kontrakt PR2: KAŻDY kształt
// wypełniony akcentem dostaje obwódkę `--chart-accent-audit-graphic`, a tekst
// pomocy „Jak czytać" to obiecuje. Bramka `everyKindFocusPalette` pilnuje
// tarczy, histogramu, pudełka i roju; ta dopisuje to, co przeszło obok:
//   1. segment stosu 100% w akcencie - atrybut `stroke` przegrywał z regułą
//      roli `segment` w arkuszu, więc obwódkę (i prześwit stosu) trzeba
//      zamówić zmienną `--neh-bar-edge`,
//   2. obserwacja odstająca „daleka" (kropka PEŁNA) w akcencie,
//   3. mediana na pełnym pudle w akcencie - kolor płyty miał tam 2,25:1,
//      poniżej progu linii, który kod sam deklaruje; idzie tuszem na
//      akcencie (`ACCENT_INK`), a równość tokenów, na której ten tusz stoi,
//      pilnuje bramka arkusza niżej.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { Json } from "@/lib/content-model/json";
import { parseChartConfig } from "@/lib/charts/parse";
import { contrastRatio } from "@/lib/charts/palette";
import { ROLE } from "@/lib/charts/roles";
import { Chart } from "../Chart";
import { ACCENT_EDGE_PX, ACCENT_INK } from "../kindPaint";

afterEach(() => {
  cleanup();
});

const DRUGI_NOSNIK = ROLE.accFocus;

const all = (root: ParentNode, sel: string): Element[] => [...root.querySelectorAll(sel)];

/** Dwanaście obserwacji bez ogona i ta sama próba z ogonem (30 bliska, 80 daleka). */
const CZYSTA = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
const Z_OGONEM = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 30, 80];

function pudelko(extra: Record<string, Json> = {}) {
  return render(
    <Chart
      config={parseChartConfig({
        kind: "boxplot",
        categories: CZYSTA.map((_, i) => `obs-${i + 1}`),
        series: [
          { name: "Alfa", values: CZYSTA },
          { name: "Beta", values: Z_OGONEM },
        ],
        animate: false,
        ...extra,
      })}
      lang="pl"
    />,
  );
}

describe("pudełko - mediana na akcencie i daleka obserwacja", () => {
  it("mediana pudła w akcencie idzie tuszem na akcencie, pozostałe - kolorem płyty", () => {
    // Beta (indeks 1) jest wyróżniona: jej pudło jest pełnym akcentem.
    const { container } = pudelko({ accentSeries: 1 });
    const pudla = all(container, "rect[data-role='box']");
    const mediany = all(container, "line[data-role='median']");
    expect(pudla).toHaveLength(2);
    expect(mediany).toHaveLength(2);
    expect(pudla[1].getAttribute("fill")).toBe(ROLE.acc);
    expect(mediany[1].getAttribute("stroke")).toBe(ACCENT_INK);
    // Pudło neutralne (łupek główny): biel płyty ma na nim > 3:1.
    expect(pudla[0].getAttribute("fill")).not.toBe(ROLE.acc);
    expect(mediany[0].getAttribute("stroke")).toBe("var(--card)");
  });

  it("daleka obserwacja w akcencie ma obwódkę drugiego nośnika; bliska - pierścień w kolorze", () => {
    const { container } = pudelko({ accentSeries: 1 });
    const daleka = all(container, "circle[data-role='outlier'][data-severity='far']");
    const bliska = all(container, "circle[data-role='outlier'][data-severity='mild']");
    expect(daleka).toHaveLength(1);
    expect(bliska).toHaveLength(1);
    expect(daleka[0].getAttribute("fill")).toBe(ROLE.acc);
    expect(daleka[0].getAttribute("stroke")).toBe(DRUGI_NOSNIK);
    // Kropka pusta nie jest wypełniona akcentem - zostaje pierścieniem.
    expect(bliska[0].getAttribute("fill")).toBe("var(--card)");
  });

  it("pod paletą kategorialną nic się nie zmienia: daleka kropka z obwódką płyty", () => {
    const { container } = pudelko({ accentSeries: 1, palette: "categorical" });
    const daleka = all(container, "circle[data-role='outlier'][data-severity='far']");
    expect(daleka[0].getAttribute("stroke")).toBe("var(--card)");
    expect(container.innerHTML).not.toContain(DRUGI_NOSNIK);
    expect(container.innerHTML).not.toContain(ACCENT_INK);
  });
});

describe("stos 100% - segment w akcencie", () => {
  const DANE: Record<string, Json> = {
    kind: "percent-stacked",
    categories: ["Polska", "Niemcy", "Francja", "Włochy"],
    series: [
      { name: "Tak", values: [40, 35, 50, 45] },
      { name: "Nie", values: [35, 40, 30, 35] },
      { name: "Nie wiem", values: [25, 25, 20, 20] },
    ],
    animate: false,
  };

  function segmenty(root: HTMLElement, seria: number): Element[] {
    return all(root, `path[data-role='segment'][data-series='${seria}']`);
  }

  it("segment wyróżnionej serii zamawia obwódkę drugiego nośnika w arkuszu", () => {
    const { container } = render(<Chart config={parseChartConfig(DANE)} lang="pl" />);
    const akcent = segmenty(container, 0);
    expect(akcent.length).toBe(4);
    for (const s of akcent) {
      expect(s.getAttribute("fill")).toBe(ROLE.acc);
      const styl = s.getAttribute("style") ?? "";
      // Zmienna, nie atrybut: reguła roli `segment` nadpisuje atrybut.
      expect(styl).toContain(`--neh-bar-edge: ${DRUGI_NOSNIK}`);
      expect(styl).toContain(`--neh-bar-edge-w: ${ACCENT_EDGE_PX}px`);
    }
  });

  it("pozostałe pełne segmenty zamawiają prześwit w kolorze płyty", () => {
    const { container } = render(<Chart config={parseChartConfig(DANE)} lang="pl" />);
    for (const seria of [1, 2]) {
      for (const s of segmenty(container, seria)) {
        expect(s.getAttribute("fill")).not.toBe(ROLE.acc);
        expect(s.getAttribute("style") ?? "").toContain("--neh-bar-edge: var(--card)");
      }
    }
  });

  it("pod paletą kategorialną nie ma drugiego nośnika", () => {
    const { container } = render(
      <Chart config={parseChartConfig({ ...DANE, palette: "categorical" })} lang="pl" />,
    );
    expect(container.innerHTML).not.toContain(DRUGI_NOSNIK);
  });
});

describe("bramka arkusza - tusz na akcencie", () => {
  const styles = readFileSync("src/styles.css", "utf8");
  const charts = readFileSync("src/components/charts/charts.css", "utf8");
  const JASNY = styles.slice(styles.indexOf(":root,"), styles.indexOf(".dark {"));
  const CIEMNY = styles.slice(styles.indexOf(".dark {"), styles.indexOf("@layer base"));
  const DRUK = charts.slice(charts.indexOf("@media print {"));

  function token(blok: string, nazwa: string): string {
    const m = new RegExp(`${nazwa}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(blok);
    if (m === null) throw new Error(`brak ${nazwa}`);
    return m[1].toLowerCase();
  }

  it("`ACCENT_INK` to tusz slotu 2", () => {
    expect(ACCENT_INK).toBe("var(--chart-ink-2)");
  });

  it("akcent ma wartość slotu 2 w jasnym, ciemnym i druku", () => {
    const jasny = token(JASNY, "--chart-accent");
    expect(token(JASNY, "--chart-2")).toBe(jasny);
    expect(token(CIEMNY, "--chart-2")).toBe(token(CIEMNY, "--chart-accent"));
    // Druk przywraca tokeny jasne: slot 2 druku = akcent jasny.
    expect(token(DRUK, "--chart-2")).toBe(jasny);
  });

  it("tusz slotu 2 ma na akcencie co najmniej 4,5:1 w każdym motywie", () => {
    for (const [motyw, blok] of [
      ["jasny", JASNY],
      ["ciemny", CIEMNY],
      ["druk", DRUK],
    ] as const) {
      const kontrast = contrastRatio(token(blok, "--chart-ink-2"), token(blok, "--chart-2"));
      expect(kontrast, motyw).toBeGreaterThanOrEqual(4.5);
    }
  });
});
