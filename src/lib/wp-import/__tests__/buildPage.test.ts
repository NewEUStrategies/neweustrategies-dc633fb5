import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  EN_BODY_EMPTY_WARNING,
  buildPageFromHtmlPair,
  classifyEnBody,
} from "@/lib/wp-import/buildPage";

/**
 * Z `mirror: false` builder nie dotyka bazy ani storage'u - stub wybucha, gdyby
 * ktoś kiedyś dodał tam zapytanie bez przemyślenia.
 */
const noDbClient = new Proxy(
  {},
  {
    get() {
      throw new Error("buildPageFromHtmlPair nie powinien dotykać Supabase przy mirror=false");
    },
  },
) as unknown as SupabaseClient<Database>;

const pl = {
  title: "<b>Strategia UE</b>",
  contentHtml: "<h2>Wnioski</h2><p>Polska treść wpisu do zaimportowania.</p>",
  excerpt: "<p>Zapowiedź PL</p>",
  cover: null,
};
const en = {
  title: "EU strategy",
  contentHtml: "<h2>Findings</h2><p>English body of the imported page.</p>",
  excerpt: "EN excerpt",
};

const build = (enSource: typeof en | null) =>
  buildPageFromHtmlPair(noDbClient, "tenant-1", "user-1", pl, enSource, false, false);

describe("classifyEnBody", () => {
  it("reports none when the import had no EN counterpart", () => {
    expect(classifyEnBody(false, "")).toBe("none");
    expect(classifyEnBody(false, "<p>ignored</p>")).toBe("none");
  });

  it("reports persisted only when conversion left real content", () => {
    expect(classifyEnBody(true, "<p>body</p>")).toBe("persisted");
    expect(classifyEnBody(true, "   \n ")).toBe("empty");
    expect(classifyEnBody(true, "")).toBe("empty");
  });
});

describe("buildPageFromHtmlPair", () => {
  it("persists the EN body instead of discarding it after conversion", async () => {
    const built = await build(en);
    expect(built.enBody).toBe("persisted");
    expect(built.content_en).toContain("English body of the imported page");
    // Regresja: EN nie może wyciec do treści PL ani odwrotnie.
    expect(built.content_pl).toContain("Polska treść wpisu");
    expect(built.content_pl).not.toContain("English body");
    expect(built.content_en).not.toContain("Polska treść");
  });

  it("converts the EN body even with media mirroring off", async () => {
    // Cała gałąź EN żyła wcześniej wewnątrz `if (mirror)`.
    const built = await build(en);
    expect(built.mediaMirrored).toBe(0);
    expect(built.content_en).not.toBeNull();
  });

  it("keeps titles and excerpts of both languages, tags stripped", async () => {
    const built = await build(en);
    expect(built.title_pl).toBe("Strategia UE");
    expect(built.title_en).toBe("EU strategy");
    expect(built.excerpt_pl).toBe("Zapowiedź PL");
    expect(built.excerpt_en).toBe("EN excerpt");
  });

  it("builds the layout document from the PL source", async () => {
    const built = await build(en);
    expect(built.builderDoc.sections.length).toBeGreaterThan(0);
  });

  it("warns loudly when an EN pair carried no usable body", async () => {
    const built = await build({ ...en, contentHtml: "   " });
    expect(built.enBody).toBe("empty");
    expect(built.content_en).toBeNull();
    expect(built.warnings).toContain(EN_BODY_EMPTY_WARNING);
  });

  it("stays silent about EN when the page had no EN counterpart", async () => {
    const built = await build(null);
    expect(built.enBody).toBe("none");
    expect(built.content_en).toBeNull();
    expect(built.title_en).toBe("");
    expect(built.excerpt_en).toBeNull();
    expect(built.warnings).not.toContain(EN_BODY_EMPTY_WARNING);
  });
});
