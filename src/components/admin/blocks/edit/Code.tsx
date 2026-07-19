import type { Block } from "@/lib/blocks/types";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

export function CodeBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const cc = (k: string, o?: Record<string, unknown>) => i18n.editor("code", k, o);
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
        <span className="text-[10px] text-muted-foreground">
          {cc("charCount", { n: code.length })}
        </span>
      </div>
      <textarea
        value={code}
        onChange={(e) => onChange({ ...block, data: { ...block.data, code: e.target.value } })}
        placeholder={cc("codePh")}
        spellCheck={false}
        className="w-full bg-transparent font-mono text-sm p-3 outline-none focus:ring-0 border-none resize-y min-h-[120px]"
      />
    </div>
  );
}
