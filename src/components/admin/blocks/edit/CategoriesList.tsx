import type { Block } from "@/lib/blocks/types";

interface Props { block: Block; onChange: (next: Block) => void; }

/** Lista kategorii (Gutenberg "Categories List"). */
export function CategoriesListBlock({ block, onChange }: Props) {
  const showCount = Boolean(block.data.showCount);
  const hierarchical = Boolean(block.data.hierarchical);
  const layout = String(block.data.layout ?? "list");
  return (
    <div className="rounded-lg border border-dashed border-border p-3 space-y-2 bg-muted/20">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Categories</div>
      <select
        className="text-xs bg-background border border-border rounded px-2 py-2 h-9 w-full"
        value={layout}
        onChange={(e) => onChange({ ...block, data: { ...block.data, layout: e.target.value } })}
      >
        <option value="list">Lista</option>
        <option value="dropdown">Lista rozwijana</option>
      </select>
      <div className="flex gap-4 text-xs">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={showCount}
            onChange={(e) => onChange({ ...block, data: { ...block.data, showCount: e.target.checked } })} />
          Pokaż liczbę
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={hierarchical}
            onChange={(e) => onChange({ ...block, data: { ...block.data, hierarchical: e.target.checked } })} />
          Hierarchia
        </label>
      </div>
    </div>
  );
}
