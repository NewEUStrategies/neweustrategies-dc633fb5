// Injects Theme Design tokens as CSS variables under :root. Pairs with the
// utility classes defined in styles.css (`.cms-block-heading`, `.cms-thumb`,
// `.cms-read-more`, `.cms-meta-info`).
//
// Language-aware: when the admin sets Theme Design to "split per lang",
// consumers browsing EN receive the EN token set. This keeps public pages, CMS
// builders (Gutenberg / Elementor-style) and every widget visually consistent
// per language.
//
// Blok emitujemy ZAWSZE: dawne `return null` znaczyło "SSR bez tokenów motywu,
// klient z tokenami", więc nagłówki bloków, przyciski „czytaj dalej" i meta
// zmieniały rozmiar tuż po hydratacji (audyt CWV, F29a).
//
// ŹRÓDŁO DANYCH (2026-10, audyt PSI). Komponent czyta SUROWE wiersze
// `theme_design*` z mapy `site_settings` (rozgrzewanej przez loader korzenia
// i dehydratowanej), a nie zapytania pochodne `useThemeDesign*`:
//   * tamte hooki żyją w `lib/theme/themeDesign.ts` (22 kB) - module, który
//     ma zejść ze ścieżki bootowania;
//   * SSR nigdy ich nie wypełniał (`useQuery` nie pobiera na serwerze), więc
//     serwer wysyłał DOMYŚLNE tokeny, a klient podmieniał je po hydratacji.
// Wpisy pochodne nadal mają pierwszeństwo, gdy ISTNIEJĄ w cache'u: pisze do
// nich podgląd na żywo panelu (`useLiveThemeDesignPreview`) i zapis
// (`useSaveThemeDesign`) - czytamy je bez obserwatora (`useCachedQueryData`).
//
// Generator (`theme/css/themeDesignCss.ts`) nie jedzie w boocie klienta:
// serwer liczy CSS synchronicznie, klient przepisuje blok z HTML-a, a import
// dzieje się dopiero przy zmianie danych - patrz `useDeferredStyleCss`.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { useCachedQueryData } from "@/hooks/useCachedQueryData";
import {
  THEME_DESIGN_KEY,
  THEME_DESIGN_KEY_EN,
  THEME_DESIGN_LANG_MODE_KEY,
  THEME_DESIGN_QUERY_KEY,
  THEME_DESIGN_QUERY_KEY_EN,
  THEME_DESIGN_LANG_MODE_QUERY_KEY,
} from "@/lib/theme/themeDesignKeys";
import { useDeferredStyleCss, type StyleGenerator } from "./useDeferredStyleCss";
import { StyleSink } from "./StyleSink";
import {
  themeDesignStyleCss as serverThemeDesignStyleCss,
  type ThemeDesignStyleInput,
} from "./css/themeDesignCss";

const MARKER = "data-theme-design";

// Kompilator Start wycina gałąź `.server()` z bundla przeglądarki razem
// z nieużywanym już importem generatora (wzorzec: widget-view/lazySliderRender).
const getServerGenerate = createIsomorphicFn()
  .server((): StyleGenerator<ThemeDesignStyleInput> | null => serverThemeDesignStyleCss)
  .client((): StyleGenerator<ThemeDesignStyleInput> | null => null);
const serverGenerate = getServerGenerate();

const loadGenerate = () => import("./css/themeDesignCss").then((m) => m.themeDesignStyleCss);

export function ThemeDesignStyle() {
  const { i18n } = useTranslation();
  const lang = (i18n.language ?? "pl").startsWith("en") ? "en" : "pl";
  const { data: settings } = useQuery(siteSettingsQueryOptions);
  const plOverride = useCachedQueryData<unknown>(THEME_DESIGN_QUERY_KEY);
  const enOverride = useCachedQueryData<unknown>(THEME_DESIGN_QUERY_KEY_EN);
  const modeOverride = useCachedQueryData<unknown>(THEME_DESIGN_LANG_MODE_QUERY_KEY);
  const pl = plOverride ?? settings?.[THEME_DESIGN_KEY];
  const en = enOverride ?? settings?.[THEME_DESIGN_KEY_EN];
  const modeRaw = modeOverride ?? settings?.[THEME_DESIGN_LANG_MODE_KEY];
  // Ta sama normalizacja co `themeDesignLangModeFromRaw` - tu tylko dla
  // atrybutu, więc bez importu z ciężkiego modułu.
  const mode = (modeRaw as { mode?: unknown } | undefined)?.mode === "split" ? "split" : "shared";
  const input = useMemo<ThemeDesignStyleInput>(
    () => ({ lang, pl, en, mode: modeRaw }),
    [lang, pl, en, modeRaw],
  );
  const { css, hash } = useDeferredStyleCss({
    marker: MARKER,
    input,
    serverGenerate,
    loadGenerate,
  });
  // Utwardzenie i memo po surowym napisie: `StyleSink` (P1.2).
  return (
    <StyleSink
      data-theme-design
      data-lang={lang}
      data-mode={mode}
      data-css-hash={hash || undefined}
      css={css}
    />
  );
}
