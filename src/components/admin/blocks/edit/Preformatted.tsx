import type { Block } from "@/lib/blocks/types";

interface Props { block: Block; onChange: (next: Block) => void; }

export function PreformattedBlock({ block, onChange }: Props) {
  const text = String(block.data.text ?? "");
  return (
    <textarea
      value={text}
      placeholder="Wstępnie sformatowany tekst (zachowuje spacje i nowe linie)…"
      rows={Math.max(3, text.split("\n").length)}
      onChange={(e) => onChange({ ...block, data: { ...block.data, text: e.target.value } })}
      className="w-full bg-muted/40 rounded-md p-3 font-mono text-sm whitespace-pre border-none outline-none focus:ring-1 focus:ring-primary/40 resize-y"
    />
  );
}
