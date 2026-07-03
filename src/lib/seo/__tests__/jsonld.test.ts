import { describe, expect, it } from "vitest";
import {
  breadcrumbListJsonLd,
  organizationJsonLd,
  safeJsonLd,
  webSiteJsonLd,
} from "@/lib/seo/jsonld";
import type { BreadcrumbItem } from "@/lib/breadcrumbs";

describe("safeJsonLd", () => {
  it("neutralizes </script> breakout attempts (stored XSS guard)", () => {
    const payload = { name: `</script><script>alert(1)</script>`, reviewBody: "ok" };
    const out = safeJsonLd(payload);
    expect(out).not.toContain("</script>");
    expect(out).not.toContain("<script>");
    expect(out).toContain("\\u003C/script\\u003E");
  });

  it("escapes HTML comment and CDATA openers", () => {
    const out = safeJsonLd({ a: "<!-- --> & <![CDATA[" });
    expect(out).not.toContain("<!--");
    expect(out).not.toContain("&");
    expect(out).not.toContain("<![CDATA[");
  });

  it("round-trips to the identical value via JSON.parse", () => {
    const value = {
      title: `Recenzja </script> "specjalna" & <b>ważna</b>`,
      score: 8.5,
      nested: { tags: ["a&b", "<c>"] },
    };
    expect(JSON.parse(safeJsonLd(value))).toEqual(value);
  });
});

const ORIGIN = "https://nes.example";

describe("organizationJsonLd", () => {
  it("builds a NewsMediaOrganization with sameAs and logo", () => {
    const org = organizationJsonLd({
      origin: ORIGIN,
      lang: "pl",
      sameAs: ["https://x.com/nes", ""],
      logoUrl: `${ORIGIN}/logo.png`,
    });
    expect(org["@type"]).toBe("NewsMediaOrganization");
    expect(org["@id"]).toBe(`${ORIGIN}/#organization`);
    expect(org.sameAs).toEqual(["https://x.com/nes"]);
    expect(org.logo).toEqual({ "@type": "ImageObject", url: `${ORIGIN}/logo.png` });
  });
  it("omits empty sameAs/logo", () => {
    const org = organizationJsonLd({ origin: ORIGIN, lang: "en" });
    expect(org.sameAs).toBeUndefined();
    expect(org.logo).toBeUndefined();
  });
});

describe("webSiteJsonLd", () => {
  it("wires the SearchAction to the localized search route", () => {
    const pl = webSiteJsonLd(ORIGIN, "pl") as {
      potentialAction: { target: { urlTemplate: string } };
    };
    const en = webSiteJsonLd(ORIGIN, "en") as {
      potentialAction: { target: { urlTemplate: string } };
    };
    expect(pl.potentialAction.target.urlTemplate).toBe(`${ORIGIN}/search?q={search_term_string}`);
    expect(en.potentialAction.target.urlTemplate).toBe(
      `${ORIGIN}/en/search?q={search_term_string}`,
    );
  });
});

describe("breadcrumbListJsonLd", () => {
  const items: BreadcrumbItem[] = [{ label: "Blog", href: "/blog" }, { label: "Tytuł wpisu" }];
  it("prepends Home, localizes hrefs and drops the item on the last crumb", () => {
    const ld = breadcrumbListJsonLd(items, ORIGIN, "en") as {
      itemListElement: Array<{ position: number; name: string; item?: string }>;
    };
    expect(ld.itemListElement).toHaveLength(3);
    expect(ld.itemListElement[0]).toEqual({
      "@type": "ListItem",
      position: 1,
      name: "Home",
      item: `${ORIGIN}/en`,
    });
    expect(ld.itemListElement[1]?.item).toBe(`${ORIGIN}/en/blog`);
    expect(ld.itemListElement[2]?.item).toBeUndefined();
  });
  it("uses bare paths for the default language", () => {
    const ld = breadcrumbListJsonLd(items, ORIGIN, "pl") as {
      itemListElement: Array<{ name: string; item?: string }>;
    };
    expect(ld.itemListElement[0]?.name).toBe("Start");
    expect(ld.itemListElement[1]?.item).toBe(`${ORIGIN}/blog`);
  });
});
