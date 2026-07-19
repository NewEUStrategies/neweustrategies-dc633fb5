import type { Block } from "@/lib/blocks/types";
import { Input } from "@/components/ui/input";
import { GitCompareArrows } from "lucide-react";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

export function CompareBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const cp = (k: string) => i18n.editor("compare", k);
  const before = String(block.data.before ?? "");
  const after = String(block.data.after ?? "");
  const labelBefore = String(block.data.labelBefore ?? "Przed");
  const labelAfter = String(block.data.labelAfter ?? "Po");
  const patch = (k: string, v: string) => onChange({ ...block, data: { ...block.data, [k]: v } });

  return (
    <div className="not-prose rounded-md border border-border bg-card p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <GitCompareArrows className="w-3.5 h-3.5" /> {cp("shellLabel")}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input
          placeholder={cp("urlBefore")}
          value={before}
          onChange={(e) => patch("before", e.target.value)}
        />
        <Input
          placeholder={cp("urlAfter")}
          value={after}
          onChange={(e) => patch("after", e.target.value)}
        />
        <Input
          placeholder={cp("labelLeft")}
          value={labelBefore}
          onChange={(e) => patch("labelBefore", e.target.value)}
        />
        <Input
          placeholder={cp("labelRight")}
          value={labelAfter}
          onChange={(e) => patch("labelAfter", e.target.value)}
        />
      </div>
      {before && after && (
        <div className="grid grid-cols-2 gap-1 rounded overflow-hidden border border-border">
          <img src={before} alt={labelBefore} className="w-full h-24 object-cover" />
          <img src={after} alt={labelAfter} className="w-full h-24 object-cover" />
        </div>
      )}
    </div>
  );
}
