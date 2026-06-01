// Molecule: typography editor for sections (heading/text/link colors + align).
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import type { TypographySettings, Device, Align } from "@/lib/builder/types";
import { Row, ColorInput } from "../atoms";

interface Props {
  value: TypographySettings | undefined;
  device: Device;
  onChange: (mut: (t: TypographySettings) => void) => void;
}

export function TypographyEditor({ value, device, onChange }: Props) {
  const t = value ?? {};
  const setResp = (val: Align | undefined) => onChange((x) => { x.align = { ...(x.align ?? {}), [device]: val }; });
  return (
    <>
      <Row label="Kolor nagłówków"><ColorInput value={t.headingColor} onChange={(v) => onChange((x) => { x.headingColor = v; })} /></Row>
      <Row label="Kolor tekstu"><ColorInput value={t.textColor} onChange={(v) => onChange((x) => { x.textColor = v; })} /></Row>
      <Row label="Kolor linków"><ColorInput value={t.linkColor} onChange={(v) => onChange((x) => { x.linkColor = v; })} /></Row>
      <Row label="Kolor linków (hover)"><ColorInput value={t.linkHoverColor} onChange={(v) => onChange((x) => { x.linkHoverColor = v; })} /></Row>
      <Row label={`Wyrównanie (${device})`}>
        <Select value={t.align?.[device] ?? "left"} onValueChange={(v) => setResp(v as Align)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="left">Lewo</SelectItem>
            <SelectItem value="center">Środek</SelectItem>
            <SelectItem value="right">Prawo</SelectItem>
          </SelectContent>
        </Select>
      </Row>
    </>
  );
}
