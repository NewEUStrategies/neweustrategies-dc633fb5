// WXR (WordPress eXtended RSS) parser - działa w przeglądarce (DOMParser).
// Zwraca strony (post_type=page) z content:encoded, meta (w tym _elementor_data),
// featured_image_url oraz attachmentami dla dopasowywania okładek.
//
// Ograniczenia:
// - Parser działa wyłącznie w środowisku z DOMParser (klient / test z jsdom).
// - Nie parsujemy komentarzy, revisions ani non-page post types.

export type WxrPageStatus = "publish" | "draft" | "private" | "pending" | "future" | "trash";

export interface WxrPage {
  wpId: number;
  slug: string;
  title: string;
  status: WxrPageStatus;
  contentHtml: string;
  excerptHtml: string;
  featuredImageUrl: string | null;
  elementorData: string | null; // surowy JSON string z _elementor_data (może być null)
  language: string | null; // z WPML/Polylang meta jeśli obecne
  translationOfWpId: number | null;
  parentWpId: number | null;
  menuOrder: number;
  modified: string;
  originalUrl: string;
}

export interface WxrParseResult {
  pages: WxrPage[];
  attachmentsById: Map<number, string>; // wp_id attachmenta -> URL
  siteUrl: string | null;
  warnings: string[];
}

function textOf(el: Element | null | undefined, selector: string): string {
  if (!el) return "";
  const node = el.getElementsByTagName(selector).item(0);
  return (node?.textContent ?? "").trim();
}

function tagText(item: Element, ns: string, local: string): string {
  // XML namespaced access - używamy getElementsByTagNameNS z '*' bo prefiksy różnią się w plikach WXR
  const nodes = item.getElementsByTagNameNS("*", local);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes.item(i);
    if (!n) continue;
    // Filtruj po prefiksie, jeśli podany.
    if (ns && n.prefix && n.prefix !== ns) continue;
    return (n.textContent ?? "").trim();
  }
  // Fallback: nazwa z prefixem literalnie.
  const fallback = item.getElementsByTagName(`${ns}:${local}`).item(0);
  return (fallback?.textContent ?? "").trim();
}

function collectPostmeta(item: Element): Record<string, string> {
  const out: Record<string, string> = {};
  const nodes = item.getElementsByTagNameNS("*", "postmeta");
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes.item(i);
    if (!n) continue;
    const key = tagText(n as Element, "wp", "meta_key");
    const val = tagText(n as Element, "wp", "meta_value");
    if (key) out[key] = val;
  }
  return out;
}

function toNumber(s: string, fallback = 0): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeStatus(raw: string): WxrPageStatus {
  const v = raw.toLowerCase();
  if (
    v === "publish" ||
    v === "draft" ||
    v === "private" ||
    v === "pending" ||
    v === "future" ||
    v === "trash"
  ) {
    return v as WxrPageStatus;
  }
  return "draft";
}

/**
 * Parses a WordPress WXR (RSS-flavored) XML export.
 * Only <item> nodes whose wp:post_type is "page" or "attachment" are considered.
 * Returns pages and a lookup table for attachments (used to resolve featured images).
 */
export function parseWxr(xmlText: string): WxrParseResult {
  if (typeof DOMParser === "undefined") {
    throw new Error("parseWxr wymaga środowiska z DOMParser (klient / test z jsdom).");
  }
  const warnings: string[] = [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const parseError = doc.getElementsByTagName("parsererror").item(0);
  if (parseError) {
    throw new Error(`Nieprawidłowy XML: ${parseError.textContent?.slice(0, 200) ?? "parse error"}`);
  }
  const channel = doc.getElementsByTagName("channel").item(0);
  if (!channel) throw new Error("Plik WXR nie zawiera <channel> - to nie jest eksport WordPress.");

  const siteUrl = textOf(channel, "link") || null;

  const items = channel.getElementsByTagName("item");
  const attachmentsById = new Map<number, string>();
  const rawPages: WxrPage[] = [];
  const featuredIdByWpId = new Map<number, number>();

  for (let i = 0; i < items.length; i++) {
    const item = items.item(i);
    if (!item) continue;
    const postType = tagText(item, "wp", "post_type");
    const wpId = toNumber(tagText(item, "wp", "post_id"), 0);
    if (!wpId) continue;

    if (postType === "attachment") {
      const url = tagText(item, "wp", "attachment_url");
      if (url) attachmentsById.set(wpId, url);
      continue;
    }
    if (postType !== "page") continue;

    const title = textOf(item, "title");
    const slug = tagText(item, "wp", "post_name") || String(wpId);
    const status = normalizeStatus(tagText(item, "wp", "status"));
    const contentHtml = tagText(item, "content", "encoded");
    const excerptHtml = tagText(item, "excerpt", "encoded");
    const modified =
      tagText(item, "wp", "post_modified_gmt") || tagText(item, "wp", "post_date_gmt");
    const parentWpId = toNumber(tagText(item, "wp", "post_parent"), 0) || null;
    const menuOrder = toNumber(tagText(item, "wp", "menu_order"), 0);
    const originalUrl = textOf(item, "link");

    const meta = collectPostmeta(item);
    const elementorData = meta["_elementor_data"] || null;
    const featuredId = toNumber(meta["_thumbnail_id"] ?? "", 0);
    if (featuredId) featuredIdByWpId.set(wpId, featuredId);

    // WPML / Polylang - najczęściej używane klucze.
    const language = meta["_polylang_language"] || meta["wpml_language"] || null;
    const translationOfWpId =
      toNumber(meta["_polylang_translations_ref"] ?? "", 0) ||
      toNumber(meta["_wpml_media_original"] ?? "", 0) ||
      null;

    rawPages.push({
      wpId,
      slug,
      title,
      status,
      contentHtml,
      excerptHtml,
      featuredImageUrl: null,
      elementorData,
      language,
      translationOfWpId,
      parentWpId,
      menuOrder,
      modified,
      originalUrl,
    });
  }

  // Rozwiąż featured images.
  for (const p of rawPages) {
    const fid = featuredIdByWpId.get(p.wpId);
    if (fid) {
      const url = attachmentsById.get(fid);
      if (url) p.featuredImageUrl = url;
    }
  }

  // Pomiń kosz i strony bez treści+bez elementora
  const pages = rawPages.filter((p) => {
    if (p.status === "trash") return false;
    if (!p.contentHtml && !p.elementorData) {
      warnings.push(`Strona #${p.wpId} (${p.slug}) nie ma treści - pomijam.`);
      return false;
    }
    return true;
  });

  return { pages, attachmentsById, siteUrl, warnings };
}

/**
 * Elementor przechowuje strukturę jako JSON w `_elementor_data`. W większości
 * eksportów `content:encoded` zawiera już wyrenderowany HTML (z shortcode'ami
 * Elementor Pro), który nasz `convertHtmlToBuilder` mapuje poprawnie. Ta
 * funkcja to fallback: gdyby content był pusty a Elementor JSON obecny -
 * skleja podstawowe teksty w prostą treść (nigdy nie tracimy wszystkiego).
 */
export function fallbackHtmlFromElementorJson(json: string): string {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return "";
    const parts: string[] = [];
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const n = node as {
        elType?: string;
        widgetType?: string;
        settings?: Record<string, unknown>;
        elements?: unknown[];
      };
      const settings = n.settings ?? {};
      const type = (n.widgetType ?? n.elType ?? "").toString();
      if (type === "heading" && typeof settings.title === "string") {
        const tag = (
          typeof settings.header_size === "string" ? settings.header_size : "h2"
        ).toLowerCase();
        parts.push(`<${tag}>${settings.title}</${tag}>`);
      } else if (type === "text-editor" && typeof settings.editor === "string") {
        parts.push(settings.editor);
      } else if (type === "image") {
        const url = (settings.image as { url?: string } | undefined)?.url;
        if (url) parts.push(`<p><img src="${url}" alt="" /></p>`);
      } else if (type === "button") {
        const text = typeof settings.text === "string" ? settings.text : "";
        const link = (settings.link as { url?: string } | undefined)?.url ?? "#";
        if (text) parts.push(`<p><a href="${link}">${text}</a></p>`);
      }
      if (Array.isArray(n.elements)) for (const c of n.elements) walk(c);
    };
    for (const root of parsed) walk(root);
    return parts.join("\n");
  } catch {
    return "";
  }
}
