import type { Block } from "@/lib/blocks/types";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

export function CodeBlock({ block, onChange }: Props) {
  const code = String(block.data.code ?? "");
  const lang = String(block.data.lang ?? "ts");
  return (
    <div className="rounded-md border border-border bg-muted/40 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted/60">
        <input
          type="text"
          value={lang}
          onChange={(e) => onChange({ ...block, data: { ...block.data, lang: e.target.value } })}
          className="bg-transparent text-xs font-mono outline-none border-none p-0 w-20"
          placeholder="ts"
        />
        <span className="text-[10px] text-muted-foreground">{code.length} znaków</span>
      </div>
      <textarea
        value={code}
        onChange={(e) => onChange({ ...block, data: { ...block.data, code: e.target.value } })}
        placeholder="// kod…"
        spellCheck={false}
        className="w-full bg-transparent font-mono text-sm p-3 outline-none focus:ring-0 border-none resize-y min-h-[120px]"
      />
    </div>
  );
}
