// `LangToggle` - para flag języka w mobilnej szufladzie headera
// (`MobileTopTools`). Do 2026-10 bez ani jednego testu, a do tego jedyny
// przełącznik bez obrony przed brakiem routera: `router.state` czytał wprost,
// więc klik poza `RouterProvider` (test szuflady, podgląd, storybook) kończył
// się TypeErrorem zamiast zmianą języka. Plik pilnuje:
//   * zaznaczenia aktywnego języka (`aria-pressed`) i no-opu na aktywnej fladze,
//   * tej samej sekwencji co pozostałe przełączniki (`setClientLang` przed
//     nawigacją, `replace`, bez resetu scrolla, query zostaje),
//   * pracy poza routerem: twarda nawigacja i ZERO ostrzeżeń dev o braku routera.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { LangToggle } from "../LangToggle";

const h = vi.hoisted(() => ({
  language: "pl" as string | undefined,
  /** Żywy język klienta - to, co rewrite `output` routera czyta przy budowaniu adresu. */
  clientLang: "pl" as string,
  calls: [] as string[],
  /** `null` = brak atrapy: działa PRAWDZIWY `useRouter` (poza RouterProvider). */
  router: null as null | {
    state: { location: { pathname: string; searchStr?: string; hash?: string } };
    navigate: (opts: { href: string; replace?: boolean; resetScroll?: boolean }) => unknown;
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      language: h.language,
      changeLanguage: (next: string) => {
        h.calls.push(`changeLanguage:${next}`);
        return Promise.resolve();
      },
    },
  }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));

// W vitest `createIsomorphicFn` (bez kompilatora Start) wybiera gałąź
// serwerową, więc prawdziwe `currentLang()` nie widzi `setClientLang`. Atrapa
// trzyma żywy język klienta tak, jak robi to gałąź kliencka.
vi.mock("@/lib/i18n/localeRuntime", () => ({
  currentLang: () => h.clientLang,
  setClientLang: (next: string) => {
    h.clientLang = next;
  },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useRouter: (opts?: { warn?: boolean }) => h.router ?? actual.useRouter(opts),
  };
});

function withRouter(pathname: string, searchStr = "") {
  const navigate = vi.fn((opts: { href: string }) => {
    h.calls.push(`navigate:${opts.href}@${h.clientLang}`);
    return Promise.resolve();
  });
  h.router = { state: { location: { pathname, searchStr } }, navigate };
  return navigate;
}

beforeEach(() => {
  h.language = "pl";
  h.calls.length = 0;
  h.router = null;
  h.clientLang = "pl";
  window.history.replaceState(null, "", "/");
  document.documentElement.removeAttribute("lang");
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("LangToggle - zaznaczenie", () => {
  it.each([
    ["pl", "Polski", "English"],
    ["en", "English", "Polski"],
    ["en-GB", "English", "Polski"],
    [undefined, "Polski", "English"],
  ])("dla i18n.language=%s aktywna jest flaga %s", (language, active, inactive) => {
    h.language = language;
    withRouter("/");
    render(<LangToggle />);

    const on = screen.getByRole("button", { name: active });
    const off = screen.getByRole("button", { name: inactive });
    expect(on).toHaveAttribute("aria-pressed", "true");
    expect(on.className).toContain("opacity-100");
    expect(off).toHaveAttribute("aria-pressed", "false");
    expect(off.className).toContain("opacity-60");
  });

  it("prefiks /en w ścieżce routera zaznacza EN, jak w pozostałych przełącznikach", () => {
    withRouter("/en/blog");
    render(<LangToggle />);

    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("LangToggle - przełączenie", () => {
  it("klik w aktywną flagę niczego nie przełącza", () => {
    const navigate = withRouter("/o-nas");
    render(<LangToggle />);

    fireEvent.click(screen.getByRole("button", { name: "Polski" }));

    expect(h.calls).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();
    expect(h.clientLang).toBe("pl");
  });

  it("klik w EN: język klienta przed nawigacją, replace, bez resetu scrolla, query zostaje", () => {
    const navigate = withRouter("/o-nas", "?tab=zespol");
    render(<LangToggle />);

    fireEvent.click(screen.getByRole("button", { name: "English" }));

    expect(h.calls).toEqual(["changeLanguage:en", "navigate:/en/o-nas?tab=zespol@en"]);
    expect(navigate).toHaveBeenCalledWith({
      href: "/en/o-nas?tab=zespol",
      replace: true,
      resetScroll: false,
      hashScrollIntoView: false,
      state: expect.any(Function),
    });
    expect(document.documentElement.lang).toBe("en");
    expect(window.localStorage.getItem("i18nextLng")).toBeNull();
  });

  it("z EN wraca na polski adres bez prefiksu", () => {
    h.language = "en";
    withRouter("/en/blog");
    h.clientLang = "en";
    render(<LangToggle />);

    fireEvent.click(screen.getByRole("button", { name: "Polski" }));

    expect(h.calls).toEqual(["changeLanguage:pl", "navigate:/blog@pl"]);
  });
});

describe("LangToggle - poza routerem", () => {
  it("klik poza RouterProvider nie wywraca się, tylko nawiguje twardo", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    window.history.replaceState(null, "", "/o-nas?tab=zespol");
    render(<LangToggle />);

    fireEvent.click(screen.getByRole("button", { name: "English" }));

    expect(h.calls).toEqual(["changeLanguage:en"]);
    expect(h.clientLang).toBe("en");
    expect(window.location.pathname).toBe("/en/o-nas");
    expect(window.location.search).toBe("?tab=zespol");
    // Komponent świadomie działa bez routera, więc nie śmieci ostrzeżeniem dev.
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("useRouter must be used"));
  });
});
