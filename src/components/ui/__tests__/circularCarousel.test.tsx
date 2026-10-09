// Molekuła `CircularCarousel` - karuzela okrężna z nawigacją klawiaturą.
//
// CO TEN PLIK DOWODZI.
//   1. KLAWIATURA: strzałki i Home/End na całym regionie, Enter/Spacja na karcie.
//   2. OGNISKO IDZIE ZA AKTYWNĄ KARTĄ (roving tabindex). Przed poprawką ognisko
//      zostawało na starej karcie; po trzech krokach ta karta wypadała z widoku,
//      znikała z DOM i ognisko lądowało na <body> - dalsza nawigacja strzałkami
//      przestawała działać.
//   3. ENTER NA LINKU KARTY NAWIGUJE - obsługa karty nie zjada go już
//      `preventDefault`-em.
//   4. AUTO-PLAY: minimalny interwał 1 s, pauza pod kursorem i przy ognisku
//      NIEZALEŻNIE (zjazd myszą nie wznawia rotacji, gdy ognisko jest w środku),
//      brak rotacji przy `prefers-reduced-motion` i przy jednej karcie.
//   5. TRYB KONTROLOWANY: `activeIndex` + `onActiveChange`, przycięcie indeksu.
//   6. BRAMKA RUCHU (P3.5): rotacja stoi do pierwszej interakcji albo punktu
//      ciszy (tu atrapa), pierwszy obrót pełny interwał po otwarciu bramki.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Punkt ciszy bramki ruchu tylko na żądanie testu.
vi.mock("@/lib/performance/whenQuiescent", () => ({ onQuiescent: () => () => {} }));
import { __openMotionGateForTests, __resetMotionGateForTests } from "@/lib/performance/motionGate";
import {
  CircularCarousel,
  getItemPosition,
  type CircularCarouselItem,
  type CircularCarouselLabels,
} from "@/components/ui/circular-carousel";

const LABELS: CircularCarouselLabels = {
  of: "z",
  previous: "Poprzednia karta",
  next: "Następna karta",
  goTo: "Przejdź do karty {{n}}",
  region: "Karuzela okrężna",
};

const items = (n: number): CircularCarouselItem[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `k${i + 1}`,
    title: `Karta ${i + 1}`,
    description: i === 0 ? "" : `Opis ${i + 1}`,
  }));

const aktywna = (): HTMLElement => screen.getByRole("option", { selected: true });
const region = (): HTMLElement => screen.getByRole("region", { name: LABELS.region });
const klawisz = (el: Element, key: string) => fireEvent.keyDown(el, { key });

function mockReducedMotion(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  __resetMotionGateForTests();
});

describe("getItemPosition", () => {
  it("zwraca null bez kart", () => {
    expect(getItemPosition(0, 0, 0, 5, 220, 100)).toBeNull();
  });

  it("aktywna karta stoi na środku, w pełnej skali i na wierzchu", () => {
    expect(getItemPosition(2, 2, 5, 5, 220, 100)).toEqual({
      x: 0,
      y: 0,
      scale: 1,
      opacity: 1,
      zIndex: 5,
      adjustedOffset: 0,
    });
  });

  it("zawija przesunięcie przez koniec listy w obie strony", () => {
    expect(getItemPosition(0, 6, 7, 5, 220, 100)?.adjustedOffset).toBe(1);
    expect(getItemPosition(6, 0, 7, 5, 220, 100)?.adjustedOffset).toBe(-1);
  });

  it("karta dalej niż połowa widocznych jest poza widokiem", () => {
    expect(getItemPosition(3, 0, 7, 5, 220, 100)).toBeNull();
  });
});

describe("CircularCarousel - struktura i dostępność", () => {
  it("nie renderuje niczego bez kart", () => {
    const { container } = render(<CircularCarousel items={[]} labels={LABELS} />);
    expect(container.innerHTML).toBe("");
  });

  it("region ma rolę karuzeli, a w taborze jest tylko aktywna karta", () => {
    render(<CircularCarousel items={items(3)} labels={LABELS} autoPlay={false} />);
    expect(region().getAttribute("aria-roledescription")).toBe("carousel");
    expect(region().tabIndex).toBe(0);
    const opcje = screen.getAllByRole("option");
    expect(opcje.map((o) => o.tabIndex)).toEqual([0, -1, -1]);
    expect(aktywna().getAttribute("aria-label")).toBe("Karta 1");
    expect(screen.getByRole("listbox", { name: LABELS.region })).toBeTruthy();
  });

  it("strzałki pod kartami sterują listą kart (`aria-controls`)", () => {
    render(<CircularCarousel items={items(3)} labels={LABELS} autoPlay={false} />);
    const listId = screen.getByRole("listbox").id;
    expect(
      screen.getByRole("button", { name: LABELS.previous }).getAttribute("aria-controls"),
    ).toBe(listId);
    expect(screen.getByRole("button", { name: LABELS.next }).getAttribute("aria-controls")).toBe(
      listId,
    );
  });

  it("licznik pokazuje numer aktywnej karty z zerem wiodącym i ogłasza zmianę bez rotacji", () => {
    render(<CircularCarousel items={items(12)} labels={LABELS} autoPlay={false} />);
    const licznik = screen.getByText("01").parentElement as HTMLElement;
    expect(licznik.textContent).toBe("01z 12");
    expect(licznik.getAttribute("aria-live")).toBe("polite");
    expect(licznik.getAttribute("aria-atomic")).toBe("true");
  });

  it("tag i opis karty są opcjonalne", () => {
    render(
      <CircularCarousel
        items={[
          { id: "a", title: "Z tagiem", description: "Opis A", tag: "Nowość" },
          { id: "b", title: "Bez opisu", description: "" },
        ]}
        labels={LABELS}
        autoPlay={false}
      />,
    );
    expect(screen.getByText("Nowość")).toBeTruthy();
    expect(screen.getByText("Opis A")).toBeTruthy();
    const bezOpisu = screen.getByRole("option", { name: "Bez opisu" });
    expect(bezOpisu.querySelectorAll("p")).toHaveLength(1);
  });

  it("chowa licznik, kropki i strzałki na żądanie", () => {
    render(
      <CircularCarousel
        items={items(3)}
        labels={LABELS}
        autoPlay={false}
        showCounter={false}
        showDots={false}
        showArrows={false}
      />,
    );
    expect(screen.queryByText("01")).toBeNull();
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  it("kropka aktywnej karty ma `aria-current`, pozostałe nie", () => {
    render(<CircularCarousel items={items(3)} labels={LABELS} autoPlay={false} />);
    const kropki = [1, 2, 3].map((n) =>
      screen.getByRole("button", { name: `Przejdź do karty ${n}` }),
    );
    expect(kropki.map((k) => k.getAttribute("aria-current"))).toEqual(["true", "false", "false"]);
    // Aktywna kropka jest wydłużona; tło z tokenu akcentu (`var()` w skrócie
    // `background`) happy-dom odrzuca, więc kształt sprawdzamy klasą.
    expect(kropki[0].className).toContain("w-6");
    expect(kropki[1].className).toContain("w-1.5");
  });
});

describe("CircularCarousel - nawigacja klawiaturą", () => {
  it("strzałki w prawo i w lewo przesuwają aktywną kartę z zawinięciem", () => {
    render(<CircularCarousel items={items(3)} labels={LABELS} autoPlay={false} />);
    klawisz(region(), "ArrowLeft");
    expect(aktywna().getAttribute("aria-label")).toBe("Karta 3");
    klawisz(region(), "ArrowRight");
    klawisz(region(), "ArrowRight");
    expect(aktywna().getAttribute("aria-label")).toBe("Karta 2");
  });

  it("Home i End skaczą na pierwszą i ostatnią kartę", () => {
    render(<CircularCarousel items={items(6)} labels={LABELS} autoPlay={false} />);
    klawisz(region(), "End");
    expect(aktywna().getAttribute("aria-label")).toBe("Karta 6");
    klawisz(region(), "Home");
    expect(aktywna().getAttribute("aria-label")).toBe("Karta 1");
  });

  it("obsłużone klawisze nie przewijają strony, a inne przechodzą bez zmian", () => {
    render(<CircularCarousel items={items(3)} labels={LABELS} autoPlay={false} />);
    expect(klawisz(region(), "ArrowRight")).toBe(false);
    expect(klawisz(region(), "End")).toBe(false);
    expect(klawisz(region(), "Tab")).toBe(true);
    expect(aktywna().getAttribute("aria-label")).toBe("Karta 3");
  });

  it("ognisko idzie za aktywną kartą przez cały obrót, także gdy stara karta wypada z widoku", () => {
    render(<CircularCarousel items={items(7)} labels={LABELS} autoPlay={false} />);
    act(() => aktywna().focus());
    for (let krok = 2; krok <= 8; krok++) {
      klawisz(document.activeElement as Element, "ArrowRight");
      const oczekiwana = `Karta ${((krok - 1) % 7) + 1}`;
      expect(aktywna().getAttribute("aria-label")).toBe(oczekiwana);
      expect(document.activeElement).toBe(aktywna());
      expect(aktywna().tabIndex).toBe(0);
    }
  });

  it("skok End z karty, która wypada z widoku, przenosi ognisko na nową aktywną", () => {
    render(<CircularCarousel items={items(9)} labels={LABELS} autoPlay={false} />);
    act(() => aktywna().focus());
    klawisz(document.activeElement as Element, "End");
    klawisz(document.activeElement as Element, "Home");
    klawisz(document.activeElement as Element, "End");
    expect(document.activeElement).toBe(aktywna());
    expect(aktywna().getAttribute("aria-label")).toBe("Karta 9");
  });

  it("strzałka przy ognisku na regionie nie przenosi ogniska do listy", () => {
    render(<CircularCarousel items={items(4)} labels={LABELS} autoPlay={false} />);
    act(() => region().focus());
    klawisz(region(), "ArrowRight");
    expect(document.activeElement).toBe(region());
  });

  it("Home na już pierwszej karcie nie zostawia flagi, która ukradłaby ognisko strzałce", () => {
    render(<CircularCarousel items={items(4)} labels={LABELS} autoPlay={false} />);
    act(() => aktywna().focus());
    klawisz(document.activeElement as Element, "Home");
    const nastepna = screen.getByRole("button", { name: LABELS.next });
    act(() => nastepna.focus());
    fireEvent.click(nastepna);
    expect(aktywna().getAttribute("aria-label")).toBe("Karta 2");
    expect(document.activeElement).toBe(nastepna);
  });

  it("Enter i Spacja na karcie aktywują ją", () => {
    render(<CircularCarousel items={items(4)} labels={LABELS} autoPlay={false} />);
    klawisz(screen.getByRole("option", { name: "Karta 2" }), "Enter");
    expect(aktywna().getAttribute("aria-label")).toBe("Karta 2");
    klawisz(screen.getByRole("option", { name: "Karta 4" }), " ");
    expect(aktywna().getAttribute("aria-label")).toBe("Karta 4");
    expect(klawisz(aktywna(), "Escape")).toBe(true);
  });

  it("Enter na linku karty nie jest blokowany i nie zmienia aktywnej karty", () => {
    render(
      <CircularCarousel
        items={[
          { id: "a", title: "Pierwsza", description: "", href: "https://example.test/a" },
          { id: "b", title: "Druga", description: "", href: "https://example.test/b" },
        ]}
        labels={LABELS}
        autoPlay={false}
      />,
    );
    const link = screen.getByRole("link", { name: /Druga/ });
    expect(link.tabIndex).toBe(-1);
    expect(klawisz(link, "Enter")).toBe(true);
    expect(aktywna().getAttribute("aria-label")).toBe("Pierwsza");
    expect(screen.getByRole("link", { name: /Pierwsza/ }).tabIndex).toBe(0);
  });
});

describe("CircularCarousel - mysz", () => {
  it("klik w kartę ją aktywuje, a klik w link karty - nie", () => {
    render(
      <CircularCarousel
        items={[
          { id: "a", title: "A", description: "" },
          { id: "b", title: "B", description: "", href: "https://example.test/b" },
          { id: "c", title: "C", description: "" },
        ]}
        labels={LABELS}
        autoPlay={false}
      />,
    );
    fireEvent.click(screen.getByRole("link", { name: /B/ }));
    expect(aktywna().getAttribute("aria-label")).toBe("A");
    fireEvent.click(screen.getByRole("option", { name: "C" }));
    expect(aktywna().getAttribute("aria-label")).toBe("C");
  });

  it("strzałki i kropki zmieniają kartę z zawinięciem", () => {
    render(<CircularCarousel items={items(3)} labels={LABELS} autoPlay={false} />);
    fireEvent.click(screen.getByRole("button", { name: LABELS.previous }));
    expect(aktywna().getAttribute("aria-label")).toBe("Karta 3");
    fireEvent.click(screen.getByRole("button", { name: LABELS.next }));
    expect(aktywna().getAttribute("aria-label")).toBe("Karta 1");
    fireEvent.click(screen.getByRole("button", { name: "Przejdź do karty 2" }));
    expect(aktywna().getAttribute("aria-label")).toBe("Karta 2");
  });
});

describe("CircularCarousel - tryb kontrolowany", () => {
  it("zgłasza zmianę, ale nie przestawia się sam", () => {
    const onActiveChange = vi.fn();
    render(
      <CircularCarousel
        items={items(3)}
        labels={LABELS}
        autoPlay={false}
        activeIndex={1}
        onActiveChange={onActiveChange}
      />,
    );
    klawisz(region(), "ArrowRight");
    expect(onActiveChange).toHaveBeenCalledWith(2);
    expect(aktywna().getAttribute("aria-label")).toBe("Karta 2");
  });

  it("przycina indeks spoza zakresu w obie strony", () => {
    const { rerender } = render(
      <CircularCarousel items={items(3)} labels={LABELS} autoPlay={false} activeIndex={9} />,
    );
    expect(aktywna().getAttribute("aria-label")).toBe("Karta 3");
    rerender(
      <CircularCarousel items={items(3)} labels={LABELS} autoPlay={false} activeIndex={-4} />,
    );
    expect(aktywna().getAttribute("aria-label")).toBe("Karta 1");
  });
});

describe("CircularCarousel - auto-play", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __openMotionGateForTests();
  });

  it("przed otwarciem bramki ruchu stoi 30 s; pierwszy obrót pełny interwał po otwarciu", () => {
    __resetMotionGateForTests();
    render(<CircularCarousel items={items(3)} labels={LABELS} autoPlayInterval={2000} />);
    // Krokami po sekundzie: skok 30 s mógłby wrócić na pierwszą kartę po pełnych obrotach.
    for (let second = 0; second < 30; second += 1) {
      act(() => vi.advanceTimersByTime(1000));
      expect(aktywna().getAttribute("aria-label")).toBe("Karta 1");
    }
    act(() => __openMotionGateForTests());
    act(() => vi.advanceTimersByTime(1999));
    expect(aktywna().getAttribute("aria-label")).toBe("Karta 1");
    act(() => vi.advanceTimersByTime(1));
    expect(aktywna().getAttribute("aria-label")).toBe("Karta 2");
  });

  it("przesuwa kartę co interwał, nie częściej niż co sekundę", () => {
    render(<CircularCarousel items={items(3)} labels={LABELS} autoPlayInterval={10} />);
    act(() => vi.advanceTimersByTime(999));
    expect(aktywna().getAttribute("aria-label")).toBe("Karta 1");
    act(() => vi.advanceTimersByTime(1));
    expect(aktywna().getAttribute("aria-label")).toBe("Karta 2");
  });

  it("w czasie rotacji licznik nie jest regionem na żywo", () => {
    render(<CircularCarousel items={items(3)} labels={LABELS} />);
    expect((screen.getByText("01").parentElement as HTMLElement).getAttribute("aria-live")).toBe(
      "off",
    );
  });

  it("pauzuje pod kursorem i wznawia po zjechaniu", () => {
    render(<CircularCarousel items={items(3)} labels={LABELS} autoPlayInterval={1000} />);
    fireEvent.mouseEnter(region());
    act(() => vi.advanceTimersByTime(3000));
    expect(aktywna().getAttribute("aria-label")).toBe("Karta 1");
    fireEvent.mouseLeave(region());
    act(() => vi.advanceTimersByTime(1000));
    expect(aktywna().getAttribute("aria-label")).toBe("Karta 2");
  });

  it("ognisko w środku trzyma pauzę także po zjechaniu myszą i przy przejściu między elementami", () => {
    render(<CircularCarousel items={items(3)} labels={LABELS} autoPlayInterval={1000} />);
    const nastepna = screen.getByRole("button", { name: LABELS.next });
    fireEvent.mouseEnter(region());
    fireEvent.focus(aktywna());
    fireEvent.blur(aktywna(), { relatedTarget: nastepna });
    fireEvent.focus(nastepna);
    fireEvent.mouseLeave(region());
    act(() => vi.advanceTimersByTime(3000));
    expect(aktywna().getAttribute("aria-label")).toBe("Karta 1");
    fireEvent.blur(nastepna, { relatedTarget: document.body });
    act(() => vi.advanceTimersByTime(1000));
    expect(aktywna().getAttribute("aria-label")).toBe("Karta 2");
  });

  it("nie rotuje przy prefers-reduced-motion", () => {
    mockReducedMotion(true);
    render(<CircularCarousel items={items(3)} labels={LABELS} autoPlayInterval={1000} />);
    act(() => vi.advanceTimersByTime(5000));
    expect(aktywna().getAttribute("aria-label")).toBe("Karta 1");
  });

  it("nie rotuje jednej karty ani z wyłączonym auto-play", () => {
    const onActiveChange = vi.fn();
    const { rerender } = render(
      <CircularCarousel items={items(1)} labels={LABELS} onActiveChange={onActiveChange} />,
    );
    act(() => vi.advanceTimersByTime(10_000));
    rerender(
      <CircularCarousel
        items={items(3)}
        labels={LABELS}
        autoPlay={false}
        onActiveChange={onActiveChange}
      />,
    );
    act(() => vi.advanceTimersByTime(10_000));
    expect(onActiveChange).not.toHaveBeenCalled();
  });
});
