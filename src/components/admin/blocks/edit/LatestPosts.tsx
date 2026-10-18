import type { Block } from "@/lib/blocks/types";
import { bool, num, str } from "@/components/blocks/renderer/data";
import { Input } from "@/components/ui/input";
import { AdminSelect } from "../AdminSelect";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

/** Zakres liczby wpisów - ten sam, do którego docina `renderLatestPosts`. */
const MIN_COUNT = 1;
const MAX_COUNT = 50;

function clampCount(value: number): number {
  return Math.max(MIN_COUNT, Math.min(MAX_COUNT, value));
}

/**
 * Najnowsze wpisy (Gutenberg "Latest Posts"). Odczyt idzie przez czytniki
 * renderera (`num`/`str`/`bool`), więc pole pokazuje liczbę i przełączniki,
 * których strona faktycznie użyje, a zapis trzyma się zakresu pola.
 */
export function LatestPostsBlock({ block, onChange }: Props) {
  const count = clampCount(num(block.data, "count", 5));
  const category = str(block.data, "category");
  const showExcerpt = bool(block.data, "showExcerpt", false);
  const showImage = bool(block.data, "showImage", true);
  const layout = str(block.data, "layout", "list") === "grid" ? "grid" : "list";

  return (
    <div className="rounded-lg border border-dashed border-border p-3 space-y-2 bg-muted/20">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Latest Posts
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input
          type="number"
          min={MIN_COUNT}
          max={MAX_COUNT}
          value={count}
          onChange={(e) => {
            // Puste pole to wartość domyślna (5); inaczej liczba całkowita z zakresu.
            const n = Number(e.target.value);
            const next = e.target.value === "" || !Number.isFinite(n) ? 5 : Math.round(n);
            onChange({ ...block, data: { ...block.data, count: clampCount(next) } });
          }}
        />
        <AdminSelect
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={layout}
          onChange={(e) => onChange({ ...block, data: { ...block.data, layout: e.target.value } })}
        >
          <option value="list">List</option>
          <option value="grid">Grid</option>
        </AdminSelect>
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
            onChange={(e) =>
              onChange({ ...block, data: { ...block.data, showImage: e.target.checked } })
            }
          />
          Miniatura
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={showExcerpt}
            onChange={(e) =>
              onChange({ ...block, data: { ...block.data, showExcerpt: e.target.checked } })
            }
          />
          Zajawka
        </label>
      </div>
    </div>
  );
}
