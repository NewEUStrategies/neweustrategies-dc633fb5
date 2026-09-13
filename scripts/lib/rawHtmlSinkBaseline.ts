// ZAMROŻONY INWENTARZ UJŚĆ SUROWEGO HTML-a: per plik, z liczbą i uzasadnieniem.
//
// Stan ZMIERZONY, nie przepisany (`bun run check:raw-html-sinks --print-baseline`):
// 84 miejsca w 56 plikach. Liczenie idzie przez `bezKomentarzy`
// (`src/lib/ci/sourceScan.ts`), więc wzmianki w komentarzach - a to repozytorium
// opisuje tę dyscyplinę prozą w kilkunastu modułach - nie wchodzą do inwentarza.
//
// TO JEST ALLOWLISTA, NIE RATCHET DO ZERA. Zero jest tu nie tylko nieosiągalne,
// ale i niepożądane: CMS ma renderować HTML napisany w edytorze, `<style>`
// z tokenami motywu nie da się wstawić inaczej, a JSON-LD z definicji jest
// blokiem tekstu w `<script>`. Inwariantem nie jest „nie renderuj HTML-a", tylko
// „każde takie miejsce ma NAPISANY powód, który da się zrecenzować". Dlatego
// wartością wpisu jest zdanie, a nie sama liczba - wzorzec z
// `PUBLIC_PATH_ALLOWLIST` w `scripts/check-sql-tenant-scope.ts`.
//
// LICZBA obok powodu zamyka jedyną dziurę listy per plik: `renderer/atoms.tsx`
// ma dziewięć uzasadnionych ujść, więc dziesiąte - niesanityzowane - byłoby
// w liście per-plik niewidzialne.
//
// Lista mieszka osobno od runnera, żeby dodanie widgetu było diffem w JEDNYM
// miejscu (ta sama zasada co `scripts/lib/unknownCastBaseline.ts`).
//
// ODŚWIEŻANIE: `--print-baseline` przenosi istniejące `why` i zostawia puste
// dla plików nowych. NIE dopisuj wpisów ręcznie „na oko" - Prettier i tak
// przeformatuje zawijanie, a rozjazd między listą a źródłem wyłapuje test
// `src/lib/ci/__tests__/rawHtmlSinks.test.ts`, który chodzi po realnym `src`.

/** Ile ujść w pliku i dlaczego wolno im tam być. */
export interface RawHtmlSinkEntry {
  readonly sites: number;
  readonly why: string;
}

export const RAW_HTML_SINK_BASELINE: Readonly<Record<string, RawHtmlSinkEntry>> = {
  "src/components/admin/blocks/AutoFootnotesPreview.tsx": {
    sites: 1,
    why: "renderFootnoteHtml = sanitize(text) (blocks/renderer/footnotes.ts:49)",
  },
  "src/components/admin/blocks/edit/Html.tsx": {
    sites: 1,
    why: "sanitizeHtml w useMemo (Html.tsx:14), podgląd bloku HTML w edytorze",
  },
  "src/components/admin/builder/ui/organisms/builder/VisualCanvas.tsx": {
    sites: 1,
    why: "stałe CSS kanwy; jedyne wstawki to cssText(t(...)), czyli JSON.stringify napisu ze słownika i18n, a słowniki są statycznymi modułami w repo - w elemencie raw-text JSON.stringify NIE zatrzymałby `</style>`, więc ten wpis stoi na tym fakcie, nie na escapowaniu",
  },
  "src/components/admin/GlobalColorsEditor.tsx": {
    sites: 1,
    why: "hardenStyleCss na podglądzie palety kolorów",
  },
  "src/components/admin/newsletter/builder/WidgetPreview.tsx": {
    sites: 2,
    why: "sanitizeHtml na html widgetu newslettera",
  },
  "src/components/admin/newsletter/PopupPreview.tsx": {
    sites: 1,
    why: "sanitizeHtml na policy_html (PopupPreview.tsx:85)",
  },
  "src/components/admin/newsletter/subscribers/SubscriberDetailDialog.tsx": {
    sites: 1,
    why: "sanitizeHtml na treści pochodzącej od subskrybenta",
  },
  "src/components/admin/podcasts/EpisodeEditorPane.tsx": {
    sites: 1,
    why: "sanitizeHtml na show_notes (EpisodeEditorPane.tsx:140)",
  },
  "src/components/admin/theme-design/organisms/live-preview/LivePostPreview.tsx": {
    sites: 1,
    why: "hardenStyleCss na scoped CSS podglądu wpisu",
  },
  "src/components/admin/ThemeBackgroundsPane.tsx": {
    sites: 1,
    why: "hardenStyleCss na podglądzie tła",
  },
  "src/components/admin/ThemeFontSizesPane.tsx": {
    sites: 1,
    why: "fontSizesToCss(draft) + liczbowy odstęp akapitu; ROZJAZD ZE ZNANYM WZORCEM - publiczny bliźniak theme/ThemeFontSizesStyle.tsx:14 owija to samo w hardenStyleCss, ten panel nie; wejściem jest własny draft admina (liczby), więc bezpieczne, ale niespójne",
  },
  "src/components/AlertBar.tsx": {
    sites: 1,
    why: "inline `<script>` ukrywający pasek przed pierwszym malowaniem; jedyna wstawka to fingerprint przez JSON.stringify z podmianą `<` na \\u003c (AlertBar.tsx:129-131)",
  },
  "src/components/blocks/BlocksRenderer.tsx": {
    sites: 1,
    why: "renderFootnoteHtml = sanitize(text) na treści przypisu",
  },
  "src/components/blocks/ContactFormView.tsx": {
    sites: 2,
    why: "CSS rozmiarów liczony z num() i zakresu useId (ContactFormView.tsx:237-256); drugie miejsce przez hardenStyleCss",
  },
  "src/components/blocks/FaqBlockView.tsx": {
    sites: 1,
    why: "safeJsonLd (lib/seo/jsonld.ts) na FAQPage",
  },
  "src/components/blocks/InteractiveViews.tsx": {
    sites: 2,
    why: "clean() = sanitizeHtml (InteractiveViews.tsx:19)",
  },
  "src/components/blocks/LiveBlogBlock.tsx": {
    sites: 1,
    why: "sanitizeHtml(entry.body_html) (LiveBlogBlock.tsx:219)",
  },
  "src/components/blocks/renderer/atoms.tsx": {
    sites: 9,
    why: "treść z pre-passu fnHtml (sanitize w precomputeFootnotes); decorateCmsStatusIcons działa na JUŻ oczyszczonym HTML-u; kotwice legacy przez SAFE_ANCHOR_RE. DŁUG: fallbacki `?? str(block.data, 'html')` w :19 i :282 są BEZ sanitize - nieosiągalne, bo pre-pass ustawia mapę bezwarunkowo dla paragraph/html/spoiler i schodzi w te same kontenery co renderChild; bliźniak renderSpoiler (molecules.tsx:642) sanityzuje swój fallback jawnie",
  },
  "src/components/blocks/renderer/molecules.tsx": {
    sites: 2,
    why: "komórka tabeli z pre-passu fnHtml; spoiler ma jawny `?? sanitize(...)` w fallbacku",
  },
  "src/components/blocks/ReviewBlockView.tsx": {
    sites: 1,
    why: "safeJsonLd (lib/seo/jsonld.ts) na Review",
  },
  "src/components/builder/organisms/BuilderRenderer.tsx": {
    sites: 3,
    why: "stała modułowa DEBUG_OVERLAY_CSS oraz dwa hardenStyleCss",
  },
  "src/components/builder/organisms/widget-view/AccordionWidget.tsx": {
    sites: 1,
    why: "sanitizeHtml na treści odpowiedzi w akordeonie",
  },
  "src/components/builder/organisms/widget-view/InteractiveCircleWidget.tsx": {
    sites: 2,
    why: "sanitizeHtml na opisach segmentów",
  },
  "src/components/builder/organisms/widget-view/NewsTickerView.tsx": {
    sites: 2,
    why: "@keyframes; nazwa animacji z useId() po odcięciu dwukropków, wartości z arytmetyki - zero danych z zewnątrz",
  },
  "src/components/builder/organisms/widget-view/RatedListView.tsx": {
    sites: 1,
    why: "hardenStyleCss na CSS kolorów listy",
  },
  "src/components/builder/organisms/widget-view/RichHtmlView.tsx": {
    sites: 1,
    why: "sanitizeHtml, a dopiero po nim decorateCmsStatusIcons (RichHtmlView.tsx:40)",
  },
  "src/components/builder/organisms/widget-view/SearchButtonWidget.tsx": {
    sites: 1,
    why: "stały literał CSS w `<style>`, zero wstawek",
  },
  "src/components/builder/organisms/widget-view/TabsBlock.tsx": {
    sites: 1,
    why: "sanitizeHtml na html_<lang> zakładki",
  },
  "src/components/builder/organisms/widget-view/TailoredMustReadsView.tsx": {
    sites: 1,
    why: "stała modułowa TMR_TITLE_CSS, zero wstawek",
  },
  "src/components/builder/organisms/widget-view/TeamMemberWidget.tsx": {
    sites: 1,
    why: "sanitizeHtml na bio (TeamMemberWidget.tsx:60)",
  },
  "src/components/builder/organisms/widget-view/TrendingNowView.tsx": {
    sites: 1,
    why: "buildTrendingKeyframes; nazwa animacji z useId(), stopnie z toFixed() - zero danych z zewnątrz",
  },
  "src/components/builder/organisms/WidgetView.tsx": {
    sites: 1,
    why: "hardenStyleCss na CSS widgetu",
  },
  "src/components/content/ContentRenderer.tsx": {
    sites: 1,
    why: "sanitizeMarkdownHtml, a dopiero potem enhanceContentImages - PO sanityzatorze, nigdy zamiast (parametr nazywa się sanitizedHtml)",
  },
  "src/components/ContentAreaStyle.tsx": {
    sites: 1,
    why: "hardenStyleCss na CSS obszaru treści",
  },
  "src/components/DesignTokensStyle.tsx": {
    sites: 1,
    why: "hardenStyleCss na tokenach marki",
  },
  "src/components/events/public/atoms/EventBrandingStyle.tsx": {
    sites: 1,
    why: "hardenStyleCss na tokenach brandingu wydarzenia",
  },
  "src/components/experts/ExpertLayoutRenderer.tsx": {
    sites: 1,
    why: "expertLayoutScopeCss - scopeId przycięty do [A-Za-z0-9_-], kolory przez sanitizeCssColor (lib/experts/layoutRules.ts:102)",
  },
  "src/components/features/MethodologyNote.tsx": {
    sites: 1,
    why: "sanitizeHtml w useMemo na treści noty metodologicznej",
  },
  "src/components/files/DocumentViewerBody.tsx": {
    sites: 2,
    why: "DOMPurify w warstwie parsowania (lib/files/officeParse.ts:36) - jedyne miejsce, w którym dokument obcego autora staje się DOM-em",
  },
  "src/components/Footnotes.tsx": {
    sites: 2,
    why: "sanitizeHtml na treści przypisu",
  },
  "src/components/header/TrendingTicker.tsx": {
    sites: 4,
    why: "dwa @keyframes z nazwą z useId(), jeden hardenStyleCss, jeden stały TickerStyles",
  },
  "src/components/newsletter/NewsletterDocRenderer.tsx": {
    sites: 2,
    why: "sanitizeHtml na html widgetu dokumentu newslettera",
  },
  "src/components/NewsletterForm.tsx": {
    sites: 2,
    why: "sanitizeHtml na treści zgody i etykiecie",
  },
  "src/components/patterns/PatternPicker.tsx": {
    sites: 1,
    why: "sanitizeHtml na podglądzie treści wzorca",
  },
  "src/components/PopupSignupForm.tsx": {
    sites: 2,
    why: "sanitizeHtml na polityce prywatności i regulaminie",
  },
  "src/components/post/CitationBox.tsx": {
    sites: 1,
    why: "formatChicago escapuje KAŻDĄ wstawkę przez escapeHtml (lib/citations/format.ts:249-262); `<em>` wokół tytułu jest jedynym znacznikiem, jaki ta funkcja wypuszcza",
  },
  "src/components/pricing/organisms/PricingFaq.tsx": {
    sites: 1,
    why: "safeJsonLd (lib/seo/jsonld.ts) na FAQPage cennika",
  },
  "src/components/theme/ThemeDesignStyle.tsx": {
    sites: 1,
    why: "hardenStyleCss na CSS motywu",
  },
  "src/components/theme/ThemeFontSizesStyle.tsx": {
    sites: 1,
    why: "hardenStyleCss na tokenach rozmiarów typografii",
  },
  "src/components/ThemeOptionsStyle.tsx": {
    sites: 1,
    why: "hardenStyleCss na opcjach motywu",
  },
  "src/routes/__root.tsx": {
    sites: 4,
    why: "trzy stałe modułowe (BOOT_PROBE_SCRIPT, THEME_INIT_SCRIPT, DOCK_RESERVE_INIT_SCRIPT) oraz supabasePublicConfigScript = JSON.stringify konfiguracji publicznej z env builda",
  },
  "src/routes/admin.live-blog.tsx": {
    sites: 1,
    why: "sanitizeHtml na body_html wpisu relacji na żywo",
  },
  "src/routes/events.$slug.index.tsx": {
    sites: 1,
    why: "safeJsonLd (lib/seo/jsonld.ts) na Event",
  },
  "src/routes/glossary.tsx": {
    sites: 1,
    why: "JSON.stringify(...).replace(/</g, '\\u003c') pisane ręcznie zamiast safeJsonLd - w elemencie raw-text ucięcie `<` wystarczy, ale to jedyny z czterech sinków JSON-LD, który nie idzie przez wspólny helper (nie escapuje `>`, `&`, U+2028/9); do ujednolicenia",
  },
  "src/routes/podcast.$slug.tsx": {
    sites: 2,
    why: "sanitizeHtml na show notes i na transkrypcji odcinka",
  },
  "src/routes/search.tsx": {
    sites: 1,
    why: "stały literał CSS formularza wyszukiwania, zero wstawek",
  },
};
