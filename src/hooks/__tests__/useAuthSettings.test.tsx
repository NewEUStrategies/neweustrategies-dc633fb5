// Warstwa danych ustawień logowania: odczyt, rozdzielenie awarii od pustki, zapis.
//
// CO TEN PLIK DOWODZI. `useAuthSettings` czyta wiersz, od którego zależy wygląd
// i zachowanie WEJŚCIA na serwis (popup kontra /login, własny adres logowania,
// rejestracja publiczna, etykiety przycisków). Do dziś ani jedna z trzech
// funkcji tego modułu nie była wykonana w teście, mimo że:
//
//   1. ODCZYT DEGRADUJE DO DOMYŚLNYCH, NIE RZUCA. Ten hook jedzie w `/login`
//      i w headerze każdej strony - wyjątek z zapytania zabrałby wejście,
//      a nie tylko ilustrację.
//   2. AWARIA ODCZYTU MUSI BYĆ ROZRÓŻNIALNA OD BRAKU USTAWIEŃ. Panel admina
//      pokazujący domyślne po nieudanym odczycie zaprasza do zapisania ich na
//      wierzch wartości, których nie zdołał przeczytać - zapis nieodwracalny.
//      Dlatego `useAuthSettingsQuery` zwraca `isPending`/`isError`/`isConfigured`
//      osobno, a widok publiczny zostaje przy „zawsze coś pokaż".
//   3. ZAPIS UNIEWAŻNIA OBA KLUCZE CACHE. Ustawienia czyta i zapytanie
//      dedykowane, i bulk `site_settings_public/all` z loadera korzenia.
//      Unieważnienie tylko jednego zostawia stronę logowania na starej wersji
//      do wygaśnięcia `staleTime` - czyli zapis „nie działa" przez minutę.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - REGUŁ ODCZYTU: co znaczy wiersz częściowy, wartość spoza enuma i zły typ,
//   ma tabelę przypadków w `src/lib/__tests__/authSettingsRules.test.ts`. Tutaj
//   dowodzimy, że hook TEN odczyt wywołuje i respektuje jego wynik.
// - POLITYK `site_settings`: prawo zapisu egzekwuje RLS (pgTAP). Sprawdzamy
//   kształt `upsert` (klucz konfliktu `tenant_id,key`), nie autorytet.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  /** Mapa `site_settings` widziana przez hooki - `null` = odczyt nieudany. */
  settingsMap: null as Record<string, unknown> | null,
}));
const stubs = vi.hoisted(() => ({ from: null as unknown }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  stubs.from = from;
  return { supabase: { from: from.from } };
});

// Bulk odczyt ustawień jest wspólny dla całej aplikacji (jeden round-trip na
// render). Atrapa podmienia WYŁĄCZNIE jego `queryFn`, więc hooki nadal idą
// przez prawdziwe `ensureQueryData` - w tym przez jego cache.
vi.mock("@/lib/useSiteSetting", () => ({
  siteSettingsQueryOptions: {
    queryKey: ["site_settings_public", "all"],
    queryFn: async (): Promise<Record<string, unknown>> => {
      if (h.settingsMap === null) throw new Error("test: odczyt site_settings nieudany");
      return h.settingsMap;
    },
  },
}));

import {
  useAuthSettings,
  useAuthSettingsQuery,
  useSaveAuthSettings,
} from "@/hooks/useAuthSettings";
import { AUTH_DEFAULTS, AUTH_SETTINGS_KEY, type AuthSettings } from "@/lib/authSettings";
import { fail, ok, type SupabaseFromStub } from "@/test/supabaseChain";

const from = () => stubs.from as SupabaseFromStub;

function harness() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  from().reset();
  h.settingsMap = {};
});

describe("useAuthSettings - widok publiczny zawsze coś pokazuje", () => {
  it("zapytanie w locie oddaje domyślne, nie undefined", () => {
    // Pierwszy render jest synchroniczny: gdyby hook zwracał `undefined`,
    // `settings.login_position` w `AuthPortal` rzucałoby przy pierwszym renderze.
    const { wrapper } = harness();
    const { result } = renderHook(() => useAuthSettings(), { wrapper });
    expect(result.current).toEqual(AUTH_DEFAULTS);
  });

  it("wiersz z bazy nakłada się na domyślne", async () => {
    h.settingsMap = {
      [AUTH_SETTINGS_KEY]: { popup_enabled: false, custom_login_url: "/membership/login" },
    };
    const { wrapper } = harness();
    const { result } = renderHook(() => useAuthSettings(), { wrapper });
    await waitFor(() => expect(result.current.popup_enabled).toBe(false));
    expect(result.current.custom_login_url).toBe("/membership/login");
    expect(result.current.signin_label_pl).toBe(AUTH_DEFAULTS.signin_label_pl);
  });

  it("odczyt idzie przez `readAuthSettings` - wartość spoza enuma nie przechodzi", async () => {
    h.settingsMap = { [AUTH_SETTINGS_KEY]: { login_position: "top", hero_title_pl: "Wejdź" } };
    const { wrapper } = harness();
    const { result } = renderHook(() => useAuthSettings(), { wrapper });
    await waitFor(() => expect(result.current.hero_title_pl).toBe("Wejdź"));
    expect(result.current.login_position).toBe(AUTH_DEFAULTS.login_position);
  });

  it("brak klucza w mapie ustawień daje domyślne bez wyjątku", async () => {
    h.settingsMap = { reading_time: { enabled: true } };
    const { wrapper } = harness();
    const { result } = renderHook(() => useAuthSettings(), { wrapper });
    await waitFor(() => expect(result.current).toEqual(AUTH_DEFAULTS));
  });

  it("nieudany odczyt degraduje do domyślnych, nie rzuca", async () => {
    h.settingsMap = null;
    const { wrapper } = harness();
    const { result } = renderHook(() => useAuthSettings(), { wrapper });
    await waitFor(() => expect(result.current).toEqual(AUTH_DEFAULTS));
  });
});

describe("useAuthSettingsQuery - panel admina rozróżnia awarię od pustki", () => {
  it("stan oczekiwania jest jawny", () => {
    const { wrapper } = harness();
    const { result } = renderHook(() => useAuthSettingsQuery(), { wrapper });
    expect(result.current.isPending).toBe(true);
    expect(result.current.isError).toBe(false);
    expect(result.current.settings).toEqual(AUTH_DEFAULTS);
  });

  it("BRAK USTAWIEŃ: odczyt się udał, wiersza nie ma - domyślne obowiązują", async () => {
    h.settingsMap = {};
    const { wrapper } = harness();
    const { result } = renderHook(() => useAuthSettingsQuery(), { wrapper });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current).toMatchObject({
      isError: false,
      isConfigured: false,
      settings: AUTH_DEFAULTS,
    });
  });

  it("AWARIA ODCZYTU: to inny stan niż brak ustawień - i to jest cała treść testu", async () => {
    h.settingsMap = null;
    const { wrapper } = harness();
    const { result } = renderHook(() => useAuthSettingsQuery(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isPending).toBe(false);
    // `isConfigured` NIE udaje, że wiersza nie ma: awaria znaczy „nie wiem".
    expect(result.current.isConfigured).toBe(false);
  });

  it("WIERSZ OBECNY: isConfigured rozdziela zapisane domyślne od braku zapisu", async () => {
    // Administrator, który świadomie zapisał wartości równe domyślnym, ma widzieć
    // panel skonfigurowany - inaczej reset niczego by nie zmieniał i nie było
    // sposobu odróżnić instalacji nowej od wyzerowanej.
    h.settingsMap = { [AUTH_SETTINGS_KEY]: { ...AUTH_DEFAULTS } };
    const { wrapper } = harness();
    const { result } = renderHook(() => useAuthSettingsQuery(), { wrapper });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.isConfigured).toBe(true);
    expect(result.current.settings).toEqual(AUTH_DEFAULTS);
  });

  it("wiersz `null` w mapie czyta się jako brak konfiguracji", async () => {
    h.settingsMap = { [AUTH_SETTINGS_KEY]: null };
    const { wrapper } = harness();
    const { result } = renderHook(() => useAuthSettingsQuery(), { wrapper });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.isConfigured).toBe(false);
    expect(result.current.isError).toBe(false);
  });
});

describe("useSaveAuthSettings - zapis i unieważnienie cache", () => {
  const value: AuthSettings = { ...AUTH_DEFAULTS, hero_title_pl: "Wejdź" };

  it("zapisuje przez upsert z kluczem konfliktu `tenant_id,key`", async () => {
    from().setResponse("site_settings", ok(null));
    const { wrapper } = harness();
    const { result } = renderHook(() => useSaveAuthSettings(), { wrapper });
    await result.current.mutateAsync(value);

    const chain = from().lastChain("site_settings");
    expect(chain?.has("upsert")).toBe(true);
    const [row, options] = chain?.argsOf("upsert") ?? [];
    expect(row).toMatchObject({ key: AUTH_SETTINGS_KEY });
    // Bez jawnego klucza konfliktu pierwszy zapis nowego tenanta nie ma z czym
    // kolidować, a drugi wstawia DRUGI wiersz tego samego klucza.
    expect(options).toEqual({ onConflict: "tenant_id,key" });
  });

  it("zapisany payload niesie pełny kształt ustawień, nie tylko zmienione pole", async () => {
    from().setResponse("site_settings", ok(null));
    const { wrapper } = harness();
    const { result } = renderHook(() => useSaveAuthSettings(), { wrapper });
    await result.current.mutateAsync(value);

    const [row] = from().lastChain("site_settings")?.argsOf("upsert") ?? [];
    const saved = (row as { value: Record<string, unknown> }).value;
    expect(Object.keys(saved).sort()).toEqual(Object.keys(AUTH_DEFAULTS).sort());
    expect(saved.hero_title_pl).toBe("Wejdź");
  });

  it("po udanym zapisie unieważnia OBA klucze - dedykowany i bulk", async () => {
    from().setResponse("site_settings", ok(null));
    const { queryClient, wrapper } = harness();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSaveAuthSettings(), { wrapper });
    await result.current.mutateAsync(value);

    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2));
    const keys = invalidate.mock.calls.map(([args]) => args?.queryKey);
    expect(keys).toEqual([
      ["site_settings_public", AUTH_SETTINGS_KEY],
      ["site_settings_public", "all"],
    ]);
  });

  it("błąd bazy jest rzucany dalej i NIE unieważnia cache", async () => {
    // Unieważnienie po nieudanym zapisie pokazałoby administratorowi ponownie
    // wartość z bazy i wyglądałoby jak cofnięcie jego zmian.
    from().setResponse("site_settings", fail("odmowa polityki", "42501"));
    const { queryClient, wrapper } = harness();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSaveAuthSettings(), { wrapper });

    await expect(result.current.mutateAsync(value)).rejects.toMatchObject({ code: "42501" });
    expect(invalidate).not.toHaveBeenCalled();
  });
});
