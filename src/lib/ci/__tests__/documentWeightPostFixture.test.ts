// @vitest-environment node
// Środowisko `node`: backend fixture czyta `e2e/fixtures/first-visit.json` przez
// `new URL(..., import.meta.url)`, którego `URL` z happy-dom `fs` nie przyjmuje
// (jak `dehydratedPayload.test.ts`).
//
// WPIS BRAMKI WAGI DOKUMENTU (`scripts/performance/homeFixture.ts`). Pomiar
// `check-document-weight.ts --path /blog/fixture-2` (progi:
// `document-weight-budgets.post.json`) potrzebuje strony wpisu z okładką-kandydatem LCP;
// bez `resolve_path` loader `/$` oddawał render zdegradowany (bez wpisu). Odpowiedzi wpisu działają WYŁĄCZNIE
// w przypadku `NES_PERFORMANCE_CASE=document-weight` - dla każdego innego (specy
// first-visit, backend klienta, ten proces bez zmiennej) fixture rzuca jak dotąd, więc
// `/`, `/blog` i Playwright first-visit widzą ten sam backend co przed zmianą.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DOCUMENT_WEIGHT_POST_PATH,
  fixtureResponse,
  homeFixture,
} from "../../../../scripts/performance/homeFixture.ts";

const BASE = "http://127.0.0.1:4199/rest/v1";
const rpc = (name: string, body: Record<string, unknown>) =>
  fixtureResponse(
    new Request(`${BASE}/rpc/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
const table = (query: string) => fixtureResponse(new Request(`${BASE}/${query}`));
const json = async (res: Promise<Response>) => (await res).json() as Promise<unknown>;
const segments = (path: string) => path.split("/").filter(Boolean);

const post = homeFixture.posts[0];
/** Endpointy dodane dla wpisu - poza przypadkiem bramki muszą rzucać jak przed zmianą. */
const POST_ONLY = [
  () => rpc("resolve_path", { _segments: segments(DOCUMENT_WEIGHT_POST_PATH) }),
  () => rpc("page_breadcrumbs", { _page_id: "00000000-0000-0000-0000-0000000000b1" }),
  () => rpc("get_related_posts_config", {}),
  () => table(`post_authors?select=user_id,sort_order&post_id=eq.${String(post.id)}`),
];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("homeFixture: wpis bramki wagi dokumentu", () => {
  it("stały adres wpisu z okładką: `/blog/fixture-2`, pierwszy wpis fixture", () => {
    expect(DOCUMENT_WEIGHT_POST_PATH).toBe("/blog/fixture-2");
    expect(post).toMatchObject({
      slug: "fixture-2",
      status: "published",
      cover_image_url: "https://fixture.invalid/cover.jpg",
    });
  });

  it("`document-weight`: `resolve_path` rozwiązuje wpis, okruszki i reszta odpowiadają", async () => {
    vi.stubEnv("NES_PERFORMANCE_CASE", "document-weight");
    const [hit] = (await json(
      rpc("resolve_path", { _segments: segments(DOCUMENT_WEIGHT_POST_PATH) }),
    )) as Array<{ page_id: string; post_id: string }>;
    expect(hit).toEqual({ page_id: "00000000-0000-0000-0000-0000000000b1", post_id: post.id });
    // Inny adres `/$` to czyste 404 (pusty wynik), nie degradacja.
    expect(await json(rpc("resolve_path", { _segments: ["blog", "fixture-3"] }))).toEqual([]);
    expect(await json(rpc("page_breadcrumbs", { _page_id: hit.page_id }))).toEqual([
      {
        id: hit.page_id,
        slug: "blog",
        title_pl: "Blog",
        title_en: "Blog",
        depth: 0,
        full_path: "blog",
      },
    ]);
    // Adres kanoniczny wpisu = ścieżka rodzica (`page_full_path`) + slug = mierzona ścieżka.
    expect(
      `${String(await json(rpc("page_full_path", { _page_id: hit.page_id })))}/${String(post.slug)}`,
    ).toBe(DOCUMENT_WEIGHT_POST_PATH);
    expect(await json(rpc("get_related_posts_config", {}))).toEqual([]);
    expect(
      await json(table(`post_authors?select=user_id,sort_order&post_id=eq.${String(post.id)}`)),
    ).toEqual([]);
    // Wiersz wpisu czytany po id (`.maybeSingle()`) - bez nowego wiersza w `posts`.
    const row = await json(
      fixtureResponse(
        new Request(`${BASE}/posts?select=*&id=eq.${String(post.id)}`, {
          headers: { accept: "application/vnd.pgrst.object+json" },
        }),
      ),
    );
    expect(row).toMatchObject({
      id: post.id,
      cover_image_url: "https://fixture.invalid/cover.jpg",
    });
    expect(homeFixture.posts).toHaveLength(8);
  });

  it.each([undefined, "lighthouse-local", "slow-first-fold", "popup-first-render"])(
    "poza `document-weight` (%s) endpointy wpisu rzucają „Unrecorded…” jak przed zmianą",
    async (measurementCase) => {
      if (measurementCase) vi.stubEnv("NES_PERFORMANCE_CASE", measurementCase);
      else vi.stubEnv("NES_PERFORMANCE_CASE", undefined);
      for (const call of POST_ONLY) {
        await expect(call()).rejects.toThrow(/^Unrecorded performance fixture (RPC|table): /);
      }
    },
  );
});
