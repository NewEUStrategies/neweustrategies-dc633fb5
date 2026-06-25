import type { Block } from "@/lib/blocks/types";
import { Input } from "@/components/ui/input";
import { ListTree } from "lucide-react";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

export function TocBlock({ block, onChange }: Props) {
  const title = String(block.data.title ?? "");
  const maxLevel = Math.max(2, Math.min(4, Number(block.data.maxLevel ?? 3)));
  const ordered = Boolean(block.data.ordered);
  const sticky = Boolean(block.data.sticky);

  return (
    <div className="not-prose rounded-md border border-border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <ListTree className="w-3.5 h-3.5" /> Spis treści
        <span className="ml-auto text-[10px] normal-case tracking-normal">Generowany automatycznie z H2-H{maxLevel}</span>
      </div>
      <Input
        placeholder="Tytuł (np. Spis treści)"
        value={title}
        onChange={(e) => onChange({ ...block, data: { ...block.data, title: e.target.value } })}
      />
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1">
          Głębokość:
          <select
            value={maxLevel}
            onChange={(e) => onChange({ ...block, data: { ...block.data, maxLevel: Number(e.target.value) } })}
            className="bg-background border border-border rounded px-1 py-0.5"
          >
            <option value={2}>H2</option>
            <option value={3}>H2-H3</option>
            <option value={4}>H2-H4</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={ordered}
            onChange={(e) => onChange({ ...block, data: { ...block.data, ordered: e.target.checked } })}
          />
          Numerowana
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={sticky}
            onChange={(e) => onChange({ ...block, data: { ...block.data, sticky: e.target.checked } })}
          />
          Sticky (sidebar)
        </label>
      </div>
    </div>
  );
}
