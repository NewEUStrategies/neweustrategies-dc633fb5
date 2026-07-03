// Atom: 3x3 anchor picker for "self position" inside a column cell.
// Combines selfJustify (X) and selfAlign (Y). Includes a separate stretch toggle.
import type { CommonStyle } from "@/lib/builder/types";

type J = NonNullable<CommonStyle["selfJustify"]>;
type A = NonNullable<CommonStyle["selfAlign"]>;

interface Props {
  justify: J | undefined;
  align: A | undefined;
  onChange: (next: { justify?: J; align?: A }) => void;
}

const COLS: Array<{ v: J; label: string }> = [
  { v: "start", label: "L" },
  { v: "center", label: "Ś" },
  { v: "end", label: "P" },
];
const ROWS: Array<{ v: A; label: string }> = [
  { v: "start", label: "Góra" },
  { v: "center", label: "Środek" },
  { v: "end", label: "Dół" },
];

export function PositionAnchor({ justify, align, onChange }: Props) {
  const j = justify ?? "auto";
  const a = align ?? "auto";
  const stretched = a === "stretch";

  return (
    <div className="space-y-2">
      <div className="inline-grid grid-cols-3 gap-1 p-1 rounded border border-border bg-muted/30">
        {ROWS.map((row) =>
          COLS.map((col) => {
            const active = j === col.v && a === row.v;
            return (
              <button
                key={`${row.v}-${col.v}`}
                type="button"
                onClick={() => onChange({ justify: col.v, align: row.v })}
                className={`w-7 h-7 rounded text-[10px] flex items-center justify-center transition ${
                  active
                    ? "bg-brand text-brand-foreground"
                    : "bg-background text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
                title={`${row.label} • ${col.label === "L" ? "Lewo" : col.label === "P" ? "Prawo" : "Środek"}`}
              >
                ●
              </button>
            );
          }),
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange({ justify: undefined, align: undefined })}
          className="text-[10px] underline text-muted-foreground hover:text-foreground"
        >
          Domyślnie
        </button>
        <span className="text-[10px] text-muted-foreground">•</span>
        <label className="flex items-center gap-1 text-[10px]">
          <input
            type="checkbox"
            checked={stretched}
            onChange={(e) => onChange({ justify, align: e.target.checked ? "stretch" : "auto" })}
          />
          Rozciągnij pionowo
        </label>
      </div>
    </div>
  );
}
