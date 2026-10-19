import type { Block } from "@/lib/blocks/types";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import { readText } from "./dataVizShared";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

export function ReadMoreBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  // Bez tekstu pole jest PUSTE, a „Czytaj dalej" / „Read more" to podpowiedź
  // ze słownika - wcześniej polski napis był wpisaną na sztywno WARTOŚCIĄ.
  const text = readText(block.data.text);
  return (
    <div className="flex items-center gap-3 py-2 select-none">
      <div className="flex-1 border-t-2 border-dashed border-foreground/40" />
      <input
        type="text"
        value={text}
        placeholder={i18n.editor("readMore", "textPh")}
        onChange={(e) => onChange({ ...block, data: { ...block.data, text: e.target.value } })}
        className="text-xs uppercase tracking-wider text-foreground font-medium bg-transparent border-none outline-none text-center"
      />
      <div className="flex-1 border-t-2 border-dashed border-foreground/40" />
    </div>
  );
}
