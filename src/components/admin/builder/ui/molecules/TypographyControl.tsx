// Molecule: full typography editor block (font family, responsive size,
// weight, style, line-height, letter-spacing, transform, decoration).
import type { Device, WidgetTypography } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { PropField } from "../atoms/PropField";
import { ResponsiveInput } from "../atoms/ResponsiveInput";
import { FontPicker } from "@/components/admin/settings/FontPicker";

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
      <PropField label="Krój pisma">
        <FontPicker
          value={v.fontFamily}
          onChange={(stack) => set({ fontFamily: stack })}
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
        <PropField label="Grubość">
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
              <SelectItem value="italic">Pochyły</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <PropField label="Wysokość linii">
          <Input
            value={v.lineHeight ?? ""}
            placeholder="1.4"
            onChange={(e) => set({ lineHeight: e.target.value || undefined })}
            className="h-8 text-xs"
          />
        </PropField>
        <PropField label="Odstęp znaków">
          <Input
            value={v.letterSpacing ?? ""}
            placeholder="0.02em"
            onChange={(e) => set({ letterSpacing: e.target.value || undefined })}
            className="h-8 text-xs"
          />
        </PropField>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <PropField label="Wielkość liter">
          <Select
            value={v.textTransform ?? "none"}
            onValueChange={(t) => set({
              textTransform: t as "none" | "uppercase" | "lowercase" | "capitalize",
            })}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Bez zmian</SelectItem>
              <SelectItem value="uppercase">WIELKIE LITERY</SelectItem>
              <SelectItem value="lowercase">małe litery</SelectItem>
              <SelectItem value="capitalize">Każde Słowo Wielką</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
        <PropField label="Dekoracja">
          <Select
            value={v.textDecoration ?? "none"}
            onValueChange={(t) => set({
              textDecoration: t as "none" | "underline" | "line-through",
            })}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Brak</SelectItem>
              <SelectItem value="underline">Podkreślenie</SelectItem>
              <SelectItem value="line-through">Przekreślenie</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
      </div>
    </div>
  );
}
