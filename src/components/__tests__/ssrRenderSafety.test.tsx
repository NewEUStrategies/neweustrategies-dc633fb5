// RENDER SERWEROWY RODZINY „CZAS I JĘZYK" (punkt 7, D1-D13) - DOWÓD PRZEZ
// `renderToString`.
//
// ── PO CO OSOBNY PLIK I DLACZEGO WŁAŚNIE `renderToString` ──────────────────
// Wszystkie naprawy tej rodziny dotyczą PIERWSZEGO renderu: tego, co serwer
// wpisuje do HTML-a i co klient MUSI policzyć identycznie, bo inaczej React 19
// porzuca serwerowe poddrzewo i renderuje je od zera - czyli traci dokładnie
// ten HTML, po który jest SSR.
//
// `render()` z testing-library tego nie zobaczy. Tam efekty (w tym layoutowe)
// wykonują się przed powrotem z `render`, więc test widzi stan PO korekcie -
// a naprawiany był stan PRZED nią. Tę samą granicę opisuje nagłówek
// `builder/organisms/__tests__/builderRenderer.device.test.tsx`, na którym ten
// plik jest wzorowany: jedyny sposób zobaczenia pierwszego przejścia to render
// do napisu.
//
// ── CO MA TU DOWÓD ────────────────────────────────────────────────────────
//  1. `CountdownView` (D1) emituje w SSR placeholdery „--", a nie sekundy;
//  2. `CodeBlockView` (D2) bierze język Z PROPA - EN dla „en", PL dla „pl"
//     (wcześniej odczyt `document.documentElement.lang` w ciele renderu dawał
//     na serwerze ZAWSZE polską etykietę, także na trasach /en);
//  3. format „relative" (D3) degraduje w SSR do daty ABSOLUTNEJ;
//  4. `formatDate`/`formatDateTime` (D7) NIE ZALEŻĄ od strefy PROCESU -
//     dowodzone przez dwukrotne wywołanie pod dwiema różnymi strefami, z
//     kontrolą (formatter bez `timeZone`), która pod tymi samymi strefami
//     wynik ZMIENIA;
//  5. rok w stopce (D6) to rok WARSZAWSKI dla ustalonej chwili;
//  6. cztery powierzchnie SSR-owe (D10-D13) renderują się do napisu i niosą
//     PIERWSZY, NIEZMIERZONY stan (albo - jak warstwa dymków przypisów - nie
//     wnoszą do HTML-a nic) - patrz uczciwe zastrzeżenie niżej.
//
// ── UCZCIWE ZASTRZEŻENIE DO D10-D13 ───────────────────────────────────────
// Naprawa D10-D13 (`useIsomorphicLayoutEffect` zamiast gołego
// `useLayoutEffect`) NIE ZMIENIA ANI JEDNEGO BAJTU wyniku. Nie da się więc
// napisać asercji wykonawczej, która pada po jej cofnięciu - i tego pliku
// nie należy o taką asercję prosić, bo byłaby atrapą dowodu. ZMIERZONE na
// `react-dom` 19.2.5: napisu „useLayoutEffect does nothing on the server" nie
// ma w paczce, a render komponentu z gołym `useLayoutEffect` nie wypisuje NIC
// (przy jednoczesnym ostrzeżeniu o brakującym `key`, czyli w budowie
// deweloperskiej). Ostrzegał React 18; React 19 przestał.
// Dlatego decyzję D10-D13 trzyma tu asercja ŹRÓDŁOWA (jedna, na końcu pliku),
// a asercje wykonawcze pilnują tego, co jest realną własnością tych
// komponentów: determinizmu pierwszego renderu.
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { MenuItemRow, MenuWithItems } from "@/lib/menus/types";
import { DEFAULT_MEGA_CONFIG } from "@/lib/menus/types";
import "@/test/i18nReal";
import "@/lib/i18n-mobile-bottom-bar";

// ── ATRAPY WARSTWY DANYCH ─────────────────────────────────────────────────
// Podmieniamy dostęp do danych (server fn / Supabase) i - niżej - podział kodu.
// Bez danych pasek „Na czasie" zwraca `null`, a menu tylko szkielet, więc render
// do napisu nie dotknąłby ani jednego z badanych komponentów. Same komponenty
// są prawdziwe: żadnej atrapy `@/components/**`.
const tickerFeed = vi.hoisted(() => ({
  posts: [
    { id: "p1", slug: "p1", title_pl: "Wpis pierwszy", title_en: "First post" },
    { id: "p2", slug: "p2", title_pl: "Wpis drugi", title_en: "Second post" },
  ],
}));

vi.mock("@/lib/views/headerTickerQuery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/views/headerTickerQuery")>()),
  headerTickerQueryOptions: () => ({
    queryKey: ["ssr-ticker"] as const,
    queryFn: () => Promise.resolve(tickerFeed.posts),
  }),
}));

vi.mock("@/lib/menus/queries", () => ({
  menuWithItemsQueryOptions: (key: string) => ({
    queryKey: ["ssr-menu", key] as const,
    queryFn: () => Promise.resolve(null),
  }),
}));

vi.mock("@/lib/menus/megaFeatured", () => ({
  megaFeaturedPostQueryOptions: (postId: string | null) => ({
    queryKey: ["ssr-mega", postId] as const,
    queryFn: () => Promise.resolve(null),
  }),
}));

// Podział kodu (React.lazy) zamieniony na importy statyczne - ten sam powód co
// w `widget-view/__tests__/widgetBehavior.test.tsx`: bez tego pierwszy render
// leniwych widgetów pokazuje fallback Suspense.
vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

import { CountdownView } from "@/components/blocks/InteractiveViews";
import { CodeBlockView } from "@/components/blocks/CodeBlockView";
import { PostDateView } from "@/components/blocks/ContextBlockViews";
import { CurrentPostProvider, PLACEHOLDER_POST_CTX } from "@/lib/content-model/postContext";
import { formatDate, formatDateTime, siteYear, SITE_TIME_ZONE } from "@/lib/i18n/format";
import { renderSimpleWidget } from "@/components/builder/organisms/widget-view/SimpleWidgets";
import type { WidgetNode } from "@/lib/builder/types";
import { TrendingTicker } from "@/components/header/TrendingTicker";
import { SiteMenu } from "@/components/menu/SiteMenu";
import { FootnoteTooltips } from "@/components/Footnotes";
import { MobileBottomBarView } from "@/components/mobile/bottomBar/MobileBottomBarView";
import {
  MOBILE_BOTTOM_BAR_DEFAULTS,
  activeBottomBarIndex,
  visibleBottomBarItems,
} from "@/lib/mobileBottomBar/config";

/** Render serwerowy z klientem zapytań zasianym z góry (SSR nie dopobiera). */
function ssr(node: ReactElement, seed?: (qc: QueryClient) => void): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed?.(qc);
  return renderToString(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("CountdownView: SSR nie wpisuje sekund (D1)", () => {
  it("serwerowy render emituje cztery placeholdery i ani jednej cyfry licznika", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T12:00:07.000Z"));
    const html = renderToString(<CountdownView targetAt="2026-09-02T15:30:00.000Z" />);
    expect(html.match(/>--</g)?.length).toBe(4);
    // Żadna komórka nie niesie liczby: gdyby zegar był czytany w renderze,
    // serwer wpisałby tu „01"/„03"/„29"/„53" - i klient policzyłby inne.
    expect(html).not.toMatch(/>\d{2}</);
  });
});

describe("CodeBlockView: język z propa, nie z DOM (D2)", () => {
  it("uiLang=en emituje angielską etykietę kopiowania", () => {
    const html = renderToString(<CodeBlockView code="const a = 1;" lang="ts" uiLang="en" />);
    expect(html).toContain("Copy code");
    expect(html).not.toContain("Kopiuj kod");
  });

  it("uiLang=pl emituje polską", () => {
    const html = renderToString(<CodeBlockView code="const a = 1;" lang="ts" uiLang="pl" />);
    expect(html).toContain("Kopiuj kod");
    expect(html).not.toContain("Copy code");
  });
});

describe("PostDateView: format „relative” degraduje w SSR do daty absolutnej (D3)", () => {
  it("serwerowy render nie zawiera etykiety względnej, tylko datę", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T12:00:00.000Z"));
    const html = renderToString(
      <CurrentPostProvider
        value={{ ...PLACEHOLDER_POST_CTX, publishedAt: "2026-09-01T09:00:00.000Z" }}
      >
        <PostDateView format="relative" showUpdated={false} lang="pl" cls="" />
      </CurrentPostProvider>,
    );
    expect(html).not.toMatch(/temu|ago|godzin/);
    expect(html).toContain("1 września 2026");
  });
});

// ── STREFA PROCESU JAKO NARZĘDZIE POMIAROWE ───────────────────────────────
// D7 mówi: wynik formatowania nie może zależeć od strefy MASZYNY, bo serwer
// (Workers = UTC) i przeglądarka czytelnika to dwie różne maszyny. Jedyny
// uczciwy dowód to policzyć TO SAMO pod DWIEMA różnymi strefami procesu.
//
// ZMIERZONE, że to działa w tym środowisku: przypisanie do `process.env.TZ`
// w trakcie życia procesu zmienia `Intl.DateTimeFormat().resolvedOptions()
// .timeZone` (Node reaguje na tę zmienną i przestawia domyślną strefę ICU).
// Gdyby kiedyś przestało, test „narzędzie ma zęby" niżej ZGAŚNIE - i nikt nie
// weźmie słabszego dowodu za mocny.
function underProcessTimeZone<T>(tz: string, fn: () => T): T {
  const before = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

/** 22:30Z = 00:30 NASTĘPNEGO DNIA w Warszawie - granica dnia, nie sama godzina. */
const NIGHT_INSTANT = "2026-07-12T22:30:00.000Z";
const ZONES = ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"] as const;

describe("format.ts: wynik nie zależy od strefy procesu (D7)", () => {
  it("narzędzie ma zęby: strefa procesu zmienia się i formatter BEZ strefy to widzi", () => {
    const seen = ZONES.map((tz) =>
      underProcessTimeZone(tz, () => ({
        resolved: new Intl.DateTimeFormat().resolvedOptions().timeZone,
        // KONTROLA: dokładnie ten formatter, jaki `format.ts` miał przed naprawą.
        unpinned: new Intl.DateTimeFormat("pl-PL", {
          year: "numeric",
          month: "long",
          day: "numeric",
        }).format(new Date(NIGHT_INSTANT)),
      })),
    );
    expect(seen.map((s) => s.resolved)).toEqual([...ZONES]);
    // Żadna ze stref sondujących nie może BYĆ strefą serwisu - inaczej kontrola
    // i podmiot dawałyby ten sam napis, a test byłby ślepy na całą naprawę.
    expect(ZONES).not.toContain(SITE_TIME_ZONE);
    // Bez tej asercji cały blok mógłby być zielony przez to, że strefa się nie
    // zmienia - czyli dowód bez treści.
    expect(new Set(seen.map((s) => s.unpinned)).size).toBeGreaterThan(1);
  });

  it("formatDate i formatDateTime dają jeden napis pod wszystkimi strefami", () => {
    const dates = ZONES.map((tz) =>
      underProcessTimeZone(tz, () => formatDate(NIGHT_INSTANT, "pl")),
    );
    expect(new Set(dates).size).toBe(1);
    expect(dates[0]).toBe("13 lipca 2026");

    const times = ZONES.map((tz) =>
      underProcessTimeZone(tz, () => formatDateTime(NIGHT_INSTANT, "pl")),
    );
    expect(new Set(times).size).toBe(1);
    expect(times[0]).toBe("13.07.2026, 00:30");
  });

  it("serwerowy HTML daty postu jest identyczny pod dwiema strefami procesu", () => {
    const html = (tz: string) =>
      underProcessTimeZone(tz, () =>
        renderToString(
          <CurrentPostProvider value={{ ...PLACEHOLDER_POST_CTX, publishedAt: NIGHT_INSTANT }}>
            <PostDateView format="long" showUpdated={false} lang="pl" cls="" />
          </CurrentPostProvider>,
        ),
      );
    expect(html("UTC")).toBe(html("America/Los_Angeles"));
    // I to NIE jest data cofnięta do UTC („12 lipca").
    expect(html("UTC")).toContain("13 lipca 2026");
  });
});

describe("Stopka: rok jest rokiem strefy serwisu (D6)", () => {
  const copyright: WidgetNode = {
    id: "w-copyright",
    kind: "widget",
    type: "copyright",
    content: { brand: "NES" },
    style: {},
    advanced: {},
  };

  it("31.12.2026 23:30Z stopka drukuje 2027 niezależnie od strefy procesu", () => {
    vi.useFakeTimers();
    // 23:30Z = 00:30 1 stycznia 2027 w Warszawie. Rok redakcyjny już się zmienił.
    vi.setSystemTime(new Date("2026-12-31T23:30:00.000Z"));
    for (const tz of ["UTC", "America/Los_Angeles"]) {
      const html = underProcessTimeZone(tz, () =>
        renderToString(<>{renderSimpleWidget(copyright, "pl", "light")}</>),
      );
      expect(html).toContain("2027");
      expect(html).not.toContain("2026");
    }
    expect(siteYear(Date.parse("2026-12-31T23:30:00.000Z"))).toBe(2027);
  });
});

// ── D10-D13: CZTERY POWIERZCHNIE SSR-OWE Z EFEKTEM LAYOUTOWYM ─────────────
// Patrz zastrzeżenie w nagłówku pliku: sama naprawa (`useIsomorphicLayoutEffect`)
// nie zmienia wyniku, więc TE asercje pilnują determinizmu pierwszego renderu -
// własności, którą pomiar w ciele renderu ZŁAMAŁBY. Decyzję o samym haku trzyma
// asercja źródłowa na końcu.
describe("Powierzchnie SSR-owe z pomiarem przed malowaniem (D10-D13)", () => {
  it("TrendingTicker: serwer NIE mierzy taśmy, więc czas obiegu jest z oszacowania", () => {
    const html = ssr(<TrendingTicker layoutStyle="glassMarquee" scrollSpeed={100} />, (qc) =>
      qc.setQueryData(["ssr-ticker"], tickerFeed.posts),
    );
    expect(html).toContain('data-tt-layout="glassMarquee"');
    // 2 wpisy * 220 px oszacowania / 100 px/s = 4,4 s. Gdyby pomiar zdążył
    // wejść do renderu, `lapPx` byłoby niezerowe i czas inny.
    expect(html).toMatch(/animation:\s*tt-marquee-[^ ]+ 4\.4s linear infinite/);
  });

  it("SiteMenu: serwer emituje wyzwalacz zamkniętego panelu, bez samego panelu", () => {
    const menuItem = (over: Partial<MenuItemRow> & { id: string }): MenuItemRow => ({
      menu_id: "menu-1",
      parent_id: null,
      position: 0,
      item_type: "custom",
      ref_id: null,
      label_pl: "",
      label_en: "",
      href: "",
      target: "_self",
      css_class: "",
      visibility: "all" as const,
      icon: "",
      mega_enabled: false,
      mega_config: DEFAULT_MEGA_CONFIG,
      ...over,
    });
    const menu: MenuWithItems = {
      id: "menu-1",
      key: "main",
      name: "Główne",
      items: [
        menuItem({ id: "i-1", label_pl: "Analizy", label_en: "Analysis", href: "/analizy" }),
        // Dziecko sprawia, że pozycja jest WYZWALACZEM panelu - a więc tym
        // wariantem, który mierzy kotwicę.
        menuItem({
          id: "i-2",
          parent_id: "i-1",
          label_pl: "Energia",
          label_en: "Energy",
          href: "/analizy/energia",
        }),
      ],
    };
    const html = ssr(<SiteMenu menuKey="main" lang="pl" />, (qc) =>
      qc.setQueryData(["ssr-menu", "main"], menu),
    );
    expect(html).toContain("Analizy");
    // Panel jest zamknięty w SSR i w pierwszym renderze klienta - identycznie.
    expect(html).toContain('aria-expanded="false"');
    // Kotwica panelu jest MIERZONA (`getBoundingClientRect`), a portal wymaga
    // `mounted && open && anchor` - w SSR nie ma żadnego z tych trzech, więc
    // treści panelu w serwerowym HTML-u nie ma wcale.
    expect(html).not.toContain("Energia");
  });

  it("FootnoteTooltips: warstwa dymków nie wnosi do serwerowego HTML-a nic", () => {
    // Komponent kończy się na `return null` (dymek pojawia się dopiero po
    // najechaniu), więc nie ma czego rozjechać przy hydratacji.
    const html = renderToString(
      <FootnoteTooltips
        notes={[{ id: 1, html: "<p>Zrodlo</p>" }]}
        containerRef={{ current: null }}
      />,
    );
    expect(html).toBe("");
  });

  it("MobileBottomBarView: serwerowy HTML jest niegotowy i bez transformu garbu", () => {
    const items = visibleBottomBarItems(MOBILE_BOTTOM_BAR_DEFAULTS);
    const html = renderToString(
      <MobileBottomBarView
        config={MOBILE_BOTTOM_BAR_DEFAULTS}
        items={items}
        activeIndex={activeBottomBarIndex(items, "/")}
        lang="pl"
      />,
    );
    // `ready` przeskakuje na `true` dopiero w klatce po pomiarze - w SSR musi
    // być `false`, inaczej pierwszy render klienta nie zgadzałby się z HTML-em.
    expect(html).toContain('data-ready="false"');
    expect(html).not.toContain("translate3d");
  });
});

// ── ASERCJA ŹRÓDŁOWA: JEDNA DEFINICJA HAKA, ZERO GOŁYCH useLayoutEffect ────
// To jest JEDYNY instrument, który pada po cofnięciu D10-D13 (naprawa nie ma
// obserwowalnego skutku - patrz nagłówek pliku). Bez niej decyzja „na ścieżkach
// SSR używamy wspólnego haka" nie miałaby żadnego dowodu i wróciłaby przy
// pierwszym nowym pomiarze.
describe("D10-D13: efekt layoutowy na ścieżkach SSR idzie przez wspólny hak", () => {
  const SSR_SURFACES = [
    "src/components/header/TrendingTicker.tsx",
    "src/components/menu/SiteMenu.tsx",
    "src/components/Footnotes.tsx",
    "src/components/mobile/bottomBar/MobileBottomBarView.tsx",
  ];

  it.each(SSR_SURFACES)("%s nie woła gołego useLayoutEffect", (file) => {
    const src = readFileSync(resolve(process.cwd(), file), "utf8");
    expect(src).toContain("useIsomorphicLayoutEffect");
    expect(src).not.toMatch(/\buseLayoutEffect\b/);
  });

  it("hak ma jedną definicję i jest to gałąź po `typeof window`", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/lib/react/useIsomorphicLayoutEffect.ts"),
      "utf8",
    );
    expect(src).toContain('typeof window !== "undefined" ? useLayoutEffect : useEffect');
  });
});
