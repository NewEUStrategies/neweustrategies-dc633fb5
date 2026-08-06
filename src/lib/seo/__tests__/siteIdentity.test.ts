// Redakcyjny tytuł/opis serwisu: nadpisania z panelu admina muszą trafiać do
// <head> i być izolowane per host (multi-tenant SSR w jednym isolate).
import { afterEach, describe, expect, it } from "vitest";
import { rememberBrandDefaults, resetBrandDefaults } from "@/lib/seo/brandDefaults";
import {
  SITE_DEFAULT_DESCRIPTION,
  SITE_DEFAULT_TITLE,
  buildRootHead,
  siteDescription,
  siteTitle,
} from "@/lib/seo/meta";
import {
  DEFAULT_SEO_SETTINGS,
  parseSeoSettings,
  siteDescriptionOverride,
  siteTitleOverride,
} from "@/lib/seo/settings";

afterEach(() => resetBrandDefaults());

const find = (meta: Array<Record<string, string>>, key: string, value: string) =>
  meta.find((m) => m[key] === value);

describe("site identity overrides", () => {
  it("falls back to the brand defaults when nothing is configured", () => {
    expect(siteTitle("pl", "https://a.test")).toBe(SITE_DEFAULT_TITLE.pl);
    expect(siteDescription("en", "https://a.test")).toBe(SITE_DEFAULT_DESCRIPTION.en);
  });

  it("uses the configured title and description in the root head", () => {
    rememberBrandDefaults("https://a.test", {
      title: { pl: "Tytuł A", en: "Title A" },
      description: { pl: "Opis A", en: "Description A" },
    });
    const meta = buildRootHead("pl", "https://a.test");
    expect(find(meta, "title", "Tytuł A")?.title).toBe("Tytuł A");
    expect(find(meta, "name", "description")?.content).toBe("Opis A");
    expect(find(meta, "property", "og:title")?.content).toBe("Tytuł A");
    expect(find(meta, "name", "twitter:description")?.content).toBe("Opis A");
  });

  it("never leaks one host's copy into another host", () => {
    rememberBrandDefaults("https://a.test", {
      title: { pl: "Tytuł A", en: "Title A" },
      description: { pl: "Opis A", en: "Description A" },
    });
    expect(siteTitle("pl", "https://b.test")).toBe(SITE_DEFAULT_TITLE.pl);
  });

  it("treats blank settings values as 'use the brand default'", () => {
    const settings = parseSeoSettings({ ...DEFAULT_SEO_SETTINGS, site_title_pl: "  " });
    expect(siteTitleOverride(settings, "pl")).toBe("");
    expect(siteDescriptionOverride(settings, "en")).toBe("");
  });

  it("reads the configured values from the settings blob", () => {
    const settings = parseSeoSettings({
      site_title_en: "Title EN",
      site_description_en: "Description EN",
    });
    expect(siteTitleOverride(settings, "en")).toBe("Title EN");
    expect(siteDescriptionOverride(settings, "en")).toBe("Description EN");
  });
});
