// NAKŁADKA PRZEWODNIKA: reflektor, dymek, wyjścia i dostępność.
//
// CO TEN PLIK DOWODZI. `CoachmarkTour` zasłania CAŁY panel admina (portal do
// `document.body`, `position: fixed`, `z-index: 100`, przezroczyste tło łapiące
// kliknięcia). To znaczy, że każdy jej błąd nie psuje „przewodnika" - psuje
// dostęp do buildera i edytora wpisów. Do tej pory 4% pokrycia. Cztery rzeczy,
// których nie widział żaden test:
//
//   1. BRAKUJĄCA KOTWICA. Krok celuje w `[data-tour="…"]`, którego na stronie
//      NIE MA - bo admin ma węższą rolę, bo sekcja jest zwinięta, bo ktoś
//      przemianował atrybut. Nakładka NIE MOŻE wtedy: (a) zawisnąć bez dymka,
//      (b) wyrzucić dymka w lewy górny róg bez kontekstu, (c) zablokować
//      interfejsu ciemną szybą bez wyjścia. Ten plik sprawdza wszystkie trzy.
//   2. POZYCJONOWANIE. Dymek ma 300 px i musi zostać w oknie: przy krawędzi
//      przeskakuje na przeciwną stronę kotwicy, a w małym oknie jest przycinany
//      do marginesu. Bez tego treść kroku wychodzi za ekran i redaktor nie ma
//      jak dojść do przycisku „Dalej".
//   3. WYJŚCIA I NAWIGACJA. Escape, krzyżyk, „Pomiń", kliknięcie w tło,
//      strzałki, „Wstecz"/„Dalej"/„Gotowe". Każde z nich to osobna droga
//      wyjścia; brak choćby jednej zamyka redaktora w nakładce.
//   4. DOSTĘPNOŚĆ. `role="dialog"`, `aria-modal`, nazwa okna z klucza, fokus
//      wchodzący do karty, brak naruszeń axe.
//
// Osobno pilnujemy reguły, którą kod opisuje w komentarzu i którą łatwo zepsuć
// refaktorem: przewinięcie do kotwicy dzieje się DOKŁADNIE RAZ na krok, a
// nasłuch przewijania tylko dolicza pozycję. Nasłuch, który sam przewija, walczy
// z użytkownikiem (efekt „snap-back”).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - REGUŁ STARTU, PAMIĘCI I NAWIGACJI STEROWNIKA (kto włącza wycieczkę, co
//   zapisuje zamknięcie, klamra indeksu):
//   `src/lib/onboarding/__tests__/useOnboardingTour.test.tsx`. Tutaj sterownik
//   jest ATRAPĄ - sprawdzamy, że nakładka woła właściwą metodę, nie co ta metoda
//   robi. Dwa testy na końcu spinają oba moduły bez atrapy.
// - TRWAŁOŚCI ZAMKNIĘCIA W MAGAZYNIE:
//   `src/lib/onboarding/__tests__/tourStorageResilience.test.ts`.
// - TREŚCI KROKÓW I PARYTETU PL/EN: `src/lib/onboarding/__tests__/tours.test.ts`.
//   Asercje tutaj idą na KLUCZACH i18n (atrapa `reactI18nextStub`), nie na napisach.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

import { CoachmarkTour } from "@/components/admin/onboarding/CoachmarkTour";
import { BUILDER_TOUR_STEPS } from "@/lib/onboarding/tours";
import { useOnboardingTour } from "@/lib/onboarding/useOnboardingTour";
import { isTourDismissed } from "@/lib/onboarding/tourStorage";
import type { TourController, TourStep } from "@/lib/onboarding/types";
import { axeViolations, summarize } from "@/test/axe";

/** Stałe geometryczne skopiowane z komponentu - test liczy pozycje SAM. */
const CARD_W = 300;
const GAP = 12;
const MARGIN = 12;
const PAD = 6;
/** Wysokość karty podstawiona pod `offsetHeight` (happy-dom nie ma układu). */
const CARD_H = 200;
const VW = 1024;
const VH = 768;

const KOTWICA = "builder-widgets";

interface Prostokat {
  top: number;
  left: number;
  width: number;
  height: number;
}

function krok(patch: Partial<TourStep> = {}): TourStep {
  return {
    id: "widgets",
    anchor: KOTWICA,
    titleKey: "admin.onboarding.builder.widgets.title",
    bodyKey: "admin.onboarding.builder.widgets.body",
    ...patch,
  };
}

/** Sterownik-atrapa: nakładka ma tylko wołać właściwą metodę. */
function sterownik(patch: Partial<TourController> = {}): TourController {
  return {
    active: true,
    stepIndex: 0,
    currentStep: krok(),
    totalSteps: 3,
    start: vi.fn(),
    next: vi.fn(),
    prev: vi.fn(),
    skip: vi.fn(),
    finish: vi.fn(),
    ...patch,
  };
}

/** Element z kotwicą i USTALONYM prostokątem - happy-dom nie mierzy układu. */
function osadzKotwice(rect: Prostokat, name = KOTWICA): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-tour", name);
  el.getBoundingClientRect = () => new DOMRect(rect.left, rect.top, rect.width, rect.height);
  document.body.appendChild(el);
  return el;
}

/** Trzy warstwy nakładki: tło, reflektor (może nie być) i karta dymka. */
function nakladka(): { tlo: HTMLElement; reflektor: HTMLElement | null; karta: HTMLElement } {
  const dialog = screen.getByRole("dialog");
  const dzieci = [...dialog.children].filter((n): n is HTMLElement => n instanceof HTMLElement);
  const karta = dzieci.find((el) => el.getAttribute("tabindex") === "-1");
  if (!karta || dzieci.length < 2) throw new Error("nakładka bez karty dymka");
  return { tlo: dzieci[0], reflektor: dzieci.length === 3 ? dzieci[1] : null, karta };
}

const OPIS_OFFSET_HEIGHT = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
const OPIS_INNER_WIDTH = Object.getOwnPropertyDescriptor(window, "innerWidth");
const OPIS_INNER_HEIGHT = Object.getOwnPropertyDescriptor(window, "innerHeight");

function ustawOkno(width: number, height: number): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => CARD_H,
  });
});

afterAll(() => {
  if (OPIS_OFFSET_HEIGHT) {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", OPIS_OFFSET_HEIGHT);
  }
});

/**
 * Podmiana `scrollIntoView` w jednym miejscu - typ bierzemy z WYWOŁANIA,
 * bo jawne generyki `vi.spyOn` nie przyjmują metod dziedziczonych z `Element`.
 */
function podmienPrzewijanie() {
  return vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
}

let przewiniecia: ReturnType<typeof podmienPrzewijanie>;

beforeEach(() => {
  window.localStorage.clear();
  // happy-dom nie przewija, ale komponent woła `scrollIntoView` - podmieniamy,
  // żeby POLICZYĆ wywołania (reguła „raz na krok”).
  przewiniecia = podmienPrzewijanie();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (OPIS_INNER_WIDTH) Object.defineProperty(window, "innerWidth", OPIS_INNER_WIDTH);
  if (OPIS_INNER_HEIGHT) Object.defineProperty(window, "innerHeight", OPIS_INNER_HEIGHT);
  window.localStorage.clear();
});

describe("kiedy nakładki NIE MA", () => {
  it("wycieczka nieaktywna nie rysuje niczego", () => {
    render(<CoachmarkTour controller={sterownik({ active: false })} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("aktywna wycieczka BEZ kroku nie rysuje niczego", () => {
    // Ten stan powstaje, gdy lista kroków skróci się pod nogami sterownika.
    render(<CoachmarkTour controller={sterownik({ currentStep: null })} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("nakładka idzie portalem do `document.body`, nie do drzewa wywołania", () => {
    // Dlatego builder może ją renderować z dowolnego zagnieżdżenia, a `overflow`
    // paneli jej nie ucina.
    osadzKotwice({ top: 100, left: 400, width: 200, height: 50 });
    const { container } = render(<CoachmarkTour controller={sterownik()} />);
    expect(container.innerHTML).toBe("");
    expect(document.body.contains(screen.getByRole("dialog"))).toBe(true);
  });
});

describe("reflektor nad istniejącą kotwicą", () => {
  it("KANAREK: testowe okno ma 1024x768 - na tym stoją wszystkie pozycje niżej", () => {
    expect({ vw: window.innerWidth, vh: window.innerHeight }).toEqual({ vw: VW, vh: VH });
  });

  it("wycina prostokąt kotwicy z zapasem 6 px i dopiero on przyciemnia stronę", () => {
    // Tło zostaje PRZEZROCZYSTE - przyciemnienie rysuje wielki cień reflektora,
    // inaczej wycięcie byłoby rozmyte podwójną warstwą.
    osadzKotwice({ top: 100, left: 400, width: 200, height: 50 });
    render(<CoachmarkTour controller={sterownik()} />);
    const { tlo, reflektor } = nakladka();
    expect(reflektor).not.toBeNull();
    expect(reflektor?.style.top).toBe(`${100 - PAD}px`);
    expect(reflektor?.style.left).toBe(`${400 - PAD}px`);
    expect(reflektor?.style.width).toBe(`${200 + PAD * 2}px`);
    expect(reflektor?.style.height).toBe(`${50 + PAD * 2}px`);
    expect(reflektor?.style.boxShadow).toBe("0 0 0 9999px rgba(0,0,0,0.55)");
    expect(reflektor?.style.pointerEvents).toBe("none");
    expect(tlo.style.background).toBe("transparent");
  });

  it.each([
    [
      "brak wskazania - domyślnie pod kotwicą",
      undefined,
      { top: 100, left: 400, width: 200, height: 50 },
      { top: 100 + 50 + GAP, left: 400 + 100 - CARD_W / 2 },
    ],
    [
      "pod kotwicą",
      "bottom" as const,
      { top: 100, left: 400, width: 200, height: 50 },
      { top: 162, left: 350 },
    ],
    [
      "pod kotwicą, ale nie ma miejsca - przeskok NAD kotwicę",
      "bottom" as const,
      { top: 700, left: 400, width: 200, height: 50 },
      { top: 700 - CARD_H - GAP, left: 350 },
    ],
    [
      "nad kotwicą",
      "top" as const,
      { top: 400, left: 400, width: 200, height: 50 },
      { top: 400 - CARD_H - GAP, left: 350 },
    ],
    [
      "nad kotwicą, ale nie ma miejsca - przeskok POD kotwicę",
      "top" as const,
      { top: 50, left: 400, width: 200, height: 50 },
      { top: 50 + 50 + GAP, left: 350 },
    ],
    [
      "po lewej",
      "left" as const,
      { top: 300, left: 400, width: 200, height: 50 },
      { top: 300 + 25 - CARD_H / 2, left: 400 - CARD_W - GAP },
    ],
    [
      "po lewej, ale nie ma miejsca - przeskok NA PRAWO",
      "left" as const,
      { top: 300, left: 100, width: 200, height: 50 },
      { top: 225, left: 100 + 200 + GAP },
    ],
    [
      "po prawej",
      "right" as const,
      { top: 300, left: 100, width: 200, height: 50 },
      { top: 225, left: 312 },
    ],
    [
      "po prawej, ale nie ma miejsca - przeskok NA LEWO",
      "right" as const,
      { top: 300, left: 800, width: 200, height: 50 },
      { top: 225, left: 800 - CARD_W - GAP },
    ],
    [
      "kotwica u prawej krawędzi - dymek przycięty do marginesu",
      "bottom" as const,
      { top: 100, left: 950, width: 50, height: 20 },
      { top: 132, left: VW - CARD_W - MARGIN },
    ],
    [
      "kotwica u lewej krawędzi - dymek przycięty do marginesu",
      "bottom" as const,
      { top: 100, left: 0, width: 20, height: 20 },
      { top: 132, left: MARGIN },
    ],
    [
      "kotwica u dolnej krawędzi - dymek przycięty do marginesu",
      "left" as const,
      { top: 740, left: 400, width: 100, height: 20 },
      { top: VH - CARD_H - MARGIN, left: 400 - CARD_W - GAP },
    ],
    [
      "kotwica u górnej krawędzi - dymek przycięty do marginesu",
      "left" as const,
      { top: 0, left: 400, width: 100, height: 20 },
      { top: MARGIN, left: 88 },
    ],
  ])("dymek %s", (_opis, placement, rect, oczekiwane) => {
    osadzKotwice(rect);
    render(<CoachmarkTour controller={sterownik({ currentStep: krok({ placement }) })} />);
    const { karta } = nakladka();
    expect(karta.style.top).toBe(`${oczekiwane.top}px`);
    expect(karta.style.left).toBe(`${oczekiwane.left}px`);
    expect(karta.style.width).toBe(`${CARD_W}px`);
  });

  it("w oknie MNIEJSZYM niż dymek karta nadal zostaje na ekranie", () => {
    // Telefon w poziomie / wąskie okno panelu: karta (300x200) nie mieści się
    // ani w szerokość, ani w wysokość. `Math.max(MARGIN, …)` ma wtedy wygrać
    // z centrowaniem, inaczej karta wychodzi w ujemne `left`/`top`, czyli za
    // ekran - razem z przyciskiem „Dalej".
    ustawOkno(320, 150);
    render(<CoachmarkTour controller={sterownik({ currentStep: krok({ anchor: undefined }) })} />);
    const { karta } = nakladka();
    expect(karta.style.left).toBe(`${MARGIN}px`);
    expect(karta.style.top).toBe(`${MARGIN}px`);
  });
});

describe("BRAKUJĄCA KOTWICA (inna rola admina, zwinięta sekcja, zmiana atrybutu)", () => {
  it("nie zawiesza się: jest dymek z treścią kroku, jest licznik, jest wyjście", () => {
    // Punkt (a) z nagłówka. Kotwicy nie osadzamy w ogóle.
    render(<CoachmarkTour controller={sterownik()} />);
    const { reflektor, karta } = nakladka();
    expect(reflektor).toBeNull();
    expect(karta.textContent).toContain("admin.onboarding.builder.widgets.title");
    expect(karta.textContent).toContain("admin.onboarding.builder.widgets.body");
    expect(screen.getByText("admin.onboarding.common.stepOf(current=1,total=3)")).toBeTruthy();
    expect(screen.getByText("admin.onboarding.common.skip")).toBeTruthy();
  });

  it("NIE wyrzuca dymka w lewy górny róg - karta jest wyśrodkowana", () => {
    // Punkt (b) z nagłówka: to jest różnica między „dymkiem bez kontekstu"
    // i „kartą powitalną na środku ekranu".
    render(<CoachmarkTour controller={sterownik()} />);
    const { karta } = nakladka();
    expect(karta.style.top).toBe(`${VH / 2 - CARD_H / 2}px`);
    expect(karta.style.left).toBe(`${VW / 2 - CARD_W / 2}px`);
    expect(karta.style.top).not.toBe("0px");
    expect(karta.style.left).not.toBe("0px");
  });

  it("przyciemnia stronę SAMYM tłem, bo nie ma czego wycinać", () => {
    render(<CoachmarkTour controller={sterownik()} />);
    const { tlo, reflektor } = nakladka();
    expect(reflektor).toBeNull();
    // happy-dom normalizuje odstępy w `rgba()` - stąd inny zapis niż w źródle.
    expect(tlo.style.background).toBe("rgba(0, 0, 0, 0.55)");
  });

  it.each([
    ["Escape", (): void => void fireEvent.keyDown(window, { key: "Escape" })],
    [
      "krzyżyk",
      (): void => void fireEvent.click(screen.getByLabelText("admin.onboarding.common.close")),
    ],
    [
      "przycisk Pomiń",
      (): void => void fireEvent.click(screen.getByText("admin.onboarding.common.skip")),
    ],
    ["kliknięcie w tło", (): void => void fireEvent.click(nakladka().tlo)],
  ])("punkt (c): wyjście przez %s działa także bez kotwicy", (_opis, wyjdz) => {
    const skip = vi.fn();
    render(<CoachmarkTour controller={sterownik({ skip })} />);
    wyjdz();
    expect(skip).toHaveBeenCalledTimes(1);
  });

  it("kotwica ZNIKAJĄCA w trakcie kroku degraduje się do karty na środku", () => {
    // Realny scenariusz: redaktor zwija panel widgetów, gdy dymek już stoi.
    // Pozycja jest przeliczana na przewinięciu i zmianie rozmiaru okna.
    const el = osadzKotwice({ top: 100, left: 400, width: 200, height: 50 });
    render(<CoachmarkTour controller={sterownik()} />);
    expect(nakladka().reflektor).not.toBeNull();

    el.remove();
    fireEvent.scroll(window);
    expect(nakladka().reflektor).toBeNull();
    expect(nakladka().karta.style.left).toBe(`${VW / 2 - CARD_W / 2}px`);
  });
});

describe("nawigacja i wyjścia", () => {
  it("na kroku innym niż ostatni przycisk główny to „dalej”", () => {
    const next = vi.fn();
    const finish = vi.fn();
    render(<CoachmarkTour controller={sterownik({ next, finish })} />);
    fireEvent.click(screen.getByText("admin.onboarding.common.next"));
    expect(next).toHaveBeenCalledTimes(1);
    expect(finish).not.toHaveBeenCalled();
    expect(screen.queryByText("admin.onboarding.common.done")).toBeNull();
  });

  it("na OSTATNIM kroku przycisk główny kończy wycieczkę", () => {
    const next = vi.fn();
    const finish = vi.fn();
    render(<CoachmarkTour controller={sterownik({ stepIndex: 2, totalSteps: 3, next, finish })} />);
    fireEvent.click(screen.getByText("admin.onboarding.common.done"));
    expect(finish).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
  });

  it("„Wstecz” pojawia się dopiero od drugiego kroku", () => {
    // Na pierwszym kroku przycisk cofania nie ma gdzie prowadzić - martwy
    // przycisk jest gorszy od jego braku.
    const prev = vi.fn();
    render(<CoachmarkTour controller={sterownik({ prev })} />);
    expect(screen.queryByText("admin.onboarding.common.back")).toBeNull();
    cleanup();

    render(<CoachmarkTour controller={sterownik({ stepIndex: 1, prev })} />);
    fireEvent.click(screen.getByText("admin.onboarding.common.back"));
    expect(prev).toHaveBeenCalledTimes(1);
  });

  it("licznik kroków liczy od JEDNEGO i podaje sumę", () => {
    render(<CoachmarkTour controller={sterownik({ stepIndex: 1, totalSteps: 4 })} />);
    expect(screen.getByText("admin.onboarding.common.stepOf(current=2,total=4)")).toBeTruthy();
  });

  it("strzałki przewijają kroki, Escape zamyka i BLOKUJE zdarzenie", () => {
    const next = vi.fn();
    const prev = vi.fn();
    const skip = vi.fn();
    render(<CoachmarkTour controller={sterownik({ next, prev, skip })} />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(next).toHaveBeenCalledTimes(1);
    expect(prev).toHaveBeenCalledTimes(1);
    // `preventDefault` na Escape jest po to, żeby klawisz nie zamknął
    // JEDNOCZEŚNIE przewodnika i dialogu panelu pod nim.
    expect(fireEvent.keyDown(window, { key: "Escape" })).toBe(false);
    expect(skip).toHaveBeenCalledTimes(1);
  });

  it("inne klawisze nie robią NIC", () => {
    const next = vi.fn();
    const prev = vi.fn();
    const skip = vi.fn();
    render(<CoachmarkTour controller={sterownik({ next, prev, skip })} />);
    for (const key of ["Enter", " ", "a", "Tab", "ArrowUp", "ArrowDown"]) {
      fireEvent.keyDown(window, { key });
    }
    expect(next).not.toHaveBeenCalled();
    expect(prev).not.toHaveBeenCalled();
    expect(skip).not.toHaveBeenCalled();
  });

  it("kliknięcie WEWNĄTRZ karty nie zamyka przewodnika", () => {
    // Bez `stopPropagation` zaznaczenie tekstu w dymku kończyłoby wycieczkę.
    const skip = vi.fn();
    render(<CoachmarkTour controller={sterownik({ skip })} />);
    fireEvent.click(screen.getByText("admin.onboarding.builder.widgets.body"));
    fireEvent.click(nakladka().karta);
    expect(skip).not.toHaveBeenCalled();
  });

  it("po odmontowaniu nasłuch klawiatury NIE reaguje", () => {
    const skip = vi.fn();
    const { unmount } = render(<CoachmarkTour controller={sterownik({ skip })} />);
    unmount();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(skip).not.toHaveBeenCalled();
  });
});

describe("pomiar kotwicy: przewijanie i zmiana rozmiaru", () => {
  it("przewinięcie do kotwicy dzieje się DOKŁADNIE RAZ na krok", () => {
    // Reguła opisana w komentarzu komponentu: nasłuch, który sam przewija,
    // walczy z przewijaniem użytkownika (snap-back) i re-wywołuje się w trakcie
    // animacji. Dlatego zdarzenia przewijania mają tylko DOLICZAĆ pozycję.
    osadzKotwice({ top: 100, left: 400, width: 200, height: 50 });
    render(<CoachmarkTour controller={sterownik()} />);
    expect(przewiniecia).toHaveBeenCalledTimes(1);
    expect(przewiniecia).toHaveBeenCalledWith({ block: "nearest", behavior: "smooth" });

    fireEvent.scroll(window);
    fireEvent(window, new Event("resize"));
    expect(przewiniecia).toHaveBeenCalledTimes(1);
  });

  it("krok BEZ kotwicy nie przewija strony", () => {
    render(<CoachmarkTour controller={sterownik({ currentStep: krok({ anchor: undefined }) })} />);
    expect(przewiniecia).not.toHaveBeenCalled();
  });

  it("zmiana rozmiaru okna przelicza reflektor pod nową pozycję kotwicy", () => {
    let rect: Prostokat = { top: 100, left: 400, width: 200, height: 50 };
    const el = document.createElement("div");
    el.setAttribute("data-tour", KOTWICA);
    el.getBoundingClientRect = () => new DOMRect(rect.left, rect.top, rect.width, rect.height);
    document.body.appendChild(el);

    render(<CoachmarkTour controller={sterownik()} />);
    expect(nakladka().reflektor?.style.top).toBe(`${100 - PAD}px`);

    rect = { top: 300, left: 500, width: 100, height: 40 };
    fireEvent(window, new Event("resize"));
    expect(nakladka().reflektor?.style.top).toBe(`${300 - PAD}px`);
    expect(nakladka().reflektor?.style.left).toBe(`${500 - PAD}px`);
  });

  it("przewinięcie strony przelicza reflektor (kotwica jedzie w górę)", () => {
    let rect: Prostokat = { top: 500, left: 400, width: 200, height: 50 };
    const el = document.createElement("div");
    el.setAttribute("data-tour", KOTWICA);
    el.getBoundingClientRect = () => new DOMRect(rect.left, rect.top, rect.width, rect.height);
    document.body.appendChild(el);

    render(<CoachmarkTour controller={sterownik()} />);
    rect = { top: 120, left: 400, width: 200, height: 50 };
    fireEvent.scroll(window);
    expect(nakladka().reflektor?.style.top).toBe(`${120 - PAD}px`);
  });

  it("odmontowanie odpina nasłuch zmiany rozmiaru i przewijania", () => {
    const odpiete: string[] = [];
    const odpnij = vi
      .spyOn(window, "removeEventListener")
      .mockImplementation((typ: string) => void odpiete.push(typ));
    osadzKotwice({ top: 100, left: 400, width: 200, height: 50 });
    const { unmount } = render(<CoachmarkTour controller={sterownik()} />);
    unmount();
    expect(odpiete).toContain("resize");
    expect(odpiete).toContain("scroll");
    expect(odpiete).toContain("keydown");
    odpnij.mockRestore();
  });
});

describe("preferencja braku ruchu", () => {
  it("bez preferencji dymek ma animację, a przewinięcie jest gładkie", () => {
    osadzKotwice({ top: 100, left: 400, width: 200, height: 50 });
    render(<CoachmarkTour controller={sterownik()} />);
    expect(nakladka().karta.style.transition).toBe("all 180ms ease");
    expect(przewiniecia).toHaveBeenLastCalledWith({ block: "nearest", behavior: "smooth" });
  });

  it("z preferencją braku ruchu animacja znika, a przewinięcie jest natychmiastowe", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    osadzKotwice({ top: 100, left: 400, width: 200, height: 50 });
    render(<CoachmarkTour controller={sterownik()} />);
    const { karta, reflektor } = nakladka();
    expect(karta.style.transition).toBe("none");
    expect(reflektor?.style.transition).toBe("none");
    expect(przewiniecia).toHaveBeenLastCalledWith({ block: "nearest", behavior: "auto" });
  });
});

describe("dostępność nakładki", () => {
  it("jest okienkiem modalnym o nazwie wziętej z KLUCZA tytułu kroku", () => {
    render(<CoachmarkTour controller={sterownik()} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("admin.onboarding.builder.widgets.title");
  });

  it("tło jest ukryte przed czytnikiem ekranu - to dekoracja, nie treść", () => {
    render(<CoachmarkTour controller={sterownik()} />);
    expect(nakladka().tlo.getAttribute("aria-hidden")).toBe("true");
  });

  it("fokus wchodzi do karty, więc czytnik czyta treść kroku od razu", () => {
    render(<CoachmarkTour controller={sterownik()} />);
    expect(document.activeElement).toBe(nakladka().karta);
  });

  it("krzyżyk ma nazwę z klucza (sama ikona nie ma tekstu)", () => {
    render(<CoachmarkTour controller={sterownik()} />);
    expect(screen.getByLabelText("admin.onboarding.common.close").tagName).toBe("BUTTON");
  });

  it("nie ma naruszeń dostępności - z kotwicą i bez niej", async () => {
    osadzKotwice({ top: 100, left: 400, width: 200, height: 50 });
    render(<CoachmarkTour controller={sterownik({ stepIndex: 1 })} />);
    expect(await axeViolations(screen.getByRole("dialog")).then(summarize)).toBe("");
    cleanup();

    render(<CoachmarkTour controller={sterownik({ currentStep: krok({ anchor: undefined }) })} />);
    expect(await axeViolations(screen.getByRole("dialog")).then(summarize)).toBe("");
  });

  it.fails("DEFEKT: po zamknięciu przewodnika fokus NIE wraca tam, gdzie był", () => {
    // CO: `CoachmarkTour` przenosi fokus do karty (`cardRef.current?.focus()`,
    //     `CoachmarkTour.tsx:119`), ale nigdzie nie zapamiętuje, co było
    //     aktywne wcześniej, i nie przywraca tego po zgaszeniu nakładki.
    // GDZIE: src/components/admin/onboarding/CoachmarkTour.tsx:117-132.
    // KONSEKWENCJA: redaktor pracujący z klawiatury naciska Escape i fokus
    //     spada na `document.body`. Żeby wrócić do miejsca, w którym był
    //     (np. przycisk „Dodaj sekcję”), musi przetabować cały panel admina od
    //     początku. Dla osoby korzystającej z czytnika ekranu to utrata
    //     kontekstu, a nie niedogodność - WCAG 2.4.3.
    const wyzwalacz = document.createElement("button");
    wyzwalacz.textContent = "kotwica fokusu";
    document.body.appendChild(wyzwalacz);
    wyzwalacz.focus();
    expect(document.activeElement).toBe(wyzwalacz);

    const { unmount } = render(<CoachmarkTour controller={sterownik()} />);
    unmount();
    expect(document.activeElement).toBe(wyzwalacz);
  });

  it.fails("DEFEKT: nakładka ogłasza się modalną, ale nie zatrzymuje fokusu w środku", () => {
    // CO: dialog ma `aria-modal="true"`, więc obiecuje czytnikowi ekranu, że
    //     poza nim nie ma nic do obsługi. Nakładka nie pilnuje jednak fokusu:
    //     nie ma ani pułapki na Tab, ani nasłuchu `focusin`, który wciągnąłby
    //     fokus z powrotem.
    // GDZIE: src/components/admin/onboarding/CoachmarkTour.tsx:117-132 (efekt
    //     ustawia fokus RAZ i pilnuje wyłącznie klawiszy Escape/strzałek).
    // KONSEKWENCJA: Tab wyprowadza fokus na przyciski panelu pod ciemną szybą.
    //     Widok mówi „interfejs zablokowany", a klawiatura pozwala go klikać -
    //     redaktor uruchamia akcje, których nie widzi. Na dodatek strzałki są
    //     nasłuchiwane na `window`, więc przewijanie kursorem w polu tekstowym
    //     na tle JEDNOCZEŚNIE przeskakuje kroki przewodnika.
    // UWAGA METODOLOGICZNA: happy-dom nie realizuje domyślnej akcji Tab, więc
    //     wyjście fokusu za nakładkę wykonujemy przez `focus()` na elemencie
    //     tła - dokładnie to, co w przeglądarce robi Tab. Poprawna nakładka
    //     odzyskałaby fokus (nasłuch `focusin`).
    const przyciskTla = document.createElement("button");
    przyciskTla.textContent = "przycisk pod szybą";
    document.body.appendChild(przyciskTla);
    render(<CoachmarkTour controller={sterownik()} />);
    const { karta } = nakladka();
    expect(document.activeElement).toBe(karta);

    act(() => przyciskTla.focus());
    expect(document.activeElement).toBe(karta);
  });

  it("STAN FAKTYCZNY: strzałki działają GLOBALNIE, także przy fokusie na tle", () => {
    // Świadomy opis rzeczywistości, spięty z defektem powyżej: nasłuch siedzi
    // na `window` i nie patrzy na `event.target`. Dla nakładki, która blokuje
    // wskaźnik, to zachowanie POŻĄDANE (strzałki mają działać, gdy fokus siedzi
    // na karcie). Zapisane, żeby ewentualne dodanie pułapki fokusu nie zabrało
    // przy okazji obsługi strzałek.
    const next = vi.fn();
    const pole = document.createElement("input");
    document.body.appendChild(pole);
    render(<CoachmarkTour controller={sterownik({ next })} />);
    act(() => pole.focus());
    fireEvent.keyDown(pole, { key: "ArrowRight" });
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("spięcie ze sterownikiem (bez atrapy)", () => {
  /** Minimalny gospodarz: prawdziwy hak + prawdziwa nakładka, jak w builderze. */
  function Gospodarz({ steps }: { steps: TourStep[] }) {
    const tour = useOnboardingTour({ id: "builder", steps });
    return (
      <div>
        <div data-tour="builder-widgets" />
        <div data-tour="builder-toolbar" />
        <CoachmarkTour controller={tour} />
      </div>
    );
  }

  it("przejście przez wszystkie kroki kończy wycieczkę i zapamiętuje to na trwałe", async () => {
    const kroki = BUILDER_TOUR_STEPS.slice(0, 2);
    const { unmount } = render(<Gospodarz steps={kroki} />);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    expect(screen.getByText("admin.onboarding.common.stepOf(current=1,total=2)")).toBeTruthy();

    fireEvent.click(screen.getByText("admin.onboarding.common.next"));
    expect(screen.getByText("admin.onboarding.common.stepOf(current=2,total=2)")).toBeTruthy();
    fireEvent.click(screen.getByText("admin.onboarding.common.done"));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(isTourDismissed("builder")).toBe(true);
    unmount();

    // Drugie wejście do buildera: przewodnik już się nie pokazuje.
    render(<Gospodarz steps={kroki} />);
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Escape na pierwszym kroku też zamyka wycieczkę na dobre", async () => {
    render(<Gospodarz steps={BUILDER_TOUR_STEPS.slice(0, 2)} />);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(isTourDismissed("builder")).toBe(true);
  });
});
