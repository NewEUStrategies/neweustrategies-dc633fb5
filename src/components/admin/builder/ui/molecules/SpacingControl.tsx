// Molecule: padding + margin (per-side) + align.
// Wartości są wspólne dla wszystkich urządzeń (desktop / tablet / mobile)
// — zapisujemy je jednocześnie do każdego breakpointa.
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

// Wybierz reprezentatywną wartość (preferuj desktop, potem tablet, potem mobile).
function pickUnified<T>(rv: ResponsiveValue<T> | undefined): T | undefined {
  if (!rv) return undefined;
  return rv.desktop ?? rv.tablet ?? rv.mobile;
}

// Ustaw tę samą wartość dla wszystkich urządzeń.
function setAllDevices<T>(value: T | undefined): ResponsiveValue<T> {
  return { desktop: value, tablet: value, mobile: value };
}

function SideInputs({
  value,
  placeholder,
  onChange,
}: {
  value: ResponsiveValue<string> | undefined;
  placeholder?: string;
  onChange: (next: ResponsiveValue<string>) => void;
}) {
  const cur = pickUnified(value);
  const sides = parseSides(cur);

  const set = (key: keyof Sides, v: string) => {
    const next = { ...sides, [key]: v };
    onChange(setAllDevices(sidesToString(next)));
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

export function SpacingControl({ style, onChange }: Props) {
  const currentAlign = pickUnified(style?.align) ?? "left";

  return (
    <div className="space-y-3">
      <PropField label="Padding — wewnętrzne odstępy">
        <SideInputs
          value={style?.padding}
          placeholder="0"
          onChange={(padding) => onChange((s) => { s.padding = padding; })}
        />
      </PropField>
      <PropField label="Margin — zewnętrzne odstępy">
        <SideInputs
          value={style?.margin}
          placeholder="0"
          onChange={(margin) => onChange((s) => { s.margin = margin; })}
        />
      </PropField>
      <PropField label="Wyrównanie">
        <Select
          value={currentAlign}
          onValueChange={(v) => onChange((s) => {
            s.align = setAllDevices(v as Align);
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
