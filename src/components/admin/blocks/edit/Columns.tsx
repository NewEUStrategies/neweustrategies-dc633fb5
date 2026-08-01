// Dwie kolumny z PEŁNĄ edycją dzieci ("Etap 1b: nested editor") - każda
// kolumna to mini-kanwa z tym samym dyspozytorem edytorów co top-level.
// Kształt danych ({left, right}) pozostaje zgodny z rendererem publicznym.
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import type { Block } from "@/lib/blocks/types";
import { readChildBlocks, withChildBlocks } from "@/lib/blocks/nested";
import { NestedBlocksEditor } from "../molecules/NestedBlocksEditor";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

type Side = "left" | "right";

export function ColumnsBlock({ block, onChange }: Props) {
  const bt = useBlocksI18n();
  const sides: Side[] = ["left", "right"];
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      {sides.map((side) => (
        <div key={side} className="rounded-md border border-dashed border-border p-2 min-h-[80px]">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            {bt.editor("columns", side)}
          </p>
          <NestedBlocksEditor
            blocks={readChildBlocks(block.data, side)}
            onChange={(next) => onChange(withChildBlocks(block, side, next))}
            emptyLabel={bt.editor("columns", "emptyColumn")}
          />
        </div>
      ))}
    </div>
  );
}
