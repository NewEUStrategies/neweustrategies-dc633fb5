// TRASA MENEDŻERA MENU. Do 19.08.2026 na zerze.
//
// Trasa jest cienka, ale rozstrzyga jedną rzecz, której nie widać w samym
// menedżerze: KTÓRE menu jest edytowane. W bazie może stać kilka menu (główne,
// stopki, mobilne), a menedżer dostaje pojedynczy klucz. Podanie mu cudzego
// klucza otwiera ekran, który wygląda poprawnie i zapisuje pozycje do złego
// menu - efekt widać dopiero w nagłówku publicznej strony.
//
// Druga reguła to ZASTĘPCZY klucz: pusta lista menu (świeża instalacja) nie może
// zostawić menedżera bez klucza, bo wtedy nie da się utworzyć pierwszego menu.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { AnyRoute } from "@tanstack/react-router";

const h = vi.hoisted(() => ({
  menus: [] as { id: string; key: string; name: string }[],
  managerKeys: [] as string[],
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: h.menus }),
}));
vi.mock("@/lib/menus/queries", () => ({ menusListQueryOptions: { queryKey: ["menus"] } }));
vi.mock("@/components/admin/menu/MenuManager", () => ({
  MenuManager: ({ menuKey }: { menuKey: string }) => {
    h.managerKeys.push(menuKey);
    return <div data-testid="menedzer">{menuKey}</div>;
  },
}));

import { Route } from "@/routes/admin.appearance.menu";

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function setup() {
  const Component = (Route as AnyRoute).options.component as () => ReactNode;
  return render(<Component />, { wrapper });
}

const wybor = () => screen.getByRole("combobox");

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.menus = [
    { id: "1", key: "main", name: "Menu główne" },
    { id: "2", key: "footer", name: "Menu stopki" },
  ];
  h.managerKeys.length = 0;
});

describe("trasa menu - wybór edytowanego menu", () => {
  it("startuje od menu GŁÓWNEGO", () => {
    // To ono stoi w nagłówku każdej strony - domyślnie edytuje się właśnie je.
    setup();
    expect(h.managerKeys.at(-1)).toBe("main");
  });

  it("oferuje wybór KAŻDEGO menu z bazy", () => {
    setup();
    fireEvent.keyDown(wybor(), { key: "ArrowDown" });

    expect(screen.getAllByRole("option")).toHaveLength(h.menus.length);
  });

  it("opcja pokazuje nazwę ORAZ klucz", () => {
    // Dwa menu bywają nazwane podobnie („Menu główne”, „Menu główne EN”);
    // klucz jest jedynym jednoznacznym rozróżnieniem.
    setup();
    fireEvent.keyDown(wybor(), { key: "ArrowDown" });
    const opcje = screen.getAllByRole("option").map((o) => o.textContent);

    expect(opcje[0]).toContain("Menu główne");
    expect(opcje[0]).toContain("main");
  });

  it("zmiana wyboru przekazuje menedżerowi NOWY klucz", () => {
    setup();
    fireEvent.keyDown(wybor(), { key: "ArrowDown" });
    fireEvent.click(screen.getAllByRole("option")[1]);

    expect(h.managerKeys.at(-1)).toBe("footer");
  });
});

describe("trasa menu - stany brzegowe listy", () => {
  it("PUSTA baza dostaje zastępcze menu główne", () => {
    // Bez klucza menedżer nie ma czego edytować i nie da się utworzyć
    // pierwszego menu na świeżej instalacji.
    h.menus = [];
    setup();

    expect(h.managerKeys.at(-1)).toBe("main");
    expect(screen.getByTestId("menedzer")).toHaveTextContent("main");
  });

  it("wybór wskazujący na NIEISTNIEJĄCE menu spada na pierwsze z listy", () => {
    // Menu skasowane w innej karcie zostawia w stanie martwy klucz; ekran ma
    // pokazać cokolwiek edytowalnego zamiast pustki.
    h.menus = [{ id: "9", key: "footer", name: "Menu stopki" }];
    setup();

    expect(h.managerKeys.at(-1)).toBe("footer");
  });

  it("menedżer jest montowany OD NOWA przy zmianie menu", () => {
    // Wspólna instancja przeniosłaby niezapisany stan pozycji do cudzego menu.
    setup();
    fireEvent.keyDown(wybor(), { key: "ArrowDown" });
    fireEvent.click(screen.getAllByRole("option")[1]);

    expect(h.managerKeys).toContain("main");
    expect(h.managerKeys.at(-1)).toBe("footer");
  });
});
