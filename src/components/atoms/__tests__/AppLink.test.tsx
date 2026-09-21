// AppLink - PROGI PRELOADU INTENCJI.
//
// `router.preloadRoute` nie jest podpowiedzią dla przeglądarki: to dopasowanie
// trasy, `beforeLoad`, `loader` i (za pierwszym razem) import chunku - praca na
// głównym wątku, w tej samej klatce, w której użytkownik przewija listę kart.
// Ten plik pilnuje czterech progów, których złamanie widać dopiero w polowym
// INP, a nigdy w lokalnym klikaniu:
//
//   1. INTENCJA MA MIEĆ CZAS. Kursor przelatujący nad dwudziestoma kartami nie
//      jest dwudziestoma intencjami - preload startuje dopiero po 60 ms
//      spoczynku, a wyjazd kursora / utrata fokusu odliczanie kasuje.
//   2. DOTYK NIE PRELOADUJE. Między `touchstart` a `click` mija kilkadziesiąt
//      ms TEGO SAMEGO gestu; loader wystartowany na `touchstart` ląduje
//      dokładnie w oknie mierzonym jako INP dotknięcia.
//   3. PAMIĘĆ MODUŁOWA. Powrót na ten sam odnośnik w ciągu 20 s nie powtarza
//      pracy routera; po TTL wolno ją powtórzyć.
//   4. KONTRAKT KONSUMENTA. `preload="none"`, własne `onMouseEnter`/`onFocus`/
//      `onTouchStart` i nawigacja klikiem działają jak przedtem - te progi mają
//      odraczać preload, a nie zmieniać zachowanie odnośnika.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act, fireEvent, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  preloadRoute: vi.fn(() => Promise.resolve()),
  navigate: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ preloadRoute: h.preloadRoute, navigate: h.navigate }),
}));

import { AppLink } from "../AppLink";

/** Próg z implementacji; test celowo przekracza go o 1 ms, nie o 500. */
const DELAY_MS = 60;
const TTL_MS = 20_000;

/**
 * Pamięć preloadu jest MODUŁOWA (taka jest jej treść: dotyczy routera, nie
 * instancji odnośnika), więc nie zeruje się między testami. Każdy test bierze
 * własny href - inaczej dowodziłby stanu zostawionego przez poprzedni.
 */
let nextHref = 0;
function freshHref(): string {
  nextHref += 1;
  return `/trasa-${nextHref}`;
}

function renderLink(props: Record<string, unknown> = {}, href = freshHref()) {
  const utils = render(
    <AppLink href={href} {...props}>
      odnośnik
    </AppLink>,
  );
  // Zapytanie ZAWĘŻONE do własnego kontenera: część testów montuje dwa
  // odnośniki naraz, a `getByText` z wyniku `render` widzi całe `document.body`.
  return { ...utils, href, anchor: within(utils.container).getByText("odnośnik") };
}

/** Upływ czasu z zegarem - `Date.now()` też musi ruszyć (TTL czyta zegar). */
function tick(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  h.preloadRoute.mockClear();
  h.navigate.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AppLink - opóźnienie intencji", () => {
  it("samo najechanie NIE preloaduje - dopiero 60 ms spoczynku", () => {
    const { anchor, href } = renderLink();

    fireEvent.mouseEnter(anchor);
    // Klatka, w której kursor dopiero wjechał na kartę, należy do przewijania.
    tick(DELAY_MS - 1);
    expect(h.preloadRoute).not.toHaveBeenCalled();

    tick(1);
    expect(h.preloadRoute).toHaveBeenCalledTimes(1);
    expect(h.preloadRoute).toHaveBeenCalledWith({ href });
  });

  it("wyjazd kursora PRZED progiem kasuje odliczanie", () => {
    const { anchor } = renderLink();

    fireEvent.mouseEnter(anchor);
    tick(DELAY_MS - 10);
    fireEvent.mouseLeave(anchor);
    tick(5 * DELAY_MS);

    // To jest cały sens progu: przejazd kursorem po liście kart ma kosztować
    // zero loaderów, a nie tyle, ile kart.
    expect(h.preloadRoute).not.toHaveBeenCalled();
  });

  it("FOKUS KLAWIATURY preloaduje tak samo jak kursor, a blur kasuje", () => {
    // Tabowanie po nawigacji to ta sama intencja co hover - i ta sama praca.
    const { anchor } = renderLink();
    fireEvent.focus(anchor);
    tick(DELAY_MS);
    expect(h.preloadRoute).toHaveBeenCalledTimes(1);

    const second = renderLink();
    fireEvent.focus(second.anchor);
    tick(DELAY_MS - 10);
    fireEvent.blur(second.anchor);
    tick(5 * DELAY_MS);
    expect(h.preloadRoute).toHaveBeenCalledTimes(1);
  });

  it("fokus i najechanie w tym samym oknie dają JEDEN preload, nie dwa", () => {
    // Mysz nad odnośnikiem ustawia fokus i wysyła mouseenter - dwa zdarzenia,
    // jedna intencja.
    const { anchor } = renderLink();

    fireEvent.focus(anchor);
    tick(10);
    fireEvent.mouseEnter(anchor);
    tick(DELAY_MS);

    expect(h.preloadRoute).toHaveBeenCalledTimes(1);
  });

  it("odmontowanie w trakcie odliczania nie budzi routera", () => {
    // Overlay wyszukiwarki znika razem ze swoimi odnośnikami; timer, który go
    // przeżyje, wykona pracę dla trasy, której nikt już nie ogląda.
    const { anchor, unmount } = renderLink();

    fireEvent.mouseEnter(anchor);
    tick(DELAY_MS - 10);
    unmount();
    tick(5 * DELAY_MS);

    expect(h.preloadRoute).not.toHaveBeenCalled();
  });
});

describe("AppLink - dotyk", () => {
  it("touchstart NIE preloaduje ani od razu, ani po progu", () => {
    const { anchor } = renderLink();

    fireEvent.touchStart(anchor);
    tick(5 * DELAY_MS);

    // Na dotyku właściwa nawigacja przychodzi kilkadziesiąt ms później i tak
    // czeka na ten sam loader - wcześniejszy start kupuje milisekundy kosztem
    // janku w oknie mierzonym jako INP dotknięcia.
    expect(h.preloadRoute).not.toHaveBeenCalled();
  });

  it("własny onTouchStart konsumenta nadal dostaje zdarzenie", () => {
    // Preload zniknął, ale `onTouchStart` nie jest już przez AppLink
    // przechwytywany - musi przechodzić przez `...props` nietknięty.
    const onTouchStart = vi.fn();
    const { anchor } = renderLink({ onTouchStart });

    fireEvent.touchStart(anchor);

    expect(onTouchStart).toHaveBeenCalledTimes(1);
  });
});

describe("AppLink - pamięć preloadowanych tras", () => {
  it("powrót na TEN SAM odnośnik w oknie TTL nie powtarza pracy routera", () => {
    const { anchor } = renderLink();

    fireEvent.mouseEnter(anchor);
    tick(DELAY_MS);
    expect(h.preloadRoute).toHaveBeenCalledTimes(1);

    fireEvent.mouseLeave(anchor);
    fireEvent.mouseEnter(anchor);
    tick(DELAY_MS);

    expect(h.preloadRoute).toHaveBeenCalledTimes(1);
  });

  it("pamięć jest WSPÓLNA dla instancji - ta sama trasa z dwóch kart raz", () => {
    // Ten sam wpis bywa w „polecanych" i w „ostatnich" na jednej stronie.
    const href = freshHref();
    const first = renderLink({}, href);
    const second = renderLink({}, href);

    fireEvent.mouseEnter(first.anchor);
    tick(DELAY_MS);
    fireEvent.mouseEnter(second.anchor);
    tick(DELAY_MS);

    expect(h.preloadRoute).toHaveBeenCalledTimes(1);
  });

  it("po upływie TTL preload wolno powtórzyć", () => {
    // Pamięć ma chronić przed serią najechań, a nie zamrażać trasę na stałe:
    // po 20 s dane trasy mogły się zmienić, a chunk i tak jest w cache HTTP.
    const { anchor } = renderLink();

    fireEvent.mouseEnter(anchor);
    tick(DELAY_MS);
    expect(h.preloadRoute).toHaveBeenCalledTimes(1);

    tick(TTL_MS + 1);
    fireEvent.mouseEnter(anchor);
    tick(DELAY_MS);

    expect(h.preloadRoute).toHaveBeenCalledTimes(2);
  });
});

describe("AppLink - kontrakt konsumenta bez zmian", () => {
  it('preload="none" nie preloaduje NIGDY', () => {
    const { anchor } = renderLink({ preload: "none" });

    fireEvent.mouseEnter(anchor);
    fireEvent.focus(anchor);
    tick(5 * DELAY_MS);

    expect(h.preloadRoute).not.toHaveBeenCalled();
  });

  it("własne onMouseEnter/onMouseLeave/onFocus/onBlur wołane są nadal", () => {
    const spies = {
      onMouseEnter: vi.fn(),
      onMouseLeave: vi.fn(),
      onFocus: vi.fn(),
      onBlur: vi.fn(),
    };
    const { anchor } = renderLink(spies);

    fireEvent.mouseEnter(anchor);
    fireEvent.mouseLeave(anchor);
    fireEvent.focus(anchor);
    fireEvent.blur(anchor);

    for (const spy of Object.values(spies)) expect(spy).toHaveBeenCalledTimes(1);
  });

  it("odnośnik zewnętrzny nie preloaduje i nie jest przejmowany", () => {
    const { anchor } = renderLink({}, "https://example.org/artykul");

    fireEvent.mouseEnter(anchor);
    tick(5 * DELAY_MS);
    fireEvent.click(anchor, { button: 0 });

    expect(h.preloadRoute).not.toHaveBeenCalled();
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("klik nadal nawiguje routerem, bez przeładowania dokumentu", () => {
    const { anchor, href } = renderLink();

    fireEvent.click(anchor, { button: 0 });

    expect(h.navigate).toHaveBeenCalledWith({ href });
  });
});
