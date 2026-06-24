// Publiczny renderer BlocksDoc. SSR-friendly, czysto prezentacyjny.

import type { Block, BlocksDoc, Json } from "@/lib/blocks/types";
import { safeParseBlocks } from "@/lib/blocks/schema";
import DOMPurify from "isomorphic-dompurify";
import { parseEmbedUrl, isIframeEmbed } from "@/lib/blocks/embed";
import { LiveBlogBlock } from "./LiveBlogBlock";
import { GalleryBlock } from "./GalleryBlock";

interface Props {
  doc: BlocksDoc | null | undefined;
  lang?: "pl" | "en";
  /** Wymagane do bloków typu `liveblog` (subskrypcja realtime per post). */
  postId?: string;
}

const FN_LABELS = {
  pl: { title: "Przypisy", back: "Wróć do tekstu" },
  en: { title: "Footnotes", back: "Back to text" },
} as const;

/** Globalny stan przypisów: zbiera [fn]...[/fn] w kolejności wystąpienia. */
type FootnoteCollector = { notes: string[] };

/** Escape HTML w treści przypisu używanej w atrybucie title oraz w sekcji końcowej. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Zamienia [fn]treść[/fn] na <sup> z tooltipem; treści dopisuje do kolektora. */
function replaceFootnotes(html: string, fn: FootnoteCollector): string {
  return html.replace(/\[fn\]([\s\S]*?)\[\/fn\]/g, (_m, content: string) => {
    const text = content.trim();
    if (!text) return "";
    fn.notes.push(text);
    const n = fn.notes.length;
    const safeTitle = escapeHtml(text.replace(/<[^>]+>/g, ""));
    return `<sup class="fn-ref"><a href="#fn-${n}" id="fnref-${n}" title="${safeTitle}" class="text-primary no-underline hover:underline">[${n}]</a></sup>`;
  });
}

/** Zamienia treść przypisu z plain/markdown na czysty tekst dla listy końcowej. */
function renderFootnoteHtml(text: string): string {
  return DOMPurify.sanitize(text, { USE_PROFILES: { html: true } });
}

export function BlocksRenderer({ doc, lang = "pl", postId }: Props) {
  if (!doc?.blocks?.length) return null;
  const safe = safeParseBlocks(doc);
  if (!safe.blocks.length) return null;
  const fn: FootnoteCollector = { notes: [] };
  const L = FN_LABELS[lang] ?? FN_LABELS.pl;
  return (
    <article className="blocks-content prose prose-lg dark:prose-invert max-w-none" lang={lang}>
      {safe.blocks.map((b) => <BlockView key={b.id} block={b} fn={fn} lang={lang} postId={postId} />)}
      {fn.notes.length > 0 && (
        <section className="footnotes mt-10 pt-6 border-t border-border text-sm" aria-labelledby="footnotes-heading">
          <h2 id="footnotes-heading" data-footnotes-title className="text-base font-semibold mb-3">{L.title}</h2>
          <ol data-footnotes-list className="space-y-2 pl-5 list-decimal">
            {fn.notes.map((n, i) => (
              <li key={i} id={`fn-${i + 1}`}>
                <span dangerouslySetInnerHTML={{ __html: renderFootnoteHtml(n) }} />{" "}
                <a href={`#fnref-${i + 1}`} data-footnote-backlink className="text-muted-foreground hover:text-primary" aria-label={L.back} title={L.back}>↩</a>
              </li>
            ))}
          </ol>
        </section>
      )}
    </article>
  );
}

function alignClass(b: Block): string {
  const a = b.style?.align;
  if (a === "center") return "text-center mx-auto";
  if (a === "right") return "text-right ml-auto";
  if (a === "wide") return "mx-auto w-full max-w-5xl";
  if (a === "full") return "w-full";
  return "";
}

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}

function readBlocksArray(raw: Json | undefined): Block[] {
  if (!Array.isArray(raw)) return [];
  const out: Block[] = [];
  for (const x of raw) {
    if (x && typeof x === "object" && !Array.isArray(x) && "type" in x && "id" in x) {
      out.push(x as unknown as Block);
    }
  }
  return out;
}

function BlockView({ block, fn, lang = "pl", postId }: { block: Block; fn: FootnoteCollector; lang?: "pl" | "en"; postId?: string }) {
  const cls = alignClass(block);

  switch (block.type) {
    case "paragraph": {
      const safe = replaceFootnotes(sanitize(String(block.data.html ?? "")), fn);
      return <div className={cls} dangerouslySetInnerHTML={{ __html: safe }} />;
    }
    case "heading": {
      const level = Math.min(Math.max(Number(block.data.level ?? 2), 2), 4);
      const text = String(block.data.text ?? "");
      const id = block.data.anchor ? String(block.data.anchor) : undefined;
      const Tag = `h${level}` as "h2" | "h3" | "h4";
      return <Tag id={id} className={cls}>{text}</Tag>;
    }
    case "image": {
      const url = String(block.data.url ?? "");
      const alt = String(block.data.alt ?? "");
      const cap = String(block.data.caption ?? "");
      const href = String(block.data.href ?? "");
      if (!url) return null;
      const img = <img src={url} alt={alt} className="rounded-lg" loading="lazy" />;
      const wrapped = href ? <a href={href} target="_blank" rel="noopener noreferrer">{img}</a> : img;
      return (
        <figure className={cls}>
          {wrapped}
          {cap && <figcaption className="text-sm text-muted-foreground text-center italic mt-2">{cap}</figcaption>}
        </figure>
      );
    }
    case "list": {
      const items = Array.isArray(block.data.items) ? (block.data.items as string[]) : [];
      const ordered = Boolean(block.data.ordered);
      const Tag = ordered ? "ol" : "ul";
      return (
        <Tag className={`my-0 pl-6 ${ordered ? "list-decimal" : "list-disc"} marker:text-foreground ${cls}`}>
          {items.filter(Boolean).map((it, i) => <li key={i} className="my-0 pl-1">{it}</li>)}
        </Tag>
      );
    }
    case "quote": {
      const text = String(block.data.text ?? "");
      const cite = String(block.data.cite ?? "");
      return (
        <blockquote className={cls}>
          <p>{text}</p>
          {cite && <cite className="text-sm text-muted-foreground">- {cite}</cite>}
        </blockquote>
      );
    }
    case "code": {
      const code = String(block.data.code ?? "");
      const lang = String(block.data.lang ?? "");
      return (
        <pre className={cls}>
          <code data-lang={lang}>{code}</code>
        </pre>
      );
    }
    case "embed": {
      const url = String(block.data.url ?? "");
      const parsed = parseEmbedUrl(url);
      if (!parsed || !isIframeEmbed(parsed)) {
        return url ? <p className={cls}><a href={url} target="_blank" rel="noopener noreferrer">{url}</a></p> : null;
      }
      return (
        <div className={`relative aspect-video w-full ${cls}`}>
          <iframe
            src={parsed.embedUrl}
            title={parsed.provider}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            loading="lazy"
            className="absolute inset-0 w-full h-full rounded-lg"
          />
        </div>
      );
    }
    case "video": {
      const url = String(block.data.url ?? "");
      const poster = String(block.data.poster ?? "");
      if (!url) return null;
      return <video src={url} poster={poster || undefined} controls preload="metadata" className={`w-full rounded-lg ${cls}`} />;
    }
    case "gallery": {
      const raw = Array.isArray(block.data.images) ? block.data.images : [];
      const images: { url: string; alt: string }[] = [];
      for (const x of raw) {
        if (x && typeof x === "object" && !Array.isArray(x)) {
          const o = x as { [k: string]: unknown };
          const url = String(o.url ?? "");
          if (url) images.push({ url, alt: String(o.alt ?? "") });
        }
      }
      if (images.length === 0) return null;
      return (
        <div className={`grid grid-cols-2 sm:grid-cols-3 gap-3 not-prose ${cls}`}>
          {images.map((img, i) => (
            <img key={i} src={img.url} alt={img.alt} className="w-full h-full object-cover rounded-md aspect-square" loading="lazy" />
          ))}
        </div>
      );
    }
    case "separator": {
      const variant = String(block.data.variant ?? "line");
      if (variant === "dots") return <div className="text-center text-2xl tracking-[0.5em] text-muted-foreground py-3 select-none">···</div>;
      if (variant === "wide") return <hr className="border-0 h-px bg-gradient-to-r from-transparent via-border to-transparent my-6" />;
      return <hr className="border-border my-6" />;
    }
    case "callout": {
      const variant = String(block.data.variant ?? "info");
      const text = String(block.data.text ?? "");
      const map: Record<string, string> = {
        info: "bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-300",
        warning: "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300",
        success: "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300",
        danger: "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300",
      };
      const stl = map[variant] ?? map.info;
      return <div className={`not-prose rounded-md border px-4 py-3 my-4 whitespace-pre-line ${stl} ${cls}`}>{text}</div>;
    }
    case "table": {
      const rowsRaw = Array.isArray(block.data.rows) ? block.data.rows : [];
      const rows: string[][] = rowsRaw.map((r) => Array.isArray(r) ? r.map((c) => String(c ?? "")) : []);
      const header = Boolean(block.data.header);
      if (rows.length === 0) return null;
      const [head, ...body] = header ? [rows[0], ...rows.slice(1)] : [null, ...rows];
      return (
        <div className={`overflow-x-auto ${cls}`}>
          <table>
            {head && <thead><tr>{head.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>}
            <tbody>{body.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    }
    case "button": {
      const label = String(block.data.label ?? "");
      const href = String(block.data.href ?? "#");
      const variant = String(block.data.variant ?? "default");
      const stl =
        variant === "outline" ? "border border-primary text-primary hover:bg-primary/10"
        : variant === "ghost" ? "text-primary hover:bg-primary/10"
        : "bg-primary text-primary-foreground hover:bg-primary/90";
      if (!label) return null;
      return (
        <p className={`not-prose ${cls}`}>
          <a href={href} className={`inline-flex items-center px-4 py-2 rounded-md text-sm font-medium ${stl}`}>{label}</a>
        </p>
      );
    }
    case "columns": {
      const left = readBlocksArray(block.data.left);
      const right = readBlocksArray(block.data.right);
      return (
        <div className={`grid grid-cols-1 md:grid-cols-2 gap-6 not-prose ${cls}`}>
          <div className="prose dark:prose-invert max-w-none">{left.map((b) => <BlockView key={b.id} block={b} fn={fn} lang={lang} postId={postId} />)}</div>
          <div className="prose dark:prose-invert max-w-none">{right.map((b) => <BlockView key={b.id} block={b} fn={fn} lang={lang} postId={postId} />)}</div>
        </div>
      );
    }
    case "html": {
      const safe = replaceFootnotes(sanitize(String(block.data.html ?? "")), fn);
      return <div className={cls} dangerouslySetInnerHTML={{ __html: safe }} />;
    }
    case "liveblog": {
      if (!postId) return null;
      const title = String(block.data.title ?? "");
      const reverseChronological = block.data.reverseChronological !== false;
      const autoRefresh = block.data.autoRefresh !== false;
      return (
        <div className={cls}>
          <LiveBlogBlock
            postId={postId}
            blockId={block.id}
            lang={lang}
            title={title || undefined}
            reverseChronological={reverseChronological}
            autoRefresh={autoRefresh}
          />
        </div>
      );
    }
    default:
      return null;
  }
}
