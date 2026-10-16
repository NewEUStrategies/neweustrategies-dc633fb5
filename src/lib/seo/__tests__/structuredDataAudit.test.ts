// Audyt JSON-LD (`structuredDataAudit.ts`) na DOKŁADNYCH grafach, które
// produkcja wysłała 2026-10-16, oraz kontrakt źródeł: okruszki powstają
// wyłącznie w `breadcrumbListJsonLd`.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { breadcrumbListJsonLd } from "@/lib/seo/jsonld";
import {
  extractJsonLd,
  findJsonLdNodes,
  structuredDataIssues,
} from "@/lib/seo/structuredDataAudit";

const HOST = "https://neweuropeanstrategies.com";

// Skopiowane z https://neweuropeanstrategies.com/organization/nato (2026-10-16).
// Search Console: „Brakujące pole item (w itemListElement)".
const PROD_ORGANIZATION_CRUMBS = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Start", item: `${HOST}/` },
    { "@type": "ListItem", position: 2, name: "Organizacje", item: `${HOST}/search` },
    { "@type": "ListItem", position: 3, name: "NATO" },
  ],
  "@id": `${HOST}/organization/nato#breadcrumbs`,
};

// Skopiowane z https://neweuropeanstrategies.com/blog (2026-10-16).
const PROD_BLOG_COLLECTION = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name: "Blog - New European Strategies",
  url: `${HOST}/${HOST}/blog`,
  isPartOf: { "@id": `${HOST}/#website` },
  breadcrumb: { "@id": `${HOST}${HOST}/blog#breadcrumbs` },
};

describe("structuredDataIssues - grafy z produkcji", () => {
  it("wskazuje brak `item` na ostatniej pozycji profilu organizacji", () => {
    expect(structuredDataIssues([PROD_ORGANIZATION_CRUMBS])).toEqual([
      {
        path: "$[0].itemListElement[2].item",
        message: "Brakujące pole „item” (w „itemListElement”)",
      },
    ]);
  });

  it("wskazuje adresy z podwójnym originem w CollectionPage archiwum", () => {
    const issues = structuredDataIssues(PROD_BLOG_COLLECTION);
    expect(issues.map((i) => i.path)).toEqual(["$.url", "$.breadcrumb.@id"]);
  });

  it("ten sam profil zbudowany wspólnym builderem jest czysty", () => {
    const fixed = breadcrumbListJsonLd(
      [{ label: "Organizacje", href: "/search" }, { label: "NATO" }],
      HOST,
      "pl",
      `${HOST}/organization/nato`,
    );
    expect(structuredDataIssues([fixed])).toEqual([]);
  });
});

describe("structuredDataIssues - reguły Google dla BreadcrumbList", () => {
  const crumb = (position: number, name: string, item?: unknown) => ({
    "@type": "ListItem",
    position,
    name,
    ...(item === undefined ? {} : { item }),
  });
  const list = (...itemListElement: unknown[]) => ({
    "@type": "BreadcrumbList",
    itemListElement,
  });

  it("brak `item` na POŚREDNIEJ pozycji też jest błędem", () => {
    const issues = structuredDataIssues(
      list(crumb(1, "Start", `${HOST}/`), crumb(2, "Sekcja"), crumb(3, "Wpis", `${HOST}/w`)),
    );
    expect(issues).toEqual([
      { path: "$.itemListElement[1].item", message: "Brakujące pole „item” (w „itemListElement”)" },
    ]);
  });

  it("wymaga co najmniej dwóch pozycji", () => {
    const issues = structuredDataIssues(list(crumb(1, "Start", `${HOST}/`)));
    expect(issues.map((i) => i.path)).toEqual(["$.itemListElement"]);
  });

  it("wymaga numeracji 1..n bez dziur", () => {
    const issues = structuredDataIssues(
      list(crumb(1, "Start", `${HOST}/`), crumb(3, "Wpis", `${HOST}/w`)),
    );
    expect(issues.map((i) => i.path)).toEqual(["$.itemListElement[1].position"]);
  });

  it("wymaga niepustej nazwy, chyba że niesie ją węzeł `item`", () => {
    const issues = structuredDataIssues(
      list(crumb(1, " ", `${HOST}/`), {
        "@type": "ListItem",
        position: 2,
        item: { "@id": `${HOST}/w`, name: "Wpis" },
      }),
    );
    expect(issues.map((i) => i.path)).toEqual(["$.itemListElement[0].name"]);
  });

  it("odrzuca adres względny w `item`", () => {
    const issues = structuredDataIssues(list(crumb(1, "Start", "/"), crumb(2, "Blog", "/blog")));
    expect(issues.map((i) => i.path)).toEqual([
      "$.itemListElement[0].item",
      "$.itemListElement[1].item",
    ]);
  });

  it("brak `itemListElement` to błąd, nie pusta lista", () => {
    expect(structuredDataIssues({ "@type": "BreadcrumbList" })).toEqual([
      { path: "$", message: "Brakujące pole „itemListElement”" },
    ]);
  });

  it("znajduje okruszki zagnieżdżone w @graph i w tablicy typów", () => {
    const graph = {
      "@context": "https://schema.org",
      "@graph": [{ "@type": ["BreadcrumbList"], itemListElement: [crumb(1, "Start")] }],
    };
    expect(findJsonLdNodes(graph, "BreadcrumbList")).toHaveLength(1);
    expect(structuredDataIssues(graph).map((i) => i.path)).toEqual([
      "$.@graph[0].itemListElement",
      "$.@graph[0].itemListElement[0].item",
    ]);
  });

  it("adres z innym adresem w query NIE jest podwójnym originem", () => {
    expect(
      structuredDataIssues({ "@type": "WebPage", url: `${HOST}/share?u=https://x.example/a` }),
    ).toEqual([]);
  });
});

describe("extractJsonLd", () => {
  it("wyjmuje wszystkie bloki i zgłasza blok, który się nie parsuje", () => {
    const html = [
      `<script type="application/ld+json">{"@type":"WebSite"}</script>`,
      `<script async type='application/ld+json' data-x>[{"@type":"Thing"}]</script>`,
      `<script type="application/ld+json">{oops</script>`,
      `<script type="module">{"@type":"Nope"}</script>`,
    ].join("\n");
    const { graphs, issues } = extractJsonLd(html);
    expect(graphs).toEqual([{ "@type": "WebSite" }, [{ "@type": "Thing" }]]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe("script[2]");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// KONTRAKT ŹRÓDEŁ. Oba błędy z 2026-10-16 wzięły się z kodu OBOK buildera:
// ręcznie sklejony graf profilu autora (bez `item`) i doklejanie `@id` do
// gotowego grafu (`{ ...breadcrumbs, "@id": `${origin}${url}#breadcrumbs` }`,
// gdzie `url` w SSR jest absolutny). Obie drogi są tu zamknięte.
// ─────────────────────────────────────────────────────────────────────────────
const SRC = join(process.cwd(), "src");
const BUILDER = "src/lib/seo/jsonld.ts";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("kontrakt: okruszki JSON-LD tylko z `breadcrumbListJsonLd`", () => {
  const files = sourceFiles(SRC).map((full) => ({
    file: relative(process.cwd(), full),
    text: readFileSync(full, "utf8"),
  }));

  it("żaden plik poza builderem nie składa węzła BreadcrumbList ręcznie", () => {
    const handBuilt = files
      .filter(({ file }) => file !== BUILDER)
      .filter(({ text }) => /["']@type["']\s*:\s*["']BreadcrumbList["']/.test(text))
      .map(({ file }) => file);
    expect(
      handBuilt,
      "Użyj breadcrumbListJsonLd z @/lib/seo/jsonld - gwarantuje `item` na każdej pozycji",
    ).toEqual([]);
  });

  it("żadna trasa nie dokleja własnego `@id` do grafu okruszków", () => {
    const reattached = files
      .filter(({ text }) => /\.\.\.\s*breadcrumbs?\w*\s*,\s*["']@id["']/i.test(text))
      .map(({ file }) => file);
    expect(reattached, "Builder nadaje `@id`; odwołuj się do breadcrumbs['@id']").toEqual([]);
  });
});
