import type { Block } from "@/lib/blocks/types";

interface Props { block: Block; onChange: (next: Block) => void; }

/** Archiwa miesięczne (Gutenberg "Archives"). */
export function ArchivesBlock({ block, onChange }: Props) {
  const showCount = Boolean(block.data.showCount);
  const layout = String(block.data.layout ?? "list");
  return (
    <div className="rounded-lg border border-dashed border-border p-3 space-y-2 bg-muted/20">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Archives</div>
      <select
        className="text-xs bg-background border border-border rounded px-2 py-2 h-9 w-full"
        value={layout}
        onChange={(e) => onChange({ ...block, data: { ...block.data, layout: e.target.value } })}
      >
        <option value="list">Lista</option>
        <option value="dropdown">Lista rozwijana</option>
      </select>
      <label className="flex items-center gap-1 text-xs">
        <input type="checkbox" checked={showCount}
          onChange={(e) => onChange({ ...block, data: { ...block.data, showCount: e.target.checked } })} />
        Pokaż liczbę wpisów
      </label>
    </div>
  );
}
