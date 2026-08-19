// TRASY WYGLĄDU I MOTYWU - sklejenie, nie widoki.
//
// Dziewięć cienkich tras panelu wyglądu stało do 19.08.2026 na zerze. Każda z
// nich to kilka linijek, ale każda niesie decyzję, której nie widać nigdzie
// indziej: KTÓRY panel pod jakim adresem i Z JAKIM parametrem. Panele są tu
// wymienne (`AppearanceBuilderPane` obsługuje nagłówek i stopkę tym samym
// komponentem, `ArchiveLayoutAdmin` archiwum kategorii i tagów), więc
// przestawienie jednego argumentu daje ekran, który WYGLĄDA poprawnie i edytuje
// nie to, co trzeba - redaktor otwiera „Stopka” i zmienia nagłówek.
//
// Drugi zestaw reguł to PRZEKIEROWANIA. Adres `/admin/theme-design` istniał
// wcześniej jako osobna strona; dziś ma odsyłać do sekcji w Opcjach motywu.
// Martwe przekierowanie to 404 pod adresem, który redakcja ma w zakładkach.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  appearancePanes: [] as Record<string, unknown>[],
  archivePanes: [] as Record<string, unknown>[],
  sidebarPanes: 0,
  mediaManagers: 0,
  themeOptionPanes: 0,
  designSubNavs: 0,
  errorFallbacks: [] as Record<string, unknown>[],
}));

vi.mock("@/components/molecules/RouteErrorFallback", () => ({
  RouteErrorFallback: (props: Record<string, unknown>) => {
    h.errorFallbacks.push(props);
    return <div data-testid="ekran-bledu">{String(props.variant)}</div>;
  },
}));

vi.mock("@/components/admin/AppearanceBuilderPane", () => ({
  AppearanceBuilderPane: (props: Record<string, unknown>) => {
    h.appearancePanes.push(props);
    return <div data-testid="panel-buildera">{String(props.settingsKey)}</div>;
  },
}));
vi.mock("@/components/admin/archiveLayout/ArchiveLayoutAdmin", () => ({
  ArchiveLayoutAdmin: (props: Record<string, unknown>) => {
    h.archivePanes.push(props);
    return <div data-testid="panel-archiwum">{String(props.archiveType)}</div>;
  },
}));
vi.mock("@/components/admin/sidebarBuilder/SidebarBuilderPane", () => ({
  SidebarBuilderPane: () => {
    h.sidebarPanes += 1;
    return <div data-testid="panel-sidebara" />;
  },
}));
vi.mock("@/components/admin/media/MediaManager", () => ({
  MediaManager: () => {
    h.mediaManagers += 1;
    return <div data-testid="menedzer-mediow" />;
  },
}));
vi.mock("@/components/admin/ThemeOptionsPane", () => ({
  ThemeOptionsPane: () => {
    h.themeOptionPanes += 1;
    return <div data-testid="panel-motywu" />;
  },
}));
vi.mock("@/components/admin/DesignSubNav", () => ({
  DesignSubNav: () => {
    h.designSubNavs += 1;
    return <nav data-testid="podnawigacja" />;
  },
}));

import { Route as MediaRoute } from "@/routes/admin.media";
import { Route as ThemeDesignRoute } from "@/routes/admin.theme-design";
import { Route as ThemeOptionsRoute } from "@/routes/admin.theme-options";
import { Route as FooterRoute } from "@/routes/admin.appearance.footer";
import { Route as HeaderRoute } from "@/routes/admin.appearance.header";
import { Route as CategoryArchiveRoute } from "@/routes/admin.appearance.category-archive";
import { Route as TagArchiveRoute } from "@/routes/admin.appearance.tag-archive";
import { Route as PostSidebarRoute } from "@/routes/admin.appearance.post-sidebar";
import { Route as AppearanceRoute } from "@/routes/admin.appearance";
import { routeMeta } from "@/test/routeHarness";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  type AnyRoute,
} from "@tanstack/react-router";

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

/**
 * Renderuje komponent trasy BEZ routera. Te trasy nie mają ani parametrów, ani
 * walidacji zapytania - cała ich treść to wybór panelu i jego argumentów.
 */
function renderRouteComponent(route: AnyRoute) {
  const Component = route.options.component as (() => ReactNode) | undefined;
  if (!Component) throw new Error("trasa nie ma komponentu");
  return render(<Component />, { wrapper });
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.appearancePanes.length = 0;
  h.archivePanes.length = 0;
  h.sidebarPanes = 0;
  h.mediaManagers = 0;
  h.themeOptionPanes = 0;
  h.designSubNavs = 0;
  h.errorFallbacks.length = 0;
});

describe("trasy wyglądu - KTÓRY panel pod jakim adresem", () => {
  it("/admin/media montuje menedżera mediów", () => {
    renderRouteComponent(MediaRoute);
    expect(h.mediaManagers).toBe(1);
  });

  it("/admin/appearance/post-sidebar montuje builder paska bocznego wpisu", () => {
    renderRouteComponent(PostSidebarRoute);
    expect(h.sidebarPanes).toBe(1);
  });

  it("/admin/theme-options montuje podnawigację I panel opcji motywu", () => {
    // Sam panel bez podnawigacji zamyka drogę do pozostałych sekcji wyglądu.
    renderRouteComponent(ThemeOptionsRoute);
    expect(h.designSubNavs).toBe(1);
    expect(h.themeOptionPanes).toBe(1);
  });
});

describe("trasy wyglądu - Z JAKIM parametrem", () => {
  it("stopka i nagłówek dzielą komponent, ale NIE klucz ustawień", () => {
    // Przestawienie klucza daje ekran „Stopka”, który zapisuje nagłówek.
    renderRouteComponent(FooterRoute);
    expect(h.appearancePanes.at(-1)).toMatchObject({ settingsKey: "footer", scope: "footer" });

    renderRouteComponent(HeaderRoute);
    expect(h.appearancePanes.at(-1)).toMatchObject({ settingsKey: "header", scope: "header" });
  });

  it("obie trasy budowania mają NIEPUSTY tytuł", () => {
    // Pusty tytuł zostawia redaktora bez informacji, co właściwie edytuje.
    renderRouteComponent(FooterRoute);
    renderRouteComponent(HeaderRoute);
    for (const props of h.appearancePanes) {
      expect(String(props.title ?? "")).not.toBe("");
    }
  });

  it("archiwum KATEGORII i archiwum TAGÓW różnią się rodzajem", () => {
    // Zamiana rodzajów sprawia, że edycja ustawień kategorii zmienia tagi -
    // i odwrotnie. Oba ekrany wyglądają przy tym identycznie.
    renderRouteComponent(CategoryArchiveRoute);
    expect(h.archivePanes.at(-1)).toMatchObject({ archiveType: "category" });

    renderRouteComponent(TagArchiveRoute);
    expect(h.archivePanes.at(-1)).toMatchObject({ archiveType: "tag" });
  });
});

describe("trasy wyglądu - przekierowania", () => {
  /**
   * Wyłuskuje cel przekierowania rzuconego przez `beforeLoad`. Router rzuca
   * `Response` ze statusem 307, a docelowy adres trzyma w polu `options`.
   */
  function redirectTarget(route: AnyRoute, pathname: string): Record<string, unknown> {
    const beforeLoad = route.options.beforeLoad as
      ((ctx: { location: { pathname: string } }) => void) | undefined;
    if (!beforeLoad) throw new Error("trasa nie ma beforeLoad");
    try {
      beforeLoad({ location: { pathname } });
    } catch (thrown) {
      const response = thrown as Response & { options?: Record<string, unknown> };
      expect(response.status).toBe(307);
      return response.options ?? {};
    }
    throw new Error("beforeLoad nie przekierował");
  }

  it("stary adres /admin/theme-design odsyła do SEKCJI w opcjach motywu", () => {
    // Redakcja ma ten adres w zakładkach; martwe przekierowanie to 404.
    const target = redirectTarget(ThemeDesignRoute, "/admin/theme-design");
    expect(target).toMatchObject({ to: "/admin/theme-options", hash: "design" });
  });

  it("stary adres nie renderuje własnej treści, żeby nie mrugnąć przed skokiem", () => {
    const Component = ThemeDesignRoute.options.component as () => ReactNode;
    expect(Component()).toBeNull();
  });

  it("goły /admin/appearance odsyła do pierwszej zakładki", () => {
    // Bez tego adres nadrzędny pokazuje pustą ramkę bez żadnej treści.
    const target = redirectTarget(AppearanceRoute, "/admin/appearance");
    expect(target).toMatchObject({ to: "/admin/appearance/header" });
  });

  it("adres pod-zakładki przechodzi BEZ przekierowania", () => {
    const beforeLoad = AppearanceRoute.options.beforeLoad as (ctx: {
      location: { pathname: string };
    }) => void;
    expect(() => beforeLoad({ location: { pathname: "/admin/appearance/menu" } })).not.toThrow();
  });
});

describe("/admin/appearance - pasek zakładek", () => {
  const SEKCJE = [
    "header",
    "footer",
    "menu",
    "post-sidebar",
    "category-archive",
    "tag-archive",
    "global-colors",
  ] as const;

  /**
   * Montuje layout wyglądu razem z ZAŚLEPKAMI jego siedmiu pod-zakładek.
   * Pasek zakładek to `Link`-i, które bez zarejestrowanych tras dziecięcych nie
   * mają dokąd wskazać - a to właśnie ich adresy są tu regułą.
   */
  async function mount(entry = "/admin/appearance/header") {
    const root = createRootRoute({ component: () => <Outlet /> });
    const wire = AppearanceRoute.update as unknown as (o: {
      id: string;
      path: string;
      getParentRoute: () => AnyRoute;
    }) => AnyRoute;
    const layout = wire.call(AppearanceRoute, {
      id: "/admin/appearance",
      path: "/admin/appearance",
      getParentRoute: () => root,
    });
    layout.addChildren(
      SEKCJE.map((seg) =>
        createRoute({
          getParentRoute: () => layout,
          path: seg,
          component: () => <div data-testid={`sekcja-${seg}`} />,
        }),
      ),
    );
    const router = createRouter({
      routeTree: root.addChildren([layout]),
      history: createMemoryHistory({ initialEntries: [entry] }),
      context: { queryClient },
      defaultPendingMs: 0,
    });
    await router.load();
    render(<RouterProvider router={router} />, { wrapper });
    return router;
  }

  it("pokazuje zakładkę dla KAŻDEJ sekcji wyglądu", async () => {
    // Brakująca zakładka to sekcja, do której nie da się dojść z panelu.
    await mount();
    const linki = screen.getAllByRole("link").map((a) => a.getAttribute("href"));

    expect(linki).toEqual([
      "/admin/appearance/header",
      "/admin/appearance/footer",
      "/admin/appearance/menu",
      "/admin/appearance/post-sidebar",
      "/admin/appearance/category-archive",
      "/admin/appearance/tag-archive",
      "/admin/appearance/global-colors",
    ]);
  });

  it("każda zakładka ma widoczną etykietę, nie sam adres", async () => {
    await mount();
    for (const link of screen.getAllByRole("link")) {
      expect(link.textContent?.trim()).not.toBe("");
      expect(link.textContent).not.toContain("/admin/");
    }
  });

  it("nad zakładkami stoi podnawigacja działu", async () => {
    await mount();
    expect(h.designSubNavs).toBeGreaterThan(0);
  });

  it("wyróżnia zakładkę odpowiadającą BIEŻĄCEMU adresowi", async () => {
    // Bez wyróżnienia redaktor nie wie, którą sekcję właśnie edytuje.
    await mount("/admin/appearance/menu");
    const aktywne = screen
      .getAllByRole("link")
      .filter((a) => a.className.includes("border-brand"))
      .map((a) => a.getAttribute("href"));

    expect(aktywne).toEqual(["/admin/appearance/menu"]);
  });

  it("goły adres nadrzędny ląduje na pierwszej sekcji", async () => {
    // Domknięcie przekierowania: nie tylko rzuca, ale i dowozi na miejsce.
    const router = await mount("/admin/appearance");

    expect(router.state.location.pathname).toBe("/admin/appearance/header");
    expect(screen.getByTestId("sekcja-header")).toBeInTheDocument();
  });

  it("treść sekcji renderuje się POD paskiem zakładek", async () => {
    await mount("/admin/appearance/global-colors");
    expect(screen.getByTestId("sekcja-global-colors")).toBeInTheDocument();
  });
});

describe("trasa /admin/theme-options - nagłówek dokumentu", () => {
  it("ma tytuł i opis, a nie same wartości domyślne", async () => {
    // Panel administracyjny nie trafia do wyszukiwarek, ale tytuł karty jest
    // jedynym sposobem rozróżnienia kilkunastu otwartych zakładek admina.
    const meta = await routeMeta(ThemeOptionsRoute);
    const title = meta.find((m) => "title" in m)?.title as string | undefined;

    expect(title).toMatch(/Opcje motywu/);
    expect(meta.some((m) => m.name === "description")).toBe(true);
  });

  it("ma własny ekran błędu w wariancie ADMINA", () => {
    // Publiczny ekran błędu w panelu wygląda jak awaria strony i wyprowadza
    // administratora poza panel.
    const ErrorComponent = ThemeOptionsRoute.options.errorComponent as (
      props: Record<string, unknown>,
    ) => ReactNode;
    render(<>{ErrorComponent({ error: new Error("awaria") })}</>, { wrapper });

    expect(h.errorFallbacks.at(-1)).toMatchObject({ variant: "admin" });
  });

  it("brak dopasowania NIE renderuje publicznej strony 404", () => {
    const notFound = ThemeOptionsRoute.options.notFoundComponent as () => ReactNode;
    expect(notFound()).toBeNull();
  });
});
