import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_DEFAULTS, AUTH_SETTINGS_KEY } from "@/lib/authSettings";
import { createQueryClientWrapper } from "@/test/renderWithQueryClient";
import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/chat/fixtures";

const fixture = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
}));
let chain: SupabaseFromStub;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => chain.from(table) },
}));

vi.mock("@/lib/useSiteSetting", () => ({
  siteSettingsQueryOptions: {
    queryKey: ["site_settings_public", "all"],
    queryFn: async () => fixture.settings,
  },
}));

const { useAuthSettings, useSaveAuthSettings } = await import("@/hooks/useAuthSettings");

beforeEach(() => {
  fixture.settings = {};
  chain = supabaseFromStub();
  chain.setResponse("site_settings", ok(null));
});

describe("useAuthSettings", () => {
  it("zwraca wartości domyślne przed i po pustym odczycie", async () => {
    const { wrapper, queryClient } = createQueryClientWrapper();
    const { result } = renderHook(() => useAuthSettings(), { wrapper });

    expect(result.current).toEqual(AUTH_DEFAULTS);
    await waitFor(() =>
      expect(queryClient.getQueryState(["site_settings_public", AUTH_SETTINGS_KEY])?.status).toBe(
        "success",
      ),
    );
    expect(result.current).toEqual(AUTH_DEFAULTS);
    expect(result.current).not.toBe(AUTH_DEFAULTS);
  });

  it("normalizuje częściowe i uszkodzone ustawienia z cache serwisu", async () => {
    fixture.settings = {
      [AUTH_SETTINGS_KEY]: {
        popup_enabled: false,
        hero_title_pl: "Nowy tytuł",
        show_back_to_home: "nie",
        login_position: "bottom",
      },
    };
    const { wrapper } = createQueryClientWrapper();
    const { result } = renderHook(() => useAuthSettings(), { wrapper });

    await waitFor(() => expect(result.current.hero_title_pl).toBe("Nowy tytuł"));
    expect(result.current.popup_enabled).toBe(false);
    expect(result.current.show_back_to_home).toBe(AUTH_DEFAULTS.show_back_to_home);
    expect(result.current.login_position).toBe("right");
  });
});

describe("useSaveAuthSettings", () => {
  it("zapisuje rekord, aktualizuje cache optymistycznie i unieważnia oba klucze", async () => {
    const { wrapper, queryClient } = createQueryClientWrapper();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const queryKey = ["site_settings_public", AUTH_SETTINGS_KEY] as const;
    queryClient.setQueryData(queryKey, AUTH_DEFAULTS);
    const next = { ...AUTH_DEFAULTS, popup_enabled: false };
    const { result } = renderHook(() => useSaveAuthSettings(), { wrapper });

    await act(async () => result.current.mutateAsync(next));

    expect(chain.lastChain("site_settings")?.argsOf("upsert")).toEqual([
      { key: AUTH_SETTINGS_KEY, value: next },
      { onConflict: "tenant_id,key" },
    ]);
    expect(queryClient.getQueryData(queryKey)).toEqual(next);
    expect(invalidate).toHaveBeenCalledWith({ queryKey });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["site_settings_public", "all"] });
  });

  it("po błędzie przywraca poprzednią wartość cache", async () => {
    chain.setResponse("site_settings", { data: null, error: new Error("Zapis odrzucony") });
    const { wrapper, queryClient } = createQueryClientWrapper();
    const queryKey = ["site_settings_public", AUTH_SETTINGS_KEY] as const;
    const previous = { ...AUTH_DEFAULTS, hero_title_pl: "Poprzedni" };
    const next = { ...previous, hero_title_pl: "Nowy" };
    queryClient.setQueryData(queryKey, previous);
    const { result } = renderHook(() => useSaveAuthSettings(), { wrapper });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync(next);
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toEqual(new Error("Zapis odrzucony"));
    expect(queryClient.getQueryData(queryKey)).toEqual(previous);
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("po błędzie usuwa optymistyczny wpis, jeśli cache wcześniej nie istniał", async () => {
    chain.setResponse("site_settings", { data: null, error: new Error("Brak połączenia") });
    const { wrapper, queryClient } = createQueryClientWrapper();
    const queryKey = ["site_settings_public", AUTH_SETTINGS_KEY] as const;
    const { result } = renderHook(() => useSaveAuthSettings(), { wrapper });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync(AUTH_DEFAULTS);
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toEqual(new Error("Brak połączenia"));
    expect(queryClient.getQueryData(queryKey)).toBeUndefined();
    await waitFor(() => expect(result.current.failureCount).toBe(1));
  });
});
