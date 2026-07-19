// Atom: 3x3 anchor picker for "self position" inside a column cell.
// Combines selfJustify (X) and selfAlign (Y). Includes a separate stretch toggle.
import { useTranslation } from "react-i18next";
import type { CommonStyle } from "@/lib/builder/types";
import "@/lib/i18n-builder";

type J = NonNullable<CommonStyle["selfJustify"]>;
type A = NonNullable<CommonStyle["selfAlign"]>;

interface Props {
  justify: J | undefined;
  align: A | undefined;
  onChange: (next: { justify?: J; align?: A }) => void;
}

export function PositionAnchor({ justify, align, onChange }: Props) {
  const { t } = useTranslation();
  const COLS: Array<{ v: J; label: string }> = [
    { v: "start", label: t("builder.position.colL") },
    { v: "center", label: t("builder.position.colC") },
    { v: "end", label: t("builder.position.colR") },
  ];
  const ROWS: Array<{ v: A; label: string }> = [
    { v: "start", label: t("builder.common.top") },
    { v: "center", label: t("builder.common.center") },
    { v: "end", label: t("builder.common.bottom") },
  ];
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
                title={`${row.label} • ${col.v === "start" ? t("builder.common.left") : col.v === "end" ? t("builder.common.right") : t("builder.common.center")}`}
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
          {t("builder.position.default")}
        </button>
        <span className="text-[10px] text-muted-foreground">•</span>
        <label className="flex items-center gap-1 text-[10px]">
          <input
            type="checkbox"
            checked={stretched}
            onChange={(e) => onChange({ justify, align: e.target.checked ? "stretch" : "auto" })}
          />
          {t("builder.position.stretchV")}
        </label>
      </div>
    </div>
  );
}
