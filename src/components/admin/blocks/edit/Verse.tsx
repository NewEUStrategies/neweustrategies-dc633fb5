import type { Block } from "@/lib/blocks/types";

interface Props { block: Block; onChange: (next: Block) => void; }

export function VerseBlock({ block, onChange }: Props) {
  const text = String(block.data.text ?? "");
  return (
    <textarea
      value={text}
      placeholder="Wpisz wiersz / poezję…"
      rows={Math.max(4, text.split("\n").length)}
      onChange={(e) => onChange({ ...block, data: { ...block.data, text: e.target.value } })}
      className="w-full bg-transparent font-serif italic text-lg leading-relaxed whitespace-pre-wrap border-none outline-none focus:ring-0 resize-y"
    />
  );
}
