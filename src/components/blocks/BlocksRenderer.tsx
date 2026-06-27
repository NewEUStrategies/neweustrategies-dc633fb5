// Publiczny renderer BlocksDoc. SSR-friendly, czysto prezentacyjny.

import type { Block, BlocksDoc, Json } from "@/lib/blocks/types";
import { safeParseBlocks } from "@/lib/blocks/schema";
import DOMPurify from "isomorphic-dompurify";
import { parseEmbedUrl, isIframeEmbed } from "@/lib/blocks/embed";
import { LiveBlogBlock } from "./LiveBlogBlock";
import { GalleryBlock } from "./GalleryBlock";
import { ReviewBlockView } from "./ReviewBlockView";
import { FaqBlockView } from "./FaqBlockView";
import { TocBlockView } from "./TocBlockView";
import { AffiliateBlockView } from "./AffiliateBlockView";
import { XQuoteShare } from "./XQuoteShare";
import { CompareSlider } from "./CompareSlider";
import { LoginFormView, RegisterFormView, LostPasswordFormView, ResetPasswordFormView } from "./AuthFormBlocks";
import { NewsletterForm } from "@/components/NewsletterForm";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";
import { RenderErrorBoundary } from "@/components/admin/builder/ui/organisms/widget-view/RenderErrorBoundary";
import type { ComponentType } from "react";
import { ThumbsUp, ThumbsDown, Facebook, Twitter, Instagram, Youtube, Linkedin, Github, Mail, Rss, Search as SearchIcon, Music as TikTokIcon } from "lucide-react";
import { LatestPostsView } from "./LatestPostsView";

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
  // Pre-pass: collect footnotes (and the transformed HTML) BEFORE rendering so
  // the footnotes section is known up front and renders on first paint / SSR.
  // Previously the collector was mutated during child render, so the parent read
  // `fn.notes.length` as 0 and the section never appeared.
  const fn: FootnoteCollector = { notes: [] };
  const fnHtml = new Map<string, string>();
  precomputeFootnotes(safe.blocks, fn, fnHtml);
  const L = FN_LABELS[lang] ?? FN_LABELS.pl;
  return (
    <article className="blocks-content prose prose-lg dark:prose-invert max-w-none" lang={lang}>
      {safe.blocks.map((b) => (
        // Per-block isolation, mirroring the builder's per-widget boundary: one
        // malformed block degrades to nothing (prod) / a diagnostic (dev) instead
        // of crashing the whole article via the global boundary.
        <RenderErrorBoundary key={b.id} label={`block:${b.type}:${b.id}`}>
          <BlockView block={b} fnHtml={fnHtml} lang={lang} postId={postId} allBlocks={safe.blocks} />
        </RenderErrorBoundary>
      ))}
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

/**
 * Walk blocks in render order (columns: left then right), transforming the
 * footnote shortcodes in paragraph/html blocks exactly once and collecting the
 * notes. Rendering then becomes a pure lookup by block id, and the footnotes
 * section is known before the first paint. Numbering matches render order.
 */
function precomputeFootnotes(blocks: Block[], fn: FootnoteCollector, out: Map<string, string>): void {
  for (const b of blocks) {
    if (b.type === "paragraph" || b.type === "html") {
      out.set(b.id, replaceFootnotes(sanitize(String(b.data.html ?? "")), fn));
    } else if (b.type === "columns") {
      precomputeFootnotes(readBlocksArray(b.data.left), fn, out);
      precomputeFootnotes(readBlocksArray(b.data.right), fn, out);
    }
  }
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

function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function readObjArray<T>(raw: Json | undefined, map: (o: Record<string, unknown>) => T): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  for (const x of raw) {
    if (x && typeof x === "object" && !Array.isArray(x)) {
      out.push(map(x as Record<string, unknown>));
    }
  }
  return out;
}

function BlockView({ block, fnHtml, lang = "pl", postId, allBlocks }: { block: Block; fnHtml: Map<string, string>; lang?: "pl" | "en"; postId?: string; allBlocks?: Block[] }) {
  const cls = alignClass(block);

  switch (block.type) {
    case "paragraph": {
      const safe = fnHtml.get(block.id) ?? sanitize(String(block.data.html ?? ""));
      return <div className={cls} dangerouslySetInnerHTML={{ __html: safe }} />;
    }
    case "heading": {
      const level = Math.min(Math.max(Number(block.data.level ?? 2), 2), 4);
      const text = String(block.data.text ?? "");
      const explicit = block.data.anchor ? String(block.data.anchor) : "";
      const id = explicit || (text ? slugify(text) : undefined);
      const Tag = `h${level}` as "h2" | "h3" | "h4";
      return <Tag id={id} className={cls}>{text}</Tag>;
    }
    case "image": {
      const url = String(block.data.url ?? "");
      const alt = String(block.data.alt ?? "");
      const cap = String(block.data.caption ?? "");
      const href = String(block.data.href ?? "");
      if (!url) return null;
      const img = <OptimizedImage src={url} alt={alt} className="rounded-lg" responsive sizes="(max-width: 768px) 100vw, 800px" />;
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
      return <GalleryBlock images={images} className={cls} />;
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
        info: "bg-muted border-border text-foreground",
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
          <div className="prose dark:prose-invert max-w-none">{left.map((b) => <BlockView key={b.id} block={b} fnHtml={fnHtml} lang={lang} postId={postId} allBlocks={allBlocks} />)}</div>
          <div className="prose dark:prose-invert max-w-none">{right.map((b) => <BlockView key={b.id} block={b} fnHtml={fnHtml} lang={lang} postId={postId} allBlocks={allBlocks} />)}</div>
        </div>
      );
    }
    case "html": {
      const safe = fnHtml.get(block.id) ?? sanitize(String(block.data.html ?? ""));
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
    case "review": {
      const criteria = readObjArray(block.data.criteria, (o) => ({
        label: String(o.label ?? ""),
        score: Number(o.score ?? 0),
      }));
      return (
        <div className={cls}>
          <ReviewBlockView
            title={String(block.data.title ?? "")}
            summary={String(block.data.summary ?? "")}
            criteria={criteria}
            ctaLabel={String(block.data.ctaLabel ?? "")}
            ctaHref={String(block.data.ctaHref ?? "")}
            scale={Number(block.data.scale ?? 10)}
            lang={lang}
          />
        </div>
      );
    }
    case "proscons": {
      const title = String(block.data.title ?? "");
      const pros = (Array.isArray(block.data.pros) ? block.data.pros : []).map((x) => String(x ?? "")).filter(Boolean);
      const cons = (Array.isArray(block.data.cons) ? block.data.cons : []).map((x) => String(x ?? "")).filter(Boolean);
      const LBL = lang === "pl" ? { pros: "Plusy", cons: "Minusy" } : { pros: "Pros", cons: "Cons" };
      if (!pros.length && !cons.length) return null;
      return (
        <section className={`not-prose my-6 ${cls}`}>
          {title && <h3 className="text-base font-semibold mb-3">{title}</h3>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300 mb-2">
                <ThumbsUp className="w-4 h-4" /> {LBL.pros}
              </div>
              <ul className="m-0 pl-5 list-disc space-y-1 text-sm">
                {pros.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-300 mb-2">
                <ThumbsDown className="w-4 h-4" /> {LBL.cons}
              </div>
              <ul className="m-0 pl-5 list-disc space-y-1 text-sm">
                {cons.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
          </div>
        </section>
      );
    }
    case "spoiler": {
      const summary = String(block.data.summary ?? "");
      const inner = sanitize(String(block.data.html ?? ""));
      const open = Boolean(block.data.defaultOpen);
      if (!inner) return null;
      return (
        <details className={`not-prose my-4 rounded-md border border-border bg-muted/30 ${cls}`} open={open}>
          <summary className="cursor-pointer select-none px-4 py-3 font-medium text-sm hover:bg-accent/50 rounded-t-md">
            {summary || (lang === "pl" ? "Pokaż więcej" : "Show more")}
          </summary>
          <div className="px-4 py-3 border-t border-border text-sm" dangerouslySetInnerHTML={{ __html: inner }} />
        </details>
      );
    }
    case "faq": {
      const items = readObjArray(block.data.items, (o) => ({
        q: String(o.q ?? ""),
        a: String(o.a ?? ""),
      }));
      return (
        <div className={cls}>
          <FaqBlockView items={items} title={String(block.data.title ?? "")} lang={lang} />
        </div>
      );
    }
    case "toc": {
      return (
        <div className={cls}>
          <TocBlockView
            blocks={allBlocks ?? []}
            title={String(block.data.title ?? "")}
            maxLevel={Number(block.data.maxLevel ?? 3)}
            ordered={Boolean(block.data.ordered)}
            sticky={Boolean(block.data.sticky)}
            lang={lang}
          />
        </div>
      );
    }
    case "newsletter": {
      const title = String(block.data.title ?? "");
      const description = String(block.data.description ?? "");
      const variant = (String(block.data.variant ?? "card") === "inline" ? "inline" : "card") as "card" | "inline";
      return (
        <section className={`not-prose my-6 rounded-lg border border-border bg-gradient-to-br from-primary/10 to-transparent p-5 ${cls}`}>
          {title && <h3 className="text-lg font-semibold m-0 mb-1">{title}</h3>}
          {description && <p className="text-sm text-muted-foreground mb-3 m-0">{description}</p>}
          <NewsletterForm lang={lang} source="inline-block" variant={variant} />
        </section>
      );
    }
    case "affiliate": {
      return (
        <div className={cls}>
          <AffiliateBlockView
            title={String(block.data.title ?? "")}
            description={String(block.data.description ?? "")}
            image={String(block.data.image ?? "")}
            price={String(block.data.price ?? "")}
            currency={String(block.data.currency ?? "")}
            store={String(block.data.store ?? "")}
            ctaLabel={String(block.data.ctaLabel ?? "")}
            ctaHref={String(block.data.ctaHref ?? "")}
            rating={Number(block.data.rating ?? 0)}
            sponsored={block.data.sponsored !== false}
            lang={lang}
          />
        </div>
      );
    }
    case "xquote": {
      const text = String(block.data.text ?? "");
      if (!text) return null;
      return (
        <div className={cls}>
          <XQuoteShare
            text={text}
            via={String(block.data.via ?? "")}
            hashtags={String(block.data.hashtags ?? "")}
            lang={lang}
          />
        </div>
      );
    }
    case "compare": {
      const before = String(block.data.before ?? "");
      const after = String(block.data.after ?? "");
      if (!before || !after) return null;
      return (
        <div className={`not-prose my-6 ${cls}`}>
          <CompareSlider
            before={before}
            after={after}
            labelBefore={String(block.data.labelBefore ?? (lang === "pl" ? "Przed" : "Before"))}
            labelAfter={String(block.data.labelAfter ?? (lang === "pl" ? "Po" : "After"))}
          />
        </div>
      );
    }
    case "login-form":
      return <div className={cls}><LoginFormView data={block.data} lang={lang} /></div>;
    case "register-form":
      return <div className={cls}><RegisterFormView data={block.data} lang={lang} /></div>;
    case "lost-password-form":
      return <div className={cls}><LostPasswordFormView data={block.data} lang={lang} /></div>;
    case "reset-password-form":
      return <div className={cls}><ResetPasswordFormView data={block.data} lang={lang} /></div>;
    case "audio": {
      const url = String(block.data.url ?? "");
      const caption = String(block.data.caption ?? "");
      if (!url) return null;
      return (
        <figure className={`not-prose my-4 ${cls}`}>
          <audio src={url} controls preload="metadata" className="w-full" />
          {caption && <figcaption className="text-sm text-muted-foreground text-center italic mt-2">{caption}</figcaption>}
        </figure>
      );
    }
    case "cover": {
      const url = String(block.data.url ?? "");
      const title = String(block.data.title ?? "");
      const overlay = Math.min(100, Math.max(0, Number(block.data.overlay ?? 50)));
      const minHeight = Math.min(800, Math.max(120, Number(block.data.minHeight ?? 360)));
      if (!url) return null;
      return (
        <div
          className={`relative w-full rounded-lg overflow-hidden flex items-center justify-center not-prose my-4 ${cls}`}
          style={{ minHeight, backgroundImage: `url(${url})`, backgroundSize: "cover", backgroundPosition: "center" }}
        >
          <div className="absolute inset-0 bg-black" style={{ opacity: overlay / 100 }} />
          {title && <h2 className="relative z-10 text-white text-3xl md:text-5xl font-semibold text-center px-6">{title}</h2>}
        </div>
      );
    }
    case "file": {
      const url = String(block.data.url ?? "");
      const label = String(block.data.label ?? "") || (lang === "pl" ? "Pobierz plik" : "Download file");
      const showButton = block.data.showButton !== false;
      if (!url) return null;
      const labelDownload = lang === "pl" ? "Pobierz" : "Download";
      return (
        <div className={`not-prose my-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3 ${cls}`}>
          <a href={url} className="text-foreground hover:text-primary font-medium truncate" target="_blank" rel="noopener noreferrer">{label}</a>
          {showButton && (
            <a href={url} download className="shrink-0 inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90">{labelDownload}</a>
          )}
        </div>
      );
    }
    case "media-text": {
      const url = String(block.data.url ?? "");
      const text = String(block.data.text ?? "");
      const isRight = String(block.data.mediaPosition ?? "left") === "right";
      return (
        <div className={`not-prose my-6 grid grid-cols-1 md:grid-cols-2 gap-6 items-center ${isRight ? "md:[&>*:first-child]:order-2" : ""} ${cls}`}>
          <div className="aspect-video rounded-lg overflow-hidden bg-muted">
            {url && <OptimizedImage src={url} alt="" className="w-full h-full object-cover" />}
          </div>
          <div className="prose dark:prose-invert max-w-none whitespace-pre-line">{text}</div>
        </div>
      );
    }
    case "group": {
      const bg = String(block.data.background ?? "");
      const padding = Math.min(120, Math.max(0, Number(block.data.padding ?? 16)));
      const children = readBlocksArray(block.data.children);
      const layout = String(block.data.layout ?? "group");
      const layoutCls =
        layout === "row" ? "flex flex-row flex-wrap gap-4"
        : layout === "stack" ? "flex flex-col gap-4"
        : layout === "grid" ? "grid grid-cols-1 md:grid-cols-2 gap-4"
        : "";
      return (
        <div
          className={`not-prose rounded-lg ${layoutCls} ${cls}`}
          style={{ backgroundColor: bg || undefined, padding }}
        >
          {children.map((c) => <BlockView key={c.id} block={c} fnHtml={fnHtml} lang={lang} postId={postId} allBlocks={allBlocks} />)}
        </div>
      );
    }
    case "spacer": {
      const height = Math.min(400, Math.max(4, Number(block.data.height ?? 40)));
      return <div aria-hidden style={{ height }} />;
    }
    case "page-break":
      // Paginacja po stronie wpisu (jeśli włączona) - tu jako semantyczny marker.
      return <div className="page-break" aria-hidden data-page-break />;
    case "read-more":
      // Granica zajawki - na liście wpisów skraca treść; w pełnym widoku ukryta.
      return <div className="read-more" aria-hidden data-read-more />;
    case "pullquote": {
      const text = String(block.data.text ?? "");
      const cite = String(block.data.cite ?? "");
      if (!text) return null;
      return (
        <blockquote className={`not-prose border-y-4 border-primary py-6 my-6 text-center ${cls}`}>
          <p className="text-2xl md:text-3xl font-serif italic m-0">{text}</p>
          {cite && <cite className="block mt-3 text-sm text-muted-foreground not-italic">— {cite}</cite>}
        </blockquote>
      );
    }
    case "preformatted": {
      const text = String(block.data.text ?? "");
      return <pre className={`whitespace-pre-wrap ${cls}`}>{text}</pre>;
    }
    case "verse": {
      const text = String(block.data.text ?? "");
      return <pre className={`font-serif italic text-lg leading-relaxed whitespace-pre-wrap bg-transparent border-none p-0 ${cls}`}>{text}</pre>;
    }
    case "details": {
      const summary = String(block.data.summary ?? "");
      const body = String(block.data.body ?? "");
      if (!summary && !body) return null;
      return (
        <details className={`not-prose my-4 rounded-md border border-border bg-muted/20 ${cls}`}>
          <summary className="cursor-pointer select-none px-4 py-3 font-medium text-sm hover:bg-accent/40 rounded-t-md">{summary || (lang === "pl" ? "Szczegóły" : "Details")}</summary>
          <div className="px-4 py-3 border-t border-border text-sm whitespace-pre-line">{body}</div>
        </details>
      );
    }
    case "row":
    case "stack":
    case "grid": {
      const bg = String(block.data.background ?? "");
      const padding = Math.min(120, Math.max(0, Number(block.data.padding ?? 0)));
      const children = readBlocksArray(block.data.children);
      const cols = Math.min(6, Math.max(1, Number(block.data.columns ?? 3)));
      const layoutCls =
        block.type === "row" ? "flex flex-row flex-wrap gap-4"
        : block.type === "stack" ? "flex flex-col gap-4"
        : `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-${cols} gap-4`;
      return (
        <div className={`not-prose rounded-lg ${layoutCls} ${cls}`} style={{ backgroundColor: bg || undefined, padding: padding || undefined }}>
          {children.map((c) => <BlockView key={c.id} block={c} fnHtml={fnHtml} lang={lang} postId={postId} allBlocks={allBlocks} />)}
        </div>
      );
    }
    case "buttons": {
      type ButtonItem = { label?: string; href?: string; variant?: string };
      const raw = Array.isArray(block.data.items) ? (block.data.items as unknown as ButtonItem[]) : [];
      const align = String(block.data.align ?? "left");
      const alignCls = align === "center" ? "justify-center" : align === "right" ? "justify-end" : "justify-start";
      if (raw.length === 0) return null;
      return (
        <div className={`not-prose flex flex-wrap gap-2 ${alignCls} ${cls}`}>
          {raw.map((it, i) => {
            const label = String(it.label ?? "");
            const href = String(it.href ?? "#");
            const variant = String(it.variant ?? "default");
            const stl =
              variant === "outline" ? "border border-primary text-primary hover:bg-primary/10"
              : variant === "ghost" ? "text-primary hover:bg-primary/10"
              : "bg-primary text-primary-foreground hover:bg-primary/90";
            if (!label) return null;
            return (
              <a key={i} href={href} className={`inline-flex items-center px-4 py-2 rounded-md text-sm font-medium ${stl}`}>{label}</a>
            );
          })}
        </div>
      );
    }
    case "social-icons": {
      type SocialItem = { platform?: string; url?: string };
      const raw = Array.isArray(block.data.items) ? (block.data.items as unknown as SocialItem[]) : [];
      const size = String(block.data.size ?? "md");
      const align = String(block.data.align ?? "left");
      const alignCls = align === "center" ? "justify-center" : align === "right" ? "justify-end" : "justify-start";
      const sizeCls = size === "sm" ? "h-4 w-4" : size === "lg" ? "h-7 w-7" : "h-5 w-5";
      if (raw.length === 0) return null;
      const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
        facebook: Facebook, x: Twitter, twitter: Twitter, instagram: Instagram,
        youtube: Youtube, linkedin: Linkedin, tiktok: TikTokIcon,
        github: Github, mail: Mail, rss: Rss,
      };
      return (
        <div className={`not-prose flex flex-wrap gap-3 ${alignCls} ${cls}`}>
          {raw.map((it, i) => {
            const Icon = ICON_MAP[String(it.platform ?? "").toLowerCase()] ?? Rss;
            const url = String(it.url ?? "");
            if (!url) return null;
            return (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={String(it.platform ?? "social")}
                className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted hover:bg-primary hover:text-primary-foreground transition-colors"
              >
                <Icon className={sizeCls} />
              </a>
            );
          })}
        </div>
      );
    }
    case "search": {
      const placeholder = String(block.data.placeholder ?? (lang === "pl" ? "Szukaj…" : "Search…"));
      const buttonLabel = String(block.data.buttonLabel ?? (lang === "pl" ? "Szukaj" : "Search"));
      const action = String(block.data.action ?? "/search");
      return (
        <form className={`not-prose flex gap-2 ${cls}`} action={action} method="get" role="search">
          <input
            type="search"
            name="q"
            placeholder={placeholder}
            aria-label={placeholder}
            className="flex-1 h-10 px-3 rounded-md border border-border bg-background text-sm"
          />
          <button type="submit" className="inline-flex items-center gap-1 px-4 h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90">
            <SearchIcon className="h-4 w-4" />
            {buttonLabel}
          </button>
        </form>
      );
    }
    case "latest-posts": {
      const count = Math.max(1, Math.min(50, Number(block.data.count ?? 5)));
      const category = String(block.data.category ?? "");
      const showExcerpt = Boolean(block.data.showExcerpt);
      const showImage = Boolean(block.data.showImage ?? true);
      const layout = String(block.data.layout ?? "list") === "grid" ? "grid" : "list";
      return (
        <div className={cls}>
          <LatestPostsView
            count={count}
            category={category}
            showExcerpt={showExcerpt}
            showImage={showImage}
            layout={layout}
            lang={lang}
          />
        </div>
      );
    }
    default:
      return null;
  }
}
