// TRASA GIEŁDY SPOTKAŃ 1-1: `/meetings/<slug-wydarzenia>`.
//
// PO CO TESTOWAĆ TRASĘ, A NIE TABLICĘ. Tablica (`MeetingExchangeBoard`) ma
// własne testy; ta trasa stała na 0% pokrycia, a niesie cztery decyzje, których
// tablica nie widzi:
//   1. `ssr: false` - cała treść pochodzi z RPC wołanych jako zalogowany
//      użytkownik, a sesja żyje w `localStorage`. Render serwerowy dawałby
//      zawsze wersję „nie jesteś zalogowany", podmienianą po hydracji,
//   2. `noindex, nofollow` - prywatny terminarz uczestnika nie ma czego robić
//      w wyszukiwarce,
//   3. slug z ADRESU trafia do tablicy, wewnątrz bramki sesji - zgubiony albo
//      nieświeży slug pokazuje terminarz CUDZEGO wydarzenia,
//   4. błąd i nieznany adres kończą się wspólnym ekranem awarii w wariancie
//      kompaktowym, a nie białą stroną.
//
// ATRAPY: `AuthGate` (bramka sesji ma własne testy w `components/profile`),
// `MeetingExchangeBoard` (zapisuje slug, który dostała) i `FriendlyErrorPage`
// (znacznik z wariantem). Trasa jest PRAWDZIWA i zamontowana pod swoim
// wzorcem ścieżki przez `renderRoute`.
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import type { AnyRoute } from "@tanstack/react-router";

const h = vi.hoisted(() => ({
  /** Slugi, z jakimi trasa wyrenderowała tablicę - w kolejności renderów. */
  boardSlugs: [] as string[],
  /** Tablica rzuca przy renderze - do dowodu granicy błędu trasy. */
  boardThrows: false,
}));

vi.mock("@/components/profile/AuthGate", () => ({
  AuthGate: ({ children }: { children: ReactNode }) => (
    <div data-testid="bramka-sesji">{children}</div>
  ),
}));

vi.mock("@/components/events/meetings/MeetingExchangeBoard", () => ({
  MeetingExchangeBoard: ({ slug }: { slug: string }) => {
    if (h.boardThrows) throw new Error("test: awaria tablicy");
    h.boardSlugs.push(slug);
    return <section data-testid="tablica-spotkan" data-slug={slug} />;
  },
}));

vi.mock("@/components/error/FriendlyErrorPage", () => ({
  FriendlyErrorPage: ({ variant }: { variant?: string }) => (
    <div data-testid="ekran-bledu" data-variant={variant ?? ""} />
  ),
}));

import { renderRoute, routeMeta, type RouteMetaEntry } from "@/test/routeHarness";
import { Route } from "@/routes/meetings.$eventSlug";

const PATH = "/meetings/$eventSlug";
const SLUG = "kongres-cee-2026";
const TITLE = "Giełda spotkań 1-1 - New European Strategies";

function mount(slug = SLUG) {
  return renderRoute({ route: Route as AnyRoute, path: PATH, initialEntry: `/meetings/${slug}` });
}

function content(meta: RouteMetaEntry[], key: "name" | "property", value: string): unknown {
  return meta.find((entry) => entry[key] === value)?.content;
}

/** `ssr` z opcji trasy - framework nie wystawia go w typie publicznym odczytu. */
function ssrOf(route: { options: { ssr?: unknown } }): unknown {
  return route.options.ssr;
}

/** STRAŻNIK, nie rzutowanie: opcja trasy musi być komponentem, żeby ją wyrenderować. */
function isComponent(value: unknown): value is () => ReactNode {
  return typeof value === "function";
}

beforeEach(() => {
  h.boardSlugs.length = 0;
  h.boardThrows = false;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("/meetings/$eventSlug - decyzje trasy", () => {
  it("nie renderuje się na serwerze (`ssr: false`) - sesja żyje w localStorage", () => {
    expect(ssrOf(Route)).toBe(false);
  });

  it("nagłówek: tytuł giełdy, opis, og:* i `noindex, nofollow`", async () => {
    const meta = await routeMeta(Route as AnyRoute);

    expect(meta.find((entry) => "title" in entry)?.title).toBe(TITLE);
    expect(content(meta, "name", "robots")).toBe("noindex, nofollow");
    expect(content(meta, "name", "description")).toMatch(/1-1/);
    expect(content(meta, "property", "og:title")).toBe(TITLE);
    expect(content(meta, "property", "og:type")).toBe("website");
    expect(content(meta, "property", "og:description")).toEqual(expect.any(String));
    expect(content(meta, "name", "twitter:card")).toBe("summary");
  });

  it("nagłówek dociera do dopasowania routera pod prawdziwym adresem", async () => {
    const view = await mount();
    await screen.findByTestId("tablica-spotkan");

    expect(content(view.meta(), "name", "robots")).toBe("noindex, nofollow");
    expect(view.meta().find((entry) => "title" in entry)?.title).toBe(TITLE);
  });
});

describe("/meetings/$eventSlug - slug z adresu w tablicy, za bramką sesji", () => {
  it("tablica dostaje slug z adresu i stoi WEWNĄTRZ bramki sesji", async () => {
    await mount();

    const gate = await screen.findByTestId("bramka-sesji");
    const board = within(gate).getByTestId("tablica-spotkan");
    expect(board.getAttribute("data-slug")).toBe(SLUG);
    // Strona ma swój landmark główny - czytnik ekranu wskakuje prosto do terminarza.
    expect(screen.getByRole("main")).toContainElement(gate);
  });

  it("przejście na inne wydarzenie podaje tablicy NOWY slug, nie poprzedni", async () => {
    // Uczestnik kilku wydarzeń przechodzi między terminarzami z linków
    // w mailach; nieświeży slug pokazałby mu spotkania z poprzedniego.
    const view = await mount();
    await screen.findByTestId("tablica-spotkan");

    await act(async () => {
      await view.navigate("/meetings/forum-energii-2026");
    });

    await waitFor(() =>
      expect(screen.getByTestId("tablica-spotkan").getAttribute("data-slug")).toBe(
        "forum-energii-2026",
      ),
    );
    expect(view.currentPath()).toBe("/meetings/forum-energii-2026");
    expect(h.boardSlugs.at(-1)).toBe("forum-energii-2026");
  });
});

describe("/meetings/$eventSlug - ekran awarii", () => {
  it("błąd i nieznany adres to JEDEN wspólny ekran", () => {
    expect(Route.options.errorComponent).toBe(Route.options.notFoundComponent);
  });

  it("ekran awarii to wspólny FriendlyErrorPage w wariancie kompaktowym", () => {
    const errorScreen = Route.options.errorComponent;
    if (!isComponent(errorScreen)) throw new Error("test: trasa nie ma komponentu awarii");

    render(errorScreen());

    expect(screen.getByTestId("ekran-bledu").getAttribute("data-variant")).toBe("compact");
  });

  it("awaria tablicy w trakcie renderu kończy się ekranem awarii trasy, nie białą stroną", async () => {
    // React i router logują przechwycony błąd granicy - oczekiwany szum tego scenariusza.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    h.boardThrows = true;

    await mount();

    const errorScreen = await screen.findByTestId("ekran-bledu");
    expect(errorScreen.getAttribute("data-variant")).toBe("compact");
    expect(screen.queryByTestId("tablica-spotkan")).not.toBeInTheDocument();
  });
});
