import type { Block } from "@/lib/blocks/types";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import { readDecimal } from "./dataVizShared";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

/** Zakres suwaka - etykieta i podgląd pokazują wartość, którą suwak umie przedstawić. */
const HEIGHT_MIN = 8;
const HEIGHT_MAX = 400;
const HEIGHT_DEFAULT = 40;

export function SpacerBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const label = i18n.editor("spacer", "heightLabel");
  // Wysokość spoza liczb (np. „wysoko") to wartość domyślna, a liczba spoza
  // zakresu - najbliższy kraniec suwaka. Wcześniej `Number("wysoko")` dawało
  // `NaN` i w podglądzie (element bez wysokości), i w etykiecie („NaNpx"),
  // a suwak stał w pozycji domyślnej przeglądarki - dwie różne wartości tego
  // samego pola naraz.
  const height = Math.min(
    HEIGHT_MAX,
    Math.max(HEIGHT_MIN, readDecimal(block.data.height) ?? HEIGHT_DEFAULT),
  );
  return (
    <div className="group relative">
      <div
        className="w-full bg-muted/40 border border-dashed border-border rounded transition-colors group-hover:bg-muted/60"
        style={{ height }}
      />
      <div className="flex items-center gap-2 mt-1 text-xs">
        <label className="text-muted-foreground">{label}</label>
        <input
          type="range"
          aria-label={label}
          min={HEIGHT_MIN}
          max={HEIGHT_MAX}
          value={height}
          onChange={(e) =>
            onChange({ ...block, data: { ...block.data, height: Number(e.target.value) } })
          }
          className="flex-1"
        />
        <span className="font-mono w-12 text-right">{height}px</span>
      </div>
    </div>
  );
}
