// Molecule: design-system color picker.
// Wraps native <input type="color"> in a popover trigger styled with our
// tokens. Shows swatch preview, hex value, presets from the theme accent
// palette, and a clear button. Emits raw hex (#rrggbb) or undefined.
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Pipette, X } from "lucide-react";

interface Props {
  value?: string;
  onChange: (color: string | undefined) => void;
  presets?: string[];
  ariaLabel?: string;
  className?: string;
  allowClear?: boolean;
  /** Optional inline text input for freeform value (hex or var(--token)). */
  showInput?: boolean;
  placeholder?: string;
}

const DEFAULT_PRESETS = [
  "#0f172a",
  "#334155",
  "#64748b",
  "#94a3b8",
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#84cc16",
  "#22c55e",
  "#10b981",
  "#14b8a6",
  "#06b6d4",
  "#0ea5e9",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#d946ef",
  "#ec4899",
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function ColorPicker({
  value,
  onChange,
  presets = DEFAULT_PRESETS,
  ariaLabel = "Wybierz kolor",
  className,
  allowClear = true,
  showInput = false,
  placeholder = "np. #f59e42 lub var(--brand)",
}: Props) {
  const [open, setOpen] = useState(false);
  const isHex = HEX_RE.test(value ?? "");
  const swatchStyle = value
    ? { background: value }
    : {
        backgroundImage:
          "conic-gradient(from 45deg, hsl(var(--muted)) 0 25%, hsl(var(--background)) 0 50%, hsl(var(--muted)) 0 75%, hsl(var(--background)) 0)",
        backgroundSize: "10px 10px",
      };

  const inner = (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className="group inline-flex items-center gap-2 h-8 pl-1 pr-2 rounded-md border border-border bg-background hover:bg-accent transition-colors shrink-0"
        >
          <span
            className="h-6 w-6 rounded-[5px] border border-border shadow-sm"
            style={swatchStyle}
          />
          <span className="text-[11px] font-mono text-muted-foreground group-hover:text-foreground transition-colors">
            {value ? (isHex ? value.toUpperCase() : "custom") : "auto"}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3 space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative h-9 w-9 shrink-0 rounded-md border border-border overflow-hidden">
            <input
              type="color"
              value={isHex ? (value as string) : "#f59e42"}
              onChange={(e) => onChange(e.target.value)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              aria-label={ariaLabel}
            />
            <div
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
              style={swatchStyle}
            >
              <Pipette className="h-3.5 w-3.5 text-foreground/70 mix-blend-difference" />
            </div>
          </div>
          <Input
            className="h-9 text-xs font-mono"
            placeholder={placeholder}
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value || undefined)}
          />
        </div>

        <div className="grid grid-cols-10 gap-1.5">
          {presets.map((c) => {
            const active = (value ?? "").toLowerCase() === c.toLowerCase();
            return (
              <button
                key={c}
                type="button"
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
                aria-label={c}
                title={c}
                className={
                  "h-5 w-5 rounded-full border transition-transform hover:scale-110 " +
                  (active
                    ? "ring-2 ring-ring ring-offset-1 ring-offset-background border-transparent"
                    : "border-border/60")
                }
                style={{ background: c }}
              />
            );
          })}
        </div>

        {allowClear ? (
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => {
                onChange(undefined);
                setOpen(false);
              }}
            >
              <X className="w-3 h-3 mr-1" />
              Wyczyść
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );

  if (!showInput) {
    return <div className={className}>{inner}</div>;
  }
  return (
    <div className={"flex items-center gap-2 w-full " + (className ?? "")}>
      {inner}
      <Input
        className="h-8 text-xs flex-1 font-mono"
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
      />
    </div>
  );
}
