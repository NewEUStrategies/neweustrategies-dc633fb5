// Unified admin color picker.
// - Popover with saturation/hue picker (react-colorful)
// - HEX shown FIRST, then RGB, then HSL inputs
// - Supports free-text tokens (var(--...), oklch(...), transparent) via passthrough
// - Optional transparency toggle + reset to inherited/default
import { useEffect, useMemo, useState } from "react";
import { HexColorPicker } from "react-colorful";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { RotateCcw } from "@/lib/lucide-shim";
import { cn } from "@/lib/utils";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";

interface AdminColorPickerProps {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  placeholder?: string;
  inheritedValue?: string;
  allowTransparent?: boolean;
  allowReset?: boolean;
  className?: string;
  triggerClassName?: string;
  ariaLabel?: string;
}

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const isHex = (v: string) => HEX_RE.test(v.trim());
const isTransparent = (v?: string) => {
  if (!v) return false;
  const t = v.trim().toLowerCase();
  return t === "transparent" || t === "rgba(0,0,0,0)" || t === "#00000000";
};

function expandHex(hex: string): string {
  const h = hex.replace("#", "");
  if (h.length === 3)
    return (
      "#" +
      h
        .split("")
        .map((c) => c + c)
        .join("")
    );
  if (h.length === 4)
    return (
      "#" +
      h
        .slice(0, 3)
        .split("")
        .map((c) => c + c)
        .join("")
    );
  if (h.length === 8) return "#" + h.slice(0, 6);
  return "#" + h.slice(0, 6);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  if (!isHex(hex)) return null;
  const h = expandHex(hex).slice(1);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255,
    gn = g / 255,
    bn = b / 255;
  const max = Math.max(rn, gn, bn),
    min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0,
    s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
    }
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const sn = s / 100,
    ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = (h % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0,
    g = 0,
    b = 0;
  if (hp >= 0 && hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = ln - c / 2;
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

export function AdminColorPicker({
  value,
  onChange,
  placeholder,
  inheritedValue,
  allowTransparent = true,
  allowReset = true,
  className,
  triggerClassName,
  ariaLabel,
}: AdminColorPickerProps) {
  const i18n = useBlocksI18n();
  const ac = (k: string) => i18n.editor("adminControls", k);
  const v = (value ?? "").trim();
  const transparent = isTransparent(v);
  const hasOverride = v.length > 0;
  const inherited = (inheritedValue ?? "").trim();
  const showInherited = !hasOverride && inherited.length > 0 && !isTransparent(inherited);

  const activeForSwatch = hasOverride ? v : inherited || "#000000";
  const hexForPicker = isHex(activeForSwatch) ? expandHex(activeForSwatch) : "#000000";

  const [open, setOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState<string>(hexForPicker);
  useEffect(() => setHexDraft(hexForPicker), [hexForPicker, open]);

  const rgb = useMemo(() => hexToRgb(hexDraft) ?? { r: 0, g: 0, b: 0 }, [hexDraft]);
  const hsl = useMemo(() => rgbToHsl(rgb.r, rgb.g, rgb.b), [rgb]);

  const commitHex = (h: string) => {
    setHexDraft(h);
    onChange(h);
  };

  const swatchStyle = transparent
    ? {
        backgroundImage:
          "linear-gradient(45deg, color-mix(in oklab, var(--muted-foreground) 35%, transparent) 25%, transparent 25%), linear-gradient(-45deg, color-mix(in oklab, var(--muted-foreground) 35%, transparent) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, color-mix(in oklab, var(--muted-foreground) 35%, transparent) 75%), linear-gradient(-45deg, transparent 75%, color-mix(in oklab, var(--muted-foreground) 35%, transparent) 75%)",
        backgroundSize: "8px 8px",
        backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0",
      }
    : { background: activeForSwatch || "transparent" };

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={ariaLabel ?? ac("pickColor")}
            className={cn(
              "h-8 w-8 shrink-0 rounded-md border border-border overflow-hidden ring-offset-background transition hover:ring-2 hover:ring-ring/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              showInherited && "border-dashed",
              triggerClassName,
            )}
            style={swatchStyle}
          />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[520px] p-0 overflow-hidden rounded-xl border border-border shadow-2xl"
          style={{
            fontFamily: '"Red Hat Display", system-ui, -apple-system, "Segoe UI", sans-serif',
          }}
        >
          <div className="flex">
            {/* LEFT: Canvas + hue slider */}
            <div className="flex-1 p-4 bg-muted/30 border-r border-border">
              <div className="admin-color-picker-canvas admin-color-picker-canvas--lg">
                <HexColorPicker color={hexForPicker} onChange={commitHex} />
              </div>
            </div>

            {/* RIGHT: Values + active token */}
            <div className="w-[240px] p-4 flex flex-col gap-3 bg-background">
              {/* Active preview + token */}
              <div className="flex items-center gap-3">
                <div
                  className="h-12 w-12 rounded-lg border border-border shadow-inner shrink-0"
                  style={swatchStyle}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">
                    {ac("activeToken") || "Active"}
                  </div>
                  <div
                    className="px-2 py-1 text-[11px] font-mono rounded border truncate"
                    style={{
                      background: "color-mix(in oklab, var(--primary) 10%, transparent)",
                      color: "var(--primary)",
                      borderColor: "color-mix(in oklab, var(--primary) 25%, transparent)",
                    }}
                    title={hasOverride ? v : inherited || hexForPicker}
                  >
                    {hasOverride ? v : inherited || hexForPicker}
                  </div>
                </div>
              </div>

              {/* HEX */}
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  HEX
                </label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                    #
                  </span>
                  <Input
                    value={hexDraft.replace(/^#/, "").toUpperCase()}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/^#/, "");
                      const next = `#${raw}`;
                      setHexDraft(next);
                      if (isHex(next)) onChange(expandHex(next));
                    }}
                    className="h-8 text-xs font-mono uppercase pl-5"
                    spellCheck={false}
                  />
                </div>
              </div>

              {/* RGB */}
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  RGB
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {(["r", "g", "b"] as const).map((k) => (
                    <div key={k} className="flex flex-col items-center gap-0.5">
                      <Input
                        type="number"
                        min={0}
                        max={255}
                        value={rgb[k]}
                        onChange={(e) => {
                          const n = Math.max(0, Math.min(255, Number(e.target.value) || 0));
                          const next = { ...rgb, [k]: n };
                          commitHex(rgbToHex(next.r, next.g, next.b));
                        }}
                        className="h-7 text-[11px] text-center font-mono px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <span className="text-[9px] font-semibold uppercase text-muted-foreground">
                        {k}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* HSL */}
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  HSL
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {(["h", "s", "l"] as const).map((k) => (
                    <div key={k} className="flex flex-col items-center gap-0.5">
                      <Input
                        type="number"
                        min={0}
                        max={k === "h" ? 360 : 100}
                        value={hsl[k]}
                        onChange={(e) => {
                          const n = Math.max(
                            0,
                            Math.min(k === "h" ? 360 : 100, Number(e.target.value) || 0),
                          );
                          const next = { ...hsl, [k]: n };
                          const c = hslToRgb(next.h, next.s, next.l);
                          commitHex(rgbToHex(c.r, c.g, c.b));
                        }}
                        className="h-7 text-[11px] text-center font-mono px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <span className="text-[9px] font-semibold uppercase text-muted-foreground">
                        {k}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {allowReset && showInherited ? (
                <button
                  type="button"
                  onClick={() => onChange(undefined)}
                  className="mt-auto w-full h-8 flex items-center justify-center gap-1.5 text-[11px] font-medium text-muted-foreground border border-border rounded-md bg-muted/40 hover:bg-muted transition-colors"
                >
                  <RotateCcw className="h-3 w-3" />
                  {ac("resetInherited") || ac("resetDefault")}
                </button>
              ) : null}
            </div>
          </div>

          {/* FOOTER: brand palette swatches */}
          <div className="border-t border-border bg-background px-3 py-2.5 flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mr-1">
              {ac("brandPalette") || "Paleta"}
            </span>
            {[
              "#FA9346",
              "#F8B632",
              "#FECA62",
              "#63B2F2",
              "#81D365",
              "#F24343",
              "#CD393B",
              "#F8F6F4",
              "#01112F",
              "#141313",
            ].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => commitHex(c)}
                title={c}
                aria-label={c}
                className="h-5 w-5 rounded-full border border-border/70 shadow-sm transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ background: c }}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <Input
        value={v}
        placeholder={
          showInherited
            ? `dziedziczy: ${inherited}`
            : (placeholder ?? "#000 / var(--brand) / transparent")
        }
        onChange={(e) => onChange(e.target.value || undefined)}
        className={cn(
          "h-8 text-xs font-mono",
          showInherited && "placeholder:italic placeholder:text-foreground/70",
        )}
        spellCheck={false}
      />

      {allowTransparent ? (
        <button
          type="button"
          onClick={() => onChange(transparent ? undefined : "transparent")}
          aria-pressed={transparent}
          title={transparent ? ac("disableTransparency") : ac("setTransparent")}
          className={cn(
            "h-8 w-8 shrink-0 rounded-md border text-[10px] font-medium transition",
            transparent ? "" : "border-border text-muted-foreground hover:bg-muted",
          )}
          style={
            transparent
              ? {
                  background: "var(--gc-highlight, var(--primary))",
                  color: "var(--gc-highlight-foreground, var(--primary-foreground))",
                  borderColor: "var(--gc-highlight, var(--primary))",
                }
              : {
                  backgroundImage:
                    "linear-gradient(45deg, color-mix(in oklab, var(--muted-foreground) 35%, transparent) 25%, transparent 25%), linear-gradient(-45deg, color-mix(in oklab, var(--muted-foreground) 35%, transparent) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, color-mix(in oklab, var(--muted-foreground) 35%, transparent) 75%), linear-gradient(-45deg, transparent 75%, color-mix(in oklab, var(--muted-foreground) 35%, transparent) 75%)",
                  backgroundSize: "8px 8px",
                  backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0",
                }
          }
        >
          {transparent ? "✓" : ""}
        </button>
      ) : null}

      {allowReset ? (
        <button
          type="button"
          onClick={() => onChange(undefined)}
          disabled={!hasOverride}
          title={ac("resetDefault")}
          aria-label={ac("resetDefault")}
          className="h-8 w-8 shrink-0 rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}
