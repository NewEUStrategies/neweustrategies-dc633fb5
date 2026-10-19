// Admin edytory dla Phase 3 batch 8 (Foxiz/Ruby custom):
// post-stats, post-rating, loginout, more-posts.
//
// Odczyt `block.data` idzie przez TE SAME czytniki, co renderer publiczny
// (`components/blocks/renderer/data.ts`) - panel pokazuje wartość, której
// użyje `FoxizExtraViews`, a nie `[object Object]` czy `NaN` z importu.

import type { Block } from "@/lib/blocks/types";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import { bool, num, str, strList } from "@/components/blocks/renderer/data";
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

// -------- Post Stats (meta bar) --------

const STAT_OPTIONS = ["date", "author", "category", "reading", "views", "comments"] as const;

/** Pozycje, które `PostStatsView` rysuje, gdy lista jest pusta albo jej nie ma. */
const DEFAULT_STATS = ["date", "author", "reading"];

export function PostStatsBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const fx = (k: string) => i18n.editor("foxizExtra", k);
  // Renderer czyta wyłącznie napisy, a PUSTĄ listę zamienia na domyślne
  // trzy pozycje - panel pokazuje dokładnie ten sam zestaw.
  const stored = strList(block.data, "items");
  const items = stored.length > 0 ? stored : DEFAULT_STATS;
  const separator = str(block.data, "separator", "•");

  const toggle = (n: string) => {
    const has = items.includes(n);
    const next = has ? items.filter((x) => x !== n) : [...items, n];
    // Pusta lista na stronie znaczy „pokaż domyślne" - zapis `[]` dawałby
    // w panelu pusty pasek, a na stronie trzy pozycje. Ostatnia zostaje.
    if (next.length === 0) return;
    onChange({ ...block, data: { ...block.data, items: next } });
  };

  return (
    <Shell label={fx("postStatsLabel")}>
      <div className="flex flex-wrap gap-1.5">
        {STAT_OPTIONS.map((n) => {
          const active = items.includes(n);
          return (
            <button
              key={n}
              type="button"
              aria-pressed={active}
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
      <input
        className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
        value={separator}
        placeholder={fx("separatorPh")}
        onChange={(e) => onChange({ ...block, data: { ...block.data, separator: e.target.value } })}
      />
    </Shell>
  );
}

// -------- Post Rating (reader rating) --------

export function PostRatingBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const fx = (k: string) => i18n.editor("foxizExtra", k);
  const max = num(block.data, "max", 5);
  const label = str(block.data, "label");
  return (
    <Shell label={fx("postRatingLabel")}>
      <div className="grid grid-cols-2 gap-2">
        <AdminSelect
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={max}
          onChange={(e) =>
            onChange({ ...block, data: { ...block.data, max: Number(e.target.value) } })
          }
        >
          <option value={5}>{fx("stars5")}</option>
          <option value={10}>{fx("stars10")}</option>
        </AdminSelect>
        <input
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={label}
          placeholder={fx("labelPh")}
          onChange={(e) => onChange({ ...block, data: { ...block.data, label: e.target.value } })}
        />
      </div>
    </Shell>
  );
}

// -------- LoginOut --------

export function LoginOutBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const fx = (k: string) => i18n.editor("foxizExtra", k);
  const loginHref = str(block.data, "loginHref", "/auth");
  const showAvatar = bool(block.data, "showAvatar", true);
  return (
    <Shell label={fx("loginOutLabel")}>
      <input
        className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
        value={loginHref}
        placeholder={fx("loginHrefPh")}
        onChange={(e) => onChange({ ...block, data: { ...block.data, loginHref: e.target.value } })}
      />
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={showAvatar}
          onChange={(e) =>
            onChange({ ...block, data: { ...block.data, showAvatar: e.target.checked } })
          }
        />
        {fx("showAvatar")}
      </label>
    </Shell>
  );
}

// -------- More Posts promo --------

/** `MorePostsView` pokazuje najwyżej tyle wpisów (`Math.min(Math.max(limit, 2), 12)`). */
const MORE_POSTS_MAX = 12;
const MORE_POSTS_STRATEGIES = ["latest", "trending", "category"] as const;

export function MorePostsBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const fx = (k: string) => i18n.editor("foxizExtra", k);
  // Górna granica w odczycie i w zapisie; dolnej (2) nie wymuszamy w trakcie
  // pisania - „1" to stan przejściowy w drodze do „10".
  const limit = Math.min(MORE_POSTS_MAX, num(block.data, "limit", 4));
  const heading = str(block.data, "heading");
  const strategy =
    MORE_POSTS_STRATEGIES.find((s) => s === block.data.strategy) ?? MORE_POSTS_STRATEGIES[0];
  return (
    <Shell label={fx("morePostsLabel")}>
      <div className="grid grid-cols-2 gap-2">
        <input
          type="number"
          min={2}
          max={MORE_POSTS_MAX}
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={limit}
          onChange={(e) =>
            onChange({
              ...block,
              data: { ...block.data, limit: Math.min(MORE_POSTS_MAX, Number(e.target.value) || 4) },
            })
          }
        />
        <AdminSelect
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={strategy}
          onChange={(e) =>
            onChange({ ...block, data: { ...block.data, strategy: e.target.value } })
          }
        >
          <option value="latest">{fx("stratLatest")}</option>
          <option value="trending">{fx("stratTrending")}</option>
          <option value="category">{fx("stratCategory")}</option>
        </AdminSelect>
      </div>
      <input
        className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
        value={heading}
        placeholder={fx("headingPh")}
        onChange={(e) => onChange({ ...block, data: { ...block.data, heading: e.target.value } })}
      />
    </Shell>
  );
}
