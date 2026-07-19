// Admin edytory dla bloków Phase 2 batch 6:
// breadcrumbs, reading-time, share-buttons, post-views.
// Lekkie kontrolki spójne z resztą edit/ - bez zewnętrznych zaleznosci UI.

import type { Block } from "@/lib/blocks/types";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import { AdminSelect } from "../AdminSelect";

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
  const i18n = useBlocksI18n();
  const pu = (k: string) => i18n.editor("postUtility", k);
  const sep = String(block.data.separator ?? "/");
  const showHome = block.data.showHome !== false;
  return (
    <Shell label={pu("breadcrumbsLabel")}>
      <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
        <input
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={sep}
          placeholder={pu("separatorPh")}
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
          {pu("showHome")}
        </label>
      </div>
    </Shell>
  );
}

export function ReadingTimeBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const pu = (k: string) => i18n.editor("postUtility", k);
  const wpm = Number(block.data.wpm ?? 220);
  const prefix = String(block.data.prefix ?? "");
  return (
    <Shell label={pu("readingTimeLabel")}>
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
          placeholder={pu("prefixPh")}
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
  const i18n = useBlocksI18n();
  const pu = (k: string) => i18n.editor("postUtility", k);
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
    <Shell label={pu("shareLabel")}>
      <AdminSelect
        className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
        value={variant}
        onChange={(e) => onChange({ ...block, data: { ...block.data, variant: e.target.value } })}
      >
        <option value="filled">{pu("variantFilled")}</option>
        <option value="outline">{pu("variantOutline")}</option>
        <option value="ghost">{pu("variantGhost")}</option>
      </AdminSelect>
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
                  ? "bg-foreground text-background border-foreground"
                  : "bg-background text-muted-foreground border-border hover:border-foreground/50",
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
  const i18n = useBlocksI18n();
  const pu = (k: string) => i18n.editor("postUtility", k);
  const suffix = String(block.data.suffix ?? "");
  return (
    <Shell label={pu("viewsLabel")}>
      <input
        className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
        value={suffix}
        placeholder={pu("suffixPh")}
        onChange={(e) => onChange({ ...block, data: { ...block.data, suffix: e.target.value } })}
      />
    </Shell>
  );
}
