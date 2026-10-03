// Bieżąca pozycja w szufladzie mobilnej - z PRAWDZIWYM routerem i historią
// pamięciową, bez atrapy `Link` ani `useRouterState`.
//
// PO CO OSOBNY PLIK. `mobileDrawer.test.tsx` podmienia `Link` na zwykłe <a>,
// więc nie widzi rzeczy, które dokleja sam router: `Link` liczy własną
// aktywność (domyślnie po PREFIKSIE ścieżki) i przy trafieniu nadpisuje
// `aria-current` z propsów. Tylko tutaj widać, czy zaznaczenie wizualne
// (klasa) i semantyczne (`aria-current`) mówią to samo, czy idą za nawigacją
// klienta i czy rewrite języka (`/en/...` -> ścieżka kanoniczna) nie gubi
// zaznaczenia czytelnikowi EN.
//
// OKNO MÓWI CO INNEGO NIŻ ROUTER - CELOWO. `beforeEach` stawia `window.location`
// na adresie, którego żadna asercja nie oczekuje. Komponent, który w renderze
// sięgnąłby po okno zamiast po lokalizację routera, zaznaczyłby wtedy złą
// pozycję (albo żadną), a nie przeszedłby testu przypadkiem.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  type LocationRewrite,
} from "@tanstack/react-router";
import "@/lib/i18n";
import "@/lib/i18n-mobile-drawer";
import type { NavItem } from "@/lib/mobileDrawer";
import { stripLangPrefix } from "@/lib/i18n/localePath";

// Menu główne ma własne testy i własne zapytania - tutaj liczy się wyłącznie
// lista pozycji z konfiguracji super-admina.
vi.mock("@/components/menu/SiteMenu", () => ({ SiteMenu: () => null }));

const { MobileNavSection } = await import("../MobileNavSection");

function navItem(id: string, label: string, href: string): NavItem {
  return { id, label_pl: label, label_en: label, href, icon: "link", enabled: true };
}

const ITEMS: NavItem[] = [
  navItem("a", "Analizy", "/analizy"),
  navItem("w", "Wydarzenia", "/wydarzenia"),
  navItem("c", "Cennik", "/cennik"),
];

/** Klasa zaznaczenia pozycji - to, co czytelnik WIDZI jako „tu jestem". */
const ACTIVE_CLASS = "font-semibold";

function mountAt(initialEntry: string, rewrite?: LocationRewrite) {
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <MobileNavSection items={ITEMS} onNavigate={() => {}} />
        <Outlet />
      </>
    ),
  });
  const page = (path: string) =>
    createRoute({ getParentRoute: () => rootRoute, path, component: () => null });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      page("/analizy"),
      page("/wydarzenia"),
      page("/wydarzenia/$slug"),
      page("/cennik"),
    ]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
    rewrite,
  });
  render(<RouterProvider router={router} />);
  return router;
}

/** Etykiety pozycji, które router i komponent uznają za bieżącą stronę. */
function current(): { ariaCurrent: string[]; highlighted: string[] } {
  const links = ITEMS.map((item) => screen.getByRole("link", { name: item.label_pl }));
  return {
    ariaCurrent: links
      .filter((link) => link.getAttribute("aria-current") === "page")
      .map((link) => link.textContent ?? ""),
    highlighted: links
      .filter((link) => link.classList.contains(ACTIVE_CLASS))
      .map((link) => link.textContent ?? ""),
  };
}

let originalUrl = "/";

beforeEach(() => {
  originalUrl = `${window.location.pathname}${window.location.search}`;
  window.history.replaceState({}, "", "/cennik");
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", originalUrl);
});

describe("MobileNavSection z prawdziwym routerem", () => {
  it("na /wydarzenia zaznacza WYŁĄCZNIE Wydarzenia - klasą i aria-current", async () => {
    mountAt("/wydarzenia");
    await screen.findByRole("link", { name: "Wydarzenia" });
    expect(current()).toEqual({ ariaCurrent: ["Wydarzenia"], highlighted: ["Wydarzenia"] });
  });

  it("nawigacja klienta przenosi zaznaczenie bez przemontowania szuflady", async () => {
    const router = mountAt("/wydarzenia");
    await screen.findByRole("link", { name: "Wydarzenia" });

    // `href`, nie `to`: typ `to` liczy się z drzewa tras APLIKACJI
    // (zarejestrowany router), a tu stoi lokalne drzewo testu.
    await act(async () => {
      await router.navigate({ href: "/analizy" });
    });

    expect(current()).toEqual({ ariaCurrent: ["Analizy"], highlighted: ["Analizy"] });
  });

  it("podstrona sekcji NIE udaje bieżącej strony - aria-current zgodne z klasą", async () => {
    // Domyślnie `Link` uznaje się za aktywny po PREFIKSIE ścieżki i dokleja
    // `aria-current="page"` bez pytania komponentu. Pozycja `/wydarzenia` na
    // `/wydarzenia/konferencja` dostawała więc „to jest bieżąca strona" dla
    // czytnika ekranu, choć wizualnie zaznaczona nie była.
    mountAt("/wydarzenia/konferencja-2026");
    await screen.findByRole("link", { name: "Wydarzenia" });
    expect(current()).toEqual({ ariaCurrent: [], highlighted: [] });
  });

  it("czytelnik EN pod /en/... dostaje zaznaczenie - router trzyma ścieżkę kanoniczną", async () => {
    // Rewrite wejścia jak w `src/router.tsx`: prefiks języka znika przed
    // dopasowaniem. Okno nosi `/en/wydarzenia`, więc porównanie z oknem nie
    // trafiało w `href` z konfiguracji NIGDY.
    window.history.replaceState({}, "", "/en/wydarzenia");
    mountAt("/en/wydarzenia", {
      input: ({ url }) => {
        url.pathname = stripLangPrefix(url.pathname).pathname;
        return url;
      },
    });
    await screen.findByRole("link", { name: "Wydarzenia" });
    expect(current()).toEqual({ ariaCurrent: ["Wydarzenia"], highlighted: ["Wydarzenia"] });
  });
});
