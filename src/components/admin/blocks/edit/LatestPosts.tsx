import type { Block } from "@/lib/blocks/types";
import { Input } from "@/components/ui/input";

interface Props { block: Block; onChange: (next: Block) => void; }

/** Najnowsze wpisy (Gutenberg "Latest Posts"). */
export function LatestPostsBlock({ block, onChange }: Props) {
  const count = Number(block.data.count ?? 5);
  const category = String(block.data.category ?? "");
  const showExcerpt = Boolean(block.data.showExcerpt);
  const showImage = Boolean(block.data.showImage ?? true);
  const layout = String(block.data.layout ?? "list");

  return (
    <div className="rounded-lg border border-dashed border-border p-3 space-y-2 bg-muted/20">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Latest Posts</div>
      <div className="grid grid-cols-2 gap-2">
        <Input
          type="number"
          min={1}
          max={50}
          value={count}
          onChange={(e) => onChange({ ...block, data: { ...block.data, count: Number(e.target.value || 5) } })}
        />
        <select
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={layout}
          onChange={(e) => onChange({ ...block, data: { ...block.data, layout: e.target.value } })}
        >
          <option value="list">List</option>
          <option value="grid">Grid</option>
        </select>
      </div>
      <Input
        value={category}
        placeholder="Slug kategorii (opcjonalnie)"
        onChange={(e) => onChange({ ...block, data: { ...block.data, category: e.target.value } })}
      />
      <div className="flex gap-4 text-xs">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={showImage}
            onChange={(e) => onChange({ ...block, data: { ...block.data, showImage: e.target.checked } })}
          />
          Miniatura
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={showExcerpt}
            onChange={(e) => onChange({ ...block, data: { ...block.data, showExcerpt: e.target.checked } })}
          />
          Zajawka
        </label>
      </div>
    </div>
  );
}
