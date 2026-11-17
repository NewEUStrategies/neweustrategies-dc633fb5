// @vitest-environment node
//
// KONFIGURACJA POWIĄZANYCH WPISÓW NA SERWERZE - jeden round-trip na izolat
// i minutę, a nie jeden na render.
//
// CO TO DOWODZI. Loader trasy wpisu/strony (`routes/$.tsx`) grzeje tę
// konfigurację przy KAŻDYM renderze SSR. Do 2026-11-14 był to jedyny singleton
// najemcy na tej ścieżce bez `edgeTtlCache`, więc płacił go także ciepły izolat
// (roadmapa ładowania, B2). Przypadki są nazwane po skutku:
//
//   * DWA RENDERY, JEDNO ZAPYTANIE. Dwa żądania (dwa klienty zapytań) w tym
//     samym izolacie dzielą jeden odczyt - to jest cała teza zmiany;
//   * AWARIA NIE ZAMARZA. Odmowa bazy rzuca i NIE trafia do cache: następny
//     render pyta ponownie, zamiast przez minutę serwować domyślne jako
//     „konfigurację najemcy";
//   * BRAK WIERSZA TO DOMYŚLNE - i też jeden odczyt.
//
// JAK. Środowisko `node` (brak `window`), więc `edgeTtlCache` biegnie swoją
// gałęzią serwerową - PRAWDZIWĄ, nie atrapą: przedmiotem dowodu jest to, że
// odczyt naprawdę jest współdzielony. Zaślepiona jest jedna granica: klient
// Supabase. Gałąź przeglądarkową (cache przezroczysty, każdy fetch pyta bazę)
// pokrywa `relatedPosts.test.ts` w happy-dom.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  wywolania: [] as string[],
  odpowiedz: { data: null as unknown, error: null as { message: string } | null },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string) => {
      h.wywolania.push(name);
      return Promise.resolve({ ...h.odpowiedz });
    },
  },
}));

import { relatedPostsConfigQueryOptions } from "@/lib/queries/relatedPostsConfig";
import { RELATED_POSTS_DEFAULTS } from "@/lib/relatedPosts/config";
import { clearEdgeTtlCache } from "@/lib/ssrCache";

/** Świeży klient = osobne żądanie SSR (klient zapytań jest tam per żądanie). */
function zadanie(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

beforeEach(() => {
  clearEdgeTtlCache();
  h.wywolania.length = 0;
  h.odpowiedz = { data: null, error: null };
});

describe("konfiguracja powiązanych na SSR: cache izolatu", () => {
  it("dwa rendery w jednym izolacie płacą JEDEN round-trip", async () => {
    h.odpowiedz = { data: [{ items_limit: 4 }], error: null };

    const pierwszy = await zadanie().fetchQuery(relatedPostsConfigQueryOptions());
    const drugi = await zadanie().fetchQuery(relatedPostsConfigQueryOptions());

    expect(h.wywolania).toEqual(["get_related_posts_config"]);
    expect(pierwszy).toEqual({ ...RELATED_POSTS_DEFAULTS, items_limit: 4 });
    expect(drugi).toEqual(pierwszy);
  });

  it("odmowa bazy RZUCA i nie trafia do cache - następny render pyta ponownie", async () => {
    h.odpowiedz = { data: null, error: { message: "odmowa konfiguracji" } };
    await expect(zadanie().fetchQuery(relatedPostsConfigQueryOptions())).rejects.toMatchObject({
      message: "odmowa konfiguracji",
    });

    h.odpowiedz = { data: [{ items_limit: 6 }], error: null };
    await expect(zadanie().fetchQuery(relatedPostsConfigQueryOptions())).resolves.toMatchObject({
      items_limit: 6,
    });
    expect(h.wywolania).toEqual(["get_related_posts_config", "get_related_posts_config"]);
  });

  it("najemca bez wiersza dostaje domyślne - i też z jednego odczytu", async () => {
    h.odpowiedz = { data: [], error: null };

    await expect(zadanie().fetchQuery(relatedPostsConfigQueryOptions())).resolves.toEqual(
      RELATED_POSTS_DEFAULTS,
    );
    await expect(zadanie().fetchQuery(relatedPostsConfigQueryOptions())).resolves.toEqual(
      RELATED_POSTS_DEFAULTS,
    );
    expect(h.wywolania).toHaveLength(1);
  });
});
