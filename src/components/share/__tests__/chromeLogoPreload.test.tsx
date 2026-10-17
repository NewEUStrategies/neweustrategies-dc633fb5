// @vitest-environment node
//
// LOGO CHROME'U NA WPISIE: JEDEN AUTO-PRELOAD W `<head>` (realny SSR Fizz).
//
// SKĄD TEN PLIK. React 19 sam wstawia do `<head>` `<link rel="preload"
// as="image">` dla każdego eager `<img>` w powłoce i deduplikuje je kluczem
// zasobu - bez `srcSet` kluczem jest SUROWY `src`. Na wpisie w powłoce stoją
// dwa paski z tym samym logo motywu (SVG, bez `srcSet`): pasek mobilny
// `Header.tsx` (przez `SiteChrome`) i pasek czytania `ReadingHeader.tsx` (przez
// `PostLayoutRenderer`). Pasek mobilny dawał adres względny (`renderedMediaUrl`,
// P3.2a/P4.2), a pasek czytania surowy absolutny - dwa klucze, więc KAŻDY wpis
// miał w `<head>` dwa preloady jednego pliku. Oba paski biorą teraz `src` ze
// wspólnego `headerLogoSrc` (`lib/brand/headerLogo`).
//
// CO TU MA DOWÓD (prawdziwe `Header` i `ReadingHeader`, wspólny cache ustawień,
// `renderToReadableStream` pełnego dokumentu jak w workerze):
//  1. kanoniczny `/media/...svg`: oba `<img>` logo mają TEN SAM względny `src`,
//     a `<head>` ma dokładnie JEDEN preload tego pliku (po rozwiązaniu `href`
//     względem originu kanonicznego - para względny/absolutny też się liczy);
//  2. zdegradowany chrome (bramka danych nagłówka zawiesza, nagłówek dochodzi
//     strumieniem później): preload pasków czytania jest w `<head>`, a
//     dochodzący nagłówek NIE dokłada drugiego `<link>` nigdzie w dokumencie;
//  3. KONTROLA NEGATYWNA: ten sam plik z surowym adresem absolutnym obok
//     nagłówka (stan sprzed poprawki) daje DWA preloady - jedność zależy od
//     identycznego napisu, a nie od szczęścia;
//  4. atom `Logo` (reset hasła - jedyna trasa SSR, gdzie stoi obok nagłówka;
//     AuthPortal na /login renderuje się bez `Header`, rejestracja ma
//     `ssr: false`): kanoniczny adres wychodzi względny, więc przy motywie bez
//     wariantu `mobile` (ten sam plik co pasek mobilny) powłoka ma jeden
//     preload, a nie dwa.
//
// CZEGO NIE DUBLUJE: kolejności łańcucha wariantów (`lib/brand/__tests__/
// headerLogo.test.ts`) ani zachowania paska czytania w przeglądarce
// (`ReadingHeader.test.tsx`). Widgety bez logo (renderer buildera, ticker,
// reklamy, wyszukiwarka, przełączniki) są atrapami - nie renderują żadnego
// `<img>`, więc każdy preload obrazu w dokumencie pochodzi z logo.
import { describe, expect, it, vi } from "vitest";
import { use, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BuilderDocument } from "@/lib/builder/types";

const h = vi.hoisted(() => ({
  /** Obietnica, na której zawiesza się bramka danych chrome'u (`null` = gotowe). */
  chromeGate: null as Promise<void> | null,
}));

vi.mock("react-i18next", async () => {
  const { translateKey } = await import("@/test/i18nStub");
  const i18n = { language: "pl", t: translateKey, on: () => {}, off: () => {} };
  return {
    useTranslation: () => ({ t: translateKey, i18n, ready: true }),
    initReactI18next: { type: "3rdParty", init: () => {} },
    Trans: (props: { children?: unknown }) => props.children ?? null,
  };
});
// Słowniki rejestrowane efektem ubocznym importu - tu nie ma czego rejestrować.
vi.mock("@/lib/i18n-mobile-drawer", () => ({}));
vi.mock("@/lib/i18n-share", () => ({}));
vi.mock("@/lib/i18n/localeRuntime", () => ({ currentLang: () => "pl", setClientLang: () => {} }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useRouterState: <T,>({ select }: { select: (state: unknown) => T }): T =>
    select({ location: { pathname: "/analizy/wpis" }, matches: [] }),
  useRouter: () => ({
    state: { location: { pathname: "/analizy/wpis" } },
    navigate: () => Promise.resolve(),
    preloadRoute: () => Promise.resolve(),
  }),
}));

// Bramka danych chrome'u: przepust albo zawieszenie (tryb zdegradowany).
vi.mock("@/lib/ssr/chromeWarmup", () => ({
  ChromeDataGate: ({ children }: { children: ReactNode }) => {
    if (h.chromeGate) use(h.chromeGate);
    return children;
  },
}));

vi.mock("@/components/builder/organisms/BuilderRenderer", () => ({
  BuilderRenderer: () => <div data-builder-renderer="" />,
}));
vi.mock("@/components/header/TrendingTicker", () => ({ TrendingTicker: () => null }));
vi.mock("@/components/AdSlot", () => ({ AdZone: () => null }));
vi.mock("@/components/AlertBar", () => ({ AlertBar: () => null }));
vi.mock("@/components/atoms/LangReelSwitcher", () => ({ LangReelSwitcher: () => null }));
vi.mock("@/components/builder/organisms/widget-view/SearchButtonWidget", () => ({
  SearchButtonWidget: () => <div className="builder-search-widget" />,
}));
vi.mock("@/components/builder/organisms/widget-view/chromeWidgets", () => ({
  LangSwitcherDropdown: () => null,
}));
vi.mock("@/components/notifications/NotificationsBell", () => ({ NotificationsBell: () => null }));
vi.mock("@/components/atoms/SaveArticleButton", () => ({ SaveArticleButton: () => null }));
vi.mock("@/components/atoms/ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: null, user: null, signOut: () => Promise.resolve() }),
}));
vi.mock("@/lib/profile/useHeaderProfile", () => ({
  useHeaderProfile: () => ({ data: null }),
}));

import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Header } from "@/components/Header";
import { ReadingHeader } from "@/components/share/ReadingHeader";
import { Logo } from "@/components/atoms/Logo";
import { PUBLIC_MEDIA_ORIGIN } from "@/lib/media/publicUrl";

const LOGO_PATH = "/media/theme/logo/nes-horizontal.svg";
/** Adres tak, jak leży w `theme_options.logo` (stemplowany originem marki). */
const CANONICAL_LOGO = `${PUBLIC_MEDIA_ORIGIN}${LOGO_PATH}`;

const HEADER_DOC: BuilderDocument = {
  version: 1,
  sections: [{ id: "hdr-sec-1", kind: "section", children: [] }],
};

type ThemeLogo = { main?: string; mobile?: string };

/**
 * Pełny dokument z serwera: wspólny cache ustawień zasila OBA paski (jak
 * `siteSettingsQueryOptions` zasiany przez loader korzenia), motyw serwera to
 * zawsze jasny. Strumień jest czytany od powłoki, jak w workerze: `onShell`
 * biegnie po pierwszym odczycie, więc granica zawieszona w powłoce dochodzi
 * później jako osobny segment (`<template id="B:...">`). Wynik to cały
 * dokument po zamknięciu strumienia.
 */
async function ssrDocument(
  body: ReactElement,
  logo: ThemeLogo,
  onShell: () => void = () => {},
): Promise<string> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(siteSettingsQueryOptions.queryKey, {
    header: { builder_data: HEADER_DOC },
    general: { site_name: "New European Strategies" },
    theme_options: { logo },
  });
  const stream = await renderToReadableStream(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <html lang="pl">
          <head>
            <meta charSet="utf-8" />
          </head>
          <body>{body}</body>
        </html>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = "";
  let shellRead = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
    if (!shellRead) {
      shellRead = true;
      onShell();
    }
  }
  return html + decoder.decode();
}

/** Wpis jak w `SiteChrome` + `PostLayoutRenderer`: nagłówek, potem pasek czytania. */
const articleChrome = (
  <>
    <Header />
    <main>
      <ReadingHeader title="Rada UE przyjęła mandat negocjacyjny" entityId="post-1" />
    </main>
  </>
);

const headOf = (html: string) => html.slice(0, html.indexOf("</head>"));

const imagePreloads = (html: string) =>
  html.match(/<link(?=[^>]*\srel="preload")(?=[^>]*\sas="image")[^>]*>/g) ?? [];

const attr = (tag: string, name: string) =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]?.replaceAll("&amp;", "&");

/**
 * Preloady TEGO pliku logo: `href` rozwiązany względem originu kanonicznego,
 * więc para względny/absolutny liczy się jako dwa preloady jednego zasobu.
 */
const logoPreloads = (html: string) =>
  imagePreloads(html).filter(
    (link) => new URL(attr(link, "href") ?? "", PUBLIC_MEDIA_ORIGIN).href === CANONICAL_LOGO,
  );

/** `src` każdego `<img>` z tym plikiem logo (w dowolnej formie adresu). */
const logoImgSrcs = (html: string) =>
  (html.match(/<img[^>]*>/g) ?? [])
    .map((tag) => attr(tag, "src") ?? "")
    .filter((src) => src.endsWith(LOGO_PATH));

describe("SSR wpisu: pasek mobilny + pasek czytania = jeden preload logo", () => {
  it("kanoniczny `/media/...svg`: oba `<img>` mają ten sam względny `src`, `<head>` ma jeden preload", async () => {
    const html = await ssrDocument(articleChrome, { mobile: CANONICAL_LOGO });

    // Pasek mobilny nagłówka i lewa kolumna paska czytania - jeden napis.
    expect(logoImgSrcs(html)).toEqual([LOGO_PATH, LOGO_PATH]);
    const inHead = logoPreloads(headOf(html));
    expect(inHead).toHaveLength(1);
    expect(attr(inHead[0] ?? "", "href")).toBe(LOGO_PATH);
    // Poza `<head>` nic nie dochodzi (żaden spóźniony `<link>` w treści).
    expect(logoPreloads(html)).toHaveLength(1);
  });

  it("zdegradowany chrome: nagłówek dochodzi strumieniem później i NIE dokłada drugiego preloadu", async () => {
    let release = () => {};
    h.chromeGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      // Bramka puszcza dopiero po wysłaniu powłoki - w niej jest szkielet
      // nagłówka i pasek czytania z preloadem logo w `<head>`.
      const html = await ssrDocument(articleChrome, { mobile: CANONICAL_LOGO }, () => release());

      // Granica nagłówka naprawdę doszła później (szablon granicy + segment).
      expect(html).toMatch(/<template id="B:/);
      const headerImg = html.indexOf(`<img src="${LOGO_PATH}" alt="New European Strategies"`);
      expect(headerImg).toBeGreaterThan(html.indexOf("</main>"));
      expect(logoImgSrcs(html)).toEqual([LOGO_PATH, LOGO_PATH]);
      expect(logoPreloads(headOf(html))).toHaveLength(1);
      expect(logoPreloads(html)).toHaveLength(1);
    } finally {
      h.chromeGate = null;
    }
  });

  it("KONTROLA NEGATYWNA: surowy adres absolutny obok nagłówka daje DWA preloady", async () => {
    // Dokładnie to, co pasek czytania renderował przed wspólnym helperem.
    const html = await ssrDocument(
      <>
        <Header />
        <main>
          <img src={CANONICAL_LOGO} alt="" loading="eager" decoding="async" />
        </main>
      </>,
      { mobile: CANONICAL_LOGO },
    );

    expect(logoImgSrcs(html)).toEqual([LOGO_PATH, CANONICAL_LOGO]);
    expect(logoPreloads(headOf(html))).toHaveLength(2);
  });
});

describe("SSR: atom `Logo` (reset hasła, z nagłówkiem) w tej samej formie adresu", () => {
  it("motyw bez wariantu `mobile`: `Logo` i pasek mobilny to jeden plik i jeden preload", async () => {
    const html = await ssrDocument(
      <>
        <Header />
        <main>
          <Logo size="lg" withWordmark={false} />
        </main>
      </>,
      { main: CANONICAL_LOGO },
    );

    expect(logoImgSrcs(html)).toEqual([LOGO_PATH, LOGO_PATH]);
    expect(logoPreloads(headOf(html))).toHaveLength(1);
    expect(logoPreloads(html)).toHaveLength(1);
  });
});
