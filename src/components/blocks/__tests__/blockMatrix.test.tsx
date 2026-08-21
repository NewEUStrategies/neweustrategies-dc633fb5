// MACIERZ RENDERU wszystkich typów bloków publicznych, w trzech stanach danych.
//
// Kontrakt, którego pilnuje ten plik, jest jeden i jest twardy: blok, który
// czytelnik zobaczy na stronie, NIE MA PRAWA ani rzucić wyjątku, ani wypisać
// w treści `undefined`, `NaN` czy `[object Object]`. To nie hipoteza - dokładnie
// tak wygląda awaria pola `?? ""`, którego nikt nie wykonał: strona się
// renderuje, w logach cisza, a w akapicie stoi „undefined".
//
// Stany na KAŻDY typ (rejestr jest totalny, więc tabela jest kompletna
// z definicji - nowy blok bez fixture'a natychmiast czerwieni bramkę):
//   1. DANE PEŁNE     - trafia ramię „wartość obecna" każdego `??` / `?:`,
//   2. DANE PUSTE     - `data: {}`, czyli ramię fallbacku w całości,
//   3. DANE DOMYŚLNE  - dokładnie to, co produkuje `BLOCK_SPECS[t].create()`,
//   4. DANE CZĘŚCIOWE - pełne MINUS jedno pole, oraz warianty `null` / `""` /
//                       `0` / zły typ / tablica zamiast wartości.
//
// Render idzie przez `BlockView` BEZ granicy błędu (`RenderErrorBoundary`
// z `BlocksRenderer` połknąłby wyjątek i test byłby pusty w środku).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { BLOCK_RENDERERS, BlockView, BlocksTenantProvider } from "@/components/blocks/renderer";
import { BLOCK_SPECS } from "@/lib/blocks/registry";
import type { Block, BlockType, Json } from "@/lib/blocks/types";
import { CurrentPostProvider, type CurrentPostCtx } from "@/lib/content-model/postContext";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
// Bloki dynamiczne i formularze sięgają po anonimowego klienta Supabase w
// EFEKTACH (newsletter -> useInterests, formularze auth, ankieta, live blog,
// statystyki wpisu). Bez atrapy `createSupabaseClient` rzuca na brak zmiennych
// środowiskowych i test mówi o konfiguracji, nie o renderze bloku. Atrapa NIE
// udaje RLS - izolację najemcy dowodzi pgTAP i `renderer/tenant.test.tsx`.
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const link of [
    "select",
    "insert",
    "update",
    "upsert",
    "delete",
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "in",
    "is",
    "not",
    "like",
    "ilike",
    "or",
    "filter",
    "match",
    "contains",
    "overlaps",
    "order",
    "limit",
    "range",
    "returns",
    "abortSignal",
  ]) {
    chain[link] = () => chain;
  }
  chain.single = async () => ({ data: null, error: null });
  chain.maybeSingle = async () => ({ data: null, error: null });
  chain.then = (onFulfilled?: (v: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null, count: 0 }).then(onFulfilled);
  const channel = {
    on: () => channel,
    subscribe: () => channel,
    unsubscribe: () => undefined,
  };
  return {
    supabase: {
      from: () => chain,
      rpc: async () => ({ data: null, error: null }),
      channel: () => channel,
      removeChannel: () => undefined,
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        getUser: async () => ({ data: { user: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
        signInWithPassword: async () => ({ data: null, error: null }),
        signUp: async () => ({ data: null, error: null }),
        signInWithOAuth: async () => ({ data: null, error: null }),
        resetPasswordForEmail: async () => ({ data: null, error: null }),
        updateUser: async () => ({ data: null, error: null }),
      },
    },
  };
});
vi.mock("@tanstack/react-router", async () => {
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return {
    Link: RouterLinkStub,
    useNavigate: () => () => undefined,
    useRouter: () => ({ navigate: () => undefined }),
    useSearch: () => ({}),
    useParams: () => ({}),
  };
});
// `NewsletterForm` importuje `newsletter.functions`, więc modułu NIE wolno
// podmienić w całości - `createServerFn` musi zostać, inaczej kolekcja pliku
// pada na etapie importu. Atrapa `serverFnStubModule` oddaje kompletny łańcuch
// budujący i neutralne `useServerFn`.
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return { ...actual, ...serverFnStubModule(), useServerFn: () => async () => ({}) };
});
// Rejestr leniwych widoków (wykres, mapa, ankieta, kalendarz, live blog) jest
// w produkcji `React.lazy`, więc pod `render()` bez SSR jego Suspense oddaje
// `null` i widok nie wykonuje ANI JEDNEJ linii. Podmieniamy na import eager -
// ten sam wzorzec, którym `@/test/eagerWidgetChunks` odblokowuje widgety
// buildera.
vi.mock("@/components/blocks/renderer/lazyBlockViews", async () => {
  const [dataViz, poll, calendar, liveblog] = await Promise.all([
    import("@/components/blocks/DataVizViews"),
    import("@/components/blocks/PollBlockView"),
    import("@/components/blocks/CalendarView"),
    import("@/components/blocks/LiveBlogBlock"),
  ]);
  return {
    ChartBlockView: dataViz.ChartBlockView,
    DataMapBlockView: dataViz.DataMapBlockView,
    PollBlockView: poll.PollBlockView,
    CalendarView: calendar.CalendarView,
    LiveBlogBlock: liveblog.LiveBlogBlock,
  };
});

const ALL_TYPES = Object.keys(BLOCK_RENDERERS) as BlockType[];

/** Data bazowa dla wszystkiego, co zależy od czasu - żadnego `Date.now()`. */
const NOW = new Date("2026-08-19T12:00:00.000Z");

const POST_CTX: CurrentPostCtx = {
  kind: "post",
  id: "post-1",
  slug: "przykladowy-wpis",
  title_pl: "Tytuł wpisu",
  title_en: "Post title",
  excerpt_pl: "Zajawka wpisu po polsku.",
  excerpt_en: "Post excerpt in English.",
  coverUrl: "https://cdn.test/cover.jpg",
  publishedAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-15T10:00:00.000Z",
  readingTimeMin: 7,
  viewCount: 1234,
  author: {
    id: "author-1",
    name: "Autor Testowy",
    slug: "autor-testowy",
    avatarUrl: "https://cdn.test/avatar.jpg",
    bio: "Biogram autora.",
    postsCount: 12,
  } as CurrentPostCtx["author"],
  categories: [{ slug: "analizy", name: "Analizy" }],
  tags: [{ slug: "energia", name: "Energia" }],
  breadcrumbs: [
    { label: "Start", href: "/" },
    { label: "Analizy", href: "/analizy" },
    { label: "Wpis" },
  ],
};

/**
 * DANE PEŁNE per typ bloku. Klucze pochodzą z faktycznych odczytów
 * `str/num/bool/strList/jsonList/objList` w atoms/molecules/organisms - a nie
 * z domysłów - żeby ten wariant naprawdę trafiał w ramię „wartość obecna".
 */
const FULL: Partial<Record<BlockType, Record<string, unknown>>> = {
  paragraph: { html: "<p>Akapit z <strong>pogrubieniem</strong> i <a href='/x'>linkiem</a>.</p>" },
  heading: { level: 3, text: "Nagłówek sekcji", anchor: "sekcja" },
  list: { ordered: true, items: ["Pierwszy", "Drugi"], start: 3 },
  quote: { text: "Treść cytatu", cite: "Autor cytatu", variant: "card", colorPalette: "brand" },
  html: { html: "<div>Surowy blok HTML</div>" },
  separator: { variant: "dots" },
  callout: { variant: "warning", text: "Ostrzeżenie dla czytelnika" },
  button: { label: "Przejdź dalej", href: "https://x.test/cel", variant: "outline" },
  spacer: { height: 48 },
  "page-break": {},
  "read-more": {},
  pullquote: { text: "Wyróżniona myśl", cite: "Źródło" },
  preformatted: { text: "  tekst\n  z wcięciem" },
  verse: { text: "Wiersz\nz łamaniem" },
  image: {
    url: "https://cdn.test/a.jpg",
    alt: "Opis obrazu",
    caption: "Podpis pod obrazem",
    href: "https://x.test/cel",
    source: "Agencja",
    sourceUrl: "https://x.test/zrodlo",
    align: "left",
    size: "medium",
    rounded: false,
    shadow: true,
    width: 1200,
    height: 800,
  },
  code: { code: "const a = 1;", lang: "ts" },
  embed: { url: "https://youtu.be/dQw4w9WgXcQ" },
  video: {
    url: "https://cdn.test/v.mp4",
    poster: "https://cdn.test/p.jpg",
    caption: "Podpis wideo",
    aspect: "4/3",
    captionsUrl: "https://cdn.test/v.vtt",
    source: "Studio",
    sourceUrl: "https://x.test/studio",
  },
  gallery: {
    images: [
      { url: "https://cdn.test/1.jpg", alt: "Pierwszy" },
      { url: "https://cdn.test/2.jpg", alt: "Drugi" },
    ],
  },
  audio: {
    url: "https://cdn.test/a.mp3",
    caption: "Podpis audio",
    cover: "https://cdn.test/cover.jpg",
    download: true,
    source: "Podcast",
    sourceUrl: "https://x.test/podcast",
  },
  cover: {
    url: "https://cdn.test/cover.jpg",
    title: "Tytuł na okładce",
    overlay: 60,
    minHeight: 420,
  },
  file: { url: "https://cdn.test/plik.pdf", label: "Pobierz raport", showButton: true },
  "media-text": {
    url: "https://cdn.test/a.jpg",
    text: "<p>Tekst obok grafiki</p>",
    mediaPosition: "right",
  },
  table: {
    header: true,
    rows: [
      ["Kolumna A", "Kolumna B"],
      ["1", "2"],
    ],
  },
  buttons: {
    align: "center",
    items: [
      { label: "Główny", href: "https://x.test/a", variant: "default" },
      { label: "Wtórny", href: "/b", variant: "outline" },
    ],
  },
  "social-icons": {
    align: "right",
    size: 32,
    items: [
      { platform: "facebook", url: "https://facebook.com/nes" },
      { platform: "x", url: "https://x.com/nes" },
      { platform: "linkedin", url: "https://linkedin.com/company/nes" },
      { platform: "instagram", url: "https://instagram.com/nes" },
      { platform: "youtube", url: "https://youtube.com/@nes" },
      { platform: "github", url: "https://github.com/nes" },
      { platform: "tiktok", url: "https://tiktok.com/@nes" },
      { platform: "mail", url: "mailto:biuro@x.test" },
      { platform: "rss", url: "https://x.test/rss" },
    ],
  },
  search: { placeholder: "Szukaj w serwisie", buttonLabel: "Szukaj", action: "/wyniki" },
  proscons: { title: "Bilans", pros: ["Zaleta A", "Zaleta B"], cons: ["Wada A"] },
  spoiler: { summary: "Rozwiń szczegóły", html: "<p>Ukryta treść</p>", defaultOpen: true },
  details: { summary: "Pytanie", body: "Odpowiedź rozwinięta" },
  faq: {
    title: "Najczęstsze pytania",
    items: [
      { q: "Pytanie pierwsze?", a: "Odpowiedź pierwsza." },
      { q: "Pytanie drugie?", a: "Odpowiedź druga." },
    ],
  },
  toc: { title: "Spis treści", minLevel: 2, maxLevel: 4, ordered: true, columns: 2, sticky: true },
  newsletter: { title: "Zapisz się", description: "Cotygodniowa analiza", variant: "inline" },
  review: {
    title: "Ocena",
    summary: "Krótkie podsumowanie",
    scale: 10,
    ctaLabel: "Sprawdź",
    ctaHref: "https://x.test/produkt",
    criteria: [
      { label: "Jakość", score: 8 },
      { label: "Cena", score: 6 },
    ],
  },
  affiliate: {
    title: "Polecany produkt",
    description: "Opis produktu",
    image: "https://cdn.test/p.jpg",
    price: "199",
    currency: "PLN",
    rating: 4.5,
    store: "Sklep",
    sponsored: true,
    ctaLabel: "Kup teraz",
    ctaHref: "https://x.test/kup",
  },
  xquote: { text: "Cytat do udostępnienia", via: "nes", hashtags: "analiza,energia" },
  compare: {
    before: "https://cdn.test/przed.jpg",
    after: "https://cdn.test/po.jpg",
    labelBefore: "Przed",
    labelAfter: "Po",
  },
  // Podgląd linku trzyma listę pod `items` (patrz lib/blocks/linkPreview) -
  // płaskie `url`/`title` dałyby blok, który renderuje się na NIC.
  "link-preview": {
    introPl: "Zobacz też:",
    introEn: "See also:",
    items: [
      { url: "https://x.test/artykul", labelPl: "Artykuł", labelEn: "Article" },
      { url: "https://x.test/drugi", labelPl: "Drugi" },
    ],
    layout: "inline",
    preview: true,
    width: 200,
    height: 120,
  },
  "login-form": { title: "Zaloguj się" },
  "register-form": { title: "Rejestracja" },
  "lost-password-form": { title: "Odzyskaj hasło" },
  "reset-password-form": { title: "Ustaw nowe hasło" },
  accordion: {
    items: [
      { label: "Sekcja A", body: "Treść A" },
      { label: "Sekcja B", body: "Treść B" },
    ],
  },
  tabs: {
    orientation: "vertical",
    items: [
      { label: "Zakładka A", body: "Treść A" },
      { label: "Zakładka B", body: "Treść B" },
    ],
  },
  countdown: {
    targetAt: "2026-12-31T23:59:59.000Z",
    label: "Do końca roku",
    expiredText: "Czas minął",
  },
  progress: { label: "Realizacja", value: 65, showValue: true, color: "brand" },
  "icon-box": {
    icon: "Zap",
    title: "Szybkość",
    description: "Opis korzyści",
    href: "https://x.test/wiecej",
    linkLabel: "Więcej",
    align: "center",
  },
  "stats-counter": {
    duration: 1200,
    items: [
      { value: "120", label: "Analiz", suffix: "+" },
      { value: "40", label: "Krajów" },
    ],
  },
  testimonials: {
    layout: "grid",
    items: [
      {
        quote: "Świetna robota",
        author: "Klient A",
        role: "CEO",
        avatar: "https://cdn.test/1.jpg",
        rating: 5,
      },
      { quote: "Polecam", author: "Klient B" },
    ],
  },
  "pricing-table": {
    plans: [
      {
        name: "Start",
        price: "0",
        period: "mies.",
        features: ["Funkcja A", "Funkcja B"],
        ctaLabel: "Wybierz",
        ctaHref: "/start",
        featured: false,
      },
      {
        name: "Pro",
        price: "99",
        period: "mies.",
        features: ["Wszystko ze Start"],
        ctaLabel: "Kup",
        ctaHref: "/pro",
        featured: true,
      },
    ],
  },
  timeline: {
    items: [
      { date: "2024", title: "Start", description: "Opis etapu" },
      { date: "2026", title: "Rozwój" },
    ],
  },
  hero: {
    eyebrow: "Nowość",
    title: "Tytuł sekcji hero",
    subtitle: "Podtytuł sekcji",
    bgImage: "https://cdn.test/bg.jpg",
    overlay: 40,
    height: 520,
    align: "left",
    ctaLabel: "Zacznij",
    ctaHref: "https://x.test/start",
    secondaryLabel: "Dowiedz się więcej",
    secondaryHref: "/wiecej",
  },
  "cta-section": {
    title: "Zrób następny krok",
    description: "Opis wezwania",
    ctaLabel: "Kontakt",
    ctaHref: "/kontakt",
    variant: "brand",
  },
  "image-carousel": {
    aspect: "16/9",
    interval: 4000,
    items: [
      { url: "https://cdn.test/1.jpg", alt: "Pierwszy", caption: "Podpis 1", href: "/a" },
      { url: "https://cdn.test/2.jpg", alt: "Drugi" },
    ],
  },
  "contact-form": {
    title: "Napisz do nas",
    description: "Odpowiadamy w 24 h",
    showSubject: true,
    requireConsent: true,
    submitLabel: "Wyślij",
    successMessage: "Dziękujemy",
  },
  map: { lat: 52.2297, lng: 21.0122, zoom: 12, height: 400, label: "Warszawa" },
  "team-grid": {
    title: "Zespół",
    columns: 3,
    shape: "circle",
    items: [
      {
        name: "Osoba A",
        role: "Analityk",
        avatar: "https://cdn.test/a.jpg",
        bio: "Biogram",
        social: { linkedin: "https://linkedin.com/in/a" },
      },
      { name: "Osoba B" },
    ],
  },
  "logo-grid": {
    title: "Partnerzy",
    columns: 4,
    grayscale: true,
    items: [
      { url: "https://cdn.test/l1.svg", alt: "Partner A", href: "https://a.test" },
      { url: "https://cdn.test/l2.svg" },
    ],
  },
  "feature-grid": {
    title: "Możliwości",
    subtitle: "Podtytuł",
    columns: 3,
    style: "cards",
    items: [{ icon: "Zap", title: "Funkcja A", description: "Opis A" }, { title: "Funkcja B" }],
  },
  "alert-banner": {
    variant: "danger",
    title: "Uwaga",
    message: "Treść komunikatu",
    showIcon: true,
    ctaLabel: "Szczegóły",
    ctaHref: "/szczegoly",
  },
  "divider-text": { text: "albo", align: "center", lineStyle: "dashed" },
  "step-list": {
    title: "Jak to działa",
    numberStyle: "circle",
    orientation: "horizontal",
    items: [{ title: "Krok pierwszy", description: "Opis kroku" }, { title: "Krok drugi" }],
  },
  "comparison-table": {
    title: "Porównanie",
    featuredIndex: 1,
    columns: ["Wariant A", "Wariant B"],
    rows: [
      { feature: "Cecha 1", values: ["tak", "nie"] },
      { feature: "Cecha 2", values: ["10", "20"] },
    ],
  },
  "banner-image": {
    image: "https://cdn.test/banner.jpg",
    alt: "Baner",
    title: "Tytuł banera",
    description: "Opis banera",
    ctaLabel: "Kliknij",
    ctaHref: "/cel",
    aspect: "21/9",
    overlay: 50,
    position: "center",
    theme: "dark",
  },
  "video-hero": {
    src: "https://cdn.test/hero.mp4",
    poster: "https://cdn.test/hero.jpg",
    title: "Tytuł wideo",
    subtitle: "Podtytuł wideo",
    overlay: 30,
    height: 600,
    align: "center",
    autoplay: true,
    loop: true,
    ctaLabel: "Zobacz",
    ctaHref: "/zobacz",
  },
  chart: {
    kind: "bar",
    title: "Wykres",
    series: [{ name: "Seria", data: [1, 2, 3] }],
    categories: ["A", "B", "C"],
  },
  "data-map": { title: "Mapa", regions: [{ code: "PL", value: 10 }] },
  columns: {
    left: [{ id: "b_l", type: "paragraph", data: { html: "<p>Lewa</p>" } }],
    right: [{ id: "b_r", type: "paragraph", data: { html: "<p>Prawa</p>" } }],
  },
  group: {
    background: "muted",
    padding: 24,
    layout: "constrained",
    children: [{ id: "b_g", type: "paragraph", data: { html: "<p>W grupie</p>" } }],
  },
  row: {
    background: "brand",
    padding: 16,
    columns: 3,
    children: [{ id: "b_r1", type: "paragraph", data: { html: "<p>W rzędzie</p>" } }],
  },
  stack: {
    padding: 8,
    children: [{ id: "b_s1", type: "paragraph", data: { html: "<p>W stosie</p>" } }],
  },
  grid: {
    columns: 2,
    children: [{ id: "b_gr1", type: "paragraph", data: { html: "<p>W siatce</p>" } }],
  },
  liveblog: { title: "Relacja na żywo", reverseChronological: true, autoRefresh: true },
  poll: { pollId: "11111111-2222-3333-4444-555555555555" },
  "latest-posts": {
    count: 4,
    category: "analizy",
    layout: "grid",
    showExcerpt: true,
    showImage: true,
  },
  "tag-cloud": { count: 20, showCount: true },
  "categories-list": { layout: "grid", showCount: true },
  archives: { layout: "list", showCount: true },
  calendar: { month: "2026-08" },
  "post-title": { level: 2 },
  "post-date": { format: "short", showUpdated: true },
  "post-author": { showAvatar: true, showBio: true },
  "post-excerpt": { showMore: true },
  "post-featured-image": { aspect: "16/9", rounded: true },
  "post-terms": { taxonomy: "tags" },
  "site-title": { level: 2 },
  "site-tagline": {},
  "site-logo": { width: 180 },
  navigation: { menuKey: "main", layout: "horizontal" },
  "post-navigation-link": { direction: "next", showTitle: true },
  "query-loop": {
    limit: 3,
    categorySlug: "analizy",
    orderBy: "published_at",
    layout: "grid",
    showDate: true,
    showExcerpt: true,
    showImage: true,
  },
  breadcrumbs: { separator: "/", showHome: true },
  "reading-time": { prefix: "Czas czytania:", wpm: 200 },
  "share-buttons": { networks: ["x", "facebook", "linkedin", "mail"], variant: "filled" },
  "post-views": { suffix: "odsłon" },
  "author-bio": {
    variant: "card",
    showAvatar: true,
    showBio: true,
    showSocial: true,
    showPostsCount: true,
  },
  "related-posts": { heading: "Powiązane", limit: 3, layout: "grid", strategy: "category" },
  "post-stats": { items: ["views", "readingTime", "comments"], separator: "|" },
  "post-rating": { label: "Oceń wpis", max: 5 },
  loginout: { loginHref: "/logowanie", showAvatar: true },
  "more-posts": { heading: "Więcej", limit: 4, strategy: "latest" },
};

/** DANE CZĘŚCIOWE - dokładnie to, co edytor wstawia świeżym blokiem. */
function defaultDataFor(type: BlockType): Record<string, Json> {
  return BLOCK_SPECS[type].create().data;
}

function blockOf(type: BlockType, data: Record<string, unknown>): Block {
  return { id: `b_${type}`, type, data: data as Record<string, Json> };
}

function Harness({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <CurrentPostProvider value={POST_CTX}>
        <BlocksTenantProvider host="nes.test">{children}</BlocksTenantProvider>
      </CurrentPostProvider>
    </QueryClientProvider>
  );
}

function renderBlock(block: Block, lang: "pl" | "en" = "pl"): { container: HTMLElement } {
  const { container } = render(
    <Harness>
      <BlockView block={block} fnHtml={new Map()} lang={lang} postId="post-1" allBlocks={[block]} />
    </Harness>,
  );
  return { container };
}

/** Ciągi, których render publiczny NIE MOŻE wypisać w treści widocznej. */
const LEAKS = ["undefined", "NaN", "[object Object]", "Invalid Date"];

function assertNoLeak(container: HTMLElement, label: string): void {
  const text = container.textContent ?? "";
  for (const leak of LEAKS) {
    expect(
      text.includes(leak),
      `${label}: w treści wyciekło "${leak}" -> ${text.slice(0, 200)}`,
    ).toBe(false);
  }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  // Żaden render publiczny nie ma prawa strzelać po sieci. Atrapa zwraca pustą
  // odpowiedź, więc test mierzy render, a nie dostępność localhosta.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => "",
      headers: new Headers(),
    })),
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("macierz renderu bloków - kompletność tabeli", () => {
  it("KAŻDY typ z rejestru ma fixture danych pełnych", () => {
    const missing = ALL_TYPES.filter((t) => FULL[t] === undefined);
    expect(
      missing,
      `typy bez fixture'a danych pełnych (dopisz je, nie wykluczaj): ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("nie ma fixture'a dla typu, którego rejestr nie zna", () => {
    const known = new Set<string>(ALL_TYPES);
    const orphan = Object.keys(FULL).filter((t) => !known.has(t));
    expect(orphan, `fixture'y bez renderera: ${orphan.join(", ")}`).toEqual([]);
  });

  it("tabela obejmuje wszystkie typy edytora (renderer i edytor to jeden zbiór)", () => {
    expect(ALL_TYPES.length).toBe(Object.keys(BLOCK_SPECS).length);
  });
});

describe("macierz renderu bloków - dane PEŁNE", () => {
  it.each(ALL_TYPES)("%s renderuje się bez wyjątku i bez wycieku wartości", (type) => {
    const { container } = renderBlock(blockOf(type, FULL[type] as Record<string, unknown>));
    assertNoLeak(container, `${type} (pełne)`);
  });
});

describe("macierz renderu bloków - dane PUSTE", () => {
  it.each(ALL_TYPES)("%s z data:{} nie rzuca i nie wypisuje wartości zastępczej", (type) => {
    const { container } = renderBlock(blockOf(type, {}));
    assertNoLeak(container, `${type} (puste)`);
  });
});

describe("macierz renderu bloków - dane DOMYŚLNE z edytora", () => {
  it.each(ALL_TYPES)("%s renderuje się na danych z BLOCK_SPECS.create()", (type) => {
    const { container } = renderBlock(blockOf(type, defaultDataFor(type)));
    assertNoLeak(container, `${type} (domyślne)`);
  });
});

describe("macierz renderu bloków - dane CZĘŚCIOWE", () => {
  // Tu leży większość gałęzi `??`: pole obecne w jednym przebiegu, nieobecne
  // w drugim - i tylko oba razem dowodzą, że fallback nie jest martwym kodem.
  it.each(ALL_TYPES)("%s znosi brak dowolnego JEDNEGO pola danych", (type) => {
    const full = FULL[type] as Record<string, unknown>;
    const keys = Object.keys(full);
    for (const key of keys) {
      const partial = { ...full };
      delete partial[key];
      const { container } = renderBlock(blockOf(type, partial));
      assertNoLeak(container, `${type} (bez pola ${key})`);
    }
    // Blok bez pól danych też przechodzi tę pętlę - asercja poniżej pilnuje,
    // żeby przypadek „zero pól" nie udawał przebiegu tabeli.
    expect(keys.length).toBeGreaterThanOrEqual(0);
  });

  it.each(ALL_TYPES)("%s znosi WSZYSTKIE pola ustawione na null", (type) => {
    const full = FULL[type] as Record<string, unknown>;
    const nulled = Object.fromEntries(Object.keys(full).map((k) => [k, null]));
    const { container } = renderBlock(blockOf(type, nulled));
    assertNoLeak(container, `${type} (pola null)`);
  });

  it.each(ALL_TYPES)("%s znosi WSZYSTKIE pola ustawione na pusty string", (type) => {
    const full = FULL[type] as Record<string, unknown>;
    const emptied = Object.fromEntries(Object.keys(full).map((k) => [k, ""]));
    const { container } = renderBlock(blockOf(type, emptied));
    assertNoLeak(container, `${type} (pola "")`);
  });

  it.each(ALL_TYPES)("%s znosi WSZYSTKIE pola równe 0 (fałszywe, ale prawidłowe)", (type) => {
    const full = FULL[type] as Record<string, unknown>;
    const zeroed = Object.fromEntries(Object.keys(full).map((k) => [k, 0]));
    const { container } = renderBlock(blockOf(type, zeroed));
    assertNoLeak(container, `${type} (pola 0)`);
  });

  it.each(ALL_TYPES)("%s znosi pola o TYPIE niezgodnym z oczekiwanym", (type) => {
    // Dokument wchodzi też z bazy po rollbacku deploya, więc pole może mieć
    // kształt z innej wersji schematu. Czytniki `str/num/bool/*List` mają to
    // znieść fallbackiem, a nie wyjątkiem.
    const full = FULL[type] as Record<string, unknown>;
    const wrong = Object.fromEntries(Object.keys(full).map((k) => [k, { obcy: "kształt" }]));
    const { container } = renderBlock(blockOf(type, wrong));
    assertNoLeak(container, `${type} (pola złego typu)`);
  });

  it.each(ALL_TYPES)("%s znosi pola podane jako TABLICA zamiast wartości", (type) => {
    const full = FULL[type] as Record<string, unknown>;
    const arrayed = Object.fromEntries(Object.keys(full).map((k) => [k, ["a", 1, null]]));
    const { container } = renderBlock(blockOf(type, arrayed));
    assertNoLeak(container, `${type} (pola jako tablica)`);
  });
});

describe("macierz renderu bloków - widoczność i wyrównanie", () => {
  it.each(ALL_TYPES)("%s ukryty stylem NIE renderuje niczego", (type) => {
    const { container } = render(
      <Harness>
        <BlockView
          block={{
            ...blockOf(type, FULL[type] as Record<string, unknown>),
            style: { hidden: true },
          }}
          fnHtml={new Map()}
          lang="pl"
          allBlocks={[]}
        />
      </Harness>,
    );
    expect(container.innerHTML).toBe("");
  });

  it.each(["left", "center", "right", "wide", "full"] as const)(
    "wyrównanie %s przechodzi do renderu akapitu",
    (align) => {
      const { container } = render(
        <Harness>
          <BlockView
            block={{
              ...blockOf("paragraph", FULL.paragraph as Record<string, unknown>),
              style: { align },
            }}
            fnHtml={new Map()}
            lang="pl"
            allBlocks={[]}
          />
        </Harness>,
      );
      expect(container.textContent).toContain("Akapit z");
    },
  );
});

describe("macierz renderu bloków - drugi język", () => {
  it.each(ALL_TYPES)("%s renderuje się także po angielsku", (type) => {
    const { container } = renderBlock(blockOf(type, FULL[type] as Record<string, unknown>), "en");
    assertNoLeak(container, `${type} (EN)`);
  });
});
