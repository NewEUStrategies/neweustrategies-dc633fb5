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

const HEADING_PRESETS: Record<string, string> = { h1: "display", h2: "xl", h3: "lg", h4: "md", h5: "sm", h6: "xs" };

function wHeading(level: number, text: string): Widget {
  const tag = `h${Math.min(Math.max(level, 1), 6)}`;
  return { id: randomUUID(), kind: "widget", type: "heading", content: { tag, text_pl: text, text_en: text, variant: "default", sizePreset: HEADING_PRESETS[tag] || "md" } };
}
function wText(html: string): Widget {
  return { id: randomUUID(), kind: "widget", type: "text", content: { html_pl: html, html_en: html } };
}
function wImage(src: string, alt: string, caption?: string): Widget {
  return { id: randomUUID(), kind: "widget", type: "image", content: { src, ratio: "16/9", alt_pl: alt, alt_en: alt, variant: "rounded", caption_pl: caption || "", caption_en: caption || "" } };
}
function wQuote(html: string): Widget {
  return { id: randomUUID(), kind: "widget", type: "text", content: { html_pl: `<blockquote>${html}</blockquote>`, html_en: `<blockquote>${html}</blockquote>` } };
}

function classes(el: HTMLElement): string {
  return el.getAttribute("class") || "";
}
function hasClass(el: HTMLElement, ...names: string[]): boolean {
  const c = " " + classes(el) + " ";
  return names.some(n => c.includes(" " + n + " "));
}

// Map Elementor "elementor-col-XX" or width-style → 1..12
function elementorColSpan(el: HTMLElement): number {
  const m = classes(el).match(/elementor-col-(\d+)/);
  if (m) return Math.max(1, Math.min(12, Math.round((parseInt(m[1]) / 100) * 12)));
  return 12;
}

// Sanitize an HTML fragment: strip elementor noise classes/ids/data-* and unwrap deep wrappers,
// keep semantic tags (h1-h6, p, ul, ol, li, blockquote, strong, em, a, br, img, figure, figcaption).
const KEEP_TAGS = new Set(["p","h1","h2","h3","h4","h5","h6","ul","ol","li","blockquote","strong","b","em","i","a","br","img","figure","figcaption","span"]);
function sanitizeFragment(html: string): string {
  if (!html?.trim()) return "";
  const root = parse(`<div>${html}</div>`);
  const stripClasses = (el: HTMLElement) => {
    el.removeAttribute("class");
    el.removeAttribute("id");
    el.removeAttribute("style");
    for (const a of Object.keys(el.attributes)) {
      if (a.startsWith("data-") || a.startsWith("aria-") || a === "role") el.removeAttribute(a);
    }
    for (const child of el.childNodes) {
      if (child.nodeType === 1) stripClasses(child as HTMLElement);
    }
  };
  stripClasses(root.firstChild as HTMLElement);
  return (root.firstChild as HTMLElement).innerHTML.trim();
}

function textOf(el: HTMLElement | null | undefined): string {
  return el?.text?.replace(/\s+/g, " ").trim() || "";
}

// Detect & flatten tabs/accordion into heading + content widgets
function expandTabsAccordion(el: HTMLElement, out: Widget[]): boolean {
  // ElementsKit / Bootstrap tabs: ul.nav-tabs + .tab-content > .tab-pane
  const navItems = el.querySelectorAll(".nav-tabs .nav-link, .nav-tabs .elementkit-nav-link, .nav-tabs a");
  const panes = el.querySelectorAll(".tab-pane, .tab-content > div");
  if (navItems.length > 0 && panes.length > 0 && navItems.length <= 12) {
    const n = Math.min(navItems.length, panes.length);
    let pushed = 0;
    for (let i = 0; i < n; i++) {
      const titleEl = navItems[i].querySelector(".elementskit-tab-title, .nav-link-title") || navItems[i];
      const t = textOf(titleEl);
      if (t) { out.push(wHeading(3, t)); pushed++; }
      walkBlock(panes[i], out);
      pushed++;
    }
    if (pushed > 0) return true;
  }
  // Elementor accordion / tabs (native)
  if (hasClass(el, "elementor-accordion", "elementor-tabs", "elementor-toggle")) {
    const titles = el.querySelectorAll(".elementor-tab-title, .elementor-accordion-title, .elementor-toggle-title");
    const contents = el.querySelectorAll(".elementor-tab-content, .elementor-accordion-content, .elementor-toggle-content");
    const n = Math.min(titles.length, contents.length);
    if (n > 0) {
      for (let i = 0; i < n; i++) {
        const t = textOf(titles[i]);
        if (t) out.push(wHeading(3, t));
        walkBlock(contents[i], out);
      }
      return true;
    }
  }
  return false;
}

// Walk a generic block extracting widgets (no column-creation here)
function walkBlock(el: HTMLElement, out: Widget[]) {
  if (!el) return;
  if (expandTabsAccordion(el, out)) return;

  for (const node of el.childNodes) {
    if (node.nodeType !== 1) continue;
    const e = node as HTMLElement;
    const tag = (e.tagName || "").toLowerCase();
    if (!tag) continue;

    // Skip pure decoration / nav / scripts
    if (tag === "script" || tag === "style" || tag === "noscript") continue;
    if (hasClass(e, "elementor-divider", "elementor-spacer", "elementor-icon-list", "nav-tabs", "tab-content")) {
      // tab-content/nav-tabs already consumed by expandTabsAccordion when present; otherwise skip noisy
      if (tag === "ul" && hasClass(e, "nav-tabs")) continue;
      if (hasClass(e, "tab-content")) continue;
    }

    if (expandTabsAccordion(e, out)) continue;

    if (/^h[1-6]$/.test(tag)) {
      const t = textOf(e);
      if (t) out.push(wHeading(parseInt(tag[1]), t));
      continue;
    }
    if (tag === "p") {
      const img = e.querySelector("img");
      if (img && textOf(e).length < 5) {
        out.push(wImage(img.getAttribute("src") || "", img.getAttribute("alt") || ""));
      } else if (textOf(e)) {
        out.push(wText(sanitizeFragment(`<p>${e.innerHTML}</p>`)));
      }
      continue;
    }
    if (tag === "figure") {
      const img = e.querySelector("img");
      const cap = textOf(e.querySelector("figcaption"));
      if (img) out.push(wImage(img.getAttribute("src") || "", img.getAttribute("alt") || "", cap));
      continue;
    }
    if (tag === "img") {
      out.push(wImage(e.getAttribute("src") || "", e.getAttribute("alt") || ""));
      continue;
    }
    if (tag === "ul" || tag === "ol") {
      const clean = sanitizeFragment(e.toString());
      if (clean) out.push(wText(clean));
      continue;
    }
    if (tag === "blockquote") {
      out.push(wQuote(sanitizeFragment(e.innerHTML)));
      continue;
    }
    if (tag === "hr") continue;

    // Elementor heading / text / image widgets
    if (hasClass(e, "elementor-heading-title")) {
      const t = textOf(e);
      if (t) out.push(wHeading(3, t));
      continue;
    }
    if (hasClass(e, "elementor-widget-image", "elementor-image")) {
      const img = e.querySelector("img");
      if (img) out.push(wImage(img.getAttribute("src") || "", img.getAttribute("alt") || ""));
      continue;
    }
    if (hasClass(e, "elementor-widget-text-editor", "elementor-widget-text")) {
      const inner = e.querySelector(".elementor-widget-container") || e;
      walkBlock(inner, out);
      continue;
    }

    // Generic container — recurse
    if (tag === "div" || tag === "section" || tag === "article" || tag === "header" || tag === "footer" || tag === "main" || tag === "aside") {
      walkBlock(e, out);
      continue;
    }
    // Inline-ish fallback: wrap as paragraph
    const t = textOf(e);
    if (t) out.push(wText(sanitizeFragment(`<p>${e.innerHTML}</p>`)));
  }
}

function makeSection(columns: Column[]): Section {
  return { id: randomUUID(), kind: "section", layout: { width: 1200, contentWidth: "boxed" }, children: columns };
}
function makeColumn(span: number, widgets: Widget[]): Column {
  return { id: randomUUID(), kind: "column", span: { desktop: span }, children: widgets };
}

// Parse an Elementor top-section into a builder Section with proper columns
function parseElementorSection(secEl: HTMLElement): Section | null {
  const colEls = secEl.querySelectorAll(":scope .elementor-column");
  // Only consider direct columns of this section's first row
  const directCols: HTMLElement[] = [];
  const row = secEl.querySelector(".elementor-container") || secEl;
  for (const c of row.childNodes) {
    if (c.nodeType !== 1) continue;
    const el = c as HTMLElement;
    if (hasClass(el, "elementor-column")) directCols.push(el);
  }
  const cols = directCols.length > 0 ? directCols : colEls;
  if (cols.length === 0) return null;
  const out: Column[] = [];
  for (const c of cols) {
    const widgets: Widget[] = [];
    walkBlock(c, widgets);
    if (widgets.length === 0) continue;
    out.push(makeColumn(elementorColSpan(c), widgets));
  }
  if (out.length === 0) return null;
  // Normalize spans so they sum reasonably; if not, fallback
  return makeSection(out);
}

function buildDocument(html: string, title: string, cover?: string): any {
  const sections: Section[] = [];
  // Title + cover always first
  const headWidgets: Widget[] = [];
  if (title?.trim()) headWidgets.push(wHeading(1, title));
  if (cover) headWidgets.push(wImage(cover, title || ""));
  if (headWidgets.length) sections.push(makeSection([makeColumn(12, headWidgets)]));

  if (html?.trim()) {
    const root = parse(`<div>${html}</div>`).firstChild as HTMLElement;
    const elSections = root.querySelectorAll(".elementor-section, .elementor-top-section, section.elementor-element");
    // Only consider top-level Elementor sections (not nested)
    const topElSections: HTMLElement[] = [];
    for (const s of elSections) {
      let p = s.parentNode as HTMLElement | null;
      let nested = false;
      while (p && p !== root) {
        if (hasClass(p, "elementor-section", "elementor-top-section")) { nested = true; break; }
        p = p.parentNode as HTMLElement | null;
      }
      if (!nested) topElSections.push(s);
    }
    if (topElSections.length > 0) {
      for (const s of topElSections) {
        const sec = parseElementorSection(s);
        if (sec) sections.push(sec);
      }
    } else {
      const widgets: Widget[] = [];
      walkBlock(root, widgets);
      if (widgets.length) sections.push(makeSection([makeColumn(12, widgets)]));
    }
  }

  if (sections.length === 0) sections.push(makeSection([makeColumn(12, [wText("<p></p>")])]));
  return { version: 1, sections };
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
  console.log("Fetching pages..."); const pages = await fetchAll("page");
  console.log("Fetching posts..."); const posts = await fetchAll("post");
  console.log(`Got ${pages.length} pages, ${posts.length} posts`);

  const stmts: string[] = [];
  for (const p of pages) {
    const slug = (p.slug || `wp-${p.ID}`).slice(0, 200);
    const title = p.title || "";
    const doc = buildDocument(p.content || "", title, p.featured_image || undefined);
    const docJson = sqlEscape(JSON.stringify(doc));
    const titleE = sqlEscape(title);
    const cover = p.featured_image ? `'${sqlEscape(p.featured_image)}'` : "NULL";
    const status = p.status === "publish" ? "published" : "draft";
    const pubAt = p.date ? `'${p.date}'::timestamptz` : "NULL";
    stmts.push(`INSERT INTO pages (tenant_id, slug, title_pl, title_en, status, builder_data, cover_image_url, published_at, editor, menu_order)
SELECT '${TENANT}','${sqlEscape(slug)}','${titleE}','${titleE}','${status}'::post_status,'${docJson}'::jsonb, ${cover}, ${pubAt}, 'builder'::editor_type, 0
WHERE NOT EXISTS (SELECT 1 FROM pages WHERE tenant_id='${TENANT}' AND slug='${sqlEscape(slug)}');`);
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
    stmts.push(`INSERT INTO posts (tenant_id, slug, title_pl, title_en, excerpt_pl, excerpt_en, status, builder_data, cover_image_url, published_at, editor, parent_page_id, post_format)
SELECT '${TENANT}','${sqlEscape(slug)}','${titleE}','${titleE}','${excE}','${excE}','${status}'::post_status,'${docJson}'::jsonb, ${cover}, ${pubAt}, 'builder'::editor_type, '${BLOG_PAGE}', 'standard'
WHERE NOT EXISTS (SELECT 1 FROM posts WHERE tenant_id='${TENANT}' AND slug='${sqlEscape(slug)}');`);
  }

  require("fs").writeFileSync("/tmp/wp_import.sql", stmts.join("\n"));
  console.log(`Wrote /tmp/wp_import.sql with ${stmts.length} statements`);

  // Dry-run stats for inspection
  let onlyTitle = 0, small = 0, rich = 0;
  for (const p of pages) {
    const doc = buildDocument(p.content || "", p.title || "", p.featured_image || undefined);
    const widgets = doc.sections.reduce((a: number, s: any) => a + s.children.reduce((b: number, c: any) => b + c.children.length, 0), 0);
    if (widgets <= 2) onlyTitle++;
    else if (widgets <= 5) small++;
    else rich++;
  }
  console.log(`Pages stats — onlyTitle:${onlyTitle} small:${small} rich:${rich}`);
}

main().catch(e => { console.error(e); process.exit(1); });
