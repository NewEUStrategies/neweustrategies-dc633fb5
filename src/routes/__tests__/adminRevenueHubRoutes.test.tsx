// Cztery trasy huba „Przychód i lejek" (wycinek I0): układ `/admin/revenue`,
// kokpit `/admin/revenue/`, zakładki `/admin/revenue/$tab` i wypięty z układu
// edytor ścieżki `/admin/revenue/journeys/$journeyId`.
//
// CO TEN PLIK DOWODZI. W I0 treść każdej zakładki jest zaślepką, więc
// przedmiotem dowodu jest SKLEJENIE - to, co zostaje po podmianie zaślepek
// przez wycinki S6-S8 i czego żaden test komponentu nie zobaczy:
//
//   1. ADRES. Nieznana zakładka i `overview` (kokpit ma jeden adres - indeks)
//      kończą się 404, a znana montuje SWOJĄ zakładkę z leniwego chunku.
//   2. NAGŁÓWKI. Każda z 4 tras i każda z 10 zakładek ma SEKCYJNY tytuł karty
//      (AGENTS: `adminPageHead` na ekranach admina) - nie ogólne „Admin".
//   3. KONTRAKT ADRESU. Walidator układu i edytora zostawia poprawne
//      parametry, a śmieci odrzuca, zanim dotkną zapytań; dzieci układu
//      dziedziczą jego wynik.
//   4. ROLA HUBA. Layout `/admin` przepuszcza cały personel; autor dostaje
//      powiadomienie zamiast treści, admin i redaktor - zakładkę. Sam
//      `super_admin` (bez wiersza `admin`) też dostaje powiadomienie: polityki
//      huba go nie wpuszczają, więc zakładka byłaby pusta. Przed hydratacją
//      serwer i klient rysują ten sam stan „wczytywanie".
//   5. LEKKOŚĆ POWŁOK. Pliki tras jadą w chunku wejściowym każdej strony,
//      więc importują wyłącznie liście (walidatory, `adminPageHead`) i
//      komponenty podane w `component` - bez słownika, Supabase i zod.
//
// ATRAPOWANA JEST TYLKO SESJA (`useAuth`). Słownik jest PRAWDZIWY: asercje
// mierzą napis, który zobaczy admin, a zniknięcie klucza oblewa test.
import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen, within } from "@testing-library/react";
import { Outlet, createRootRouteWithContext, type AnyRoute } from "@tanstack/react-router";

import type { Role } from "@/hooks/useAuth";

const h = vi.hoisted(() => ({
  auth: { isAdmin: false, roles: [] as Role[] },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import "@/lib/i18n-admin-revenue";
import {
  renderRoute,
  routeHead,
  routeMeta,
  routeSearchValidator,
  type RouteHarnessContext,
  type RouteMetaEntry,
} from "@/test/routeHarness";
import { axeViolations, summarize } from "@/test/axe";
import { zaleznosciTrasy } from "@/test/routeSourceImports";
import { isCompactSidebarRoute } from "@/lib/admin/adminNav";
import { REVENUE_TABS } from "@/lib/revenue/search";
import { RevenueHubLayout } from "@/components/admin/revenue/organisms/RevenueHubLayout";
import { Route as LayoutRoute } from "@/routes/admin.revenue";
import { Route as IndexRoute } from "@/routes/admin.revenue.index";
import { Route as TabRoute } from "@/routes/admin.revenue.$tab";
import { Route as EditorRoute } from "@/routes/admin.revenue_.journeys.$journeyId";

const HUB = "/admin/revenue";
const EDITOR = "/admin/revenue/journeys/$journeyId";
const SUFFIX = " | New European Strategies";
const HUB_TABS = REVENUE_TABS.filter((tab) => tab !== "overview");

const ROLES = {
  admin: { isAdmin: true, roles: ["admin"] },
  editor: { isAdmin: false, roles: ["editor"] },
  author: { isAdmin: false, roles: ["author"] },
  // `useAuth` liczy `super_admin` do `isAdmin` - dokładnie ten przypadek, który
  // bramka UI ma odrzucić, bo baza (has_role admin) go nie wpuszcza.
  super_admin: { isAdmin: true, roles: ["super_admin"] },
  super_admin_with_admin: { isAdmin: true, roles: ["super_admin", "admin"] },
} as const satisfies Record<string, { isAdmin: boolean; roles: readonly Role[] }>;

function asRole(role: keyof typeof ROLES): void {
  h.auth = { isAdmin: ROLES[role].isAdmin, roles: [...ROLES[role].roles] };
}

beforeEach(async () => {
  asRole("admin");
  await i18n.changeLanguage("pl");
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
});

// ---------------------------------------------------------------------------
// Montaż drzewa huba
// ---------------------------------------------------------------------------

/** Podpięcie trasy pod rodzica - te same trzy pola, które ustawia generator drzewa. */
interface RouteWiring {
  id: string;
  path: string;
  getParentRoute: () => AnyRoute;
}

/**
 * `update()` scala w runtime CAŁE opcje trasy (tak używa go `routeTree.gen.ts`),
 * ale w typach przyjmuje tylko podzbiór „aktualizowalny" - zawężamy sygnaturę
 * strukturalnie, jak `wireToParent` w `src/test/routeHarness.tsx`.
 */
function wire(route: AnyRoute, wiring: RouteWiring): AnyRoute {
  const update = route.update as unknown as (options: RouteWiring) => AnyRoute;
  return update.call(route, wiring);
}

/**
 * PRAWDZIWE dzieci układu (kokpit i `$tab`) pod prawdziwym układem - dokładnie
 * tak, jak wiesza je `routeTree.gen.ts`. Korzeń ma własną stronę 404, żeby
 * odmowę zakładki dało się zobaczyć jako ekran, a nie jako brak treści.
 */
async function mountHub(entry: string) {
  const layout: AnyRoute = LayoutRoute;
  layout.addChildren([
    wire(IndexRoute, { id: "/", path: "/", getParentRoute: () => layout }),
    wire(TabRoute, { id: "/$tab", path: "/$tab", getParentRoute: () => layout }),
  ]);
  const rootRoute = createRootRouteWithContext<RouteHarnessContext>()({
    component: () => <Outlet />,
    notFoundComponent: () => <p data-testid="not-found">404</p>,
  });
  return renderRoute({ route: layout, path: HUB, initialEntry: entry, rootRoute });
}

function title(meta: RouteMetaEntry[]): unknown {
  return meta.find((entry) => "title" in entry)?.title;
}

function named(meta: RouteMetaEntry[], value: string): unknown {
  return meta.find((entry) => entry.name === value || entry.property === value)?.content;
}

/** Komplet nagłówka ekranu admina: sekcyjny tytuł, opis, og:* i `noindex`. */
function expectAdminHead(meta: RouteMetaEntry[], section: string): void {
  expect(title(meta)).toBe(`${section}${SUFFIX}`);
  expect(named(meta, "og:title")).toBe(`${section}${SUFFIX}`);
  expect(String(named(meta, "description")).length).toBeGreaterThan(40);
  expect(named(meta, "og:description")).toBe(named(meta, "description"));
  expect(named(meta, "robots")).toBe("noindex, nofollow");
}

// ---------------------------------------------------------------------------
// 1. Adres
// ---------------------------------------------------------------------------

describe("adres zakładki - znana montuje swoją treść, reszta to 404", () => {
  it("indeks huba montuje KOKPIT pod nagłówkiem huba", async () => {
    await mountHub(HUB);

    const overview = await screen.findByTestId("revenue-tab-overview");
    expect(
      await within(overview).findByRole("heading", { level: 2, name: "Najważniejsze wskaźniki" }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: "Przychód i lejek" })).toBeVisible();
  });

  it.each(HUB_TABS)("/admin/revenue/%s montuje WŁASNĄ zakładkę z leniwego chunku", async (tab) => {
    const view = await mountHub(`${HUB}/${tab}`);

    expect(await screen.findByTestId(`revenue-tab-${tab}`)).toBeInTheDocument();
    // Dokładnie jedna zakładka - mapa nie może montować kokpitu „przy okazji".
    expect(screen.getAllByTestId(/^revenue-tab-/)).toHaveLength(1);
    expect(view.currentPath()).toBe(`${HUB}/${tab}`);
  });

  it.each(["nope", "overview", "MRR"])("/admin/revenue/%s kończy się stroną 404", async (tab) => {
    // `overview` też: kokpit ma jeden adres (indeks), a duplikat rozjechałby
    // historię i odnośniki. Wielkość liter się liczy - adres to identyfikator.
    await mountHub(`${HUB}/${tab}`);

    expect(await screen.findByTestId("not-found")).toBeInTheDocument();
    expect(screen.queryByTestId(/^revenue-tab-/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Nagłówki
// ---------------------------------------------------------------------------

describe("nagłówki - sekcyjne na każdej trasie i każdej zakładce", () => {
  it("układ, kokpit i edytor mają własne tytuły sekcji", async () => {
    expectAdminHead(await routeMeta(LayoutRoute), "Przychód i lejek");
    expectAdminHead(await routeMeta(IndexRoute), "Przychód i lejek - kokpit");
    expectAdminHead(await routeMeta(EditorRoute), "Ścieżka komunikacji - edytor");
  });

  it("każda z 10 zakładek ma INNY, sekcyjny tytuł huba", () => {
    const titles = HUB_TABS.map((tab) => {
      const meta = routeHead(TabRoute, { params: { tab } }).meta ?? [];
      const section = String(title(meta)).replace(SUFFIX, "");
      expect(section, tab).toMatch(/^Przychód i lejek - \S/);
      expectAdminHead(meta, section);
      return section;
    });
    // Dwie zakładki z tym samym tytułem to dwie karty przeglądarki, których
    // admin nie odróżni - kopiuj-wklej w mapie `HEADS` ma się tu zapalić.
    expect(new Set(titles).size).toBe(HUB_TABS.length);
    expect(titles).not.toContain("Przychód i lejek - kokpit");
  });

  it("adres odrzucony nie wywraca `head()` - karta dostaje tytuł huba", () => {
    for (const tab of ["nope", "overview"]) {
      expectAdminHead(routeHead(TabRoute, { params: { tab } }).meta ?? [], "Przychód i lejek");
    }
  });

  it("zamontowana zakładka oddaje routerowi SWÓJ nagłówek, nie nagłówek układu", async () => {
    const view = await mountHub(`${HUB}/retention`);
    await screen.findByTestId("revenue-tab-retention");

    expectAdminHead(view.meta(), "Przychód i lejek - retencja");
  });
});

// ---------------------------------------------------------------------------
// 3. Kontrakt adresu
// ---------------------------------------------------------------------------

describe("walidatory adresu - poprawne zostają, śmieci odpadają", () => {
  it("układ huba zachowuje komplet poprawnych parametrów", () => {
    const valid = {
      w: "custom",
      from: "2026-01-01",
      to: "2026-03-31",
      cur: "EUR",
      seg: "b2c_reduced",
      track: "sales",
      sec: "clubs",
      view: "map",
      status: "paused",
      q: "rabat studencki",
      metric: "net_revenue_retention",
      new: "1",
    };

    expect(routeSearchValidator(LayoutRoute)(valid)).toEqual(valid);
  });

  it("układ huba odrzuca wartości spoza kontraktu i nie przepuszcza nieznanych kluczy", () => {
    const parsed = routeSearchValidator(LayoutRoute)({
      w: "decade",
      from: "2026-02-30",
      cur: "eur",
      seg: "vip",
      track: "partners",
      metric: "<script>",
      q: "x".repeat(201),
      evil: "1",
    });

    // Znany klucz z odrzuconą wartością wraca jako jawne `undefined` (router
    // składa wynik z surowym adresem), nieznany nie pojawia się wcale.
    for (const key of ["w", "from", "cur", "seg", "track", "metric", "q"]) {
      expect(parsed[key], key).toBeUndefined();
    }
    expect(parsed).not.toHaveProperty("evil");
  });

  it("zakładka dziedziczy zwalidowane parametry układu, bez odrzuconych", async () => {
    // Po odrzuceniu wartości router porządkuje adres osobnym przejściem -
    // montaż w `act`, żeby test oglądał stan PO tym przejściu.
    const view = await act(() => mountHub(`${HUB}/funnel?w=quarter&track=sales&seg=vip`));
    await screen.findByTestId("revenue-tab-funnel");

    // Surowe `vip` nie dociera do komponentu, który ma typ `RevenueSegment`.
    expect(view.search()).toEqual({ w: "quarter", track: "sales" });
  });

  it("edytor ścieżki ma własny kontrakt: widok, węzeł, panel, okno statystyk, wersja", () => {
    const validate = routeSearchValidator(EditorRoute);
    const valid = {
      view: "results",
      node: "send_email_2",
      tab: "contacts",
      stats: "ltm",
      version: 3,
    };

    expect(validate(valid)).toEqual(valid);
    expect(validate({ view: "graph", node: "a b", tab: "x", stats: "decade", version: 0 })).toEqual(
      {
        view: undefined,
        node: undefined,
        tab: undefined,
        stats: undefined,
        version: undefined,
      },
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Rola huba i hydratacja
// ---------------------------------------------------------------------------

describe("rola huba - autor dostaje powiadomienie, admin i redaktor zakładkę", () => {
  it.each(["admin", "editor", "super_admin_with_admin"] as const)(
    "%s widzi zakładkę pod nagłówkiem huba",
    async (role) => {
      asRole(role);
      await mountHub(`${HUB}/metrics`);

      expect(await screen.findByTestId("revenue-tab-metrics")).toBeInTheDocument();
      expect(screen.queryByTestId("revenue-role-gate")).toBeNull();
    },
  );

  it("sam super_admin (bez wiersza admin) dostaje powiadomienie - UI = bramka SQL", async () => {
    // `isAdmin` jest tu `true`, a polityki huba pytają `has_role(…, 'admin')`:
    // zakładka pokazałaby 0 MRR i pusty lejek jak prawdziwy brak przychodu.
    asRole("super_admin");
    await mountHub(`${HUB}/mrr`);

    expect(await screen.findByTestId("revenue-role-gate")).toBeInTheDocument();
    expect(screen.queryByTestId(/^revenue-tab-/)).toBeNull();
  });

  it("autor dostaje powiadomienie zamiast treści - nagłówek zostaje, zakładka nie", async () => {
    asRole("author");
    await mountHub(`${HUB}/mrr`);

    const gate = await screen.findByTestId("revenue-role-gate");
    expect(gate).toHaveAttribute("role", "status");
    expect(gate).toHaveTextContent("dostępny dla administratorów i redaktorów");
    expect(screen.getByRole("heading", { level: 1, name: "Przychód i lejek" })).toBeVisible();
    expect(screen.queryByTestId(/^revenue-tab-/)).toBeNull();
  });

  it("przed hydratacją serwer rysuje wyłącznie stan „wczytywanie” - bez treści zależnej od roli", () => {
    // `renderToString` to render serwerowy: `useHydrated()` jest tam `false`.
    // Gdyby układ pokazał tu nagłówek albo bramkę roli, znacznik z serwera
    // rozjechałby się z pierwszym renderem klienta dla innej roli.
    for (const role of ["admin", "author"] as const) {
      asRole(role);
      const html = renderToString(<RevenueHubLayout />);

      expect(html, role).toContain('role="status"');
      expect(html, role).toContain("Wczytywanie sekcji…");
      expect(html, role).not.toContain("<h1");
      expect(html, role).not.toContain("revenue-role-gate");
    }
  });

  it("wersja angielska mówi po angielsku (słownik huba jest wpięty)", async () => {
    await i18n.changeLanguage("en");
    await mountHub(`${HUB}/offer`);

    const offer = await screen.findByTestId("revenue-tab-offer");
    expect(
      await within(offer).findByRole("heading", { level: 2, name: "Offer matrix" }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: "Revenue and funnel" })).toBeVisible();
  });

  it("układ i bramka roli nie mają naruszeń dostępności", async () => {
    const hub = await mountHub(`${HUB}/access`);
    await screen.findByTestId("revenue-tab-access");
    expect(summarize(await axeViolations(hub.container))).toBe("");
    cleanup();

    asRole("author");
    const gated = await mountHub(`${HUB}/access`);
    await screen.findByTestId("revenue-role-gate");
    expect(summarize(await axeViolations(gated.container))).toBe("");
  });
});

describe("edytor ścieżki - wypięty z układu, z własną bramką roli", () => {
  it("dostaje identyfikator ścieżki i zwalidowany adres z powłoki trasy", async () => {
    asRole("editor");
    await renderRoute({
      route: EditorRoute,
      path: EDITOR,
      initialEntry: "/admin/revenue/journeys/welcome-series?view=list&version=oops",
    });

    const editor = await screen.findByTestId("journey-editor");
    expect(editor).toHaveAttribute("data-journey-id", "welcome-series");
    expect(editor).toHaveAttribute("data-view", "list");
    expect(editor).toHaveTextContent("Ta sekcja huba jest w przygotowaniu.");
    // Wypięty z układu: bez nagłówka huba nad kanwą.
    expect(screen.queryByRole("heading", { name: "Przychód i lejek" })).toBeNull();
  });

  it.each(["author", "super_admin"] as const)(
    "%s dostaje to samo powiadomienie co w hubie - nie zaślepkę edytora",
    async (role) => {
      asRole(role);
      await renderRoute({
        route: EditorRoute,
        path: EDITOR,
        initialEntry: "/admin/revenue/journeys/x",
      });

      expect(await screen.findByTestId("revenue-role-gate")).toBeInTheDocument();
      expect(screen.queryByTestId("journey-editor")).toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------
// 5. Nawigacja i lekkość powłok
// ---------------------------------------------------------------------------

describe("pasek boczny - zwinięty wyłącznie na kanwie edytora", () => {
  it("edytor ścieżki startuje ze zwiniętym paskiem, lista i hub - z pełnym", () => {
    expect(isCompactSidebarRoute("/admin/revenue/journeys/abc")).toBe(true);
    expect(isCompactSidebarRoute("/admin/revenue/journeys")).toBe(false);
    expect(isCompactSidebarRoute("/admin/revenue")).toBe(false);
    expect(isCompactSidebarRoute("/admin/revenue/funnel")).toBe(false);
    expect(isCompactSidebarRoute("/admin/revenue/journeys/abc/results")).toBe(false);
  });

  it("dotychczasowe trasy kompaktowe działają bez zmian", () => {
    expect(isCompactSidebarRoute("/admin/posts/123")).toBe(true);
    expect(isCompactSidebarRoute("/admin/appearance/fonts")).toBe(true);
    expect(isCompactSidebarRoute("/admin/posts")).toBe(false);
  });
});

describe("powłoki tras huba importują wyłącznie liście", () => {
  // Powłoka trasy (`createFileRoute` + `validateSearch` + `head` +
  // `beforeLoad`) jedzie w chunku wejściowym KAŻDEJ strony; splitter wynosi
  // tylko `component`. Lista dozwolonych importów jest więc granicą bundla
  // czytelnika: słownik i18n, Supabase albo zod dopisane tutaj trafiłyby do
  // pierwszego wejścia na stronę główną.
  const ALLOWED = new Set([
    "@tanstack/react-router",
    "@/lib/adminPageHead",
    "@/lib/revenue/search",
    "@/lib/journeys/editorSearch",
    // Komponenty podane w `component` - splitter wynosi je do chunków tras.
    "@/components/admin/revenue/organisms/RevenueHubLayout",
    "@/components/admin/revenue/tabs/RevenueOverviewTab",
    "@/components/admin/revenue/tabs/RevenueTabOutlet",
    "@/components/admin/journeys/editor/JourneyEditorRoute",
  ]);
  const FILES = [
    "src/routes/admin.revenue.tsx",
    "src/routes/admin.revenue.index.tsx",
    "src/routes/admin.revenue.$tab.tsx",
    "src/routes/admin.revenue_.journeys.$journeyId.tsx",
  ];

  it.each(FILES)("%s", (file) => {
    const { statyczne, pozaHandlerem } = zaleznosciTrasy(file, readFileSync(file, "utf8"));

    expect(statyczne.length, "parser nie widzi importów - pomiar byłby pusty").toBeGreaterThan(1);
    expect(statyczne.filter((spec) => !ALLOWED.has(spec))).toEqual([]);
    expect(pozaHandlerem, "dynamiczny import w powłoce trasy").toEqual([]);
  });
});
