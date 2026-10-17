// @vitest-environment node
//
// JEDEN KANDYDAT LCP NA WPISIE: OKŁADKA ALBO TREŚĆ BUILDERA (P1.4) - RENDER SERWEROWY.
//
// SKĄD TEN PLIK. Trasa `/$` jest w `AFTER_LCP_ROUTE_IDS` (src/lib/boot/bootSet.server.ts),
// więc wpis dostaje tryb bootu `lcp`: loader bootu (`bootLoaderScript.ts`) czeka na wpis
// `largest-contentful-paint` obrazu `img[data-lcp-candidate]`. Okładka wpisu nie miała
// znacznika, a dokument buildera w treści oddawał jej własność (`lcpOwner={!coverAboveBody}`),
// więc wpis z okładką nie miał ŻADNEGO kandydata i bootował po pierwszej klatce (`nocand`),
// przed malowaniem okładki. Teraz trasa podaje tę samą decyzję dwóm stronom:
// `PostLayoutRenderer coverLcpCandidate` (znacznik na `<img>` okładki) i `ContentRenderer
// lcpOwner` (kandydat dokumentu buildera) - dokładnie jedna z nich jest prawdą
// (`platformPublicRender.test.tsx` czyta to z prawdziwej trasy).
//
// CO TU MA DOWÓD. Prawdziwe `PostLayoutRenderer` (z `ReadingHeader` i okładką
// `OptimizedImage`) i prawdziwe `ContentRenderer` -> `BuilderRenderer` z obrazem w pierwszej
// sekcji, w gałęzi serwerowej renderera (kandydata buildera liczy wyłącznie serwer -
// `aboveFold.tsx`), z propsami jak w `$.tsx`: `coverAboveBody = rendersCover(preset) && !!okładka`.
// W każdym układzie (z okładką, bez okładki - layout-9 -, `data:`, wpis bez okładki)
// dokument ma DOKŁADNIE JEDEN `img[data-lcp-candidate]`: okładkę, gdy jest malowana, inaczej
// obraz treści. Kontrola negatywna: oba źródła naraz dają dwa znaczniki - asercja nie jest
// pusta. Logo paska czytania jest leniwe i bez znacznika (bramka `imgEagerNonCandidate`).
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import "@/test/i18nReal";

vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

// Gałąź serwerowa renderera buildera (kandydat LCP liczony w SSR) - wzorzec
// `heroCandidateSelection.test.tsx`: `isServer` z produkcyjnego bundla serwera.
vi.mock("@tanstack/router-core/isServer", () => ({ isServer: true }));

// `ReadingHeader` ma `<Link>` routera - zwykła kotwica bez `RouterProvider`.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useRouter: () => null,
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, supabaseAuthStub, ok } = await import("@/test/supabase");
  const from = supabaseFromStub();
  for (const table of ["site_settings", "post_layout_settings", "profiles_public"]) {
    from.setResponse(table, ok([]));
  }
  return {
    supabase: {
      from: from.from,
      auth: {
        ...supabaseAuthStub(null),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      },
      rpc: async () => ok([]),
    },
  };
});

import { PostLayoutRenderer } from "@/components/PostLayoutRenderer";
import { ContentRenderer } from "@/components/content/ContentRenderer";
import {
  column,
  doc,
  section,
  widget,
} from "@/components/builder/organisms/__tests__/builderRendererFixtures";
import {
  STANDARD_LAYOUTS,
  defaultPostLayoutSettings,
  findLayout,
  rendersCover,
  type PostFormat,
} from "@/lib/postLayouts";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { analyzeDocument, parseAttributes } from "../../../scripts/performance/documentWeight";

const TITLE = "Atom w Europie";
const COVER = "https://example.org/okladka.jpg";
const DATA_COVER = "data:image/png;base64,iVBORw0KGgo=";
const BODY_IMAGE = "https://example.org/obraz-tresci.png";
const LOGO = "/media/theme/logo/nes-horizontal.svg";

/** Treść wpisu z edytora buildera: obraz w pierwszej sekcji (kandydat, gdy treść jest właścicielem). */
const BODY = doc([
  section("s-body", [
    column("c-body", [
      widget("w-body-img", "image", { content: { src: BODY_IMAGE, alt_pl: "Obraz treści" } }),
    ]),
  ]),
]);

/** `coverAboveBody` z `$.tsx` (= `showCover` z `PostLayoutRenderer`). */
const paintsCover = (format: PostFormat, layoutId: string, cover: string | null) =>
  rendersCover(findLayout(format, layoutId)) && !!cover;

interface Owners {
  readonly cover: boolean;
  readonly body: boolean;
}

/** Wpis jak gałąź `ResolvedPage` w `$.tsx`: jedna decyzja dla okładki i treści. */
function renderPost(format: PostFormat, layoutId: string, cover: string | null, owners?: Owners) {
  const coverAboveBody = paintsCover(format, layoutId, cover);
  const { cover: coverOwner, body: bodyOwner } = owners ?? {
    cover: coverAboveBody,
    body: !coverAboveBody,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Logo motywu w ustawieniach - pasek czytania renderuje swój `<img>`.
  client.setQueryData(siteSettingsQueryOptions.queryKey, {
    theme_options: { logo: { mobile: LOGO } },
  });
  return renderToString(
    <QueryClientProvider client={client}>
      <PostLayoutRenderer
        format={format}
        layoutId={layoutId}
        settings={defaultPostLayoutSettings()}
        title={TITLE}
        coverImageUrl={cover}
        coverLcpCandidate={coverOwner}
        content={
          <ContentRenderer
            editor="builder"
            builderDoc={BODY}
            blocksDoc={null}
            html=""
            lang="pl"
            lcpOwner={bodyOwner}
          />
        }
      />
    </QueryClientProvider>,
  );
}

const images = (html: string) =>
  [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => parseAttributes(m[0]));
const candidates = (html: string) => images(html).filter((a) => "data-lcp-candidate" in a);

type Case = readonly [format: PostFormat, layoutId: string, cover: string | null];
const CASES: Case[] = [
  ...STANDARD_LAYOUTS.map((preset): Case => ["standard", preset.id, COVER]),
  // `layout-9` spoza zestawu formatu: `findLayout` spada na pierwszy preset (z okładką).
  ["video", "layout-9", COVER],
  ["audio", "audio-4", COVER],
  ["gallery", "gallery-2", COVER],
  ["standard", "layout-1", DATA_COVER],
  ["standard", "layout-4", DATA_COVER],
  ["standard", "layout-1", null],
  ["standard", "layout-9", null],
];

describe("SSR wpisu: dokładnie jeden `img[data-lcp-candidate]`", () => {
  it.each(CASES)("%s/%s, okładka %s", (format, layoutId, cover) => {
    const html = renderPost(format, layoutId, cover);
    const painted = paintsCover(format, layoutId, cover);
    const [candidate, ...extra] = candidates(html);

    expect(extra).toEqual([]);
    expect(candidate).toBeDefined();
    // Kandydat ma priorytet (eager + high) i pusty znacznik, jak obraz widgetu buildera.
    expect(candidate).toMatchObject({
      "data-lcp-candidate": "",
      loading: "eager",
      fetchpriority: "high",
    });
    expect(candidate["alt"]).toBe(painted ? TITLE : "Obraz treści");
    expect(candidate["src"]).toBe(painted ? cover : BODY_IMAGE);

    // Logo paska czytania: leniwe, bez znacznika (pasek startuje ukryty).
    const logo = images(html).filter((a) => a["src"] === LOGO);
    expect(logo).toHaveLength(1);
    expect(logo[0]).toMatchObject({ loading: "lazy", decoding: "async" });

    // Ta sama miara co bramka `check:document-weight`: jeden kandydat, żaden obraz
    // nie-leniwy poza nim (okładka malowana bez znacznika liczyłaby się tutaj).
    const weight = analyzeDocument({ html });
    expect(weight.lcpCandidateCount).toBe(1);
    expect(weight.lcpCandidateMissing).toBe(0);
    expect(weight.imgEagerNonCandidate).toBe(0);
  });

  it("KONTROLA NEGATYWNA: okładka i treść jednocześnie właścicielami = DWA znaczniki", () => {
    const html = renderPost("standard", "layout-1", COVER, { cover: true, body: true });

    expect(candidates(html).map((a) => a["alt"])).toEqual([TITLE, "Obraz treści"]);
  });

  it("KONTROLA NEGATYWNA: okładka malowana, ale treść właścicielem = brak znacznika na okładce", () => {
    // Stan sprzed poprawki: wpis bez znacznika okładki, kandydat w treści poniżej
    // zgięcia, a okładka eager + high bez znacznika (`imgEagerNonCandidate`).
    const html = renderPost("standard", "layout-1", COVER, { cover: false, body: true });

    expect(candidates(html).map((a) => a["alt"])).toEqual(["Obraz treści"]);
    expect(analyzeDocument({ html }).imgEagerNonCandidate).toBe(1);
  });
});
