/**
 * `AdminShell` - RAMA panelu administracyjnego (sidebar + treść), czyli jedyny
 * komponent, który redakcja widzi na KAŻDYM ekranie /admin.
 *
 * CO TEN PLIK PRZYPINA (i dlaczego akurat to).
 *  1. TRZY NIEZALEŻNE DROGI DO TRYBU ZWINIĘTEGO. `compact` liczy się ze wzoru
 *     `((trasa edycji || wymuszenie) && brak extrasów) || styl "style-4"`, więc
 *     każdy człon jest osobnym przypadkiem - razem z przypadkiem, w którym
 *     panel z własną nawigacją (extras) ODBIERA zwinięcie trasie edycji. Bez
 *     tego ostatniego dowodu regresja „edytor wyglądu zwija sobie sidebar
 *     z podmenu" wraca niezauważona.
 *  2. PAMIĘĆ ZWINIĘTYCH GRUP. Preferencja mieszka w localStorage pod
 *     `nes.admin.nav.collapsedGroups`; test sprawdza ZAPIS (klik), ODCZYT
 *     (stan startowy), odporność na uszkodzony wpis (JSON nie do sparsowania,
 *     wartość nie-tablicowa, tablica ze śmieciami) oraz regułę nadrzędną:
 *     grupa z AKTYWNĄ trasą jest rozwinięta wbrew zapisanej preferencji.
 *  3. WYSZUKIWARKA PANELU: filtrowanie mapy nawigacji, etykieta grupy przy
 *     wyniku (inny wiersz niż na liście grup - bez odznaki, z nazwą grupy),
 *     Enter -> nawigacja do pierwszego trafienia, Escape/krzyżyk -> czyszczenie,
 *     komunikat pustki z wpisaną frazą oraz skrót Ctrl/Cmd+K ustawiający fokus.
 *  4. ODZNAKA KOLEJKI KLUBÓW liczona z DWÓCH pól zapytania
 *     (`moderationPending` + `joinRequests`) i ucinana do "99+".
 *  5. STOPKA SIDEBARA: motyw (skutek: klasa `dark` na <html>, zapis w
 *     localStorage i PODMIANA LOGO na wariant ciemny), język (etykieta PL/EN
 *     i wywołanie `changeLanguage` na drugi język) oraz wylogowanie
 *     (`signOut` -> nawigacja na `/login`, dokładnie w tej kolejności).
 *  6. `SidebarBrand`: łańcuch fallbacku logo (ciemne -> jasne -> główne ->
 *     napis) osobno dla stanu zwiniętego (ikona) i rozwiniętego (podłużne).
 *  7. WIDOCZNOŚĆ POZYCJI WEDŁUG ROLI - redaktor nie dostaje grup „Analityka"
 *     i „System", a pozycje super-admina pojawiają się tylko dla super-admina.
 *
 * CO JEST ZAATRAPOWANE I DLACZEGO.
 *  * `react-i18next` - atrapa Z PRAWDZIWYM `t` (`@/test/i18nReal`), więc
 *    asercje mierzą SŁOWNIK, a nie kopię napisu wpisaną w teście: zniknięcie
 *    klucza gasi test. Fabryka `vi.mock` jest hoistowana i NIC nie importuje
 *    (import `@/test/i18nReal` -> `@/lib/i18n` -> `react-i18next` zakleszcza
 *    plik) - `realT` wjeżdża zwykłym importem i jest wstrzykiwany przez
 *    hoistowany uchwyt. `i18n.changeLanguage` to SPY, żeby przełącznik języka
 *    nie mutował globalnej instancji i18next współdzielonej przez plik.
 *  * `@tanstack/react-router` - prawdziwy moduł z podmienionym `Link`
 *    (`@/test/routerLinkStub`), `useNavigate` (rejestr nawigacji) oraz
 *    `useRouterState`, który SUBSKRYBUJE: dzięki temu test może zmienić trasę
 *    w trakcie życia komponentu i zmierzyć regułę „grupa z aktywną trasą jest
 *    rozwinięta", zamiast montować powłokę od zera.
 *  * `@/hooks/useAuth` - granica sesji (role + wylogowanie).
 *  * `@/integrations/supabase/client` - atrapa RZUCAJĄCA. Cache zapytań jest
 *    zasiany, więc żadne zapytanie nie ma prawa polecieć; gdyby poleciało,
 *    test ma paść z jasnym powodem, a nie wyjść do sieci.
 *
 * CO ZOSTAJE PRAWDZIWE: React, PRAWDZIWY `QueryClient` z zasianym cache
 * (`useSiteSetting` z deep-merge domyślnych ustawień i `useClubPendingCounts`),
 * `ThemeProvider` (localStorage + klasa na <html>), cała warstwa
 * `@/lib/admin/adminNav` (budowa grup, wyszukiwarka, rozstrzyganie aktywnej
 * pozycji), `AdminSidebarExtrasProvider` oraz Radix Tooltip.
 *
 * ZNALEZISKA przypięte niżej jako `it.fails` (defekt istniejący; naprawa ma
 * być widoczna jako zmiana testu, nie cicha zmiana zachowania):
 *  * przycisk rozwijający sidebar w trybie zwiniętym nie ma ŻADNEJ dostępnej
 *    nazwy (bliźniaczy przycisk zwijania ma `title`);
 *  * `SidebarRowButton` nie przepuszcza propsów wstrzykiwanych przez Radix
 *    Slot, więc podpowiedzi w trybie zwiniętym nie działają dla motywu,
 *    języka i wylogowania - a to jedyny nośnik etykiety, gdy napis jest
 *    ukryty.
 *
 * ŚWIADOMIE POZA ZAKRESEM: `SidebarRowButton` i `SidebarExternalNavLink` jako
 * atomy (mają własne pliki testowe), zawartość ekranów panelu (`children` to
 * znacznik) oraz tabelaryczny dowód `groupContainsPath` - ten mieszka
 * w `AdminShell.nav.test.tsx`, bo wymaga kontrolowanej mapy nawigacji.
 *
 * RODO: żadnych prawdziwych osób ani adresów - logo z `example.com`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { act, useEffect, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import type { RouterLinkStubProps } from "@/test/routerLinkStub";

/** Stan atrap - hoistowany obiekt, jak w całym repo. */
const h = vi.hoisted(() => ({
  /** Prawdziwy `getFixedT(lang)`; wstrzykiwany niżej (fabryka nic nie importuje). */
  t: null as null | ((lang: "pl" | "en") => unknown),
  /** `undefined` odwzorowuje i18next przed inicjalizacją - panel ma spaść na "pl". */
  lang: "pl" as "pl" | "en" | undefined,
  pathname: "/admin",
  /** Wymuszenia renderu zarejestrowane przez atrapę `useRouterState`. */
  subscribers: new Set<() => void>(),
  navigations: [] as string[],
  languageChanges: [] as string[],
  isAdmin: true,
  isSuperAdmin: false,
  signOut: vi.fn(async () => {}),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: h.t?.(h.lang ?? "pl"),
    i18n: {
      get language() {
        return h.lang;
      },
      changeLanguage: (next: string) => {
        h.languageChanges.push(next);
      },
    },
  }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));

/** Props `<Link>`, o które prosi panel - `activeOptions` jest propsem routera. */
type AdminLinkStubProps = RouterLinkStubProps & { activeOptions?: unknown };

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const react = await import("react");
  const { RouterLinkStub } = await import("@/test/routerLinkStub");

  // `activeOptions` nie może trafić na <a> (React ostrzega o nieznanym
  // atrybucie DOM), reszta propsów - łącznie z tymi od Radix Slot - musi.
  const Link = ({ activeOptions: _activeOptions, ...rest }: AdminLinkStubProps) =>
    react.createElement(RouterLinkStub, rest);

  return {
    ...actual,
    Link,
    useNavigate: () => (opts: { to: string }) => {
      h.navigations.push(opts.to);
    },
    useRouterState: <T,>({ select }: { select: (s: { location: { pathname: string } }) => T }) => {
      const [, force] = react.useReducer((n: number) => n + 1, 0);
      react.useEffect(() => {
        h.subscribers.add(force);
        return () => {
          h.subscribers.delete(force);
        };
      }, []);
      return select({ location: { pathname: h.pathname } });
    },
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    isAdmin: h.isAdmin,
    isSuperAdmin: h.isSuperAdmin,
    signOut: h.signOut,
  }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: new Proxy(
    {},
    {
      get() {
        throw new Error("test: cache zapytań jest zasiany - panel nie ma prawa wyjść do sieci");
      },
    },
  ),
}));

import { AdminShell } from "@/components/admin/AdminShell";
import { useAdminSidebarExtrasSlot, type ExtraNav } from "@/components/admin/AdminSidebarExtras";
import { ThemeProvider } from "@/components/ThemeProvider";
import { clubKeys } from "@/lib/clubs/queryKeys";
import { realT } from "@/test/i18nReal";
// Nakładka słownika z kluczami `admin.nav.*` używanymi przez mapę nawigacji
// (rejestruje się efektem ubocznym importu; panel ciąga ją przez trasę /admin).
import "@/lib/i18n-admin-extras";

h.t = (lang) => realT(lang);

/** Słownik jako źródło asercji - test nie powtarza napisów z komponentu. */
const dict = (lang: "pl" | "en" = "pl"): TFunction => realT(lang);

/** Klucz preferencji zwiniętych grup - lustro stałej z `AdminShell.tsx`. */
const NAV_COLLAPSED_KEY = "nes.admin.nav.collapsedGroups";

/** Klucz zapytania zbiorczego `site_settings` (patrz `lib/useSiteSetting.ts`). */
const SETTINGS_QUERY_KEY = ["site_settings_public", "all"] as const;

/**
 * Konfiguracja logo panelu w kształcie wiersza `site_settings.theme_options`.
 * `null` jest tu CELOWO dopuszczone: wiersz w bazie jest JSON-em bez schematu,
 * a `deepMerge` przepuszcza wartość nie-obiektową ze źródła nad domyślną - to
 * jedyna droga, żeby zmierzyć zabezpieczenia `?? DEFAULTS`.
 */
interface ThemeOptionsRow {
  logo?: Partial<{
    sidebar_icon: string;
    sidebar_icon_dark: string;
    sidebar_expanded: string;
    sidebar_expanded_dark: string;
    main: string;
    main_dark: string;
  }> | null;
  sidebars?: { style?: string } | null;
}

interface ShellOptions {
  pathname?: string;
  themeOptions?: ThemeOptionsRow;
  /** `null` = zapytanie o kolejki klubów nie ma danych (rola bez dostępu). */
  clubCounts?: { moderationPending: number; joinRequests: number } | null;
  hideSidebar?: boolean;
  children?: ReactNode;
  /** Preferencja zwiniętych grup zapisana PRZED montowaniem powłoki. */
  collapsedGroups?: string;
  /** Motyw zapisany przez użytkownika (czytany przez `ThemeProvider`). */
  storedTheme?: "light" | "dark";
}

function renderShell(options: ShellOptions = {}) {
  const {
    pathname = "/admin",
    themeOptions,
    clubCounts = { moderationPending: 0, joinRequests: 0 },
    hideSidebar,
    children = <p>treść ekranu</p>,
    collapsedGroups,
    storedTheme,
  } = options;

  h.pathname = pathname;
  if (collapsedGroups !== undefined)
    window.localStorage.setItem(NAV_COLLAPSED_KEY, collapsedGroups);
  if (storedTheme) window.localStorage.setItem("theme", storedTheme);

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Zasiew zamiast atrapy modułu: `useSiteSetting` robi PRAWDZIWY deep-merge
  // z domyślnymi, a `useClubPendingCounts` liczy sumę z dwóch pól.
  queryClient.setQueryData(SETTINGS_QUERY_KEY, themeOptions ? { theme_options: themeOptions } : {});
  if (clubCounts) queryClient.setQueryData(clubKeys.pendingCounts(), clubCounts);

  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AdminShell hideSidebar={hideSidebar}>{children}</AdminShell>
        </ThemeProvider>
      </QueryClientProvider>,
    ),
  };
}

/** Zmiana trasy W TRAKCIE życia powłoki (atrapa `useRouterState` subskrybuje). */
function navigateTo(pathname: string) {
  act(() => {
    h.pathname = pathname;
    h.subscribers.forEach((notify) => notify());
  });
}

function sidebar(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-sidebar="sidebar"]');
  if (!el) throw new Error("test: sidebar nie jest wyrenderowany");
  return el;
}

function searchBox(): HTMLElement {
  return screen.getByRole("searchbox", { name: dict()("admin.sidebar.searchLabel") });
}

/** Publikuje nawigację wtórną panelu do slotu sidebara (jak `ThemeOptionsPane`). */
function ExtrasPublisher({ nav }: { nav: ExtraNav }) {
  const { setExtras } = useAdminSidebarExtrasSlot();
  useEffect(() => {
    setExtras(nav);
    return () => setExtras(null);
  }, [nav, setExtras]);
  return <p>panel z własnym menu</p>;
}

beforeEach(() => {
  h.lang = "pl";
  h.pathname = "/admin";
  h.navigations.length = 0;
  h.languageChanges.length = 0;
  h.isAdmin = true;
  h.isSuperAdmin = false;
  h.signOut.mockClear();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.style.colorScheme = "";
});

describe("AdminShell - tryby sidebara", () => {
  it("na zwykłej trasie panelu jest rozwinięty: wyszukiwarka, nazwa i przycisk zwijania", () => {
    renderShell({ pathname: "/admin" });

    expect(sidebar().className).toContain("w-56");
    expect(searchBox()).toBeInTheDocument();
    expect(screen.getByText("New European Strategies", { exact: false })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: dict()("admin.sidebar.collapse") }),
    ).toBeInTheDocument();
    expect(screen.getByText("treść ekranu")).toBeInTheDocument();
  });

  it("przycisk zwijania przełącza szerokość i chowa wyszukiwarkę, a ponowny klik ją przywraca", () => {
    renderShell({ pathname: "/admin" });

    fireEvent.click(screen.getByRole("button", { name: dict()("admin.sidebar.collapse") }));
    expect(sidebar().className).toContain("w-12");
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();

    const expander = sidebar().querySelectorAll("[data-sidebar-toggle]");
    expect(expander).toHaveLength(1);
    fireEvent.click(expander[0]);
    expect(sidebar().className).toContain("w-56");
    expect(searchBox()).toBeInTheDocument();
  });

  it("trasa edycji wpisu zwija sidebar bez klikania i zwęża kontener treści", () => {
    renderShell({ pathname: "/admin/posts/abc" });

    expect(sidebar().className).toContain("w-12");
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    const main = screen.getByRole("main");
    expect(main.className).toContain("min-w-0");
    expect(main.firstElementChild?.className).toBe("p-2");
  });

  it("trasa wyglądu (`/admin/appearance/...`) też liczy się jako edycja", () => {
    renderShell({ pathname: "/admin/appearance/category-archive" });
    expect(sidebar().className).toContain("w-12");
  });

  it("styl sidebara `style-4` z ustawień zwija panel na KAŻDEJ trasie", () => {
    renderShell({ pathname: "/admin", themeOptions: { sidebars: { style: "style-4" } } });

    expect(sidebar()).toHaveAttribute("data-sidebar-style", "style-4");
    expect(sidebar().className).toContain("w-12");
  });

  it("domyślnym stylem sidebara jest `style-1` (deep-merge domyślnych ustawień)", () => {
    renderShell({
      pathname: "/admin",
      themeOptions: { logo: { main: "https://example.com/l.png" } },
    });
    expect(sidebar()).toHaveAttribute("data-sidebar-style", "style-1");
  });

  it("panel z własną nawigacją (extras) ODBIERA zwinięcie trasie edycji", async () => {
    const nav: ExtraNav = {
      title: "Sekcje wyglądu",
      items: [{ id: "header", label: "Nagłówek" }],
      activeId: "header",
      onSelect: vi.fn(),
    };
    renderShell({ pathname: "/admin/posts/abc", children: <ExtrasPublisher nav={nav} /> });

    await waitFor(() => expect(sidebar().className).toContain("w-56"));
    expect(screen.getByText("Sekcje wyglądu")).toBeInTheDocument();
  });

  it("`hideSidebar` zdejmuje sidebar i wystawia pasek języka nad treścią", () => {
    renderShell({ pathname: "/admin/posts/abc", hideSidebar: true });

    expect(document.querySelector('[data-sidebar="sidebar"]')).toBeNull();
    expect(screen.getByRole("group", { name: dict()("admin.language") })).toBeInTheDocument();
    expect(screen.getByRole("main").className).toContain("w-full");
  });

  it("kontener treści ma osobny układ dla opcji motywu i dla zwykłego ekranu", () => {
    const { unmount } = renderShell({ pathname: "/admin/theme-options" });
    expect(screen.getByRole("main").firstElementChild?.className).toContain("pl-3");
    unmount();

    renderShell({ pathname: "/admin/users" });
    expect(screen.getByRole("main").firstElementChild?.className).toContain("px-3");
  });
});

describe("AdminShell - zwijanie grup nawigacji", () => {
  it("klik etykiety grupy chowa jej pozycje i zapisuje preferencję w localStorage", () => {
    renderShell({ pathname: "/admin" });
    const label = dict()("admin.navGroups.content");

    expect(screen.getByRole("link", { name: dict()("admin.nav.posts") })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: label }));

    expect(screen.queryByRole("link", { name: dict()("admin.nav.posts") })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-expanded", "false");
    expect(JSON.parse(window.localStorage.getItem(NAV_COLLAPSED_KEY) ?? "null")).toEqual([
      "content",
    ]);
  });

  it("drugi klik rozwija grupę i usuwa ją z zapisanej preferencji", () => {
    renderShell({ pathname: "/admin" });
    const label = dict()("admin.navGroups.content");

    fireEvent.click(screen.getByRole("button", { name: label }));
    fireEvent.click(screen.getByRole("button", { name: label }));

    expect(screen.getByRole("link", { name: dict()("admin.nav.posts") })).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(NAV_COLLAPSED_KEY) ?? "null")).toEqual([]);
  });

  it("zapisana preferencja jest wczytywana przy montowaniu powłoki", async () => {
    renderShell({ pathname: "/admin", collapsedGroups: JSON.stringify(["content", "taxonomy"]) });

    await waitFor(() =>
      expect(
        screen.queryByRole("link", { name: dict()("admin.nav.posts") }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("link", { name: dict()("admin.nav.tags") })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: dict()("admin.nav.settings") })).toBeInTheDocument();
  });

  it.each([
    ["uszkodzony JSON", "{nie-json"],
    ["wartość nie-tablicowa", JSON.stringify({ content: true })],
  ])("uszkodzona preferencja (%s) zostawia panel w układzie domyślnym", async (_opis, raw) => {
    renderShell({ pathname: "/admin", collapsedGroups: raw });

    await waitFor(() =>
      expect(screen.getByRole("link", { name: dict()("admin.nav.posts") })).toBeInTheDocument(),
    );
  });

  it("z zapisanej tablicy brane są wyłącznie identyfikatory tekstowe", async () => {
    renderShell({ pathname: "/admin", collapsedGroups: JSON.stringify([1, null, "content"]) });

    await waitFor(() =>
      expect(
        screen.queryByRole("link", { name: dict()("admin.nav.posts") }),
      ).not.toBeInTheDocument(),
    );
  });

  it("grupa z AKTYWNĄ trasą jest rozwinięta wbrew zapisanej preferencji", () => {
    renderShell({ pathname: "/admin", collapsedGroups: JSON.stringify(["content"]) });
    expect(screen.queryByRole("link", { name: dict()("admin.nav.posts") })).not.toBeInTheDocument();

    navigateTo("/admin/media/123");

    expect(screen.getByRole("link", { name: dict()("admin.nav.posts") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: dict()("admin.navGroups.content") })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("grupa kokpitu nie ma etykiety, więc nie ma czym jej zwinąć - skrót stoi na każdej trasie", async () => {
    // Grupa `overview` jest jedyną BEZ etykiety, a etykieta jest jedynym
    // przełącznikiem zwijania. Nawet ręcznie dopisana preferencja jej nie
    // schowa - i to, a nie reguła „aktywnej trasy", trzyma skrót do kokpitu
    // na każdym ekranie panelu.
    renderShell({ pathname: "/admin/media", collapsedGroups: JSON.stringify(["overview"]) });

    const dashboard = await screen.findByRole("link", { name: dict()("admin.nav.dashboard") });
    const renderedGroups = Array.from(sidebar().querySelectorAll("nav > div"));
    const overviewGroup = renderedGroups.find((group) => group.contains(dashboard));

    expect(overviewGroup).toBeDefined();
    expect(overviewGroup?.querySelector('button[data-sidebar="group-label"]')).toBeNull();
  });

  it("w trybie zwiniętym nie ma etykiet grup ani zwijania", () => {
    renderShell({ pathname: "/admin/posts/abc", collapsedGroups: JSON.stringify(["content"]) });

    expect(
      screen.queryByRole("button", { name: dict()("admin.navGroups.content") }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: dict()("admin.nav.posts") })).toBeInTheDocument();
  });
});

describe("AdminShell - wyszukiwarka panelu", () => {
  it("filtruje mapę nawigacji bez oglądania się na diakrytyki i pokazuje nazwę grupy", () => {
    renderShell({ pathname: "/admin" });

    fireEvent.change(searchBox(), { target: { value: "slowniczek" } });

    const hit = screen.getByRole("link", {
      name: `${dict()("admin.nav.glossary")} ${dict()("admin.navGroups.taxonomy")}`,
    });
    expect(hit).toHaveAttribute("href", "/admin/glossary");
    expect(screen.queryByRole("link", { name: dict()("admin.nav.posts") })).not.toBeInTheDocument();
  });

  it("Enter przenosi do pierwszego trafienia i czyści pole", () => {
    renderShell({ pathname: "/admin" });
    const input = searchBox();

    fireEvent.change(input, { target: { value: "slowniczek" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(h.navigations).toEqual(["/admin/glossary"]);
    expect(input).toHaveValue("");
  });

  it("Enter bez trafień nigdzie nie nawiguje", () => {
    renderShell({ pathname: "/admin" });
    const input = searchBox();

    fireEvent.change(input, { target: { value: "zzzznieistnieje" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(h.navigations).toEqual([]);
    expect(input).toHaveValue("zzzznieistnieje");
  });

  it("Escape czyści zapytanie", () => {
    renderShell({ pathname: "/admin" });
    const input = searchBox();

    fireEvent.change(input, { target: { value: "media" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(input).toHaveValue("");
    expect(screen.getByRole("link", { name: dict()("admin.nav.posts") })).toBeInTheDocument();
  });

  it("krzyżyk czyści zapytanie i znika razem z nim", () => {
    renderShell({ pathname: "/admin" });
    const input = searchBox();
    fireEvent.change(input, { target: { value: "media" } });

    fireEvent.click(screen.getByRole("button", { name: dict()("admin.sidebar.searchClear") }));

    expect(input).toHaveValue("");
    expect(
      screen.queryByRole("button", { name: dict()("admin.sidebar.searchClear") }),
    ).not.toBeInTheDocument();
  });

  it("brak trafień daje komunikat z wpisaną frazą", () => {
    renderShell({ pathname: "/admin" });

    fireEvent.change(searchBox(), { target: { value: "  zzzznieistnieje  " } });

    expect(
      screen.getByText(dict()("admin.sidebar.searchEmpty", { query: "zzzznieistnieje" })),
    ).toBeInTheDocument();
  });

  it("klik w trafienie czyści wyszukiwanie i przywraca listę grup", () => {
    renderShell({ pathname: "/admin" });
    const input = searchBox();
    fireEvent.change(input, { target: { value: "slowniczek" } });

    fireEvent.click(
      screen.getByRole("link", {
        name: `${dict()("admin.nav.glossary")} ${dict()("admin.navGroups.taxonomy")}`,
      }),
    );

    expect(input).toHaveValue("");
    expect(screen.getByRole("link", { name: dict()("admin.nav.posts") })).toBeInTheDocument();
  });

  it("Ctrl+K ustawia fokus na wyszukiwarce panelu", () => {
    renderShell({ pathname: "/admin" });

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(document.activeElement).toBe(searchBox());
  });

  it("Cmd+K działa tak samo, a samo `k` nie przechwytuje pisania", () => {
    renderShell({ pathname: "/admin" });

    fireEvent.keyDown(window, { key: "K", metaKey: true });
    expect(document.activeElement).toBe(searchBox());

    const main = screen.getByRole("main");
    main.focus();
    fireEvent.keyDown(window, { key: "k" });
    expect(document.activeElement).not.toBe(searchBox());
  });
});

describe("AdminShell - odznaka kolejki klubów", () => {
  it.each([
    ["sumę obu kolejek", { moderationPending: 3, joinRequests: 2 }, "5"],
    ["skrót 99+ dla dużych kolejek", { moderationPending: 100, joinRequests: 50 }, "99+"],
  ])("pokazuje %s", (_opis, counts, expected) => {
    renderShell({ pathname: "/admin", clubCounts: counts });

    const badge = screen.getByLabelText(dict()("admin.nav.pendingItems"));
    expect(badge).toHaveTextContent(expected);
  });

  it("przy pustych kolejkach odznaki nie ma wcale", () => {
    renderShell({ pathname: "/admin", clubCounts: { moderationPending: 0, joinRequests: 0 } });

    expect(screen.queryByLabelText(dict()("admin.nav.pendingItems"))).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: dict()("admin.nav.clubs") })).toBeInTheDocument();
  });

  it("dopóki zapytanie o kolejki nie ma danych, pozycja klubów stoi bez odznaki", () => {
    renderShell({ pathname: "/admin", clubCounts: null });

    expect(screen.getByRole("link", { name: dict()("admin.nav.clubs") })).toBeInTheDocument();
    expect(screen.queryByLabelText(dict()("admin.nav.pendingItems"))).not.toBeInTheDocument();
  });

  it("wynik wyszukiwania nie niesie odznaki - w jej miejscu stoi nazwa grupy", () => {
    renderShell({ pathname: "/admin", clubCounts: { moderationPending: 7, joinRequests: 0 } });

    fireEvent.change(searchBox(), { target: { value: dict()("admin.nav.clubs") } });

    expect(screen.queryByLabelText(dict()("admin.nav.pendingItems"))).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: `${dict()("admin.nav.clubs")} ${dict()("admin.navGroups.community")}`,
      }),
    ).toBeInTheDocument();
  });
});

describe("AdminShell - stopka sidebara", () => {
  it("przełącznik motywu zapala tryb ciemny i podmienia logo na wariant ciemny", async () => {
    renderShell({
      pathname: "/admin",
      themeOptions: {
        logo: {
          sidebar_expanded: "https://example.com/logo-jasne.png",
          sidebar_expanded_dark: "https://example.com/logo-ciemne.png",
        },
      },
    });

    expect(screen.getByAltText("Logo")).toHaveAttribute(
      "src",
      "https://example.com/logo-jasne.png",
    );

    fireEvent.click(screen.getByRole("button", { name: dict()("admin.theme") }));

    await waitFor(() =>
      expect(screen.getByAltText("Logo")).toHaveAttribute(
        "src",
        "https://example.com/logo-ciemne.png",
      ),
    );
    expect(window.localStorage.getItem("theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("przełącznik języka pokazuje bieżący język i przełącza na drugi", () => {
    renderShell({ pathname: "/admin" });

    fireEvent.click(screen.getByRole("button", { name: "PL" }));

    expect(h.languageChanges).toEqual(["en"]);
  });

  it("w wariancie angielskim etykieta to EN, a klik wraca na polski", () => {
    h.lang = "en";
    renderShell({ pathname: "/admin" });

    expect(screen.getByRole("link", { name: dict("en")("admin.viewSite") })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "EN" }));

    expect(h.languageChanges).toEqual(["pl"]);
  });

  it("przed inicjalizacją i18next (brak `language`) przełącznik pokazuje polski", () => {
    h.lang = undefined;
    renderShell({ pathname: "/admin" });

    fireEvent.click(screen.getByRole("button", { name: "PL" }));

    expect(h.languageChanges).toEqual(["en"]);
  });

  it("wylogowanie kończy sesję i dopiero potem przenosi na stronę logowania", async () => {
    renderShell({ pathname: "/admin" });

    fireEvent.click(screen.getByRole("button", { name: dict()("admin.signout") }));

    // Kolejność jest istotna: przekierowanie przed zakończeniem `signOut`
    // zostawia w panelu zalogowaną sesję na następnej trasie.
    expect(h.signOut).toHaveBeenCalledTimes(1);
    expect(h.navigations).toEqual([]);
    await waitFor(() => expect(h.navigations).toEqual(["/login"]));
  });

  it('skrót „zobacz stronę" prowadzi na stronę publiczną', () => {
    renderShell({ pathname: "/admin" });

    expect(screen.getByRole("link", { name: dict()("admin.viewSite") })).toHaveAttribute(
      "href",
      "/",
    );
  });
});

describe("AdminShell - logo panelu", () => {
  it.each([
    [
      "rozwinięty, motyw jasny: podłużne logo jasne",
      "light" as const,
      false,
      {
        sidebar_expanded: "https://example.com/wide-light.png",
        sidebar_expanded_dark: "https://example.com/wide-dark.png",
      },
      "https://example.com/wide-light.png",
    ],
    [
      "rozwinięty, motyw ciemny: podłużne logo ciemne",
      "dark" as const,
      false,
      {
        sidebar_expanded: "https://example.com/wide-light.png",
        sidebar_expanded_dark: "https://example.com/wide-dark.png",
      },
      "https://example.com/wide-dark.png",
    ],
    [
      "rozwinięty bez logo sidebara: fallback na logo główne",
      "light" as const,
      false,
      { main: "https://example.com/main.png" },
      "https://example.com/main.png",
    ],
    [
      "zwinięty: ikona kwadratowa",
      "light" as const,
      true,
      { sidebar_icon: "https://example.com/icon.png" },
      "https://example.com/icon.png",
    ],
    [
      "zwinięty w ciemnym motywie bez wariantu ciemnego: ikona jasna",
      "dark" as const,
      true,
      { sidebar_icon: "https://example.com/icon.png" },
      "https://example.com/icon.png",
    ],
  ])("%s", async (_opis, storedTheme, compact, logo, expectedSrc) => {
    renderShell({
      pathname: compact ? "/admin/posts/abc" : "/admin",
      storedTheme,
      themeOptions: { logo },
    });

    await waitFor(() => expect(screen.getByAltText("Logo")).toHaveAttribute("src", expectedSrc));
  });

  it("bez żadnego logo panel pokazuje nazwę serwisu z dopiskiem Admin", () => {
    renderShell({ pathname: "/admin" });

    const brand = screen.getByRole("link", { name: /New European Strategies/ });
    expect(brand).toHaveTextContent("New European Strategies Admin");
    expect(screen.queryByAltText("Logo")).not.toBeInTheDocument();
  });

  it("bez logo w trybie zwiniętym zostaje sama nazwa, bez dopisku Admin", () => {
    renderShell({ pathname: "/admin/posts/abc" });

    const brand = screen.getByRole("link", { name: "New European Strategies" });
    expect(brand).not.toHaveTextContent("Admin");
  });

  it("uszkodzony wiersz ustawień (logo i sidebary jako `null`) nie wywraca powłoki", () => {
    // `deepMerge` przepuszcza wartość nie-obiektową ze źródła NAD domyślną,
    // więc panel dostaje dosłowne `null` - i to jest jedyny stan, w którym
    // zabezpieczenia `?? DEFAULTS` naprawdę pracują.
    renderShell({ pathname: "/admin", themeOptions: { logo: null, sidebars: null } });

    expect(sidebar()).toHaveAttribute("data-sidebar-style", "style-1");
    expect(sidebar().className).toContain("w-56");
    expect(screen.getByRole("link", { name: /New European Strategies/ })).toBeInTheDocument();
  });
});

describe("AdminShell - nawigacja wtórna panelu (extras)", () => {
  it("pokazuje tytuł i pozycje slotu, zaznacza aktywną i oddaje klik właścicielowi", async () => {
    const onSelect = vi.fn();
    const nav: ExtraNav = {
      title: "Sekcje wyglądu",
      items: [
        { id: "header", label: "Nagłówek" },
        { id: "footer", label: "Stopka" },
      ],
      activeId: "header",
      onSelect,
    };
    renderShell({ pathname: "/admin/theme-options", children: <ExtrasPublisher nav={nav} /> });

    const active = await screen.findByRole("button", { name: "Nagłówek" });
    expect(active.className).toContain("border-brand");
    const inactive = screen.getByRole("button", { name: "Stopka" });
    expect(inactive.className).not.toContain("bg-brand/10");

    fireEvent.click(inactive);
    expect(onSelect).toHaveBeenCalledWith("footer");
  });

  it("slot bez tytułu renderuje same pozycje", async () => {
    const nav: ExtraNav = {
      items: [{ id: "header", label: "Nagłówek" }],
      onSelect: vi.fn(),
    };
    renderShell({ pathname: "/admin/theme-options", children: <ExtrasPublisher nav={nav} /> });

    expect(await screen.findByRole("button", { name: "Nagłówek" })).toBeInTheDocument();
    expect(screen.queryByText("Sekcje wyglądu")).not.toBeInTheDocument();
  });
});

describe("AdminShell - widoczność pozycji według roli", () => {
  it('redaktor bez roli admina nie widzi grup „Analityka" i „System"', () => {
    h.isAdmin = false;
    renderShell({ pathname: "/admin" });

    expect(
      screen.queryByRole("button", { name: dict()("admin.navGroups.analytics") }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: dict()("admin.navGroups.system") }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: dict()("admin.nav.posts") })).toBeInTheDocument();
  });

  it('super-admin dostaje dodatkowe pozycje w grupach „Wygląd" i „System"', () => {
    h.isSuperAdmin = true;
    renderShell({ pathname: "/admin" });

    expect(
      screen.getByRole("link", { name: dict()("admin.nav.mobileDrawer") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: dict()("admin.nav.loginSettings") }),
    ).toBeInTheDocument();
  });

  it("administrator bez rangi super-admina tych pozycji nie ma", () => {
    renderShell({ pathname: "/admin" });

    expect(
      screen.queryByRole("link", { name: dict()("admin.nav.loginSettings") }),
    ).not.toBeInTheDocument();
  });
});

describe("AdminShell - aktywna pozycja nawigacji", () => {
  it("na podtrasie świeci się DOKŁADNIE jedna pozycja - ta najgłębiej dopasowana", () => {
    renderShell({ pathname: "/admin/events/types" });

    const active = sidebar().querySelectorAll('[data-active="true"]');
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveAccessibleName(dict()("admin.nav.eventTypes"));
  });

  it("zmiana trasy przenosi podświetlenie bez przemontowania powłoki", () => {
    renderShell({ pathname: "/admin/events/types" });

    navigateTo("/admin/media");

    const active = sidebar().querySelectorAll('[data-active="true"]');
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveAccessibleName(dict()("admin.nav.media"));
  });
});

describe("AdminShell - podpowiedzi w trybie zwiniętym", () => {
  it("wiersz nawigacji dostaje podpowiedź (Radix oznacza wyzwalacz `data-state`)", () => {
    renderShell({ pathname: "/admin/posts/abc" });

    const row = screen.getByRole("link", { name: dict()("admin.nav.posts") });
    expect(row).toHaveAttribute("data-state", "closed");
  });

  it("w trybie rozwiniętym podpowiedzi nie ma - etykieta jest widoczna wprost", () => {
    renderShell({ pathname: "/admin" });

    const row = screen.getByRole("link", { name: dict()("admin.nav.posts") });
    expect(row).not.toHaveAttribute("data-state");
    expect(row).toHaveAttribute("title", dict()("admin.nav.posts"));
  });

  it.fails(
    "DEFEKT: przycisk rozwijający zwinięty sidebar nie ma żadnej dostępnej nazwy (bliźniaczy przycisk zwijania ma `title`)",
    () => {
      renderShell({ pathname: "/admin/posts/abc" });

      expect(
        screen.getByRole("button", { name: dict()("admin.sidebar.expand") }),
      ).toBeInTheDocument();
    },
  );

  it.fails(
    "DEFEKT: `SidebarRowButton` nie przepuszcza propsów Radix Slot, więc w trybie zwiniętym motyw/język/wylogowanie nie mają podpowiedzi (a napis jest ukryty)",
    () => {
      renderShell({ pathname: "/admin/posts/abc" });

      expect(screen.getByRole("button", { name: dict()("admin.theme") })).toHaveAttribute(
        "data-state",
        "closed",
      );
    },
  );
});

describe("AdminShell - kontener treści", () => {
  it("treść ekranu żyje w regionie `main` z kotwicą pomijania nawigacji", () => {
    renderShell({ pathname: "/admin", children: <h1>Kokpit redakcji</h1> });

    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main-content");
    expect(within(main).getByRole("heading", { name: "Kokpit redakcji" })).toBeInTheDocument();
  });
});
