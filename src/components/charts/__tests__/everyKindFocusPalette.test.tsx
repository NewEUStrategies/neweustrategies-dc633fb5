// PALETA RÓL W KAŻDYM RODZAJU (PR2) - akcent + neutralne jako domyślna
// paleta wszystkich siedemnastu rodzajów, nie tylko linii i słupków.
//
// CO SIĘ DZIAŁO. Paletę ról znał wyłącznie rysownik kartezjański. Histogram
// tych samych danych wychodził zielony (slot 3), a słupki - w akcencie;
// małe panele miały legendę `chart-3/4/8` i rysunek w `chart-1`; wachlarz
// wypisywał w legendzie trzy serie, a rysował jedną. Czytelnik wpisu
// z dwoma wykresami tych samych danych dostawał dwa różne kody koloru.
//
// CO PILNUJE TA BRAMKA:
//   1. pod paletą ról każdy rodzaj, w którym kolor jest wyborem
//      (`KIND_CAPS.palette`), maluje akcentem, a pod kategorialną - nie,
//   2. KSZTAŁT WYPEŁNIONY AKCENTEM ma drugi nośnik - obwódkę
//      `--chart-accent-audit-graphic` (tarcza, histogram, pudełko, rój),
//   3. pod paletą ról wypełnienia tarczy, histogramu i pudełka są PEŁNE,
//   4. próbki legendy ramy to kolory, które rysunek naprawdę maluje,
//      a wachlarz i małe panele nie mają legendy serii (własny klucz),
//   5. wskaźnik indeksu z etykietami przy końcu linii zdejmuje legendę ramy,
//   6. motyw nie zmienia DOM-u (geometria i typografia te same) i w rysunku
//      nie ma hexa.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { Json } from "@/lib/content-model/json";
import { CHART_KINDS, type ChartKind } from "@/lib/charts/types";
import { parseChartConfig } from "@/lib/charts/parse";
import { KIND_CAPS } from "@/lib/charts/kindCaps";
import { Chart } from "../Chart";

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
});

const DANE: Record<string, Json> = {
  categories: [
    "Polska",
    "Niemcy",
    "Francja",
    "Włochy",
    "Hiszpania",
    "Holandia",
    "Belgia",
    "Czechy",
    "Węgry",
    "Austria",
    "Szwecja",
    "Dania",
  ],
  series: [
    { name: "Wynik 2025", values: [12, 31, 24, 19, 8, 27, 15, 22, 6, 17, 29, 11] },
    { name: "Wynik 2024", values: [9, 28, 21, 23, 11, 24, 13, 18, 7, 15, 26, 14] },
    { name: "Zmiana", values: [3, 3, 3, -4, -3, 3, 2, 4, -1, 2, 3, -3] },
  ],
  unit: " mln EUR",
  animate: false,
  sampleSize: 12,
  showLegend: true,
};

function renderKind(kind: ChartKind, extra: Record<string, Json> = {}) {
  return render(<Chart config={parseChartConfig({ ...DANE, kind, ...extra })} lang="pl" />);
}

/** Całe malowanie rysunku: atrybuty i style znaczników SVG. */
function farbaRysunku(root: HTMLElement): string {
  return [...root.querySelectorAll("[data-chart-canvas] svg *")]
    .map((el) => ["fill", "stroke", "style"].map((a) => el.getAttribute(a) ?? "").join("|"))
    .join("\n");
}

const AKCENT = "var(--chart-accent)";
const DRUGI_NOSNIK = "var(--chart-accent-audit-graphic)";

describe("paleta ról jest domyślna w każdym rodzaju z wyborem koloru", () => {
  for (const kind of CHART_KINDS) {
    const caps = KIND_CAPS[kind];
    if (!caps.palette) continue;
    it(`${kind}: akcent pod paletą ról, brak akcentu pod kategorialną`, () => {
      const focus = renderKind(kind);
      expect(farbaRysunku(focus.container)).toContain(AKCENT);
      focus.unmount();
      const kat = renderKind(kind, { palette: "categorical" });
      expect(farbaRysunku(kat.container)).not.toContain(AKCENT);
    });
  }

  it("rodzaje kodujące wartość albo znak nie mają wyboru palety (mapa ciepła, tornado, mostek)", () => {
    for (const kind of CHART_KINDS) {
      if (KIND_CAPS[kind].colorTarget === "encoded") expect(KIND_CAPS[kind].palette).toBe(false);
    }
  });
});

describe("drugi nośnik akcentu i pełne wypełnienia", () => {
  it("tarcza: wycinek w akcencie jest PEŁNY i ma obwódkę drugiego nośnika", () => {
    const { container } = renderKind("pie");
    const akcent = container.querySelector("[data-role='slice'][data-accent='true']");
    expect(akcent?.getAttribute("fill")).toBe(AKCENT);
    expect(akcent?.getAttribute("stroke")).toBe(DRUGI_NOSNIK);
    // Pozostałe wycinki pełne, bez obwódki - nic z odmian bladych slotu.
    for (const s of container.querySelectorAll("[data-role='slice']")) {
      expect(s.getAttribute("fill") ?? "").not.toMatch(/-inner\)$/);
    }
  });

  it("histogram: przedział w akcencie z obwódką drugiego nośnika 1 px", () => {
    const { container } = renderKind("histogram");
    const bins = [...container.querySelectorAll("[data-role='bin']")];
    expect(bins.length).toBeGreaterThan(0);
    for (const b of bins) {
      expect(b.getAttribute("fill")).toBe(AKCENT);
      const styl = b.getAttribute("style") ?? "";
      expect(styl).toContain(`--neh-bar-token: ${AKCENT}`);
      expect(styl).toContain(`--neh-bar-edge: ${DRUGI_NOSNIK}`);
      expect(styl).toContain("--neh-bar-edge-w: 1px");
    }
  });

  it("pudełko: pod paletą ról PEŁNE, grupa wyróżniona w akcencie z obwódką drugiego nośnika", () => {
    const { container } = renderKind("boxplot");
    const pudla = [...container.querySelectorAll("[data-role='box']")];
    expect(pudla.length).toBe(3);
    for (const p of pudla) expect(p.getAttribute("data-style")).toBe("solid");
    expect(pudla[0].getAttribute("fill")).toBe(AKCENT);
    expect(pudla[0].getAttribute("stroke")).toBe(DRUGI_NOSNIK);
    // Grupy tła w neutralnych - bez obwódki akcentu.
    expect(pudla[1].getAttribute("fill")).toBe("var(--chart-s-main)");
    expect(pudla[1].getAttribute("stroke")).toBeNull();
  });

  it("pudełko: wybór `accentSeries` przenosi akcent na wskazaną grupę", () => {
    const { container } = renderKind("boxplot", { accentSeries: 1 });
    const pudla = [...container.querySelectorAll("[data-role='box']")];
    expect(pudla[1].getAttribute("fill")).toBe(AKCENT);
    expect(pudla[0].getAttribute("fill")).toBe("var(--chart-s-main)");
  });

  it("rój: kropki grupy wyróżnionej w akcencie, z obwódką drugiego nośnika", () => {
    const { container } = renderKind("beeswarm");
    const wAkcencie = [...container.querySelectorAll("circle.neh-bee-dot")].filter(
      (k) => k.getAttribute("fill") === AKCENT,
    );
    expect(wAkcencie.length).toBeGreaterThan(0);
    for (const k of wAkcencie) expect(k.getAttribute("stroke")).toBe(DRUGI_NOSNIK);
  });
});

describe("legenda ramy mówi o tym, co jest na rysunku", () => {
  it("wachlarz i małe panele nie mają legendy serii - klucz niesie rysunek", () => {
    for (const kind of ["fan", "small-multiples"] as const) {
      const { container, unmount } = renderKind(kind);
      expect(container.querySelector(".neh-legend"), kind).toBeNull();
      unmount();
    }
  });

  it("próbka legendy ma kolor, którym rysunek naprawdę maluje (stos 100%, chmura, indeks)", () => {
    for (const kind of ["percent-stacked", "scatter", "index-base"] as const) {
      // Pięć serii, żeby indeks nie zastąpił legendy etykietami przy końcu linii.
      const piec = {
        series: [
          ...(DANE.series as Json[]),
          { name: "Plan", values: [10, 25, 20, 20, 10, 25, 15, 20, 8, 16, 27, 12] },
          { name: "Mediana", values: [11, 27, 22, 21, 9, 26, 14, 20, 7, 16, 28, 13] },
        ],
      };
      const { container, unmount } = renderKind(kind, piec);
      const probki = [...container.querySelectorAll(".neh-legend .neh-legend-swatch")];
      expect(probki.length, kind).toBeGreaterThan(1);
      const farba = farbaRysunku(container);
      for (const p of probki) {
        const styl = p.getAttribute("style") ?? "";
        const kolor = /var\(--chart-[\w-]+\)/.exec(styl)?.[0];
        expect(kolor, `${kind}: ${styl}`).toBeDefined();
        expect(farba, `${kind}: ${kolor}`).toContain(kolor);
      }
      // Pozycje nie przełączają serii - przełączanie zostaje kartezjańskie.
      expect(container.querySelector(".neh-legend [aria-pressed]"), kind).toBeNull();
      unmount();
    }
  });

  it("indeks z etykietami przy końcu linii (2-4 serie) zdejmuje legendę ramy", () => {
    const { container } = renderKind("index-base");
    expect(container.querySelector("[data-role='series-end-label']")).not.toBeNull();
    expect(container.querySelector(".neh-legend")).toBeNull();
  });
});

describe("motyw zmienia wyłącznie kolory", () => {
  const bezId = (html: string): string => html.replace(/_r_[0-9a-z]+_/g, "ID");
  for (const kind of CHART_KINDS) {
    it(`${kind}: ten sam DOM w obu motywach, zero hexa w rysunku`, () => {
      const jasny = renderKind(kind);
      const html = jasny.container.innerHTML;
      jasny.unmount();
      document.documentElement.classList.add("dark");
      const ciemny = renderKind(kind);
      expect(bezId(ciemny.container.innerHTML)).toBe(bezId(html));
      expect(html).not.toMatch(/(fill|stroke)="#[0-9a-f]{3,8}"/i);
    });
  }
});
