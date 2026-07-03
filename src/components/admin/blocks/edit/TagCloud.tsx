import type { Block } from "@/lib/blocks/types";
import { Input } from "@/components/ui/input";
import { useBlocksI18n } from "@/lib/blocks/i18n";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

/** Chmura tagów (Gutenberg "Tag Cloud"). */
export function TagCloudBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const count = Number(block.data.count ?? 30);
  const showCount = Boolean(block.data.showCount);
  return (
    <div className="rounded-lg border border-dashed border-border p-3 space-y-2 bg-muted/20">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {i18n.editor("tagCloud", "title")}
      </div>
      <div className="grid grid-cols-2 gap-2 items-center">
        <Input
          type="number"
          min={1}
          max={200}
          value={count}
          onChange={(e) =>
            onChange({ ...block, data: { ...block.data, count: Number(e.target.value || 30) } })
          }
        />
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={showCount}
            onChange={(e) =>
              onChange({ ...block, data: { ...block.data, showCount: e.target.checked } })
            }
          />
          Pokaż liczbę wpisów
        </label>
      </div>
    </div>
  );
}
