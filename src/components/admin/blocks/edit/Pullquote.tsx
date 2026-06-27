import type { Block } from "@/lib/blocks/types";

interface Props { block: Block; onChange: (next: Block) => void; }

export function PullquoteBlock({ block, onChange }: Props) {
  const text = String(block.data.text ?? "");
  const cite = String(block.data.cite ?? "");
  return (
    <div className="border-y-4 border-primary py-6 my-4 text-center space-y-3">
      <textarea
        value={text}
        placeholder="Wyróżniony cytat…"
        rows={2}
        onChange={(e) => onChange({ ...block, data: { ...block.data, text: e.target.value } })}
        className="w-full bg-transparent text-2xl md:text-3xl font-serif italic text-center border-none outline-none focus:ring-0 resize-none"
      />
      <input
        type="text"
        value={cite}
        placeholder="— źródło / autor"
        onChange={(e) => onChange({ ...block, data: { ...block.data, cite: e.target.value } })}
        className="w-full bg-transparent text-sm text-muted-foreground text-center border-none outline-none"
      />
    </div>
  );
}
