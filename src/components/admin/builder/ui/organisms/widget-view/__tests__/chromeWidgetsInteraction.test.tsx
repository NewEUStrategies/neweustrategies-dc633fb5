// Chrome widgety (przełącznik języka + motywu): domykamy ścieżki interakcji,
// których nie dotyka test wizualny - nawigację przez router TanStack (wraz z
// awarią navigate -> twardy fallback window.location), no-op przy kliknięciu
// aktywnego języka, odporność na rzucający localStorage oraz zatrzymanie
// propagacji pointerdown (drag kanwy buildera nie może łapać tych kliknięć).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LangSwitcherDropdown, ThemeToggleWidget } from "../chromeWidgets";
import { ThemeProvider } from "@/components/ThemeProvider";

const changeLanguage = vi.hoisted(() => vi.fn(async () => {}));
const i18nState = vi.hoisted(() => ({ language: "pl" as string | undefined }));
const routerState = vi.hoisted(() => ({
  current: null as null | {
    state: { location: { pathname: string } };
    navigate: (opts: unknown) => unknown;
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: string | { defaultValue?: string }) =>
      typeof o === "string" ? o : (o?.defaultValue ?? k),
    i18n: { language: i18nState.language, changeLanguage },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@tanstack/react-router", async (orig) => {
  const actual = await orig<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useRouter: () => routerState.current,
  };
});

beforeEach(() => {
  changeLanguage.mockClear();
  i18nState.language = "pl";
  routerState.current = null;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("LangSwitcherDropdown - nawigacja przez router", () => {
  it("navigates with router.navigate to the localized path", () => {
    const navigate = vi.fn();
    routerState.current = {
      state: { location: { pathname: "/en/about" } },
      navigate,
    };
    render(<LangSwitcherDropdown label="Język" />);

    // Ścieżka /en/... -> aktywny EN; klik w PL przełącza język.
    fireEvent.click(screen.getByRole("button", { name: "Polski" }));

    expect(changeLanguage).toHaveBeenCalledWith("pl");
    expect(localStorage.getItem("i18nextLng")).toBe("pl");
    expect(document.documentElement.lang).toBe("pl");
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ href: "/about", replace: true }),
    );
  });

  it("falls back to window.location when router.navigate throws", () => {
    routerState.current = {
      state: { location: { pathname: "/o-nas" } },
      navigate: () => {
        throw new Error("router w budowie");
      },
    };
    render(<LangSwitcherDropdown label="Język" />);

    // PL aktywny (brak prefiksu) -> klik w English.
    fireEvent.click(screen.getByRole("button", { name: "English" }));

    expect(changeLanguage).toHaveBeenCalledWith("en");
    // Twardy fallback: pełna nawigacja przeglądarki na ścieżkę z prefiksem.
    expect(window.location.pathname).toBe("/en/o-nas");
  });

  it("is a no-op when the active language is clicked and survives a throwing localStorage", () => {
    const navigate = vi.fn();
    routerState.current = { state: { location: { pathname: "/" } }, navigate };
    render(<LangSwitcherDropdown label="Język" />);

    // Aktywny PL -> klik w PL nie robi nic.
    fireEvent.click(screen.getByRole("button", { name: "Polski" }));
    expect(changeLanguage).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();

    // Prywatny tryb / brak zgody na storage: setItem rzuca, widget nie pada.
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(changeLanguage).toHaveBeenCalledWith("en");
    expect(navigate).toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("derives the language from i18n when the path has no prefix and i18n is empty", () => {
    // i18n.language undefined -> operator ?? podstawia "pl".
    i18nState.language = undefined;
    routerState.current = { state: { location: { pathname: "/kontakt" } }, navigate: vi.fn() };
    render(<LangSwitcherDropdown label="Język" />);
    expect(screen.getByRole("button", { name: "Polski" })).toHaveAttribute("aria-pressed", "true");
  });

  it("stops pointerdown propagation so the builder canvas drag never starts", () => {
    routerState.current = { state: { location: { pathname: "/" } }, navigate: vi.fn() };
    const outer = vi.fn();
    const { container } = render(
      <div onPointerDown={outer}>
        <LangSwitcherDropdown label="Język" />
      </div>,
    );
    const btn = container.querySelector("button") as HTMLButtonElement;
    fireEvent.pointerDown(btn);
    expect(outer).not.toHaveBeenCalled();
  });
});

describe("ThemeToggleWidget", () => {
  it("toggles between dark and light and blocks pointerdown propagation", () => {
    localStorage.setItem("theme", "dark");
    const outer = vi.fn();
    render(
      <ThemeProvider>
        <div onPointerDown={outer}>
          <ThemeToggleWidget />
        </div>
      </ThemeProvider>,
    );

    // Stan ciemny -> przycisk oferuje przejście do jasnego.
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-label")).toContain("light");

    fireEvent.pointerDown(btn);
    expect(outer).not.toHaveBeenCalled();

    fireEvent.click(btn);
    expect(btn.getAttribute("aria-label")).toContain("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
