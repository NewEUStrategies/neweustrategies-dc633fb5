// `LangReelSwitcher` - "taśma" języka w headerze i w pasku czytania. Jedyny
// przełącznik języka interfejsu, który widzi czytelnik na desktopie, więc
// plik pilnuje kontraktu, którego nie widać w samym markupie:
//   * KTÓRY język jest aktywny: prefiks ścieżki ("/en/...") wygrywa z
//     `i18n.language`, a bez prefiksu decyduje kod i18next po prefiksie
//     ("en-GB" -> EN, brak języka -> PL);
//   * KOLEJNOŚĆ przełączenia: `setClientLang` MUSI zajść przed nawigacją -
//     rewrite `output` routera czyta `currentLang()` w chwili budowania adresu
//     i tylko wtedy dokleja "/en" (test łapie wartość w momencie `navigate`);
//   * nawigacja `replace` bez resetu scrolla, a przy jej awarii (synchronicznej
//     ALBO odrzuconej obietnicy - `router.navigate` jest async) twardy fallback
//     na `window.location`;
//   * ten sam adres w drugim języku: query (`?q=`, `?redirect=`, tokeny) i hash
//     przechodzą przez przełączenie;
//   * brak martwego zapisu localStorage "i18nextLng" - nic go nie czyta, lustrem
//     preferencji jest LANG_STORAGE_KEY zapisywany w `src/lib/i18n.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LangReelSwitcher } from "../LangReelSwitcher";

type FakeLocation = { pathname: string; searchStr?: string; hash?: string };

const h = vi.hoisted(() => ({
  language: "pl" as string | undefined,
  /** Żywy język klienta - to, co rewrite `output` routera czyta przy budowaniu adresu. */
  clientLang: "pl" as string,
  calls: [] as string[],
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

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useRouter: () => h.router,
}));

/** Router-atrapa, który zapisuje adres ORAZ język widziany przez rewrite `output`. */
function withRouter(location: FakeLocation, navigate?: (href: string) => unknown) {
  const spy = vi.fn((opts: { href: string; replace?: boolean; resetScroll?: boolean }) => {
    h.calls.push(`navigate:${opts.href}@${h.clientLang}`);
    return navigate ? navigate(opts.href) : Promise.resolve();
  });
  h.router = { state: { location }, navigate: spy };
  return spy;
}

const LABEL = "Język";

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

describe("LangReelSwitcher - aktywny język", () => {
  it("bez prefiksu i z polskim i18n pokazuje PL i proponuje EN", () => {
    withRouter({ pathname: "/o-nas" });
    render(<LangReelSwitcher label={LABEL} />);

    const btn = screen.getByRole("button", { name: `${LABEL}: PL EN` });
    expect(btn).toHaveAttribute("title", `${LABEL}: EN`);
    // Taśma: najpierw aktywny, pod nim docelowy.
    expect(
      Array.from(btn.querySelectorAll(".lang-switch__item")).map((n) => n.textContent),
    ).toEqual(["pl", "en"]);
  });

  it("prefiks /en w ścieżce wygrywa z polskim i18n", () => {
    withRouter({ pathname: "/en/post/raport" });
    render(<LangReelSwitcher label={LABEL} />);

    expect(screen.getByRole("button", { name: `${LABEL}: EN PL` })).toBeInTheDocument();
  });

  it.each([
    ["en-GB", "EN PL"],
    ["en", "EN PL"],
    ["pl-PL", "PL EN"],
    [undefined, "PL EN"],
  ])("bez prefiksu decyduje i18n.language=%s", (language, pair) => {
    h.language = language;
    withRouter({ pathname: "/kontakt" });
    render(<LangReelSwitcher label={LABEL} />);

    expect(screen.getByRole("button", { name: `${LABEL}: ${pair}` })).toBeInTheDocument();
  });

  it("bez routera (render poza RouterProvider) decyduje i18n i nic nie pada", () => {
    h.language = "en";
    render(<LangReelSwitcher label={LABEL} className="extra-class" />);

    const btn = screen.getByRole("button", { name: `${LABEL}: EN PL` });
    expect(btn.className).toContain("extra-class");
  });
});

describe("LangReelSwitcher - przełączenie", () => {
  it("ustawia język klienta PRZED nawigacją i nawiguje replace bez resetu scrolla", () => {
    const navigate = withRouter({ pathname: "/post/raport" });
    render(<LangReelSwitcher label={LABEL} />);

    fireEvent.click(screen.getByRole("button", { name: `${LABEL}: PL EN` }));

    // `@en` = rewrite routera widział już nowy język w chwili budowania adresu.
    expect(h.calls).toEqual(["changeLanguage:en", "navigate:/en/post/raport@en"]);
    expect(navigate).toHaveBeenCalledWith({
      href: "/en/post/raport",
      replace: true,
      resetScroll: false,
      hashScrollIntoView: false,
      state: expect.any(Function),
    });
    expect(document.documentElement.lang).toBe("en");
  });

  it("nie zapisuje martwego klucza localStorage i18nextLng", () => {
    withRouter({ pathname: "/" });
    render(<LangReelSwitcher label={LABEL} />);

    fireEvent.click(screen.getByRole("button", { name: `${LABEL}: PL EN` }));

    expect(h.calls).toContain("navigate:/en@en");
    expect(window.localStorage.getItem("i18nextLng")).toBeNull();
  });

  it("z EN wraca na adres bez prefiksu", () => {
    h.language = "en";
    withRouter({ pathname: "/en/kontakt" });
    h.clientLang = "en";
    render(<LangReelSwitcher label={LABEL} />);

    fireEvent.click(screen.getByRole("button", { name: `${LABEL}: EN PL` }));

    expect(h.calls).toEqual(["changeLanguage:pl", "navigate:/kontakt@pl"]);
    expect(document.documentElement.lang).toBe("pl");
  });

  it("zachowuje query i hash - ten sam adres w drugim języku", () => {
    withRouter({ pathname: "/search", searchStr: "?q=nato&page=2", hash: "wyniki" });
    render(<LangReelSwitcher label={LABEL} />);

    fireEvent.click(screen.getByRole("button", { name: `${LABEL}: PL EN` }));

    expect(h.calls).toContain("navigate:/en/search?q=nato&page=2#wyniki@en");
  });

  it("na stronie bez prefiksów (logowanie) nie gubi ?redirect=", () => {
    withRouter({ pathname: "/login", searchStr: "?redirect=%2Fprofile" });
    render(<LangReelSwitcher label={LABEL} />);

    fireEvent.click(screen.getByRole("button", { name: `${LABEL}: PL EN` }));

    expect(h.calls).toContain("navigate:/login?redirect=%2Fprofile@en");
  });

  it("synchroniczny wyjątek navigate kończy się twardą nawigacją", () => {
    withRouter({ pathname: "/o-nas" }, () => {
      throw new Error("router w budowie");
    });
    render(<LangReelSwitcher label={LABEL} />);

    fireEvent.click(screen.getByRole("button", { name: `${LABEL}: PL EN` }));

    expect(window.location.pathname).toBe("/en/o-nas");
  });

  it("odrzucona obietnica navigate (navigate jest async) też kończy się twardą nawigacją", async () => {
    withRouter({ pathname: "/o-nas", searchStr: "?x=1" }, () =>
      Promise.reject(new Error("SecurityError: replaceState throttled")),
    );
    render(<LangReelSwitcher label={LABEL} />);

    fireEvent.click(screen.getByRole("button", { name: `${LABEL}: PL EN` }));

    await waitFor(() => expect(window.location.pathname).toBe("/en/o-nas"));
    expect(window.location.search).toBe("?x=1");
  });

  it("bez routera nawiguje twardo z bieżącego adresu okna (z query)", () => {
    h.language = "en";
    window.history.replaceState(null, "", "/en/wydarzenia?miasto=krakow");
    render(<LangReelSwitcher label={LABEL} />);

    fireEvent.click(screen.getByRole("button", { name: `${LABEL}: EN PL` }));

    expect(h.calls).toEqual(["changeLanguage:pl"]);
    expect(h.clientLang).toBe("pl");
    expect(window.location.pathname).toBe("/wydarzenia");
    expect(window.location.search).toBe("?miasto=krakow");
  });
});
