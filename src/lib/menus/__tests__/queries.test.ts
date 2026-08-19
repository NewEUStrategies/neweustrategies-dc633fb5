// Kontrakt cache'u menu. Wygląda błaho, a decyduje o dwóch rzeczach naraz:
//   1. IZOLACJI - dwa menu (np. „main" i „footer") nie mogą dzielić wpisu
//      w cache, bo nagłówek pokazałby pozycje stopki (albo odwrotnie),
//   2. LICZBIE ZAPYTAŃ - menu jest grzane w loaderze ROOTA, czyli na KAŻDEJ
//      trasie z chrome. Zbyt krótka świeżość zamienia to w zapytanie na każde
//      przejście między stronami.
import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ getMenu: [] as unknown[], listMenus: 0 }));

vi.mock("../menu.functions", () => ({
  // Server fn nie da się wywołać bez kontekstu żądania frameworka - tu liczy
  // się wyłącznie to, CO query options do niej przekazują.
  getMenuWithItems: (input: unknown) => {
    calls.getMenu.push(input);
    return Promise.resolve(null);
  },
  listMenus: () => {
    calls.listMenus += 1;
    return Promise.resolve([]);
  },
}));

const { menuWithItemsQueryOptions, menusListQueryOptions } = await import("../queries");

describe("menuWithItemsQueryOptions", () => {
  it("każdy klucz menu ma WŁASNY wpis w cache", () => {
    expect(menuWithItemsQueryOptions("main").queryKey).toEqual(["menu-with-items", "main"]);
    expect(menuWithItemsQueryOptions("footer").queryKey).toEqual(["menu-with-items", "footer"]);
  });

  it("przekazuje klucz do server fn w kształcie, jakiego oczekuje walidator", () => {
    calls.getMenu = [];
    void menuWithItemsQueryOptions("main").queryFn!({} as never);
    expect(calls.getMenu).toEqual([{ data: { key: "main" } }]);
  });

  it("świeżość 10 minut, cache godzina - struktura menu zmienia się rzadko", () => {
    const options = menuWithItemsQueryOptions("main");
    expect(options.staleTime).toBe(10 * 60_000);
    expect(options.gcTime).toBe(60 * 60_000);
  });
});

describe("menusListQueryOptions", () => {
  it("ma stały klucz i te same okna czasu co pozycje", () => {
    expect(menusListQueryOptions.queryKey).toEqual(["menus-list"]);
    expect(menusListQueryOptions.staleTime).toBe(10 * 60_000);
    expect(menusListQueryOptions.gcTime).toBe(60 * 60_000);
  });

  it("queryFn woła listę menu", async () => {
    calls.listMenus = 0;
    await menusListQueryOptions.queryFn!({} as never);
    expect(calls.listMenus).toBe(1);
  });
});
