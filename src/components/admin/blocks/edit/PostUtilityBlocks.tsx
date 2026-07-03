// Admin edytory dla bloków Phase 2 batch 6:
// breadcrumbs, reading-time, share-buttons, post-views.
// Lekkie kontrolki spójne z resztą edit/ - bez zewnętrznych zaleznosci UI.

import type { Block } from "@/lib/blocks/types";

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

export function BreadcrumbsBlock({ block, onChange }: Props) {
  const sep = String(block.data.separator ?? "/");
  const showHome = block.data.showHome !== false;
  return (
    <Shell label="Okruszki">
      <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
        <input
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={sep}
          placeholder="Separator (np. / lub ›)"
          onChange={(e) =>
            onChange({ ...block, data: { ...block.data, separator: e.target.value } })
          }
        />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showHome}
            onChange={(e) =>
              onChange({ ...block, data: { ...block.data, showHome: e.target.checked } })
            }
          />
          Pokaż "Strona główna"
        </label>
      </div>
    </Shell>
  );
}

export function ReadingTimeBlock({ block, onChange }: Props) {
  const wpm = Number(block.data.wpm ?? 220);
  const prefix = String(block.data.prefix ?? "");
  return (
    <Shell label="Czas czytania">
      <div className="grid grid-cols-2 gap-2">
        <input
          type="number"
          min={60}
          max={600}
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={wpm}
          onChange={(e) =>
            onChange({ ...block, data: { ...block.data, wpm: Number(e.target.value) || 220 } })
          }
        />
        <input
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={prefix}
          placeholder="Prefix (opcjonalnie)"
          onChange={(e) => onChange({ ...block, data: { ...block.data, prefix: e.target.value } })}
        />
      </div>
    </Shell>
  );
}

const ALL_NETWORKS = [
  "facebook",
  "x",
  "linkedin",
  "whatsapp",
  "telegram",
  "email",
  "copy",
] as const;

export function ShareButtonsBlock({ block, onChange }: Props) {
  const networks = Array.isArray(block.data.networks)
    ? (block.data.networks as string[])
    : ["facebook", "x", "linkedin", "copy"];
  const variant = String(block.data.variant ?? "filled");

  const toggle = (n: string) => {
    const has = networks.includes(n);
    const next = has ? networks.filter((x) => x !== n) : [...networks, n];
    onChange({ ...block, data: { ...block.data, networks: next } });
  };

  return (
    <Shell label="Udostępnij">
      <select
        className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
        value={variant}
        onChange={(e) => onChange({ ...block, data: { ...block.data, variant: e.target.value } })}
      >
        <option value="filled">Wypełnione</option>
        <option value="outline">Obrys</option>
        <option value="ghost">Minimalne</option>
      </select>
      <div className="flex flex-wrap gap-1.5">
        {ALL_NETWORKS.map((n) => {
          const active = networks.includes(n);
          return (
            <button
              key={n}
              type="button"
              onClick={() => toggle(n)}
              className={[
                "text-[11px] px-2 py-1 rounded border transition-colors capitalize",
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:border-primary/50",
              ].join(" ")}
            >
              {n}
            </button>
          );
        })}
      </div>
    </Shell>
  );
}

export function PostViewsBlock({ block, onChange }: Props) {
  const suffix = String(block.data.suffix ?? "");
  return (
    <Shell label="Wyświetlenia">
      <input
        className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
        value={suffix}
        placeholder="Suffix (np. wyświetleń)"
        onChange={(e) => onChange({ ...block, data: { ...block.data, suffix: e.target.value } })}
      />
    </Shell>
  );
}
