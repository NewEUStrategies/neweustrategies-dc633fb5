// Layouty sekcji CRM: `/admin/crm` i `/admin/companies`.
//
// Oba pliki są dwuliniowe i wyglądają na zbędne, ale robią jedną rzecz, której
// nie widać w kodzie: rozdzielają ścieżkę listy od ścieżki karty, żeby
// `/admin/crm/$id` montowało się w `Outlet` zamiast konkurować z indeksem.
// Test montuje layout RAZEM z dziećmi i sprawdza dokładnie to: pod adresem
// sekcji widać indeks, pod adresem karty - kartę, i nigdy obu naraz.
import { describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  type AnyRoute,
} from "@tanstack/react-router";

import { Route as CrmLayout } from "@/routes/admin.crm";
import { Route as CompaniesLayout } from "@/routes/admin.companies";

interface Wiring {
  id: string;
  path: string;
  getParentRoute: () => AnyRoute;
}

/** Ten sam krok, który w produkcji robi generator `routeTree.gen.ts`. */
function wire<T extends AnyRoute>(route: T, wiring: Wiring): T {
  const update = route.update as unknown as (options: Wiring) => T;
  return update.call(route, wiring);
}

async function mountSection(layout: AnyRoute, basePath: string, entry: string) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const section = wire(layout, {
    id: basePath,
    path: basePath,
    getParentRoute: () => rootRoute,
  });
  const indexRoute = createRoute({
    getParentRoute: () => section,
    path: "/",
    component: () => <div>INDEKS</div>,
  });
  const detailRoute = createRoute({
    getParentRoute: () => section,
    path: "$id",
    component: () => <div>KARTA</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([section.addChildren([indexRoute, detailRoute])]),
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
}

describe("layouty sekcji CRM", () => {
  it("pod adresem sekcji leadów widać indeks listy", async () => {
    await mountSection(CrmLayout, "/admin/crm", "/admin/crm");
    expect(screen.getByText("INDEKS")).toBeInTheDocument();
    expect(screen.queryByText("KARTA")).toBeNull();
    cleanup();
  });

  it("karta leada montuje się pod layoutem, nie zamiast listy", async () => {
    await mountSection(CrmLayout, "/admin/crm", "/admin/crm/abc");
    expect(screen.getByText("KARTA")).toBeInTheDocument();
    expect(screen.queryByText("INDEKS")).toBeNull();
    cleanup();
  });

  it("layout firm zachowuje się tak samo", async () => {
    await mountSection(CompaniesLayout, "/admin/companies", "/admin/companies");
    expect(screen.getByText("INDEKS")).toBeInTheDocument();
    cleanup();
  });

  it("karta firmy montuje się pod layoutem firm", async () => {
    await mountSection(CompaniesLayout, "/admin/companies", "/admin/companies/abc");
    expect(screen.getByText("KARTA")).toBeInTheDocument();
    expect(screen.queryByText("INDEKS")).toBeNull();
    cleanup();
  });
});
