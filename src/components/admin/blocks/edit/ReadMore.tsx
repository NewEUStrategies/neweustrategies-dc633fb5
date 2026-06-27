import type { Block } from "@/lib/blocks/types";

interface Props { block: Block; onChange: (next: Block) => void; }

export function ReadMoreBlock({ block, onChange }: Props) {
  const text = String(block.data.text ?? "Czytaj dalej");
  return (
    <div className="flex items-center gap-3 py-2 select-none">
      <div className="flex-1 border-t-2 border-dashed border-primary/40" />
      <input
        type="text"
        value={text}
        onChange={(e) => onChange({ ...block, data: { ...block.data, text: e.target.value } })}
        className="text-xs uppercase tracking-wider text-primary font-medium bg-transparent border-none outline-none text-center"
      />
      <div className="flex-1 border-t-2 border-dashed border-primary/40" />
    </div>
  );
}
