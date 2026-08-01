// Kontener (Group/Row/Stack/Grid) z PEŁNĄ edycją dzieci w kanwie
// ("Etap 1b: nested editor"). Dzieci żyją w data.children w kształcie
// zgodnym z rendererem publicznym (renderGroup/renderRowStackGrid).
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import type { Block } from "@/lib/blocks/types";
import { readChildBlocks, withChildBlocks } from "@/lib/blocks/nested";
import { Input } from "@/components/ui/input";
import { NestedBlocksEditor } from "../molecules/NestedBlocksEditor";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

/** Kontener (Group/Row/Stack/Grid). Layout dispatch przez block.data.layout. */
export function GroupBlock({ block, onChange }: Props) {
  const bt = useBlocksI18n();
  const layout = (block.data.layout as string) || block.type;
  const bg = String(block.data.background ?? "");
  const padding = Number(block.data.padding ?? 16);
  const children = readChildBlocks(block.data, "children");

  return (
    <div className="rounded-lg border border-dashed border-border p-3 space-y-2 bg-muted/20">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium uppercase tracking-wide text-muted-foreground">{layout}</span>
        <span className="text-muted-foreground">
          {bt.editor("group", "childCount", { count: children.length })}
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
      <NestedBlocksEditor
        blocks={children}
        onChange={(next) => onChange(withChildBlocks(block, "children", next))}
      />
    </div>
  );
}
