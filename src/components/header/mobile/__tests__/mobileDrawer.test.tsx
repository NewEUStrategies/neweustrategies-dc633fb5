// Mobilna szuflada nagłówka: cztery bloki, każdy na 0% do 18.08.2026.
//
// To jest CAŁA nawigacja telefonu - na tej szerokości nie ma paska menu,
// hamburger jest jedynym wejściem w serwis. Rzeczy, które ten plik pilnuje,
// nie mają innego strażnika:
//   * KOLEJNOŚĆ bloków pochodzi z konfiguracji super-admina (`section_order`),
//     więc render musi ją odtworzyć, a nie zaszyć,
//   * każdy link w szufladzie MUSI ją zamknąć - inaczej po przejściu na inną
//     stronę użytkownik zostaje z zasłoniętym ekranem,
//   * przełączniki (motyw, język, wyszukiwarka) mają nazwy dostępne ZE SŁOWNIKA,
//     bo to same ikony.
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import "@/lib/i18n";
import "@/lib/i18n-mobile-drawer";
import { realT } from "@/test/i18nReal";
import { RouterLinkStub } from "@/test/routerLinkStub";
import { DEFAULT_DRAWER_CONFIG, type DrawerConfig, type NavItem } from "@/lib/mobileDrawer";

const auth = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  signOut: vi.fn(async () => {}),
}));
const theme = vi.hoisted(() => ({ theme: "light", toggle: vi.fn() }));
const drawer = vi.hoisted(() => ({ config: null as DrawerConfig | null }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: RouterLinkStub,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    session: auth.session,
    user: auth.session?.user ?? null,
    signOut: auth.signOut,
  }),
}));

vi.mock("@/components/ThemeProvider", () => ({
  useTheme: () => ({ theme: theme.theme, toggle: theme.toggle }),
}));

// Menu główne ma własny plik testowy - w szufladzie interesuje nas wyłącznie
// to, że sekcja nawigacji je OSADZA i zamyka szufladę po kliknięciu w link.
vi.mock("@/components/menu/SiteMenu", () => ({
  SiteMenu: ({ menuKey, mobile }: { menuKey: string; mobile?: boolean }) => (
    <a href={`/menu/${menuKey}`} data-mobile={String(Boolean(mobile))}>
      pozycja z menu
    </a>
  ),
}));

// Dokument buildera renderujemy zastępczo: jego własna warstwa ma osobne testy,
// a tutaj liczy się miejsce bloku w kolejności.
vi.mock("@/components/builder/organisms/BuilderRenderer", () => ({
  BuilderRenderer: ({ device }: { device?: string }) => (
    <div data-testid="builder">urządzenie: {device}</div>
  ),
}));

vi.mock("@/lib/queries/mobileDrawer", () => ({
  // `initialData` jest GETTEREM: produkcyjne opcje mają je ustawione na
  // domyślną konfigurację, więc pierwszy render nigdy nie czeka na zapytanie -
  // atrapa musi zachować tę własność, inaczej test sprawdzałby wartości
  // domyślne zamiast tych, które ustawił.
  mobileDrawerConfigQueryOptions: {
    queryKey: ["mobile-drawer-config"],
    queryFn: () => Promise.resolve(drawer.config ?? DEFAULT_DRAWER_CONFIG),
    get initialData() {
      return drawer.config ?? DEFAULT_DRAWER_CONFIG;
    },
  },
}));

const { MobileDrawerBody } = await import("../MobileDrawerBody");
const { MobileTopTools } = await import("../MobileTopTools");
const { MobileAccountSection } = await import("../MobileAccountSection");
const { MobileNavSection } = await import("../MobileNavSection");

const t = realT("pl");

function config(over: Partial<DrawerConfig> = {}): DrawerConfig {
  return { ...DEFAULT_DRAWER_CONFIG, ...over };
}

function navItem(over: Partial<NavItem> & { id: string }): NavItem {
  return {
    label_pl: "Pozycja",
    label_en: "Item",
    href: "/pozycja",
    icon: "link",
    enabled: true,
    ...over,
  };
}

/** Rozpoznaje bloki szuflady po ich własnych znacznikach i zwraca kolejność. */
function blockOrder(container: HTMLElement): string[] {
  const scroller = container.firstElementChild!;
  return Array.from(scroller.children).map((block) => {
    if (block.querySelector("[data-testid='builder']")) return "builder";
    if (block.querySelector("nav")) return "nav";
    if (block.querySelector("[role='group']")) return "top_tools";
    return "account";
  });
}

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  auth.session = null;
  auth.signOut.mockClear();
  theme.theme = "light";
  theme.toggle.mockClear();
  drawer.config = null;
});

afterEach(cleanup);

describe("MobileDrawerBody - kolejność bloków", () => {
  it("renderuje bloki w kolejności z konfiguracji super-admina", () => {
    drawer.config = config({
      section_order: ["nav", "account", "top_tools", "builder"],
      top_tools: { search: true, theme: true, language: true },
    });
    const { container } = renderWithQuery(
      <MobileDrawerBody builderDoc={{ version: 1, sections: [] }} onNavigate={() => {}} />,
    );

    // Kolejność czytamy z DOM-u, nie z konfiguracji - to jest cała różnica
    // między „ustawienie zapisane" a „ustawienie działa".
    expect(blockOrder(container)).toEqual(["nav", "account", "top_tools", "builder"]);
  });

  it("blok pominięty w konfiguracji NIE renderuje się wcale", () => {
    drawer.config = config({ section_order: ["builder"] });
    renderWithQuery(
      <MobileDrawerBody builderDoc={{ version: 1, sections: [] }} onNavigate={() => {}} />,
    );
    expect(screen.getByTestId("builder")).toBeTruthy();
    expect(screen.queryByText(t("mobileDrawer.account"))).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("dokument buildera renderuje się w trybie MOBILNYM", () => {
    // Bez wymuszenia kolumny buildera zostają obok siebie i wyjeżdżają poza
    // szerokość szuflady.
    drawer.config = config({ section_order: ["builder"] });
    renderWithQuery(
      <MobileDrawerBody builderDoc={{ version: 1, sections: [] }} onNavigate={() => {}} />,
    );
    expect(screen.getByTestId("builder").textContent).toContain("mobile");
  });
});

describe("MobileTopTools", () => {
  it("bez włączonego narzędzia nie zostawia pustego paska", () => {
    const { container } = render(
      <MobileTopTools tools={{ search: false, theme: false, language: false }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("lupa zamyka szufladę i DOPIERO POTEM otwiera wyszukiwarkę", async () => {
    // Kolejność jest istotna: overlay wyszukiwarki i szuflada to dwie warstwy
    // pełnoekranowe - otwarte naraz nakładają się na siebie.
    vi.useFakeTimers();
    const onNavigate = vi.fn();
    const events: string[] = [];
    const listener = () => events.push("open-search");
    window.addEventListener("neus:open-mobile-search", listener);
    try {
      render(
        <MobileTopTools
          tools={{ search: true, theme: false, language: false }}
          onNavigate={onNavigate}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: t("mobileDrawer.openSearch") }));
      expect(onNavigate).toHaveBeenCalledTimes(1);
      expect(events).toEqual([]); // jeszcze nie - szuflada dopiero się zamyka
      await vi.advanceTimersByTimeAsync(1);
      expect(events).toEqual(["open-search"]);
    } finally {
      window.removeEventListener("neus:open-mobile-search", listener);
      vi.useRealTimers();
    }
  });

  it("przełącznik motywu pokazuje ikonę PRZECIWNEGO motywu i przełącza", () => {
    theme.theme = "dark";
    const { container, unmount } = render(
      <MobileTopTools tools={{ search: false, theme: true, language: false }} />,
    );
    // W ciemnym motywie przycisk oferuje słońce (przejście na jasny).
    expect(container.querySelector(".lucide-sun")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t("mobileDrawer.toggleTheme") }));
    expect(theme.toggle).toHaveBeenCalledTimes(1);
    unmount();

    theme.theme = "light";
    const jasny = render(
      <MobileTopTools tools={{ search: false, theme: true, language: false }} />,
    );
    expect(jasny.container.querySelector(".lucide-moon")).not.toBeNull();
  });

  it("pas narzędzi jest nazwaną grupą dla czytnika ekranu", () => {
    render(<MobileTopTools tools={{ search: true, theme: true, language: true }} />);
    expect(screen.getByRole("group", { name: t("mobileDrawer.tools") })).toBeTruthy();
  });
});

describe("MobileAccountSection", () => {
  it("gość dostaje logowanie i rejestrację", () => {
    render(<MobileAccountSection onNavigate={() => {}} />);
    expect(screen.getByRole("link", { name: t("mobileDrawer.signIn") })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.getByRole("link", { name: t("mobileDrawer.register") })).toBeTruthy();
    expect(screen.queryByRole("button", { name: t("mobileDrawer.signOut") })).toBeNull();
  });

  it("zalogowany dostaje panel i wylogowanie", () => {
    auth.session = { user: { id: "u1" } };
    render(<MobileAccountSection onNavigate={() => {}} />);
    expect(screen.getByRole("link", { name: t("mobileDrawer.myAccount") })).toHaveAttribute(
      "href",
      "/profile",
    );
    expect(screen.queryByRole("link", { name: t("mobileDrawer.signIn") })).toBeNull();
  });

  it("wylogowanie zamyka szufladę DOPIERO po zakończeniu operacji", async () => {
    // Zamknięcie przed odpowiedzią serwera zostawiałoby użytkownika na stronie
    // wyglądającej na zalogowaną.
    auth.session = { user: { id: "u1" } };
    const onNavigate = vi.fn();
    let resolveSignOut: () => void = () => {};
    auth.signOut.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSignOut = resolve;
        }),
    );
    render(<MobileAccountSection onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: t("mobileDrawer.signOut") }));
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();

    resolveSignOut();
    await vi.waitFor(() => expect(onNavigate).toHaveBeenCalledTimes(1));
  });

  it("każde wejście z sekcji konta zamyka szufladę", () => {
    const onNavigate = vi.fn();
    render(<MobileAccountSection onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("link", { name: t("mobileDrawer.signIn") }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});

describe("MobileNavSection", () => {
  it("osadza menu główne w wariancie mobilnym", () => {
    render(<MobileNavSection items={[]} onNavigate={() => {}} />);
    const link = screen.getByRole("link", { name: "pozycja z menu" });
    expect(link).toHaveAttribute("href", "/menu/main");
    expect(link).toHaveAttribute("data-mobile", "true");
  });

  it("kliknięcie W DOWOLNY link menu zamyka szufladę", () => {
    // Menu renderuje się rekurencyjnie, więc nasłuch jest na kontenerze -
    // bez tego przejście na inną stronę zostawiało zasłonięty ekran.
    const onNavigate = vi.fn();
    render(<MobileNavSection items={[]} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("link", { name: "pozycja z menu" }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("kliknięcie POZA linkiem szuflady nie zamyka", () => {
    const onNavigate = vi.fn();
    render(<MobileNavSection items={[]} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText(t("mobileDrawer.navigation"), { selector: "p" }));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("pozycje z konfiguracji super-admina wchodzą POD menu głównym", () => {
    render(
      <MobileNavSection
        items={[
          navItem({ id: "n1", label_pl: "Wydarzenia", href: "/wydarzenia", icon: "calendar" }),
        ]}
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByRole("link", { name: /Wydarzenia/ })).toHaveAttribute("href", "/wydarzenia");
  });

  it("pozycja wyłączona znika, a same wyłączone pozycje nie zostawiają pustego bloku", () => {
    const { container } = render(
      <MobileNavSection
        items={[navItem({ id: "n1", label_pl: "Ukryta", enabled: false })]}
        onNavigate={() => {}}
      />,
    );
    expect(screen.queryByRole("link", { name: /Ukryta/ })).toBeNull();
    // Sam blok nawigacji zostaje (jest w nim menu główne), ale lista dodatkowa
    // nie renderuje pustego kontenera.
    expect(container.querySelectorAll(".mt-2")).toHaveLength(0);
  });

  it("adres zewnętrzny otwiera się w nowej karcie z zabezpieczeniem rel", () => {
    render(
      <MobileNavSection
        items={[navItem({ id: "n1", label_pl: "Komisja", href: "https://ec.europa.eu" })]}
        onNavigate={() => {}}
      />,
    );
    const link = screen.getByRole("link", { name: /Komisja/ });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("nieznana ikona schodzi na ikonę linku zamiast wywalać render", () => {
    const { container } = render(
      <MobileNavSection
        items={[navItem({ id: "n1", icon: "nie-ma-takiej" as NavItem["icon"] })]}
        onNavigate={() => {}}
      />,
    );
    expect(container.querySelector(".lucide-link")).not.toBeNull();
  });

  it("etykiety idą za językiem interfejsu - także po przełączeniu W LOCIE", async () => {
    // Szuflada nie jest przeładowywana przy zmianie języka (chrome zostaje
    // zamontowane), więc `useLang` musi zareagować na zdarzenie i18next.
    const i18n = (await import("@/lib/i18n")).default;
    render(
      <MobileNavSection
        items={[navItem({ id: "n1", label_pl: "Wydarzenia", label_en: "Events" })]}
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByRole("link", { name: /Wydarzenia/ })).toBeTruthy();
    try {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
      expect(screen.getByRole("link", { name: /Events/ })).toBeTruthy();
      expect(screen.getByRole("navigation", { name: "Navigation" })).toBeTruthy();
    } finally {
      await act(async () => {
        await i18n.changeLanguage("pl");
      });
    }
  });

  it("pozycja odpowiadająca bieżącej ścieżce jest oznaczona jako aktualna", () => {
    const original = window.location.pathname;
    window.history.replaceState({}, "", "/wydarzenia");
    try {
      render(
        <MobileNavSection
          items={[navItem({ id: "n1", label_pl: "Wydarzenia", href: "/wydarzenia" })]}
          onNavigate={() => {}}
        />,
      );
      const link = screen.getByRole("link", { name: /Wydarzenia/ });
      expect(link).toHaveAttribute("aria-current", "page");
      expect(within(link).queryByText("Wydarzenia")).toBeTruthy();
    } finally {
      window.history.replaceState({}, "", original);
    }
  });
});
