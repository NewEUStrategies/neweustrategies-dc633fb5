// Wykres kołowy / pierścieniowy (`src/components/charts/PieChart.tsx`) -
// pierwszy test tego pliku poza jednym przebiegiem `Chart.a11y.test.tsx`.
//
// PO CO. Tarcza kołowa jest jedynym znacznikiem w silniku, w którym KĄT niesie
// wartość, a etykieta leży WEWNĄTRZ wypełnienia. Obie te cechy dają klasę
// defektów, której nie widać na oko: wykres nadal jest okrągły, kolorowy
// i podpisany, tylko udziały są policzone z innego mianownika niż tekst obok,
// albo etykieta stoi w wycinku innego koloru niż jej tło.
//
// KONKRETNIE ŁAPIEMY:
//   * mianownik udziału. `useMemo` odsiewa `null`, zero i wartości UJEMNE
//     przed sumowaniem, więc suma tarczy to suma DODATNICH - a tabela danych
//     w `Chart.tsx` sumuje wszystko. Dla zestawu z ujemną wartością grafika
//     i jej alternatywa tekstowa podają dwa różne udziały (zapięte `it.fails`);
//   * dzielenie przez zero. Zestaw z samymi zerami MUSI zniknąć przed
//     geometrią, a nie wyprodukować tarczy z `NaN` w ścieżkach;
//   * łuk 100%. Jeden wycinek zamyka pełny obrót; gdyby oba końce łuku wypadły
//     IDENTYCZNE, SVG pomija segment i cała tarcza znika (spec: "if the
//     endpoints are identical ... equivalent to omitting the arc");
//   * slot palety. Etykieta bierze `--chart-ink-N` z TEGO SAMEGO N co
//     wypełnienie - rozjazd numeru daje czarny tekst na granacie. Do tego
//     dziewiąta kategoria ZAWIJA na `--chart-1` (kartezjański w tej sytuacji
//     obcina serie), więc kolor przestaje identyfikować wycinek;
//   * kontrast pary wypełnienie/etykieta w OBU motywach - liczony wprost
//     z `src/styles.css`, bo happy-dom nie ma silnika stylów, a reguła
//     `color-contrast` w axe jest z tego powodu wyłączona;
//   * alternatywę tekstową. Sam `PieChart` rysuje tylko grafikę; tabela
//     i legenda mieszkają w `ChartFrame`, więc dostępność dowodzimy przez
//     `Chart` - dokładnie tak, jak montuje ją blok CMS i widget buildera;
//   * stan interakcji przeżywający podmianę configu - wektor wycieku danych
//     między przestrzeniami roboczymi.
//
// SKĄD BIORĘ LICZBY. `useContainerWidth` czyta `clientWidth`, w happy-dom
// zerowe, więc szerokość zostaje na starcie 720 px. Domyślna wysokość z
// `parse.ts` to 320 px. Stąd: cx = 360, cy = 160,
// rOuter = min(720, 320) / 2 - 12 = 148, rInner (donut) = 0,62 * 148 = 91,76.
// `useRevealOnScroll` nie dostaje callbacku IntersectionObservera, więc stan
// to zawsze "static" - czyli to, co widzi crawler i czytelnik bez JS.
//
// I18N. Jedyny klucz słownika komponentu to podpis sumy w pierścieniu
// ("Suma" / "Total") - sprawdzany w obu językach. Reszta tekstu widocznego
// dla użytkownika to liczby z `Intl` (pl-PL / en-GB) i etykiety z configu,
// więc "oba języki" znaczy tu: te same dane dają ODMIENNE, poprawne napisy.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import type { Json } from "@/lib/content-model/json";
import { parseChartConfig } from "@/lib/charts/parse";
import type { ChartConfig } from "@/lib/charts/types";
import { MAX_SERIES } from "@/lib/charts/types";
import { axeViolations, summarize } from "@/test/axe";
import { PieChart } from "../PieChart";
import { Chart } from "../Chart";

/** Konfiguracja tą samą drogą, którą idzie blok CMS / widget buildera. */
function cfg(data: Record<string, Json>): ChartConfig {
  return parseChartConfig(data);
}

// Geometria wyliczona z harnessu - patrz nagłówek pliku.
const CX = 360;
const CY = 160;
const R_OUTER = 148;
const R_INNER = 91.76;

const SEL = {
  slice: "g.neh-pie-group path",
  label: "g.neh-pie-group text",
  center: "g.neh-fade text",
  tooltip: ".neh-tooltip",
  value: "text.neh-pie-value",
} as const;

const all = (root: HTMLElement, sel: string): Element[] => [...root.querySelectorAll(sel)];
const slices = (root: HTMLElement): Element[] => all(root, SEL.slice);
const d = (el: Element | undefined): string => el?.getAttribute("d") ?? "";
const num = (el: Element | undefined, attr: string): number => Number(el?.getAttribute(attr));
const tip = (root: HTMLElement): Element | null => root.querySelector(SEL.tooltip);

/** Cztery równe wycinki - kąty środkowe wypadają dokładnie na +-45 stopni. */
const CWIARTKI: Record<string, Json> = {
  categories: ["A", "B", "C", "D"],
  series: [{ name: "Udział", values: [1, 1, 1, 1] }],
};

afterEach(() => {
  document.documentElement.classList.remove("dark");
});

// ---------------------------------------------------------------------------

describe("PieChart - filtr danych i mianownik udziału", () => {
  it("bez kategorii nie renderuje NICZEGO (nie pustego <svg>)", () => {
    const { container } = render(
      <PieChart config={cfg({ kind: "pie", categories: [] })} lang="pl" />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("zestaw z samymi ZERAMI znika przed geometrią - zero dzielenia przez zero", () => {
    // Gdyby zera przeszły filtr, `sum` byłoby 0 i każdy udział wyszedłby
    // z dzielenia 0/0, czyli `NaN` w atrybucie `d`. Tarcza ma nie powstać.
    const { container } = render(
      <PieChart
        config={cfg({
          kind: "pie",
          categories: ["A", "B"],
          series: [{ name: "S", values: [0, 0] }],
        })}
        lang="pl"
      />,
    );
    expect(container.innerHTML).toBe("");
    expect(container.innerHTML).not.toContain("NaN");
  });

  it("luki i wartości UJEMNE wypadają z tarczy, a udziały liczą się z samych dodatnich", () => {
    const { container } = render(
      <PieChart
        config={cfg({
          kind: "pie",
          categories: ["ujemna", "luka", "trzy", "jeden"],
          series: [{ name: "S", values: [-100, null, 3, 1] }],
        })}
        lang="pl"
      />,
    );
    const rysowane = slices(container);
    expect(rysowane).toHaveLength(2);
    // Mianownik to 3 + 1 = 4, a NIE -100 + 3 + 1 = -96.
    expect(rysowane.map((s) => s.getAttribute("aria-label"))).toEqual([
      "trzy: 3 (75%)",
      "jeden: 1 (25%)",
    ]);
  });

  it("odsianie wartości NIE przenumerowuje palety - zostaje slot pozycji kategorii", () => {
    // Kategoria nr 3 zachowuje `--chart-3`, choć dwie pierwsze wypadły.
    const { container } = render(
      <PieChart
        config={cfg({
          kind: "pie",
          categories: ["a", "b", "c"],
          series: [{ name: "S", values: [0, null, 5] }],
        })}
        lang="pl"
      />,
    );
    expect(slices(container).map((s) => s.getAttribute("fill"))).toEqual(["var(--chart-3)"]);
  });

  it("JEDEN wycinek zamyka pełny obrót łukiem o RÓŻNYCH końcach", () => {
    // SVG pomija łuk, którego oba końce są identyczne - tarcza 100% zniknęłaby
    // bez śladu. Kontrakt: końce łuku muszą się różnić.
    const { container } = render(
      <PieChart
        config={cfg({ kind: "pie", categories: ["Całość"], series: [{ name: "S", values: [42] }] })}
        lang="pl"
      />,
    );
    const [tarcza] = slices(container);
    expect(tarcza.getAttribute("aria-label")).toBe("Całość: 42 (100%)");
    const [, startX, , , , , , endX] = d(tarcza)
      .split(/[ MLA]+/)
      .filter(Boolean);
    expect(Number(startX)).not.toBe(Number(endX));
    // Duży łuk (flaga large-arc = 1) - inaczej pełny obrót rysuje się jako pół.
    expect(d(tarcza)).toContain(`A${R_OUTER} ${R_OUTER} 0 1 1`);
  });
});

describe("PieChart - geometria tarczy i pierścienia", () => {
  it("pierwszy wycinek startuje na godzinie 12 i idzie zgodnie z ruchem wskazówek", () => {
    const { container } = render(<PieChart config={cfg({ kind: "pie", ...CWIARTKI })} lang="pl" />);
    const [pierwszy, drugi] = slices(container).map((s) => d(s));
    // Start: (cx, cy - rOuter) = 12:00. Koniec pierwszej ćwiartki: 3:00.
    expect(pierwszy).toBe(
      `M${CX} ${CY} L${CX} ${CY - R_OUTER} A148 148 0 0 1 ${CX + R_OUTER} ${CY} Z`,
    );
    // Druga ćwiartka podejmuje dokładnie tam, gdzie skończyła pierwsza.
    expect(drugi.startsWith(`M${CX} ${CY} L${CX + R_OUTER} ${CY}`)).toBe(true);
    // Flaga sweep = 1 w każdym wycinku: zawsze w prawo (clockwise).
    expect(slices(container).every((s) => d(s).includes("0 0 1 "))).toBe(true);
  });

  it("koło rysuje wycinki OD ŚRODKA, pierścień zostawia otwór 0,62 promienia", () => {
    const kolo = render(<PieChart config={cfg({ kind: "pie", ...CWIARTKI })} lang="pl" />);
    expect(d(slices(kolo.container)[0]).startsWith(`M${CX} ${CY} L`)).toBe(true);

    const pierscien = render(<PieChart config={cfg({ kind: "donut", ...CWIARTKI })} lang="pl" />);
    const sciezka = d(slices(pierscien.container)[0]);
    // Pierścień nie dotyka środka: brak segmentu "M cx cy L".
    expect(sciezka.startsWith(`M${CX} ${CY} L`)).toBe(false);
    // Drugi łuk ma promień wewnętrzny i biegnie W PRZECIWNĄ stronę (sweep 0).
    expect(sciezka).toContain(`A${R_INNER} ${R_INNER} 0 0 0`);
  });

  it("wysokość z configu NIE jest cicho przycinana - suwak działa do 640 px", () => {
    // Regresja opisana w komentarzu komponentu: wcześniejsze przycięcie do
    // 420 px sprawiało, że suwak powyżej tej wartości nic nie robił.
    const { container } = render(
      <PieChart
        config={cfg({
          kind: "pie",
          height: 640,
          categories: ["A"],
          series: [{ name: "S", values: [1] }],
        })}
        lang="pl"
      />,
    );
    expect(num(container.querySelector("svg") ?? undefined, "height")).toBe(640);
    // cy = 320, rOuter = min(720, 640)/2 - 12 = 308.
    expect(d(slices(container)[0])).toContain("A308 308");
    expect(d(slices(container)[0]).startsWith("M360 320 L360 12")).toBe(true);
  });

  it("skrajnie wąski kontener trzyma PODŁOGĘ promienia 40 px", () => {
    // `Math.max(40, ...)` to świadoma podłoga: na 60-pikselowej karcie tarcza
    // jest przycięta krawędzią SVG, ale nie kurczy się do nieczytelnej kropki.
    const spy = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(60);
    try {
      const { container } = render(
        <PieChart
          config={cfg({
            kind: "pie",
            height: 160,
            categories: ["A"],
            series: [{ name: "S", values: [1] }],
          })}
          lang="pl"
        />,
      );
      expect(num(container.querySelector("svg") ?? undefined, "width")).toBe(60);
      expect(d(slices(container)[0])).toContain("A40 40");
    } finally {
      spy.mockRestore();
    }
  });

  it("tytuł trafia do aria-label grupy, a jego brak nie zostawia pustego atrybutu", () => {
    const zTytulem = render(
      <PieChart
        config={cfg({ kind: "pie", title: "Struktura eksportu", ...CWIARTKI })}
        lang="pl"
      />,
    );
    const grupa = zTytulem.container.querySelector("[role='group']");
    expect(grupa?.getAttribute("aria-label")).toBe("Struktura eksportu");

    const bezTytulu = render(<PieChart config={cfg({ kind: "pie", ...CWIARTKI })} lang="pl" />);
    // role="group", nie "img": wycinki w środku są fokusowalne, a rola img
    // uczyniłaby je prezentacyjnymi dla czytnika ekranu.
    const anonimowa = bezTytulu.container.querySelector("[role='group']");
    expect(anonimowa).not.toBeNull();
    expect(anonimowa?.hasAttribute("aria-label")).toBe(false);
  });
});

describe("PieChart - etykiety wewnątrz wycinków", () => {
  const struktura: Record<string, Json> = {
    kind: "pie",
    unit: " mld",
    categories: ["duża", "średnia", "drobna"],
    series: [{ name: "S", values: [70, 25, 5] }],
  };

  it("wycinek poniżej 8% NIE dostaje etykiety - wartość niesie tabela i tooltip", () => {
    const { container } = render(<PieChart config={cfg(struktura)} lang="pl" />);
    expect(slices(container)).toHaveLength(3);
    // 5% jest za wąskie na tekst w wypełnieniu; 70% i 25% dostają etykietę.
    expect(all(container, SEL.label).map((t) => t.textContent)).toEqual(["70%", "25%"]);
  });

  it("etykieta siedzi w kątowym środku wycinka i na promieniu 0,66 (koło)", () => {
    const { container } = render(<PieChart config={cfg({ kind: "pie", ...CWIARTKI })} lang="pl" />);
    const [pierwsza] = all(container, SEL.label);
    const rLabel = R_OUTER * 0.66;
    const mid = -Math.PI / 4; // środek pierwszej ćwiartki startującej na 12:00
    expect(num(pierwsza, "x")).toBeCloseTo(CX + rLabel * Math.cos(mid), 5);
    // dy = 4 przy wyłączonych etykietach wartości (wyśrodkowanie optyczne).
    expect(num(pierwsza, "y")).toBeCloseTo(CY + rLabel * Math.sin(mid) + 4, 5);
    expect(pierwsza.getAttribute("text-anchor")).toBe("middle");
  });

  it("w pierścieniu etykieta ląduje w POŁOWIE obwódki, nie w otworze", () => {
    const { container } = render(
      <PieChart config={cfg({ kind: "donut", ...CWIARTKI })} lang="pl" />,
    );
    const [pierwsza] = all(container, SEL.label);
    const rLabel = (R_OUTER + R_INNER) / 2;
    const promien = Math.hypot(num(pierwsza, "x") - CX, num(pierwsza, "y") - 4 - CY);
    expect(promien).toBeCloseTo(rLabel, 5);
    // Twardy warunek: etykieta jest MIĘDZY otworem a krawędzią.
    expect(promien).toBeGreaterThan(R_INNER);
    expect(promien).toBeLessThan(R_OUTER);
  });

  it("kolor etykiety bierze ink Z TEGO SAMEGO slotu co wypełnienie", () => {
    // Rozjazd numeru daje ciemny tekst na ciemnym wypełnieniu - to jedyny
    // wyjątek od zasady "tekst w tokenach semantycznych".
    const { container } = render(
      <PieChart
        config={cfg({
          kind: "pie",
          categories: ["a", "b", "c", "d", "e"],
          series: [{ name: "S", values: [1, 1, 1, 1, 1] }],
        })}
        lang="pl"
      />,
    );
    const fills = slices(container).map((s) => s.getAttribute("fill"));
    const inks = all(container, SEL.label).map((t) => t.getAttribute("fill"));
    expect(fills).toEqual([1, 2, 3, 4, 5].map((n) => `var(--chart-${n})`));
    expect(inks).toEqual([1, 2, 3, 4, 5].map((n) => `var(--chart-ink-${n})`));
  });

  it("przełącznik 'Etykiety wartości' dokłada DRUGĄ linię z wartością i podnosi udział", () => {
    // Wcześniej `showValues` był dla koła cichym no-opem - przełącznik w
    // edytorze nie robił nic, mimo że w wykresach kartezjańskich działa.
    const bez = render(<PieChart config={cfg(struktura)} lang="pl" />);
    expect(all(bez.container, SEL.value)).toHaveLength(0);
    const yUdzialu = num(all(bez.container, SEL.label)[0], "y");

    const z = render(<PieChart config={cfg({ ...struktura, showValues: true })} lang="pl" />);
    const wartosci = all(z.container, SEL.value);
    expect(wartosci.map((t) => t.textContent)).toEqual(["70 mld", "25 mld"]);
    // Udział podjeżdża o 6 px (dy 4 -> -2), wartość ląduje 13 px pod nim.
    const yUdzialuZ = num(all(z.container, SEL.label)[0], "y");
    expect(yUdzialuZ).toBeCloseTo(yUdzialu - 6, 5);
    expect(num(wartosci[0], "y")).toBeCloseTo(yUdzialuZ + 13, 5);
    // Etykiety nie przechwytują wskaźnika - hover należy do wycinka.
    expect(wartosci[0].parentElement?.getAttribute("pointer-events")).toBe("none");
  });
});

describe("PieChart - suma w środku pierścienia", () => {
  const dane: Record<string, Json> = {
    kind: "donut",
    unit: " mld",
    categories: ["A", "B"],
    series: [{ name: "S", values: [1200, 800] }],
  };

  it("pierścień pokazuje sumę i jej podpis w obu językach", () => {
    const pl = render(<PieChart config={cfg(dane)} lang="pl" />);
    expect(all(pl.container, SEL.center).map((t) => t.textContent)).toEqual(["2000 mld", "Suma"]);

    const en = render(<PieChart config={cfg(dane)} lang="en" />);
    // en-GB dokłada separator tysięcy - ten sam zestaw, inny napis.
    expect(all(en.container, SEL.center).map((t) => t.textContent)).toEqual(["2,000 mld", "Total"]);
  });

  it("suma w środku liczy się z DODATNICH - tyle, ile pokazuje tarcza", () => {
    const { container } = render(
      <PieChart
        config={cfg({
          ...dane,
          categories: ["A", "B", "C"],
          series: [{ name: "S", values: [1200, 800, -500] }],
        })}
        lang="pl"
      />,
    );
    expect(all(container, SEL.center)[0].textContent).toBe("2000 mld");
  });

  it("koło NIE dostaje sumy w środku (nie ma tam otworu)", () => {
    const { container } = render(<PieChart config={cfg({ ...dane, kind: "pie" })} lang="pl" />);
    expect(all(container, SEL.center)).toHaveLength(0);
  });
});

describe("PieChart - paleta i zawijanie slotów", () => {
  const dziesiec: Record<string, Json> = {
    kind: "pie",
    categories: Array.from({ length: 10 }, (_, i) => `K${i + 1}`),
    series: [{ name: "S", values: Array.from({ length: 10 }, () => 10) }],
  };

  it("sloty idą sekwencyjnie 1..8, a jedenasta kategoria ZAWIJA na --chart-1", () => {
    // Stan faktyczny, sprzeczny z kartezjańskim (tam nadmiar serii jest
    // OBCINANY): koło liczy slot jako (i % MAX_SERIES) + 1.
    const { container } = render(<PieChart config={cfg(dziesiec)} lang="pl" />);
    expect(slices(container).map((s) => s.getAttribute("fill"))).toEqual([
      ...Array.from({ length: MAX_SERIES }, (_, i) => `var(--chart-${i + 1})`),
      "var(--chart-1)",
      "var(--chart-2)",
    ]);
  });

  it.fails(
    "kolor MUSI identyfikować wycinek: dwie kategorie nie mogą dostać tego samego slotu palety",
    () => {
      // Reguła palety z `src/styles.css`: "Sloty przypisuje się sekwencyjnie
      // serii 1..8 - NIGDY po obwodzie". Koło zawija modulo, więc przy >=9
      // kategoriach próbka w legendzie wskazuje DWA wycinki naraz i przestaje
      // być kluczem. Kartezjański rozwiązuje to obcięciem do MAX_SERIES.
      const { container } = render(<PieChart config={cfg(dziesiec)} lang="pl" />);
      const uzyte = slices(container).map((s) => s.getAttribute("fill"));
      expect(new Set(uzyte).size).toBe(uzyte.length);
    },
  );
});

describe("PieChart - tooltip i fokus", () => {
  it("wskazanie wycinka pokazuje nazwę, udział i wartość z jednostką", () => {
    const { container } = render(
      <PieChart
        config={cfg({
          kind: "pie",
          unit: " mld EUR",
          categories: ["Eksport", "Import"],
          series: [{ name: "S", values: [3, 1] }],
        })}
        lang="pl"
      />,
    );
    expect(tip(container)).toBeNull();
    fireEvent.pointerEnter(slices(container)[0]);
    expect(tip(container)?.textContent).toBe("Eksport75%3 mld EUR");
    // Tooltip to wizualny duplikat - dla czytnika jest schowany.
    expect(tip(container)?.getAttribute("aria-hidden")).toBe("true");
  });

  it("kotwica tooltipa siada w POŁOWIE promienia wycinka", () => {
    const { container } = render(<PieChart config={cfg({ kind: "pie", ...CWIARTKI })} lang="pl" />);
    fireEvent.pointerEnter(slices(container)[0]);
    // r = (rOuter + rInner) / 2 = 74; mid = -45 stopni.
    const x = Math.round(CX + 74 * Math.cos(-Math.PI / 4));
    const y = Math.round(CY + 74 * Math.sin(-Math.PI / 4));
    expect(tip(container)?.getAttribute("style")).toContain(`translate3d(${x}px, ${y}px, 0)`);
  });

  it("tooltip przy prawej krawędzi odbija się w lewo zamiast wyjeżdżać z karty", () => {
    const { container } = render(
      <PieChart config={cfg({ kind: "donut", ...CWIARTKI })} lang="pl" />,
    );
    const wycinki = slices(container);
    // Kotwica pierścienia siedzi na promieniu 119,88 - prawa ćwiartka wypada
    // za progiem 0,6 szerokości kontenera (432 px), lewa nie.
    fireEvent.pointerEnter(wycinki[1]);
    expect(tip(container)?.getAttribute("style")).toContain("-100%");
    fireEvent.pointerLeave(wycinki[1]);
    fireEvent.pointerEnter(wycinki[2]);
    expect(tip(container)?.getAttribute("style")).toContain("translate(12px");
  });

  it("opuszczenie wskaźnikiem chowa tooltip", () => {
    const { container } = render(<PieChart config={cfg({ kind: "pie", ...CWIARTKI })} lang="pl" />);
    fireEvent.pointerEnter(slices(container)[0]);
    expect(tip(container)).not.toBeNull();
    fireEvent.pointerLeave(slices(container)[0]);
    expect(tip(container)).toBeNull();
  });

  it("FOKUS klawiaturą daje ten sam tooltip i WYSUWA wycinek o 4 px", () => {
    // Wycinki mają `outline-none`, więc wysunięcie jest JEDYNYM wskaźnikiem
    // fokusu - musi realnie zmieniać geometrię, nie tylko klasę.
    const { container } = render(<PieChart config={cfg({ kind: "pie", ...CWIARTKI })} lang="pl" />);
    const spoczynek = d(slices(container)[0]);
    fireEvent.focus(slices(container)[0]);
    expect(tip(container)?.textContent).toBe("A25%1");
    const wysuniety = d(slices(container)[0]);
    expect(wysuniety).not.toBe(spoczynek);
    // Przesunięcie idzie po kącie środkowym: 4 px pod -45 stopni.
    expect(wysuniety.startsWith(`M${CX + 4 * Math.cos(-Math.PI / 4)} `)).toBe(true);
    fireEvent.blur(slices(container)[0]);
    expect(tip(container)).toBeNull();
    expect(d(slices(container)[0])).toBe(spoczynek);
  });

  it("każdy wycinek jest OSIĄGALNY Z KLAWIATURY i nazwany bez pomocy koloru", () => {
    const { container } = render(
      <PieChart
        config={cfg({
          kind: "pie",
          unit: "%",
          categories: ["Za", "Przeciw"],
          series: [{ name: "S", values: [60, 40] }],
        })}
        lang="pl"
      />,
    );
    for (const s of slices(container)) expect(s.getAttribute("tabindex")).toBe("0");
    expect(slices(container).map((s) => s.getAttribute("aria-label"))).toEqual([
      "Za: 60% (60%)",
      "Przeciw: 40% (40%)",
    ]);
  });
});

describe("PieChart - i18n liczb (pl-PL vs en-GB)", () => {
  const dane: Record<string, Json> = {
    kind: "pie",
    unit: " mln",
    categories: ["A", "B", "C"],
    series: [{ name: "S", values: [12345.6, 1000, 54.5] }],
  };

  it("ten sam zestaw daje ODMIENNE, poprawne napisy w obu językach", () => {
    const pl = render(<PieChart config={cfg(dane)} lang="pl" />);
    const en = render(<PieChart config={cfg(dane)} lang="en" />);
    const etykieta = (root: HTMLElement, i: number): string =>
      slices(root)[i].getAttribute("aria-label") ?? "";

    // pl-PL grupuje tysiące TWARDĄ spacją (U+00A0) - zapisana wprost, żeby
    // różnicy nie dało się zgubić przy kopiowaniu.
    expect(etykieta(pl.container, 0)).toBe("A: 12\u00a0345,6 mln (92%)");
    expect(etykieta(en.container, 0)).toBe("A: 12,345.6 mln (92%)");
    // Udział poniżej 10% dostaje jedno miejsce po przecinku (i przecinek w PL).
    expect(etykieta(pl.container, 2)).toBe("C: 54,5 mln (0,4%)");
    expect(etykieta(en.container, 2)).toBe("C: 54.5 mln (0.4%)");
  });
});

describe("PieChart w ramie Chart - alternatywa tekstowa, legenda, axe", () => {
  const struktura: Record<string, Json> = {
    kind: "donut",
    title: "Struktura eksportu",
    description: "Udział rynków w wartości",
    unit: " mld",
    categories: ["Niemcy", "Czechy", "drobnica"],
    series: [{ name: "Udział", values: [70, 25, 5] }],
    source: "Źródło: test",
  };

  const openTable = (root: HTMLElement, name: string): HTMLTableElement => {
    fireEvent.click(within(root).getByRole("button", { name }));
    const table = root.querySelector("table");
    if (!table) throw new Error("brak tabeli danych");
    return table as HTMLTableElement;
  };

  it("KAŻDA kategoria ma wiersz z wartością i udziałem - także ta bez etykiety na tarczy", () => {
    // To jest ekwiwalent `ChartDataTable` z panelu BI: grafika nigdy nie jest
    // jedyną drogą do liczby. Wycinek 5% nie ma etykiety, więc bez tabeli
    // jego wartość byłaby dostępna WYŁĄCZNIE przez hover.
    const { container } = render(<Chart config={cfg(struktura)} lang="pl" />);
    expect(all(container, SEL.label).map((t) => t.textContent)).toEqual(["70%", "25%"]);
    const table = openTable(container, "Pokaż dane");
    const naglowki = [...table.querySelectorAll("th[scope='col']")].map((th) => th.textContent);
    expect(naglowki).toEqual(["Kategoria", "Wartość", "Udział"]);
    const wiersz = within(table).getByRole("row", { name: /drobnica/ });
    expect(wiersz.textContent).toBe("drobnica5 mld5%");
  });

  // UWAGA NA RÓŻNICĘ WZGLĘDEM PANELU BI. `ChartDataTable`
  // (`src/components/admin/analytics/ChartDataTable.tsx`) trzyma tabelę
  // w `<details>`, więc zostaje ona w DRZEWIE DOSTĘPNOŚCI także zamknięta.
  // `ChartFrame` używa atrybutu `hidden`, który tabelę z tego drzewa WYJMUJE -
  // droga do liczb prowadzi tu przez nazwany, fokusowalny przycisk z
  // `aria-expanded`/`aria-controls` (poprawny wzorzec ujawniania), ale jest
  // o jedno działanie dłuższa. Test przypina oba końce tego kontraktu.
  it("tabela danych jest sterowalna z klawiatury i opisana dla czytnika", () => {
    const { container, getByRole } = render(<Chart config={cfg(struktura)} lang="pl" />);
    const przycisk = getByRole("button", { name: "Pokaż dane" });
    expect(przycisk.getAttribute("aria-expanded")).toBe("false");
    const panel = document.getElementById(przycisk.getAttribute("aria-controls") ?? "");
    expect(panel?.hasAttribute("hidden")).toBe(true);
    expect(panel?.querySelector(".sr-only")?.textContent).toBe("Dane wykresu");

    fireEvent.click(przycisk);
    expect(getByRole("button", { name: "Ukryj dane" }).getAttribute("aria-expanded")).toBe("true");
    expect(panel?.hasAttribute("hidden")).toBe(false);
    expect(container.querySelector("figure")).not.toBeNull();
  });

  it("przełącznik tabeli i nagłówki są przetłumaczone (pl/en)", () => {
    const { container, getByRole } = render(<Chart config={cfg(struktura)} lang="en" />);
    const table = openTable(container, "Show data");
    expect([...table.querySelectorAll("th[scope='col']")].map((th) => th.textContent)).toEqual([
      "Category",
      "Value",
      "Share",
    ]);
    expect(getByRole("button", { name: "Hide data" })).toBeTruthy();
  });

  it("legenda jest LISTĄ tekstową przed grafiką, a próbka koloru jest schowana", () => {
    // Legenda nie jest interaktywna (nie przełącza serii), więc nie ma jej co
    // fokusować - dostępna jest przez drzewo a11y: role=list + nazwa TEKSTEM.
    // Kolor to wyłącznie dekoracja klucza, dlatego aria-hidden.
    const { container, getByRole } = render(<Chart config={cfg(struktura)} lang="pl" />);
    const legenda = getByRole("list");
    expect(
      within(legenda)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Niemcy", "Czechy", "drobnica"]);
    for (const probka of legenda.querySelectorAll("span[aria-hidden]")) {
      expect(probka.textContent).toBe("");
    }
    // Kolejność dokumentu: legenda PRZED tarczą (czytnik dostaje klucz pierwszy).
    const svg = container.querySelector("svg.block");
    expect(
      legenda.compareDocumentPosition(svg as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("legenda znika przy JEDNEJ kategorii - tytuł nazywa jedyny kolor", () => {
    const { queryByRole } = render(
      <Chart
        config={cfg({
          ...struktura,
          categories: ["Niemcy"],
          series: [{ name: "Udział", values: [70] }],
        })}
        lang="pl"
      />,
    );
    expect(queryByRole("list")).toBeNull();
  });

  it("wyłączona legenda nie zostawia pustej listy", () => {
    const { queryByRole } = render(
      <Chart config={cfg({ ...struktura, showLegend: false })} lang="pl" />,
    );
    expect(queryByRole("list")).toBeNull();
  });

  it("pusty zestaw daje notę, nie pustą kartę wykresu", () => {
    const pl = render(
      <Chart config={cfg({ kind: "pie", categories: [], series: [] })} lang="pl" />,
    );
    expect(pl.getByText("Brak danych wykresu.")).toBeTruthy();
    const en = render(
      <Chart config={cfg({ kind: "pie", categories: [], series: [] })} lang="en" />,
    );
    expect(en.getByText("No chart data.")).toBeTruthy();
  });

  it("koło i pierścień przechodzą axe w obu językach", async () => {
    for (const lang of ["pl", "en"] as const) {
      for (const kind of ["pie", "donut"] as const) {
        const { container, unmount } = render(
          <Chart config={cfg({ ...struktura, kind })} lang={lang} />,
        );
        fireEvent.click(within(container).getByRole("button", { name: /dane|data/i }));
        const naruszenia = await axeViolations(container);
        expect(naruszenia, `${kind}/${lang}: ${summarize(naruszenia)}`).toEqual([]);
        unmount();
      }
    }
  });

  it.fails(
    "tabela danych MUSI podawać ten sam udział co tarcza - wartość ujemna rozjeżdża mianowniki",
    () => {
      // Tarcza odsiewa ujemne przed sumowaniem (mianownik 100), tabela w
      // `Chart.tsx` sumuje wszystko (mianownik 90). Skutek: grafika mówi
      // "B = 100%", jej alternatywa tekstowa "B = 111%" i "A = -11,1%".
      // Udział poza zakresem 0..100% jest w tabeli udziałów bełkotem.
      const { container } = render(
        <Chart
          config={cfg({
            kind: "pie",
            title: "Saldo",
            categories: ["korekta", "obrót"],
            series: [{ name: "S", values: [-10, 100] }],
          })}
          lang="pl"
        />,
      );
      expect(slices(container)).toHaveLength(1);
      expect(slices(container)[0].getAttribute("aria-label")).toBe("obrót: 100 (100%)");
      const table = openTable(container, "Pokaż dane");
      const udzialy = [...table.querySelectorAll("td.text-right:last-child")].map(
        (td) => td.textContent,
      );
      for (const u of udzialy) {
        expect(u).not.toContain("-");
        expect(Number.parseFloat((u ?? "").replace(",", "."))).toBeLessThanOrEqual(100);
      }
    },
  );
});

describe("PieChart - kontrast palety w OBU motywach", () => {
  // happy-dom nie liczy stylów, więc reguła color-contrast w axe jest
  // wyłączona (`src/test/axe.ts`). Kontrast liczymy wprost z tokenów -
  // ten sam wzorzec, co `src/lib/__tests__/brandContrast.test.ts`.
  const css = readFileSync("src/styles.css", "utf8");
  const LIGHT = css.slice(css.indexOf(":root,"), css.indexOf(".dark {"));
  const DARK = css.slice(css.indexOf(".dark {"), css.indexOf("@layer base"));

  function token(block: string, name: string): string {
    const m = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
    if (!m) throw new Error(`brak tokenu ${name}`);
    return m[1].toLowerCase();
  }

  function luminancja(hex: string): number {
    const c = hex.replace("#", "");
    const [r, g, b] = [0, 2, 4]
      .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function kontrast(a: string, b: string): number {
    const [l1, l2] = [luminancja(a), luminancja(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  }

  const MOTYWY = [
    ["jasny", LIGHT],
    ["ciemny", DARK],
  ] as const;

  it("każdy slot ma zdefiniowany kolor i ink w OBU motywach", () => {
    for (const [nazwa, block] of MOTYWY) {
      for (let n = 1; n <= MAX_SERIES; n++) {
        expect(token(block, `--chart-${n}`), nazwa).toMatch(/^#[0-9a-f]{6}$/);
        expect(token(block, `--chart-ink-${n}`), nazwa).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("etykieta w wypełnieniu trzyma minimum 3:1 w obu motywach", () => {
    for (const [nazwa, block] of MOTYWY) {
      for (let n = 1; n <= MAX_SERIES; n++) {
        const r = kontrast(token(block, `--chart-${n}`), token(block, `--chart-ink-${n}`));
        expect(r, `${nazwa} slot ${n}: ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it.fails(
    "etykieta 12 px w wypełnieniu MUSI mieć 4,5:1 (WCAG AA) - jasny slot 1 ma 4,46:1",
    () => {
      // Etykieta udziału to 12 px / waga 600, a linia wartości 11 px / 500 -
      // żadna nie jest "dużym tekstem" (18,66 px bold albo 24 px), więc próg
      // AA wynosi 4,5:1. Para #2a78d6 / #0b0b0b w jasnym motywie daje 4,46:1,
      // a slot 1 to PIERWSZY wycinek każdej tarczy - najczęstsza etykieta
      // w całym silniku. Komentarz przy tokenach obiecuje kontrast "dobrany
      // WCAG do konkretnego odcienia".
      for (const [nazwa, block] of MOTYWY) {
        for (let n = 1; n <= MAX_SERIES; n++) {
          const r = kontrast(token(block, `--chart-${n}`), token(block, `--chart-ink-${n}`));
          expect(r, `${nazwa} slot ${n}: ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
        }
      }
    },
  );

  it("wycinek odcina się od powierzchni karty obrysem w kolorze karty, nie ramką", () => {
    const { container } = render(<PieChart config={cfg({ kind: "pie", ...CWIARTKI })} lang="pl" />);
    for (const s of slices(container)) {
      expect(s.getAttribute("stroke")).toBe("var(--card)");
      expect(s.getAttribute("stroke-width")).toBe("2");
    }
  });

  it("przełączenie motywu NIE zmienia DOM - kolory jadą tokenami, zero zapieczonego hexa", () => {
    const config = cfg({ kind: "donut", unit: " mld", ...CWIARTKI });
    const jasny = render(<PieChart config={config} lang="pl" />);
    const html = jasny.container.innerHTML;
    jasny.unmount();

    document.documentElement.classList.add("dark");
    const ciemny = render(<PieChart config={config} lang="pl" />);
    expect(ciemny.container.innerHTML).toBe(html);
    // Cały kolor grafiki to var(...) - inaczej motyw ciemny dostałby jasną paletę.
    expect(html).not.toMatch(/(fill|stroke)="#[0-9a-f]{3,8}"/i);
  });
});

describe("PieChart - izolacja przestrzeni roboczych", () => {
  const alfa = parseChartConfig({
    kind: "donut",
    title: "Leady - workspace alfa",
    unit: " szt.",
    categories: ["Alfa Q1", "Alfa Q2"],
    series: [{ name: "Kampania alfa", values: [33, 11] }],
  });
  const beta = parseChartConfig({
    kind: "donut",
    title: "Leady - workspace beta",
    unit: " szt.",
    categories: ["Beta Q1", "Beta Q2"],
    series: [{ name: "Kampania beta", values: [70, 30] }],
  });

  it("podmiana configu wymiata dane poprzedniej przestrzeni z tarczy, sumy i tooltipa", () => {
    const { container, rerender } = render(<PieChart config={alfa} lang="pl" />);
    fireEvent.pointerEnter(slices(container)[0]);
    expect(tip(container)?.textContent).toBe("Alfa Q175%33 szt.");

    rerender(<PieChart config={beta} lang="pl" />);

    // Ten sam, ŻYWY komponent - hover z alfy musi się przemalować na betę.
    expect(tip(container)?.textContent).toBe("Beta Q170%70 szt.");
    expect(container.querySelector("[role='group']")?.getAttribute("aria-label")).toBe(
      "Leady - workspace beta",
    );
    expect(all(container, SEL.center)[0].textContent).toBe("100 szt.");
    const html = container.innerHTML;
    for (const slad of ["Alfa", "alfa", "33 szt.", "11 szt.", "44 szt."]) {
      expect(html, slad).not.toContain(slad);
    }
  });

  it("podmiana na KRÓTSZY zestaw przy aktywnym wycinku nie zostawia widmowego tooltipa", () => {
    const waski = parseChartConfig({
      kind: "pie",
      categories: ["Beta Q1"],
      series: [{ name: "Kampania beta", values: [9] }],
    });
    const { container, rerender } = render(<PieChart config={alfa} lang="pl" />);
    fireEvent.pointerEnter(slices(container)[1]);
    expect(tip(container)?.textContent).toContain("Alfa Q2");

    // `active` = 1 przeżywa podmianę, a nowy zestaw ma jeden wycinek.
    expect(() => rerender(<PieChart config={waski} lang="pl" />)).not.toThrow();
    expect(tip(container)).toBeNull();
    expect(container.innerHTML).not.toContain("Alfa");
  });
});
