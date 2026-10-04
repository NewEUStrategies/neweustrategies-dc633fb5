// Injects CSS variables driven by site_settings.theme_options
// (Buttons + Text Fields tabs) so changes apply across the whole site.
//
// Generator reguł żyje w `theme/css/themeOptionsCss.ts` i nie jedzie w boocie
// klienta: serwer liczy CSS synchronicznie, klient przy hydratacji przepisuje
// gotowy blok z HTML-a, a generator dociąga przez `import()` dopiero przy
// zmianie ustawień - patrz `theme/useDeferredStyleCss` (audyt PSI 2026-10-02).
import { createIsomorphicFn } from "@tanstack/react-start";
import { useSiteSetting } from "@/lib/useSiteSetting";
import { useDeferredStyleCss, type StyleGenerator } from "@/components/theme/useDeferredStyleCss";
import { StyleSink } from "@/components/theme/StyleSink";
import {
  themeOptionsStyleCss as serverThemeOptionsStyleCss,
  type ThemeOptionsCfg,
} from "@/components/theme/css/themeOptionsCss";

const MARKER = "data-theme-options";

/** Jedna tożsamość domyślnych: `useSiteSetting` zwraca ją bez wiersza w bazie. */
const DEFAULTS: ThemeOptionsCfg = {};

// Kompilator Start wycina gałąź `.server()` z bundla przeglądarki razem
// z nieużywanym już importem generatora (wzorzec: widget-view/lazySliderRender).
const getServerGenerate = createIsomorphicFn()
  .server((): StyleGenerator<ThemeOptionsCfg> | null => serverThemeOptionsStyleCss)
  .client((): StyleGenerator<ThemeOptionsCfg> | null => null);
const serverGenerate = getServerGenerate();

const loadGenerate = () =>
  import("@/components/theme/css/themeOptionsCss").then((m) => m.themeOptionsStyleCss);

export function ThemeOptionsStyle() {
  // `useSiteSetting` memoizuje wynik na danych zapytania, więc tożsamość
  // wejścia zmienia się tylko razem z wierszem ustawień.
  const cfg = useSiteSetting<ThemeOptionsCfg>("theme_options", DEFAULTS);
  const { css, hash } = useDeferredStyleCss({
    marker: MARKER,
    input: cfg,
    serverGenerate,
    loadGenerate,
  });
  // Utwardzenie i memo po surowym napisie: `StyleSink` (P1.2).
  return <StyleSink data-theme-options data-css-hash={hash || undefined} css={css} />;
}
