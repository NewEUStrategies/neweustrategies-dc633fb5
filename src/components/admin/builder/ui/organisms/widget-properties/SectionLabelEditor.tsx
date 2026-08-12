// Organism: section-label widget visual editor (variant + accent color + link).
import { ChevronDown, ChevronUp, X } from "lucide-react";
import type { WidgetNode, Json } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import { AdminColorPicker } from "@/components/admin/blocks/AdminColorPicker";
import { PropField } from "../../atoms";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-builder";
import { useBuilderLabel } from "@/lib/builder/labelsEn";

// Compact px-size stepper. Accepts/produces strings like "14px" / "1.5rem" / "".
// Up/Down arrows step the numeric prefix by ±1; bare numbers get "px" on blur.
function PxSizeInput({
  value,
  onChange,
  placeholder,
  min = 6,
  max = 200,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  min?: number;
  max?: number;
}) {
  const { t } = useTranslation();
  const match = value.trim().match(/^(-?\d*\.?\d+)\s*([a-z%]*)$/i);
  const num = match ? parseFloat(match[1]) : NaN;
  const unit = match ? match[2] || "px" : "px";
  const setNum = (n: number) => {
    const clamped = Math.max(min, Math.min(max, n));
    onChange(`${clamped}${unit}`);
  };
  return (
    <div className="flex items-stretch h-8">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v && /^-?\d*\.?\d+$/.test(v)) onChange(`${v}px`);
        }}
        placeholder={placeholder ?? "auto"}
        className="h-8 text-xs rounded-r-none border-r-0 flex-1 min-w-0"
      />
      <div className="flex flex-col border border-border rounded-r overflow-hidden">
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setNum((Number.isFinite(num) ? num : 12) + 1)}
          className="flex-1 px-1 hover:bg-muted text-muted-foreground hover:text-foreground transition flex items-center justify-center"
          aria-label={t("builder.sectionLabelEditor.increase")}
        >
          <ChevronUp className="w-3 h-3" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setNum((Number.isFinite(num) ? num : 12) - 1)}
          className="flex-1 px-1 hover:bg-muted text-muted-foreground hover:text-foreground transition flex items-center justify-center border-t border-border"
          aria-label={t("builder.sectionLabelEditor.decrease")}
        >
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
import {
  SECTION_LABEL_VARIANTS,
  SECTION_LABEL_FONTS,
  SECTION_LABEL_ARROWS,
  SectionLabelRender,
  readSectionLabelProps,
  type SectionLabelVariant,
} from "@/lib/builder/sectionLabelVariants";

// Kompaktowy natywny select - spójny z resztą paneli właściwości.
function MiniSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 w-full rounded-[6px] border border-border bg-background px-2 text-xs"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function MiniToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-foreground">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded-[3px] border-border accent-[color:var(--brand,#FA9346)]"
      />
      {label}
    </label>
  );
}

const PRESET_COLORS: { value: string; label: string; hex: string }[] = [
  { value: "brand", label: "Brand", hex: "#FA9346" },
  { value: "amber", label: "Amber", hex: "#F8B632" },
  { value: "gold", label: "Gold", hex: "#FECA62" },
  { value: "sky", label: "Sky", hex: "#63B2F2" },
  { value: "green", label: "Green", hex: "#81D365" },
  { value: "red", label: "Red", hex: "#F24343" },
  { value: "ivory", label: "Ivory", hex: "#F8F6F4" },
  { value: "crimson", label: "Crimson", hex: "#CD393B" },
  { value: "navy", label: "Navy", hex: "#01112F" },
  { value: "ink", label: "Ink", hex: "#141313" },
];

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}

export function SectionLabelEditor({ c, lang, setContent }: Props) {
  const { t } = useTranslation();
  const bl = useBuilderLabel();
  const labelKey = `label_${lang}`;
  const actionKey = `action_${lang}`;
  // Jedno źródło prawdy z runtime - te same mapowania content -> props.
  // Preview zostaje w jasnym trybie: picker wariantów nie zależy od theme'u
  // canvasa, żeby akcent był porównywalny między kafelkami.
  const derived = readSectionLabelProps(c, lang, {
    labelFallback: t("builder.sectionLabelEditor.previewLabel"),
  });
  const label = (typeof c[labelKey] === "string" ? c[labelKey] : "") as string;
  const action = (typeof c[actionKey] === "string" ? c[actionKey] : "") as string;
  const href = (typeof c.href === "string" ? c.href : "") as string;
  const variant = derived.variant;
  const customAccent = (typeof c.accentColor === "string" ? c.accentColor : "") as string;
  const colorPreset = (typeof c.color === "string" ? c.color : "brand") as string;
  const accent = derived.accent;
  const labelColor = derived.labelColor ?? "";
  const labelSize = derived.labelSize ?? "";
  const actionColor = derived.actionColor ?? "";
  const actionSize = derived.actionSize ?? "";
  const categoryKey = `category_${lang}`;
  const category = (typeof c[categoryKey] === "string" ? c[categoryKey] : "") as string;
  const indexNumber = derived.indexNumber ?? "";
  const showRule = derived.showRule !== false;
  const showAction = typeof c.showAction === "boolean" ? c.showAction : true;
  const arrow = derived.arrow ?? "arrow";
  const numberFont = derived.numberFont ?? "inherit";
  const numberSize = derived.numberSize ?? "";
  const categoryFont = derived.categoryFont ?? "inherit";
  const categorySize = derived.categorySize ?? "";
  const titleFont = derived.titleFont ?? "inherit";
  const gapX = derived.gapX ?? "";
  const gapY = derived.gapY ?? "";
  // Warianty redakcyjne dzielą panel dodatkowy (numer / kategoria / odstępy).
  const NUMBER_VARIANTS = ["editorial-index", "numbered-rail"];
  const CATEGORY_VARIANTS = [
    "double-deck-masthead",
    "kicker-tag-rule",
    "stacked-serif-lede",
    "split-rule-duo",
  ];
  const EXTRA_VARIANTS = ["bracket-label", "dotted-leader", "ticker-strip", "underline-sweep"];
  const showNumberControls = NUMBER_VARIANTS.includes(variant);
  const showCategoryControls = CATEGORY_VARIANTS.includes(variant);
  const isEditorial =
    showNumberControls || showCategoryControls || EXTRA_VARIANTS.includes(variant);

  const previewLabel = derived.label;

  return (
    <div className="space-y-3">
      <PropField label={t("builder.sectionLabelEditor.sectionLabel", { lang: lang.toUpperCase() })}>
        <Input
          value={label}
          onChange={(e) => setContent(labelKey, e.target.value)}
          className="h-8 text-xs"
          placeholder={t("builder.sectionLabelEditor.sectionLabelPh")}
        />
      </PropField>

      <div className="space-y-1.5">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {t("builder.sectionLabelEditor.accentColor")}
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {PRESET_COLORS.map((p) => {
            const isActive = !customAccent && colorPreset === p.value;
            return (
              <button
                key={p.value}
                type="button"
                title={
                  p.value === "brand"
                    ? t("builder.sectionLabelEditor.brandColor")
                    : p.value === "neutral"
                      ? t("builder.sectionLabelEditor.neutralColor")
                      : p.label
                }
                onClick={() => {
                  setContent("color", p.value);
                  setContent("accentColor", "");
                }}
                className={`relative h-7 rounded border transition ${isActive ? "border-foreground ring-2 ring-foreground/30" : "border-border hover:border-foreground/40"}`}
                style={{ background: p.hex }}
              >
                {isActive && (
                  <span className="absolute inset-0 flex items-center justify-center text-white text-[10px] font-bold drop-shadow">
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <label className="text-[10px] text-muted-foreground shrink-0">
            {t("builder.sectionLabelEditor.customColor")}
          </label>
          <AdminColorPicker
            value={customAccent}
            onChange={(v) => setContent("accentColor", v ?? "")}
            allowTransparent={false}
            allowReset={true}
            placeholder="#hex / oklch(...)"
            className="flex-1"
          />
        </div>
        <div className="text-[10px] text-muted-foreground">
          {t("builder.sectionLabelEditor.active")}{" "}
          <span
            className="inline-block w-3 h-3 align-middle rounded-sm border border-border"
            style={{ background: accent }}
          />{" "}
          <span className="font-mono">{customAccent || colorPreset}</span>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("builder.sectionLabelEditor.variant")}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {SECTION_LABEL_VARIANTS.find((v) => v.value === variant)?.label}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-1.5 max-h-[420px] overflow-y-auto pr-1">
          {SECTION_LABEL_VARIANTS.map((v) => {
            const isActive = v.value === variant;
            return (
              <button
                key={v.value}
                type="button"
                onClick={() => setContent("variant", v.value)}
                title={bl(v.label)}
                className={`text-left rounded-md border p-1.5 transition bg-background ${isActive ? "border-foreground ring-2 ring-foreground/30" : "border-border hover:border-foreground/40"}`}
              >
                <div className="min-h-[34px] flex items-center w-full min-w-0 overflow-hidden">
                  <div className="w-full min-w-0">
                    <SectionLabelRender
                      label={previewLabel}
                      action={
                        showAction ? action || t("builder.sectionLabelEditor.more") : undefined
                      }
                      accent={accent}
                      variant={v.value}
                      size="sm"
                      labelColor={labelColor || undefined}
                      labelSize={labelSize || undefined}
                      actionColor={actionColor || undefined}
                      actionSize={actionSize || undefined}
                      indexNumber={indexNumber || undefined}
                      category={category || t("builder.sectionLabelEditor.categoryPh")}
                      showRule={showRule}
                      numberFont={numberFont}
                      categoryFont={categoryFont}
                      titleFont={titleFont}
                      arrow={arrow}
                      gapX={gapX || undefined}
                      gapY={gapY || undefined}
                    />
                  </div>
                </div>
                <div className="mt-1 text-[9px] text-muted-foreground truncate">{bl(v.label)}</div>
              </button>
            );
          })}
        </div>
      </div>

      {isEditorial && (
        <div className="space-y-2 pt-2 border-t border-border">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("builder.sectionLabelEditor.editorialTitle")}
          </div>

          {showNumberControls && (
            <div className="grid grid-cols-2 gap-2">
              <PropField label={t("builder.sectionLabelEditor.indexNumber")}>
                <Input
                  value={indexNumber}
                  onChange={(e) => setContent("indexNumber", e.target.value)}
                  placeholder={t("builder.sectionLabelEditor.indexNumberPh")}
                  className="h-8 text-xs"
                />
              </PropField>
              <PropField label={t("builder.sectionLabelEditor.numberSize")}>
                <PxSizeInput
                  value={numberSize}
                  onChange={(v) => setContent("numberSize", v)}
                  placeholder="auto"
                  max={160}
                />
              </PropField>
              <PropField label={t("builder.sectionLabelEditor.numberFont")}>
                <MiniSelect
                  value={numberFont}
                  onChange={(v) => setContent("numberFont", v)}
                  options={SECTION_LABEL_FONTS}
                />
              </PropField>
              <PropField label={t("builder.sectionLabelEditor.titleFont")}>
                <MiniSelect
                  value={titleFont}
                  onChange={(v) => setContent("titleFont", v)}
                  options={SECTION_LABEL_FONTS}
                />
              </PropField>
            </div>
          )}

          {showCategoryControls && (
            <div className="grid grid-cols-2 gap-2">
              <PropField
                label={t("builder.sectionLabelEditor.category", { lang: lang.toUpperCase() })}
              >
                <Input
                  value={category}
                  onChange={(e) => setContent(categoryKey, e.target.value)}
                  placeholder={t("builder.sectionLabelEditor.categoryPh")}
                  className="h-8 text-xs"
                />
              </PropField>
              <PropField label={t("builder.sectionLabelEditor.categorySize")}>
                <PxSizeInput
                  value={categorySize}
                  onChange={(v) => setContent("categorySize", v)}
                  placeholder="auto"
                />
              </PropField>
              <PropField label={t("builder.sectionLabelEditor.categoryFont")}>
                <MiniSelect
                  value={categoryFont}
                  onChange={(v) => setContent("categoryFont", v)}
                  options={SECTION_LABEL_FONTS}
                />
              </PropField>
              <PropField label={t("builder.sectionLabelEditor.titleFont")}>
                <MiniSelect
                  value={titleFont}
                  onChange={(v) => setContent("titleFont", v)}
                  options={SECTION_LABEL_FONTS}
                />
              </PropField>
            </div>
          )}

          <div className="flex items-center gap-4 pt-1">
            <MiniToggle
              checked={showRule}
              onChange={(v) => setContent("showRule", v)}
              label={t("builder.sectionLabelEditor.showRule")}
            />
            <MiniToggle
              checked={showAction}
              onChange={(v) => setContent("showAction", v)}
              label={t("builder.sectionLabelEditor.showAction")}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <PropField label={t("builder.sectionLabelEditor.gapX")}>
              <PxSizeInput
                value={gapX}
                onChange={(v) => setContent("gapX", v)}
                placeholder="auto"
                max={96}
              />
            </PropField>
            <PropField label={t("builder.sectionLabelEditor.gapY")}>
              <PxSizeInput
                value={gapY}
                onChange={(v) => setContent("gapY", v)}
                placeholder="auto"
                max={96}
              />
            </PropField>
          </div>
          <PropField label={t("builder.sectionLabelEditor.arrowType")}>
            <MiniSelect
              value={arrow}
              onChange={(v) => setContent("arrow", v)}
              options={SECTION_LABEL_ARROWS}
            />
          </PropField>
        </div>
      )}

      <PropField label={t("builder.sectionLabelEditor.linkText", { lang: lang.toUpperCase() })}>
        <Input
          value={action}
          onChange={(e) => setContent(actionKey, e.target.value)}
          placeholder={t("builder.sectionLabelEditor.more")}
          className="h-8 text-xs"
        />
      </PropField>
      <PropField label={t("builder.sectionLabelEditor.linkUrl")}>
        <Input
          value={href}
          onChange={(e) => setContent("href", e.target.value)}
          placeholder={t("builder.sectionLabelEditor.linkUrlPh")}
          className="h-8 text-xs"
        />
      </PropField>

      <div className="space-y-2 pt-2 border-t border-border">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {t("builder.sectionLabelEditor.headingTextStyle")}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <PropField label={t("builder.sectionLabelEditor.textColor")}>
            <AdminColorPicker
              value={labelColor}
              onChange={(v) => setContent("labelColor", v ?? "")}
              allowTransparent={false}
              allowReset={true}
              placeholder="auto"
            />
          </PropField>
          <PropField label={t("builder.sectionLabelEditor.size16")}>
            <PxSizeInput
              value={labelSize}
              onChange={(v) => setContent("labelSize", v)}
              placeholder="auto"
            />
          </PropField>
        </div>

        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground pt-1">
          {t("builder.sectionLabelEditor.moreLinkStyle")}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <PropField label={t("builder.sectionLabelEditor.textColor")}>
            <AdminColorPicker
              value={actionColor}
              onChange={(v) => setContent("actionColor", v ?? "")}
              allowTransparent={false}
              allowReset={true}
              placeholder="auto"
            />
          </PropField>
          <PropField label={t("builder.sectionLabelEditor.size12")}>
            <PxSizeInput
              value={actionSize}
              onChange={(v) => setContent("actionSize", v)}
              placeholder="auto"
            />
          </PropField>
        </div>
      </div>
    </div>
  );
}
