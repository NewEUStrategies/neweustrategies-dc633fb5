import type { Block } from "@/lib/blocks/types";
import DOMPurify from "isomorphic-dompurify";
import { useMemo } from "react";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

// Canvas preview only - raw HTML editing lives in the right "Blok" sidebar.
export function HtmlBlock({ block, onChange: _onChange }: Props) {
  const html = String(block.data.html ?? "");
  const safe = useMemo(
    () => DOMPurify.sanitize(html, { USE_PROFILES: { html: true } }),
    [html]
  );

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
