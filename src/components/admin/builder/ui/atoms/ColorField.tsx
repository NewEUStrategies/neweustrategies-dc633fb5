// Atom: native color picker + free-text input that accepts hex, css vars, oklch.
// Supports a "transparent" toggle that clears the value to `transparent`.
// When `value` is empty, displays the `inheritedValue` (resolved from global colors)
// as a ghost swatch + placeholder so the user can see what color is actually applied.
import { Input } from "@/components/ui/input";
import { RotateCcw } from "@/lib/lucide-shim";

interface Props {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  placeholder?: string;
  /** Color actually applied when no override is set (resolved from global colors / cascade). */
  inheritedValue?: string;
}

const isHex = (v: string): v is `#${string}` => /^#[0-9a-fA-F]{3,8}$/.test(v);
const isTransparent = (v: string) =>
  v.trim().toLowerCase() === "transparent" ||
  v.trim() === "rgba(0,0,0,0)" ||
  v.trim() === "#00000000";

export function ColorField({ value, onChange, placeholder, inheritedValue }: Props) {
  const v = value ?? "";
  const transparent = isTransparent(v);
  const hasOverride = v.length > 0;
  const inherited = (inheritedValue ?? "").trim();
  const showInherited = !hasOverride && inherited.length > 0 && !isTransparent(inherited);

  // Swatch background: explicit value if set, else inherited preview.
  const swatchHex = isHex(v) ? v.slice(0, 7) : "#000000";

  const placeholderText = showInherited
    ? `dziedziczy: ${inherited}`
    : (placeholder ?? "#000 / var(--brand) / transparent");

  return (
    <div className="flex items-center gap-1.5">
      {showInherited && !hasOverride ? (
        // Ghost swatch showing the inherited color - click opens picker to override.
        <label
          className="relative h-8 w-8 rounded border border-dashed border-border cursor-pointer shrink-0 overflow-hidden"
          style={{ background: inherited }}
          title={`Dziedziczy z global colors: ${inherited}`}
        >
          <input
            type="color"
            value={isHex(inherited) ? inherited.slice(0, 7) : "#000000"}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer"
            aria-label="Nadpisz kolor"
          />
        </label>
      ) : (
        <input
          type="color"
          value={swatchHex}
          onChange={(e) => onChange(e.target.value)}
          disabled={transparent}
          className="h-8 w-8 rounded border border-border bg-transparent cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Wybierz kolor"
        />
      )}
      <Input
        value={v}
        placeholder={placeholderText}
        onChange={(e) => onChange(e.target.value || undefined)}
        className={`h-8 text-xs ${showInherited ? "placeholder:text-foreground/70 placeholder:italic" : ""}`}
      />
      <button
        type="button"
        onClick={() => onChange(transparent ? undefined : "transparent")}
        aria-pressed={transparent}
        title={transparent ? "Wyłącz przezroczystość" : "Ustaw przezroczyste"}
        className={`h-8 w-8 shrink-0 rounded border text-[10px] font-medium transition ${
          transparent ? "" : "border-border text-muted-foreground hover:bg-muted"
        }`}
        style={
          transparent
            ? {
                background: "var(--gc-highlight, var(--brand))",
                color: "var(--gc-highlight-foreground, var(--brand-foreground, #fff))",
                borderColor: "var(--gc-highlight, var(--brand))",
              }
            : {
                backgroundImage:
                  "linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)",
                backgroundSize: "8px 8px",
                backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0",
              }
        }
      >
        {transparent ? "✓" : ""}
      </button>
      <button
        type="button"
        onClick={() => onChange(undefined)}
        disabled={!hasOverride}
        title="Przywróć domyślny / Reset to default"
        aria-label="Przywróć domyślny"
        className="h-8 w-8 shrink-0 rounded border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
