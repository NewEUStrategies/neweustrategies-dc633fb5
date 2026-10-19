// Dane i dostępność publicznych widoków bloków: cechy planu cennika,
// odliczanie według wzorca WAI-ARIA `timer` i nazwa linku logotypu.
//
// CO MA TU DOWÓD
//  * cennik pokazuje tylko cechy tekstowe (napis, liczba) - `null`, obiekt czy
//    tablica z importu malowały się jako „null" i „[object Object]"; edytor
//    odrzucał je już wcześniej, teraz strona publiczna mówi to samo,
//  * odliczanie: wartość tykająca co sekundę ma rolę `timer` (domyślnie bez
//    ogłaszania) zamiast `aria-live="polite"`, przez które czytnik ekranu
//    odczytywał licznik bez przerwy; koniec odliczania to `status` ogłaszany
//    raz, a kolejne takty nie zmieniają jego treści,
//  * logo z adresem i pustym `alt` nie jest już linkiem bez nazwy: nazwę daje
//    host adresu przepuszczonego przez `safeUrl`, a niebezpieczny adres nie
//    tworzy linku w ogóle.
//
// GRANICE. Prawdziwe widoki i prawdziwe i18n; fałszywy zegar
// (`setInterval`/`Date`) tylko w odliczaniu.
import "@/test/i18nReal";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";

import { PricingTableView } from "@/components/blocks/PresentationViews";
import { CountdownView } from "@/components/blocks/InteractiveViews";
import { LogoGridView } from "@/components/blocks/DataSocialViews";
import { __resetMotionGateForTests } from "@/lib/performance/motionGate";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  __resetMotionGateForTests();
});

describe("PricingTableView - cechy planu", () => {
  it("pomija cechy nie-tekstowe (null, obiekt, tablica); liczba zostaje tekstem", () => {
    render(
      <PricingTableView
        plans={[{ name: "Pro", features: ["Raporty", null, { a: 1 }, ["x"], 5, "Wsparcie"] }]}
      />,
    );
    const features = within(screen.getByRole("list"))
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(features).toEqual(["Raporty", "5", "Wsparcie"]);
    expect(screen.queryByText("null")).toBeNull();
    expect(screen.queryByText("[object Object]")).toBeNull();
  });

  it("plan bez żadnej cechy tekstowej nie ma listy", () => {
    render(<PricingTableView plans={[{ name: "Pro", features: [null, { a: 1 }] }]} />);
    expect(screen.queryByRole("list")).toBeNull();
  });
});

describe("CountdownView - wzorzec WAI-ARIA timer", () => {
  const NOW = new Date("2026-10-08T10:00:00.000Z");
  const startClock = () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(NOW);
  };

  it("tykająca wartość ma rolę timer nazwaną etykietą bloku, bez regionu na żywo", () => {
    startClock();
    const target = new Date(NOW.getTime() + 2 * 3_600_000).toISOString();
    const { container } = render(<CountdownView targetAt={target} label="Do konferencji" />);
    const timer = screen.getByRole("timer", { name: "Do konferencji" });
    expect(within(timer).getByText("godz.")).toBeInTheDocument();
    expect(timer).not.toHaveAttribute("aria-live", "polite");
    expect(container.querySelector('[aria-live="polite"], [aria-live="assertive"]')).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("koniec odliczania to status ogłaszany raz - kolejne takty nie zmieniają treści", () => {
    startClock();
    const target = new Date(NOW.getTime() + 1_000).toISOString();
    render(<CountdownView targetAt={target} expiredText="Rejestracja zamknięta" />);
    expect(screen.getByRole("timer")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.queryByRole("timer")).toBeNull();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Rejestracja zamknięta");
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(screen.getByRole("status")).toBe(status);
    expect(status).toHaveTextContent("Rejestracja zamknięta");
  });
});

describe("LogoGridView - nazwa dostępna linku", () => {
  it("logo z adresem i pustym alt: link nazwany hostem adresu (bez „www.”)", () => {
    render(
      <LogoGridView
        items={[{ url: "https://cdn.example/a.svg", alt: "", href: "https://www.acme.example/x" }]}
      />,
    );
    expect(screen.getByRole("link", { name: "acme.example" })).toHaveAttribute(
      "href",
      "https://www.acme.example/x",
    );
  });

  it("alt logo ma pierwszeństwo przed hostem", () => {
    render(
      <LogoGridView
        items={[{ url: "https://cdn.example/a.svg", alt: "Acme", href: "https://acme.example" }]}
      />,
    );
    expect(screen.getByRole("link", { name: "Acme" })).toBeInTheDocument();
  });

  it("niebezpieczny adres nie robi z logo linku; samo logo zostaje", () => {
    render(
      <LogoGridView
        items={[{ url: "https://cdn.example/a.svg", alt: "Acme", href: "javascript:alert(1)" }]}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("img", { name: "Acme" })).toBeInTheDocument();
  });
});
