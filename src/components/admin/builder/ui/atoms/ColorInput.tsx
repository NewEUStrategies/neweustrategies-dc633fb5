// Atom: hex color picker + free text input combo, with transparency toggle.
import { Input } from "@/components/ui/input";

const isTransparent = (v?: string) => {
  if (!v) return false;
  const t = v.trim().toLowerCase();
  return t === "transparent" || t === "rgba(0,0,0,0)" || t === "#00000000";
};

export function ColorInput({
  value,
  onChange,
  placeholder,
}: {
  value?: string;
  onChange: (v: string | undefined) => void;
  placeholder?: string;
}) {
  const transparent = isTransparent(value);
  return (
    <div className="flex gap-2">
      <input
        type="color"
        value={value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
        onChange={(e) => onChange(e.target.value)}
        disabled={transparent}
        className="h-8 w-10 rounded border border-border bg-background cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      />
      <Input
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        placeholder={placeholder ?? "#000 / rgba(...) / transparent / var(--brand)"}
        className="h-8 text-xs flex-1"
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
    </div>
  );
}
