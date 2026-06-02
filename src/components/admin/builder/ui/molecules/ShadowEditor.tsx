// Molecule: structured editor for CSS box-shadow. Splits the single shadow
// string into X / Y / blur / spread / color / inset so users can tweak each
// part independently without writing CSS.
import { useMemo } from "react";
import { PropField, StepperInput, ColorField } from "../atoms";
import { Switch } from "@/components/ui/switch";

interface Props {
  value: string | undefined;
  onChange: (next: string | undefined) => void;
}

interface ShadowParts {
  x: string;
  y: string;
  blur: string;
  spread: string;
  color: string;
  inset: boolean;
}

const EMPTY: ShadowParts = { x: "", y: "", blur: "", spread: "", color: "", inset: false };

// Split on top-level whitespace, but keep rgb()/rgba()/hsl()/oklch() intact.
function tokenize(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of input.trim()) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (buf) { out.push(buf); buf = ""; }
    } else {
      buf += ch;
    }
  }
  if (buf) out.push(buf);
  return out;
}

function parse(raw: string | undefined): ShadowParts {
  if (!raw || !raw.trim() || raw.trim() === "none") return { ...EMPTY };
  // Only edit the first shadow if there are multiple.
  const first = raw.split(/,(?![^()]*\))/)[0];
  const tokens = tokenize(first);
  const out: ShadowParts = { ...EMPTY };
  if (tokens[0] === "inset") { out.inset = true; tokens.shift(); }
  const lengthLike = /^-?\d*\.?\d+(px|rem|em|%)?$/i;
  const lens: string[] = [];
  const rest: string[] = [];
  for (const t of tokens) {
    if (lens.length < 4 && lengthLike.test(t)) lens.push(t);
    else rest.push(t);
  }
  out.x = lens[0] ?? "";
  out.y = lens[1] ?? "";
  out.blur = lens[2] ?? "";
  out.spread = lens[3] ?? "";
  out.color = rest.join(" ");
  return out;
}

function serialize(p: ShadowParts): string | undefined {
  const hasAny = p.x || p.y || p.blur || p.spread || p.color || p.inset;
  if (!hasAny) return undefined;
  const withUnit = (s: string) => (!s ? "0px" : /^-?\d*\.?\d+$/.test(s) ? `${s}px` : s);
  const parts: string[] = [];
  if (p.inset) parts.push("inset");
  parts.push(withUnit(p.x || "0"));
  parts.push(withUnit(p.y || "0"));
  if (p.blur || p.spread) parts.push(withUnit(p.blur || "0"));
  if (p.spread) parts.push(withUnit(p.spread));
  if (p.color) parts.push(p.color);
  else parts.push("rgba(0,0,0,.15)");
  return parts.join(" ");
}

const PRESETS: Array<{ label: string; value: string }> = [
  { label: "brak", value: "" },
  { label: "sm", value: "0 1px 2px rgba(0,0,0,.08)" },
  { label: "md", value: "0 4px 12px rgba(0,0,0,.12)" },
  { label: "lg", value: "0 10px 30px rgba(0,0,0,.18)" },
  { label: "xl", value: "0 24px 60px rgba(0,0,0,.25)" },
];

export function ShadowEditor({ value, onChange }: Props) {
  const parts = useMemo(() => parse(value), [value]);

  const update = (patch: Partial<ShadowParts>) => {
    onChange(serialize({ ...parts, ...patch }));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onChange(p.value || undefined)}
            className="px-2 py-0.5 text-[10px] rounded border border-border hover:bg-muted"
          >{p.label}</button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <PropField label="Przesunięcie X">
          <StepperInput
            value={parts.x}
            placeholder="0px"
            onChange={(v) => update({ x: v ?? "" })}
          />
        </PropField>
        <PropField label="Przesunięcie Y">
          <StepperInput
            value={parts.y}
            placeholder="10px"
            onChange={(v) => update({ y: v ?? "" })}
          />
        </PropField>
        <PropField label="Rozmycie (blur)">
          <StepperInput
            value={parts.blur}
            placeholder="30px"
            min={0}
            onChange={(v) => update({ blur: v ?? "" })}
          />
        </PropField>
        <PropField label="Rozszerzenie (spread)">
          <StepperInput
            value={parts.spread}
            placeholder="0px"
            onChange={(v) => update({ spread: v ?? "" })}
          />
        </PropField>
      </div>

      <PropField label="Kolor cienia">
        <ColorField
          value={parts.color}
          onChange={(v) => update({ color: v || "" })}
        />
      </PropField>

      <label className="flex items-center justify-between gap-2 px-1">
        <span className="text-[11px] text-muted-foreground">Cień wewnętrzny (inset)</span>
        <Switch
          checked={parts.inset}
          onCheckedChange={(checked) => update({ inset: checked })}
        />
      </label>
    </div>
  );
}
