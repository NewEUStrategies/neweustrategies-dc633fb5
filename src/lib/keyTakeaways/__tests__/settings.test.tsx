// Warstwa ustawień sekcji „Z tego materiału dowiesz się...". Stan wyjściowy:
// 0 z 5 funkcji - schemat, hook odczytu i cały zapis panelu stały na zerze,
// mimo że ten wiersz decyduje o wyglądzie sekcji na KAŻDYM wpisie tenanta.
//
// Trzy reguły, których złamanie widzi użytkownik:
//
//   1. WARIANT „GHOST" MA NIEZALEŻNE PODŚWIETLENIE PER JĘZYK. `indicesPl` i
//      `indicesEn` są osobne, bo PL i EN mają inną liczbę i kolejność słów
//      etykiety; `indices` (legacy) jest tylko fallbackiem. Zwinięcie tych
//      trzech pól w jedno podświetlałoby w EN przypadkowe słowa.
//   2. USZKODZONY WIERSZ NIE GASI SEKCJI. `useKeyTakeawaysSettings` degraduje do
//      wartości domyślnych, zamiast puszczać dalej nieudaną walidację.
//   3. ZAPIS JEST UPSERTEM Z JAWNYM KONFLIKTEM `tenant_id,key`, a błąd bazy NIE
//      JEST cichym sukcesem - panel musi pokazać komunikat, nie „Zapisano".
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

const stubs = vi.hoisted(() => ({ from: null as unknown }));

vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, error: h.toastError },
}));

// Fabryka atrapy importuje WYŁĄCZNIE moduł bez zależności produkcyjnych -
// patrz komentarz w `src/test/postExperience/fixtures.ts`.
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  stubs.from = from;
  return { supabase: { from: from.from } };
});

import {
  KEY_TAKEAWAYS_DEFAULTS,
  KEY_TAKEAWAYS_SETTING_KEY,
  KEY_TAKEAWAYS_VARIANTS,
  KeyTakeawaysSettingsSchema,
  useKeyTakeawaysSettings,
  useSaveKeyTakeawaysSettings,
  type KeyTakeawaysSettings,
} from "@/lib/keyTakeaways/settings";
import { fail, ok, type SupabaseFromStub } from "@/test/supabaseChain";
import { SITE_SETTINGS_QUERY_KEY, keyTakeawaysSettings } from "@/test/postExperience/fixtures";
import { resetPendingWrites } from "@/lib/useSiteSetting";

const from = () => stubs.from as SupabaseFromStub;

function harness(settings?: Record<string, unknown>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (settings) queryClient.setQueryData(SITE_SETTINGS_QUERY_KEY, settings);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  from().reset();
  resetPendingWrites();
});

describe("KeyTakeawaysSettingsSchema - domykanie i odsiew", () => {
  it("pusty obiekt daje pełny zestaw domyślnych", () => {
    const parsed = KeyTakeawaysSettingsSchema.parse({});
    expect(parsed).toEqual(KEY_TAKEAWAYS_DEFAULTS);
    expect(parsed.variant).toBe("card");
  });

  it("każdy wariant z katalogu przechodzi walidację", () => {
    for (const variant of KEY_TAKEAWAYS_VARIANTS) {
      expect(KeyTakeawaysSettingsSchema.safeParse({ variant }).success).toBe(true);
    }
    expect(KEY_TAKEAWAYS_VARIANTS).toContain("ghost");
  });

  it("wariant spoza katalogu jest odrzucany", () => {
    expect(KeyTakeawaysSettingsSchema.safeParse({ variant: "neon" }).success).toBe(false);
    expect(KeyTakeawaysSettingsSchema.safeParse({ variant: 7 }).success).toBe(false);
  });

  it("brakujące pole zagnieżdżone jest domykane, podane zostaje", () => {
    const parsed = KeyTakeawaysSettingsSchema.parse({ colors: { accent: "#00ff00" } });
    expect(parsed.colors.accent).toBe("#00ff00");
    expect(parsed.colors.bg).toBe(KEY_TAKEAWAYS_DEFAULTS.colors.bg);
  });

  it("podświetlenie ghost ma TRZY niezależne listy indeksów, domyślnie puste", () => {
    const parsed = KeyTakeawaysSettingsSchema.parse({});
    expect(parsed.highlight.indicesPl).toEqual([]);
    expect(parsed.highlight.indicesEn).toEqual([]);
    expect(parsed.highlight.indices).toEqual([]);
  });

  it("indeksy PL i EN są zapisywane NIEZALEŻNIE od siebie", () => {
    const parsed = KeyTakeawaysSettingsSchema.parse({
      highlight: { indicesPl: [0, 2], indicesEn: [1] },
    });
    expect(parsed.highlight.indicesPl).toEqual([0, 2]);
    expect(parsed.highlight.indicesEn).toEqual([1]);
  });

  it("indeks ujemny albo powyżej 20 jest odrzucany (etykieta nie ma tyle słów)", () => {
    expect(KeyTakeawaysSettingsSchema.safeParse({ highlight: { indicesPl: [-1] } }).success).toBe(
      false,
    );
    expect(KeyTakeawaysSettingsSchema.safeParse({ highlight: { indicesPl: [21] } }).success).toBe(
      false,
    );
  });

  it("indeks niecałkowity jest odrzucany", () => {
    expect(KeyTakeawaysSettingsSchema.safeParse({ highlight: { indicesEn: [1.5] } }).success).toBe(
      false,
    );
  });

  it("skala rozmiaru trzyma się zakresu 0,5..3", () => {
    expect(KeyTakeawaysSettingsSchema.safeParse({ highlight: { sizeScale: 0.5 } }).success).toBe(
      true,
    );
    expect(KeyTakeawaysSettingsSchema.safeParse({ highlight: { sizeScale: 3 } }).success).toBe(
      true,
    );
    expect(KeyTakeawaysSettingsSchema.safeParse({ highlight: { sizeScale: 0.4 } }).success).toBe(
      false,
    );
    expect(KeyTakeawaysSettingsSchema.safeParse({ highlight: { sizeScale: 3.1 } }).success).toBe(
      false,
    );
  });

  it("przesunięcie w pionie trzyma się zakresu -200..200", () => {
    expect(KeyTakeawaysSettingsSchema.safeParse({ highlight: { offsetY: -200 } }).success).toBe(
      true,
    );
    expect(KeyTakeawaysSettingsSchema.safeParse({ highlight: { offsetY: 201 } }).success).toBe(
      false,
    );
  });

  it("grubość obramowania trzyma się zakresu 0..8", () => {
    expect(KeyTakeawaysSettingsSchema.safeParse({ colors: { borderWidth: 0 } }).success).toBe(true);
    expect(KeyTakeawaysSettingsSchema.safeParse({ colors: { borderWidth: 8 } }).success).toBe(true);
    expect(KeyTakeawaysSettingsSchema.safeParse({ colors: { borderWidth: 9 } }).success).toBe(
      false,
    );
  });

  it("pusty napis koloru jest odrzucany (COLOR ma min. 1 znak)", () => {
    expect(KeyTakeawaysSettingsSchema.safeParse({ colors: { accent: "" } }).success).toBe(false);
    expect(KeyTakeawaysSettingsSchema.safeParse({ icon: "" }).success).toBe(false);
  });
});

describe("useKeyTakeawaysSettings - odczyt globalnych ustawień", () => {
  it("brak wiersza daje wartości domyślne", async () => {
    const { wrapper } = harness({});
    const { result } = renderHook(() => useKeyTakeawaysSettings(), { wrapper });
    await waitFor(() => expect(result.current.variant).toBe("card"));
    expect(result.current.enabled).toBe(true);
  });

  it("wiersz częściowy jest domykany defaultami", async () => {
    const { wrapper } = harness({
      [KEY_TAKEAWAYS_SETTING_KEY]: { variant: "ghost", numbered: false },
    });
    const { result } = renderHook(() => useKeyTakeawaysSettings(), { wrapper });
    await waitFor(() => expect(result.current.variant).toBe("ghost"));
    expect(result.current.numbered).toBe(false);
    expect(result.current.colors.accent).toBe(KEY_TAKEAWAYS_DEFAULTS.colors.accent);
  });

  it("USZKODZONY wiersz degraduje do defaultów, zamiast gasić sekcję", async () => {
    const { wrapper } = harness({
      [KEY_TAKEAWAYS_SETTING_KEY]: { variant: "neon", highlight: { sizeScale: 99 } },
    });
    const { result } = renderHook(() => useKeyTakeawaysSettings(), { wrapper });
    await waitFor(() => expect(result.current.variant).toBe(KEY_TAKEAWAYS_DEFAULTS.variant));
    expect(result.current.highlight.sizeScale).toBe(KEY_TAKEAWAYS_DEFAULTS.highlight.sizeScale);
  });

  it("zachowuje niezależne indeksy podświetlenia z bazy", async () => {
    const { wrapper } = harness({
      [KEY_TAKEAWAYS_SETTING_KEY]: { highlight: { indicesPl: [1], indicesEn: [0, 3] } },
    });
    const { result } = renderHook(() => useKeyTakeawaysSettings(), { wrapper });
    await waitFor(() => expect(result.current.highlight.indicesPl).toEqual([1]));
    expect(result.current.highlight.indicesEn).toEqual([0, 3]);
  });
});

describe("useSaveKeyTakeawaysSettings - zapis panelu", () => {
  function draft(overrides: Partial<KeyTakeawaysSettings> = {}): KeyTakeawaysSettings {
    return keyTakeawaysSettings({ variant: "ghost", ...overrides });
  }

  it("zapisuje UPSERTEM z kluczem konfliktu `tenant_id,key`", async () => {
    from().setResponse("site_settings", ok(null));
    const { wrapper } = harness();
    const { result } = renderHook(() => useSaveKeyTakeawaysSettings(), { wrapper });

    await result.current.mutateAsync(draft());

    const chain = from().lastChain("site_settings");
    expect(chain?.has("upsert")).toBe(true);
    expect(chain?.argsOf("upsert")?.[1]).toEqual({ onConflict: "tenant_id,key" });
  });

  it("wysyła KLUCZ ustawienia i wartość draftu", async () => {
    from().setResponse("site_settings", ok(null));
    const { wrapper } = harness();
    const { result } = renderHook(() => useSaveKeyTakeawaysSettings(), { wrapper });

    await result.current.mutateAsync(draft({ numbered: false }));

    const row = from().lastChain("site_settings")?.argsOf("upsert")?.[0] as {
      key: string;
      value: KeyTakeawaysSettings;
    };
    expect(row.key).toBe(KEY_TAKEAWAYS_SETTING_KEY);
    expect(row.value).toMatchObject({ variant: "ghost", numbered: false });
  });

  it("sukces unieważnia zbiorczy cache ustawień i potwierdza zapis", async () => {
    from().setResponse("site_settings", ok(null));
    const { wrapper, queryClient } = harness();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSaveKeyTakeawaysSettings(), { wrapper });

    await result.current.mutateAsync(draft());

    expect(invalidate).toHaveBeenCalledWith({ queryKey: SITE_SETTINGS_QUERY_KEY });
    expect(h.toastSuccess).toHaveBeenCalledTimes(1);
  });

  it("indeksy podświetlenia trafiają do bazy OSOBNO dla PL i EN", async () => {
    from().setResponse("site_settings", ok(null));
    const { wrapper } = harness();
    const { result } = renderHook(() => useSaveKeyTakeawaysSettings(), { wrapper });

    await result.current.mutateAsync(
      draft({
        highlight: { ...KEY_TAKEAWAYS_DEFAULTS.highlight, indicesPl: [0, 1], indicesEn: [2] },
      }),
    );

    const row = from().lastChain("site_settings")?.argsOf("upsert")?.[0] as {
      value: KeyTakeawaysSettings;
    };
    expect(row.value.highlight.indicesPl).toEqual([0, 1]);
    expect(row.value.highlight.indicesEn).toEqual([2]);
  });

  it("BŁĄD BAZY nie jest cichym sukcesem: mutacja rzuca i pokazuje komunikat", async () => {
    from().setResponse("site_settings", fail("new row violates row-level security policy"));
    const { wrapper } = harness();
    const { result } = renderHook(() => useSaveKeyTakeawaysSettings(), { wrapper });

    await expect(result.current.mutateAsync(draft())).rejects.toThrow(/row-level security/);
    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("błąd bez treści komunikatu nadal daje komunikat dla użytkownika", async () => {
    from().setResponse("site_settings", fail(""));
    const { wrapper } = harness();
    const { result } = renderHook(() => useSaveKeyTakeawaysSettings(), { wrapper });

    await expect(result.current.mutateAsync(draft())).rejects.toThrow();
    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    expect(h.toastError.mock.calls[0][0]).toBeTruthy();
  });
});
