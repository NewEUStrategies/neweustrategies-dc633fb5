// Ustawienia layoutu strony eksperta (`expert_layout_settings`, per tenant) i
// zapis nadpisań per-ekspert (`author_profiles.layout_preset/_overrides`).
// Do 16.10.2026 na zerze - każdy test konsumenta (panel admina, /author/$slug,
// edytor profilu, inline-edytor) mockował ten moduł w całości.
//
// Reguły, których złamanie widzi czytelnik albo redakcja:
//
//   1. ODCZYT: brak wiersza (także `PGRST116`) to normalny stan nowego tenanta
//      -> domyślne z TYM tenant_id, o który pytano. Każdy INNY błąd RZUCA: loader
//      /author/$slug (`loadResilient`) sam zasiewa domyślne i oznacza stronę
//      jako zdegradowaną (no-store) - połknięty błąd byłby cache'owany na brzegu
//      jak zdrowa odpowiedź.
//   2. FILTR `tenant_id` tylko przy jawnym tenancie (profil eksperta); bez
//      niego tenanta rozstrzyga RLS. Klucz zapytania i klucz cache serwera
//      rozdzielają oba warianty, więc ustawienia tenanta A nigdy nie trafią
//      do strony eksperta tenanta B.
//   3. LEGACY PRESET: kolumna `default_preset` ma w bazie DEFAULT
//      'portrait-left', a remap presetów objął tylko `author_profiles`. Hook
//      oddaje obecne id (to samo, które rysuje renderer), inaczej panel admina
//      nie zaznacza żadnej karty, a edytor profilu pokazuje surowe id.
//   4. ZAPIS TENANTA: tenant z SESJI (`current_tenant_id()`), nigdy z payloadu;
//      brak tenanta / błąd RPC przerywa zapis zanim cokolwiek trafi do tabeli.
//   5. ZAPIS EKSPERTA: preset do kolumny, reszta do jsonb wyłącznie jako
//      faktyczne odstępstwa; po sukcesie hub i rezolucja ścieżki muszą się
//      przeładować, po błędzie - nic nie jest unieważniane.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  expertLayoutOverridesToJson,
  expertLayoutSettingsQueryOptions,
  useExpertLayoutSettings,
  useSaveExpertLayoutOverrides,
  useSaveExpertLayoutSettings,
} from "@/hooks/useExpertLayoutSettings";
import {
  defaultExpertLayoutSettings,
  parseExpertLayoutOverrides,
  type ExpertLayoutOverrides,
  type ExpertLayoutSettings,
} from "@/lib/expertLayouts";
import { clearEdgeTtlCache } from "@/lib/ssrCache";
import { fail, ok, pgError, type SupabaseFromStub } from "@/test/supabaseChain";

const TABLE = "expert_layout_settings";
const SESSION_TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const EXPERT_ID = "33333333-3333-4333-8333-333333333333";

const from = () => stubs.from as SupabaseFromStub;

function harness() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

const runQuery = (tenantId?: string | null) =>
  expertLayoutSettingsQueryOptions(tenantId).queryFn!({} as never);

const tenantRow = (patch: Partial<ExpertLayoutSettings> = {}): ExpertLayoutSettings => ({
  ...defaultExpertLayoutSettings(SESSION_TENANT),
  ...patch,
});

beforeEach(() => {
  vi.clearAllMocks();
  from().reset();
  clearEdgeTtlCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearEdgeTtlCache();
});

describe("expertLayoutSettingsQueryOptions - odczyt", () => {
  it("bez tenanta: klucz `__current__`, BEZ filtra tenant_id (rozstrzyga RLS), jeden odczyt maybeSingle", async () => {
    from().setResponse(TABLE, ok(tenantRow({ max_width: 1320 })));

    const settings = await runQuery();

    expect(expertLayoutSettingsQueryOptions().queryKey).toEqual([
      "expert-layout-settings",
      "__current__",
    ]);
    expect(expertLayoutSettingsQueryOptions(null).queryKey).toEqual([
      "expert-layout-settings",
      "__current__",
    ]);
    expect(settings.max_width).toBe(1320);
    const chain = from().lastChain(TABLE);
    expect(chain?.argsOf("select")).toEqual(["*"]);
    expect(chain?.has("eq")).toBe(false);
    expect(chain?.has("maybeSingle")).toBe(true);
    expect(from().chainsFor(TABLE)).toHaveLength(1);
  });

  it("z tenantem eksperta: klucz per tenant i jawny filtr `.eq('tenant_id', …)`", async () => {
    from().setResponse(TABLE, ok(tenantRow({ tenant_id: OTHER_TENANT, center_hero: true })));

    const settings = await runQuery(OTHER_TENANT);

    expect(expertLayoutSettingsQueryOptions(OTHER_TENANT).queryKey).toEqual([
      "expert-layout-settings",
      OTHER_TENANT,
    ]);
    expect(from().lastChain(TABLE)?.argsOf("eq")).toEqual(["tenant_id", OTHER_TENANT]);
    expect(settings).toMatchObject({ tenant_id: OTHER_TENANT, center_hero: true });
  });

  it("BRAK WIERSZA daje domyślne z tenant_id, o który pytano (a bez tenanta - pusty)", async () => {
    from().setResponse(TABLE, ok(null));

    await expect(runQuery(OTHER_TENANT)).resolves.toEqual(
      defaultExpertLayoutSettings(OTHER_TENANT),
    );
    await expect(runQuery()).resolves.toEqual(defaultExpertLayoutSettings(""));
  });

  it("kod PGRST116 jest traktowany jak brak wiersza, nie jak awaria", async () => {
    from().setResponse(TABLE, {
      data: null,
      error: pgError("JSON object requested, multiple (or no) rows returned", "PGRST116"),
    });

    const settings = await runQuery(OTHER_TENANT);

    expect(settings).toEqual(defaultExpertLayoutSettings(OTHER_TENANT));
    expect(settings.default_preset).toBe("classic");
  });

  it("INNY błąd odczytu RZUCA (loader strony eksperta sam degraduje i wyłącza cache brzegu)", async () => {
    from().setResponse(TABLE, fail("permission denied for table expert_layout_settings", "42501"));

    await expect(runQuery(OTHER_TENANT)).rejects.toThrow(/permission denied/);
  });

  it("legacy `default_preset` z bazy (DEFAULT 'portrait-left') wraca jako obecne id presetu", async () => {
    from().setResponse(TABLE, ok(tenantRow({ default_preset: "portrait-left" as never })));
    await expect(runQuery()).resolves.toMatchObject({ default_preset: "classic" });

    from().setResponse(TABLE, ok(tenantRow({ default_preset: "sidebar-rail" as never })));
    await expect(runQuery()).resolves.toMatchObject({ default_preset: "sidebar-right" });
  });

  it("nieznany preset spada na pierwszy (ten sam, który narysuje renderer), reszta wiersza bez zmian", async () => {
    from().setResponse(
      TABLE,
      ok(tenantRow({ default_preset: "retro" as never, accent_color: "#123456" })),
    );

    const settings = await runQuery();

    expect(settings).toEqual(tenantRow({ default_preset: "classic", accent_color: "#123456" }));
  });

  it("obecne id presetu przechodzi bez zmian", async () => {
    from().setResponse(TABLE, ok(tenantRow({ default_preset: "editorial" })));

    await expect(runQuery()).resolves.toMatchObject({ default_preset: "editorial" });
  });

  it("w przeglądarce cache brzegu jest przezroczysty: każdy refetch po invalidacji idzie do bazy", async () => {
    from().setResponse(TABLE, ok(tenantRow({ max_width: 900 })));
    await runQuery();
    from().setResponse(TABLE, ok(tenantRow({ max_width: 1400 })));

    const second = await runQuery();

    expect(second.max_width).toBe(1400);
    expect(from().chainsFor(TABLE)).toHaveLength(2);
  });

  it("na serwerze odczyt jest cache'owany PER TENANT - ustawienia tenanta A nie trafią do eksperta tenanta B", async () => {
    vi.stubGlobal("window", undefined);
    from().setResponse(TABLE, (chain) => {
      const tenant = chain.argsOf("eq")?.[1] as string | undefined;
      return ok(tenantRow({ tenant_id: tenant ?? SESSION_TENANT, max_width: tenant ? 900 : 1500 }));
    });

    const a1 = await runQuery(SESSION_TENANT);
    const b = await runQuery(OTHER_TENANT);
    const current = await runQuery();
    const a2 = await runQuery(SESSION_TENANT);

    expect(b).toMatchObject({ tenant_id: OTHER_TENANT, max_width: 900 });
    expect(current).toMatchObject({ tenant_id: SESSION_TENANT, max_width: 1500 });
    expect(a2).toEqual(a1);
    // A, B i wariant "current" - po jednym odczycie; drugi odczyt A z cache.
    expect(from().chainsFor(TABLE)).toHaveLength(3);
    expect(
      from()
        .chainsFor(TABLE)
        .map((c) => c.argsOf("eq")?.[1] ?? null),
    ).toEqual([SESSION_TENANT, OTHER_TENANT, null]);
  });

  it("na serwerze błąd nie jest cache'owany - kolejny render pyta bazę ponownie", async () => {
    vi.stubGlobal("window", undefined);
    from().setResponse(TABLE, fail("upstream timeout"));
    await expect(runQuery(OTHER_TENANT)).rejects.toThrow(/upstream timeout/);

    from().setResponse(TABLE, ok(tenantRow({ tenant_id: OTHER_TENANT })));
    await expect(runQuery(OTHER_TENANT)).resolves.toMatchObject({ tenant_id: OTHER_TENANT });
    expect(from().chainsFor(TABLE)).toHaveLength(2);
  });
});

describe("useExpertLayoutSettings", () => {
  it("bez tenanta zapisuje dane pod kluczem `__current__`", async () => {
    from().setResponse(TABLE, ok(tenantRow({ show_cv: false })));
    const { wrapper, queryClient } = harness();

    const { result } = renderHook(() => useExpertLayoutSettings(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.show_cv).toBe(false);
    expect(queryClient.getQueryData(["expert-layout-settings", "__current__"])).toEqual(
      result.current.data,
    );
  });

  it("z tenantem eksperta czyta jego wiersz pod jego kluczem", async () => {
    from().setResponse(TABLE, ok(tenantRow({ tenant_id: OTHER_TENANT })));
    const { wrapper, queryClient } = harness();

    const { result } = renderHook(() => useExpertLayoutSettings(OTHER_TENANT), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(["expert-layout-settings", OTHER_TENANT])).toMatchObject({
      tenant_id: OTHER_TENANT,
    });
    expect(from().lastChain(TABLE)?.argsOf("eq")).toEqual(["tenant_id", OTHER_TENANT]);
  });

  it("błąd odczytu dociera do konsumenta jako stan błędu (nie jako domyślne)", async () => {
    from().setResponse(TABLE, fail("JWT expired"));
    const { wrapper } = harness();

    const { result } = renderHook(() => useExpertLayoutSettings(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect((result.current.error as Error).message).toMatch(/JWT expired/);
  });
});

describe("useSaveExpertLayoutSettings - zapis panelu /admin/expert-layouts", () => {
  it("przypina tenant z current_tenant_id() i upsertuje z konfliktem `tenant_id`", async () => {
    h.rpc.mockResolvedValue({ data: SESSION_TENANT, error: null });
    from().setResponse(TABLE, ok(null));
    const { wrapper } = harness();
    const { result } = renderHook(() => useSaveExpertLayoutSettings(), { wrapper });

    await result.current.mutateAsync({ default_preset: "minimal", show_cv: false });

    expect(h.rpc).toHaveBeenCalledWith("current_tenant_id", undefined);
    const chain = from().lastChain(TABLE);
    expect(chain?.argsOf("upsert")).toEqual([
      { default_preset: "minimal", show_cv: false, tenant_id: SESSION_TENANT },
      { onConflict: "tenant_id" },
    ]);
  });

  it("tenant_id podany w payloadzie NIE wygrywa z tenantem sesji (nie da się zapisać cudzego wiersza)", async () => {
    h.rpc.mockResolvedValue({ data: SESSION_TENANT, error: null });
    from().setResponse(TABLE, ok(null));
    const { wrapper } = harness();
    const { result } = renderHook(() => useSaveExpertLayoutSettings(), { wrapper });

    await result.current.mutateAsync({ tenant_id: OTHER_TENANT, max_width: 1000 });

    const payload = from().lastChain(TABLE)?.argsOf("upsert")?.[0];
    expect(payload).toEqual({ tenant_id: SESSION_TENANT, max_width: 1000 });
  });

  it("BRAK tenanta w sesji przerywa zapis z czytelnym błędem - nic nie trafia do tabeli", async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    const { wrapper, queryClient } = harness();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSaveExpertLayoutSettings(), { wrapper });

    await expect(result.current.mutateAsync({ center_hero: true })).rejects.toThrow(/Brak tenanta/);
    expect(from().chainsFor(TABLE)).toHaveLength(0);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("BŁĄD RPC tenanta przerywa zapis i wraca do panelu (toast z komunikatem)", async () => {
    h.rpc.mockResolvedValue({ data: null, error: pgError("JWT expired") });
    const { wrapper } = harness();
    const { result } = renderHook(() => useSaveExpertLayoutSettings(), { wrapper });

    await expect(result.current.mutateAsync({ center_hero: true })).rejects.toThrow(/JWT expired/);
    expect(from().chainsFor(TABLE)).toHaveLength(0);
  });

  it("BŁĄD ZAPISU nie jest cichym sukcesem: mutacja rzuca, cache nie jest unieważniany", async () => {
    h.rpc.mockResolvedValue({ data: SESSION_TENANT, error: null });
    from().setResponse(TABLE, fail("new row violates row-level security policy"));
    const { wrapper, queryClient } = harness();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSaveExpertLayoutSettings(), { wrapper });

    await expect(result.current.mutateAsync({ show_programs: false })).rejects.toThrow(
      /row-level security/,
    );
    expect(from().lastChain(TABLE)?.has("upsert")).toBe(true);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("sukces unieważnia ustawienia layoutu WSZYSTKICH wariantów (panel i strony ekspertów)", async () => {
    h.rpc.mockResolvedValue({ data: SESSION_TENANT, error: null });
    from().setResponse(TABLE, ok(null));
    const { wrapper, queryClient } = harness();
    queryClient.setQueryData(["expert-layout-settings", "__current__"], tenantRow());
    queryClient.setQueryData(["expert-layout-settings", OTHER_TENANT], tenantRow());
    queryClient.setQueryData(["post-layout-settings"], { untouched: true });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSaveExpertLayoutSettings(), { wrapper });

    await result.current.mutateAsync({ accent_color: "#ff0000" });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["expert-layout-settings"] });
    expect(
      queryClient.getQueryState(["expert-layout-settings", "__current__"])?.isInvalidated,
    ).toBe(true);
    expect(queryClient.getQueryState(["expert-layout-settings", OTHER_TENANT])?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(["post-layout-settings"])?.isInvalidated).toBe(false);
  });
});

describe("expertLayoutOverridesToJson - kształt jsonb `layout_overrides`", () => {
  it("null to pusty obiekt (pełne dziedziczenie po tenancie)", () => {
    expect(expertLayoutOverridesToJson(null)).toEqual({});
  });

  it("serializuje wszystkie odstępstwa, a preset zostawia kolumnie `layout_preset`", () => {
    const overrides: ExpertLayoutOverrides = {
      preset: "editorial",
      section_order: ["cv", "details"],
      center_hero: true,
      center_details: false,
      accent_color: "#112233",
      accent_color_dark: "oklch(0.7 0.1 200)",
      visibility: { cv: false, materials: true },
    };

    expect(expertLayoutOverridesToJson(overrides)).toEqual({
      section_order: ["cv", "details"],
      center_hero: true,
      center_details: false,
      accent_color: "#112233",
      accent_color_dark: "oklch(0.7 0.1 200)",
      visibility: { cv: false, materials: true },
    });
  });

  it("`false` to świadome nadpisanie (zostaje), a `null`/brak koloru - dziedziczenie (znika)", () => {
    expect(
      expertLayoutOverridesToJson({
        center_hero: false,
        accent_color: null,
        accent_color_dark: null,
      }),
    ).toEqual({ center_hero: false });
  });

  it("widoczność: wartości nie-boolowskie odpadają, pusta mapa nie jest zapisywana", () => {
    const junk = { cv: "no", materials: null } as unknown as ExpertLayoutOverrides["visibility"];
    expect(expertLayoutOverridesToJson({ visibility: junk })).toEqual({});
    expect(expertLayoutOverridesToJson({ visibility: {} })).toEqual({});

    const mixed = { cv: false, programs: 1 } as unknown as ExpertLayoutOverrides["visibility"];
    expect(expertLayoutOverridesToJson({ visibility: mixed })).toEqual({
      visibility: { cv: false },
    });
  });

  it("kolejność sekcji jest kopiowana - późniejsza mutacja draftu nie zmienia wysłanego payloadu", () => {
    const order: ExpertLayoutOverrides["section_order"] = ["programs", "cv"];
    const json = expertLayoutOverridesToJson({ section_order: order }) as {
      section_order: string[];
    };
    order!.push("details");

    expect(json.section_order).toEqual(["programs", "cv"]);
  });

  it("round-trip przez parser bazy oddaje dokładnie te same nadpisania", () => {
    const overrides: ExpertLayoutOverrides = {
      preset: "sidebar-left",
      center_details: true,
      accent_color: "#abcdef",
      visibility: { podcast_strip: false },
    };

    const parsed = parseExpertLayoutOverrides(
      expertLayoutOverridesToJson(overrides),
      overrides.preset,
    );

    expect(parsed).toEqual(overrides);
  });
});

describe("useSaveExpertLayoutOverrides - zapis inline-edytora na /author/$slug", () => {
  it("upsertuje po `user_id`: preset do kolumny, odstępstwa do jsonb, tenant profilu", async () => {
    from().setResponse("author_profiles", ok(null));
    const { wrapper } = harness();
    const { result } = renderHook(() => useSaveExpertLayoutOverrides(), { wrapper });

    await result.current.mutateAsync({
      userId: EXPERT_ID,
      tenantId: OTHER_TENANT,
      overrides: { preset: "minimal", center_hero: true, visibility: { cv: false } },
    });

    expect(from().lastChain("author_profiles")?.argsOf("upsert")).toEqual([
      {
        user_id: EXPERT_ID,
        tenant_id: OTHER_TENANT,
        layout_preset: "minimal",
        layout_overrides: { center_hero: true, visibility: { cv: false } },
      },
      { onConflict: "user_id" },
    ]);
  });

  it("`overrides: null` czyści WSZYSTKO: kolumna presetu null, jsonb pusty", async () => {
    from().setResponse("author_profiles", ok(null));
    const { wrapper } = harness();
    const { result } = renderHook(() => useSaveExpertLayoutOverrides(), { wrapper });

    await result.current.mutateAsync({
      userId: EXPERT_ID,
      tenantId: OTHER_TENANT,
      overrides: null,
    });

    expect(from().lastChain("author_profiles")?.argsOf("upsert")?.[0]).toEqual({
      user_id: EXPERT_ID,
      tenant_id: OTHER_TENANT,
      layout_preset: null,
      layout_overrides: {},
    });
  });

  it("nadpisania bez presetu zapisują kolumnę presetu jako null (dziedziczenie presetu tenanta)", async () => {
    from().setResponse("author_profiles", ok(null));
    const { wrapper } = harness();
    const { result } = renderHook(() => useSaveExpertLayoutOverrides(), { wrapper });

    await result.current.mutateAsync({
      userId: EXPERT_ID,
      tenantId: OTHER_TENANT,
      overrides: { accent_color: "#000000" },
    });

    expect(from().lastChain("author_profiles")?.argsOf("upsert")?.[0]).toMatchObject({
      layout_preset: null,
      layout_overrides: { accent_color: "#000000" },
    });
  });

  it("sukces przeładowuje hub eksperta i rezolucję ścieżki - ustawień tenanta nie rusza", async () => {
    from().setResponse("author_profiles", ok(null));
    const { wrapper, queryClient } = harness();
    queryClient.setQueryData(["public", "expert", "jan-kowalski"], { hub: true });
    queryClient.setQueryData(["public", "resolved", "/author/jan-kowalski"], { page: true });
    queryClient.setQueryData(["expert-layout-settings", OTHER_TENANT], tenantRow());
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSaveExpertLayoutOverrides(), { wrapper });

    await result.current.mutateAsync({
      userId: EXPERT_ID,
      tenantId: OTHER_TENANT,
      overrides: { center_details: true },
    });

    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["public", "expert"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["public", "resolved"] });
    expect(queryClient.getQueryState(["public", "expert", "jan-kowalski"])?.isInvalidated).toBe(
      true,
    );
    expect(
      queryClient.getQueryState(["public", "resolved", "/author/jan-kowalski"])?.isInvalidated,
    ).toBe(true);
    expect(queryClient.getQueryState(["expert-layout-settings", OTHER_TENANT])?.isInvalidated).toBe(
      false,
    );
  });

  it("błąd RLS rzuca do edytora (toast błędu), a strona zostaje przy zapisanym stanie", async () => {
    from().setResponse("author_profiles", fail("new row violates row-level security policy"));
    const { wrapper, queryClient } = harness();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSaveExpertLayoutOverrides(), { wrapper });

    await expect(
      result.current.mutateAsync({
        userId: EXPERT_ID,
        tenantId: OTHER_TENANT,
        overrides: { center_hero: false },
      }),
    ).rejects.toThrow(/row-level security/);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
