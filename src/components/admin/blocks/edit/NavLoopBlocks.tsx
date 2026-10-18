// Admin edytory dla bloków Phase 2 batch 5: navigation, post-navigation-link, query-loop.
// Odczyt `block.data` idzie przez TE SAME czytniki, co renderer publiczny
// (`components/blocks/renderer/data.ts`) - panel pokazuje to, co narysuje strona.
import type { Block, Json } from "@/lib/blocks/types";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import { num, str } from "@/components/blocks/renderer/data";
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

export function NavigationBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const nl = (k: string) => i18n.editor("navLoop", k);
  const menuKey = str(block.data, "menuKey", "primary");
  const layout = str(block.data, "layout") === "vertical" ? "vertical" : "horizontal";
  return (
    <Shell label={nl("navLabel")}>
      <div className="grid grid-cols-2 gap-2">
        <input
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={menuKey}
          placeholder={nl("menuKeyPh")}
          onChange={(e) => onChange({ ...block, data: { ...block.data, menuKey: e.target.value } })}
        />
        <AdminSelect
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={layout}
          onChange={(e) => onChange({ ...block, data: { ...block.data, layout: e.target.value } })}
        >
          <option value="horizontal">{nl("horizontal")}</option>
          <option value="vertical">{nl("vertical")}</option>
        </AdminSelect>
      </div>
    </Shell>
  );
}

export function PostNavigationLinkBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const nl = (k: string) => i18n.editor("navLoop", k);
  // Jak `renderPostNavigationLink`: wszystko poza „prev" to „next". Natywna
  // lista z wartością spoza opcji pokazałaby pierwszą - czyli „Poprzedni".
  const direction = str(block.data, "direction", "next") === "prev" ? "prev" : "next";
  const showTitle = block.data.showTitle !== false;
  return (
    <Shell label={nl("postNavLabel")}>
      <div className="grid grid-cols-2 gap-2 items-center">
        <AdminSelect
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={direction}
          onChange={(e) =>
            onChange({ ...block, data: { ...block.data, direction: e.target.value } })
          }
        >
          <option value="prev">{nl("prev")}</option>
          <option value="next">{nl("next")}</option>
        </AdminSelect>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={showTitle}
            onChange={(e) =>
              onChange({ ...block, data: { ...block.data, showTitle: e.target.checked } })
            }
          />
          {nl("showTitle")}
        </label>
      </div>
    </Shell>
  );
}

/** Zakres, do którego `queryLoopBlockQueryOptions` ścina liczbę wpisów. */
const LOOP_MIN = 1;
const LOOP_MAX = 24;
const clampLoop = (n: number) => Math.min(LOOP_MAX, Math.max(LOOP_MIN, n));

export function QueryLoopBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const nl = (k: string) => i18n.editor("navLoop", k);
  const d = block.data;
  const set = (patch: Record<string, Json>) => onChange({ ...block, data: { ...d, ...patch } });
  return (
    <Shell label={nl("queryLoopLabel")}>
      <div className="grid grid-cols-2 gap-2">
        <input
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={str(d, "categorySlug")}
          placeholder={nl("categoryPh")}
          onChange={(e) => set({ categorySlug: e.target.value })}
        />
        <input
          type="number"
          min={LOOP_MIN}
          max={LOOP_MAX}
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={clampLoop(num(d, "limit", 6))}
          onChange={(e) => set({ limit: clampLoop(Number(e.target.value) || 6) })}
        />
        <AdminSelect
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={str(d, "layout") === "list" ? "list" : "grid"}
          onChange={(e) => set({ layout: e.target.value })}
        >
          <option value="grid">{nl("layoutGrid")}</option>
          <option value="list">{nl("layoutList")}</option>
        </AdminSelect>
        <AdminSelect
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={str(d, "orderBy") === "title" ? "title" : "date"}
          onChange={(e) => set({ orderBy: e.target.value })}
        >
          <option value="date">{nl("orderDate")}</option>
          <option value="title">{nl("orderTitle")}</option>
        </AdminSelect>
      </div>
      <div className="flex flex-wrap gap-3 pt-1">
        {(["showImage", "showExcerpt", "showDate"] as const).map((k) => (
          <label key={k} className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={d[k] !== false}
              onChange={(e) => set({ [k]: e.target.checked })}
            />
            {k === "showImage"
              ? nl("showImage")
              : k === "showExcerpt"
                ? nl("showExcerpt")
                : nl("showDate")}
          </label>
        ))}
      </div>
    </Shell>
  );
}
