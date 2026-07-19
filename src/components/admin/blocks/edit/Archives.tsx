import type { Block } from "@/lib/blocks/types";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import { AdminSelect } from "../AdminSelect";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

/** Archiwa miesięczne (Gutenberg "Archives"). */
export function ArchivesBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const ab = (k: string) => i18n.editor("archives", k);
  const showCount = Boolean(block.data.showCount);
  const layout = String(block.data.layout ?? "list");
  return (
    <div className="rounded-lg border border-dashed border-border p-3 space-y-2 bg-muted/20">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {ab("title")}
      </div>
      <AdminSelect
        className="text-xs bg-background border border-border rounded px-2 py-2 h-9 w-full"
        value={layout}
        onChange={(e) => onChange({ ...block, data: { ...block.data, layout: e.target.value } })}
      >
        <option value="list">{ab("layoutList")}</option>
        <option value="dropdown">{ab("layoutDropdown")}</option>
      </AdminSelect>
      <label className="flex items-center gap-1 text-xs">
        <input
          type="checkbox"
          checked={showCount}
          onChange={(e) =>
            onChange({ ...block, data: { ...block.data, showCount: e.target.checked } })
          }
        />
        {ab("showCount")}
      </label>
    </div>
  );
}
