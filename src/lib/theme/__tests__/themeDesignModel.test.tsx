// MODEL MOTYWU - `themeDesign.ts`. Do 18.08.2026: 4 z 28 funkcji, 43,8% linii.
//
// DLACZEGO TO WAŻNE. Tokeny stąd wchodzą na ścieżkę bootowania i decydują o
// wyglądzie CAŁEGO serwisu: nagłówki bloków, miniatury, przycisk „czytaj
// więcej”, meta-informacje, ikony społecznościowe, tytuły i zajawki wpisów.
// Wartość, która tu przecieknie, ląduje w `<style>` na każdej stronie.
//
// CZEGO NIE MA W ISTNIEJĄCYM `themeDesign.test.ts`. Tamten plik pokrywa trzy
// asercje na `themeDesignToCss`. Ten dokłada resztę: normalizację kolorów
// odziedziczonych po starych wierszach, tryb ciemny, model językowy
// (wspólny vs osobny PL/EN), hooki react-query i podgląd na żywo.
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  upsertError: null as { message: string } | null,
  upserts: [] as Array<Record<string, unknown>>,
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      upsert: async (payload: Record<string, unknown>) => {
        h.upserts.push(payload);
        return { error: h.upsertError };
      },
    }),
  },
}));
vi.mock("@/lib/notify", () => ({
  notifySuccess: h.notifySuccess,
  notifyError: h.notifyError,
}));
vi.mock("@/lib/useSiteSetting", () => ({
  siteSettingsQueryOptions: {
    queryKey: ["site_settings_public", "all"],
    queryFn: async () => h.settings,
  },
}));

import {
  THEME_DESIGN_COLOR_INHERITANCE,
  THEME_DESIGN_DEFAULTS,
  THEME_DESIGN_LANG_DEFAULTS,
  themeDesignToCss,
  themeDesignToStyleVars,
  useLiveThemeDesignPreview,
  useSaveThemeDesign,
  useSaveThemeDesignLangMode,
  useThemeDesign,
  useThemeDesignEn,
  useThemeDesignFor,
  useThemeDesignLangMode,
  type ThemeDesign,
} from "@/lib/theme/themeDesign";

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  h.settings = {};
  h.upsertError = null;
  h.upserts.length = 0;
  h.notifySuccess.mockReset();
  h.notifyError.mockReset();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

/** Kopia domyślnych ustawień z nadpisaną jedną sekcją. */
function withSection<K extends keyof ThemeDesign>(
  section: K,
  patch: Partial<ThemeDesign[K]>,
): ThemeDesign {
  return {
    ...THEME_DESIGN_DEFAULTS,
    [section]: { ...(THEME_DESIGN_DEFAULTS[section] as object), ...patch },
  } as ThemeDesign;
}

// ---------------------------------------------------------------------------
// Schemat i domyślne wartości
// ---------------------------------------------------------------------------

describe("THEME_DESIGN_DEFAULTS", () => {
  it("każda sekcja z mapy dziedziczenia ma odpowiednik w domyślnych", () => {
    // Rozjazd tych dwóch struktur daje pole koloru bez podpowiedzi „dziedzicz”
    // - albo, gorzej, kolor twardo wpisany zamiast referencji do tokenu.
    for (const section of Object.keys(THEME_DESIGN_COLOR_INHERITANCE)) {
      expect(THEME_DESIGN_DEFAULTS).toHaveProperty(section);
    }
  });

  it("domyślne kolory SĄ referencjami do tokenów globalnych, nie literałami", () => {
    // To jest cała idea: Theme Design nie może odcinać zakładek „Global kolory”
    // / „Przyciski” / „Pola tekstowe”. Domyślna wartość musi być `var(--gc-*)`.
    const inheritance: Record<
      string,
      Record<string, { token: string }>
    > = THEME_DESIGN_COLOR_INHERITANCE;
    for (const [section, fields] of Object.entries(inheritance)) {
      const record = THEME_DESIGN_DEFAULTS[section as keyof ThemeDesign] as Record<string, unknown>;
      for (const [field, spec] of Object.entries(fields)) {
        expect(record[field]).toBe(spec.token);
      }
    }
  });

  it("zaczyna bez nadpisań trybu ciemnego", () => {
    expect(THEME_DESIGN_DEFAULTS.darkOverrides).toEqual({});
  });

  it("liczby są liczbami, a wymiary napisami z jednostką", () => {
    expect(THEME_DESIGN_DEFAULTS.blockHeading.fontWeight).toBe(700);
    expect(THEME_DESIGN_DEFAULTS.blockHeading.fontSize).toBe("18px");
    expect(THEME_DESIGN_DEFAULTS.thumbnail.aspectRatio).toBe("16/9");
  });

  it("domyślny model językowy to WSPÓLNY dla PL i EN", () => {
    expect(THEME_DESIGN_LANG_DEFAULTS).toEqual({ mode: "shared" });
  });
});

// ---------------------------------------------------------------------------
// Serializacja do CSS
// ---------------------------------------------------------------------------

describe("themeDesignToCss - tokeny statyczne", () => {
  it("emituje cienie odpowiadające poziomom miniatury", () => {
    expect(themeDesignToCss(withSection("thumbnail", { shadow: "none" }))).toContain(
      "--td-thumb-shadow:none;",
    );
    for (const level of ["sm", "md", "lg"] as const) {
      const css = themeDesignToCss(withSection("thumbnail", { shadow: level }));
      expect(css).toContain("--td-thumb-shadow:0 ");
      expect(css).not.toContain("--td-thumb-shadow:none;");
    }
  });

  it("mapuje separator meta na właściwy znak treści", () => {
    const sep = (separator: ThemeDesign["metaInfo"]["separator"]) =>
      themeDesignToCss(withSection("metaInfo", { separator })).match(/--td-meta-sep:([^;]*);/)?.[1];

    expect(sep("dot")).toBe('"\\2022"');
    expect(sep("slash")).toBe('"/"');
    expect(sep("pipe")).toBe('"|"');
    // „brak” to pusty string treści, nie brak zmiennej - inaczej stary token
    // z poprzedniego renderu zostałby w kaskadzie.
    expect(sep("none")).toBe('""');
  });

  it("zamienia flagi wersalików na wartość CSS", () => {
    expect(themeDesignToCss(withSection("readMoreButton", { uppercase: true }))).toContain(
      "--td-rm-transform:uppercase;",
    );
    expect(themeDesignToCss(withSection("readMoreButton", { uppercase: false }))).toContain(
      "--td-rm-transform:none;",
    );
    expect(themeDesignToCss(withSection("metaInfo", { uppercase: true }))).toContain(
      "--td-meta-transform:uppercase;",
    );
  });
});

describe("themeDesignToCss - normalizacja kolorów", () => {
  it("rozwija stare opakowanie hsl(var(--x)) do samego var(--x)", () => {
    // Tokeny trzymają dziś gotowe wartości (hex, oklch, color-mix), więc
    // `hsl(#F8F6F4)` jest niepoprawnym CSS-em, który przeglądarka po cichu
    // odrzuca - efekt: nieczytelny tekst w trybie ciemnym.
    const css = themeDesignToCss(withSection("blockHeading", { color: "hsl(var(--foreground))" }));
    expect(css).toContain("--td-bh-color:var(--foreground);");
    expect(css).not.toContain("hsl(var(--foreground))");
  });

  it("rozwija wariant z kanałem alfa", () => {
    const css = themeDesignToCss(withSection("blockHeading", { color: "hsl(var(--brand) / .5)" }));
    expect(css).toContain("--td-bh-color:var(--brand);");
  });

  it("nie rusza wartości, które nie są opakowaniem hsl", () => {
    const css = themeDesignToCss(withSection("blockHeading", { color: "oklch(0.7 0.2 40)" }));
    expect(css).toContain("--td-bh-color:oklch(0.7 0.2 40);");
  });

  it("pomija pole koloru o pustej wartości zamiast emitować pusty token", () => {
    // `--td-bh-color:;` to niepoprawna deklaracja - cała reguła bywa odrzucana.
    const css = themeDesignToCss(withSection("blockHeading", { color: "" }));
    expect(css).not.toContain("--td-bh-color:;");
  });
});

describe("themeDesignToCss - tryb ciemny", () => {
  it("BEZ nadpisań nie emituje bloku .dark", () => {
    // Pusty blok `.dark{}` byłby szumem na każdej stronie serwisu.
    expect(themeDesignToCss(THEME_DESIGN_DEFAULTS)).not.toContain(".dark{");
  });

  it("emituje wyłącznie te tokeny, które mają nadpisanie", () => {
    const css = themeDesignToCss({
      ...THEME_DESIGN_DEFAULTS,
      darkOverrides: { blockHeading: { color: "#ffffff" } },
    });
    const dark = css.match(/\.dark\{([^}]*)\}/)?.[1] ?? "";
    expect(dark).toBe("--td-bh-color:#ffffff;");
  });

  it("puste nadpisanie oznacza DZIEDZICZ, nie pusty token", () => {
    const css = themeDesignToCss({
      ...THEME_DESIGN_DEFAULTS,
      darkOverrides: { blockHeading: { color: "" } },
    });
    expect(css).not.toContain(".dark{");
  });

  it("normalizuje także wartości nadpisań", () => {
    const css = themeDesignToCss({
      ...THEME_DESIGN_DEFAULTS,
      darkOverrides: { postTitle: { hoverColor: "hsl(var(--brand))" } },
    });
    expect(css).toContain("--td-pt-hover:var(--brand);");
  });

  it("nadpisanie sekcji spoza mapy kolorów jest ignorowane", () => {
    const css = themeDesignToCss({
      ...THEME_DESIGN_DEFAULTS,
      darkOverrides: { nieistniejaca: { color: "#f00" } },
    });
    expect(css).not.toContain("#f00");
  });
});

describe("themeDesignToStyleVars", () => {
  it("rozkłada blok jasny na obiekt zmiennych CSS", () => {
    const vars = themeDesignToStyleVars(THEME_DESIGN_DEFAULTS);
    expect(vars["--td-bh-size"]).toBe("18px");
    expect(vars["--td-thumb-ratio"]).toBe("16/9");
    // Każdy klucz jest zmienną CSS - nic innego nie ma prawa wyjść.
    expect(Object.keys(vars).every((k) => k.startsWith("--"))).toBe(true);
  });

  it("zachowuje wartości zawierające DWUKROPEK", () => {
    // `var(--fs-small, 13px)` i `color-mix(in oklab, …)` mają dwukropki w
    // środku; naiwny split po „:” obciąłby je do śmieci.
    const vars = themeDesignToStyleVars(THEME_DESIGN_DEFAULTS);
    expect(vars["--td-meta-size"]).toBe("var(--fs-small, 13px)");
  });

  it("tryb ciemny NAKŁADA nadpisania na wartości jasne", () => {
    const design: ThemeDesign = {
      ...THEME_DESIGN_DEFAULTS,
      darkOverrides: { blockHeading: { color: "#ffffff" } },
    };
    const light = themeDesignToStyleVars(design, "light");
    const dark = themeDesignToStyleVars(design, "dark");

    expect(dark["--td-bh-color"]).toBe("#ffffff");
    expect(light["--td-bh-color"]).not.toBe("#ffffff");
    // Tokeny bez nadpisania muszą przetrwać nałożenie.
    expect(dark["--td-bh-size"]).toBe(light["--td-bh-size"]);
  });

  it("tryb ciemny bez nadpisań daje ten sam zestaw co jasny", () => {
    expect(themeDesignToStyleVars(THEME_DESIGN_DEFAULTS, "dark")).toEqual(
      themeDesignToStyleVars(THEME_DESIGN_DEFAULTS, "light"),
    );
  });
});

// ---------------------------------------------------------------------------
// Odczyt: hooki react-query
// ---------------------------------------------------------------------------

describe("useThemeDesign - odczyt i scalanie", () => {
  it("brak wiersza daje pełne wartości domyślne", async () => {
    const { result } = renderHook(() => useThemeDesign(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(THEME_DESIGN_DEFAULTS);
  });

  it("wiersz CZĘŚCIOWY jest scalany z domyślnymi, nie zastępuje ich", () => {
    // Zapisana jedna wartość nie może wyzerować pozostałych trzydziestu.
    h.settings = { theme_design: { blockHeading: { fontSize: "24px" } } };
    const { result } = renderHook(() => useThemeDesign(), { wrapper });
    return waitFor(() => {
      expect(result.current.data?.blockHeading.fontSize).toBe("24px");
      expect(result.current.data?.blockHeading.fontWeight).toBe(
        THEME_DESIGN_DEFAULTS.blockHeading.fontWeight,
      );
      expect(result.current.data?.thumbnail).toEqual(THEME_DESIGN_DEFAULTS.thumbnail);
    });
  });

  it("wiersz USZKODZONY spada na wartości domyślne zamiast wywracać motyw", async () => {
    // Zły typ w bazie nie może zostawić serwisu bez tokenów - to byłaby strona
    // bez stylu, nie „strona z jednym błędnym polem”.
    h.settings = { theme_design: { blockHeading: { fontWeight: "gruby" } } };
    const { result } = renderHook(() => useThemeDesign(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(THEME_DESIGN_DEFAULTS);
  });

  it("liczba w polu wymiaru dostaje jednostkę px", async () => {
    h.settings = { theme_design: { blockHeading: { fontSize: 24 } } };
    const { result } = renderHook(() => useThemeDesign(), { wrapper });
    await waitFor(() => expect(result.current.data?.blockHeading.fontSize).toBe("24px"));
  });

  it("PODMIENIA stare kolory odziedziczone na referencję do tokenu", async () => {
    // Wiersze sprzed wprowadzenia dziedziczenia trzymają literał (#fa9346),
    // który ODCINA zakładkę „Przyciski”: zmiana koloru marki nie ruszałaby
    // przycisku „czytaj więcej”.
    h.settings = { theme_design: { readMoreButton: { color: "#fa9346" } } };
    const { result } = renderHook(() => useThemeDesign(), { wrapper });
    await waitFor(() =>
      expect(result.current.data?.readMoreButton.color).toBe(
        THEME_DESIGN_COLOR_INHERITANCE.readMoreButton.color.token,
      ),
    );
  });

  it("NIE rusza koloru wybranego świadomie przez redaktora", async () => {
    h.settings = { theme_design: { readMoreButton: { color: "#123456" } } };
    const { result } = renderHook(() => useThemeDesign(), { wrapper });
    await waitFor(() => expect(result.current.data?.readMoreButton.color).toBe("#123456"));
  });

  it("USUWA nadpisanie ciemne, które było starą wartością odziedziczoną", async () => {
    h.settings = {
      theme_design: { darkOverrides: { readMoreButton: { color: "var(--brand)" } } },
    };
    const { result } = renderHook(() => useThemeDesign(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Po usunięciu jedynego pola cała sekcja nadpisań znika - inaczej zostałby
    // pusty obiekt emitujący pusty blok `.dark`.
    expect(result.current.data?.darkOverrides.readMoreButton).toBeUndefined();
  });

  it("porównanie starych wartości ignoruje wielkość liter i spacje", async () => {
    h.settings = { theme_design: { readMoreButton: { color: "  VAR( --BRAND )  " } } };
    const { result } = renderHook(() => useThemeDesign(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.readMoreButton.color).toBe(
      THEME_DESIGN_COLOR_INHERITANCE.readMoreButton.color.token,
    );
  });

  it("wersja EN czyta WŁASNY klucz ustawienia", async () => {
    h.settings = {
      theme_design: { blockHeading: { fontSize: "10px" } },
      theme_design_en: { blockHeading: { fontSize: "30px" } },
    };
    const { result } = renderHook(() => useThemeDesignEn(), { wrapper });
    await waitFor(() => expect(result.current.data?.blockHeading.fontSize).toBe("30px"));
  });
});

describe("useThemeDesignLangMode", () => {
  it("brak ustawienia to tryb WSPÓLNY", async () => {
    const { result } = renderHook(() => useThemeDesignLangMode(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ mode: "shared" }));
  });

  it("czyta tryb OSOBNY", async () => {
    h.settings = { theme_design_lang_mode: { mode: "split" } };
    const { result } = renderHook(() => useThemeDesignLangMode(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ mode: "split" }));
  });

  it("nieznana wartość spada na tryb wspólny", async () => {
    // Fail-safe: nieznany tryb nie może rozdzielić motywu bez decyzji admina.
    h.settings = { theme_design_lang_mode: { mode: "cokolwiek" } };
    const { result } = renderHook(() => useThemeDesignLangMode(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ mode: "shared" }));
  });

  it("wartość, która nie jest obiektem, też spada na tryb wspólny", async () => {
    h.settings = { theme_design_lang_mode: "split" };
    const { result } = renderHook(() => useThemeDesignLangMode(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ mode: "shared" }));
  });
});

describe("useThemeDesignFor - wybór wersji językowej", () => {
  beforeEach(() => {
    h.settings = {
      theme_design: { blockHeading: { fontSize: "11px" } },
      theme_design_en: { blockHeading: { fontSize: "22px" } },
    };
  });

  it("w trybie WSPÓLNYM oba języki dostają wiersz bazowy", async () => {
    const pl = renderHook(() => useThemeDesignFor("pl"), { wrapper });
    await waitFor(() => expect(pl.result.current.blockHeading.fontSize).toBe("11px"));

    const en = renderHook(() => useThemeDesignFor("en"), { wrapper });
    await waitFor(() => expect(en.result.current.blockHeading.fontSize).toBe("11px"));
  });

  it("w trybie OSOBNYM angielski dostaje własny wiersz", async () => {
    h.settings = { ...h.settings, theme_design_lang_mode: { mode: "split" } };
    const { result } = renderHook(() => useThemeDesignFor("en"), { wrapper });
    await waitFor(() => expect(result.current.blockHeading.fontSize).toBe("22px"));
  });

  it("w trybie OSOBNYM polski nadal dostaje wiersz bazowy", async () => {
    h.settings = { ...h.settings, theme_design_lang_mode: { mode: "split" } };
    const { result } = renderHook(() => useThemeDesignFor("pl"), { wrapper });
    await waitFor(() => expect(result.current.blockHeading.fontSize).toBe("11px"));
  });

  it("przed wczytaniem oddaje wartości domyślne, nie undefined", () => {
    // Ten hook zwraca WARTOŚĆ, nie wynik zapytania - komponent bootujący nie ma
    // gdzie obsłużyć stanu ładowania, więc musi dostać komplet tokenów.
    const { result } = renderHook(() => useThemeDesignFor("pl"), { wrapper });
    expect(result.current).toEqual(THEME_DESIGN_DEFAULTS);
  });
});

// ---------------------------------------------------------------------------
// Zapis
// ---------------------------------------------------------------------------

describe("useSaveThemeDesign", () => {
  it("zapisuje wersję polską pod kluczem bazowym i odświeża cache", async () => {
    const { result } = renderHook(() => useSaveThemeDesign(), { wrapper });
    const next = withSection("blockHeading", { fontSize: "33px" });
    await act(async () => {
      await result.current.mutateAsync({ next });
    });

    expect(h.upserts[0]).toMatchObject({ key: "theme_design" });
    expect(queryClient.getQueryData(["site_settings", "theme_design"])).toEqual(next);
    expect(h.notifySuccess).toHaveBeenCalledWith("Zapisano Theme Design");
  });

  it("zapisuje wersję angielską pod WŁASNYM kluczem", async () => {
    const { result } = renderHook(() => useSaveThemeDesign(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ next: THEME_DESIGN_DEFAULTS, lang: "en" });
    });

    expect(h.upserts[0]).toMatchObject({ key: "theme_design_en" });
    expect(queryClient.getQueryData(["site_settings", "theme_design_en"])).toEqual(
      THEME_DESIGN_DEFAULTS,
    );
    expect(h.notifySuccess).toHaveBeenCalledWith("Zapisano Theme Design (EN)");
  });

  it("unieważnia PUBLICZNY cache ustawień, nie tylko admiński", async () => {
    // Bez tego redaktor widzi zmianę w panelu, a serwis publiczny dalej serwuje
    // stare tokeny do końca życia cache'u.
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSaveThemeDesign(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ next: THEME_DESIGN_DEFAULTS });
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["site_settings_public", "all"] });
  });

  it("błąd zapisu daje komunikat i NIE podmienia cache", async () => {
    h.upsertError = { message: "brak uprawnień" };
    const { result } = renderHook(() => useSaveThemeDesign(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ next: THEME_DESIGN_DEFAULTS }).catch(() => undefined);
    });

    expect(h.notifyError).toHaveBeenCalledWith("brak uprawnień");
    expect(queryClient.getQueryData(["site_settings", "theme_design"])).toBeUndefined();
  });
});

describe("useSaveThemeDesignLangMode", () => {
  it("zapisuje tryb osobny i mówi o tym po ludzku", async () => {
    const { result } = renderHook(() => useSaveThemeDesignLangMode(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ mode: "split" });
    });

    expect(h.upserts[0]).toMatchObject({ key: "theme_design_lang_mode" });
    expect(h.notifySuccess).toHaveBeenCalledWith("Styl treści: osobno dla PL i EN");
  });

  it("zapisuje tryb wspólny", async () => {
    const { result } = renderHook(() => useSaveThemeDesignLangMode(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ mode: "shared" });
    });
    expect(h.notifySuccess).toHaveBeenCalledWith("Styl treści: wspólny dla PL i EN");
  });

  it("błąd zapisu trybu daje komunikat", async () => {
    h.upsertError = { message: "konflikt" };
    const { result } = renderHook(() => useSaveThemeDesignLangMode(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ mode: "split" }).catch(() => undefined);
    });
    expect(h.notifyError).toHaveBeenCalledWith("konflikt");
  });
});

// ---------------------------------------------------------------------------
// Podgląd na żywo
// ---------------------------------------------------------------------------

describe("useLiveThemeDesignPreview", () => {
  const draft = withSection("blockHeading", { fontSize: "99px" });

  it("wstrzykuje wersję roboczą do cache, żeby cały serwis ją widział", () => {
    renderHook(() => useLiveThemeDesignPreview(draft, true), { wrapper });
    expect(queryClient.getQueryData(["site_settings", "theme_design"])).toEqual(draft);
  });

  it("PRZYWRACA zapisaną wartość po odmontowaniu - wersja robocza nie wycieka", () => {
    const saved = withSection("blockHeading", { fontSize: "18px" });
    queryClient.setQueryData(["site_settings", "theme_design"], saved);

    const { unmount } = renderHook(() => useLiveThemeDesignPreview(draft, true), { wrapper });
    expect(queryClient.getQueryData(["site_settings", "theme_design"])).toEqual(draft);

    unmount();
    expect(queryClient.getQueryData(["site_settings", "theme_design"])).toEqual(saved);
  });

  it("bez zapisanej wartości sprząta przez unieważnienie", () => {
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { unmount } = renderHook(() => useLiveThemeDesignPreview(draft, true), { wrapper });
    unmount();
    expect(spy).toHaveBeenCalledWith({ queryKey: ["site_settings", "theme_design"] });
  });

  it("wyłączony podgląd NIE rusza cache", () => {
    renderHook(() => useLiveThemeDesignPreview(draft, false), { wrapper });
    expect(queryClient.getQueryData(["site_settings", "theme_design"])).toBeUndefined();
  });

  it("brak wersji roboczej NIE rusza cache", () => {
    renderHook(() => useLiveThemeDesignPreview(null, true), { wrapper });
    expect(queryClient.getQueryData(["site_settings", "theme_design"])).toBeUndefined();
  });

  it("podgląd wersji angielskiej trafia we WŁASNY klucz", () => {
    renderHook(() => useLiveThemeDesignPreview(draft, true, "en"), { wrapper });
    expect(queryClient.getQueryData(["site_settings", "theme_design_en"])).toEqual(draft);
    expect(queryClient.getQueryData(["site_settings", "theme_design"])).toBeUndefined();
  });
});
