import type { Block } from "@/lib/blocks/types";
import { useBlocksI18n } from "@/lib/blocks/i18n";

interface Props { block: Block; onChange: (next: Block) => void; }

export function VerseBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const text = String(block.data.text ?? "");
  return (
    <textarea
      value={text}
      placeholder={i18n.editor("verse","textPh")}
      rows={Math.max(4, text.split("\n").length)}
      onChange={(e) => onChange({ ...block, data: { ...block.data, text: e.target.value } })}
      className="w-full bg-transparent font-serif italic text-lg leading-relaxed whitespace-pre-wrap border-none outline-none focus:ring-0 resize-y"
    />
  );
}
