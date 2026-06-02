// Organism: section-label widget visual editor (variant + accent color + link).
import { X } from "lucide-react";
import type { WidgetNode, Json } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import { PropField } from "../../atoms";
import {
  SECTION_LABEL_VARIANTS,
  SectionLabelRender,
  resolveAccentColor,
  type SectionLabelVariant,
} from "@/lib/builder/sectionLabelVariants";

const PRESET_COLORS: { value: string; label: string; hex: string }[] = [
  { value: "brand",     label: "Marka",     hex: "#e85d3a" },
  { value: "military",  label: "Military",  hex: "#9b4a2a" },
  { value: "finance",   label: "Finance",   hex: "#2d8a4e" },
  { value: "transport", label: "Transport", hex: "#c98a2a" },
  { value: "diplomacy", label: "Diplomacy", hex: "#3a5da8" },
  { value: "cyber",     label: "Cyber",     hex: "#2a9ec9" },
  { value: "neutral",   label: "Neutralny", hex: "#777777" },
];

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}

export function SectionLabelEditor({ c, lang, setContent }: Props) {
  const labelKey = `label_${lang}`;
  const actionKey = `action_${lang}`;
  const label = (typeof c[labelKey] === "string" ? c[labelKey] : "") as string;
  const action = (typeof c[actionKey] === "string" ? c[actionKey] : "") as string;
  const href = (typeof c.href === "string" ? c.href : "") as string;
  const variant = ((typeof c.variant === "string" && c.variant) || "left-bar") as SectionLabelVariant;
  const customAccent = (typeof c.accentColor === "string" ? c.accentColor : "") as string;
  const colorPreset = (typeof c.color === "string" ? c.color : "brand") as string;
  const accent = resolveAccentColor(customAccent || colorPreset);
  const labelColor = (typeof c.labelColor === "string" ? c.labelColor : "") as string;
  const labelSize = (typeof c.labelSize === "string" ? c.labelSize : "") as string;
  const actionColor = (typeof c.actionColor === "string" ? c.actionColor : "") as string;
  const actionSize = (typeof c.actionSize === "string" ? c.actionSize : "") as string;

  const previewLabel = label || "Etykieta";

  return (
    <div className="space-y-3">
      <PropField label={`Etykieta sekcji (${lang.toUpperCase()})`}>
        <Input
          value={label}
          onChange={(e) => setContent(labelKey, e.target.value)}
          className="h-8 text-xs"
          placeholder="np. Najnowsze raporty"
        />
      </PropField>

      <div className="space-y-1.5">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Kolor akcentu
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {PRESET_COLORS.map((p) => {
            const isActive = !customAccent && colorPreset === p.value;
            return (
              <button
                key={p.value}
                type="button"
                title={p.label}
                onClick={() => {
                  setContent("color", p.value);
                  setContent("accentColor", "");
                }}
                className={`relative h-7 rounded border transition ${isActive ? "border-foreground ring-2 ring-foreground/30" : "border-border hover:border-foreground/40"}`}
                style={{ background: p.hex }}
              >
                {isActive && <span className="absolute inset-0 flex items-center justify-center text-white text-[10px] font-bold drop-shadow">✓</span>}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <label className="text-[10px] text-muted-foreground shrink-0">Własny kolor:</label>
          <input
            type="color"
            value={customAccent && customAccent.startsWith("#") ? customAccent : "#e85d3a"}
            onChange={(e) => setContent("accentColor", e.target.value)}
            className="h-7 w-10 rounded border border-border cursor-pointer bg-transparent"
          />
          <Input
            value={customAccent}
            onChange={(e) => setContent("accentColor", e.target.value)}
            placeholder="#hex / oklch(...)"
            className="h-7 text-[11px] font-mono flex-1"
          />
          {customAccent && (
            <button
              type="button"
              onClick={() => setContent("accentColor", "")}
              className="text-[10px] text-muted-foreground hover:text-destructive"
              title="Wyczyść własny kolor"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground">
          Aktywny: <span className="inline-block w-3 h-3 align-middle rounded-sm border border-border" style={{ background: accent }} />{" "}
          <span className="font-mono">{customAccent || colorPreset}</span>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Wariant nagłówka</span>
          <span className="text-[10px] text-muted-foreground">{SECTION_LABEL_VARIANTS.find(v => v.value === variant)?.label}</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5 max-h-[420px] overflow-y-auto pr-1">
          {SECTION_LABEL_VARIANTS.map((v) => {
            const isActive = v.value === variant;
            return (
              <button
                key={v.value}
                type="button"
                onClick={() => setContent("variant", v.value)}
                title={v.label}
                className={`text-left rounded-md border p-1.5 transition bg-background ${isActive ? "border-foreground ring-2 ring-foreground/30" : "border-border hover:border-foreground/40"}`}
              >
                <div className="h-[34px] overflow-hidden flex items-center">
                  <div className="w-full">
                    <SectionLabelRender
                      label={previewLabel}
                      action={action || "więcej"}
                      accent={accent}
                      variant={v.value}
                      size="sm"
                    />
                  </div>
                </div>
                <div className="mt-1 text-[9px] text-muted-foreground truncate">{v.label}</div>
              </button>
            );
          })}
        </div>
      </div>

      <PropField label={`Tekst linku (${lang.toUpperCase()})`}>
        <Input
          value={action}
          onChange={(e) => setContent(actionKey, e.target.value)}
          placeholder="więcej"
          className="h-8 text-xs"
        />
      </PropField>
      <PropField label="URL linku">
        <Input
          value={href}
          onChange={(e) => setContent("href", e.target.value)}
          placeholder="/kategoria/..."
          className="h-8 text-xs"
        />
      </PropField>

      <div className="space-y-2 pt-2 border-t border-border">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Styl tekstu nagłówka
        </div>
        <div className="grid grid-cols-2 gap-2">
          <PropField label="Kolor tekstu">
            <div className="flex items-center gap-1.5">
              <input
                type="color"
                value={labelColor && labelColor.startsWith("#") ? labelColor : "#000000"}
                onChange={(e) => setContent("labelColor", e.target.value)}
                className="h-8 w-9 rounded border border-border cursor-pointer bg-transparent shrink-0"
              />
              <Input
                value={labelColor}
                onChange={(e) => setContent("labelColor", e.target.value)}
                placeholder="auto"
                className="h-8 text-[11px] font-mono flex-1"
              />
              {labelColor && (
                <button type="button" onClick={() => setContent("labelColor", "")} title="Wyczyść" className="text-muted-foreground hover:text-destructive">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </PropField>
          <PropField label="Rozmiar (np. 16px)">
            <Input
              value={labelSize}
              onChange={(e) => setContent("labelSize", e.target.value)}
              placeholder="auto"
              className="h-8 text-xs"
            />
          </PropField>
        </div>

        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground pt-1">
          Styl tekstu „więcej / linku"
        </div>
        <div className="grid grid-cols-2 gap-2">
          <PropField label="Kolor tekstu">
            <div className="flex items-center gap-1.5">
              <input
                type="color"
                value={actionColor && actionColor.startsWith("#") ? actionColor : "#000000"}
                onChange={(e) => setContent("actionColor", e.target.value)}
                className="h-8 w-9 rounded border border-border cursor-pointer bg-transparent shrink-0"
              />
              <Input
                value={actionColor}
                onChange={(e) => setContent("actionColor", e.target.value)}
                placeholder="auto"
                className="h-8 text-[11px] font-mono flex-1"
              />
              {actionColor && (
                <button type="button" onClick={() => setContent("actionColor", "")} title="Wyczyść" className="text-muted-foreground hover:text-destructive">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </PropField>
          <PropField label="Rozmiar (np. 12px)">
            <Input
              value={actionSize}
              onChange={(e) => setContent("actionSize", e.target.value)}
              placeholder="auto"
              className="h-8 text-xs"
            />
          </PropField>
        </div>
      </div>
    </div>
  );
}

