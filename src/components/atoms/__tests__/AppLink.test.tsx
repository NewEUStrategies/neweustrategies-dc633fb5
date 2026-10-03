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
//
// To, CO preload ładuje (trasę celu, a nie bieżącą), sprawdza na prawdziwym
// routerze `AppLink.preloadTarget.test.tsx` - atrapa niżej widzi tylko argument.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act, fireEvent, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  warmWidgets: vi.fn(),
  preloadRoute: vi.fn(() => Promise.resolve()),
  navigate: vi.fn(() => Promise.resolve()),
}));

// Atrapa ma tyle routera, ile czyta przekład `href` -> opcje preloadu: parser
// query. Bez `origin` i `rewrite` (jak router bez przepisywania adresów) -
// baza adresu to wtedy origin okna.
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({
    preloadRoute: h.preloadRoute,
    navigate: h.navigate,
    options: {
      parseSearch: (search: string) => Object.fromEntries(new URLSearchParams(search)),
    },
  }),
}));

vi.mock("@/components/builder/organisms/widget-view/warmWidgetChunks", () => ({
  warmCommonWidgetChunks: h.warmWidgets,
}));

import { AppLink, toClientHref } from "../AppLink";

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

/**
 * Klik, po którym happy-dom NIE wykonuje akcji domyślnej odnośnika. Klik bez
 * `preventDefault` happy-dom kończy prawdziwym `window.open(href)`, czyli
 * żądaniem sieciowym (`GET https://example.org/...`) i przeniesieniem okna na
 * cudzy origin - test zależałby od sieci i psuł adres kolejnym testom.
 * Strażnik na `window` biegnie PO handlerze Reacta (korzeń kontenera), więc
 * najpierw odczytuje decyzję `AppLink`, a dopiero potem tłumi nawigację.
 *
 * Zwraca `true`, gdy klik zostałby przeglądarce (nikt go nie przejął).
 */
function clickStaysWithBrowser(anchor: HTMLElement, init: MouseEventInit): boolean {
  let leftToBrowser: boolean | null = null;
  const guard = (event: Event) => {
    leftToBrowser = !event.defaultPrevented;
    event.preventDefault();
  };
  window.addEventListener("click", guard);
  try {
    fireEvent.click(anchor, init);
  } finally {
    window.removeEventListener("click", guard);
  }
  // Strażnik MUSI zadziałać - inaczej test nic by nie mierzył.
  expect(leftToBrowser).not.toBeNull();
  return leftToBrowser!;
}

/** Upływ czasu z zegarem - `Date.now()` też musi ruszyć (TTL czyta zegar). */
function tick(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

// Żaden test nie może zostawić kliku przeglądarce bez strażnika
// (`clickStaysWithBrowser`) - happy-dom przeniósłby wtedy okno pod adres
// odnośnika (z żądaniem sieciowym). Nawigacja happy-dom zmienia adres okna
// synchronicznie, więc niezmieniony adres dowodzi, że jej nie było.
let addressBefore = "";

beforeEach(() => {
  vi.useFakeTimers();
  h.preloadRoute.mockClear();
  h.navigate.mockClear();
  h.warmWidgets.mockClear();
  addressBefore = window.location.href;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  expect(window.location.href).toBe(addressBefore);
});

describe("AppLink - opóźnienie intencji", () => {
  it("samo najechanie NIE preloaduje - dopiero 60 ms spoczynku", () => {
    const { anchor, href } = renderLink();

    expect(h.warmWidgets).not.toHaveBeenCalled();
    fireEvent.mouseEnter(anchor);
    // Klatka, w której kursor dopiero wjechał na kartę, należy do przewijania.
    tick(DELAY_MS - 1);
    expect(h.preloadRoute).not.toHaveBeenCalled();

    tick(1);
    expect(h.preloadRoute).toHaveBeenCalledTimes(1);
    // Opcje NAWIGACJI, nie `href`: `preloadRoute` opcji `href` nie zna.
    expect(h.preloadRoute).toHaveBeenCalledWith({ to: href, search: {}, hash: "" });
    expect(h.warmWidgets).toHaveBeenCalledTimes(1);
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

  it.each([
    ["równo TTL po preloadzie trasa jest jeszcze pamiętana", 0, 1],
    ["1 ms po TTL wolno ją preloadować ponownie", 1, 2],
  ])("granica TTL: %s", (_label, pastTtlMs, expectedPreloads) => {
    const { anchor } = renderLink();

    fireEvent.mouseEnter(anchor);
    tick(DELAY_MS);
    expect(h.preloadRoute).toHaveBeenCalledTimes(1);
    fireEvent.mouseLeave(anchor);

    // Drugi odczyt pamięci wypada DOKŁADNIE `TTL + pastTtlMs` po pierwszym
    // (timer intencji dolicza swoje DELAY_MS).
    tick(TTL_MS + pastTtlMs - DELAY_MS);
    fireEvent.mouseEnter(anchor);
    tick(DELAY_MS);

    expect(h.preloadRoute).toHaveBeenCalledTimes(expectedPreloads);
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

    expect(clickStaysWithBrowser(anchor, { button: 0 })).toBe(true);
    expect(h.preloadRoute).not.toHaveBeenCalled();
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("klik nadal nawiguje routerem, bez przeładowania dokumentu", () => {
    const { anchor, href } = renderLink();

    fireEvent.click(anchor, { button: 0 });

    expect(h.navigate).toHaveBeenCalledWith({ href });
  });
});

describe("AppLink - klik, którego router NIE przejmuje", () => {
  it.each([
    ["środkowy przycisk (nowa karta)", { button: 1 }],
    ["Ctrl", { button: 0, ctrlKey: true }],
    ["Cmd", { button: 0, metaKey: true }],
    ["Shift", { button: 0, shiftKey: true }],
    ["Alt", { button: 0, altKey: true }],
  ])("%s zostaje przeglądarce", (_label, init) => {
    const { anchor } = renderLink();

    expect(clickStaysWithBrowser(anchor, init)).toBe(true);
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it('target="_blank" zostaje przeglądarce, target="_self" idzie routerem', () => {
    const blank = renderLink({ target: "_blank" });
    expect(clickStaysWithBrowser(blank.anchor, { button: 0 })).toBe(true);
    expect(h.navigate).not.toHaveBeenCalled();

    const self = renderLink({ target: "_self" });
    expect(clickStaysWithBrowser(self.anchor, { button: 0 })).toBe(false);
    expect(h.navigate).toHaveBeenCalledWith({ href: self.href });
  });

  it("podgląd widżetu w edytorze tłumi nawigację - także routera", () => {
    const { container } = render(
      <div data-builder-renderer="widget-props-preview">
        <AppLink href={freshHref()}>w podglądzie</AppLink>
      </div>,
    );

    const leftToBrowser = clickStaysWithBrowser(within(container).getByText("w podglądzie"), {
      button: 0,
    });

    expect(leftToBrowser).toBe(false);
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it('bez href to kotwica "#": ani preloadu, ani przejęcia kliku', () => {
    const { container } = render(<AppLink>bez celu</AppLink>);
    const anchor = within(container).getByText("bez celu");

    fireEvent.mouseEnter(anchor);
    tick(5 * DELAY_MS);
    expect(clickStaysWithBrowser(anchor, { button: 0 })).toBe(true);

    expect(anchor.getAttribute("href")).toBe("#");
    expect(h.preloadRoute).not.toHaveBeenCalled();
    expect(h.navigate).not.toHaveBeenCalled();
  });
});

describe("toClientHref - które odnośniki zostają w SPA", () => {
  it("ścieżka i pełny adres TEGO originu dają ścieżkę z query i hashem", () => {
    // Origin czytany w chwili testu, nie wpisany na sztywno: to origin
    // środowiska testowego (happy-dom), a nie stała aplikacji.
    const origin = window.location.origin;
    expect(toClientHref("/post/a?x=1#y")).toBe("/post/a?x=1#y");
    expect(toClientHref(`${origin}/post/a?x=1#y`)).toBe("/post/a?x=1#y");
  });

  it.each([
    [undefined],
    [""],
    ["#"],
    ["#sekcja"],
    ["mailto:biuro@example.org"],
    ["TEL:+48123456789"],
    ["//cdn.example.org/plik.pdf"],
    ["https://obca-domena.example.net/post/a"],
    // Nieparsowalny adres absolutny - `new URL` rzuca, odnośnik zostaje natywny.
    ["http://"],
    // Ani ścieżka, ani http(s): względny bez ukośnika, inne schematy.
    ["post/a"],
    ["javascript:void(0)"],
    ["ftp://example.org/plik"],
  ])("%s -> null (natywny odnośnik)", (href) => {
    expect(toClientHref(href)).toBeNull();
  });
});
