// Jedyne źródło odczytów biblioteki mediów. Do 18.08.2026: 0%.
//
// Ten hook niesie OBRONĘ W GŁĄB przed wyciekiem między tenantami i każda z jej
// trzech warstw da się złamać osobno, po cichu:
//   1. klucz cache namespace'owany tenantem - bez niego przełączenie
//      przestrzeni roboczej pokazuje wiersze z cache POPRZEDNIEJ,
//   2. filtr `.eq("tenant_id", …)` w zapytaniu,
//   3. ponowne sprawdzenie `row.tenant_id` po stronie klienta - linka
//      alarmowa na wypadek regresji RLS albo polityki.
// Trzecia warstwa jest z definicji martwa przy zdrowej bazie, więc bez testu
// nikt by nie zauważył jej usunięcia. Dlatego ma tu własny przypadek.
//
// PAGINACJA (wydanie 12). Wcześniej jedno zapytanie bez limitu ściągało całą
// bibliotekę tenanta. Teraz hook czyta BIEŻĄCY folder stronami po
// `MEDIA_PAGE_SIZE` kursorem keyset, frazę filtruje baza, a foldery
// wynikające z położenia plików daje RPC `media_folder_paths`. Kontrakt
// kursora i escapowania ma własne testy (`lib/__tests__/mediaPage.test.ts`);
// tutaj - że hook z nich korzysta i że strony składają się w jedną listę.
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ok, fail, type RecordedChain, type SupabaseFromStub } from "@/test/supabase/chain";

const stubs = vi.hoisted(() => ({
  from: null as SupabaseFromStub | null,
  rpcCalls: [] as Array<{ fn: string; args: unknown }>,
  rpcResult: { data: [] as unknown, error: null as { message: string } | null },
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabase/chain");
  const from = supabaseFromStub();
  stubs.from = from;
  return {
    supabase: {
      from: from.from,
      rpc: async (fn: string, args: unknown) => {
        stubs.rpcCalls.push({ fn, args });
        return stubs.rpcResult;
      },
    },
  };
});

import { useMediaData, type MediaDataScope } from "../useMediaData";
import { MEDIA_PAGE_SIZE, keysetAfter } from "../../lib/mediaPage";

const TENANT = "tenant-1";
const OTHER = "tenant-2";

function stub() {
  const s = stubs.from;
  if (!s) throw new Error("atrapa supabase nie została zainicjalizowana");
  return s;
}

function mediaRow(id: string, tenantId = TENANT, createdAt = "2026-01-01T00:00:00.000Z") {
  return {
    id,
    tenant_id: tenantId,
    storage_path: `${tenantId}/u/${id}.png`,
    public_url: `https://cdn.example/${id}.png`,
    filename: `${id}.png`,
    mime_type: "image/png",
    size_bytes: 10,
    uploader_id: "u",
    created_at: createdAt,
    folder_path: "/",
    alt_text: null,
  };
}

function folderRow(id: string, tenantId = TENANT) {
  return { id, path: `/${id}/`, created_at: "2026-01-01T00:00:00.000Z", tenant_id: tenantId };
}

/** Wszystkie argumenty danego ogniwa (argsOf oddaje tylko pierwsze). */
function allArgs(chain: RecordedChain | undefined, method: string): unknown[][] {
  return (chain?.calls ?? []).filter((c) => c.method === method).map((c) => [...c.args]);
}

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function mount(tenantId = TENANT, scope: MediaDataScope = { folder: "/" }) {
  return renderHook(() => useMediaData(tenantId, scope), { wrapper });
}

beforeEach(() => {
  stub().reset();
  stubs.rpcCalls.length = 0;
  stubs.rpcResult = { data: [], error: null };
  stub().setResponse("media_folders", ok([]));
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe("useMediaData - odczyt plików", () => {
  it("zawęża zapytanie do tenanta i FOLDERU, sortuje od najnowszych z rozstrzygnięciem po id", async () => {
    stub().setResponse("media", ok([mediaRow("a")]));

    const { result } = mount(TENANT, { folder: "/press/" });
    await waitFor(() => expect(result.current.mediaQuery.isSuccess).toBe(true));

    const chain = stub().lastChain("media");
    expect(allArgs(chain, "eq")).toEqual([
      ["tenant_id", TENANT],
      ["folder_path", "/press/"],
    ]);
    expect(allArgs(chain, "order")).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
  });

  it("czyta STRONĘ, nie całą bibliotekę - jeden wiersz ponad stronę mówi o następnej", async () => {
    stub().setResponse("media", ok([]));
    const { result } = mount();
    await waitFor(() => expect(result.current.mediaQuery.isSuccess).toBe(true));
    expect(stub().lastChain("media")?.argsOf("limit")).toEqual([MEDIA_PAGE_SIZE + 1]);
  });

  it("normalizuje ścieżkę folderu przed zapytaniem", async () => {
    stub().setResponse("media", ok([]));
    const { result } = mount(TENANT, { folder: "press" });
    await waitFor(() => expect(result.current.mediaQuery.isSuccess).toBe(true));
    expect(allArgs(stub().lastChain("media"), "eq")).toContainEqual(["folder_path", "/press/"]);
  });

  it("fraza idzie do bazy jako ILIKE z ESCAPOWANYMI symbolami wieloznacznymi", async () => {
    stub().setResponse("media", ok([]));
    const { result } = mount(TENANT, { folder: "/", search: "  100%_a  " });
    await waitFor(() => expect(result.current.mediaQuery.isSuccess).toBe(true));
    expect(stub().lastChain("media")?.argsOf("ilike")).toEqual(["filename", "%100\\%\\_a%"]);
  });

  it("pusta fraza NIE dokłada filtra nazwy", async () => {
    stub().setResponse("media", ok([]));
    const { result } = mount(TENANT, { folder: "/", search: "   " });
    await waitFor(() => expect(result.current.mediaQuery.isSuccess).toBe(true));
    expect(stub().lastChain("media")?.has("ilike")).toBe(false);
  });

  it("NIE używa select(*) - tabela ma kolumny poza kontraktem panelu", async () => {
    stub().setResponse("media", ok([]));

    const { result } = mount();
    await waitFor(() => expect(result.current.mediaQuery.isSuccess).toBe(true));
    expect(stub().lastChain("media")?.argsOf("select")?.[0]).not.toBe("*");
  });

  it("ODRZUCA wiersz z cudzego tenanta, który przeszedł przez filtr", async () => {
    // Trzecia warstwa obrony. Przy zdrowym RLS-ie jest martwa - i właśnie
    // dlatego bez tego testu jej usunięcie byłoby niewidoczne aż do wycieku.
    stub().setResponse("media", ok([mediaRow("a"), mediaRow("obcy", OTHER)]));

    const { result } = mount();
    await waitFor(() => expect(result.current.mediaQuery.isSuccess).toBe(true));
    expect(result.current.media.map((r) => r.id)).toEqual(["a"]);
  });

  it("adres pliku jest RENDEROWANY względnie (`/media/...`)", async () => {
    stub().setResponse(
      "media",
      ok([
        {
          ...mediaRow("a"),
          public_url: "https://x.supabase.co/storage/v1/object/public/media/t/u/a.png",
        },
      ]),
    );

    const { result } = mount();
    await waitFor(() => expect(result.current.mediaQuery.isSuccess).toBe(true));
    expect(result.current.media[0].public_url).toBe("/media/t/u/a.png");
  });

  it("pusta odpowiedź daje pustą listę, nie null", async () => {
    stub().setResponse("media", ok(null));

    const { result } = mount();
    await waitFor(() => expect(result.current.mediaQuery.isSuccess).toBe(true));
    expect(result.current.media).toEqual([]);
    expect(result.current.mediaQuery.hasNextPage).toBe(false);
  });

  it("błąd odczytu ląduje w stanie zapytania, nie w cichej pustce", async () => {
    stub().setResponse("media", fail("odmowa odczytu"));

    const { result } = mount();
    await waitFor(() => expect(result.current.mediaQuery.isError).toBe(true));
    expect(result.current.mediaQuery.error).toMatchObject({ message: "odmowa odczytu" });
  });
});

describe("useMediaData - kolejne strony", () => {
  // Jeden znacznik czasu dla całej strony (import hurtowy) - kursor musi więc
  // nieść także `id` ostatniego wiersza.
  const firstPage = Array.from({ length: MEDIA_PAGE_SIZE + 1 }, (_, i) =>
    mediaRow(`p${String(MEDIA_PAGE_SIZE - i).padStart(3, "0")}`),
  );

  it("nadmiarowy wiersz włącza następną stronę i NIE trafia na listę", async () => {
    stub().setResponse("media", ok(firstPage));
    const { result } = mount();
    await waitFor(() => expect(result.current.mediaQuery.isSuccess).toBe(true));

    expect(result.current.media).toHaveLength(MEDIA_PAGE_SIZE);
    expect(result.current.mediaQuery.hasNextPage).toBe(true);
  });

  it("następna strona startuje kursorem OSTATNIEGO pokazanego wiersza i dokleja się do listy", async () => {
    const last = firstPage[MEDIA_PAGE_SIZE - 1];
    stub().setResponse("media", (chain) =>
      chain.has("or") ? ok([mediaRow("nastepny")]) : ok(firstPage),
    );
    const { result } = mount();
    await waitFor(() => expect(result.current.mediaQuery.hasNextPage).toBe(true));

    await act(async () => {
      await result.current.mediaQuery.fetchNextPage();
    });

    const next = stub()
      .chainsFor("media")
      .find((c) => c.has("or"));
    expect(next?.argsOf("or")).toEqual([keysetAfter({ createdAt: last.created_at, id: last.id })]);
    await waitFor(() => expect(result.current.media).toHaveLength(MEDIA_PAGE_SIZE + 1));
    expect(result.current.media.at(-1)?.id).toBe("nastepny");
    expect(result.current.mediaQuery.hasNextPage).toBe(false);
  });
});

describe("useMediaData - odczyt folderów", () => {
  it("zawęża do tenanta i sortuje po ścieżce", async () => {
    stub().setResponse("media", ok([]));
    stub().setResponse("media_folders", ok([folderRow("press")]));

    const { result } = mount();
    await waitFor(() => expect(result.current.foldersQuery.isSuccess).toBe(true));

    const chain = stub().lastChain("media_folders");
    expect(chain?.argsOf("eq")).toEqual(["tenant_id", TENANT]);
    expect(chain?.argsOf("order")).toEqual(["path"]);
  });

  it("ODRZUCA folder z cudzego tenanta i ZDEJMUJE kolumnę tenanta z wyniku", async () => {
    // Panel nie potrzebuje `tenant_id`, a jego brak w kształcie wyniku
    // uniemożliwia przypadkowe renderowanie cudzej przestrzeni.
    stub().setResponse("media", ok([]));
    stub().setResponse("media_folders", ok([folderRow("press"), folderRow("obcy", OTHER)]));

    const { result } = mount();
    await waitFor(() => expect(result.current.foldersQuery.isSuccess).toBe(true));
    expect(result.current.foldersQuery.data).toEqual([
      { id: "press", path: "/press/", created_at: "2026-01-01T00:00:00.000Z" },
    ]);
  });

  it("błąd odczytu folderów ląduje w stanie zapytania", async () => {
    stub().setResponse("media", ok([]));
    stub().setResponse("media_folders", fail("odmowa"));

    const { result } = mount();
    await waitFor(() => expect(result.current.foldersQuery.isError).toBe(true));
  });

  it("foldery z położenia plików idą RPC z tenantem, nie odczytem całej tabeli", async () => {
    stub().setResponse("media", ok([]));
    stubs.rpcResult = { data: ["/press/", "/press/2026/"], error: null };

    const { result } = mount();
    await waitFor(() => expect(result.current.folderPathsQuery.isSuccess).toBe(true));
    expect(stubs.rpcCalls).toEqual([{ fn: "media_folder_paths", args: { _tenant_id: TENANT } }]);
    expect(result.current.folderPathsQuery.data).toEqual(["/press/", "/press/2026/"]);
  });

  it("błąd RPC folderów ląduje w stanie zapytania", async () => {
    stub().setResponse("media", ok([]));
    stubs.rpcResult = { data: null, error: { message: "odmowa" } };

    const { result } = mount();
    await waitFor(() => expect(result.current.folderPathsQuery.isError).toBe(true));
  });
});

describe("useMediaData - izolacja cache między przestrzeniami", () => {
  it("klucz cache jest namespace'owany tenantem, folderem i frazą", async () => {
    stub().setResponse("media", ok([mediaRow("a")]));

    const { result } = mount(TENANT, { folder: "/", search: "a" });
    await waitFor(() => expect(result.current.mediaQuery.isSuccess).toBe(true));

    expect(queryClient.getQueryData(["media", TENANT, "/", "a"])).toBeDefined();
    // Bez namespace'u wpis leżałby pod wspólnym kluczem i przełączenie
    // przestrzeni roboczej pokazałoby cudze pliki z cache.
    expect(queryClient.getQueryData(["media", OTHER, "/", "a"])).toBeUndefined();
    expect(queryClient.getQueryData(["media", TENANT, "/press/", "a"])).toBeUndefined();
  });

  it("zmiana FRAZY trzyma poprzednie wiersze do czasu odpowiedzi - lista nie mruga pustką", async () => {
    // Bramka tworzona z góry: odpowiedź na nową frazę czeka na `release`
    // niezależnie od tego, kiedy React Query faktycznie wyśle zapytanie.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    stub().setResponse("media", (chain) =>
      chain.has("ilike") ? gate.then(() => ok([mediaRow("b")])) : ok([mediaRow("a")]),
    );
    const { result, rerender } = renderHook(
      ({ search }) => useMediaData(TENANT, { folder: "/", search }),
      { wrapper, initialProps: { search: "" } },
    );
    await waitFor(() => expect(result.current.media[0]?.id).toBe("a"));

    rerender({ search: "b" });
    expect(result.current.media[0]?.id).toBe("a");
    act(() => release());
    await waitFor(() => expect(result.current.media[0]?.id).toBe("b"));
  });

  it("zmiana TENANTA NIE pokazuje poprzednich wierszy nawet przez chwilę", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    stub().setResponse("media", (chain) =>
      chain.argsOf("eq")?.[1] === OTHER
        ? gate.then(() => ok([mediaRow("z", OTHER)]))
        : ok([mediaRow("a")]),
    );
    const { result, rerender } = renderHook(
      ({ tenantId }) => useMediaData(tenantId, { folder: "/" }),
      { wrapper, initialProps: { tenantId: TENANT } },
    );
    await waitFor(() => expect(result.current.media[0]?.id).toBe("a"));

    rerender({ tenantId: OTHER });
    expect(result.current.media).toEqual([]);
    act(() => release());
    await waitFor(() => expect(result.current.media[0]?.id).toBe("z"));
  });

  it("zmiana tenanta odpytuje na nowo, zamiast oddać poprzednie wiersze", async () => {
    stub().setResponse("media", (chain) => {
      const tenantId = chain.argsOf("eq")?.[1] as string;
      return ok([mediaRow(tenantId === TENANT ? "a" : "z", tenantId)]);
    });

    const { result, rerender } = renderHook(
      ({ tenantId }) => useMediaData(tenantId, { folder: "/" }),
      { wrapper, initialProps: { tenantId: TENANT } },
    );
    await waitFor(() => expect(result.current.media[0]?.id).toBe("a"));

    rerender({ tenantId: OTHER });
    await waitFor(() => expect(result.current.media[0]?.id).toBe("z"));
  });
});

describe("useMediaData - unieważnianie", () => {
  it("unieważnia WSZYSTKIE rodziny kluczy, bez zawężenia do tenanta", async () => {
    // Unieważnienie tylko wyzwala ponowny odczyt - niczego nie ujawnia, więc
    // szeroki zasięg jest bezpieczny i upraszcza wywołania po mutacjach.
    stub().setResponse("media", ok([]));
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = mount();
    await waitFor(() => expect(result.current.mediaQuery.isSuccess).toBe(true));
    result.current.invalidate();

    expect(spy).toHaveBeenCalledWith({ queryKey: ["media"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["media-folders"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["media-folder-paths"] });
  });

  it("tożsamość `invalidate` jest stabilna między renderami", async () => {
    // Hook trafia do list zależności w `useMediaMutations`; niestabilna
    // tożsamość odpalałaby tam efekty przy każdym renderze panelu.
    stub().setResponse("media", ok([]));

    const { result, rerender } = mount();
    await waitFor(() => expect(result.current.mediaQuery.isSuccess).toBe(true));
    const first = result.current.invalidate;
    rerender();
    expect(result.current.invalidate).toBe(first);
  });
});
