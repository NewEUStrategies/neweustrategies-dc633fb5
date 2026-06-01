// Atom: native color picker + free-text input that accepts hex, css vars, oklch.
// Supports a "transparent" toggle that clears the value to `transparent`.
import { Input } from "@/components/ui/input";

interface Props {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  placeholder?: string;
}

const isHex = (v: string): v is `#${string}` => /^#[0-9a-fA-F]{3,8}$/.test(v);
const isTransparent = (v: string) =>
  v.trim().toLowerCase() === "transparent" || v.trim() === "rgba(0,0,0,0)" || v.trim() === "#00000000";

export function ColorField({ value, onChange, placeholder }: Props) {
  const v = value ?? "";
  const transparent = isTransparent(v);
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="color"
        value={isHex(v) ? v.slice(0, 7) : "#000000"}
        onChange={(e) => onChange(e.target.value)}
        disabled={transparent}
        className="h-8 w-8 rounded border border-border bg-transparent cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label="Wybierz kolor"
      />
      <Input
        value={v}
        placeholder={placeholder ?? "#000 / var(--brand) / transparent"}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="h-8 text-xs"
      />
      <button
        type="button"
        onClick={() => onChange(transparent ? undefined : "transparent")}
        aria-pressed={transparent}
        title={transparent ? "Wyłącz przezroczystość" : "Ustaw przezroczyste"}
        className={`h-8 w-8 shrink-0 rounded border text-[10px] font-medium transition ${
          transparent
            ? "bg-brand text-brand-foreground border-brand"
            : "border-border text-muted-foreground hover:bg-muted"
        }`}
        style={
          transparent
            ? undefined
            : {
                // szachownica jako podgląd "transparent"
                backgroundImage:
                  "linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)",
                backgroundSize: "8px 8px",
                backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0",
              }
        }
      >
        {transparent ? "✓" : ""}
      </button>
    </div>
  );
}

