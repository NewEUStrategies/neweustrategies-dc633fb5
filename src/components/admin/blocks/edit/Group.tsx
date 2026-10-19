// Kontener (Group/Row/Stack/Grid) z PEŁNĄ edycją dzieci w kanwie
// ("Etap 1b: nested editor"). Dzieci żyją w data.children w kształcie
// zgodnym z rendererem publicznym (renderGroup/renderRowStackGrid).
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import type { Block } from "@/lib/blocks/types";
import { readChildBlocks, withChildBlocks } from "@/lib/blocks/nested";
import { Input } from "@/components/ui/input";
import { num, str } from "@/components/blocks/renderer/data";
import { NestedBlocksEditor } from "../molecules/NestedBlocksEditor";
import { readText } from "./dataVizShared";

/** Odstęp w granicach renderera kontenera (`renderGroup`/`renderRowStackGrid`). */
function clampPadding(n: number): number {
  return Math.min(120, Math.max(0, n));
}

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

/** Kontener (Group/Row/Stack/Grid). Layout dispatch przez block.data.layout. */
export function GroupBlock({ block, onChange }: Props) {
  const bt = useBlocksI18n();
  // `str`, nie rzutowanie: układ-obiekt w danych wywracał kanwę jako dziecko Reacta.
  const layout = str(block.data, "layout") || block.type;
  const bg = readText(block.data.background);
  // Domyślne jak na stronie: `group` ma 16 px, a `row`/`stack`/`grid` - zero.
  const padding = clampPadding(num(block.data, "padding", block.type === "group" ? 16 : 0));
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
            onChange({
              ...block,
              data: { ...block.data, padding: clampPadding(Number(e.target.value || 0)) },
            })
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
