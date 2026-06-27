import type { Block } from "@/lib/blocks/types";
import { useBlocksI18n } from "@/lib/blocks/i18n";

interface Props { block: Block; onChange: (next: Block) => void; }

export function SpacerBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const height = Number(block.data.height ?? 40);
  return (
    <div className="group relative">
      <div
        className="w-full bg-muted/40 border border-dashed border-border rounded transition-colors group-hover:bg-muted/60"
        style={{ height }}
      />
      <div className="flex items-center gap-2 mt-1 text-xs">
        <label className="text-muted-foreground">{i18n.editor("spacer","heightLabel")}</label>
        <input
          type="range"
          min={8}
          max={400}
          value={height}
          onChange={(e) => onChange({ ...block, data: { ...block.data, height: Number(e.target.value) } })}
          className="flex-1"
        />
        <span className="font-mono w-12 text-right">{height}px</span>
      </div>
    </div>
  );
}
