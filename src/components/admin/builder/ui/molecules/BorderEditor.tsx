// Molecule: border editor (style/width/color/radius/box-shadow).
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import type { BorderSettings, BorderStyle } from "@/lib/builder/types";
import { Row, ColorInput, SidesInput } from "../atoms";

interface Props {
  value: BorderSettings | undefined;
  onChange: (mut: (b: BorderSettings) => void) => void;
}

export function BorderEditor({ value, onChange }: Props) {
  const b = value ?? {};
  return (
    <>
      <Row label="Typ obramowania">
        <Select value={b.style ?? "none"} onValueChange={(v) => onChange((x) => { x.style = v as BorderStyle; })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(["none","solid","dashed","dotted","double","groove"] as const).map((s) =>
              <SelectItem key={s} value={s}>{s}</SelectItem>
            )}
          </SelectContent>
        </Select>
      </Row>
      {b.style && b.style !== "none" && (
        <>
          <Row label="Szerokość (px)"><SidesInput value={b.width} onChange={(w) => onChange((x) => { x.width = w; })} /></Row>
          <Row label="Kolor"><ColorInput value={b.color} onChange={(v) => onChange((x) => { x.color = v; })} /></Row>
        </>
      )}
      <Row label="Zaokrąglenie narożników (px)"><SidesInput value={b.radius} onChange={(r) => onChange((x) => { x.radius = r; })} /></Row>
      <Row label="Cień (CSS box-shadow)" hint="Np. 0 10px 30px rgba(0,0,0,.2)">
        <Input value={b.boxShadow ?? ""} onChange={(e) => onChange((x) => { x.boxShadow = e.target.value || undefined; })} className="h-8 text-xs font-mono" />
      </Row>
    </>
  );
}
