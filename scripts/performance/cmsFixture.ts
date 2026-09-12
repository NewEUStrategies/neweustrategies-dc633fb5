// Synthetic public documents. Only the external measurement harness imports this
// module; no test routes or backend switches enter the deployed application.
// Owner: Fundacja New European Strategies.
import type { BlocksDoc } from "../../src/lib/blocks/types";
import type { BuilderDocument, WidgetNode } from "../../src/lib/builder/types";
import { fixtureResponse, homeFixture } from "./homeFixture.ts";

export const CMS_ENGINES = ["builder", "blocks"] as const;
export const CMS_FORMS = ["text", "form"] as const;
export const CMS_TITLES = {
  pl: "CMS: analiza współpracy europejskiej",
  en: "CMS: an analysis of European cooperation",
};
const paragraph = {
  pl: "Przykładowa analiza opisuje współpracę europejską, edukację i rozwój lokalny. Czytelnik może przejść do kolejnej sekcji i wrócić do źródeł bez utraty treści.",
  en: "This sample analysis covers European cooperation, education and local development. Readers can navigate to the next section and return to the sources without losing content.",
};
const textHtml = (lang: "pl" | "en", index: number) =>
  `<p>${index + 1}. ${paragraph[lang]} ${paragraph[lang]}</p><p><a href="#cms-end">${lang === "pl" ? "Przejdź do końca" : "Go to the end"}</a></p>`;

function blocks(lang: "pl" | "en", withForm: boolean): BlocksDoc {
  return {
    version: 1,
    blocks: [
      { id: "cms-title", type: "heading", data: { text: CMS_TITLES[lang], level: 2 } },
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `cms-paragraph-${i}`,
        type: "paragraph" as const,
        data: { html: textHtml(lang, i) },
      })),
      ...(withForm
        ? [{ id: "cms-form", type: "contact-form" as const, data: { requireConsent: true } }]
        : []),
      { id: "cms-end", type: "html", data: { html: '<p id="cms-end">CMS END</p>' } },
    ],
  };
}
function builder(withForm: boolean): BuilderDocument {
  const widget = (
    id: string,
    type: WidgetNode["type"],
    content: WidgetNode["content"],
  ): WidgetNode => ({ id, kind: "widget", type, content });
  const children: WidgetNode[][] = [
    [widget("cms-title", "heading", { text_pl: CMS_TITLES.pl, text_en: CMS_TITLES.en, tag: "h2" })],
    ...Array.from({ length: 6 }, (_, i) => [
      widget(`cms-paragraph-${i}`, "text", {
        html_pl: textHtml("pl", i),
        html_en: textHtml("en", i),
      }),
    ]),
    ...(withForm ? [[widget("cms-form", "contact-form", { requireConsent: true })]] : []),
    [
      widget("cms-end", "text", {
        html_pl: '<p id="cms-end">CMS END</p>',
        html_en: '<p id="cms-end">CMS END</p>',
      }),
    ],
  ];
  return {
    version: 1,
    sections: children.map((widgets, i) => ({
      id: `cms-section-${i}`,
      kind: "section",
      layout: { contentWidth: "boxed" },
      children: [
        { id: `cms-column-${i}`, kind: "column", span: { desktop: 12 }, children: widgets },
      ],
    })),
  };
}
export const cmsPages = CMS_ENGINES.flatMap((engine, e) =>
  CMS_FORMS.map((variant, v) => ({
    ...homeFixture.pages[0],
    id: `00000000-0000-4000-8000-00000000010${e * 2 + v}`,
    slug: `cms-${engine}-${variant}`,
    title_pl: `Pomiar CMS ${engine} ${variant}`,
    title_en: `CMS measurement ${engine} ${variant}`,
    editor: engine,
    template_type: "default",
    header_override: null,
    body: {
      content_pl: null,
      content_en: null,
      builder_data: engine === "builder" ? builder(variant === "form") : null,
      blocks_data:
        engine === "blocks"
          ? { pl: blocks("pl", variant === "form"), en: blocks("en", variant === "form") }
          : null,
    },
  })),
);

export async function cmsFixtureResponse(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const name = url.pathname.replace(/^\/rest\/v1\//, "");
  if (request.method === "OPTIONS") return fixtureResponse(request);
  const input: Record<string, unknown> =
    request.method === "POST" ? await request.clone().json() : Object.fromEntries(url.searchParams);
  let data: unknown;
  let handled = true;
  const pageForId = (id: unknown) => cmsPages.find((page) => page.id === id);
  if (name === "rpc/resolve_path") {
    const segments = input._segments;
    const page = cmsPages.find(
      (page) => Array.isArray(segments) && segments.join("/") === page.slug,
    );
    data = page ? [{ page_id: page.id, post_id: null }] : [];
  } else if (
    name === "rpc/get_entity_content" &&
    input._entity_type === "page" &&
    pageForId(input._entity_id)
  ) {
    data = [pageForId(input._entity_id)!.body];
  } else if (name === "rpc/page_breadcrumbs") {
    const page = pageForId(input._page_id);
    if (!page) throw new Error(`Unknown CMS breadcrumbs: ${String(input._page_id)}`);
    data = [
      {
        id: page.id,
        slug: page.slug,
        title_pl: page.title_pl,
        title_en: page.title_en,
        depth: 0,
        full_path: page.slug,
      },
    ];
  } else if (name === "pages" && url.searchParams.has("id")) {
    const page = pageForId(url.searchParams.get("id")?.replace(/^eq\./, ""));
    if (page) {
      if (!["GET", "HEAD"].includes(request.method))
        throw new Error("Fixture rejects database writes");
      const { body: _body, ...metadata } = page;
      data = request.headers.get("accept")?.includes("application/vnd.pgrst.object+json")
        ? metadata
        : [metadata];
    } else handled = false;
  } else handled = false;
  if (!handled) return fixtureResponse(request, { delayMs: 40 });
  await new Promise((resolve) => setTimeout(resolve, 40));
  return new Response(request.method === "HEAD" ? null : JSON.stringify(data), {
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}
