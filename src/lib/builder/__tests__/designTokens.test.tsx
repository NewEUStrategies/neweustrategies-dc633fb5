// Tokeny marki: nazwa koloru -> zmienna `--brand-<slug>` -> <style> na :root.
// `tokensToCss` startowało z 15,0% linii i 0 z 12 funkcji, a jego wynik leci
// przez `DesignTokensStyle` z `__root.tsx`, czyli na KAŻDEJ trasie publicznej.
//
// Testujemy dwie rzeczy: slugowanie nazwy (to ono decyduje, jak brzmi zmienna
// CSS, której szuka autorski arkusz tenanta) oraz reguły emisji bloku `:root`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  slugifyToken,
  legacyTokenSlug,
  tokensToCss,
  EMPTY_TOKENS,
  designTokensQueryOptions,
  fetchSiteDesignTokensRow,
  useDesignTokens,
  useSaveDesignTokens,
  type DesignTokens,
} from "../designTokens";

/**
 * Sterowana odpowiedź `site_design_tokens`. `edgeTtlCache` pod happy-dom widzi
 * `window`, więc woła fetcher bez cache'owania - nie trzeba go podmieniać.
 */
const row = vi.hoisted(() => ({ data: null as unknown, error: null as unknown }));

/** Wynik `upsert` dla testów zapisu. */
const upsert = vi.hoisted(() => ({ error: null as unknown, calls: [] as unknown[] }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        maybeSingle: async () => ({ data: row.data, error: row.error }),
      }),
      upsert: async (payload: unknown, opts: unknown) => {
        upsert.calls.push({ payload, opts });
        return { error: upsert.error };
      },
    }),
  },
}));

const notify = vi.hoisted(() => ({ success: [] as string[], error: [] as string[] }));
vi.mock("@/lib/notify", () => ({
  notifySuccess: (m: string) => notify.success.push(m),
  notifyError: (m: string) => notify.error.push(m),
}));

function tokens(over: Partial<DesignTokens> = {}): DesignTokens {
  return { colors: [], fonts: {}, scale: {}, ...over };
}

describe("slugifyToken", () => {
  it("sprowadza nazwę do bezpiecznej postaci CSS", () => {
    expect(slugifyToken("Primary")).toBe("primary");
    expect(slugifyToken("Kolor Akcentu")).toBe("kolor-akcentu");
    expect(slugifyToken("brand   color")).toBe("brand-color");
  });

  it("zdejmuje znaki niedozwolone i myślniki z krawędzi", () => {
    expect(slugifyToken("--brand--")).toBe("brand");
    expect(slugifyToken("!@#Kolor$%^")).toBe("kolor");
    expect(slugifyToken("kolor/2024")).toBe("kolor-2024");
  });

  it("nie da się wyjść z nazwy zmiennej CSS", () => {
    // Nazwa jedzie do `--brand-${slug}` bez cudzysłowów - gdyby przeszły tu
    // nawiasy klamrowe albo średnik, autor mógłby dopisać własną regułę.
    const slug = slugifyToken("x; } body { display: none } :root { --y");
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(slug).not.toContain(";");
    expect(slug).not.toContain("}");
  });

  it("obcina do 32 znaków", () => {
    expect(slugifyToken("a".repeat(80))).toHaveLength(32);
  });

  it("nazwa bez ANI JEDNEGO znaku slugowalnego daje `token`", () => {
    expect(slugifyToken("")).toBe("token");
    expect(slugifyToken("   ")).toBe("token");
    expect(slugifyToken("!!!")).toBe("token");
  });

  it("REGRESJA: polskie litery są TRANSLITEROWANE, nie zjadane", () => {
    // `normalize("NFKD")` nie rozkłada `ł`, więc bez mapy liter atomowych
    // nazwa degradowała do myślnika w środku wyrazu albo gubiła literę na
    // krawędzi: „Główny" -> `g-owny`, „Łączny" -> `aczny`, „Kolor Ł" -> `kolor`.
    expect(slugifyToken("Główny")).toBe("glowny");
    expect(slugifyToken("Łączny")).toBe("laczny");
    expect(slugifyToken("Żółty")).toBe("zolty");
    expect(slugifyToken("Kolor Ł")).toBe("kolor-l");
    expect(slugifyToken("Gęślą jaźń")).toBe("gesla-jazn");
  });

  it("REGRESJA: nazwy różniące się literą atomową NIE kolidują", () => {
    // Kolizja slugów = dwie próbki koloru walczące o tę samą zmienną
    // `--brand-<slug>`; w CSS wygrywa ostatnia, więc jeden picker w panelu
    // przestaje cokolwiek robić.
    expect(slugifyToken("Łączny")).not.toBe(slugifyToken("ączny"));
    expect(slugifyToken("Ładny")).not.toBe(slugifyToken("adny"));
  });

  it("transliteruje też litery spoza polskiego alfabetu", () => {
    expect(slugifyToken("Ørsted")).toBe("orsted");
    expect(slugifyToken("Straße")).toBe("strasse");
  });

  it("wielkość litery nie zmienia wyniku transliteracji", () => {
    expect(slugifyToken("ŁĄCZNY")).toBe(slugifyToken("łączny"));
  });
});

describe("legacyTokenSlug", () => {
  it("zwraca `null`, gdy stara i nowa postać są identyczne", () => {
    // Dla nazw bez liter atomowych - czyli dla większości - nie dokładamy
    // niczego do CSS.
    expect(legacyTokenSlug("Primary")).toBeNull();
    expect(legacyTokenSlug("Kolor Akcentu")).toBeNull();
    expect(legacyTokenSlug("")).toBeNull();
  });

  it("zwraca uszkodzoną, historyczną postać dla nazw z literami atomowymi", () => {
    expect(legacyTokenSlug("Główny")).toBe("g-owny");
    expect(legacyTokenSlug("Łączny")).toBe("aczny");
    expect(legacyTokenSlug("Żółty")).toBe("zo-ty");
  });
});

describe("tokensToCss - reguły emisji", () => {
  it("puste tokeny nie dają ŻADNEGO CSS", () => {
    expect(tokensToCss(EMPTY_TOKENS)).toBe("");
    expect(tokensToCss(tokens())).toBe("");
  });

  it("emituje zmienną `--brand-<slug>` dla koloru", () => {
    const css = tokensToCss(tokens({ colors: [{ name: "Primary", value: "#ff0000" }] }));
    expect(css).toBe(":root{--brand-primary: #ff0000;}");
  });

  it("pomija kolor z PUSTĄ wartością", () => {
    // Pusta wartość znaczy „dziedzicz" - emisja `--brand-x: ;` byłaby
    // nieprawidłową deklaracją i mogłaby unieważnić cały blok w starszych
    // przeglądarkach.
    const css = tokensToCss(tokens({ colors: [{ name: "Primary", value: "" }] }));
    expect(css).toBe("");
  });

  it("emituje wszystkie kolory w kolejności zapisu", () => {
    const css = tokensToCss(
      tokens({
        colors: [
          { name: "A", value: "#111111" },
          { name: "B", value: "#222222" },
        ],
      }),
    );
    expect(css.indexOf("--brand-a")).toBeLessThan(css.indexOf("--brand-b"));
  });

  it("dokłada alias historyczny dla nazwy z literą atomową", () => {
    const css = tokensToCss(tokens({ colors: [{ name: "Główny", value: "#abcdef" }] }));
    expect(css).toContain("--brand-glowny: #abcdef;");
    expect(css).toContain("--brand-g-owny: #abcdef;");
  });

  it("NIE dubluje zmiennej dla zwykłej nazwy", () => {
    const css = tokensToCss(tokens({ colors: [{ name: "Primary", value: "#abcdef" }] }));
    expect(css.match(/--brand-/g)).toHaveLength(1);
  });

  it("emituje czcionki i promień, gdy są ustawione", () => {
    const css = tokensToCss(
      tokens({
        fonts: { heading: "Georgia, serif", body: "Inter, sans-serif" },
        scale: { radius: "8px" },
      }),
    );
    expect(css).toContain("--brand-font-heading: Georgia, serif;");
    expect(css).toContain("--brand-font-body: Inter, sans-serif;");
    expect(css).toContain("--brand-radius: 8px;");
  });

  it("pomija czcionki i promień, gdy są puste", () => {
    const css = tokensToCss(tokens({ fonts: { heading: "" }, scale: { radius: "" } }));
    expect(css).toBe("");
  });

  it("zawija deklaracje w JEDEN blok `:root`", () => {
    const css = tokensToCss(
      tokens({ colors: [{ name: "A", value: "#111111" }], scale: { radius: "4px" } }),
    );
    expect(css.match(/:root\{/g)).toHaveLength(1);
    expect(css.startsWith(":root{")).toBe(true);
    expect(css.endsWith("}")).toBe(true);
  });

  it("dokłada @font-face PRZED blokiem :root", () => {
    // Kolejność ma znaczenie: `--brand-font-*` może wskazywać na rodzinę
    // zadeklarowaną przez @font-face wyżej. Gdyby reguły szły odwrotnie,
    // pierwszy render pokazywałby czcionkę zastępczą.
    const css = tokensToCss(
      tokens({
        colors: [{ name: "A", value: "#111111" }],
        fonts: {
          custom: [{ id: "wlasny", label: "Własny", url: "https://example.test/f.woff2" }],
        },
      }),
    );
    expect(css).toContain("@font-face");
    expect(css.indexOf("@font-face")).toBeLessThan(css.indexOf(":root{"));
  });

  it("kolizja slugów kończy się DWIEMA deklaracjami - ostatnia wygrywa w CSS", () => {
    // Nazwy różne, slug ten sam (obcięcie do 32 znaków). Utrwalamy, że emiter
    // niczego nie scala ani nie zgłasza - to zachowanie kaskady CSS, a nie błąd
    // tej funkcji, ale trzeba je znać, patrząc na panel.
    const long = "a".repeat(32);
    const css = tokensToCss(
      tokens({
        colors: [
          { name: `${long}X`, value: "#111111" },
          { name: `${long}Y`, value: "#222222" },
        ],
      }),
    );
    expect(css.match(new RegExp(`--brand-${long}:`, "g"))).toHaveLength(2);
  });
});

describe("fetchSiteDesignTokensRow - odporność warstwy danych", () => {
  beforeEach(() => {
    row.data = null;
    row.error = null;
  });

  it("zwraca wiersz, gdy zapytanie się udało", async () => {
    row.data = { colors: [], fonts: {}, scale: {}, global_colors: {} };
    await expect(fetchSiteDesignTokensRow()).resolves.toEqual(row.data);
  });

  it("BŁĄD degraduje do `null`, a nie do wyjątku", async () => {
    // Ten odczyt grzeje root loader na KAŻDEJ trasie. Rzucony wyjątek zdjąłby
    // całą stronę z powodu czysto kosmetycznych tokenów.
    row.error = { message: "boom" };
    await expect(fetchSiteDesignTokensRow()).resolves.toBeNull();
  });

  it("brak wiersza to `null`, nie `undefined`", async () => {
    row.data = null;
    await expect(fetchSiteDesignTokensRow()).resolves.toBeNull();
  });
});

describe("designTokensQueryOptions.queryFn", () => {
  const run = () =>
    (designTokensQueryOptions.queryFn as () => Promise<DesignTokens>)() as Promise<DesignTokens>;

  beforeEach(() => {
    row.data = null;
    row.error = null;
  });

  it("bez wiersza oddaje EMPTY_TOKENS", async () => {
    await expect(run()).resolves.toEqual(EMPTY_TOKENS);
  });

  it("po błędzie oddaje EMPTY_TOKENS, nie rzuca", async () => {
    row.error = { message: "boom" };
    await expect(run()).resolves.toEqual(EMPTY_TOKENS);
  });

  it("przepuszcza wyłącznie kolory o poprawnym KSZTAŁCIE", async () => {
    // `colors` to JSONB - do bazy mogło trafić cokolwiek. Wpis bez `name` albo
    // z liczbą w `value` musi wypaść, zamiast dojechać do `tokensToCss`
    // i wyemitować `--brand-undefined`.
    row.data = {
      colors: [
        { name: "ok", value: "#fff" },
        { name: "brak-wartosci" },
        { value: "#000" },
        { name: 1, value: "#000" },
        { name: "zla-wartosc", value: 7 },
        null,
      ],
      fonts: null,
      scale: null,
      global_colors: null,
    };
    const out = await run();
    expect(out.colors).toEqual([{ name: "ok", value: "#fff" }]);
  });

  it("`colors` niebędące tablicą daje pustą listę", async () => {
    row.data = { colors: { nie: "tablica" }, fonts: {}, scale: {}, global_colors: null };
    await expect(run()).resolves.toMatchObject({ colors: [] });
  });

  it("brakujące `fonts` / `scale` degradują do pustych obiektów", async () => {
    row.data = { colors: [], fonts: null, scale: null, global_colors: null };
    const out = await run();
    expect(out.fonts).toEqual({});
    expect(out.scale).toEqual({});
  });

  it("wynik queryFn nadaje się od razu dla `tokensToCss`", async () => {
    row.data = {
      colors: [{ name: "Primary", value: "#ff0000" }],
      fonts: { heading: "Georgia" },
      scale: { radius: "6px" },
      global_colors: null,
    };
    const css = tokensToCss(await run());
    expect(css).toContain("--brand-primary: #ff0000;");
    expect(css).toContain("--brand-font-heading: Georgia;");
    expect(css).toContain("--brand-radius: 6px;");
  });
});

describe("useDesignTokens / useSaveDesignTokens", () => {
  beforeEach(() => {
    row.data = null;
    row.error = null;
    upsert.error = null;
    upsert.calls.length = 0;
    notify.success.length = 0;
    notify.error.length = 0;
  });

  function harness() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return { client, wrapper };
  }

  it("useDesignTokens oddaje EMPTY_TOKENS, gdy nie ma wiersza", async () => {
    const { wrapper } = harness();
    const { result } = renderHook(() => useDesignTokens(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(EMPTY_TOKENS);
  });

  it("useDesignTokens NIE wpada w stan błędu, gdy zapytanie padnie", async () => {
    // Kontrakt odporności: tokeny są kosmetyczne, więc błąd degraduje do
    // domyślnych, a nie do `isError` (root loader grzeje to na każdej trasie).
    row.error = { message: "boom" };
    const { wrapper } = harness();
    const { result } = renderHook(() => useDesignTokens(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.isError).toBe(false);
    expect(result.current.data).toEqual(EMPTY_TOKENS);
  });

  it("useSaveDesignTokens zapisuje przez upsert z konfliktem na tenant_id", async () => {
    const { wrapper } = harness();
    const { result } = renderHook(() => useSaveDesignTokens(), { wrapper });
    const next = tokens({ colors: [{ name: "Primary", value: "#fff" }] });
    await result.current.mutateAsync(next);

    expect(upsert.calls).toHaveLength(1);
    const call = upsert.calls[0] as { payload: Record<string, unknown>; opts: unknown };
    // `tenant_id` NIE jest wysyłany - wypełnia go default bazy / RLS.
    expect(Object.keys(call.payload).sort()).toEqual(["colors", "fonts", "scale"]);
    expect(call.opts).toEqual({ onConflict: "tenant_id" });
    expect(notify.success).toHaveLength(1);
  });

  it("useSaveDesignTokens wstawia zapisane tokeny do cache'u", async () => {
    const { wrapper, client } = harness();
    const { result } = renderHook(() => useSaveDesignTokens(), { wrapper });
    const next = tokens({ scale: { radius: "9px" } });
    await result.current.mutateAsync(next);
    expect(client.getQueryData(["site_design_tokens"])).toEqual(next);
  });

  it("błąd zapisu podnosi wyjątek i pokazuje komunikat", async () => {
    upsert.error = { message: "brak uprawnień" };
    const { wrapper } = harness();
    const { result } = renderHook(() => useSaveDesignTokens(), { wrapper });
    await expect(result.current.mutateAsync(tokens())).rejects.toBeTruthy();
    expect(notify.error).toContain("brak uprawnień");
    expect(notify.success).toHaveLength(0);
  });

  it("błąd bez komunikatu dostaje tekst zastępczy", async () => {
    upsert.error = { message: "" };
    const { wrapper } = harness();
    const { result } = renderHook(() => useSaveDesignTokens(), { wrapper });
    await expect(result.current.mutateAsync(tokens())).rejects.toBeTruthy();
    expect(notify.error[0]).toBeTruthy();
  });
});
