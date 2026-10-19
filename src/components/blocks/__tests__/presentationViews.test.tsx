// Publiczne widoki bloków prezentacyjnych: `icon-box`, `stats-counter`,
// `testimonials`, `pricing-table`, `timeline` (`PresentationViews.tsx`).
//
// CO MA TU DOWÓD
//  * licznik statystyk pokazuje wartość z CMS-u: SSR i element widoczny od
//    razu dostają liczbę KOŃCOWĄ (crawler nie widzi zer), poza viewportem
//    stoi 0, po wejściu liczy w górę do dokładnie tej samej wartości;
//    precyzja, przedrostek i wartości nieliczbowe przechodzą bez zmian
//    (wcześniej „4,5" -> „5", „N/A" -> „N/A0", puste pole -> „0"),
//  * slider opinii zawija się w obie strony i nie wywraca się, gdy lista
//    skurczy się pod bieżącym indeksem (podgląd na żywo w builderze),
//  * cennik i oś czasu: opis z HTML-a jako czysty tekst, CTA tylko z etykietą
//    i adresem, puste pola bez pustych węzłów, pusta lista = brak bloku.
//
// GRANICE. Jedyna atrapa to `IntersectionObserver` (w teście licznika
// sterujemy wejściem w viewport) i zegar klatek (fałszywe rAF/performance).
// `AppLink` bez routera renderuje zwykłe `<a>` - tego właśnie potrzebujemy.
// Napisy interfejsu widoków idą przez słownik `i18n-public` - prawdziwe i18n.
import "@/test/i18nReal";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import type { Json } from "@/lib/blocks/types";

import {
  IconBoxView,
  PricingTableView,
  StatsCounterView,
  TestimonialsView,
  TimelineView,
} from "@/components/blocks/PresentationViews";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Tekst bez twardych spacji z `toLocaleString` (pl grupuje tysiące NBSP). */
const norm = (s: string | null | undefined) => (s ?? "").replace(/\u00a0|\u202f/g, " ").trim();

describe("IconBoxView", () => {
  it("tytuł i opis; link dopiero z adresem I etykietą", () => {
    const { rerender } = render(
      <IconBoxView title="Analizy" description="Raporty sektorowe" href="/raporty" />,
    );
    expect(screen.getByRole("heading", { name: "Analizy" })).toBeInTheDocument();
    expect(screen.getByText("Raporty sektorowe")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();

    rerender(<IconBoxView title="Analizy" href="/raporty" linkLabel="Zobacz" />);
    expect(screen.getByRole("link", { name: "Zobacz" })).toHaveAttribute("href", "/raporty");
  });

  it("nieznana ikona z importu nie wywraca bloku - zostaje ikona zastępcza", () => {
    const { container } = render(<IconBoxView icon="nie-ma-takiej" title="X" />);
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

describe("StatsCounterView", () => {
  /** Wartość każdej pozycji (pierwszy węzeł pozycji; etykieta idzie pod nią). */
  const values = (root: HTMLElement) =>
    Array.from(root.firstElementChild?.children ?? []).map((item) =>
      norm(item.firstElementChild?.textContent),
    );

  it("SSR i element widoczny od razu: wartości KOŃCOWE, sformatowane w locale bloku", () => {
    const items: Json[] = [
      { value: "15000", suffix: "+", label: "Czytelników" },
      { value: "€250", suffix: "", label: "Budżet" },
    ];
    const html = renderToString(<StatsCounterView items={items} lang="pl" />);
    expect(norm(html.replace(/<[^>]+>/g, ""))).toContain("15 000+Czytelników");
    const { container } = render(<StatsCounterView items={items} lang="en" />);
    expect(values(container)).toEqual(["15,000+", "€250"]);
    expect(screen.getByText("Czytelników")).toBeInTheDocument();
  });

  // NAPRAWIONE 2026-10-18 (był defekt prezentacji): licznik zaokrąglał do
  // całości i doklejał 0 do wartości nieliczbowych.
  it("precyzja i wartości nieliczbowe przechodzą bez zmian", () => {
    const items: Json[] = [
      { value: "4,5", suffix: "/5" },
      { value: "N/A" },
      { value: "24/7" },
      { value: "1.000.000" },
      { value: "", suffix: "%" },
      { value: "-3" },
    ];
    const pl = render(<StatsCounterView items={items} lang="pl" />);
    expect(values(pl.container)).toEqual(["4,5/5", "N/A", "24/7", "1.000.000", "%", "-3"]);
    pl.unmount();
    const en = render(<StatsCounterView items={[{ value: "4,5", suffix: "/5" }]} lang="en" />);
    expect(values(en.container)).toEqual(["4.5/5"]);
  });

  it("poza viewportem stoi 0, po wejściu liczy w górę do dokładnej wartości", () => {
    const observers: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
          observers.push(cb);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() {
          return [];
        }
      },
    );
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    const { container } = render(
      <StatsCounterView items={[{ value: "200" }, { value: "4,5" }]} duration={1000} />,
    );
    expect(values(container)).toEqual(["200", "4,5"]);

    act(() => observers[0]([{ isIntersecting: false }]));
    expect(values(container)).toEqual(["0", "0,0"]);

    act(() => observers[0]([{ isIntersecting: true }]));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    const mid = Number(values(container)[0]);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(200);

    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(values(container)).toEqual(["200", "4,5"]);
  });

  it("brak pozycji albo nie-tablica = brak bloku", () => {
    expect(render(<StatsCounterView items={[]} />).container).toBeEmptyDOMElement();
    expect(render(<StatsCounterView />).container).toBeEmptyDOMElement();
  });
});

describe("TestimonialsView", () => {
  const items: Json[] = [
    {
      quote: "Świetna analiza",
      author: "Anna",
      role: "CEO",
      rating: 4,
      avatar: "https://cdn/a.jpg",
    },
    { quote: "Konkretnie", author: "Bartek", rating: 9 },
    { quote: "Bez oceny", author: "Celina", rating: "abc" },
  ];

  it("siatka: cytat w cudzysłowie, autor z rolą, ocena przycięta do 0..5", () => {
    render(<TestimonialsView items={items} />);
    const figures = screen.getAllByRole("figure");
    expect(figures).toHaveLength(3);
    expect(within(figures[0]).getByText('"Świetna analiza"')).toBeInTheDocument();
    expect(within(figures[0]).getByText("CEO")).toBeInTheDocument();
    expect(within(figures[0]).getByLabelText("Ocena: 4/5")).toBeInTheDocument();
    expect(within(figures[1]).getByLabelText("Ocena: 5/5")).toBeInTheDocument();
    expect(within(figures[2]).queryByLabelText(/Ocena/)).toBeNull();
    // Awatar jest dekoracją - podpis niesie nazwisko.
    expect(figures[0].querySelector("img")).toHaveAttribute("alt", "");
  });

  it("slider zawija się w obie strony i pokazuje pozycję", () => {
    render(<TestimonialsView items={items} layout="slider" />);
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Poprzednia" }));
    expect(screen.getByText("3 / 3")).toBeInTheDocument();
    expect(screen.getByText('"Bez oceny"')).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Następna" }));
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
  });

  // NAPRAWIONE 2026-10-18: `parsed[idx]` było undefined po skurczeniu listy
  // i render wywracał się na `t.rating`.
  it("lista skurczona pod bieżącym indeksem pokazuje ostatnią opinię zamiast się wywrócić", () => {
    const { rerender } = render(<TestimonialsView items={items} layout="slider" />);
    fireEvent.click(screen.getByRole("button", { name: "Poprzednia" }));
    rerender(<TestimonialsView items={items.slice(0, 2)} layout="slider" />);
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    expect(screen.getByText('"Konkretnie"')).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Następna" }));
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
  });

  it("jedna opinia w sliderze nie ma nawigacji; pusta lista = brak bloku", () => {
    const { container, rerender } = render(
      <TestimonialsView items={[{ quote: "Solo" }]} layout="slider" />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("figcaption")).toBeNull();
    rerender(<TestimonialsView items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("PricingTableView", () => {
  it("plan: cena z okresem, opis z HTML-a jako tekst, cechy, CTA i wyróżnienie", () => {
    render(
      <PricingTableView
        plans={[
          {
            name: "Pro",
            price: "99 zł",
            period: "/mies.",
            description: "<p>Dla <strong>firm</strong></p>",
            features: ["Raporty", 12],
            ctaLabel: "Kup",
            ctaHref: "/kup",
            featured: true,
          },
          { name: "Start", price: "0 zł", features: "nie-lista", ctaLabel: "Bez adresu" },
        ]}
      />,
    );
    expect(screen.getByText("99 zł")).toBeInTheDocument();
    expect(screen.getByText("/mies.")).toBeInTheDocument();
    // HTML z edytora trafia jako TEKST - żadnego znacznika w DOM-ie.
    expect(screen.getByText("Dla firm")).toBeInTheDocument();
    expect(document.querySelector("strong")).toBeNull();
    const lists = screen.getAllByRole("list");
    expect(lists).toHaveLength(1);
    expect(
      within(lists[0])
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Raporty", "12"]);
    // Wyróżniony jest tylko plan z `featured: true`; CTA wymaga etykiety I adresu.
    expect(screen.getAllByText("Polecane")).toHaveLength(1);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Kup" })).toHaveAttribute("href", "/kup");
  });

  it("brak planów albo nie-tablica = brak bloku", () => {
    expect(render(<PricingTableView plans={[]} />).container).toBeEmptyDOMElement();
    expect(render(<PricingTableView />).container).toBeEmptyDOMElement();
  });
});

describe("TimelineView", () => {
  it("lista uporządkowana: data, tytuł, opis jako tekst; puste pola bez pustych węzłów", () => {
    const { container } = render(
      <TimelineView
        items={[
          { date: "2024", title: "Start", description: "<em>Pierwszy</em> raport" },
          { title: "Bez daty" },
          null,
        ]}
      />,
    );
    const steps = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(steps).toHaveLength(3);
    expect(steps[0].querySelector("time")?.textContent).toBe("2024");
    expect(within(steps[0]).getByRole("heading", { name: "Start" })).toBeInTheDocument();
    expect(within(steps[0]).getByText("Pierwszy raport")).toBeInTheDocument();
    expect(steps[1].querySelector("time")).toBeNull();
    expect(steps[2].querySelector("time, h3, p")).toBeNull();
    expect(container.querySelector("em")).toBeNull();
  });

  it("pusta lista = brak bloku", () => {
    expect(render(<TimelineView items={[]} />).container).toBeEmptyDOMElement();
  });
});
