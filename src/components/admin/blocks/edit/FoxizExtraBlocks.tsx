// Admin edytory dla Phase 3 batch 8 (Foxiz/Ruby custom):
// post-stats, post-rating, loginout, more-posts.

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

// -------- Post Stats (meta bar) --------

const STAT_OPTIONS = ["date", "author", "category", "reading", "views", "comments"] as const;

export function PostStatsBlock({ block, onChange }: Props) {
  const items = Array.isArray(block.data.items) ? (block.data.items as string[]) : ["date", "author", "reading"];
  const separator = String(block.data.separator ?? "•");

  const toggle = (n: string) => {
    const has = items.includes(n);
    const next = has ? items.filter((x) => x !== n) : [...items, n];
    onChange({ ...block, data: { ...block.data, items: next } });
  };

  return (
    <Shell label="Pasek meta wpisu">
      <div className="flex flex-wrap gap-1.5">
        {STAT_OPTIONS.map((n) => {
          const active = items.includes(n);
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
      <input
        className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
        value={separator}
        placeholder="Separator (np. • / |)"
        onChange={(e) => onChange({ ...block, data: { ...block.data, separator: e.target.value } })}
      />
    </Shell>
  );
}

// -------- Post Rating (reader rating) --------

export function PostRatingBlock({ block, onChange }: Props) {
  const max = Number(block.data.max ?? 5);
  const label = String(block.data.label ?? "");
  return (
    <Shell label="Ocena czytelnika">
      <div className="grid grid-cols-2 gap-2">
        <select
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={max}
          onChange={(e) => onChange({ ...block, data: { ...block.data, max: Number(e.target.value) } })}
        >
          <option value={5}>5 gwiazdek</option>
          <option value={10}>10 gwiazdek</option>
        </select>
        <input
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={label}
          placeholder="Etykieta (opcjonalnie)"
          onChange={(e) => onChange({ ...block, data: { ...block.data, label: e.target.value } })}
        />
      </div>
    </Shell>
  );
}

// -------- LoginOut --------

export function LoginOutBlock({ block, onChange }: Props) {
  const loginHref = String(block.data.loginHref ?? "/auth");
  const showAvatar = block.data.showAvatar !== false;
  return (
    <Shell label="Zaloguj / Wyloguj">
      <input
        className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
        value={loginHref}
        placeholder="Link logowania (np. /auth)"
        onChange={(e) => onChange({ ...block, data: { ...block.data, loginHref: e.target.value } })}
      />
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={showAvatar}
          onChange={(e) => onChange({ ...block, data: { ...block.data, showAvatar: e.target.checked } })}
        />
        Pokaż avatar
      </label>
    </Shell>
  );
}

// -------- More Posts promo --------

export function MorePostsBlock({ block, onChange }: Props) {
  const limit = Number(block.data.limit ?? 4);
  const heading = String(block.data.heading ?? "");
  const strategy = String(block.data.strategy ?? "latest");
  return (
    <Shell label="Polecane wpisy (pasek)">
      <div className="grid grid-cols-2 gap-2">
        <input
          type="number"
          min={2}
          max={12}
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={limit}
          onChange={(e) => onChange({ ...block, data: { ...block.data, limit: Number(e.target.value) || 4 } })}
        />
        <select
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={strategy}
          onChange={(e) => onChange({ ...block, data: { ...block.data, strategy: e.target.value } })}
        >
          <option value="latest">Najnowsze</option>
          <option value="trending">Popularne (7 dni)</option>
          <option value="category">Z tej kategorii</option>
        </select>
      </div>
      <input
        className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
        value={heading}
        placeholder="Nagłówek (opcjonalnie)"
        onChange={(e) => onChange({ ...block, data: { ...block.data, heading: e.target.value } })}
      />
    </Shell>
  );
}
