// Molecule: full typography editor block (font family, unified size,
// weight, style, line-height, letter-spacing, transform, decoration).
// Font size is a single value applied identically on desktop / tablet / mobile.
import type { Device, WidgetTypography } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { AlignLeft, AlignCenter, AlignRight, AlignJustify, ChevronUp, ChevronDown } from "lucide-react";
import { PropField } from "../atoms/PropField";
import { FontPicker } from "@/components/admin/settings/FontPicker";

interface Props {
  value: WidgetTypography | undefined;
  device: Device;
  onChange: (next: WidgetTypography) => void;
}

export function TypographyControl({ value, onChange }: Props) {
  const v = value ?? {};
  const set = (patch: Partial<WidgetTypography>) => onChange({ ...v, ...patch });

  const rawUnified = v.fontSize?.desktop ?? v.fontSize?.tablet ?? v.fontSize?.mobile ?? "";
  const unifiedPx = String(rawUnified).replace(/[^0-9]/g, "");
  const setUnifiedSize = (raw: string) => {
    const digits = raw.replace(/[^0-9]/g, "");
    if (!digits) {
      set({ fontSize: undefined });
      return;
    }
    const px = `${digits}px`;
    set({ fontSize: { desktop: px, tablet: px, mobile: px } });
  };

  const rawDesc = v.descriptionFontSize?.desktop ?? v.descriptionFontSize?.tablet ?? v.descriptionFontSize?.mobile ?? "";
  const descPx = String(rawDesc).replace(/[^0-9]/g, "");
  const setDescSize = (raw: string) => {
    const digits = raw.replace(/[^0-9]/g, "");
    if (!digits) {
      set({ descriptionFontSize: undefined });
      return;
    }
    const px = `${digits}px`;
    set({ descriptionFontSize: { desktop: px, tablet: px, mobile: px } });
  };

  const renderSizeInput = (
    current: string,
    setter: (raw: string) => void,
    ariaLabel: string,
  ) => (
    <div className="relative">
      <Input
        value={current}
        inputMode="numeric"
        placeholder="16"
        aria-label={ariaLabel}
        onChange={(e) => setter(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setter(String((parseInt(current || "0", 10) || 0) + 1));
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            const next = (parseInt(current || "0", 10) || 0) - 1;
            setter(next > 0 ? String(next) : "");
          }
        }}
        className="h-8 text-xs pr-12"
      />
      <span className="pointer-events-none absolute right-7 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">px</span>
      <div className="absolute right-0 top-0 h-8 w-6 flex flex-col border-l border-border">
        <button
          type="button"
          tabIndex={-1}
          aria-label="Zwiększ"
          onClick={() => setter(String((parseInt(current || "0", 10) || 0) + 1))}
          className="flex-1 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition"
        >
          <ChevronUp className="w-3 h-3" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Zmniejsz"
          onClick={() => {
            const next = (parseInt(current || "0", 10) || 0) - 1;
            setter(next > 0 ? String(next) : "");
          }}
          className="flex-1 flex items-center justify-center border-t border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition"
        >
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-2">
      <PropField label="Krój pisma">
        <FontPicker
          value={v.fontFamily}
          onChange={(stack) => set({ fontFamily: stack })}
        />
      </PropField>


      <div className="grid grid-cols-2 gap-2">
        <PropField label="Rozmiar tytułu (px)">
          {renderSizeInput(unifiedPx, setUnifiedSize, "Rozmiar tytułu")}
        </PropField>
        <PropField label="Rozmiar opisu (px)">
          {renderSizeInput(descPx, setDescSize, "Rozmiar opisu")}
        </PropField>
      </div>

      <PropField label="Odstęp tytuł ↔ opis (px)">
        <Input
          type="number"
          min={0}
          max={200}
          inputMode="numeric"
          placeholder="np. 16"
          value={typeof v.titleDescriptionGapPx === "number" ? v.titleDescriptionGapPx : ""}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") { set({ titleDescriptionGapPx: undefined }); return; }
            const n = Math.max(0, Math.min(200, Number(raw) || 0));
            set({ titleDescriptionGapPx: n });
          }}
          className="h-8 text-xs"
        />
      </PropField>




      <PropField label="Wyrównanie">
        <div className="inline-flex rounded border border-border bg-muted/30 p-0.5 w-full">
          {([
            { v: "left", Icon: AlignLeft, label: "Lewo" },
            { v: "center", Icon: AlignCenter, label: "Środek" },
            { v: "right", Icon: AlignRight, label: "Prawo" },
            { v: "justify", Icon: AlignJustify, label: "Wyjustuj" },
          ] as const).map(({ v: val, Icon, label }) => {
            const active = v.textAlign === val;
            return (
              <button
                key={val}
                type="button"
                title={label}
                onClick={() => set({ textAlign: active ? undefined : val })}
                className={`flex-1 inline-flex items-center justify-center h-7 text-[11px] rounded transition ${
                  active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
              </button>
            );
          })}
        </div>
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
