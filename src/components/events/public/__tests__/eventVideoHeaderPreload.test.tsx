// @vitest-environment node
//
// OKŁADKA PRZEGLĄDU WYDARZENIA: JEDEN PRELOAD W `<head>`, Z WYSOKIM PRIORYTETEM
// (realny SSR Fizz).
//
// SKĄD TEN PLIK. React 19 sam wstawia do `<head>` `<link rel="preload"
// as="image">` dla każdego eager `<img>` w powłoce (poza `loading="lazy"`,
// `fetchPriority="low"`, `<picture>`/`<noscript>`) i deduplikuje je kluczem
// zasobu - bez `srcSet` kluczem jest SUROWY `src`. Trasa `events.$slug.tsx`
// dokładała z `head()` drugi link z tym samym `cover_url`, a TanStack
// `HeadContent` oddaje go Reactowi jako zwykły JSX `<link>`, który idzie do
// `<head>` BEZ deduplikacji - każdy przegląd wydarzenia z okładką miał więc
// w `<head>` dwa preloady jednego pliku (`documentPreloadDuplicates`). `head()`
// już go nie emituje (nagłówek HTTP `Link` z loadera zostaje), więc JEDYNYM
// preloadem w dokumencie jest ten Reactowy - i to on musi nieść
// `fetchpriority=high`, który miał link z `head()`. Stąd `fetchPriority="high"`
// na `<img>` w `EventVideoHeader`.
//
// CO TU MA DOWÓD (prawdziwy `EventVideoHeader`, `renderToReadableStream`
// pełnego dokumentu jak w workerze):
//  1. okładka bez wideo (także przy BŁĘDNYM identyfikatorze wideo - ta sama
//     decyzja `videoEmbedUrl` co w loaderze): `<img>` eager, `fetchpriority=high`,
//     `data-lcp-candidate`, a `<head>` ma DOKŁADNIE JEDEN preload tej okładki,
//     z `fetchpriority=high` i bez `imagesrcset` (parytet z nagłówkiem `Link`);
//  2. nagłówek wideo i pusta okładka: zero `<img>` i zero preloadu obrazu -
//     loader w obu przypadkach też nie wysyła nagłówka `Link`;
//  3. KONTROLA NEGATYWNA: ten sam dokument z linkiem w `<head>` (stan sprzed
//     poprawki - to, co renderował `HeadContent` z `head()`) daje DWA preloady.
//
// CZEGO NIE DUBLUJE: warunków preloadu w loaderze ani nagłówka `Link`
// (`src/routes/__tests__/eventShellLoader.test.ts`) ani parytetu z podglądem studia
// (`src/components/admin/events/__tests__/eventPreviewPublicParity.gate.test.tsx`).
import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";

vi.mock("react-i18next", async () => {
  const { translateKey } = await import("@/test/i18nStub");
  const i18n = { language: "pl", t: translateKey, on: () => {}, off: () => {} };
  return {
    useTranslation: () => ({ t: translateKey, i18n, ready: true }),
    initReactI18next: { type: "3rdParty", init: () => {} },
    Trans: (props: { children?: unknown }) => props.children ?? null,
  };
});
// Słownik rejestrowany efektem ubocznym importu - tu nie ma czego rejestrować.
vi.mock("@/lib/i18n-event-front", () => ({ ensureI18n: () => {} }));

import { EventVideoHeader } from "@/components/events/public/molecules/EventVideoHeader";

const COVER = "https://cdn.nes.eu/storage/v1/object/public/events/szczyt.jpg";

/** Pełny dokument z serwera, czytany do końca strumienia. */
async function ssrDocument(body: ReactElement, headExtra: ReactElement | null = null) {
  const stream = await renderToReadableStream(
    <html lang="pl">
      <head>
        <meta charSet="utf-8" />
        {headExtra}
      </head>
      <body>{body}</body>
    </html>,
  );
  await stream.allReady;
  return new Response(stream).text();
}

const headOf = (html: string) => html.slice(0, html.indexOf("</head>"));

const imagePreloads = (html: string) =>
  html.match(/<link(?=[^>]*\srel="preload")(?=[^>]*\sas="image")[^>]*>/g) ?? [];

const imgTags = (html: string) => html.match(/<img\b[^>]*>/g) ?? [];

/** Wartość atrybutu bez względu na wielkość liter nazwy (`fetchPriority` = `fetchpriority`). */
const attr = (tag: string, name: string) =>
  new RegExp(`\\s${name}="([^"]*)"`, "i").exec(tag)?.[1]?.replaceAll("&amp;", "&");

const hasAttr = (tag: string, name: string) => new RegExp(`\\s${name}(=|\\s|/?>)`, "i").test(tag);

describe("EventVideoHeader w SSR: okładka jest kandydatem LCP z jednym preloadem", () => {
  for (const [label, videoPlatform, videoId] of [
    ["bez nagłówka wideo", null, null],
    ["BŁĘDNY identyfikator wideo wraca do okładki", "youtube", "a b/c"],
  ] as const) {
    it(`${label}: <img> eager + fetchpriority=high, <head> ma JEDEN preload okładki`, async () => {
      const html = await ssrDocument(
        <EventVideoHeader
          title="Szczyt strategiczny"
          coverUrl={COVER}
          videoPlatform={videoPlatform}
          videoId={videoId}
        />,
      );

      const imgs = imgTags(html);
      expect(imgs).toHaveLength(1);
      const img = imgs[0] ?? "";
      expect(attr(img, "src")).toBe(COVER);
      expect(attr(img, "fetchpriority")).toBe("high");
      expect(hasAttr(img, "data-lcp-candidate")).toBe(true);
      // `loading="lazy"` zdejmuje automatyczny preload Reacta - baner nie może go mieć.
      expect(attr(img, "loading")).toBeUndefined();
      // Bez `srcSet`: klucz preloadu to surowy `src`, ten sam co w nagłówku `Link`.
      expect(hasAttr(img, "srcset")).toBe(false);

      const inHead = imagePreloads(headOf(html));
      expect(inHead).toHaveLength(1);
      const link = inHead[0] ?? "";
      expect(attr(link, "href")).toBe(COVER);
      expect(attr(link, "fetchpriority")).toBe("high");
      expect(hasAttr(link, "imagesrcset")).toBe(false);
      // Poza `<head>` nic nie dochodzi.
      expect(imagePreloads(html)).toHaveLength(1);
    });
  }

  it("nagłówek wideo zastępuje okładkę: zero <img> i zero preloadu obrazu", async () => {
    const html = await ssrDocument(
      <EventVideoHeader
        title="Szczyt strategiczny"
        coverUrl={COVER}
        videoPlatform="youtube"
        videoId="abc123"
      />,
    );
    expect(html).toContain("<iframe");
    expect(imgTags(html)).toEqual([]);
    expect(imagePreloads(html)).toEqual([]);
  });

  it("pusta okładka nie rysuje obrazu ani nie zostawia pustego preloadu", async () => {
    const html = await ssrDocument(
      <EventVideoHeader title="Szczyt" coverUrl="   " videoPlatform={null} videoId={null} />,
    );
    expect(imgTags(html)).toEqual([]);
    expect(imagePreloads(html)).toEqual([]);
  });

  it("KONTROLA NEGATYWNA: link z head() obok obrazu daje DWA preloady tego samego pliku", async () => {
    // Dokładnie to renderował `HeadContent` z dawnego `head()` trasy
    // (`imagePreloadLink({ href: cover_url })`). JSX `<link rel="preload">`
    // idzie do `<head>` z pominięciem deduplikacji zasobów obrazów, więc
    // jedność preloadu zależy od tego, że trasa go NIE dokłada.
    const html = await ssrDocument(
      <EventVideoHeader
        title="Szczyt strategiczny"
        coverUrl={COVER}
        videoPlatform={null}
        videoId={null}
      />,
      <link rel="preload" as="image" href={COVER} fetchPriority="high" />,
    );
    const inHead = imagePreloads(headOf(html)).filter((link) => attr(link, "href") === COVER);
    expect(inHead).toHaveLength(2);
  });
});
