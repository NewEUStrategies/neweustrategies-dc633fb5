// Ustawienia układu wpisu. Stan wyjściowy: 0 z 8 funkcji, mimo że root loader
// grzeje ten wiersz na KAŻDEJ trasie publicznej, a panel /admin/post-layouts
// jest jedynym miejscem, z którego da się go zmienić.
//
// Trzy reguły, których złamanie widzi CZYTELNIK, nie admin:
//
//   1. BŁĄD ODCZYTU DEGRADUJE DO DOMYŚLNYCH, NIE RZUCA. Te ustawienia są w
//      loaderze korzenia, więc jedno nieudane zapytanie rzucające wyjątkiem
//      zabrałoby CAŁĄ stronę - nie tylko szerokość kolumny tekstu.
//   2. BRAK WIERSZA (`PGRST116`) to normalny stan nowego tenanta, nie awaria.
//   3. ZAPIS PRZYPINA `tenant_id` JAWNIE z `current_tenant_id()`. Domyślna
//      wartość kolumny w bazie też by go dała, ale bez jawnego pola upsert nie
//      jest idempotentny: pierwszy zapis nowego tenanta nie ma z czym kolidować.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
const stubs = vi.hoisted(() => ({ from: null as unknown }));

// Fabryka atrapy importuje WYŁĄCZNIE moduł bez zależności produkcyjnych -
// patrz komentarz w `src/test/postExperience/fixtures.ts`.
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  stubs.from = from;
  return {
    supabase: {
      from: from.from,
      rpc: (fn: string, args?: Record<string, unknown>) => h.rpc(fn, args),
    },
  };
});

import {
  postLayoutSettingsQueryOptions,
  usePostLayoutSettings,
  useSavePostLayoutSettings,
} from "@/hooks/usePostLayoutSettings";
import { defaultPostLayoutSettings, type PostLayoutSettings } from "@/lib/postLayouts";
import { fail, ok, pgError, type SupabaseFromStub } from "@/test/supabaseChain";
import { POST_IDS } from "@/test/postExperience/fixtures";

const from = () => stubs.from as SupabaseFromStub;

function harness() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

const runQuery = () => postLayoutSettingsQueryOptions().queryFn!({} as never);

beforeEach(() => {
  vi.clearAllMocks();
  from().reset();
});

describe("postLayoutSettingsQueryOptions - odczyt", () => {
  it("zwraca wiersz z bazy, gdy istnieje", async () => {
    from().setResponse(
      "post_layout_settings",
      ok({ ...defaultPostLayoutSettings(), standard_layout: "layout-6" }),
    );

    const settings = await runQuery();

    expect(settings.standard_layout).toBe("layout-6");
    expect(from().lastChain("post_layout_settings")?.has("maybeSingle")).toBe(true);
  });

  it("BRAK WIERSZA daje wartości domyślne, nie null", async () => {
    from().setResponse("post_layout_settings", ok(null));

    const settings = await runQuery();

    expect(settings).toEqual(defaultPostLayoutSettings());
    expect(settings.standard_layout).toBe("layout-1");
  });

  it("kod PGRST116 jest traktowany jak brak wiersza, nie jak awaria", async () => {
    from().setResponse("post_layout_settings", {
      data: null,
      error: pgError("JSON object requested, multiple (or no) rows returned", "PGRST116"),
    });

    const settings = await runQuery();

    expect(settings).toEqual(defaultPostLayoutSettings());
    expect(settings.center_header).toBe(true);
  });

  it("BŁĄD ODCZYTU degraduje do domyślnych, zamiast rzucać (te ustawienia są w loaderze korzenia)", async () => {
    from().setResponse("post_layout_settings", fail("permission denied for table"));

    const settings = await runQuery();

    expect(settings).toEqual(defaultPostLayoutSettings());
    expect(settings.no_sidebar_max_width).toBe(840);
  });

  it("wyjątek rzucony przez klienta też degraduje do domyślnych", async () => {
    from().setResponse("post_layout_settings", () => {
      throw new Error("network down");
    });

    const settings = await runQuery();

    expect(settings).toEqual(defaultPostLayoutSettings());
    expect(settings.tenant_id).toBe("");
  });

  it("czyta pełny wiersz jednym zapytaniem, bez listy kolumn do rozjazdu z migracją", async () => {
    from().setResponse("post_layout_settings", ok(null));

    await runQuery();

    const chain = from().lastChain("post_layout_settings");
    expect(chain?.argsOf("select")).toEqual(["*"]);
    expect(from().chainsFor("post_layout_settings")).toHaveLength(1);
  });

  it("hook zwraca ustawienia przez ten sam klucz cache co opcje zapytania", async () => {
    from().setResponse("post_layout_settings", ok({ ...defaultPostLayoutSettings() }));
    const { wrapper, queryClient } = harness();

    const { result } = renderHook(() => usePostLayoutSettings(), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(queryClient.getQueryData(["post-layout-settings"])).toBeDefined();
  });
});

describe("useSavePostLayoutSettings - zapis panelu", () => {
  it("przypina `tenant_id` z current_tenant_id() i upsertuje z konfliktem `tenant_id`", async () => {
    h.rpc.mockResolvedValue({ data: POST_IDS.tenant, error: null });
    from().setResponse("post_layout_settings", ok(null));
    const { wrapper } = harness();
    const { result } = renderHook(() => useSavePostLayoutSettings(), { wrapper });

    await result.current.mutateAsync({ standard_layout: "layout-6" });

    const chain = from().lastChain("post_layout_settings");
    expect(chain?.argsOf("upsert")?.[0]).toEqual({
      standard_layout: "layout-6",
      tenant_id: POST_IDS.tenant,
    });
    expect(chain?.argsOf("upsert")?.[1]).toEqual({ onConflict: "tenant_id" });
  });

  it("wysyła TYLKO zmienione pola (patch), nie cały wiersz", async () => {
    h.rpc.mockResolvedValue({ data: POST_IDS.tenant, error: null });
    from().setResponse("post_layout_settings", ok(null));
    const { wrapper } = harness();
    const { result } = renderHook(() => useSavePostLayoutSettings(), { wrapper });

    await result.current.mutateAsync({ paragraph_spacing_rem: 2 });

    const payload = from().lastChain("post_layout_settings")?.argsOf("upsert")?.[0] as
      Record<string, unknown> | undefined;
    expect(Object.keys(payload ?? {}).sort()).toEqual(["paragraph_spacing_rem", "tenant_id"]);
    expect(payload?.paragraph_spacing_rem).toBe(2);
  });

  it("BRAK tenanta: zapis idzie bez pola `tenant_id` (domyślna wartość kolumny w bazie)", async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    from().setResponse("post_layout_settings", ok(null));
    const { wrapper } = harness();
    const { result } = renderHook(() => useSavePostLayoutSettings(), { wrapper });

    await result.current.mutateAsync({ center_header: false });

    const payload = from().lastChain("post_layout_settings")?.argsOf("upsert")?.[0] as
      Record<string, unknown> | undefined;
    expect(payload).toEqual({ center_header: false });
    expect(payload).not.toHaveProperty("tenant_id");
  });

  it("BŁĄD ustalenia tenanta PRZERYWA zapis (nie zapisuje w cudzym wierszu)", async () => {
    h.rpc.mockResolvedValue({ data: null, error: new Error("JWT expired") });
    const { wrapper } = harness();
    const { result } = renderHook(() => useSavePostLayoutSettings(), { wrapper });

    await expect(result.current.mutateAsync({ center_header: false })).rejects.toThrow(
      /JWT expired/,
    );
    expect(from().chainsFor("post_layout_settings")).toHaveLength(0);
  });

  it("BŁĄD ZAPISU nie jest cichym sukcesem: mutacja rzuca", async () => {
    h.rpc.mockResolvedValue({ data: POST_IDS.tenant, error: null });
    from().setResponse("post_layout_settings", fail("new row violates row-level security policy"));
    const { wrapper } = harness();
    const { result } = renderHook(() => useSavePostLayoutSettings(), { wrapper });

    await expect(result.current.mutateAsync({ center_header: false })).rejects.toThrow(
      /row-level security/,
    );
    expect(from().lastChain("post_layout_settings")?.has("upsert")).toBe(true);
  });

  it("sukces unieważnia cache ustawień układu (podgląd czytelnika się odświeża)", async () => {
    h.rpc.mockResolvedValue({ data: POST_IDS.tenant, error: null });
    from().setResponse("post_layout_settings", ok(null));
    const { wrapper, queryClient } = harness();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSavePostLayoutSettings(), { wrapper });

    await result.current.mutateAsync({ show_author_card: true });

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["post-layout-settings"] }),
    );
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("pusty patch nadal przypina tenanta (upsert bez pól nie ma czego dopasować)", async () => {
    h.rpc.mockResolvedValue({ data: POST_IDS.tenant, error: null });
    from().setResponse("post_layout_settings", ok(null));
    const { wrapper } = harness();
    const { result } = renderHook(() => useSavePostLayoutSettings(), { wrapper });

    await result.current.mutateAsync({} as Partial<PostLayoutSettings>);

    expect(from().lastChain("post_layout_settings")?.argsOf("upsert")?.[0]).toEqual({
      tenant_id: POST_IDS.tenant,
    });
    expect(from().chainsFor("post_layout_settings")).toHaveLength(1);
  });
});
