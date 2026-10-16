// TRZY TRASY-PANELE: `/admin/newsletter/outbox`, `/admin/members`, `/profile/tickets`.
//
// CO TEN PLIK DOWODZI I DLACZEGO. Każda z tych tras to jedna linia sklejenia
// adresu z gotowym panelem - i wszystkie trzy stały na 0% pokrycia bez
// własnego `head()`. Karta przeglądarki i historia pokazywały wtedy tytuł
// rodzica: ogólne „Admin" (layout `/admin`) albo „Profil - Mój panel" (layout
// `/profile`), więc operator z kilkoma kartami panelu i uczestnik wracający
// z historii nie widzieli, gdzie są. AGENTS.md wymaga na prywatnych ekranach
// admina SEKCYJNYCH metadanych przez wspólne `adminPageHead`, a strony profilu
// z własną treścią mają nagłówek w kształcie `/profile/invoices`.
//
// Dowodzimy:
//   1. że `component` to DOKŁADNIE panel z importu (a nie opakowanie, które
//      zgubiłoby jego bramki i stany),
//   2. że `head()` daje tytuł sekcji, opis i og:*,
//   3. że ten nagłówek dociera do dopasowania routera - to, co czyta
//      `<HeadContent/>` - po zamontowaniu trasy pod jej prawdziwym adresem,
//   4. że dokument każdej z trzech stron niesie `noindex, nofollow`: ekrany
//      admina deklarują go same (`adminPageHead`), a `/profile/tickets`
//      dziedziczy go po layoucie `/profile` - jak `/profile/events`. Literalny
//      `noindex` w statycznej trasie profilu wymaga wpisu w
//      `NOINDEX_CODE_ROUTE_PATHS` (bramka `noindexCodeRoutes.test.ts`), więc
//      podstrona go nie powtarza, a my dowodzimy, że i tak trafia do dokumentu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Wnętrza paneli mają własne testy
// (`emailOutboxPanel.test.tsx`, `membersDirectoryPanel.test.tsx`,
// `ParticipantTicketsPanel.test.tsx`); tutaj stoją atrapy-znaczniki.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import {
  HeadContent,
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  type AnyRoute,
} from "@tanstack/react-router";

vi.mock("@/components/admin/newsletter/outbox/EmailOutboxPanel", () => ({
  EmailOutboxPanel: () => <section data-testid="panel-outbox" />,
}));
vi.mock("@/components/admin/members/MembersDirectoryPanel", () => ({
  MembersDirectoryPanel: () => <section data-testid="panel-members" />,
}));
vi.mock("@/components/profile/ParticipantTicketsPanel", () => ({
  ParticipantTicketsPanel: () => <section data-testid="panel-tickets" />,
}));

import { renderRoute, routeMeta, type RouteMetaEntry } from "@/test/routeHarness";
import { EmailOutboxPanel } from "@/components/admin/newsletter/outbox/EmailOutboxPanel";
import { MembersDirectoryPanel } from "@/components/admin/members/MembersDirectoryPanel";
import { ParticipantTicketsPanel } from "@/components/profile/ParticipantTicketsPanel";
import { Route as OutboxRoute } from "@/routes/admin.newsletter.outbox";
import { Route as MembersRoute } from "@/routes/admin.members";
import { Route as TicketsRoute } from "@/routes/profile.tickets";
import { Route as ProfileLayoutRoute } from "@/routes/profile";

afterEach(() => {
  cleanup();
});

function title(meta: RouteMetaEntry[]): unknown {
  return meta.find((entry) => "title" in entry)?.title;
}

function named(meta: RouteMetaEntry[], key: "name" | "property", value: string): unknown {
  return meta.find((entry) => entry[key] === value)?.content;
}

/** Komplet nagłówka sekcji: tytuł, opis, og:*; `robots` - własny albo z layoutu. */
function expectSectionHead(
  meta: RouteMetaEntry[],
  expected: { title: string; robots: string | undefined },
): void {
  expect(title(meta)).toBe(expected.title);
  expect(named(meta, "property", "og:title")).toBe(expected.title);
  expect(named(meta, "name", "description")).toEqual(expect.any(String));
  expect(String(named(meta, "name", "description")).length).toBeGreaterThan(40);
  expect(named(meta, "property", "og:description")).toEqual(expect.any(String));
  expect(named(meta, "property", "og:type")).toBe("website");
  expect(named(meta, "name", "twitter:card")).toBe("summary");
  expect(named(meta, "name", "robots")).toBe(expected.robots);
}

const cases = [
  {
    name: "/admin/newsletter/outbox",
    route: OutboxRoute as AnyRoute,
    panel: EmailOutboxPanel,
    testId: "panel-outbox",
    title: "Email outbox | New European Strategies",
    // Ekran admina deklaruje `noindex` sam - wspólne `adminPageHead`.
    robots: "noindex, nofollow",
    // Tytuł rodzica, który bez własnego `head()` lądował w karcie.
    parentTitle: "Admin",
  },
  {
    name: "/admin/members",
    route: MembersRoute as AnyRoute,
    panel: MembersDirectoryPanel,
    testId: "panel-members",
    title: "Members | New European Strategies",
    robots: "noindex, nofollow",
    parentTitle: "Admin",
  },
  {
    name: "/profile/tickets",
    route: TicketsRoute as AnyRoute,
    panel: ParticipantTicketsPanel,
    testId: "panel-tickets",
    title: "Moje zgłoszenia - New European Strategies",
    // Brak WŁASNEGO `robots` - `noindex` daje layout (dowód niżej). Wpis
    // `index` tutaj nadpisałby go w dokumencie, więc pole ma być puste.
    robots: undefined,
    parentTitle: "Profil - Mój panel",
  },
] as const;

describe.each(cases)("$name - sklejenie trasy z panelem", (c) => {
  it("komponent trasy to DOKŁADNIE panel z importu", () => {
    expect(c.route.options.component).toBe(c.panel);
  });

  it("head() daje SEKCYJNY tytuł, opis i og:* - nie tytuł rodzica", async () => {
    const meta = await routeMeta(c.route);

    expectSectionHead(meta, c);
    expect(title(meta)).not.toBe(c.parentTitle);
  });

  it("zamontowana pod swoim adresem renderuje panel i oddaje routerowi ten nagłówek", async () => {
    const view = await renderRoute({ route: c.route, path: c.name, initialEntry: c.name });

    expect(await screen.findByTestId(c.testId)).toBeInTheDocument();
    expectSectionHead(view.meta(), c);
  });
});

describe("treść opisów odpowiada sekcji", () => {
  // Opis to drugie, po tytule, miejsce, w którym ogólnik („panel") nie mówi
  // nic. Sprawdzamy słowa-klucze sekcji, nie całe zdania.
  it("skrzynka wysyłek mówi o statusie i powodzie niepowodzenia", async () => {
    const description = String(
      named(await routeMeta(OutboxRoute as AnyRoute), "name", "description"),
    );

    expect(description).toMatch(/status/i);
    expect(description).toMatch(/fail/i);
  });

  it("katalog członków mówi o planach i płatnościach", async () => {
    const description = String(
      named(await routeMeta(MembersRoute as AnyRoute), "name", "description"),
    );

    expect(description).toMatch(/plan/i);
    expect(description).toMatch(/payment/i);
  });

  it("zgłoszenia uczestnika mówią o wydarzeniach, płatnościach i zwrotach", async () => {
    const description = String(
      named(await routeMeta(TicketsRoute as AnyRoute), "name", "description"),
    );

    expect(description).toMatch(/wydarzeni/i);
    expect(description).toMatch(/płatności/i);
    expect(description).toMatch(/zwrot/i);
  });
});

describe("/profile/tickets - `noindex` przychodzi z layoutu /profile", () => {
  it("drzewo tras wiesza /profile/tickets pod layoutem /profile", () => {
    // Bez tego rodzica podstrona nie dostałaby ani bramki sesji, ani `noindex`
    // layoutu - a sama ich nie deklaruje.
    expect(readFileSync("src/routeTree.gen.ts", "utf8")).toMatch(
      /ProfileTicketsRouteImport\.update\(\{[^}]*getParentRoute: \(\) => ProfileRoute,/,
    );
  });

  it("layout /profile deklaruje `noindex, nofollow`", async () => {
    const meta = await routeMeta(ProfileLayoutRoute as AnyRoute);

    expect(named(meta, "name", "robots")).toBe("noindex, nofollow");
  });

  it("dokument podstrony ma JEJ tytuł i `noindex` layoutu (scalanie `<HeadContent/>`)", async () => {
    // Prawdziwe nagłówki obu tras w prawdziwym routerze: podstrona nadpisuje
    // tytuł, a meta, której nie deklaruje (`robots`), zostaje po rodzicu.
    const layoutMeta = await routeMeta(ProfileLayoutRoute as AnyRoute);
    const ticketsMeta = await routeMeta(TicketsRoute as AnyRoute);
    const root = createRootRoute({
      component: () => (
        <>
          <HeadContent />
          <Outlet />
        </>
      ),
    });
    const layout = createRoute({
      getParentRoute: () => root,
      path: "/profile",
      head: () => ({ meta: layoutMeta }),
      component: Outlet,
    });
    const tickets = createRoute({
      getParentRoute: () => layout,
      path: "/tickets",
      head: () => ({ meta: ticketsMeta }),
      component: ParticipantTicketsPanel,
    });
    const router = createRouter({
      routeTree: root.addChildren([layout.addChildren([tickets])]),
      history: createMemoryHistory({ initialEntries: ["/profile/tickets"] }),
    });
    await router.load();

    render(<RouterProvider router={router} />);

    expect(await screen.findByTestId("panel-tickets")).toBeInTheDocument();
    await waitFor(() =>
      expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
        "noindex, nofollow",
      ),
    );
    expect(document.querySelectorAll('meta[name="robots"]')).toHaveLength(1);
    expect(document.querySelector("title")?.textContent).toBe(
      "Moje zgłoszenia - New European Strategies",
    );
  });
});
