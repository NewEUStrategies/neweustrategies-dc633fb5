// Autodiscovery kanału RSS archiwum kategorii - tylko dla archiwum z wpisami.
//
// CO TO DOWODZI. Audyt 2026-10: 18 opublikowanych wpisów z importu WordPressa
// nie ma ani jednego wiersza w `post_categories`, więc WSZYSTKIE archiwa
// kategorii są puste („Brak opublikowanych wpisów.") - a każde ogłaszało
// `<link rel="alternate" type="application/rss+xml">`. Czytnik albo agregator
// subskrybował wtedy kanał, który nie miał i nie będzie miał treści, dopóki
// redakcja nie przypisze kategorii. `head()` ma ogłaszać kanał WYŁĄCZNIE, gdy
// archiwum (całe, nie bieżąca strona) ma wpisy.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Reszty kontraktu `head()` archiwów (kanoniczny
// adres, noindex od strony drugiej, JSON-LD) - `archiveRoutes.test.tsx`.
import { describe, expect, it, vi } from "vitest";

const zadanie = vi.hoisted(() => ({ url: "" }));
vi.mock("@/lib/seo/request", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/seo/request")>()),
  getRequestUrl: () => zadanie.url,
}));

import { Route as CategoryRoute } from "@/routes/category.$slug";
import { Route as TagRoute } from "@/routes/tag.$slug";

type HeadFn = (ctx: Record<string, unknown>) => { links?: Record<string, unknown>[] };

/** `head()` trasy - `unknown` w deklaracji, jak w `archiveRoutes.test.tsx`. */
function headOf(route: unknown): HeadFn {
  return (route as { options: { head: HeadFn } }).options.head;
}

/** `<link>` kanałów RSS z `head()` trasy kategorii. */
function rssLinks(ctx: Record<string, unknown>): Record<string, unknown>[] {
  const links = headOf(CategoryRoute)(ctx).links ?? [];
  return links.filter((link) => link.type === "application/rss+xml");
}

const taxonomy = {
  id: "tax-1",
  slug: "gospodarka",
  name_pl: "Gospodarka",
  name_en: "Economy",
  description_pl: null,
  description_en: null,
};

describe("autodiscovery kanału archiwum kategorii", () => {
  it("archiwum z wpisami ogłasza kanał kategorii", () => {
    zadanie.url = "";
    const links = rssLinks({
      params: { slug: "gospodarka" },
      loaderData: { taxonomy, total: 3, page: 1 },
    });
    expect(links).toHaveLength(1);
    expect(String(links[0].href)).toContain("/category/gospodarka/rss.xml");
  });

  it("PUSTE archiwum nie ogłasza kanału - stan produkcji z audytu 2026-10", () => {
    zadanie.url = "";
    const links = rssLinks({
      params: { slug: "gospodarka" },
      loaderData: { taxonomy, total: 0, page: 1 },
    });
    expect(links).toEqual([]);
  });

  it("liczy się `total` CAŁEGO archiwum - strona za końcem listy nadal ogłasza kanał", () => {
    // `?page=9` przy trzech wpisach to pusta strona, ale kanał kategorii ma
    // treść - jego ogłoszenie nie może zależeć od numeru strony.
    zadanie.url = "";
    const links = rssLinks({
      params: { slug: "gospodarka" },
      loaderData: { taxonomy, total: 3, page: 9, posts: [] },
    });
    expect(links).toHaveLength(1);
  });

  it("render zdegradowany (brak danych) nie obiecuje kanału", () => {
    zadanie.url = "";
    expect(
      rssLinks({
        params: { slug: "gospodarka" },
        loaderData: { taxonomy: null, total: 0, page: 1, degraded: true },
      }),
    ).toEqual([]);
    expect(rssLinks({ params: { slug: "gospodarka" }, loaderData: undefined })).toEqual([]);
  });

  it("na adresie /en ogłaszany kanał ma prefiks językowy", () => {
    zadanie.url = "https://neweuropeanstrategies.com/en/category/gospodarka";
    const links = rssLinks({
      params: { slug: "gospodarka" },
      loaderData: { taxonomy, total: 3, page: 1 },
    });
    expect(String(links[0]?.href)).toContain("/en/category/gospodarka/rss.xml");
  });
});

// Ta sama zasada dla archiwum tagu (`tag.$slug.tsx`) - tagów na produkcji dziś
// nie ma, ale pierwszy pusty tag nie może ogłosić kanału bez treści.
describe("autodiscovery kanału archiwum tagu", () => {
  const tagRss = (ctx: Record<string, unknown>) =>
    (headOf(TagRoute)(ctx).links ?? []).filter((link) => link.type === "application/rss+xml");
  const tag = { id: "tag-1", slug: "nato", name_pl: "NATO", name_en: "NATO" };

  it("tag z wpisami ogłasza swój kanał", () => {
    zadanie.url = "";
    const links = tagRss({
      params: { slug: "nato" },
      loaderData: { taxonomy: tag, total: 2, page: 1 },
    });
    expect(links).toHaveLength(1);
    expect(String(links[0].href)).toContain("/tag/nato/rss.xml");
  });

  it("pusty tag i render zdegradowany nie ogłaszają kanału", () => {
    zadanie.url = "";
    expect(
      tagRss({ params: { slug: "nato" }, loaderData: { taxonomy: tag, total: 0, page: 1 } }),
    ).toEqual([]);
    expect(tagRss({ params: { slug: "nato" }, loaderData: undefined })).toEqual([]);
  });
});
