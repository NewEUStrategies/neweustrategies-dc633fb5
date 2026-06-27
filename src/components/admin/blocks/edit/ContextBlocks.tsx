// Admin edytory dla bloków dynamicznych "post-*" (Phase 2).
// Wszystkie czytają CurrentPostCtx na public stronie; tu pokazujemy tylko placeholder + opcje.
import type { Block } from "@/lib/blocks/types";

interface Props { block: Block; onChange: (next: Block) => void; }

function Shell({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-3 space-y-2 bg-muted/20">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

export function PostTitleBlock({ block, onChange }: Props) {
  const level = Number(block.data.level ?? 1);
  return (
    <Shell label="Post · Tytuł">
      <select
        className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
        value={level}
        onChange={(e) => onChange({ ...block, data: { ...block.data, level: Number(e.target.value) } })}
      >
        {[1, 2, 3, 4].map((l) => <option key={l} value={l}>H{l}</option>)}
      </select>
    </Shell>
  );
}

export function PostDateBlock({ block, onChange }: Props) {
  const format = String(block.data.format ?? "long");
  const showUpdated = Boolean(block.data.showUpdated);
  return (
    <Shell label="Post · Data">
      <div className="flex gap-2 items-center text-xs">
        <select
          className="bg-background border border-border rounded px-2 py-2 h-9"
          value={format}
          onChange={(e) => onChange({ ...block, data: { ...block.data, format: e.target.value } })}
        >
          <option value="long">Pełna (15 stycznia 2025)</option>
          <option value="short">Krótka (15.01.2025)</option>
          <option value="relative">Względna (3 dni temu)</option>
        </select>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={showUpdated}
            onChange={(e) => onChange({ ...block, data: { ...block.data, showUpdated: e.target.checked } })} />
          Aktualizacja
        </label>
      </div>
    </Shell>
  );
}

export function PostAuthorBlock({ block, onChange }: Props) {
  const showAvatar = block.data.showAvatar !== false;
  const showBio = Boolean(block.data.showBio);
  return (
    <Shell label="Post · Autor">
      <div className="flex gap-4 text-xs">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={showAvatar}
            onChange={(e) => onChange({ ...block, data: { ...block.data, showAvatar: e.target.checked } })} />
          Awatar
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={showBio}
            onChange={(e) => onChange({ ...block, data: { ...block.data, showBio: e.target.checked } })} />
          Bio
        </label>
      </div>
    </Shell>
  );
}

export function PostExcerptBlock({ block, onChange }: Props) {
  const showMore = Boolean(block.data.showMore);
  return (
    <Shell label="Post · Zajawka">
      <label className="flex items-center gap-1 text-xs">
        <input type="checkbox" checked={showMore}
          onChange={(e) => onChange({ ...block, data: { ...block.data, showMore: e.target.checked } })} />
        Pokaż link „Czytaj dalej"
      </label>
    </Shell>
  );
}

export function PostFeaturedImageBlock({ block, onChange }: Props) {
  const aspect = String(block.data.aspect ?? "16/9");
  const rounded = block.data.rounded !== false;
  return (
    <Shell label="Post · Obraz wyróżniony">
      <div className="flex gap-2 items-center text-xs">
        <select
          className="bg-background border border-border rounded px-2 py-2 h-9"
          value={aspect}
          onChange={(e) => onChange({ ...block, data: { ...block.data, aspect: e.target.value } })}
        >
          <option value="16/9">16:9</option>
          <option value="4/3">4:3</option>
          <option value="1/1">1:1</option>
          <option value="3/2">3:2</option>
        </select>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={rounded}
            onChange={(e) => onChange({ ...block, data: { ...block.data, rounded: e.target.checked } })} />
          Zaokrąglony
        </label>
      </div>
    </Shell>
  );
}

export function PostTermsBlock({ block, onChange }: Props) {
  const taxonomy = String(block.data.taxonomy ?? "categories");
  return (
    <Shell label="Post · Taksonomie">
      <select
        className="text-xs bg-background border border-border rounded px-2 py-2 h-9 w-full"
        value={taxonomy}
        onChange={(e) => onChange({ ...block, data: { ...block.data, taxonomy: e.target.value } })}
      >
        <option value="categories">Kategorie</option>
        <option value="tags">Tagi</option>
      </select>
    </Shell>
  );
}

export function SiteTitleBlock({ block, onChange }: Props) {
  const level = Number(block.data.level ?? 1);
  return (
    <Shell label="Witryna · Tytuł">
      <select
        className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
        value={level}
        onChange={(e) => onChange({ ...block, data: { ...block.data, level: Number(e.target.value) } })}
      >
        {[1, 2, 3].map((l) => <option key={l} value={l}>H{l}</option>)}
      </select>
    </Shell>
  );
}

export function SiteTaglineBlock(_: Props) {
  return <Shell label="Witryna · Slogan" />;
}

export function SiteLogoBlock({ block, onChange }: Props) {
  const width = Number(block.data.width ?? 120);
  return (
    <Shell label="Witryna · Logo">
      <input
        type="number" min={32} max={480}
        value={width}
        onChange={(e) => onChange({ ...block, data: { ...block.data, width: Number(e.target.value || 120) } })}
        className="text-xs bg-background border border-border rounded px-2 py-2 h-9 w-full"
      />
    </Shell>
  );
}
