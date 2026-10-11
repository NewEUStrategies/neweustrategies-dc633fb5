// Widoczne przyciski RSS na stronach podcastów - kanał w JĘZYKU STRONY.
//
// CO TO DOWODZI. Audyt 2026-10: na `/en/podcasts` i `/en/podcasts/<program>`
// autodiscovery w `<head>` (`feedAlternateLink`) ogłaszało kanał angielski
// (`/en/podcast/rss.xml`), ale przycisk „RSS", który klika CZŁOWIEK, prowadził
// na sztywno do kanału polskiego. Czytelnik EN subskrybował inny język, niż
// widział na stronie, i nie miał jak tego zauważyć. Przycisk ma iść przez
// `localizedPath` - tę samą regułę, co nagłówek.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Lokalizacji kanałów w `head()` i całej reszty
// tras - `podcastsIndexRoute.test.tsx` i `podcastShowRoute.test.tsx`. Strona
// odcinka (`podcast.$slug.tsx`) nie ma przycisku kanału wbudowanego - jej
// „RSS" to adres z ustawień podcastu (`settings.rss_url`), więc nie ma tu
// czego lokalizować.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";

const { TENANT, SHOW_ID, SLUG } = vi.hoisted(() => ({
  TENANT: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  SHOW_ID: "33333333-3333-4333-8333-333333333333",
  SLUG: "europa-o-energii",
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, ok } = await import("@/test/supabase/chain");
  const stub = supabaseFromStub();
  const show = {
    id: SHOW_ID,
    tenant_id: TENANT,
    slug: SLUG,
    title_pl: "Europa o energii",
    title_en: "Europe on energy",
    description_pl: "Cykl o polityce energetycznej Unii.",
    description_en: "A series on the Union's energy policy.",
    cover_image_url: null,
    spotify_url: null,
    apple_url: null,
    youtube_url: null,
    sort_order: 1,
    status: "published",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  // Program po slugu (`maybeSingle`) albo katalog programów (lista).
  stub.setResponse("podcast_shows", (chain) => (chain.has("maybeSingle") ? ok(show) : ok([show])));
  // Bez odcinków: przycisk kanału jest w nagłówku strony, niezależnie od listy.
  stub.setResponse("podcasts", () => ok([]));
  stub.setResponse("podcast_episode_people", () => ok([]));
  return { supabase: { from: stub.from } };
});

vi.mock("@/lib/seo/request", () => ({
  getRequestUrl: () => "",
  getOrigin: () => "https://nes.example.org",
}));
vi.mock("@/lib/http/responseHeaders", () => ({
  appendLinkHeader: () => {},
  setCacheControlHeader: () => {},
  readRouteCacheDirective: () => null,
}));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { setClientLang } from "@/lib/i18n/localeRuntime";
import { renderRoute } from "@/test/routeHarness";
import { Route as PodcastsIndexRoute } from "@/routes/podcasts.index";
import { Route as ShowRoute } from "@/routes/podcasts.$show";

async function switchLanguage(lang: "pl" | "en"): Promise<void> {
  await i18n.changeLanguage(lang);
  setClientLang(lang);
}

/** Adres widocznego przycisku „RSS" (z twardym błędem, gdy go nie ma). */
function rssHref(): string | null {
  return screen.getByRole("link", { name: /RSS/ }).getAttribute("href");
}

beforeEach(async () => {
  await switchLanguage("pl");
});

afterEach(async () => {
  cleanup();
  await switchLanguage("pl");
});

describe("przycisk RSS katalogu /podcasts", () => {
  it("po polsku prowadzi do polskiego kanału sieci", async () => {
    await renderRoute({ route: PodcastsIndexRoute, path: "/podcasts/", initialEntry: "/podcasts" });
    expect(rssHref()).toBe("/podcast/rss.xml");
  });

  it("po angielsku prowadzi do kanału z prefiksem /en - jak autodiscovery w head()", async () => {
    await switchLanguage("en");
    await renderRoute({ route: PodcastsIndexRoute, path: "/podcasts/", initialEntry: "/podcasts" });
    expect(rssHref()).toBe("/en/podcast/rss.xml");
  });
});

describe("przycisk RSS strony programu /podcasts/$show", () => {
  it("po polsku prowadzi do polskiego kanału programu", async () => {
    await renderRoute({
      route: ShowRoute,
      path: "/podcasts/$show",
      initialEntry: `/podcasts/${SLUG}`,
    });
    expect(rssHref()).toBe(`/podcasts/${SLUG}/rss.xml`);
  });

  it("po angielsku prowadzi do angielskiego kanału programu", async () => {
    await switchLanguage("en");
    await renderRoute({
      route: ShowRoute,
      path: "/podcasts/$show",
      initialEntry: `/podcasts/${SLUG}`,
    });
    expect(rssHref()).toBe(`/en/podcasts/${SLUG}/rss.xml`);
  });
});
