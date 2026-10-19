import type { Block } from "@/lib/blocks/types";
import { Input } from "@/components/ui/input";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import { bool, num } from "@/components/blocks/renderer/data";

/** Granice `limit` zapytania chmury tagów (`blockTagsQueryOptions`: 1-200). */
const COUNT_MIN = 1;
const COUNT_MAX = 200;
const COUNT_DEFAULT = 30;

/** Liczba tagów w granicach zapytania; całkowita, bo `limit` ułamka nie przyjmie. */
function clampCount(n: number): number {
  return Math.max(COUNT_MIN, Math.min(COUNT_MAX, Math.round(n)));
}

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

/** Chmura tagów (Gutenberg "Tag Cloud"). */
export function TagCloudBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  // Pole pokazuje tyle tagów, ile pobierze strona - nie surową wartość z danych.
  const count = clampCount(num(block.data, "count", COUNT_DEFAULT));
  const showCount = bool(block.data, "showCount", false);
  return (
    <div className="rounded-lg border border-dashed border-border p-3 space-y-2 bg-muted/20">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {i18n.editor("tagCloud", "title")}
      </div>
      <div className="grid grid-cols-2 gap-2 items-center">
        <Input
          type="number"
          min={COUNT_MIN}
          max={COUNT_MAX}
          value={count}
          aria-label={i18n.editor("tagCloud", "countPh")}
          onChange={(e) => {
            const next = e.target.value === "" ? COUNT_DEFAULT : clampCount(Number(e.target.value));
            onChange({ ...block, data: { ...block.data, count: next } });
          }}
        />
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={showCount}
            onChange={(e) =>
              onChange({ ...block, data: { ...block.data, showCount: e.target.checked } })
            }
          />
          {i18n.editor("tagCloud", "showCount")}
        </label>
      </div>
    </div>
  );
}
