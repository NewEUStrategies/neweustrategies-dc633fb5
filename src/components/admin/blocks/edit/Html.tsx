import type { Block } from "@/lib/blocks/types";
import { useMemo } from "react";

import { sanitizeHtml } from "@/lib/sanitize";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

// Canvas preview only - raw HTML editing lives in the right "Blok" sidebar.
export function HtmlBlock({ block, onChange: _onChange }: Props) {
  const html = String(block.data.html ?? "");
  const safe = useMemo(() => sanitizeHtml(html), [html]);

  if (!html.trim()) {
    return (
      <p className="text-sm text-muted-foreground italic">
        Pusty blok HTML - edytuj surowy HTML w panelu „Blok" po prawej.
      </p>
    );
  }

  return (
    <div
      className="blocks-content prose prose-sm dark:prose-invert max-w-none"
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}
