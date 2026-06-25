import type { Block } from "@/lib/blocks/types";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

export function QuoteBlock({ block, onChange }: Props) {
  const text = String(block.data.text ?? "");
  const cite = String(block.data.cite ?? "");

  return (
    <blockquote className="border-l-4 border-primary pl-4 space-y-2">
      <textarea
        value={text}
        rows={2}
        placeholder="Treść cytatu…"
        onChange={(e) => onChange({ ...block, data: { ...block.data, text: e.target.value } })}
        className="w-full bg-transparent text-lg italic border-none outline-none focus:ring-0 p-0 resize-none"
      />
      <input
        type="text"
        value={cite}
        placeholder="- Autor (opcjonalnie)"
        onChange={(e) => onChange({ ...block, data: { ...block.data, cite: e.target.value } })}
        className="w-full bg-transparent text-sm text-muted-foreground border-none outline-none focus:ring-0 p-0"
      />
    </blockquote>
  );
}
