import type { Block } from "@/lib/blocks/types";
import { useMemo } from "react";

import { useBlocksI18n } from "@/lib/blocks/i18n";
import { sanitizeHtml } from "@/lib/sanitize";
import { readText } from "./dataVizShared";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

// Canvas preview only - raw HTML editing lives in the right "Blok" sidebar.
export function HtmlBlock({ block, onChange: _onChange }: Props) {
  const i18n = useBlocksI18n();
  const html = readText(block.data.html);
  const safe = useMemo(() => sanitizeHtml(html), [html]);

  if (!html.trim()) {
    return (
      <p className="text-sm text-muted-foreground italic">{i18n.editor("html", "emptyHint")}</p>
    );
  }

  return (
    <div
      className="blocks-content prose prose-sm dark:prose-invert max-w-none"
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}
