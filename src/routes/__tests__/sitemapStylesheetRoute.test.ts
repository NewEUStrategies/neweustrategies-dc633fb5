// Trasa /sitemap.xsl - statyczny arkusz wyglądu map strony.
//
// Kontrakt nagłówków ma tu realną cenę: Chrome z `X-Content-Type-Options:
// nosniff` (ustawiane globalnie) odmawia transformacji, gdy arkusz nie ma
// XML-owego typu treści - mapa wraca wtedy do surowego drzewa. `noindex`,
// bo arkusz nie jest stroną do wyszukania.
import { describe, expect, it } from "vitest";
import { routeServerHandlers } from "@/test/routeHarness";
import {
  SITEMAP_STYLESHEET_CACHE_CONTROL,
  buildSitemapStylesheet,
} from "@/lib/seo/sitemapStylesheetXsl";
import { Route } from "../sitemap[.]xsl";

describe("/sitemap.xsl", () => {
  it("oddaje arkusz z typem XSL, długim cache i noindex", async () => {
    const res = await routeServerHandlers(Route).GET!({});
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/xsl; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe(SITEMAP_STYLESHEET_CACHE_CONTROL);
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(await res.text()).toBe(buildSitemapStylesheet());
  });
});
