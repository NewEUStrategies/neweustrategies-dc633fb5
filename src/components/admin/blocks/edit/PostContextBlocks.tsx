// Admin edytory dla bloków Phase 2 batch 7: author-bio, related-posts.
import type { Block, Json } from "@/lib/blocks/types";
import { useBlocksI18n } from "@/lib/blocks/i18n";

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

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function AuthorBioBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const showAvatar = block.data.showAvatar !== false;
  const showSocial = block.data.showSocial !== false;
  const showPostsCount = block.data.showPostsCount !== false;
  const variant = String(block.data.variant ?? "card");
  const set = (patch: Record<string, Json>) =>
    onChange({ ...block, data: { ...block.data, ...patch } });

  return (
    <Shell label="Bio autora">
      <select
        className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
        value={variant}
        onChange={(e) => set({ variant: e.target.value })}
      >
        <option value="card">{i18n.editor("newsletter", "variantCard")}</option>
        <option value="inline">Inline</option>
        <option value="minimal">Minimalna</option>
      </select>
      <div className="flex flex-wrap gap-3">
        <Toggle checked={showAvatar} onChange={(v) => set({ showAvatar: v })} label="Avatar" />
        <Toggle
          checked={showSocial}
          onChange={(v) => set({ showSocial: v })}
          label="Linki social"
        />
        <Toggle
          checked={showPostsCount}
          onChange={(v) => set({ showPostsCount: v })}
          label="Licznik wpisów"
        />
      </div>
    </Shell>
  );
}

export function RelatedPostsBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const limit = Number(block.data.limit ?? 3);
  const strategy = String(block.data.strategy ?? "category");
  const layout = String(block.data.layout ?? "grid");
  const heading = String(block.data.heading ?? "");
  const set = (patch: Record<string, Json>) =>
    onChange({ ...block, data: { ...block.data, ...patch } });

  return (
    <Shell label="Powiązane wpisy">
      <input
        className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
        value={heading}
        placeholder="Nagłówek (opcjonalnie)"
        onChange={(e) => set({ heading: e.target.value })}
      />
      <div className="grid grid-cols-3 gap-2">
        <input
          type="number"
          min={1}
          max={12}
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={limit}
          onChange={(e) => set({ limit: Number(e.target.value) || 3 })}
        />
        <select
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={strategy}
          onChange={(e) => set({ strategy: e.target.value })}
        >
          <option value="category">Wg kategorii</option>
          <option value="tag">Wg tagu</option>
          <option value="author">Wg autora</option>
          <option value="latest">Najnowsze</option>
        </select>
        <select
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={layout}
          onChange={(e) => set({ layout: e.target.value })}
        >
          <option value="grid">Grid</option>
          <option value="list">Lista</option>
          <option value="compact">Kompakt</option>
        </select>
      </div>
    </Shell>
  );
}
