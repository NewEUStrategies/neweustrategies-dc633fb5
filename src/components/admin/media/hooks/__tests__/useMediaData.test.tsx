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
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ok, fail, type SupabaseFromStub } from "@/test/supabaseChain";

const stubs = vi.hoisted(() => ({ from: null as SupabaseFromStub | null }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  stubs.from = from;
  return { supabase: { from: from.from } };
});

import { useMediaData } from "../useMediaData";

const TENANT = "tenant-1";
const OTHER = "tenant-2";

function stub() {
  const s = stubs.from;
  if (!s) throw new Error("atrapa supabase nie została zainicjalizowana");
  return s;
}

function mediaRow(id: string, tenantId = TENANT) {
  return {
    id,
    tenant_id: tenantId,
    storage_path: `${tenantId}/u/${id}.png`,
    public_url: `https://cdn.example/${id}.png`,
    filename: `${id}.png`,
    mime_type: "image/png",
    size_bytes: 10,
    uploader_id: "u",
    created_at: "2026-01-01T00:00:00.000Z",
    folder_path: "/",
    alt_text: null,
  };
}

function folderRow(id: string, tenantId = TENANT) {
  return { id, path: `/${id}/`, created_at: "2026-01-01T00:00:00.000Z", tenant_id: tenantId };
}

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function mount(tenantId = TENANT) {
  return renderHook(() => useMediaData(tenantId), { wrapper });
}

beforeEach(() => {
  stub().reset();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe("useMediaData - odczyt plików", () => {
  it("zawęża zapytanie do tenanta i sortuje od najnowszych", async () => {
    stub().setResponse("media", ok([mediaRow("a")]));
    stub().setResponse("media_folders", ok([]));

    const { result } = mount();
    await waitFor(() => expect(result.current.mediaQuery.isSuccess).toBe(true));

    const chain = stub().lastChain("media");
    expect(chain?.argsOf("eq")).toEqual(["tenant_id", TENANT]);
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: false }]);
  });

  it("NIE używa select(*) - tabela ma kolumny poza kontraktem panelu", async () => {
    stub().setResponse("media", ok([]));
    stub().setResponse("media_folders", ok([]));

    const { result } = mount();
    await waitFor(() => expect(result.current.mediaQuery.isSuccess).toBe(true));
    expect(stub().lastChain("media")?.argsOf("select")?.[0]).not.toBe("*");
  });

  it("ODRZUCA wiersz z cudzego tenanta, który przeszedł przez filtr", async () => {
    // Trzecia warstwa obrony. Przy zdrowym RLS-ie jest martwa - i właśnie
    // dlatego bez tego testu jej usunięcie byłoby niewidoczne aż do wycieku.
    stub().setResponse("media", ok([mediaRow("a"), mediaRow("obcy", OTHER)]));
    stub().setResponse("media_folders", ok([]));

    const { result } = mount();
    await waitFor(() => expect(result.current.mediaQuery.isSuccess).toBe(true));
    expect(result.current.mediaQuery.data?.map((r) => r.id)).toEqual(["a"]);
  });

  it("pusta odpowiedź daje pustą listę, nie null", async () => {
    stub().setResponse("media", ok(null));
    stub().setResponse("media_folders", ok([]));

    const { result } = mount();
    await waitFor(() => expect(result.current.mediaQuery.isSuccess).toBe(true));
    expect(result.current.mediaQuery.data).toEqual([]);
  });

  it("błąd odczytu ląduje w stanie zapytania, nie w cichej pustce", async () => {
    stub().setResponse("media", fail("odmowa odczytu"));
    stub().setResponse("media_folders", ok([]));

    const { result } = mount();
    await waitFor(() => expect(result.current.mediaQuery.isError).toBe(true));
    expect(result.current.mediaQuery.error).toMatchObject({ message: "odmowa odczytu" });
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
});

describe("useMediaData - izolacja cache między przestrzeniami", () => {
  it("klucz cache jest namespace'owany tenantem", async () => {
    stub().setResponse("media", ok([mediaRow("a")]));
    stub().setResponse("media_folders", ok([]));

    const { result } = mount();
    await waitFor(() => expect(result.current.mediaQuery.isSuccess).toBe(true));

    expect(queryClient.getQueryData(["media", TENANT])).toHaveLength(1);
    // Bez namespace'u wpis leżałby pod wspólnym kluczem i przełączenie
    // przestrzeni roboczej pokazałoby cudze pliki z cache.
    expect(queryClient.getQueryData(["media", OTHER])).toBeUndefined();
  });

  it("zmiana tenanta odpytuje na nowo, zamiast oddać poprzednie wiersze", async () => {
    stub().setResponse("media", (chain) => {
      const tenantId = chain.argsOf("eq")?.[1] as string;
      return ok([mediaRow(tenantId === TENANT ? "a" : "z", tenantId)]);
    });
    stub().setResponse("media_folders", ok([]));

    const { result, rerender } = renderHook(({ tenantId }) => useMediaData(tenantId), {
      wrapper,
      initialProps: { tenantId: TENANT },
    });
    await waitFor(() => expect(result.current.mediaQuery.data?.[0]?.id).toBe("a"));

    rerender({ tenantId: OTHER });
    await waitFor(() => expect(result.current.mediaQuery.data?.[0]?.id).toBe("z"));
  });
});

describe("useMediaData - unieważnianie", () => {
  it("unieważnia OBIE rodziny kluczy, bez zawężenia do tenanta", async () => {
    // Unieważnienie tylko wyzwala ponowny odczyt - niczego nie ujawnia, więc
    // szeroki zasięg jest bezpieczny i upraszcza wywołania po mutacjach.
    stub().setResponse("media", ok([]));
    stub().setResponse("media_folders", ok([]));
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = mount();
    await waitFor(() => expect(result.current.mediaQuery.isSuccess).toBe(true));
    result.current.invalidate();

    expect(spy).toHaveBeenCalledWith({ queryKey: ["media"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["media-folders"] });
  });

  it("tożsamość `invalidate` jest stabilna między renderami", async () => {
    // Hook trafia do list zależności w `useMediaMutations`; niestabilna
    // tożsamość odpalałaby tam efekty przy każdym renderze panelu.
    stub().setResponse("media", ok([]));
    stub().setResponse("media_folders", ok([]));

    const { result, rerender } = mount();
    await waitFor(() => expect(result.current.mediaQuery.isSuccess).toBe(true));
    const first = result.current.invalidate;
    rerender();
    expect(result.current.invalidate).toBe(first);
  });
});
