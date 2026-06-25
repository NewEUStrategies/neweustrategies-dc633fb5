// Visual structure picker - shows Elementor-like column-layout thumbnails.
// Each variant renders a small preview of the column proportions, click to insert.
import { Plus } from "@/lib/lucide-shim";

export type Structure = { spans: number[]; label: string };

export const STRUCTURES: Structure[] = [
  { spans: [12],              label: "1 kolumna" },
  { spans: [6, 6],            label: "1/2 · 1/2" },
  { spans: [4, 8],            label: "1/3 · 2/3" },
  { spans: [8, 4],            label: "2/3 · 1/3" },
  { spans: [3, 9],            label: "1/4 · 3/4" },
  { spans: [9, 3],            label: "3/4 · 1/4" },
  { spans: [4, 4, 4],         label: "1/3 × 3" },
  { spans: [3, 6, 3],         label: "1/4 · 1/2 · 1/4" },
  { spans: [6, 3, 3],         label: "1/2 · 1/4 · 1/4" },
  { spans: [3, 3, 6],         label: "1/4 · 1/4 · 1/2" },
  { spans: [3, 3, 3, 3],      label: "1/4 × 4" },
  { spans: [6, 2, 2, 2],      label: "1/2 + 1/6 × 3" },
  { spans: [2, 2, 2, 6],      label: "1/6 × 3 + 1/2" },
  { spans: [1, 1, 1, 1, 1],   label: "1/5 × 5" },
];

interface Props {
  onPick: (spans: number[]) => void;
  /** Compact size for inline drop zones. Default false = full size. */
  compact?: boolean;
  /** grid columns count (default 4) */
  cols?: number;
}

export function StructurePicker({ onPick, compact = false, cols = 4 }: Props) {
  const h = compact ? "h-12" : "h-16";
  const gap = compact ? "gap-[2px]" : "gap-1";
  return (
    <div
      className={`grid gap-2`}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {STRUCTURES.map((s, i) => {
        const total = s.spans.reduce((a, b) => a + b, 0);
        return (
          <button
            key={i}
            type="button"
            onClick={() => onPick(s.spans)}
            title={`Wstaw sekcję: ${s.label}`}
            className={`relative ${h} bg-muted/30 hover:bg-muted hover:border-brand border border-border rounded flex flex-col items-stretch justify-stretch p-1.5 transition group`}
          >
            <div className={`flex-1 flex ${gap} items-stretch`}>
              {s.spans.map((sp, j) => (
                <div
                  key={j}
                  style={{ flexBasis: `${(sp / total) * 100}%` }}
                  className="bg-muted-foreground/25 group-hover:bg-brand/60 rounded-[2px] transition"
                />
              ))}
            </div>
            <div className="mt-1 text-[9px] leading-tight text-muted-foreground group-hover:text-brand truncate">
              {s.label}
            </div>
            <Plus className="absolute top-0.5 right-0.5 w-2.5 h-2.5 opacity-0 group-hover:opacity-100 text-brand" />
          </button>
        );
      })}
    </div>
  );
}
