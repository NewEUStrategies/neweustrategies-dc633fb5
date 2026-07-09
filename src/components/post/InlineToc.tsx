// Inline ToC pod przyciskiem odsłuchu. Adapter na TocBlockView - bierze
// zmergowane ustawienia (globalne + per-wpis) i renderuje tylko gdy
// `showInBody` = true oraz mamy wystarczająco nagłówków.
import type { BlocksDoc } from "@/lib/blocks/types";
import { TocBlockView } from "@/components/blocks/TocBlockView";
import {
  extractHeadingsFromBlocks,
  mergeTocSettings,
  type TocDefaults,
  type TocOverride,
} from "@/lib/toc/settings";

interface InlineTocProps {
  blocksDoc: BlocksDoc | null;
  defaults: TocDefaults;
  override: TocOverride | null | undefined;
  lang: "pl" | "en";
}

export function InlineToc({ blocksDoc, defaults, override, lang }: InlineTocProps) {
  const merged = mergeTocSettings(defaults, override);
  if (!merged.enabled || !merged.showInBody) return null;
  if (!blocksDoc) return null;

  const headings = extractHeadingsFromBlocks(blocksDoc).filter(
    (h) => h.level >= merged.minLevel && h.level <= merged.maxLevel,
  );
  if (headings.length < merged.minHeadings) return null;

  return (
    <TocBlockView
      blocks={blocksDoc.blocks}
      title={lang === "en" ? merged.titleEn : merged.titlePl}
      minLevel={merged.minLevel}
      maxLevel={merged.maxLevel}
      ordered={merged.ordered}
      sticky={false}
      columns={merged.columns}
      lang={lang}
    />
  );
}
