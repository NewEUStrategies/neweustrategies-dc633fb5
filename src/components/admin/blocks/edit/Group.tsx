import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import type { Block } from "@/lib/blocks/types";
import { Input } from "@/components/ui/input";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

/** Kontener (Group/Row/Stack/Grid). Layout dispatch przez block.data.layout. */
export function GroupBlock({ block, onChange }: Props) {
  const bt = useBlocksI18n();
  const layout = (block.data.layout as string) || "group";
  const bg = String(block.data.background ?? "");
  const padding = Number(block.data.padding ?? 16);
  const childCount = Array.isArray(block.data.children) ? block.data.children.length : 0;

  return (
    <div className="rounded-lg border border-dashed border-border p-3 space-y-2 bg-muted/20">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium uppercase tracking-wide text-muted-foreground">{layout}</span>
        <span className="text-muted-foreground">
          {bt.editor("group", "childCount", { count: childCount })}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input
          value={bg}
          placeholder={bt.editor("group", "background")}
          onChange={(e) =>
            onChange({ ...block, data: { ...block.data, background: e.target.value } })
          }
        />
        <Input
          type="number"
          min={0}
          max={120}
          value={padding}
          placeholder={bt.editor("group", "padding")}
          onChange={(e) =>
            onChange({ ...block, data: { ...block.data, padding: Number(e.target.value || 0) } })
          }
        />
      </div>
      <p className="text-xs text-muted-foreground italic">{bt.editor("group", "nestedHint")}</p>
    </div>
  );
}
