// WSTRZYKIWANIE TOKENÓW MOTYWU do dokumentu. Do 18.08.2026 oba komponenty
// na zerze.
//
// To jedyne miejsce, w którym wartości z bazy trafiają do arkusza stylów
// serwowanego na KAŻDEJ stronie - i jedyne, w którym stoi bramka przed
// wstrzyknięciem znacznika. `themeDesignToCss` nie waliduje kolorów
// (`z.string().min(1)` przyjmuje dowolny napis), więc cała obrona przed
// wyjściem poza blok `<style>` siedzi w `hardenStyleCss` TUTAJ.
//
// Drugi zestaw reguł to odporność: dopóki ustawienia się nie wczytają, oba
// komponenty muszą emitować DOMYŚLNE tokeny. Brak tokenów oznacza stronę bez
// skali typograficznej - tytuł wpisu i lead renderują się rozmiarem
// przeglądarki.
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  language: "pl",
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}) } }));
vi.mock("@/lib/useSiteSetting", () => ({
  siteSettingsQueryOptions: {
    queryKey: ["site_settings_public", "all"],
    queryFn: async () => h.settings,
  },
  commitSiteSettingWrite: async () => undefined,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: h.language } }),
}));

import { ThemeDesignStyle } from "../ThemeDesignStyle";
import { ThemeFontSizesStyle } from "../ThemeFontSizesStyle";

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const styleText = (attr: string) =>
  document.querySelector<HTMLStyleElement>(`style[${attr}]`)?.innerHTML ?? "";

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.settings = {};
  h.language = "pl";
});

describe("ThemeDesignStyle - wstrzykiwanie tokenów", () => {
  it("emituje tokeny dopiero po wczytaniu ustawień", async () => {
    render(<ThemeDesignStyle />, { wrapper });
    await waitFor(() => expect(styleText("data-theme-design")).toContain("--td-bh-size"));
  });

  it("znakuje styl JĘZYKIEM i TRYBEM - to jedyny ślad, którą wersję widać", async () => {
    render(<ThemeDesignStyle />, { wrapper });
    await waitFor(() => {
      const el = document.querySelector("style[data-theme-design]");
      expect(el?.getAttribute("data-lang")).toBe("pl");
      expect(el?.getAttribute("data-mode")).toBe("shared");
    });
  });

  it("w trybie OSOBNYM angielski dostaje własne tokeny", async () => {
    h.language = "en";
    h.settings = {
      theme_design: { blockHeading: { fontSize: "11px" } },
      theme_design_en: { blockHeading: { fontSize: "22px" } },
      theme_design_lang_mode: { mode: "split" },
    };
    render(<ThemeDesignStyle />, { wrapper });
    await waitFor(() => expect(styleText("data-theme-design")).toContain("--td-bh-size:22px;"));
  });

  it("w trybie WSPÓLNYM angielski dostaje tokeny bazowe", async () => {
    h.language = "en";
    h.settings = {
      theme_design: { blockHeading: { fontSize: "11px" } },
      theme_design_en: { blockHeading: { fontSize: "22px" } },
    };
    render(<ThemeDesignStyle />, { wrapper });
    await waitFor(() => expect(styleText("data-theme-design")).toContain("--td-bh-size:11px;"));
  });

  it("w trybie OSOBNYM brak wiersza EN SPADA na wiersz bazowy", async () => {
    // Pusty wiersz angielski nie może zostawić strony bez tokenów.
    h.language = "en";
    h.settings = {
      theme_design: { blockHeading: { fontSize: "11px" } },
      theme_design_lang_mode: { mode: "split" },
    };
    render(<ThemeDesignStyle />, { wrapper });
    await waitFor(() => expect(styleText("data-theme-design")).toContain("--td-bh-size"));
  });
});

describe("ThemeDesignStyle - bramka przed wyjściem z bloku style", () => {
  it("NEUTRALIZUJE próbę zamknięcia bloku style w wartości koloru", async () => {
    // `themeDesignToCss` NIE waliduje kolorów - `COLOR` to `z.string().min(1)`,
    // więc dowolny napis z bazy trafia wprost do arkusza. Cała obrona stoi
    // tutaj i celuje DOKŁADNIE w jedno: wartość nie może ZAMKNĄĆ bloku
    // `<style>`. Wewnątrz bloku `<style>` otwierający `<script>` jest zwykłym
    // tekstem - dopiero `</style>` kończy element i wypuszcza treść do HTML-a.
    h.settings = {
      theme_design: { blockHeading: { color: "red</style><script>alert(1)</script>" } },
    };
    render(<ThemeDesignStyle />, { wrapper });

    await waitFor(() => expect(styleText("data-theme-design")).toContain("--td-bh-color"));
    const css = styleText("data-theme-design");
    expect(css).not.toContain("</style>");
    // Wstrzyknięty tekst zostaje, ale rozbrojony - bez ukośnika zamykającego.
    expect(css).toContain("red/style>");
  });

  it("USUWA otwarcie komentarza HTML, które ucina resztę arkusza", async () => {
    h.settings = { theme_design: { blockHeading: { color: "red<!--" } } };
    render(<ThemeDesignStyle />, { wrapper });

    await waitFor(() => expect(styleText("data-theme-design")).toContain("--td-bh-color"));
    expect(styleText("data-theme-design")).not.toContain("<!--");
  });

  it("nie kaleczy legalnych wartości CSS z nawiasami i przecinkami", async () => {
    // Bramka ma ciąć znacznik, a nie `color-mix(in oklab, …)`.
    h.settings = {
      theme_design: {
        blockHeading: { color: "color-mix(in oklab, var(--brand) 70%, transparent)" },
      },
    };
    render(<ThemeDesignStyle />, { wrapper });
    await waitFor(() =>
      expect(styleText("data-theme-design")).toContain("color-mix(in oklab, var(--brand)"),
    );
  });
});

describe("ThemeFontSizesStyle", () => {
  it("emituje DOMYŚLNE tokeny, zanim ustawienia się wczytają", () => {
    // Brak tokenów to strona bez skali typograficznej - tytuł wpisu i lead
    // renderują się rozmiarem przeglądarki.
    render(<ThemeFontSizesStyle />, { wrapper });
    expect(styleText("data-theme-font-sizes")).toContain("--fs-body");
  });

  it("emituje token dla KAŻDEGO poziomu nagłówka", async () => {
    render(<ThemeFontSizesStyle />, { wrapper });
    await waitFor(() => {
      const css = styleText("data-theme-font-sizes");
      for (const level of ["h1", "h2", "h3", "h4", "h5", "h6"]) {
        expect(css).toContain(`--fs-${level}`);
      }
    });
  });

  it("przepuszcza zapisane rozmiary z ustawień", async () => {
    h.settings = { font_sizes: { body: { size: 19, lineHeight: 1.7 } } };
    render(<ThemeFontSizesStyle />, { wrapper });
    await waitFor(() => expect(styleText("data-theme-font-sizes")).toContain("--fs-body:19px;"));
  });

  it("przechodzi przez tę samą bramkę co tokeny Theme Design", async () => {
    render(<ThemeFontSizesStyle />, { wrapper });
    await waitFor(() => expect(styleText("data-theme-font-sizes")).toContain("--fs-body"));
    expect(styleText("data-theme-font-sizes")).not.toContain("</style>");
  });
});
