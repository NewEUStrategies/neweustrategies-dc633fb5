import { describe, expect, it } from "vitest";
import { configuredHomepagePageId, type HomepageCandidatePage } from "@/lib/seo/homepagePage";

const page = (
  id: string,
  slug: string,
  parent_id: string | null = null,
): HomepageCandidatePage => ({
  id,
  slug,
  parent_id,
});

const PAGES = [page("p-main", "main"), page("p-home", "home"), page("p-o-nas", "o-nas")];

describe("configuredHomepagePageId - lustro rozstrzygania strony `/`", () => {
  it("tryb „najnowsze wpisy”: żadna strona nie jest stroną główną", () => {
    expect(configuredHomepagePageId({ homepage_mode: "latest_posts" }, PAGES)).toBeNull();
  });

  it("strona statyczna wskazana slugiem - przypadek produkcji (`main`)", () => {
    expect(
      configuredHomepagePageId({ homepage_mode: "static_page", homepage_page_slug: "main" }, PAGES),
    ).toBe("p-main");
  });

  it("id ma pierwszeństwo przed slugiem", () => {
    expect(
      configuredHomepagePageId(
        { homepage_mode: "static_page", homepage_page_id: "p-o-nas", homepage_page_slug: "main" },
        PAGES,
      ),
    ).toBe("p-o-nas");
  });

  it("id nieopublikowanej strony spada na slug, a ten na `home`", () => {
    expect(
      configuredHomepagePageId(
        { homepage_mode: "static_page", homepage_page_id: "zniknela", homepage_page_slug: "main" },
        PAGES,
      ),
    ).toBe("p-main");
    expect(
      configuredHomepagePageId(
        { homepage_mode: "static_page", homepage_page_id: "zniknela", homepage_page_slug: "brak" },
        PAGES,
      ),
    ).toBe("p-home");
  });

  it("slug wskazuje WYŁĄCZNIE stronę najwyższego poziomu", () => {
    const pages = [page("p-child", "main", "p-parent")];
    expect(
      configuredHomepagePageId({ homepage_mode: "static_page", homepage_page_slug: "main" }, pages),
    ).toBeNull();
  });

  it("bez decyzji w ustawieniach obowiązuje historyczny slug `home`", () => {
    expect(configuredHomepagePageId({}, PAGES)).toBe("p-home");
    expect(configuredHomepagePageId(null, PAGES)).toBe("p-home");
    // Slug bez trybu „strona statyczna" jest ignorowany - jak w zapytaniu `/`.
    expect(configuredHomepagePageId({ homepage_page_slug: "main" }, PAGES)).toBe("p-home");
  });

  it("brak jakiejkolwiek pasującej strony to `null`", () => {
    expect(configuredHomepagePageId({}, [page("p-o-nas", "o-nas")])).toBeNull();
  });

  it("puste i nienapisowe wartości ustawień są pomijane", () => {
    expect(
      configuredHomepagePageId(
        { homepage_mode: "static_page", homepage_page_id: "  ", homepage_page_slug: 42 },
        PAGES,
      ),
    ).toBe("p-home");
  });
});
