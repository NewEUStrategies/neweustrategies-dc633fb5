// Generates a Table of Contents from heading blocks within the document.
import type { Block } from "@/lib/blocks/types";

interface Props {
  blocks: Block[];
  title?: string;
  maxLevel?: number;
  ordered?: boolean;
  sticky?: boolean;
  lang?: "pl" | "en";
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function TocBlockView({ blocks, title, maxLevel = 3, ordered = false, sticky = false, lang = "pl" }: Props) {
  const L = lang === "pl" ? "Spis treści" : "Table of contents";
  const items = blocks
    .filter((b) => b.type === "heading")
    .map((b) => {
      const level = Number(b.data.level ?? 2);
      const text = String(b.data.text ?? "").trim();
      const anchor = String(b.data.anchor ?? "") || slugify(text);
      return { level, text, anchor };
    })
    .filter((h) => h.text && h.level >= 2 && h.level <= maxLevel);

  if (!items.length) return null;
  const Tag = ordered ? "ol" : "ul";

  return (
    <nav
      aria-label={title || L}
      className={`not-prose my-6 rounded-lg border border-border bg-muted/30 p-4 ${sticky ? "lg:sticky lg:top-24" : ""}`}
    >
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-semibold">{title || L}</p>
      <Tag className={`m-0 pl-5 space-y-1 ${ordered ? "list-decimal" : "list-disc"} text-sm`}>
        {items.map((it, i) => (
          <li key={i} style={{ marginLeft: (it.level - 2) * 12 }}>
            <a href={`#${it.anchor}`} className="text-foreground hover:text-primary no-underline">
              {it.text}
            </a>
          </li>
        ))}
      </Tag>
    </nav>
  );
}
