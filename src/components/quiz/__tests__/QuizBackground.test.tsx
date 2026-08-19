// Tło strony /quiz - warstwa motywu i parallax.
//
// 180 linii, zero wykonanych. Ten komponent istnieje wyłącznie po to, żeby
// NIE pobierać tego, czego użytkownik nie zobaczy: tło quizu to cztery pliki
// po kilkaset kB w trzech formatach i dwóch wariantach motywu. Cała jego
// wartość sprowadza się więc do jednej reguły:
//
//   wariant PRZECIWNEGO motywu nigdy nie trafia do DOM.
//
// Zamiana `{isDark ? <A/> : <B/>}` na dwa `<picture>` z `dark:opacity-0` jest
// zmianą, którą recenzent przyjmie bez mrugnięcia (wygląda identycznie), a
// która podwaja transfer na wejściu w quiz - i to na łączu mobilnym, bo tam
// właśnie kampanie quizowe lądują. Test pilnuje tego wprost, adresami plików.
//
// Druga rzecz: parallax MUSI ustąpić przy `prefers-reduced-motion`. To nie
// kosmetyka - ruchome tło przy przewijaniu wywołuje mdłości u części osób.
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  QUIZ_BG_PRELOAD_LINKS,
  QUIZ_BG_PRELOAD_SCRIPT,
  QuizBackground,
} from "@/components/quiz/QuizBackground";
// Adresy assetów są UUID-owe, więc nie da się ich wyprowadzić z siebie
// nawzajem podmianą napisu - test czyta te same manifesty co komponent.
import darkMobileAvif from "@/assets/quiz/quiz-bg-dark-mobile.avif.asset.json";
import darkDesktopAvif from "@/assets/quiz/quiz-bg-dark-desktop.avif.asset.json";

const DARK_DESKTOP_AVIF = darkDesktopAvif.url;
const DARK_MOBILE_AVIF = darkMobileAvif.url;

function srcSets(container: HTMLElement) {
  return [...container.querySelectorAll("source")].map((s) => s.getAttribute("srcset") ?? "");
}

/** Domyślnie: bez preferencji ograniczenia ruchu. */
function stubMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(() => {
  document.documentElement.classList.remove("dark");
  stubMotion(false);
});

afterEach(() => {
  document.documentElement.classList.remove("dark");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("QuizBackground - tylko jeden wariant motywu w DOM", () => {
  it("w trybie jasnym NIE ma ani jednego adresu wariantu ciemnego", () => {
    // To jest cała racja bytu tego komponentu: użytkownik light nigdy nie
    // pobiera plików dark.
    const { container } = render(<QuizBackground />);
    expect(container.innerHTML).not.toContain("quiz-bg-dark");
    expect(container.querySelectorAll("picture")).toHaveLength(1);
  });

  it("w trybie ciemnym NIE ma ani jednego adresu wariantu jasnego", () => {
    document.documentElement.classList.add("dark");
    const { container } = render(<QuizBackground />);
    expect(container.innerHTML).toContain("quiz-bg-dark");
    expect(container.innerHTML).not.toContain("quiz-bg-light");
    expect(container.querySelectorAll("picture")).toHaveLength(1);
  });

  it("przełączenie motywu podmienia warstwę bez przeładowania strony", async () => {
    // Przełącznik motywu zmienia klasę na <html>; bez obserwatora tło
    // zostawałoby w wariancie z chwili wejścia na stronę.
    const { container } = render(<QuizBackground />);
    expect(container.innerHTML).toContain("quiz-bg-light");

    // Obserwator mutacji melduje się mikrozadaniem - stąd asynchroniczny akt.
    await act(async () => {
      document.documentElement.classList.add("dark");
    });
    expect(container.innerHTML).toContain("quiz-bg-dark");
    expect(container.innerHTML).not.toContain("quiz-bg-light");
  });

  it("powrót do jasnego motywu też działa", async () => {
    document.documentElement.classList.add("dark");
    const { container } = render(<QuizBackground />);
    await act(async () => {
      document.documentElement.classList.remove("dark");
    });
    expect(container.innerHTML).toContain("quiz-bg-light");
  });

  it("obserwator jest odpinany przy odmontowaniu", () => {
    const disconnect = vi.fn();
    vi.stubGlobal(
      "MutationObserver",
      class {
        disconnect = disconnect;
        observe() {}
        takeRecords() {
          return [];
        }
      },
    );
    const { unmount } = render(<QuizBackground />);
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});

describe("QuizBackground - negocjacja formatu i rozmiaru", () => {
  it("oferuje AVIF, WebP i JPG w tej kolejności", () => {
    // Kolejność źródeł JEST algorytmem wyboru: przeglądarka bierze pierwszy
    // typ, który rozumie. AVIF za JPG oznaczałby, że nikt nie dostanie AVIF.
    const { container } = render(<QuizBackground />);
    const types = [...container.querySelectorAll("source")].map((s) => s.getAttribute("type"));
    expect(types.slice(0, 2)).toEqual(["image/avif", "image/avif"]);
    expect(types.slice(2, 4)).toEqual(["image/webp", "image/webp"]);
    expect(types.slice(4)).toEqual([null, null]);
  });

  it("każdy format ma osobne źródło dla telefonu i pulpitu", () => {
    const { container } = render(<QuizBackground />);
    const medias = [...container.querySelectorAll("source")].map((s) => s.getAttribute("media"));
    expect(medias.filter((m) => m === "(max-width: 767px)")).toHaveLength(3);
    expect(medias.filter((m) => m === "(min-width: 768px)")).toHaveLength(3);
    expect(srcSets(container).some((s) => s.includes("mobile"))).toBe(true);
  });

  it("awaryjny obraz to JPG - najstarszy klient też coś zobaczy", () => {
    const { container } = render(<QuizBackground />);
    expect(container.querySelector("img")).toHaveAttribute("src", expect.stringContaining(".jpg"));
  });

  it("tło jest dekoracją: pusty tekst alternatywny i ukrycie przed czytnikiem", () => {
    const { container } = render(<QuizBackground />);
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("tło nie przechwytuje kliknięć w treść quizu", () => {
    const { container } = render(<QuizBackground />);
    expect(container.firstElementChild).toHaveClass("pointer-events-none");
  });
});

describe("QuizBackground - parallax", () => {
  /** Przewinięcie + oddanie sterowania, żeby zaplanowana klatka zdążyła. */
  async function scroll(y: number) {
    Object.defineProperty(window, "scrollY", { value: y, configurable: true });
    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("przewijanie przesuwa warstwy w różnym tempie", async () => {
    // Dwa współczynniki dają głębię; jeden wspólny byłby zwykłym przesunięciem
    // całości i efekt znikłby.
    const { container } = render(<QuizBackground />);
    const root = container.firstElementChild as HTMLElement;
    await scroll(1000);
    expect(root.style.getPropertyValue("--quiz-parallax-crowd")).toBe("180px");
    expect(root.style.getPropertyValue("--quiz-parallax-overlay")).toBe("80px");
  });

  it("pozycja jest ustawiana od razu, jeszcze przed pierwszym przewinięciem", () => {
    // Wejście na stronę z zakotwiczonym adresem (#pytanie) zaczyna się od
    // przewinięcia; bez pierwszego wyliczenia tło skakałoby przy starcie.
    Object.defineProperty(window, "scrollY", { value: 500, configurable: true });
    const { container } = render(<QuizBackground />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.getPropertyValue("--quiz-parallax-crowd")).toBe("90px");
  });

  it("PREFEROWANY BRAK RUCHU wyłącza parallax całkowicie", async () => {
    stubMotion(true);
    const { container } = render(<QuizBackground />);
    const root = container.firstElementChild as HTMLElement;
    await scroll(1000);
    expect(root.style.getPropertyValue("--quiz-parallax-crowd")).toBe("");
  });

  it("seria zdarzeń przewijania daje JEDNO wyliczenie na klatkę", () => {
    // Bez tej bramki każde zdarzenie scroll (dziesiątki na sekundę) pisałoby
    // po stylach i wymuszało przeliczenie układu.
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    render(<QuizBackground />);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new Event("scroll"));
    });
    expect(frames).toHaveLength(1);

    act(() => frames[0](0));
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(frames).toHaveLength(2);
  });

  it("odmontowanie odpina nasłuch i anuluje zaplanowaną klatkę", () => {
    const cancel = vi.fn();
    vi.stubGlobal("requestAnimationFrame", () => 42);
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<QuizBackground />);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    unmount();
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
    expect(cancel).toHaveBeenCalledWith(42);
  });
});

describe("QUIZ_BG_PRELOAD_LINKS", () => {
  it("preloaduje WYŁĄCZNIE wariant jasny - taki renderuje SSR", () => {
    // Preload wariantu, którego strona nie wyrenderuje, to czysta strata
    // pasma na najdroższym etapie ładowania.
    expect(QUIZ_BG_PRELOAD_LINKS.every((l) => l.href.includes("light"))).toBe(true);
  });

  it("preloaduje AVIF - przeglądarka bez wsparcia po prostu go zignoruje", () => {
    expect(QUIZ_BG_PRELOAD_LINKS.every((l) => l.type === "image/avif")).toBe(true);
  });

  it("rozdziela telefon od pulpitu i prosi o wysoki priorytet", () => {
    expect(QUIZ_BG_PRELOAD_LINKS.map((l) => l.media)).toEqual([
      "(max-width: 767px)",
      "(min-width: 768px)",
    ]);
    expect(QUIZ_BG_PRELOAD_LINKS.every((l) => l.fetchpriority === "high")).toBe(true);
    expect(QUIZ_BG_PRELOAD_LINKS.every((l) => l.as === "image")).toBe(true);
  });
});

describe("QUIZ_BG_PRELOAD_SCRIPT - skrypt w <head>, uruchamiany przed hydracją", () => {
  /** Uruchamia skrypt w bieżącym dokumencie z podstawionym otoczeniem. */
  function runScript(env: { theme?: string | null; prefersDark?: boolean; mobile?: boolean }) {
    vi.stubGlobal("localStorage", {
      getItem: () => env.theme ?? null,
      setItem: () => {},
      removeItem: () => {},
    });
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-color-scheme: dark")
        ? !!env.prefersDark
        : query.includes("max-width")
          ? !!env.mobile
          : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    document.head.querySelectorAll("link[rel=preload]").forEach((l) => l.remove());
    new Function(QUIZ_BG_PRELOAD_SCRIPT)();
    return [...document.head.querySelectorAll("link[rel=preload]")];
  }

  it("zapisany motyw ciemny dokłada preload wariantu ciemnego", () => {
    const links = runScript({ theme: "dark" });
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe(DARK_DESKTOP_AVIF);
    expect(links[0].getAttribute("fetchpriority")).toBe("high");
    expect(links[0].getAttribute("as")).toBe("image");
  });

  it("zapisany motyw jasny NIE dokłada niczego - SSR już go preloadował", () => {
    expect(runScript({ theme: "light", prefersDark: true })).toHaveLength(0);
  });

  it("brak zapisanego wyboru idzie za preferencją systemu", () => {
    expect(runScript({ theme: null, prefersDark: true })).toHaveLength(1);
    expect(runScript({ theme: null, prefersDark: false })).toHaveLength(0);
  });

  it("na telefonie preloaduje wariant mobilny, nie pulpitowy", () => {
    // Wariant pulpitowy na telefonie to kilkaset kB pobranych po nic.
    const links = runScript({ theme: "dark", mobile: true });
    expect(links[0].getAttribute("href")).toBe(DARK_MOBILE_AVIF);
  });

  it("awaria magazynu przeglądarki NIE wywala strony", () => {
    // localStorage rzuca w trybie prywatnym części przeglądarek i przy
    // zablokowanych ciasteczkach. Strona quizu ma się wtedy po prostu
    // wyrenderować w wariancie jasnym.
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("brak dostępu");
      },
    });
    expect(() => new Function(QUIZ_BG_PRELOAD_SCRIPT)()).not.toThrow();
  });
});
