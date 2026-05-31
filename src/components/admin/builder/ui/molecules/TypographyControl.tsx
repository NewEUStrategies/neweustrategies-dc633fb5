// Molecule: full typography editor block (font family, responsive size,
// weight, style, line-height, letter-spacing, transform, decoration).
import type { Device, WidgetTypography } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { PropField } from "../atoms/PropField";
import { ResponsiveInput } from "../atoms/ResponsiveInput";

interface Props {
  value: WidgetTypography | undefined;
  device: Device;
  onChange: (next: WidgetTypography) => void;
}

export function TypographyControl({ value, device, onChange }: Props) {
  const v = value ?? {};
  const set = (patch: Partial<WidgetTypography>) => onChange({ ...v, ...patch });

  return (
    <div className="space-y-2">
      <PropField label="Font family">
        <Input
          value={v.fontFamily ?? ""}
          placeholder="Inter, system-ui"
          onChange={(e) => set({ fontFamily: e.target.value || undefined })}
          className="h-8 text-xs"
        />
      </PropField>

      <PropField label={`Rozmiar (${device})`}>
        <ResponsiveInput
          value={v.fontSize}
          device={device}
          placeholder="16px / 1.25rem"
          onChange={(fontSize) => set({ fontSize })}
        />
      </PropField>

      <div className="grid grid-cols-2 gap-2">
        <PropField label="Weight">
          <Select
            value={v.fontWeight ?? ""}
            onValueChange={(w) => set({ fontWeight: w || undefined })}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              {["300", "400", "500", "600", "700", "800", "900"].map((w) => (
                <SelectItem key={w} value={w}>{w}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PropField>
        <PropField label="Styl">
          <Select
            value={v.fontStyle ?? "normal"}
            onValueChange={(s) => set({ fontStyle: s as "normal" | "italic" })}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="normal">Normalny</SelectItem>
              <SelectItem value="italic">Italic</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <PropField label="Line height">
          <Input
            value={v.lineHeight ?? ""}
            placeholder="1.4"
            onChange={(e) => set({ lineHeight: e.target.value || undefined })}
            className="h-8 text-xs"
          />
        </PropField>
        <PropField label="Letter spacing">
          <Input
            value={v.letterSpacing ?? ""}
            placeholder="0.02em"
            onChange={(e) => set({ letterSpacing: e.target.value || undefined })}
            className="h-8 text-xs"
          />
        </PropField>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <PropField label="Transform">
          <Select
            value={v.textTransform ?? "none"}
            onValueChange={(t) => set({
              textTransform: t as "none" | "uppercase" | "lowercase" | "capitalize",
            })}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">none</SelectItem>
              <SelectItem value="uppercase">UPPERCASE</SelectItem>
              <SelectItem value="lowercase">lowercase</SelectItem>
              <SelectItem value="capitalize">Capitalize</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
        <PropField label="Decoration">
          <Select
            value={v.textDecoration ?? "none"}
            onValueChange={(t) => set({
              textDecoration: t as "none" | "underline" | "line-through",
            })}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">none</SelectItem>
              <SelectItem value="underline">underline</SelectItem>
              <SelectItem value="line-through">line-through</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
      </div>
    </div>
  );
}
