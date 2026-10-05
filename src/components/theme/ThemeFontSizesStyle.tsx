// Injects font-size tokens (H1-H6, body, small, lead, blockquote, code) as
// :root CSS custom properties. Consumed by global selectors in styles.css.
// Dopóki bulk-query site_settings nie wróci, emitujemy defaulty - dzięki temu
// tytuł wpisu i lead nigdy nie renderują się bez tokenów motywu.
//
// Czytamy SUROWY wiersz `font_sizes` z mapy ustawień (ta sama projekcja, którą
// robi `useFontSizes`), żeby nie importować `lib/theme/fontSizes.ts` (schemat
// zod + generator, 7,5 kB) do bootu klienta. Generator liczy serwer; klient
// przepisuje gotowy blok z HTML-a i dociąga generator przez `import()` tylko
// przy zmianie wiersza - patrz `useDeferredStyleCss` (audyt PSI 2026-10-02).
import { useQuery } from "@tanstack/react-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { FONT_SIZES_KEY } from "@/lib/theme/fontSizesKey";
import { useDeferredStyleCss, type StyleGenerator } from "./useDeferredStyleCss";
import { StyleSink } from "./StyleSink";
import { themeFontSizesStyleCss as serverThemeFontSizesStyleCss } from "./css/themeFontSizesCss";

const MARKER = "data-theme-font-sizes";

// Kompilator Start wycina gałąź `.server()` z bundla przeglądarki razem
// z nieużywanym już importem generatora (wzorzec: widget-view/lazySliderRender).
const getServerGenerate = createIsomorphicFn()
  .server((): StyleGenerator<unknown> | null => serverThemeFontSizesStyleCss)
  .client((): StyleGenerator<unknown> | null => null);
const serverGenerate = getServerGenerate();

const loadGenerate = () => import("./css/themeFontSizesCss").then((m) => m.themeFontSizesStyleCss);

export function ThemeFontSizesStyle() {
  const { data: settings } = useQuery(siteSettingsQueryOptions);
  // Surowy wiersz ma stabilną tożsamość razem z mapą (structural sharing
  // react-query), więc skrót liczy się tylko przy realnej zmianie.
  const raw: unknown = settings?.[FONT_SIZES_KEY];
  const { css, hash } = useDeferredStyleCss({
    marker: MARKER,
    input: raw,
    serverGenerate,
    loadGenerate,
  });
  // Utwardzenie i memo po surowym napisie: `StyleSink` (P1.2).
  return <StyleSink data-theme-font-sizes data-css-hash={hash || undefined} css={css} />;
}
