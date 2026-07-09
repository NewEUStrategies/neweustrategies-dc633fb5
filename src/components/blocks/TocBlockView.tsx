// Generates a Table of Contents from heading blocks within the document.
// Obsługuje trzy warianty kolumnowe (parytet z Foxiz):
// - col-1 → jedna kolumna (default)
// - col-2 → dwie kolumny (grid, płynny podział)
// - half  → połowa szerokości bloku treści
import type { Block } from "@/lib/blocks/types";
import type { TocColumns } from "@/lib/toc/settings";
import { extractHeadingsFromBlocks } from "@/lib/toc/settings";

interface Props {
  blocks: Block[];
  title?: string;
  /** Minimalny poziom nagłówka (1 = H1, 2 = H2, ...). */
  minLevel?: number;
  /** Maksymalny poziom nagłówka. */
  maxLevel?: number;
  ordered?: boolean;
  sticky?: boolean;
  columns?: TocColumns;
  lang?: "pl" | "en";
}

export function TocBlockView({
  blocks,
  title,
  minLevel = 2,
  maxLevel = 3,
  ordered = false,
  sticky = false,
  columns = "col-1",
  lang = "pl",
}: Props) {
  const L = lang === "pl" ? "Spis treści" : "Table of contents";
  const items = extractHeadingsFromBlocks({ version: 1, blocks }).filter(
    (h) => h.level >= minLevel && h.level <= maxLevel,
  );

  if (!items.length) return null;
  const Tag = ordered ? "ol" : "ul";

  const wrapperCls = [
    "not-prose my-6 rounded-lg border border-border bg-muted/30 p-4",
    sticky ? "lg:sticky lg:top-24" : "",
    columns === "half" ? "md:max-w-[50%]" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const listCls = [
    "m-0 pl-5 text-sm",
    ordered ? "list-decimal" : "list-disc",
    columns === "col-2"
      ? "sm:columns-2 sm:gap-8 [&>li]:break-inside-avoid space-y-1"
      : "space-y-1",
  ]
    .filter(Boolean)
    .join(" ");

  const indent = (level: number) => (level - minLevel) * 12;

  return (
    <nav aria-label={title || L} className={wrapperCls}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-semibold">
        {title || L}
      </p>
      <Tag className={listCls}>
        {items.map((it, i) => (
          <li key={`${it.anchor}-${i}`} style={{ marginLeft: indent(it.level) }}>
            <a href={`#${it.anchor}`} className="text-foreground hover:text-primary no-underline">
              {it.text}
            </a>
          </li>
        ))}
      </Tag>
    </nav>
  );
}
