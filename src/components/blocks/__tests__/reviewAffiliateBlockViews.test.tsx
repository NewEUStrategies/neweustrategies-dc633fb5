// Recenzja (Review Box) i produkt afiliacyjny - dwa bloki „zakupowe" wpisu.
//
// Oba niosą liczby wpisane w panelu albo przyniesione importem (ocena,
// skala, gwiazdki) i oba linkują NA ZEWNĄTRZ. Dowodzimy więc trzech rzeczy:
//   1. liczba na stronie to ta sama liczba, którą pokazuje panel (ocena łączna
//      liczona tylko z kryteriów z nazwą, skala i gwiazdki w granicach pól
//      edytora) - bez „NaN", „Infinity%" i pięciu gwiazdek za ocenę 7/5,
//   2. odnośnik zewnętrzny ma `rel` wymagany dla treści sponsorowanej,
//   3. JSON-LD recenzji jest poprawnym obiektem schema.org i nie da się nim
//      zamknąć znacznika `<script>`.
//
// Granice: brak - oba widoki są czyste (propsy -> DOM).
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { ReviewBlockView } from "../ReviewBlockView";
import { AffiliateBlockView } from "../AffiliateBlockView";

afterEach(() => cleanup());

const CRITERIA = [
  { label: "Jakość", score: 9 },
  { label: "Cena", score: 6 },
  { label: "   ", score: 1 },
];

function jsonLd(container: HTMLElement): Record<string, unknown> | null {
  const node = container.querySelector('script[type="application/ld+json"]');
  return node ? (JSON.parse(node.textContent ?? "") as Record<string, unknown>) : null;
}

/** Szerokości pasków kryteriów (style inline), w kolejności renderu. */
function barWidths(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[style*='width']")).map(
    (el) => el.style.width,
  );
}

describe("ReviewBlockView - ocena", () => {
  it("ocena łączna to średnia TYLKO kryteriów z nazwą", () => {
    const { container } = render(<ReviewBlockView title="Laptop" criteria={CRITERIA} />);
    // (9 + 6) / 2 = 7.5; kryterium bez nazwy (ocena 1) nie zaniża wyniku.
    expect(container.textContent).toContain("7.5");
    expect(container.textContent).toContain("/ 10");
    expect(screen.getByText("Jakość")).toBeTruthy();
    expect(screen.queryByText("1.0")).toBeNull();
    expect(barWidths(container)).toEqual(["90%", "60%"]);
  });

  it("BEZ kryteriów ocena to 0.0, a sekcja pasków nie powstaje", () => {
    const { container } = render(<ReviewBlockView title="Pusty" criteria={[]} />);
    expect(container.textContent).toContain("0.0");
    expect(barWidths(container)).toEqual([]);
  });

  it.each([
    ["pl", "Ocena ogólna", "Werdykt"],
    ["en", "Overall score", "Verdict"],
  ] as const)("etykiety w języku %s i werdykt z podsumowania", (lang, overall, verdict) => {
    const { container } = render(
      <ReviewBlockView criteria={CRITERIA} summary={"Dobry.\nPolecam."} lang={lang} />,
    );
    expect(container.textContent).toContain(overall);
    expect(container.textContent).toContain(verdict);
    expect(container.textContent).toContain("Dobry.\nPolecam.");
  });

  // NAPRAWIONE 2026-10-18: skala spoza pola edytora. Panel (`edit/Review.tsx`)
  // przycina skalę do 5-10, a widok publiczny brał ją surowo - skala 0 z
  // importu dawała dzielenie przez zero („Infinity%" w szerokości paska,
  // `bestRating: 0` w JSON-LD), a 100 pokazywała „/ 100" tam, gdzie panel
  // pokazuje „/ 10". Widok przycina skalę tak samo jak panel.
  it.each([
    [0, 5],
    [-5, 5],
    [3, 5],
    [7, 7],
    [100, 10],
  ])("skala %i jest przycinana do granic panelu (%i)", (scale, shown) => {
    const { container } = render(
      <ReviewBlockView title="T" criteria={[{ label: "A", score: 5 }]} scale={scale} />,
    );
    expect(container.textContent).toContain(`/ ${shown}`);
    expect(jsonLd(container)).toMatchObject({ reviewRating: { bestRating: shown } });
    const [width] = barWidths(container);
    expect(Number.parseFloat(width)).toBeCloseTo((5 / shown) * 100, 5);
  });

  it("pasek ocen poza skalą nie wychodzi poza 0-100%", () => {
    const { container } = render(
      <ReviewBlockView
        criteria={[
          { label: "Za dużo", score: 15 },
          { label: "Ujemna", score: -2 },
        ]}
      />,
    );
    expect(barWidths(container)).toEqual(["100%", "0%"]);
  });
});

describe("ReviewBlockView - CTA i JSON-LD", () => {
  it("CTA jest odnośnikiem zewnętrznym ze znacznikiem treści sponsorowanej", () => {
    render(<ReviewBlockView criteria={CRITERIA} ctaLabel="Kup" ctaHref="https://sklep.test/x" />);
    const links = screen.getAllByRole("link", { name: "Kup" });
    // Dwa warianty układu (desktop w pasku, mobile pod kartą) - oba z tym samym rel.
    expect(links).toHaveLength(2);
    for (const a of links) {
      expect(a).toHaveAttribute("href", "https://sklep.test/x");
      expect(a).toHaveAttribute("target", "_blank");
      expect(a).toHaveAttribute("rel", "noopener noreferrer sponsored");
    }
  });

  it("CTA bez adresu albo bez etykiety nie powstaje", () => {
    render(<ReviewBlockView criteria={CRITERIA} ctaLabel="Kup" />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("JSON-LD to Review z oceną łączną, skalą i treścią werdyktu", () => {
    const { container } = render(
      <ReviewBlockView title="Laptop" summary="Werdykt" criteria={CRITERIA} scale={10} />,
    );
    expect(jsonLd(container)).toEqual({
      "@context": "https://schema.org",
      "@type": "Review",
      name: "Laptop",
      reviewRating: { "@type": "Rating", ratingValue: "7.5", bestRating: 10, worstRating: 0 },
      reviewBody: "Werdykt",
    });
  });

  it("tytuł z `</script>` nie zamyka znacznika JSON-LD (brak żywego HTML)", () => {
    const evil = "</script><img src=x onerror=alert(1)>";
    const { container } = render(<ReviewBlockView title={evil} criteria={CRITERIA} />);
    expect(container.querySelectorAll("script")).toHaveLength(1);
    expect(container.querySelector("img")).toBeNull();
    expect(jsonLd(container)).toMatchObject({ name: evil, reviewBody: "" });
  });

  it("BEZ tytułu JSON-LD nie powstaje (schema.org wymaga nazwy)", () => {
    const { container } = render(<ReviewBlockView criteria={CRITERIA} />);
    expect(jsonLd(container)).toBeNull();
  });
});

describe("AffiliateBlockView", () => {
  const BASE = {
    title: "Słuchawki X",
    description: "Opis produktu",
    image: "https://cdn.test/x.jpg",
    price: "199",
    currency: "PLN",
    store: "Sklep Y",
    ctaHref: "https://sklep.test/x",
  };

  it("BEZ tytułu blok znika", () => {
    const { container } = render(<AffiliateBlockView {...BASE} title="" />);
    expect(container.innerHTML).toBe("");
  });

  it("domyślnie oznacza treść jako sponsorowaną: plakietka i rel sponsored nofollow (PL)", () => {
    const { container } = render(<AffiliateBlockView {...BASE} lang="pl" />);
    expect(container.textContent).toContain("Sponsorowane");
    expect(container.textContent).toContain("w Sklep Y");
    expect(container.textContent).toContain("199");
    expect(container.textContent).toContain("PLN");
    const cta = screen.getByRole("link", { name: "Sprawdź ofertę" });
    expect(cta).toHaveAttribute("href", "https://sklep.test/x");
    expect(cta).toHaveAttribute("rel", "noopener noreferrer sponsored nofollow");
    expect(screen.getByRole("img", { name: "Słuchawki X" })).toHaveAttribute(
      "src",
      "https://cdn.test/x.jpg",
    );
  });

  it("sponsored=false zdejmuje plakietkę i znaczniki sponsorowane z rel (EN, własna etykieta)", () => {
    const { container } = render(
      <AffiliateBlockView {...BASE} sponsored={false} ctaLabel="Buy now" lang="en" />,
    );
    expect(container.textContent).not.toContain("Sponsored");
    expect(container.textContent).toContain("at Sklep Y");
    expect(screen.getByRole("link", { name: "Buy now" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
  });

  it("domyślna etykieta CTA po angielsku; brak obrazu, ceny, sklepu i adresu nie zostawia pustych elementów", () => {
    const { container } = render(<AffiliateBlockView title="Goły produkt" lang="en" />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.textContent).toBe("SponsoredGoły produkt");
  });

  it("ocena 4.4 renderuje rząd pięciu gwiazdek i wartość z jednym miejscem po przecinku", () => {
    const { container } = render(<AffiliateBlockView {...BASE} rating={4.4} />);
    expect(container.querySelectorAll("svg")).toHaveLength(5);
    expect(container.textContent).toContain("4.4");
  });

  // NAPRAWIONE 2026-10-18: panel (`edit/Affiliate.tsx`) przycina ocenę do 0-5,
  // a widok brał ją surowo - import z oceną 7 pokazywał „7.0" przy pięciu
  // gwiazdkach. Widok przycina tak samo jak panel.
  it("ocena powyżej skali jest przycinana do 5 jak w panelu", () => {
    const { container } = render(<AffiliateBlockView {...BASE} rating={7} />);
    expect(container.textContent).toContain("5.0");
    expect(container.textContent).not.toContain("7.0");
  });

  it.each([0, -2])("ocena %i nie renderuje rzędu gwiazdek", (rating) => {
    const { container } = render(<AffiliateBlockView {...BASE} rating={rating} />);
    expect(container.querySelectorAll("svg")).toHaveLength(0);
  });
});
