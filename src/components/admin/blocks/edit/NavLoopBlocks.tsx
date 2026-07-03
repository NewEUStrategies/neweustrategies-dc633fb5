// Admin edytory dla bloków Phase 2 batch 5: navigation, post-navigation-link, query-loop.
import type { Block, Json } from "@/lib/blocks/types";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

function Shell({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-3 space-y-2 bg-muted/20">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

export function NavigationBlock({ block, onChange }: Props) {
  const menuKey = String(block.data.menuKey ?? "primary");
  const layout = String(block.data.layout ?? "horizontal");
  return (
    <Shell label="Nawigacja">
      <div className="grid grid-cols-2 gap-2">
        <input
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={menuKey}
          placeholder="menuKey (np. primary)"
          onChange={(e) => onChange({ ...block, data: { ...block.data, menuKey: e.target.value } })}
        />
        <select
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={layout}
          onChange={(e) => onChange({ ...block, data: { ...block.data, layout: e.target.value } })}
        >
          <option value="horizontal">Pozioma</option>
          <option value="vertical">Pionowa</option>
        </select>
      </div>
    </Shell>
  );
}

export function PostNavigationLinkBlock({ block, onChange }: Props) {
  const direction = String(block.data.direction ?? "next");
  const showTitle = block.data.showTitle !== false;
  return (
    <Shell label="Poprzedni / Następny wpis">
      <div className="grid grid-cols-2 gap-2 items-center">
        <select
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={direction}
          onChange={(e) =>
            onChange({ ...block, data: { ...block.data, direction: e.target.value } })
          }
        >
          <option value="prev">Poprzedni</option>
          <option value="next">Następny</option>
        </select>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={showTitle}
            onChange={(e) =>
              onChange({ ...block, data: { ...block.data, showTitle: e.target.checked } })
            }
          />
          Pokaż tytuł
        </label>
      </div>
    </Shell>
  );
}

export function QueryLoopBlock({ block, onChange }: Props) {
  const d = block.data;
  const set = (patch: Record<string, Json>) => onChange({ ...block, data: { ...d, ...patch } });
  return (
    <Shell label="Pętla zapytań">
      <div className="grid grid-cols-2 gap-2">
        <input
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={String(d.categorySlug ?? "")}
          placeholder="kategoria (slug, opcjonalnie)"
          onChange={(e) => set({ categorySlug: e.target.value })}
        />
        <input
          type="number"
          min={1}
          max={24}
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={Number(d.limit ?? 6)}
          onChange={(e) => set({ limit: Number(e.target.value) || 6 })}
        />
        <select
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={String(d.layout ?? "grid")}
          onChange={(e) => set({ layout: e.target.value })}
        >
          <option value="grid">Siatka</option>
          <option value="list">Lista</option>
        </select>
        <select
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={String(d.orderBy ?? "date")}
          onChange={(e) => set({ orderBy: e.target.value })}
        >
          <option value="date">Data</option>
          <option value="title">Tytuł</option>
        </select>
      </div>
      <div className="flex flex-wrap gap-3 pt-1">
        {(["showImage", "showExcerpt", "showDate"] as const).map((k) => (
          <label key={k} className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={d[k] !== false}
              onChange={(e) => set({ [k]: e.target.checked })}
            />
            {k === "showImage" ? "Obraz" : k === "showExcerpt" ? "Zajawka" : "Data"}
          </label>
        ))}
      </div>
    </Shell>
  );
}
