// Domknięcie warstwy motywu: serwerowa strona zapisu typografii, domyślne
// ustawienia karuzeli, fonty własne, rozmiary czcionek.
//
// To są pliki, które audyt 18.08 zostawił niedobite: `typographyApply.functions.ts`
// na 5,6% (0 z 5 funkcji), `carouselDefaults.ts` 1 z 7, `customFonts.ts` 4 z 5,
// `fontSizes.ts` 9 z 13. Każdy niesie regułę widoczną wyłącznie dla czytelnika:
// czy zaimportowany wpis odzyska typografię motywu, czy slider sam się przewinie,
// czy font własny w ogóle się załaduje i czy nagłówki mają skalę.
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  upsertError: null as { message: string } | null,
  upserts: [] as Array<Record<string, unknown>>,
  toastSuccess: vi.fn(),
  toastFail: vi.fn(),
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
  commits: [] as Array<{ key: string; value: unknown }>,
  storage: {
    uploads: [] as Array<{ path: string; contentType?: string }>,
    uploadError: null as { message: string } | null,
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      upsert: async (payload: Record<string, unknown>) => {
        h.upserts.push(payload);
        return { error: h.upsertError };
      },
    }),
    storage: {
      from: () => ({
        upload: async (path: string, _file: File, opts?: { contentType?: string }) => {
          h.storage.uploads.push({ path, contentType: opts?.contentType });
          return { error: h.storage.uploadError };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.example/${path}` } }),
      }),
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastFail } }));
vi.mock("@/lib/notify", () => ({
  notifySuccess: h.notifySuccess,
  notifyError: h.notifyError,
}));
vi.mock("@/lib/useSiteSetting", () => ({
  siteSettingsQueryOptions: {
    queryKey: ["site_settings_public", "all"],
    queryFn: async () => h.settings,
  },
  // Zapis rozmiarów czcionek idzie przez wspólną procedurę podmiany
  // optymistycznej z refetchem; tutaj zapisujemy tylko fakt jej wywołania.
  commitSiteSettingWrite: async (_qc: unknown, key: string, value: unknown) => {
    h.commits.push({ key, value });
  },
}));

import {
  CAROUSEL_DEFAULTS,
  resolveCarouselSettings,
  useCarouselDefaults,
  useSaveCarouselDefaults,
} from "@/lib/theme/carouselDefaults";
import {
  customFontsCss,
  fontFaceCss,
  slugifyFontName,
  uploadCustomFont,
  type CustomFont,
} from "@/lib/theme/customFonts";
import {
  FONT_SIZES_DEFAULTS,
  HEADING_LEVELS,
  fontSizesToCss,
  useFontSizes,
  useSaveFontSizes,
} from "@/lib/theme/fontSizes";
import { buildTypographyPatch, type TypographyPostInput } from "@/lib/theme/typographyApply";

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  h.settings = {};
  h.upsertError = null;
  h.upserts.length = 0;
  h.commits.length = 0;
  h.storage.uploads.length = 0;
  h.storage.uploadError = null;
  for (const fn of [h.toastSuccess, h.toastFail, h.notifySuccess, h.notifyError]) fn.mockReset();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

// ---------------------------------------------------------------------------
// Domyślne ustawienia karuzeli
// ---------------------------------------------------------------------------

describe("resolveCarouselSettings", () => {
  it("bez nadpisań oddaje globalne wartości domyślne", () => {
    expect(resolveCarouselSettings(CAROUSEL_DEFAULTS, undefined)).toBe(CAROUSEL_DEFAULTS);
  });

  it("nadpisanie widgetu wygrywa z globalnym", () => {
    const out = resolveCarouselSettings(CAROUSEL_DEFAULTS, { autoplay: false, intervalMs: 9000 });
    expect(out.autoplay).toBe(false);
    expect(out.intervalMs).toBe(9000);
  });

  it("pola undefined i null SPADAJĄ na wartość globalną", () => {
    // Widget zapisany przed dodaniem pola ma tam `undefined`; naiwny spread
    // wpisałby je do wyniku i wyłączył autoodtwarzanie w całym serwisie.
    const out = resolveCarouselSettings(CAROUSEL_DEFAULTS, {
      autoplay: undefined,
      loop: null as unknown as boolean,
    });
    expect(out.autoplay).toBe(CAROUSEL_DEFAULTS.autoplay);
    expect(out.loop).toBe(CAROUSEL_DEFAULTS.loop);
  });

  it("wartość `false` NIE jest traktowana jak brak", () => {
    // Klasyczna pułapka: `if (v)` zamiast `if (v !== undefined)` zjadłoby
    // świadome wyłączenie pętli przez redaktora.
    expect(resolveCarouselSettings(CAROUSEL_DEFAULTS, { loop: false }).loop).toBe(false);
    expect(resolveCarouselSettings(CAROUSEL_DEFAULTS, { pauseOnHover: false }).pauseOnHover).toBe(
      false,
    );
  });

  it("pusty obiekt nadpisań nie zmienia niczego", () => {
    expect(resolveCarouselSettings(CAROUSEL_DEFAULTS, {})).toEqual(CAROUSEL_DEFAULTS);
  });
});

describe("useCarouselDefaults", () => {
  it("brak ustawienia daje wartości domyślne", async () => {
    const { result } = renderHook(() => useCarouselDefaults(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(CAROUSEL_DEFAULTS));
  });

  it("scala zapisany fragment z domyślnymi", async () => {
    h.settings = { carousel_defaults: { intervalMs: 7000 } };
    const { result } = renderHook(() => useCarouselDefaults(), { wrapper });
    await waitFor(() => {
      expect(result.current.data?.intervalMs).toBe(7000);
      expect(result.current.data?.autoplay).toBe(CAROUSEL_DEFAULTS.autoplay);
    });
  });

  it("wartość poza dozwolonym zakresem spada na komplet domyślnych", async () => {
    // Interwał 50 ms to migający slider - schemat go odrzuca, a hook nie może
    // przepuścić połowicznie sparsowanego obiektu.
    h.settings = { carousel_defaults: { intervalMs: 50 } };
    const { result } = renderHook(() => useCarouselDefaults(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(CAROUSEL_DEFAULTS));
  });
});

describe("useSaveCarouselDefaults", () => {
  it("zapisuje, odświeża cache publiczny i potwierdza", async () => {
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSaveCarouselDefaults(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ ...CAROUSEL_DEFAULTS, intervalMs: 8000 });
    });

    expect(h.upserts[0]).toMatchObject({ key: "carousel_defaults" });
    expect(queryClient.getQueryData(["site_settings", "carousel_defaults"])).toMatchObject({
      intervalMs: 8000,
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["site_settings_public", "all"] });
    expect(h.toastSuccess).toHaveBeenCalled();
  });

  it("błąd zapisu daje komunikat i nie podmienia cache", async () => {
    h.upsertError = { message: "brak uprawnień" };
    const { result } = renderHook(() => useSaveCarouselDefaults(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(CAROUSEL_DEFAULTS).catch(() => undefined);
    });

    expect(h.toastFail).toHaveBeenCalledWith("brak uprawnień");
    expect(queryClient.getQueryData(["site_settings", "carousel_defaults"])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Fonty własne
// ---------------------------------------------------------------------------

describe("slugifyFontName", () => {
  it("sprowadza nazwę do bezpiecznego identyfikatora CSS", () => {
    expect(slugifyFontName("Red Hat Display")).toBe("red-hat-display");
  });

  it("rozkłada znaki diakrytyczne zamiast je wycinać", () => {
    expect(slugifyFontName("Ćwiczenie Bold")).toBe("cwiczenie-bold");
  });

  it("obcina myślniki z krańców i skleja powtórzenia", () => {
    expect(slugifyFontName("--Font   Własny--")).toBe("font-w-asny");
  });

  it("nazwa bez znaków alfanumerycznych dostaje bezpieczne zastępstwo", () => {
    // Pusty identyfikator dałby `font-family:""` i font, którego nie da się
    // wskazać w żadnej regule.
    expect(slugifyFontName("---")).toBe("font");
    expect(slugifyFontName("")).toBe("font");
  });

  it("przycina do 40 znaków", () => {
    expect(slugifyFontName("a".repeat(80))).toHaveLength(40);
  });
});

describe("fontFaceCss", () => {
  const base: CustomFont = { id: "moj-font", label: "Mój font", url: "https://cdn/x.woff2" };

  it("składa regułę @font-face z formatem wykrytym z rozszerzenia", () => {
    const css = fontFaceCss(base);
    expect(css).toContain('font-family:"moj-font";');
    expect(css).toContain('format("woff2")');
    expect(css).toContain("font-display:swap;");
    expect(css).toContain("font-weight:400;font-style:normal;");
  });

  it.each([
    ["https://cdn/x.woff", "woff"],
    ["https://cdn/x.ttf", "truetype"],
    ["https://cdn/x.otf", "opentype"],
  ])("rozpoznaje format dla %s", (url, format) => {
    expect(fontFaceCss({ ...base, url })).toContain(`format("${format}")`);
  });

  it("pomija deklarację formatu dla nieznanego rozszerzenia", () => {
    // Zły `format()` sprawia, że przeglądarka odrzuca CAŁĄ regułę - lepiej
    // pozwolić jej zgadnąć po nagłówkach.
    const css = fontFaceCss({ ...base, url: "https://cdn/x.eot" });
    expect(css).toContain("src:url(");
    expect(css).not.toContain("format(");
  });

  it("wykrywa format mimo parametrów zapytania w adresie", () => {
    expect(fontFaceCss({ ...base, url: "https://cdn/x.woff2?v=2" })).toContain('format("woff2")');
  });

  it("przekazuje jawną grubość, styl i strategię wyświetlania", () => {
    const css = fontFaceCss({ ...base, weight: "100 900", style: "italic", display: "optional" });
    expect(css).toContain("font-weight:100 900;font-style:italic;font-display:optional;");
  });

  it("ODRZUCA identyfikator spoza wzorca - to wstrzyknięcie do CSS", () => {
    // Identyfikator ląduje w `font-family:"…"` bez escapowania, więc cudzysłów
    // albo nawias klamrowy wyszedłby poza regułę.
    expect(fontFaceCss({ ...base, id: 'x";}body{display:none' })).toBe("");
    expect(fontFaceCss({ ...base, id: "Wielkie Litery" })).toBe("");
    expect(fontFaceCss({ ...base, id: "" })).toBe("");
  });

  it("ODRZUCA wpis bez adresu", () => {
    expect(fontFaceCss({ ...base, url: "" })).toBe("");
  });
});

describe("customFontsCss", () => {
  const good: CustomFont = { id: "a", label: "A", url: "https://cdn/a.woff2" };

  it("skleja reguły wszystkich poprawnych fontów", () => {
    const css = customFontsCss([good, { ...good, id: "b", url: "https://cdn/b.woff" }]);
    expect(css.match(/@font-face\{/g)).toHaveLength(2);
  });

  it("ODSIEWA wpisy niepoprawne, zamiast psuć cały arkusz", () => {
    const css = customFontsCss([good, { ...good, id: "zły id" }]);
    expect(css.match(/@font-face\{/g)).toHaveLength(1);
  });

  it("pusta i nieistniejąca lista dają pusty arkusz", () => {
    expect(customFontsCss([])).toBe("");
    expect(customFontsCss(undefined)).toBe("");
  });
});

describe("uploadCustomFont", () => {
  function fontFile(name: string, size = 1024): File {
    const file = new File(["x"], name, { type: "font/woff2" });
    Object.defineProperty(file, "size", { value: size });
    return file;
  }

  it("wysyła plik pod ścieżkę tenanta i oddaje gotowy wpis", async () => {
    const out = await uploadCustomFont({
      file: fontFile("MojFont.woff2"),
      label: "Mój Font",
      tenantId: "t1",
    });

    expect(h.storage.uploads[0].path.startsWith("t1/fonts/moj-font-")).toBe(true);
    expect(out).toMatchObject({
      id: "moj-font",
      label: "Mój Font",
      weight: "400",
      display: "swap",
    });
    expect(out?.url).toContain("https://cdn.example/t1/fonts/");
  });

  it.each(["plik.exe", "plik.svg", "plik", "plik.zip"])("ODRZUCA rozszerzenie %s", async (name) => {
    // Bucket `media` jest publiczny; wpuszczenie tu dowolnego rozszerzenia
    // czyni z zakładki fontów uniwersalny hosting plików.
    expect(await uploadCustomFont({ file: fontFile(name), label: "X", tenantId: "t1" })).toBeNull();
    expect(h.notifyError).toHaveBeenCalled();
    expect(h.storage.uploads).toHaveLength(0);
  });

  it("ODRZUCA plik powyżej 5 MB", async () => {
    const big = fontFile("duzy.woff2", 5 * 1024 * 1024 + 1);
    expect(await uploadCustomFont({ file: big, label: "X", tenantId: "t1" })).toBeNull();
    expect(h.storage.uploads).toHaveLength(0);
  });

  it("bez etykiety bierze nazwę pliku BEZ rozszerzenia", async () => {
    const out = await uploadCustomFont({
      file: fontFile("Inter Tight.woff2"),
      label: "",
      tenantId: "t1",
    });
    expect(out?.id).toBe("inter-tight");
    expect(out?.label).toBe("inter-tight");
  });

  it("porażka wysyłki daje komunikat i null", async () => {
    h.storage.uploadError = { message: "bucket pełny" };
    expect(
      await uploadCustomFont({ file: fontFile("a.woff2"), label: "A", tenantId: "t1" }),
    ).toBeNull();
    expect(h.notifyError).toHaveBeenCalledWith("bucket pełny");
  });

  it("przekazuje jawną grubość i styl do zapisanego wpisu", async () => {
    const out = await uploadCustomFont({
      file: fontFile("a.woff2"),
      label: "A",
      tenantId: "t1",
      weight: "700",
      style: "italic",
    });
    expect(out).toMatchObject({ weight: "700", style: "italic" });
  });
});

// ---------------------------------------------------------------------------
// Rozmiary czcionek
// ---------------------------------------------------------------------------

describe("fontSizesToCss", () => {
  it("emituje token dla KAŻDEGO poziomu nagłówka", () => {
    // Brakujący poziom oznacza nagłówek bez skali - widoczny na każdej stronie.
    const css = fontSizesToCss(FONT_SIZES_DEFAULTS);
    for (const level of HEADING_LEVELS) {
      expect(css).toContain(`--fs-${level}`);
    }
  });

  it("emituje tokeny tekstu podstawowego i drobnego", () => {
    const css = fontSizesToCss(FONT_SIZES_DEFAULTS);
    expect(css).toContain("--fs-body");
    expect(css).toContain("--fs-small");
  });

  it("skala nagłówków maleje monotonicznie od h1 do h6", () => {
    // Niezmiennik hierarchii wizualnej: h3 nie może być większe od h2.
    const sizes = HEADING_LEVELS.map((l) => FONT_SIZES_DEFAULTS.headings[l].desktop);
    for (let i = 1; i < sizes.length; i += 1) {
      expect(sizes[i]).toBeLessThanOrEqual(sizes[i - 1]);
    }
  });
});

describe("useFontSizes / useSaveFontSizes", () => {
  it("brak ustawienia daje wartości domyślne", async () => {
    const { result } = renderHook(() => useFontSizes(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(FONT_SIZES_DEFAULTS));
  });

  it("zapis WALIDUJE wartości schematem przed wysłaniem do bazy", async () => {
    // Zapis idzie przez `commitSiteSettingWrite` (podmiana optymistyczna +
    // refetch), ale najpierw przez schemat - rozmiar spoza zakresu nie może
    // trafić do tokenów serwowanych na każdej stronie.
    const { result } = renderHook(() => useSaveFontSizes(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(FONT_SIZES_DEFAULTS);
    });

    expect(h.upserts[0]).toMatchObject({ key: "font_sizes" });
    expect(h.commits[0]).toMatchObject({ key: "font_sizes" });
    expect(h.notifySuccess).toHaveBeenCalledWith("Zapisano rozmiary czcionek");
  });

  it("ODRZUCA rozmiar spoza dozwolonego zakresu", async () => {
    const { result } = renderHook(() => useSaveFontSizes(), { wrapper });
    const broken = {
      ...FONT_SIZES_DEFAULTS,
      body: { ...FONT_SIZES_DEFAULTS.body, size: 999 },
    };
    await act(async () => {
      await result.current.mutateAsync(broken).catch(() => undefined);
    });

    expect(h.upserts).toHaveLength(0);
    expect(h.notifyError).toHaveBeenCalled();
  });

  it("błąd zapisu daje komunikat zamiast cichej porażki", async () => {
    h.upsertError = { message: "odmowa" };
    const { result } = renderHook(() => useSaveFontSizes(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(FONT_SIZES_DEFAULTS).catch(() => undefined);
    });
    expect(h.notifyError).toHaveBeenCalledWith("odmowa");
  });
});

// ---------------------------------------------------------------------------
// Patch typografii (wejście serwerowej migracji)
// ---------------------------------------------------------------------------

describe("buildTypographyPatch", () => {
  function post(overrides: Partial<TypographyPostInput> = {}): TypographyPostInput {
    return {
      id: "p1",
      slug: "wpis",
      title: "Wpis",
      content_pl: null,
      content_en: null,
      blocks_data: null,
      builder_data: null,
      ...overrides,
    };
  }

  it("wpis BEZ zaszytej typografii nie wymaga zapisu", () => {
    // `null` jest tu kontraktem: migracja ma pominąć taki wpis, a nie zapisać
    // go „na wszelki wypadek”.
    expect(buildTypographyPatch(post({ content_pl: "<p>zwykły tekst</p>" }))).toBeNull();
  });

  it("zdejmuje inline font-size z treści i zwraca patch", () => {
    const patch = buildTypographyPatch(
      post({ content_pl: '<p style="font-size:19px;color:red">x</p>' }),
    );
    expect(patch?.content_pl).toBe('<p style="color:red">x</p>');
    expect(patch?.id).toBe("p1");
  });

  it("obie wersje językowe są czyszczone niezależnie", () => {
    const patch = buildTypographyPatch(
      post({
        content_pl: '<p style="line-height:3">a</p>',
        content_en: "<p>b</p>",
      }),
    );
    expect(patch?.content_pl).toBe("<p>a</p>");
    // Wersja bez typografii NIE trafia do patcha - zapis dotyka tylko tego,
    // co naprawdę się zmieniło.
    expect(patch).not.toHaveProperty("content_en");
  });

  it("czyści drzewo bloków i drzewo buildera", () => {
    const patch = buildTypographyPatch(
      post({
        blocks_data: [{ attrs: { fontSize: "20px", color: "red" } }],
        builder_data: { widgets: [{ style: "font-family:Arial;margin:4px" }] },
      }),
    );
    expect(JSON.stringify(patch?.blocks_data)).not.toContain("fontSize");
    expect(JSON.stringify(patch?.blocks_data)).toContain("color");
    expect(JSON.stringify(patch?.builder_data)).toContain("margin");
    expect(JSON.stringify(patch?.builder_data)).not.toContain("font-family");
  });

  it("pusty tekst i brak treści są pomijane bez zapisu", () => {
    expect(buildTypographyPatch(post({ content_pl: "", content_en: null }))).toBeNull();
  });

  it("patch zawsze niesie identyfikatory potrzebne do raportu", () => {
    const patch = buildTypographyPatch(post({ content_pl: '<p style="font-size:9px">x</p>' }));
    expect(patch).toMatchObject({ id: "p1", slug: "wpis", title: "Wpis" });
  });
});
