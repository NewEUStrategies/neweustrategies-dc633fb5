// Publiczny renderer BlocksDoc. SSR-friendly, czysto prezentacyjny.

import type { Block, BlocksDoc } from "@/lib/blocks/types";
import DOMPurify from "isomorphic-dompurify";

interface Props {
  doc: BlocksDoc | null | undefined;
}

export function BlocksRenderer({ doc }: Props) {
  if (!doc?.blocks?.length) return null;
  return (
    <article className="blocks-content prose prose-lg dark:prose-invert max-w-none">
      {doc.blocks.map((b) => <BlockView key={b.id} block={b} />)}
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

function BlockView({ block }: { block: Block }) {
  const cls = alignClass(block);

  switch (block.type) {
    case "paragraph": {
      const html = String(block.data.html ?? "");
      const safe = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
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
        <Tag className={cls}>
          {items.filter(Boolean).map((it, i) => <li key={i}>{it}</li>)}
        </Tag>
      );
    }
    case "quote": {
      const text = String(block.data.text ?? "");
      const cite = String(block.data.cite ?? "");
      return (
        <blockquote className={cls}>
          <p>{text}</p>
          {cite && <cite className="text-sm text-muted-foreground">— {cite}</cite>}
        </blockquote>
      );
    }
    case "html": {
      const html = String(block.data.html ?? "");
      const safe = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
      return <div className={cls} dangerouslySetInnerHTML={{ __html: safe }} />;
    }
    default:
      return null;
  }
}
