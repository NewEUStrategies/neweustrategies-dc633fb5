import type { Block } from "@/lib/blocks/types";
import DOMPurify from "isomorphic-dompurify";
import { useMemo } from "react";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

export function HtmlBlock({ block, onChange }: Props) {
  const html = String(block.data.html ?? "");
  const safe = useMemo(() => DOMPurify.sanitize(html, { USE_PROFILES: { html: true } }), [html]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
      <textarea
        value={html}
        onChange={(e) => onChange({ ...block, data: { ...block.data, html: e.target.value } })}
        spellCheck={false}
        placeholder="<div>…</div>"
        className="font-mono text-xs p-2 rounded-md border border-border bg-muted/40 min-h-[120px] outline-none focus:ring-1 focus:ring-primary resize-y"
      />
      <div className="rounded-md border border-dashed border-border p-2 overflow-auto text-sm" dangerouslySetInnerHTML={{ __html: safe }} />
    </div>
  );
}
