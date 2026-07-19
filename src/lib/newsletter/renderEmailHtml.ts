// Renderer EmailDoc -> e-mail-safe HTML (tabele layoutowe + style inline).
//
// Czysta funkcja synchroniczna - identyczny kod renderuje podgląd w edytorze
// (klient) i wysyłkę (serwer), więc "podgląd = to, co dostanie odbiorca".
// Dynamiczne dane (blok post-list) są rozwiązywane WCZEŚNIEJ
// (resolveEmailDocPosts) i wstrzykiwane przez ctx.postsByBlock - dzięki temu
// renderer pozostaje testowalny jednostkowo bez bazy.
//
// Wynik jest treścią wewnętrzną kampanii: pipeline wysyłki
// (renderCampaignHtml w newsletter-campaigns.functions.ts) dokłada wokół niej
// zmienne {{firstName}}/{{email}}, tracking kliknięć/otwarć i stopkę
// "Wypisz się" - te obowiązki celowo NIE są duplikowane tutaj.
import { sanitizeHtml } from "@/lib/sanitize";
import type { EmailBlock, EmailDoc, EmailLang, EmailPostListBlock } from "./emailDoc";

/** Wpis rozwiązany dla bloku post-list (patrz emailDocResolve.ts). */
export interface EmailPostRef {
  id: string;
  title: string;
  excerpt: string;
  /** Absolutny URL wpisu (z originem). */
  href: string;
  coverUrl: string | null;
}

export interface RenderEmailCtx {
  /** Rozwiązane wpisy per id bloku post-list. Brak wpisu = blok pomijany. */
  postsByBlock: Record<string, EmailPostRef[]>;
}

const esc = (v: string): string =>
  v.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

/** Dopuszczamy wyłącznie http(s) w linkach bloków (mailto celowo poza zakresem). */
const safeUrl = (v: string): string | null => {
  const t = v.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  return null;
};

const pick = (v: { pl: string; en: string }, lang: EmailLang): string =>
  (lang === "pl" ? v.pl : v.en).trim();

/** Wiersz-kontener bloku: pełna szerokość, padding pionowy. */
const row = (inner: string, padding = "12px 24px"): string =>
  `<tr><td style="padding:${padding}">${inner}</td></tr>`;

function renderPostList(
  block: EmailPostListBlock,
  lang: EmailLang,
  doc: EmailDoc,
  ctx: RenderEmailCtx,
): string {
  const posts = ctx.postsByBlock[block.id] ?? [];
  if (posts.length === 0) return "";
  const { accent, fg, muted } = doc.style;
  const heading = pick(block.heading, lang);
  const headingHtml = heading
    ? `<h3 style="margin:0 0 12px;font-size:18px;line-height:1.3;color:${esc(fg)}">${esc(heading)}</h3>`
    : "";
  const items = posts
    .map((post) => {
      const title = `<a href="${esc(post.href)}" style="color:${esc(fg)};text-decoration:none;font-weight:bold;font-size:15px;line-height:1.4">${esc(post.title)}</a>`;
      const excerpt =
        block.showExcerpt && post.excerpt
          ? `<p style="margin:4px 0 0;font-size:13px;line-height:1.5;color:${esc(muted)}">${esc(post.excerpt)}</p>`
          : "";
      const more = `<a href="${esc(post.href)}" style="color:${esc(accent)};font-size:13px;text-decoration:underline">${lang === "pl" ? "Czytaj więcej" : "Read more"}</a>`;
      if (block.layout === "cards" && post.coverUrl) {
        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px">
<tr><td><img src="${esc(post.coverUrl)}" alt="" width="552" style="display:block;width:100%;max-width:552px;height:auto;border-radius:6px" /></td></tr>
<tr><td style="padding-top:8px">${title}${excerpt}<p style="margin:6px 0 0">${more}</p></td></tr>
</table>`;
      }
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px">
<tr><td style="border-left:3px solid ${esc(accent)};padding-left:12px">${title}${excerpt}<p style="margin:6px 0 0">${more}</p></td></tr>
</table>`;
    })
    .join("");
  return row(`${headingHtml}${items}`);
}

function renderBlock(
  block: EmailBlock,
  lang: EmailLang,
  doc: EmailDoc,
  ctx: RenderEmailCtx,
): string {
  const { accent, fg, muted } = doc.style;
  switch (block.type) {
    case "heading": {
      const text = pick(block.text, lang);
      if (!text) return "";
      const size = block.level === 1 ? 26 : 20;
      return row(
        `<h${block.level} style="margin:0;font-size:${size}px;line-height:1.25;color:${esc(fg)};text-align:${block.align}">${esc(text)}</h${block.level}>`,
      );
    }
    case "paragraph": {
      const html = pick(block.html, lang);
      if (!html) return "";
      return row(
        `<div style="font-size:14px;line-height:1.6;color:${esc(fg)};text-align:${block.align}">${sanitizeHtml(html)}</div>`,
      );
    }
    case "image": {
      const url = block.url ? safeUrl(block.url) : null;
      if (!url) return "";
      const img = `<img src="${esc(url)}" alt="${esc(block.alt)}" width="552" style="display:block;width:100%;max-width:552px;height:auto;border-radius:6px" />`;
      const href = block.href ? safeUrl(block.href) : null;
      return row(href ? `<a href="${esc(href)}">${img}</a>` : img);
    }
    case "button": {
      const label = pick(block.label, lang);
      const url = safeUrl(block.url);
      if (!label || !url) return "";
      return row(
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${block.align}"><tr><td style="border-radius:6px;background:${esc(accent)}"><a href="${esc(url)}" style="display:inline-block;padding:11px 22px;font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:6px">${esc(label)}</a></td></tr></table>`,
        "16px 24px",
      );
    }
    case "divider":
      return row(`<hr style="border:none;border-top:1px solid #e5e7eb;margin:0" />`, "12px 24px");
    case "spacer":
      return `<tr><td style="height:${block.size}px;line-height:${block.size}px;font-size:0">&nbsp;</td></tr>`;
    case "quote": {
      const text = pick(block.text, lang);
      if (!text) return "";
      const attribution = pick(block.attribution, lang);
      const attrHtml = attribution
        ? `<p style="margin:8px 0 0;font-size:13px;color:${esc(muted)}">— ${esc(attribution)}</p>`
        : "";
      return row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-left:3px solid ${esc(accent)};padding-left:14px"><p style="margin:0;font-size:16px;line-height:1.5;font-style:italic;color:${esc(fg)}">${esc(text)}</p>${attrHtml}</td></tr></table>`,
      );
    }
    case "post-list":
      return renderPostList(block, lang, doc, ctx);
    case "footer-note": {
      const html = pick(block.html, lang);
      if (!html) return "";
      return row(
        `<div style="font-size:12px;line-height:1.5;color:${esc(muted)};text-align:center">${sanitizeHtml(html)}</div>`,
      );
    }
  }
}

/**
 * Renderuje EmailDoc do wewnętrznego HTML kampanii dla wskazanego języka.
 * Zwraca pusty string, gdy dokument nie ma renderowalnej treści w tym języku
 * (pipeline traktuje to jak "missing_content_for_language").
 */
export function renderEmailHtml(doc: EmailDoc, lang: EmailLang, ctx: RenderEmailCtx): string {
  const rows = doc.blocks.map((b) => renderBlock(b, lang, doc, ctx)).filter(Boolean);
  if (rows.length === 0) return "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${esc(doc.style.bg)}"><tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">${rows.join("")}</table></td></tr></table>`;
}
