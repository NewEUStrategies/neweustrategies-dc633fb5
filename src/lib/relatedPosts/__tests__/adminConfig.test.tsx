// Warstwa danych panelu /admin/related-posts. Stan wyjściowy: 0 z 8 funkcji -
// przy pliku OBOK (`settings.ts`) na 100%. Ten rozjazd nie był przypadkowy:
// `settings.ts` dostał testy razem z naprawą cichego zapisu, a adapter, przez
// który ta naprawa faktycznie dociera do bazy, został bez ani jednej asercji.
//
// Cztery reguły, których złamanie widzi ADMIN INNEGO TENANTA:
//
//   1. PANEL CZYTA I ZAPISUJE TENANTA DOMOWEGO (`current_tenant_id()`), nigdy
//      tenanta z nagłówka hosta. Inaczej admin firmy A, otwierając domenę firmy
//      B, edytowałby konfigurację B.
//   2. ODCZYT JEST ZAWĘŻONY `.eq("tenant_id", …)` - service-role i polityki RLS
//      to dwie różne warstwy, a ta jedna linia jest tą, którą widać w kodzie.
//   3. BRAK TENANTA NIE JEST BŁĘDEM ODCZYTU: formularz pokazuje defaulty, a
//      dopiero ZAPIS zwraca czytelny powód `no_tenant`.
//   4. `.select("tenant_id")` przy upsercie jest OBOWIĄZKOWE - bez niego
//      PostgREST zwraca 204 i „zapisano" znaczy „nie wiadomo".
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

import { RELATED_POSTS_DEFAULTS, type RelatedPostsConfig } from "@/lib/relatedPosts";
import {
  RELATED_POSTS_ADMIN_QUERY_KEY,
  RELATED_POSTS_PUBLIC_QUERY_KEY,
  relatedPostsAdminConfigQueryOptions,
  supabaseRelatedPostsPort,
  useSaveRelatedPostsConfig,
} from "@/lib/relatedPosts/adminConfig";
import { RelatedPostsSaveError } from "@/lib/relatedPosts/settings";
import { fail, ok, type SupabaseFromStub } from "@/test/supabaseChain";
import { POST_IDS } from "@/test/postExperience/fixtures";

const from = () => stubs.from as SupabaseFromStub;

function harness() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

/** `current_tenant_id()` zwraca tenanta domowego zalogowanego admina. */
function tenantIs(tenantId: string | null) {
  h.rpc.mockResolvedValue({ data: tenantId, error: null });
}

function tenantLookupFails(message: string) {
  h.rpc.mockResolvedValue({ data: null, error: { message } });
}

beforeEach(() => {
  vi.clearAllMocks();
  from().reset();
});

describe("relatedPostsAdminConfigQueryOptions - odczyt konfiguracji panelu", () => {
  it("czyta tenanta DOMOWEGO przez current_tenant_id(), nie z hosta", async () => {
    tenantIs(POST_IDS.tenant);
    from().setResponse("related_posts_config", ok({ enabled: true, items_limit: 6 }));

    await relatedPostsAdminConfigQueryOptions().queryFn!({} as never);

    expect(h.rpc).toHaveBeenCalledWith("current_tenant_id", undefined);
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it("zawęża odczyt do WŁASNEGO tenanta i czyta jeden wiersz", async () => {
    tenantIs(POST_IDS.tenant);
    from().setResponse("related_posts_config", ok({ enabled: true }));

    await relatedPostsAdminConfigQueryOptions().queryFn!({} as never);

    const chain = from().lastChain("related_posts_config");
    expect(chain?.argsOf("eq")).toEqual(["tenant_id", POST_IDS.tenant]);
    expect(chain?.has("maybeSingle")).toBe(true);
  });

  it("domyka odczytany wiersz defaultami (kolumna dodana migracją nie jest undefined)", async () => {
    tenantIs(POST_IDS.tenant);
    from().setResponse("related_posts_config", ok({ items_limit: 9 }));

    const config = await relatedPostsAdminConfigQueryOptions().queryFn!({} as never);

    expect(config.items_limit).toBe(9);
    expect(config.layout).toBe(RELATED_POSTS_DEFAULTS.layout);
  });

  it("BRAK WIERSZA daje defaulty, nie wyjątek (nowy tenant przed provisioningiem)", async () => {
    tenantIs(POST_IDS.tenant);
    from().setResponse("related_posts_config", ok(null));

    const config = await relatedPostsAdminConfigQueryOptions().queryFn!({} as never);

    expect(config).toEqual(RELATED_POSTS_DEFAULTS);
    expect(from().chainsFor("related_posts_config")).toHaveLength(1);
  });

  it("BRAK TENANTA daje defaulty i NIE dotyka tabeli (odczyt bez zakresu byłby wyciekiem)", async () => {
    tenantIs(null);

    const config = await relatedPostsAdminConfigQueryOptions().queryFn!({} as never);

    expect(config).toEqual(RELATED_POSTS_DEFAULTS);
    expect(from().chainsFor("related_posts_config")).toHaveLength(0);
  });

  it("błąd ustalenia tenanta PRZERYWA odczyt (nie udaje pustej konfiguracji)", async () => {
    tenantLookupFails("permission denied for function current_tenant_id");

    await expect(relatedPostsAdminConfigQueryOptions().queryFn!({} as never)).rejects.toThrow(
      /permission denied/,
    );
    expect(from().chainsFor("related_posts_config")).toHaveLength(0);
  });

  it("błąd odczytu wiersza PRZERYWA odczyt (panel nie pokaże defaultów jako stanu bazy)", async () => {
    tenantIs(POST_IDS.tenant);
    from().setResponse("related_posts_config", fail("relation does not exist"));

    await expect(relatedPostsAdminConfigQueryOptions().queryFn!({} as never)).rejects.toThrow(
      /relation does not exist/,
    );
  });

  it("klucze cache panelu i publiczny są ROZDZIELNE", () => {
    expect(RELATED_POSTS_ADMIN_QUERY_KEY).not.toEqual(RELATED_POSTS_PUBLIC_QUERY_KEY);
    expect(relatedPostsAdminConfigQueryOptions().queryKey).toEqual(RELATED_POSTS_ADMIN_QUERY_KEY);
  });
});

describe("supabaseRelatedPostsPort - adapter zapisu", () => {
  it("currentTenantId zwraca tenanta i brak błędu", async () => {
    tenantIs(POST_IDS.tenant);
    const out = await supabaseRelatedPostsPort.currentTenantId();
    expect(out).toEqual({ tenantId: POST_IDS.tenant, error: null });
  });

  it("currentTenantId przenosi komunikat błędu RPC, a nie zjada go", async () => {
    tenantLookupFails("JWT expired");
    const out = await supabaseRelatedPostsPort.currentTenantId();
    expect(out.tenantId).toBeNull();
    expect(out.error).toBe("JWT expired");
  });

  it("currentTenantId traktuje pusty napis i wartość nie-napisową jako BRAK tenanta", async () => {
    h.rpc.mockResolvedValueOnce({ data: "", error: null });
    expect((await supabaseRelatedPostsPort.currentTenantId()).tenantId).toBeNull();
    h.rpc.mockResolvedValueOnce({ data: 42, error: null });
    expect((await supabaseRelatedPostsPort.currentTenantId()).tenantId).toBeNull();
  });

  it("upsert używa konfliktu `tenant_id` i POTWIERDZA zapis przez .select('tenant_id')", async () => {
    from().setResponse("related_posts_config", ok([{ tenant_id: POST_IDS.tenant }]));

    const out = await supabaseRelatedPostsPort.upsert({
      ...RELATED_POSTS_DEFAULTS,
      tenant_id: POST_IDS.tenant,
    });

    const chain = from().lastChain("related_posts_config");
    expect(chain?.argsOf("upsert")?.[1]).toEqual({ onConflict: "tenant_id" });
    expect(chain?.argsOf("select")).toEqual(["tenant_id"]);
    expect(out).toEqual({ savedTenantIds: [POST_IDS.tenant], error: null });
  });

  it("upsert bez dopasowanego wiersza zwraca PUSTĄ listę potwierdzeń (nie sukces)", async () => {
    from().setResponse("related_posts_config", ok([]));

    const out = await supabaseRelatedPostsPort.upsert({
      ...RELATED_POSTS_DEFAULTS,
      tenant_id: POST_IDS.tenant,
    });

    expect(out.savedTenantIds).toEqual([]);
    expect(out.error).toBeNull();
  });

  it("upsert przenosi błąd bazy jako komunikat, bez rzucania", async () => {
    from().setResponse("related_posts_config", fail("duplicate key value"));

    const out = await supabaseRelatedPostsPort.upsert({
      ...RELATED_POSTS_DEFAULTS,
      tenant_id: POST_IDS.tenant,
    });

    expect(out.savedTenantIds).toEqual([]);
    expect(out.error).toBe("duplicate key value");
  });

  it("upsert na `data: null` nie wywala się na mapowaniu (fallback do pustej listy)", async () => {
    from().setResponse("related_posts_config", ok(null));

    const out = await supabaseRelatedPostsPort.upsert({
      ...RELATED_POSTS_DEFAULTS,
      tenant_id: POST_IDS.tenant,
    });

    expect(out.savedTenantIds).toEqual([]);
    expect(out.error).toBeNull();
  });
});

describe("useSaveRelatedPostsConfig - mutacja panelu", () => {
  function draft(overrides: Partial<RelatedPostsConfig> = {}): RelatedPostsConfig {
    return { ...RELATED_POSTS_DEFAULTS, enabled: true, ...overrides };
  }

  it("zapisuje wiersz WŁASNEGO tenanta", async () => {
    tenantIs(POST_IDS.tenant);
    from().setResponse("related_posts_config", ok([{ tenant_id: POST_IDS.tenant }]));
    const { wrapper } = harness();
    const { result } = renderHook(() => useSaveRelatedPostsConfig(), { wrapper });

    const saved = await result.current.mutateAsync(draft());

    expect(saved.tenant_id).toBe(POST_IDS.tenant);
    expect(from().lastChain("related_posts_config")?.has("upsert")).toBe(true);
  });

  it("cache panelu dostaje wartości PO NORMALIZACJI, nie surowy draft", async () => {
    tenantIs(POST_IDS.tenant);
    from().setResponse("related_posts_config", ok([{ tenant_id: POST_IDS.tenant }]));
    const { wrapper, queryClient } = harness();
    const { result } = renderHook(() => useSaveRelatedPostsConfig(), { wrapper });

    // 9999 jest POZA dopuszczalnym zakresem - normalizacja przycina do 24.
    await result.current.mutateAsync(draft({ items_limit: 9999 }));

    const cached = queryClient.getQueryData<RelatedPostsConfig>(RELATED_POSTS_ADMIN_QUERY_KEY);
    expect(cached?.items_limit).toBe(24);
    expect(cached).not.toHaveProperty("tenant_id");
  });

  it("sukces unieważnia PUBLICZNY cache konfiguracji (czytelnik widzi nowe ustawienia)", async () => {
    tenantIs(POST_IDS.tenant);
    from().setResponse("related_posts_config", ok([{ tenant_id: POST_IDS.tenant }]));
    const { wrapper, queryClient } = harness();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSaveRelatedPostsConfig(), { wrapper });

    await result.current.mutateAsync(draft());

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: RELATED_POSTS_PUBLIC_QUERY_KEY }),
    );
    expect(queryClient.getQueryData(RELATED_POSTS_ADMIN_QUERY_KEY)).toBeDefined();
  });

  it("BRAK TENANTA daje rozpoznawalny powód `no_tenant`, nie ogólny błąd", async () => {
    tenantIs(null);
    const { wrapper } = harness();
    const { result } = renderHook(() => useSaveRelatedPostsConfig(), { wrapper });

    await expect(result.current.mutateAsync(draft())).rejects.toBeInstanceOf(RelatedPostsSaveError);
    expect(from().chainsFor("related_posts_config")).toHaveLength(0);
  });

  it("ZAPIS NIEPOTWIERDZONY (zero wierszy) jest BŁĘDEM `not_persisted`, nie sukcesem", async () => {
    tenantIs(POST_IDS.tenant);
    from().setResponse("related_posts_config", ok([]));
    const { wrapper, queryClient } = harness();
    const { result } = renderHook(() => useSaveRelatedPostsConfig(), { wrapper });

    await expect(result.current.mutateAsync(draft())).rejects.toMatchObject({
      reason: "not_persisted",
    });
    expect(queryClient.getQueryData(RELATED_POSTS_ADMIN_QUERY_KEY)).toBeUndefined();
  });

  it("potwierdzenie CUDZEGO tenanta też jest `not_persisted` (izolacja obszarów roboczych)", async () => {
    tenantIs(POST_IDS.tenant);
    from().setResponse("related_posts_config", ok([{ tenant_id: POST_IDS.otherTenant }]));
    const { wrapper } = harness();
    const { result } = renderHook(() => useSaveRelatedPostsConfig(), { wrapper });

    await expect(result.current.mutateAsync(draft())).rejects.toMatchObject({
      reason: "not_persisted",
    });
    expect(from().lastChain("related_posts_config")?.argsOf("upsert")?.[0]).toMatchObject({
      tenant_id: POST_IDS.tenant,
    });
  });

  it("błąd zapisu daje powód `write_failed` i nie rusza cache panelu", async () => {
    tenantIs(POST_IDS.tenant);
    from().setResponse("related_posts_config", fail("permission denied"));
    const { wrapper, queryClient } = harness();
    const { result } = renderHook(() => useSaveRelatedPostsConfig(), { wrapper });

    await expect(result.current.mutateAsync(draft())).rejects.toMatchObject({
      reason: "write_failed",
    });
    expect(queryClient.getQueryData(RELATED_POSTS_ADMIN_QUERY_KEY)).toBeUndefined();
  });

  it("błąd ustalenia tenanta daje powód `tenant_lookup_failed`", async () => {
    tenantLookupFails("JWT expired");
    const { wrapper } = harness();
    const { result } = renderHook(() => useSaveRelatedPostsConfig(), { wrapper });

    await expect(result.current.mutateAsync(draft())).rejects.toMatchObject({
      reason: "tenant_lookup_failed",
    });
    expect(from().chainsFor("related_posts_config")).toHaveLength(0);
  });
});
