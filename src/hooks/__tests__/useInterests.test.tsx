// Zainteresowania: katalog, wybór gościa, wybór zalogowanego, RÓŻNICA zapisu.
//
// CO TEN PLIK DOWODZI. `useInterests.ts` zasila cztery powierzchnie
// (`/profile/interests`, widget „Dołącz do nas", widget newslettera, popup
// zapisu) i decyduje, co silnik rekomendacji uzna za zainteresowania osoby.
// Trzy reguły, których złamanie widzi użytkownik, a nie administrator:
//
//   1. ZAPIS LICZY RÓŻNICĘ, NIE NADPISUJE. `user_follows` trzyma także
//      obserwowanych AUTORÓW. Zapis „wstaw wszystko, co wybrano" wyczyściłby je
//      przy pierwszym dotknięciu zainteresowań - i nikt by tego nie zauważył,
//      bo lista autorów mieszka na innym ekranie.
//   2. GOŚĆ ZAPISUJE DO localStorage I TO MUSI PRZEŻYĆ AWARIĘ MAGAZYNU.
//      Tryb prywatny i przepełniony magazyn rzucają wyjątkiem na `setItem`;
//      widget zapisu do newslettera nie ma prawa się na tym wywalić.
//   3. USZKODZONY WPIS W MAGAZYNIE NIE MOŻE ROZŁOŻYĆ WIDGETU. Wpis
//      `nes.interests.anon.v1` przeżywa wersje aplikacji; kształt spoza kontraktu
//      musi degradować do pustki, nie do wyjątku w renderze.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - SCALANIA GOŚĆ → ZALOGOWANY: `lib/personalization/anonMerge.ts` ma własny próg
//   (97/100/98/95) i należy do modułu 19. Ten hook świadomie NIE scala sam -
//   scalanie robi AuthProvider, żeby działało także bez zamontowanego widgetu.
//   Komentarz w kodzie hooka mówi to wprost i tego nie ruszamy.
// - POLITYK `user_follows`: RLS dowiedzione w pgTAP
//   (`rls_tenant_isolation_test.sql`). Sprawdzamy KSZTAŁT zapytań, nie autorytet.
// - GRUPOWANIA KATALOGU: `useInterestGroups` ma asercje przy dropliście
//   (`src/components/interests/__tests__/topicsDroplist.test.tsx`).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  userId: null as string | null,
  /** Wiersze `user_follows` widziane przez odczyt. */
  follows: [] as { target_type: string; target_id: string }[],
  followsError: null as { message: string } | null,
  categories: [] as Record<string, unknown>[],
  tags: [] as Record<string, unknown>[],
  /** Zapisane operacje - przedmiot dowodu dla różnicy. */
  ops: [] as string[],
  upsertError: null as { message: string } | null,
  deleteError: null as { message: string } | null,
  /** Nazwy kanałów realtime, na które hook się zapisał. */
  channels: [] as string[],
  /** Nasłuchy zarejestrowane na kanale: tabela → callback. */
  listeners: [] as { table: string; fire: () => void }[],
  removed: 0,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.userId === null ? null : { id: h.userId } }),
}));

vi.mock("@/integrations/supabase/client", () => {
  interface Chain {
    select: (columns: string) => Chain;
    order: () => Chain;
    eq: (column: string, value: string) => Chain;
    in: () => Chain;
    delete: () => Chain;
    upsert: (rows: unknown, options: unknown) => Promise<{ error: unknown }>;
    then: (resolve: (value: { data: unknown; error: unknown }) => unknown) => unknown;
  }
  const makeChain = (table: string): Chain => {
    const filters: string[] = [];
    let isDelete = false;
    const chain: Chain = {
      select: () => chain,
      order: () => chain,
      eq: (column, value) => {
        filters.push(`${column}=${value}`);
        return chain;
      },
      in: () => chain,
      delete: () => {
        isDelete = true;
        return chain;
      },
      upsert: (rows, options) => {
        h.ops.push(`upsert:${JSON.stringify(rows)}:${JSON.stringify(options)}`);
        return Promise.resolve({ error: h.upsertError });
      },
      then: (resolve) => {
        if (isDelete) {
          h.ops.push(`delete:${filters.join(",")}`);
          return resolve({ data: null, error: h.deleteError });
        }
        if (table === "categories") return resolve({ data: h.categories, error: null });
        if (table === "tags") return resolve({ data: h.tags, error: null });
        return resolve({ data: h.follows, error: h.followsError });
      },
    };
    return chain;
  };
  interface Filter {
    table?: string;
  }
  const channel = {
    on: (_event: string, filter: Filter, callback: () => void) => {
      h.listeners.push({ table: filter.table ?? "?", fire: callback });
      return channel;
    },
    subscribe: () => channel,
  };
  return {
    supabase: {
      from: (table: string) => makeChain(table),
      channel: (name: string) => {
        h.channels.push(name);
        return channel;
      },
      removeChannel: () => {
        h.removed += 1;
        return Promise.resolve("ok");
      },
    },
  };
});

import { useInterestCatalog, useMyInterests } from "@/hooks/useInterests";

const ANON_KEY = "nes.interests.anon.v1";

function harness() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  h.userId = null;
  h.follows = [];
  h.followsError = null;
  h.categories = [];
  h.tags = [];
  h.ops = [];
  h.upsertError = null;
  h.deleteError = null;
  h.channels = [];
  h.listeners = [];
  h.removed = 0;
  window.localStorage.clear();
});

describe("useInterestCatalog", () => {
  it("mapuje kategorie i tagi na wspólny kształt pozycji", async () => {
    h.categories = [
      { id: "c1", slug: "afryka", name_pl: "Afryka", name_en: "Africa", parent_id: null },
    ];
    h.tags = [{ id: "t1", slug: "handel", name: "Handel" }];
    const { wrapper } = harness();
    const { result } = renderHook(() => useInterestCatalog("pl"), { wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data?.categories[0]).toMatchObject({
      id: "c1",
      type: "category",
      slug: "afryka",
      label: "Afryka",
    });
    expect(result.current.data?.tags[0]).toMatchObject({ id: "t1", type: "tag", label: "Handel" });
  });

  it("wersja EN wybiera nazwę angielską", async () => {
    h.categories = [
      { id: "c1", slug: "afryka", name_pl: "Afryka", name_en: "Africa", parent_id: null },
    ];
    const { wrapper } = harness();
    const { result } = renderHook(() => useInterestCatalog("en"), { wrapper });
    await waitFor(() => expect(result.current.data?.categories[0].label).toBe("Africa"));
  });

  it("brak tłumaczenia EN cofa się do PL, nie do pustej etykiety", async () => {
    // Kategoria bez nazwy angielskiej w EN interfejsie renderowałaby pusty
    // przycisk - użytkownik widzi kwadrat do kliknięcia bez wiedzy, co wybiera.
    h.categories = [
      { id: "c1", slug: "afryka", name_pl: "Afryka", name_en: null, parent_id: null },
    ];
    const { wrapper } = harness();
    const { result } = renderHook(() => useInterestCatalog("en"), { wrapper });
    await waitFor(() => expect(result.current.data?.categories[0].label).toBe("Afryka"));
  });

  it("brak obu nazw cofa się do sluga - nigdy do pustki", async () => {
    h.categories = [{ id: "c1", slug: "afryka", name_pl: null, name_en: null, parent_id: null }];
    const { wrapper } = harness();
    const { result } = renderHook(() => useInterestCatalog("pl"), { wrapper });
    await waitFor(() => expect(result.current.data?.categories[0].label).toBe("afryka"));
  });

  it("rozwiązuje rodzica po `parent_id` - etykietę i slug", async () => {
    // Bez etykiety rodzica widget nie ma po czym grupować: „Afryka" straciłaby
    // nagłówek „Region" i wylądowała w koszu „Obszary".
    h.categories = [
      { id: "p1", slug: "region", name_pl: "Region", name_en: "Region", parent_id: null },
      { id: "c1", slug: "afryka", name_pl: "Afryka", name_en: "Africa", parent_id: "p1" },
    ];
    const { wrapper } = harness();
    const { result } = renderHook(() => useInterestCatalog("pl"), { wrapper });
    await waitFor(() => expect(result.current.data?.categories).toHaveLength(2));
    const child = result.current.data?.categories.find((c) => c.id === "c1");
    expect(child).toMatchObject({ parentId: "p1", parentLabel: "Region", parentSlug: "region" });
  });

  it("rodzic nieobecny w wyniku daje pusty opis rodzica, nie wyjątek", async () => {
    // Kategoria z `parent_id` wskazującym na wiersz odcięty filtrem/RLS-em.
    h.categories = [
      { id: "c1", slug: "afryka", name_pl: "Afryka", name_en: null, parent_id: "brak" },
    ];
    const { wrapper } = harness();
    const { result } = renderHook(() => useInterestCatalog("pl"), { wrapper });
    await waitFor(() => expect(result.current.data?.categories[0]).toBeTruthy());
    expect(result.current.data?.categories[0]).toMatchObject({
      parentLabel: null,
      parentSlug: null,
    });
  });

  it("rodzic bez nazwy w bieżącym języku cofa się do PL, a potem do sluga", async () => {
    h.categories = [
      { id: "p1", slug: "region", name_pl: null, name_en: null, parent_id: null },
      { id: "c1", slug: "afryka", name_pl: "Afryka", name_en: null, parent_id: "p1" },
    ];
    const { wrapper } = harness();
    const { result } = renderHook(() => useInterestCatalog("pl"), { wrapper });
    await waitFor(() => expect(result.current.data?.categories).toHaveLength(2));
    expect(result.current.data?.categories.find((c) => c.id === "c1")?.parentLabel).toBe("region");
  });

  it("pusty wynik z bazy daje pusty katalog, nie undefined", async () => {
    const { wrapper } = harness();
    const { result } = renderHook(() => useInterestCatalog("pl"), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ categories: [], tags: [] }));
  });

  it.each(["categories", "tags"])(
    "zmiana w tabeli %s unieważnia katalog - panel dodał temat, widget go widzi",
    async (table) => {
      // Bez tego administrator dodaje kategorię w panelu, a widget zapisu
      // pokazuje starą listę do wygaśnięcia `staleTime` (minuta).
      const { queryClient, wrapper } = harness();
      renderHook(() => useInterestCatalog("pl"), { wrapper });
      await waitFor(() => expect(h.listeners.length).toBeGreaterThanOrEqual(2));
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");
      const listener = h.listeners.find((l) => l.table === table);
      expect(listener, `nasłuch na tabeli ${table} musi istnieć`).toBeTruthy();
      listener?.fire();
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["interests-catalog"] });
    },
  );

  it("nasłuchy obejmują OBIE tabele katalogu - kanarek zasięgu", async () => {
    // Katalog składa się z kategorii I tagów; nasłuch na jednej tabeli zostawia
    // drugą połowę listy nieodświeżaną.
    const { wrapper } = harness();
    renderHook(() => useInterestCatalog("pl"), { wrapper });
    await waitFor(() => expect(h.listeners.length).toBeGreaterThanOrEqual(2));
    expect(new Set(h.listeners.map((l) => l.table))).toEqual(new Set(["categories", "tags"]));
  });

  it("każda instancja hooka bierze WŁASNY kanał realtime i sprząta go", async () => {
    // Współdzielony kanał wywala się na „cannot add postgres_changes callbacks
    // after subscribe()", gdy na stronie stoją dwa widgety zainteresowań.
    const { wrapper } = harness();
    const first = renderHook(() => useInterestCatalog("pl"), { wrapper });
    const second = renderHook(() => useInterestCatalog("pl"), { wrapper });
    await waitFor(() => expect(h.channels.length).toBeGreaterThanOrEqual(2));
    expect(new Set(h.channels).size).toBe(h.channels.length);
    first.unmount();
    second.unmount();
    await waitFor(() => expect(h.removed).toBeGreaterThanOrEqual(2));
  });
});

describe("useMyInterests - gość", () => {
  it("bez wpisu w magazynie zwraca pusty wybór", async () => {
    const { wrapper } = harness();
    const { result } = renderHook(() => useMyInterests(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ categoryIds: [], tagIds: [] }));
    expect(result.current.isAnonymous).toBe(true);
    expect(result.current.userId).toBeNull();
  });

  it("czyta wybór gościa z magazynu", async () => {
    window.localStorage.setItem(
      ANON_KEY,
      JSON.stringify({ categoryIds: ["c1"], tagIds: ["t1", "t2"] }),
    );
    const { wrapper } = harness();
    const { result } = renderHook(() => useMyInterests(), { wrapper });
    await waitFor(() =>
      expect(result.current.data).toEqual({ categoryIds: ["c1"], tagIds: ["t1", "t2"] }),
    );
  });

  it.each([
    ["nie-json", "uszkodzony JSON"],
    ['{"categoryIds":"c1"}', "pole nie jest tablicą"],
    ["null", "null zamiast obiektu"],
    ["[]", "tablica zamiast obiektu"],
  ])("wpis %j (%s) degraduje do pustki, nie do wyjątku", async (raw) => {
    // Wpis przeżywa wersje aplikacji; kształt spoza kontraktu nie ma prawa
    // rozłożyć widgetu zapisu do newslettera.
    window.localStorage.setItem(ANON_KEY, raw);
    const { wrapper } = harness();
    const { result } = renderHook(() => useMyInterests(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ categoryIds: [], tagIds: [] }));
  });

  it("zapis gościa idzie do magazynu i NIE puka do bazy", async () => {
    const { wrapper } = harness();
    const { result } = renderHook(() => useMyInterests(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());

    const outcome = await result.current.save({ categoryIds: ["c1"], tagIds: ["t1"] });
    expect(outcome).toEqual({ ok: true, anon: true });
    expect(JSON.parse(window.localStorage.getItem(ANON_KEY) ?? "null")).toEqual({
      categoryIds: ["c1"],
      tagIds: ["t1"],
    });
    expect(h.ops).toEqual([]);
  });

  it("zapis gościa od razu odświeża widok, nie czeka na staleTime", async () => {
    const { queryClient, wrapper } = harness();
    const { result } = renderHook(() => useMyInterests(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    await result.current.save({ categoryIds: ["c1"], tagIds: [] });
    expect(queryClient.getQueryData(["my-interests", "anon"])).toEqual({
      categoryIds: ["c1"],
      tagIds: [],
    });
  });

  it("AWARIA MAGAZYNU (tryb prywatny, przepełnienie) nie wywraca zapisu", async () => {
    // Bez tej obrony widget zapisu do newslettera przestaje działać w trybie
    // prywatnym przeglądarki - a to jest tryb, w którym ludzie zapisują się
    // najchętniej.
    const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const { wrapper } = harness();
    const { result } = renderHook(() => useMyInterests(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    await expect(result.current.save({ categoryIds: ["c1"], tagIds: [] })).resolves.toEqual({
      ok: true,
      anon: true,
    });
    setItem.mockRestore();
  });

  it("AWARIA ODCZYTU MAGAZYNU też degraduje do pustki", async () => {
    const getItem = vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const { wrapper } = harness();
    const { result } = renderHook(() => useMyInterests(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ categoryIds: [], tagIds: [] }));
    getItem.mockRestore();
  });
});

describe("useMyInterests - zalogowany", () => {
  beforeEach(() => {
    h.userId = "user-1";
  });

  it("czyta obserwacje z bazy i rozdziela je po typie", async () => {
    h.follows = [
      { target_type: "category", target_id: "c1" },
      { target_type: "tag", target_id: "t1" },
      { target_type: "category", target_id: "c2" },
    ];
    const { wrapper } = harness();
    const { result } = renderHook(() => useMyInterests(), { wrapper });
    await waitFor(() =>
      expect(result.current.data).toEqual({ categoryIds: ["c1", "c2"], tagIds: ["t1"] }),
    );
    expect(result.current.isAnonymous).toBe(false);
  });

  it("błąd odczytu jest STANEM BŁĘDU, nie pustym wyborem", async () => {
    // Pusty wybór po nieudanym odczycie wygląda jak „nic nie wybrałem": pierwszy
    // zapis z tego ekranu skasowałby realne zainteresowania z bazy.
    h.followsError = { message: "odmowa polityki" };
    const { wrapper } = harness();
    const { result } = renderHook(() => useMyInterests(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it("ZAPIS LICZY RÓŻNICĘ: wstawia tylko nowe, usuwa tylko odjęte", async () => {
    // To jest cała treść tego testu. `user_follows` trzyma także obserwowanych
    // AUTORÓW - zapis „wstaw wszystko" wyczyściłby ich przy pierwszym dotknięciu
    // zainteresowań, a lista autorów mieszka na innym ekranie, więc nikt by tego
    // nie zauważył.
    h.follows = [
      { target_type: "category", target_id: "c-zostaje" },
      { target_type: "category", target_id: "c-do-usuniecia" },
      { target_type: "tag", target_id: "t-zostaje" },
    ];
    const { wrapper } = harness();
    const { result } = renderHook(() => useMyInterests(), { wrapper });
    await waitFor(() => expect(result.current.data?.categoryIds).toHaveLength(2));

    h.ops = [];
    const outcome = await result.current.save({
      categoryIds: ["c-zostaje", "c-nowa"],
      tagIds: ["t-zostaje", "t-nowy"],
    });
    expect(outcome).toEqual({ ok: true, anon: false });

    const upsert = h.ops.find((op) => op.startsWith("upsert:"));
    expect(upsert).toBeTruthy();
    // Wstawiane są WYŁĄCZNIE nowe pozycje.
    expect(JSON.parse(upsert!.slice("upsert:".length).split(":{")[0])).toEqual([
      { user_id: "user-1", target_type: "category", target_id: "c-nowa" },
      { user_id: "user-1", target_type: "tag", target_id: "t-nowy" },
    ]);
    // Usuwana jest WYŁĄCZNIE odjęta pozycja, po trzech filtrach.
    expect(h.ops.filter((op) => op.startsWith("delete:"))).toEqual([
      "delete:user_id=user-1,target_type=category,target_id=c-do-usuniecia",
    ]);
  });

  it("wstawianie jest idempotentne - `ignoreDuplicates` na kluczu unikalnym", async () => {
    // Równoległy zapis (FollowButton, scalanie po zalogowaniu) nie może wywrócić
    // całej partii na kolizji jednego wiersza.
    const { wrapper } = harness();
    const { result } = renderHook(() => useMyInterests(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    await result.current.save({ categoryIds: ["c1"], tagIds: [] });
    const upsert = h.ops.find((op) => op.startsWith("upsert:"));
    expect(upsert).toContain('"onConflict":"user_id,target_type,target_id"');
    expect(upsert).toContain('"ignoreDuplicates":true');
  });

  it("brak zmian nie generuje ANI JEDNEJ operacji zapisu", async () => {
    h.follows = [{ target_type: "category", target_id: "c1" }];
    const { wrapper } = harness();
    const { result } = renderHook(() => useMyInterests(), { wrapper });
    await waitFor(() => expect(result.current.data?.categoryIds).toEqual(["c1"]));
    h.ops = [];
    await result.current.save({ categoryIds: ["c1"], tagIds: [] });
    expect(h.ops).toEqual([]);
  });

  it("błąd wstawiania przerywa zapis i zwraca komunikat, NIE usuwając niczego", async () => {
    // Usunięcie po nieudanym wstawieniu zostawiłoby użytkownika z mniejszą
    // liczbą zainteresowań niż przed kliknięciem „Zapisz".
    h.follows = [{ target_type: "category", target_id: "c-do-usuniecia" }];
    h.upsertError = { message: "odmowa polityki" };
    const { wrapper } = harness();
    const { result } = renderHook(() => useMyInterests(), { wrapper });
    await waitFor(() => expect(result.current.data?.categoryIds).toHaveLength(1));
    h.ops = [];
    const outcome = await result.current.save({ categoryIds: ["c-nowa"], tagIds: [] });
    expect(outcome).toEqual({ ok: false, error: "odmowa polityki" });
    expect(h.ops.some((op) => op.startsWith("delete:"))).toBe(false);
  });

  it("błąd usuwania zwraca komunikat", async () => {
    h.follows = [{ target_type: "tag", target_id: "t-do-usuniecia" }];
    h.deleteError = { message: "conflict" };
    const { wrapper } = harness();
    const { result } = renderHook(() => useMyInterests(), { wrapper });
    await waitFor(() => expect(result.current.data?.tagIds).toHaveLength(1));
    const outcome = await result.current.save({ categoryIds: [], tagIds: [] });
    expect(outcome).toEqual({ ok: false, error: "conflict" });
  });

  it("udany zapis unieważnia WSZYSTKIE pięć rodzin kluczy czytających user_follows", async () => {
    // `user_follows` czytają zainteresowania, obserwacje, liczniki profilu,
    // rekomendacje i feed obserwowanych. Pominięcie jednej rodziny zostawia
    // ekran, który po zapisie nadal pokazuje stan sprzed zmiany.
    const { queryClient, wrapper } = harness();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useMyInterests(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    invalidate.mockClear();
    await result.current.save({ categoryIds: ["c1"], tagIds: [] });
    const roots = invalidate.mock.calls.map(([args]) => args?.queryKey?.[0]);
    expect(new Set(roots)).toEqual(
      new Set(["my-interests", "follows", "profile-counts", "recommended-posts", "followed-feed"]),
    );
  });

  it("zapis gościa unieważnia rekomendacje - inaczej wynik wisi do staleTime", async () => {
    h.userId = null;
    const { queryClient, wrapper } = harness();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useMyInterests(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    invalidate.mockClear();
    await result.current.save({ categoryIds: ["c1"], tagIds: [] });
    expect(invalidate.mock.calls.map(([args]) => args?.queryKey?.[0])).toEqual([
      "recommended-posts",
    ]);
  });

  it("zapis PRZED wczytaniem obecnych obserwacji traktuje je jako pustkę", async () => {
    // Użytkownik klikający „Zapisz" natychmiast po wejściu na ekran nie ma
    // jeszcze wczytanego stanu. Różnica liczona wobec `undefined` wywaliłaby
    // zapis; liczona wobec pustki po prostu wstawia jego wybór i niczego nie
    // usuwa - a to jest zachowanie bezpieczne dla danych.
    h.follows = [{ target_type: "category", target_id: "c-istniejaca" }];
    const { wrapper } = harness();
    const { result } = renderHook(() => useMyInterests(), { wrapper });
    // BEZ `waitFor` - zapis leci na nierozstrzygniętym zapytaniu.
    const outcome = await result.current.save({ categoryIds: ["c-nowa"], tagIds: [] });
    expect(outcome).toEqual({ ok: true, anon: false });
    expect(h.ops.some((op) => op.startsWith("delete:"))).toBe(false);
    expect(h.ops.find((op) => op.startsWith("upsert:"))).toContain("c-nowa");
  });

  it("klucz zapytania rozdziela gościa od konta - dane nie przeciekają", async () => {
    // Wspólny klucz pokazywałby wybór poprzedniego użytkownika na wspólnym
    // komputerze do końca `staleTime`.
    const { queryClient, wrapper } = harness();
    renderHook(() => useMyInterests(), { wrapper });
    await waitFor(() => expect(queryClient.getQueryData(["my-interests", "user-1"])).toBeTruthy());
    expect(queryClient.getQueryData(["my-interests", "anon"])).toBeUndefined();
  });
});
