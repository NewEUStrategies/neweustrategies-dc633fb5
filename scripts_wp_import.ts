import { parse, HTMLElement } from "node-html-parser";
import { randomUUID } from "crypto";

const SITE = "neweuropeanstrategies.com";
const GATEWAY = "https://connector-gateway.lovable.dev/wordpress_com";
const LKEY = process.env.LOVABLE_API_KEY!;
const WKEY = process.env.WORDPRESS_COM_API_KEY!;
const TENANT = "07167e87-2e0f-42e8-ac5e-72445a2d4b0a";
const BLOG_PAGE = "f6a17dcc-ed23-47be-ab11-08eebd907df6";

const headers = { Authorization: `Bearer ${LKEY}`, "X-Connection-Api-Key": WKEY };

type Widget = { id: string; kind: "widget"; type: string; content: any };
type Column = { id: string; kind: "column"; span: { desktop: number }; children: Widget[] };
type Section = { id: string; kind: "section"; layout: { width: number; contentWidth: string }; children: Column[] };

function widgetHeading(level: number, text: string): Widget {
  const tag = `h${Math.min(Math.max(level, 1), 6)}`;
  const presets: Record<string, string> = { h1: "display", h2: "xl", h3: "lg", h4: "md", h5: "sm", h6: "xs" };
  return { id: randomUUID(), kind: "widget", type: "heading", content: { tag, text_pl: text, text_en: text, variant: "default", sizePreset: presets[tag] || "md" } };
}
function widgetText(html: string): Widget {
  return { id: randomUUID(), kind: "widget", type: "text", content: { html_pl: html, html_en: html } };
}
function widgetImage(src: string, alt: string, caption?: string): Widget {
  return { id: randomUUID(), kind: "widget", type: "image", content: { src, ratio: "16/9", alt_pl: alt, alt_en: alt, variant: "rounded", caption_pl: caption || "", caption_en: caption || "" } };
}
function widgetQuote(html: string): Widget {
  return { id: randomUUID(), kind: "widget", type: "text", content: { html_pl: `<blockquote>${html}</blockquote>`, html_en: `<blockquote>${html}</blockquote>` } };
}

function htmlToWidgets(html: string): Widget[] {
  if (!html?.trim()) return [];
  const root = parse(`<div>${html}</div>`).firstChild as HTMLElement;
  const widgets: Widget[] = [];
  const walk = (el: HTMLElement) => {
    for (const node of el.childNodes) {
      if (node.nodeType !== 1) continue;
      const e = node as HTMLElement;
      const tag = e.tagName?.toLowerCase();
      if (!tag) continue;
      if (/^h[1-6]$/.test(tag)) {
        widgets.push(widgetHeading(parseInt(tag[1]), e.text.trim()));
      } else if (tag === "p") {
        const img = e.querySelector("img");
        if (img && e.text.trim().length < 5) {
          widgets.push(widgetImage(img.getAttribute("src") || "", img.getAttribute("alt") || ""));
        } else if (e.text.trim()) {
          widgets.push(widgetText(e.toString()));
        }
      } else if (tag === "figure") {
        const img = e.querySelector("img");
        const cap = e.querySelector("figcaption")?.text?.trim();
        if (img) widgets.push(widgetImage(img.getAttribute("src") || "", img.getAttribute("alt") || "", cap));
      } else if (tag === "img") {
        widgets.push(widgetImage(e.getAttribute("src") || "", e.getAttribute("alt") || ""));
      } else if (tag === "ul" || tag === "ol") {
        widgets.push(widgetText(e.toString()));
      } else if (tag === "blockquote") {
        widgets.push(widgetQuote(e.innerHTML));
      } else if (tag === "div" || tag === "section" || tag === "article") {
        walk(e);
      } else {
        if (e.text.trim()) widgets.push(widgetText(e.toString()));
      }
    }
  };
  walk(root);
  return widgets;
}

function buildDocument(html: string, title: string, cover?: string): any {
  const widgets = htmlToWidgets(html);
  if (title?.trim()) widgets.unshift(widgetHeading(1, title));
  if (cover) widgets.splice(1, 0, widgetImage(cover, title || ""));
  if (widgets.length === 0) widgets.push(widgetText("<p></p>"));
  const section: Section = {
    id: randomUUID(),
    kind: "section",
    layout: { width: 1200, contentWidth: "boxed" },
    children: [{ id: randomUUID(), kind: "column", span: { desktop: 12 }, children: widgets }],
  };
  return { version: 1, sections: [section] };
}

async function fetchAll(type: "post" | "page"): Promise<any[]> {
  const out: any[] = [];
  let pageToken: string | null = null;
  const fields = "ID,date,title,slug,status,content,excerpt,featured_image,type";
  while (true) {
    const url = new URL(`${GATEWAY}/rest/v1.1/sites/${SITE}/posts`);
    url.searchParams.set("type", type);
    url.searchParams.set("number", "100");
    url.searchParams.set("fields", fields);
    url.searchParams.set("status", "publish,draft,private");
    if (pageToken) url.searchParams.set("page_handle", pageToken);
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`${type} fetch failed: ${r.status} ${await r.text()}`);
    const j: any = await r.json();
    out.push(...(j.posts || []));
    const next = j.meta?.next_page;
    if (!next || (j.posts || []).length === 0) break;
    pageToken = next;
  }
  return out;
}

function sqlEscape(s: string) { return s.replace(/'/g, "''"); }

async function main() {
  console.log("Fetching pages...");
  const pages = await fetchAll("page");
  console.log("Fetching posts...");
  const posts = await fetchAll("post");
  console.log(`Got ${pages.length} pages, ${posts.length} posts`);

  const stmts: string[] = [];
  let pNew = 0, pUpd = 0, pSkip = 0;
  for (const p of pages) {
    const slug = (p.slug || `wp-${p.ID}`).slice(0, 200);
    const title = p.title || "";
    const doc = buildDocument(p.content || "", title, p.featured_image || undefined);
    const docJson = sqlEscape(JSON.stringify(doc));
    const titleE = sqlEscape(title);
    const cover = p.featured_image ? `'${sqlEscape(p.featured_image)}'` : "NULL";
    const status = p.status === "publish" ? "published" : "draft";
    const pubAt = p.date ? `'${p.date}'::timestamptz` : "NULL";
    // Try update existing row with NULL builder_data, else insert new
    stmts.push(`
WITH upd AS (
  UPDATE pages SET builder_data='${docJson}'::jsonb, title_pl='${titleE}', title_en='${titleE}', cover_image_url=COALESCE(cover_image_url, ${cover}), updated_at=now()
  WHERE tenant_id='${TENANT}' AND slug='${sqlEscape(slug)}' AND builder_data IS NULL
  RETURNING 'updated' AS k
), ins AS (
  INSERT INTO pages (tenant_id, slug, title_pl, title_en, status, builder_data, cover_image_url, published_at, editor, menu_order)
  SELECT '${TENANT}','${sqlEscape(slug)}','${titleE}','${titleE}','${status}'::post_status,'${docJson}'::jsonb, ${cover}, ${pubAt}, 'builder'::editor_type, 0
  WHERE NOT EXISTS (SELECT 1 FROM pages WHERE tenant_id='${TENANT}' AND slug='${sqlEscape(slug)}')
  RETURNING 'inserted' AS k
)
SELECT (SELECT k FROM upd) AS updated, (SELECT k FROM ins) AS inserted;`);
  }

  for (const p of posts) {
    const slug = (p.slug || `wp-${p.ID}`).slice(0, 200);
    const title = p.title || "";
    const excerpt = (p.excerpt || "").replace(/<[^>]+>/g, "").trim().slice(0, 500);
    const doc = buildDocument(p.content || "", title, p.featured_image || undefined);
    const docJson = sqlEscape(JSON.stringify(doc));
    const titleE = sqlEscape(title);
    const excE = sqlEscape(excerpt);
    const cover = p.featured_image ? `'${sqlEscape(p.featured_image)}'` : "NULL";
    const status = p.status === "publish" ? "published" : "draft";
    const pubAt = p.date ? `'${p.date}'::timestamptz` : "NULL";
    stmts.push(`
WITH upd AS (
  UPDATE posts SET builder_data='${docJson}'::jsonb, title_pl='${titleE}', title_en='${titleE}', excerpt_pl='${excE}', excerpt_en='${excE}', cover_image_url=COALESCE(cover_image_url, ${cover}), updated_at=now()
  WHERE tenant_id='${TENANT}' AND slug='${sqlEscape(slug)}' AND builder_data IS NULL
  RETURNING 'updated' AS k
), ins AS (
  INSERT INTO posts (tenant_id, slug, title_pl, title_en, excerpt_pl, excerpt_en, status, builder_data, cover_image_url, published_at, editor, parent_page_id, post_format)
  SELECT '${TENANT}','${sqlEscape(slug)}','${titleE}','${titleE}','${excE}','${excE}','${status}'::post_status,'${docJson}'::jsonb, ${cover}, ${pubAt}, 'builder'::editor_type, '${BLOG_PAGE}', 'standard'
  WHERE NOT EXISTS (SELECT 1 FROM posts WHERE tenant_id='${TENANT}' AND slug='${sqlEscape(slug)}')
  RETURNING 'inserted' AS k
)
SELECT (SELECT k FROM upd) AS updated, (SELECT k FROM ins) AS inserted;`);
  }

  require("fs").writeFileSync("/tmp/wp_import.sql", stmts.join("\n"));
  console.log(`Wrote /tmp/wp_import.sql with ${stmts.length} statements`);
}

main().catch(e => { console.error(e); process.exit(1); });
