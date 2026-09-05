// Pasek postępu nawigacji - dwa niezależne kontrakty w jednym komponencie.
//
// KONTRAKT 1 (SSR): region `aria-live` musi być w dokumencie od pierwszego
// renderu, ale BEZ treści. Router raportuje `pending`, gdy dokument dopiero się
// składa, więc serwer wypisywał tu "Ładowanie…", klient po hydratacji pusty
// napis - i React regenerował CAŁE drzewo, bo ten komponent siedzi w layoucie
// korzenia (czyli dotyczyło to KAŻDEJ strony).
//
// KONTRAKT 2 (klient): pasek jest ZWLEKAJĄCY i SAMOGASNĄCY. Przejścia poniżej
// 120 ms nie mają prawa mrugnąć paskiem (miganie czyta się jak usterka),
// a dłuższe pełzną do 90% i nigdy dalej - 100% jest zarezerwowane dla
// ZAKOŃCZONEJ nawigacji. Bez tych progów pasek albo migocze przy każdym
// kliknięciu, albo stoi na 100% nad stroną, która się jeszcze ładuje. Cała ta
// część biegnie na ZEGARZE UDAWANYM: progi są w milisekundach, a test na
// prawdziwym czasie mierzyłby obciążenie maszyny, nie zachowanie komponentu.
//
// Router i i18n są zamockowane celowo: przedmiotem testu jest zachowanie paska
// wobec flagi „trwa nawigacja", nie integracja z routerem. Tłumacz jest
// PRAWDZIWY (`realT`), żeby komunikat czytnika ekranu mierzył słownik.
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { realT } from "@/test/i18nReal";

const h = vi.hoisted(() => ({
  /** Wycinek stanu routera, jaki widzi selektor komponentu. */
  routerState: { isLoading: false, status: "pending" } as { isLoading: boolean; status: string },
  lang: "pl" as "pl" | "en",
  /** Prawdziwy `getFixedT`, wstrzyknięty pod importami - fabryka nic nie importuje. */
  fixedT: null as null | typeof realT,
}));

// Atrapa WYWOŁUJE selektor komponentu na podstawionym stanie, zamiast zwracać
// gotowe `true`. Dzięki temu testowany jest także warunek „co znaczy zajęty" -
// przy atrapie zwracającej stałą ta linia nigdy się nie wykonuje, a pomyłka
// w niej (np. samo `isLoading`) przechodziłaby niezauważona.
vi.mock("@tanstack/react-router", () => ({
  useRouterState: <T,>({
    select,
  }: {
    select: (state: { isLoading: boolean; status: string }) => T;
  }): T => select(h.routerState),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.(h.lang), i18n: { language: h.lang }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));

h.fixedT = realT;

const { RouteProgress } = await import("../RouteProgress");

/** Wypełniony kawałek paska - jedyny nośnik postępu i widoczności. */
function bar(container: HTMLElement): HTMLElement {
  const node = container.querySelector<HTMLElement>("[aria-hidden] > div");
  if (node === null) throw new Error("test: pasek postępu nie ma wypełnienia");
  return node;
}

function width(container: HTMLElement): number {
  return Number.parseFloat(bar(container).style.width);
}

function opacity(container: HTMLElement): string {
  return bar(container).style.opacity;
}

/** Przesuwa udawany zegar wewnątrz `act`, żeby React zaksięgował stan. */
function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

const SHOW_DELAY = 120;
const TICK = 220;
const FADE = 280;

beforeEach(() => {
  h.routerState = { isLoading: false, status: "pending" };
  h.lang = "pl";
});

describe("RouteProgress - kontrakt hydratacji", () => {
  it("nie wypisuje tekstu ladowania w SSR, mimo ze router raportuje pending", () => {
    // W SSR useEffect sie nie wykonuje, wiec useHasMounted() zwraca false.
    // Gdyby tresc nie byla nim bramkowana, serwer wyslalby "Ładowanie…",
    // klient po hydratacji pusty string i React regenerowalby cale drzewo
    // (RouteProgress siedzi w layoucie korzenia, wiec dotyczylo to KAZDEJ strony).
    const html = renderToString(<RouteProgress />);

    expect(html).not.toContain("Ładowanie");
  });

  it("zachowuje region aria-live w DOM juz w SSR, zeby czytnik mial punkt zaczepienia", () => {
    const html = renderToString(<RouteProgress />);

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });
});

describe("stan zajetosci ma DWA niezalezne zrodla w stanie routera", () => {
  it("praca loadera trasy (`isLoading`) znaczy zajęty", () => {
    h.routerState = { isLoading: true, status: "idle" };
    render(<RouteProgress />);

    expect(screen.getByRole("status").textContent).toBe(realT("pl")("common.loading"));
  });

  it("przejście w toku (`status === pending`) też znaczy zajęty", () => {
    // Druga połowa warunku. Gdyby selektor patrzył tylko na `isLoading`,
    // pasek milczałby przez cały czas rozstrzygania trasy.
    h.routerState = { isLoading: false, status: "pending" };
    render(<RouteProgress />);

    expect(screen.getByRole("status").textContent).toBe(realT("pl")("common.loading"));
  });

  it("router bezczynny to cisza", () => {
    h.routerState = { isLoading: false, status: "idle" };
    render(<RouteProgress />);

    expect(screen.getByRole("status").textContent).toBe("");
  });
});

describe("komunikat dla czytnika ekranu pojawia się dopiero po zamontowaniu", () => {
  it("po hydratacji trwająca nawigacja jest ogłaszana napisem ze słownika", () => {
    render(<RouteProgress />);

    expect(screen.getByRole("status").textContent).toBe(realT("pl")("common.loading"));
  });

  it("po zakończeniu nawigacji region milczy, a nie powtarza komunikatu", () => {
    const { rerender } = render(<RouteProgress />);
    h.routerState = { isLoading: false, status: "idle" };
    rerender(<RouteProgress />);

    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("na angielskiej stronie komunikat jest angielski", () => {
    h.lang = "en";
    render(<RouteProgress />);

    expect(screen.getByRole("status").textContent).toBe(realT("en")("common.loading"));
    expect(screen.getByRole("status").textContent).not.toBe(realT("pl")("common.loading"));
  });

  it("sam pasek jest dekoracją ukrytą przed czytnikiem ekranu", () => {
    // Gdyby pasek nie był `aria-hidden`, czytnik ogłaszałby KAŻDY z ~20 skoków
    // szerokości - komunikat z regionu `status` jest jedynym zamierzonym.
    const { container } = render(<RouteProgress />);

    expect(container.querySelector("[aria-hidden]")).not.toBeNull();
  });
});

describe("pasek zwleka, pełznie i gaśnie", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Kolejność jest istotna: odmontowanie musi zajść jeszcze na udawanym
    // zegarze, inaczej zaległe `setInterval` dobija do prawdziwego czasu.
    cleanup();
    vi.useRealTimers();
  });

  it("krótkie przejście NIE mruga paskiem - poniżej progu nic się nie pokazuje", () => {
    // 120 ms to cała racja bytu opóźnienia: przy szybkich trasach pasek
    // pojawiający się i znikający w jednej klatce czyta się jak usterka.
    const { container, rerender } = render(<RouteProgress />);
    expect(opacity(container)).toBe("0");

    advance(SHOW_DELAY - 1);
    h.routerState = { isLoading: false, status: "idle" };
    rerender(<RouteProgress />);
    advance(SHOW_DELAY + TICK);

    expect(opacity(container)).toBe("0");
    expect(width(container)).toBe(0);
  });

  it("po przekroczeniu progu pasek pojawia się na starcie 8%", () => {
    const { container } = render(<RouteProgress />);

    advance(SHOW_DELAY);

    expect(opacity(container)).toBe("1");
    expect(width(container)).toBe(8);
  });

  it("pełznie dalej z każdym taktem i zatrzymuje się przy 90%, nie na 100%", () => {
    // 90% to obietnica: „jeszcze nie skończone". Dobicie do 100% przed
    // zakończeniem nawigacji byłoby kłamstwem o stanie strony.
    //
    // ZMIERZONY PUŁAP TO 90,32%, NIE RÓWNE 90%: przyrost ma podłogę
    // `Math.max(0.5, …)`, więc ostatni takt przed progiem przeskakuje go
    // o ułamek i dopiero wtedy warunek `p >= 90` zatrzymuje pełzanie.
    // Różnica jest wizualnie nieistotna (pół punktu na 2 px paska), ale
    // asercja opisuje zachowanie RZECZYWISTE, a nie zamierzone.
    const { container } = render(<RouteProgress />);
    advance(SHOW_DELAY);

    advance(TICK);
    const afterOne = width(container);
    expect(afterOne).toBeGreaterThan(8);

    advance(TICK * 100);
    const plateau = width(container);
    expect(plateau).toBeGreaterThan(afterOne);
    expect(plateau).toBeGreaterThanOrEqual(90);
    expect(plateau).toBeLessThan(91);

    // Kolejne takty już niczego nie zmieniają - pasek stoi, dopóki trwa
    // nawigacja.
    advance(TICK * 50);
    expect(width(container)).toBe(plateau);
  });

  it("zakończona nawigacja skacze na 100%, a dopiero potem gaśnie", () => {
    const { container, rerender } = render(<RouteProgress />);
    advance(SHOW_DELAY + TICK);

    h.routerState = { isLoading: false, status: "idle" };
    rerender(<RouteProgress />);

    expect(width(container)).toBe(100);
    expect(opacity(container)).toBe("1");

    advance(FADE);

    expect(opacity(container)).toBe("0");
    expect(width(container)).toBe(0);
  });

  it("kolejna nawigacja po wygaszeniu zapala pasek od nowa", () => {
    const { container, rerender } = render(<RouteProgress />);
    advance(SHOW_DELAY);
    h.routerState = { isLoading: false, status: "idle" };
    rerender(<RouteProgress />);
    advance(FADE);
    expect(opacity(container)).toBe("0");

    h.routerState = { isLoading: true, status: "idle" };
    rerender(<RouteProgress />);
    advance(SHOW_DELAY);

    expect(opacity(container)).toBe("1");
    expect(width(container)).toBe(8);
  });

  it.fails("ZNALEZISKO: odmontowanie w trakcie nawigacji ZOSTAWIA takt pełzania", () => {
    // Kontrakt: efekt sprząta swoje zegary w funkcji czyszczącej. Tymczasem
    // OBIE gałęzie efektu zwracają `() => undefined`, a `clearInterval`
    // wywoływane jest dopiero przy NASTĘPNYM przebiegu efektu - którego po
    // odmontowaniu już nie ma. Zostaje `setInterval` bijący co 220 ms przez
    // resztę życia karty.
    //
    // CZYM TO SZKODZI, A CZYM NIE. `setProgress` na odmontowanym komponencie
    // jest w Reakcie 18+ (tu 19) CICHYM NIC - nie ma ani ostrzeżenia, ani
    // wyjątku, więc nikt tego w konsoli nie zobaczy. Szkodą jest sam
    // niezatrzymany zegar: budzi kartę co 220 ms i trzyma przy życiu domknięcie
    // odmontowanego drzewa. Dlatego asercja jest na LICZBIE ŻYWYCH ZEGARÓW,
    // a nie na ostrzeżeniu Reacta - to jedyny mierzalny skutek.
    //
    // GDZIE TO BIJE W APLIKACJI: `SiteChrome` renderuje `RouteProgress` w DWÓCH
    // różnych miejscach drzewa - w gałęzi powłoki publicznej i w gałęzi
    // admin/login - więc przejście ze strony publicznej do `/admin` albo
    // `/login` w trakcie trwającej nawigacji odmontowuje pasek razem z jego
    // zegarem.
    const { unmount } = render(<RouteProgress />);
    advance(SHOW_DELAY);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
