// Molecule: padding + margin (responsive shorthand) + align (responsive).
import type { Align, CommonStyle, Device } from "@/lib/builder/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PropField } from "../atoms/PropField";
import { ResponsiveInput } from "../atoms/ResponsiveInput";

interface Props {
  style: CommonStyle | undefined;
  device: Device;
  onChange: (mut: (s: CommonStyle) => void) => void;
}

export function SpacingControl({ style, device, onChange }: Props) {
  return (
    <div className="space-y-2">
      <PropField label={`Padding (${device})`}>
        <ResponsiveInput
          value={style?.padding}
          device={device}
          placeholder="16px 24px"
          onChange={(padding) => onChange((s) => { s.padding = padding; })}
        />
      </PropField>
      <PropField label={`Margin (${device})`}>
        <ResponsiveInput
          value={style?.margin}
          device={device}
          placeholder="0 0 16px"
          onChange={(margin) => onChange((s) => { s.margin = margin; })}
        />
      </PropField>
      <PropField label={`Wyrównanie (${device})`}>
        <Select
          value={style?.align?.[device] ?? "left"}
          onValueChange={(v) => onChange((s) => {
            s.align = { ...(s.align ?? {}), [device]: v as Align };
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
