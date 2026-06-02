// Molecule: padding + margin (per-side, responsive) + align (responsive).
// Internal device tabs let the user edit desktop / tablet / mobile values
// from one place; the `device` prop is just the initial active tab.
import { useState } from "react";
import { Monitor, Tablet, Smartphone } from "lucide-react";
import type { Align, CommonStyle, Device, ResponsiveValue } from "@/lib/builder/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { PropField } from "../atoms/PropField";

interface Props {
  style: CommonStyle | undefined;
  device: Device;
  onChange: (mut: (s: CommonStyle) => void) => void;
}

type Sides = { top: string; right: string; bottom: string; left: string };

// Parse CSS shorthand "16px 24px 8px 4px" into 4 sides.
function parseSides(input: string | undefined): Sides {
  const empty = { top: "", right: "", bottom: "", left: "" };
  if (!input) return empty;
  const parts = input.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return empty;
  if (parts.length === 1) return { top: parts[0], right: parts[0], bottom: parts[0], left: parts[0] };
  if (parts.length === 2) return { top: parts[0], right: parts[1], bottom: parts[0], left: parts[1] };
  if (parts.length === 3) return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[1] };
  return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] };
}

function sidesToString(s: Sides): string | undefined {
  const { top, right, bottom, left } = s;
  if (!top && !right && !bottom && !left) return undefined;
  const t = top || "0";
  const r = right || "0";
  const b = bottom || "0";
  const l = left || "0";
  if (t === r && r === b && b === l) return t;
  if (t === b && r === l) return `${t} ${r}`;
  if (r === l) return `${t} ${r} ${b}`;
  return `${t} ${r} ${b} ${l}`;
}

function SideInputs({
  value,
  device,
  placeholder,
  onChange,
}: {
  value: ResponsiveValue<string> | undefined;
  device: Device;
  placeholder?: string;
  onChange: (next: ResponsiveValue<string>) => void;
}) {
  const cur = value?.[device];
  const sides = parseSides(cur);

  const set = (key: keyof Sides, v: string) => {
    const next = { ...sides, [key]: v };
    const str = sidesToString(next);
    onChange({ ...(value ?? {}), [device]: str });
  };

  const inputs: Array<{ key: keyof Sides; label: string }> = [
    { key: "top", label: "Góra" },
    { key: "right", label: "Prawo" },
    { key: "bottom", label: "Dół" },
    { key: "left", label: "Lewo" },
  ];

  return (
    <div className="grid grid-cols-4 gap-1.5">
      {inputs.map((s) => (
        <div key={s.key} className="space-y-1">
          <div className="text-[10px] text-muted-foreground text-center">{s.label}</div>
          <Input
            value={sides[s.key]}
            placeholder={placeholder}
            className="h-8 text-xs text-center px-1"
            onChange={(e) => set(s.key, e.target.value)}
          />
        </div>
      ))}
    </div>
  );
}

export function SpacingControl({ style, device, onChange }: Props) {
  const [activeDevice, setActiveDevice] = useState<Device>(device);

  const devices: Array<{ v: Device; Icon: typeof Monitor; label: string }> = [
    { v: "desktop", Icon: Monitor, label: "Desktop" },
    { v: "tablet", Icon: Tablet, label: "Tablet" },
    { v: "mobile", Icon: Smartphone, label: "Mobile" },
  ];

  return (
    <div className="space-y-3">
      <div className="inline-flex rounded border border-border bg-muted/30 p-0.5 w-full">
        {devices.map(({ v, Icon, label }) => {
          const active = activeDevice === v;
          return (
            <button
              key={v}
              type="button"
              title={label}
              onClick={() => setActiveDevice(v)}
              className={`flex-1 inline-flex items-center justify-center gap-1 h-7 text-[11px] rounded transition ${
                active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      <PropField label={`Padding — wewnętrzne odstępy (${activeDevice})`}>
        <SideInputs
          value={style?.padding}
          device={activeDevice}
          placeholder="0"
          onChange={(padding) => onChange((s) => { s.padding = padding; })}
        />
      </PropField>
      <PropField label={`Margin — zewnętrzne odstępy (${activeDevice})`}>
        <SideInputs
          value={style?.margin}
          device={activeDevice}
          placeholder="0"
          onChange={(margin) => onChange((s) => { s.margin = margin; })}
        />
      </PropField>
      <PropField label={`Wyrównanie (${activeDevice})`}>
        <Select
          value={style?.align?.[activeDevice] ?? "left"}
          onValueChange={(v) => onChange((s) => {
            s.align = { ...(s.align ?? {}), [activeDevice]: v as Align };
          })}
        >
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="left">Lewo</SelectItem>
            <SelectItem value="center">Środek</SelectItem>
            <SelectItem value="right">Prawo</SelectItem>
          </SelectContent>
        </Select>
      </PropField>
    </div>
  );
}
