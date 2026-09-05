/**
 * `AdminShell` - REGUŁA PRZYNALEŻNOŚCI TRASY DO GRUPY NAWIGACJI oraz wiersz
 * nawigacji prowadzący poza panel.
 *
 * PO CO OSOBNY PLIK. `groupContainsPath` jest funkcją czystą, ale NIE jest
 * eksportowana - i słusznie, bo jej jedynym zadaniem jest decyzja widoczna dla
 * redakcji: „która grupa menu ma zostać rozwinięta, choć redaktor ją zwinął".
 * Zamiast dokładać do produkcji `export` tylko po to, żeby dało się ją zawołać
 * (regula: testy nie zmieniają kodu produkcyjnego), test wykonuje ją PRZEZ
 * powłokę: zwija w preferencji WSZYSTKIE grupy i pyta, która mimo to jest
 * rozwinięta. Odpowiedź to dokładnie wynik `groupContainsPath` dla każdej grupy.
 *
 * Mapa nawigacji jest tu KONTROLOWANA (atrapa `buildAdminNavGroups`), bo
 * prawdziwa mapa panelu nie zawiera ani jednej pary tras o wspólnym prefiksie,
 * ani ani jednej pozycji zewnętrznej (`href`) - a to są właśnie te dwa
 * przypadki, w których reguła może się zepsuć po cichu. Reszta warstwy
 * `@/lib/admin/adminNav` (wyszukiwarka, klucze pozycji, rozstrzyganie aktywnej
 * pozycji) zostaje PRAWDZIWA.
 *
 * CO PRZYPINA TABELA:
 *   * trasa DOKŁADNA (`/admin/posts` w grupie z `/admin/posts`),
 *   * trasa ZAGNIEŻDŻONA (`/admin/posts/123/edit`),
 *   * trasa SĄSIEDNIA o wspólnym prefiksie (`/admin/posts-archive` NIE należy
 *     do grupy z `/admin/posts`) - klasyczny błąd `startsWith` bez separatora,
 *     który podświetlałby i rozwijał cudzą grupę,
 *   * pozycja ZEWNĘTRZNA (`href`) nigdy nie przesądza o grupie, nawet gdy jej
 *     adres jest identyczny ze ścieżką panelu,
 *   * trasa spoza mapy nie rozwija niczego.
 *
 * Druga część pliku dotyczy WIERSZA ZEWNĘTRZNEGO (`SidebarExternalNavLink`
 * wewnątrz `AdminNavRow`): nowa karta, `rel="noopener noreferrer"`, dopisek
 * dostępności i zachowanie w trybie zwiniętym oraz w wynikach wyszukiwania.
 *
 * ATRAPY: `react-i18next` (echo klucza - tu przedmiotem dowodu jest LOGIKA
 * nawigacji, nie napis; napisy mierzy `AdminShell.test.tsx` prawdziwym
 * słownikiem), router (`Link`, `useRouterState`, `useNavigate`), `useAuth`
 * oraz rzucający klient Supabase (cache zapytań jest zasiany).
 *
 * RODO: adresy wyłącznie z `example.com`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AdminNavGroup } from "@/lib/admin/adminNav";
import type { RouterLinkStubProps } from "@/test/routerLinkStub";

const h = vi.hoisted(() => ({
  pathname: "/admin",
  navigations: [] as string[],
  /** Kontrolowana mapa nawigacji - ustawiana po imporcie fixture'u. */
  groups: [] as AdminNavGroup[],
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

/** Props `<Link>`, o które prosi panel - `activeOptions` jest propsem routera. */
type AdminLinkStubProps = RouterLinkStubProps & { activeOptions?: unknown };

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const react = await import("react");
  const { RouterLinkStub } = await import("@/test/routerLinkStub");

  const Link = ({ activeOptions: _activeOptions, ...rest }: AdminLinkStubProps) =>
    react.createElement(RouterLinkStub, rest);

  return {
    ...actual,
    Link,
    useNavigate: () => (opts: { to: string }) => {
      h.navigations.push(opts.to);
    },
    useRouterState: <T,>({ select }: { select: (s: { location: { pathname: string } }) => T }) =>
      select({ location: { pathname: h.pathname } }),
  };
});

// Tylko budowa mapy jest podmieniona; wyszukiwarka, klucze pozycji
// i rozstrzyganie aktywnej pozycji zostają prawdziwe.
vi.mock("@/lib/admin/adminNav", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin/adminNav")>();
  return { ...actual, buildAdminNavGroups: () => h.groups };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, isSuperAdmin: false, signOut: vi.fn(async () => {}) }),
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
import { ThemeProvider } from "@/components/ThemeProvider";
import { clubKeys } from "@/lib/clubs/queryKeys";

/** Klucz preferencji zwiniętych grup - lustro stałej z `AdminShell.tsx`. */
const NAV_COLLAPSED_KEY = "nes.admin.nav.collapsedGroups";

/** Ikona pozycji nawigacji - w tym pliku nie jest przedmiotem dowodu. */
const NoIcon = () => null;

/**
 * Mapa dobrana pod jeden cel: dwie trasy o WSPÓLNYM PREFIKSIE w różnych
 * grupach plus grupa z pozycją zewnętrzną, której adres celowo pokrywa się ze
 * ścieżką panelu.
 */
const NAV_FIXTURE: AdminNavGroup[] = [
  {
    id: "wpisy",
    label: "Grupa wpisów",
    items: [{ to: "/admin/posts", icon: NoIcon, label: "Wpisy" }],
  },
  {
    id: "archiwum",
    label: "Grupa archiwum",
    items: [{ to: "/admin/posts-archive", icon: NoIcon, label: "Archiwum wpisów" }],
  },
  {
    id: "zewnetrzne",
    label: "Grupa zewnętrzna",
    items: [
      {
        href: "/admin/reports",
        icon: NoIcon,
        label: "Raporty w zewnętrznej usłudze",
        keywords: ["raporty"],
      },
    ],
  },
  {
    id: "ustawienia",
    label: "Grupa ustawień",
    items: [{ to: "/admin/settings", icon: NoIcon, label: "Ustawienia" }],
  },
];

const ALL_GROUP_IDS = NAV_FIXTURE.map((g) => g.id);
const ALL_GROUP_LABELS = NAV_FIXTURE.map((g) => g.label ?? "");

interface RenderOptions {
  pathname: string;
  /** Preferencja zwiniętych grup zapisana PRZED montowaniem powłoki. */
  collapsed?: string[];
}

function renderShell({ pathname, collapsed }: RenderOptions) {
  h.pathname = pathname;
  if (collapsed) window.localStorage.setItem(NAV_COLLAPSED_KEY, JSON.stringify(collapsed));

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(["site_settings_public", "all"], {});
  queryClient.setQueryData(clubKeys.pendingCounts(), { moderationPending: 0, joinRequests: 0 });

  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AdminShell>
          <p>treść ekranu</p>
        </AdminShell>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

/** Etykiety grup, które panel trzyma ROZWINIĘTE mimo zapisanej preferencji. */
function expandedGroupLabels(): string[] {
  return ALL_GROUP_LABELS.filter(
    (label) => screen.getByRole("button", { name: label }).getAttribute("aria-expanded") === "true",
  );
}

beforeEach(() => {
  h.pathname = "/admin";
  h.navigations.length = 0;
  h.groups = NAV_FIXTURE;
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  // `ThemeProvider` maluje po `<html>` klasą i `color-scheme` - oba wracają do
  // stanu wyjściowego, żeby kolejny test startował z czystej strony.
  document.documentElement.className = "";
  document.documentElement.style.colorScheme = "";
});

describe("AdminShell - która grupa nawigacji zawiera bieżącą trasę", () => {
  it.each([
    ["trasa dokładnie równa pozycji", "/admin/posts", ["Grupa wpisów"]],
    ["trasa zagnieżdżona pod pozycją", "/admin/posts/123/edit", ["Grupa wpisów"]],
    [
      "trasa sąsiednia o wspólnym prefiksie należy WYŁĄCZNIE do swojej grupy",
      "/admin/posts-archive",
      ["Grupa archiwum"],
    ],
    [
      "podtrasa sąsiada też nie wciąga grupy o wspólnym prefiksie",
      "/admin/posts-archive/2020",
      ["Grupa archiwum"],
    ],
    ["pozycja zewnętrzna (`href`) nie przesądza o grupie", "/admin/reports", []],
    ["trasa spoza mapy nie rozwija żadnej grupy", "/admin/nieznana-trasa", []],
    ["inna grupa panelu", "/admin/settings", ["Grupa ustawień"]],
  ])("%s", async (_opis, pathname, expected) => {
    renderShell({ pathname, collapsed: ALL_GROUP_IDS });

    // Preferencja wczytuje się w efekcie po montowaniu - czekamy na jej skutek.
    await waitFor(() => expect(expandedGroupLabels()).toEqual(expected));
  });

  it("bez zapisanej preferencji wszystkie grupy są rozwinięte", () => {
    renderShell({ pathname: "/admin/posts" });

    expect(expandedGroupLabels()).toEqual(ALL_GROUP_LABELS);
  });

  it("grupy z aktywną trasą nie da się zwinąć klikiem, choć klik zapisuje preferencję", async () => {
    renderShell({ pathname: "/admin/posts" });

    fireEvent.click(screen.getByRole("button", { name: "Grupa wpisów" }));

    expect(screen.getByRole("link", { name: "Wpisy" })).toBeInTheDocument();
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(NAV_COLLAPSED_KEY) ?? "null")).toEqual([
        "wpisy",
      ]),
    );
  });
});

describe("AdminShell - wiersz nawigacji prowadzący poza panel", () => {
  it("otwiera nową kartę, zabezpiecza `rel` i niesie dopisek dostępności", () => {
    renderShell({ pathname: "/admin" });

    const link = screen.getByRole("link", { name: /Raporty w zewnętrznej usłudze/ });
    expect(link).toHaveAttribute("href", "/admin/reports");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("data-external-link", "true");
    expect(link).toHaveAttribute(
      "title",
      "Raporty w zewnętrznej usłudze - admin.nav.externalNewTab",
    );
    expect(link).toHaveAccessibleName("Raporty w zewnętrznej usłudze admin.nav.externalNewTab");
  });

  it("w trybie zwiniętym gubi podpowiedź `title` (zastępuje ją dymek) i chowa napis", () => {
    renderShell({ pathname: "/admin/posts/abc" });

    const link = screen.getByRole("link", { name: /Raporty w zewnętrznej usłudze/ });
    expect(link).not.toHaveAttribute("title");
    expect(link).toHaveAttribute("data-state", "closed");
    expect(screen.getByText("Raporty w zewnętrznej usłudze").className).toContain("hidden");
  });

  it("pozycja zewnętrzna wchodzi do wyników wyszukiwania i nie pokazuje nazwy grupy", () => {
    renderShell({ pathname: "/admin" });

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "raporty" } });

    const link = screen.getByRole("link", { name: /Raporty w zewnętrznej usłudze/ });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).not.toHaveTextContent("Grupa zewnętrzna");
    expect(screen.queryByRole("link", { name: "Wpisy" })).not.toBeInTheDocument();
  });

  it("Enter w wyszukiwarce nie nawiguje, gdy pierwszym trafieniem jest adres zewnętrzny", () => {
    renderShell({ pathname: "/admin" });
    const input = screen.getByRole("searchbox");

    fireEvent.change(input, { target: { value: "raporty" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(h.navigations).toEqual([]);
    expect(input).toHaveValue("raporty");
  });
});
