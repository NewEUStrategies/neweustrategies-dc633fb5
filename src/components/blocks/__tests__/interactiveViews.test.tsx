// Publiczne widoki bloków interaktywnych: `accordion`, `tabs`, `countdown`,
// `progress` (`InteractiveViews.tsx`). Bramkę ruchu licznika i parytet SSR
// placeholderów trzyma `countdownMotionGate.test.tsx` - tu reszta zachowania.
//
// CO MA TU DOWÓD
//  * akordeon: stan `aria-expanded`, tryb jednej/wielu sekcji, treść
//    przepuszczona przez wspólną politykę HTML (bez skryptów i handlerów),
//  * zakładki według wzorca WAI-ARIA: jedna zakładka w kolejności Tab,
//    strzałki/Home/End przenoszą wybór I fokus (wcześniej klawiatura nie
//    dochodziła do pozostałych paneli), wybór przycięty po skurczeniu listy,
//  * odliczanie: brak/zła data = brak bloku, po terminie tekst końcowy,
//    komórki zachowują węzły DOM między taktami (nie montują się od nowa),
//  * pasek postępu: wartość przycięta do 0..100 w ARIA i w etykiecie,
//    wypełnienie od 0 dopiero poza viewportem (stan „armed").
//
// GRANICE. Fałszywy zegar (`setInterval`/`Date`) i atrapa
// `IntersectionObserver`; sanityzacja i bramka ruchu są prawdziwe.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Json } from "@/lib/blocks/types";

import {
  AccordionView,
  CountdownView,
  ProgressView,
  TabsView,
} from "@/components/blocks/InteractiveViews";
import { __resetMotionGateForTests } from "@/lib/performance/motionGate";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  __resetMotionGateForTests();
});

// Handler PRZED skryptem: w happy-dom DOMPurify pomija węzeł tuż za usuniętym
// `<script>` (iterator węzłów niezgodny ze specyfikacją) - to artefakt
// środowiska testowego, zgłoszony osobno właścicielowi `lib/sanitize`.
const UNSAFE = '<p>Treść</p><img src="x" onerror="alert(1)"><script>alert(1)</script>';

describe("AccordionView", () => {
  const items: Json[] = [{ title: "Pierwsza", body: "<p>Jeden</p>" }, { body: "<p>Dwa</p>" }];
  const head = (name: string) => screen.getByRole("button", { name });

  it("sekcje zamknięte na starcie; pusty tytuł dostaje numer sekcji", () => {
    render(<AccordionView items={items} />);
    expect(head("Pierwsza")).toHaveAttribute("aria-expanded", "false");
    expect(head("Sekcja 2")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Jeden")).toBeNull();
  });

  it("tryb domyślny: otwarcie drugiej sekcji zamyka pierwszą; ponowny klik zamyka", () => {
    render(<AccordionView items={items} />);
    fireEvent.click(head("Pierwsza"));
    expect(screen.getByText("Jeden")).toBeInTheDocument();
    fireEvent.click(head("Sekcja 2"));
    expect(head("Pierwsza")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Jeden")).toBeNull();
    expect(screen.getByText("Dwa")).toBeInTheDocument();
    fireEvent.click(head("Sekcja 2"));
    expect(screen.queryByText("Dwa")).toBeNull();
  });

  it("`allowMultiple` trzyma otwarte kilka sekcji naraz", () => {
    render(<AccordionView items={items} allowMultiple />);
    fireEvent.click(head("Pierwsza"));
    fireEvent.click(head("Sekcja 2"));
    expect(screen.getByText("Jeden")).toBeInTheDocument();
    expect(screen.getByText("Dwa")).toBeInTheDocument();
  });

  it("treść idzie przez politykę HTML: bez `<script>` i handlerów zdarzeń", () => {
    const { container } = render(<AccordionView items={[{ title: "X", body: UNSAFE }]} />);
    fireEvent.click(head("X"));
    expect(screen.getByText("Treść")).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
  });

  it("pusta lista = brak bloku", () => {
    expect(render(<AccordionView items={[]} />).container).toBeEmptyDOMElement();
  });
});

describe("TabsView", () => {
  const items: Json[] = [
    { label: "Opis", body: "<p>Panel opisu</p>" },
    { label: "Dane", body: "<p>Panel danych</p>" },
    { body: "<p>Panel trzeci</p>" },
  ];
  const tab = (name: string) => screen.getByRole("tab", { name });
  const selected = () =>
    screen
      .getAllByRole("tab")
      .filter((t) => t.getAttribute("aria-selected") === "true")
      .map((t) => t.textContent);

  it("pierwsza zakładka wybrana i jako jedyna w kolejności Tab; panel powiązany z zakładką", () => {
    render(<TabsView items={items} />);
    expect(screen.getByRole("tablist")).toHaveAttribute("aria-orientation", "horizontal");
    expect(selected()).toEqual(["Opis"]);
    expect(screen.getAllByRole("tab").map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    // Ukryte panele nie są w drzewie dostępności - widoczny jest dokładnie jeden.
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveTextContent("Panel opisu");
    expect(panel).toHaveAttribute("aria-labelledby", tab("Opis").id);
    expect(tab("Opis")).toHaveAttribute("aria-controls", panel.id);
    expect(tab("Tab 3")).toBeInTheDocument();
  });

  it("klik przełącza panel", () => {
    render(<TabsView items={items} />);
    fireEvent.click(tab("Dane"));
    expect(selected()).toEqual(["Dane"]);
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel danych");
  });

  // NAPRAWIONE 2026-10-18 (był defekt dostępności): niewybrane zakładki mają
  // `tabIndex=-1`, a strzałek nie było - klawiatura stała na pierwszej.
  it("strzałki w poziomie zawijają się, Home/End skaczą na krańce; wybór i fokus idą razem", () => {
    render(<TabsView items={items} />);
    tab("Opis").focus();
    fireEvent.keyDown(tab("Opis"), { key: "ArrowRight" });
    expect(selected()).toEqual(["Dane"]);
    expect(tab("Dane")).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel danych");

    fireEvent.keyDown(tab("Dane"), { key: "End" });
    expect(tab("Tab 3")).toHaveFocus();
    fireEvent.keyDown(tab("Tab 3"), { key: "ArrowRight" });
    expect(selected()).toEqual(["Opis"]);
    fireEvent.keyDown(tab("Opis"), { key: "ArrowLeft" });
    expect(selected()).toEqual(["Tab 3"]);
    fireEvent.keyDown(tab("Tab 3"), { key: "Home" });
    expect(selected()).toEqual(["Opis"]);
    expect(tab("Opis")).toHaveFocus();
  });

  it("w pionie działają strzałki góra/dół, a poziome i inne klawisze nic nie zmieniają", () => {
    render(<TabsView items={items} orientation="vertical" />);
    expect(screen.getByRole("tablist")).toHaveAttribute("aria-orientation", "vertical");
    fireEvent.keyDown(tab("Opis"), { key: "ArrowRight" });
    fireEvent.keyDown(tab("Opis"), { key: "Enter" });
    expect(selected()).toEqual(["Opis"]);
    fireEvent.keyDown(tab("Opis"), { key: "ArrowDown" });
    expect(selected()).toEqual(["Dane"]);
    fireEvent.keyDown(tab("Dane"), { key: "ArrowUp" });
    fireEvent.keyDown(tab("Opis"), { key: "ArrowUp" });
    expect(selected()).toEqual(["Tab 3"]);
  });

  // NAPRAWIONE 2026-10-18: po usunięciu wybranej (ostatniej) zakładki na
  // kanwie żadna nie była wybrana, a wszystkie miały `tabIndex=-1`.
  it("lista skurczona pod wybraną zakładką wybiera ostatnią pozostałą", () => {
    const { rerender } = render(<TabsView items={items} />);
    fireEvent.click(tab("Tab 3"));
    rerender(<TabsView items={items.slice(0, 2)} />);
    expect(selected()).toEqual(["Dane"]);
    expect(tab("Dane").tabIndex).toBe(0);
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel danych");
  });

  it("panel przechodzi przez politykę HTML; pusta lista = brak bloku", () => {
    const { container, rerender } = render(<TabsView items={[{ label: "X", body: UNSAFE }]} />);
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Treść");
    expect(container.querySelector("script, [onerror]")).toBeNull();
    rerender(<TabsView items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("CountdownView", () => {
  const NOW = new Date("2026-10-08T10:00:00.000Z");
  const startClock = () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(NOW);
  };
  /** Węzeł wartości komórki o danej jednostce (wartość stoi tuż przed etykietą). */
  const cell = (unit: string) => screen.getByText(unit).previousElementSibling;

  it("brak albo nieparsowalna data = brak bloku", () => {
    expect(render(<CountdownView />).container).toBeEmptyDOMElement();
    expect(render(<CountdownView targetAt="kiedyś" />).container).toBeEmptyDOMElement();
  });

  it("dni, godziny, minuty i sekundy z dwiema cyframi oraz etykieta bloku", () => {
    startClock();
    const target = new Date(NOW.getTime() + 3 * 86_400_000 + 4 * 3_600_000 + 5 * 60_000 + 6_000);
    render(<CountdownView targetAt={target.toISOString()} label="Do konferencji" lang="en" />);
    expect(screen.getByText("Do konferencji")).toBeInTheDocument();
    expect(["days", "hrs", "min", "s"].map((u) => cell(u)?.textContent)).toEqual([
      "03",
      "04",
      "05",
      "06",
    ]);
  });

  it("po terminie tekst końcowy: własny, a pusty/biały - domyślny w języku bloku", () => {
    startClock();
    const past = new Date(NOW.getTime() - 1000).toISOString();
    const own = render(<CountdownView targetAt={past} expiredText="Rejestracja zamknięta" />);
    expect(own.container).toHaveTextContent("Rejestracja zamknięta");
    own.unmount();
    const pl = render(<CountdownView targetAt={past} expiredText="   " />);
    expect(pl.container).toHaveTextContent("Zakończono");
    pl.unmount();
    const en = render(<CountdownView targetAt={past} lang="en" />);
    expect(en.container).toHaveTextContent("Ended");
  });

  it("takt, który mija termin, przełącza licznik na tekst końcowy", () => {
    startClock();
    const target = new Date(NOW.getTime() + 30_000).toISOString();
    const { container } = render(<CountdownView targetAt={target} />);
    expect(cell("s")?.textContent).toBe("30");
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(container).toHaveTextContent("Zakończono");
    expect(screen.queryByText("s")).toBeNull();
  });

  // Optymalizacja 2026-10-18: `Cell` był komponentem definiowanym w renderze,
  // więc co takt React montował wszystkie cztery komórki od nowa.
  it("takt aktualizuje komórki w miejscu - te same węzły DOM, nowa wartość", () => {
    startClock();
    const target = new Date(NOW.getTime() + 2 * 3_600_000 + 10 * 60_000).toISOString();
    render(<CountdownView targetAt={target} />);
    const before = cell("min");
    expect(before?.textContent).toBe("10");
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    const after = cell("min");
    expect(after).toBe(before);
    expect(after?.textContent).toBe("09");
  });
});

describe("ProgressView", () => {
  const bar = () => screen.getByRole("progressbar");
  const fillWidth = () => (bar().firstElementChild as HTMLElement).style.width;

  it("wartość przycięta do 0..100 w ARIA i w etykiecie; nazwa z etykiety bloku", () => {
    const { rerender } = render(<ProgressView value={150} label="Zbiórka" />);
    expect(screen.getByRole("progressbar", { name: "Zbiórka" })).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(fillWidth()).toBe("100%");
    rerender(<ProgressView value={-5} label="Zbiórka" />);
    expect(bar()).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("bez etykiety i bez wartości nie ma wiersza nagłówka; pasek bez nazwy", () => {
    const { container } = render(<ProgressView value={40} showValue={false} />);
    expect(container.querySelector("span")).toBeNull();
    expect(bar()).not.toHaveAttribute("aria-label");
    expect(fillWidth()).toBe("40%");
  });

  it("poza viewportem wypełnienie startuje od 0, po wejściu rośnie do wartości", () => {
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
    render(<ProgressView value={65} label="Postęp" />);
    act(() => observers[0]([{ isIntersecting: false }]));
    expect(fillWidth()).toBe("0%");
    // ARIA niesie wartość docelową niezależnie od animacji.
    expect(bar()).toHaveAttribute("aria-valuenow", "65");
    act(() => observers[0]([{ isIntersecting: true }]));
    expect(fillWidth()).toBe("65%");
  });
});
