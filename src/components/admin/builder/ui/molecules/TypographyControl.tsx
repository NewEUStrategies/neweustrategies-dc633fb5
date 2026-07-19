// Molecule: full typography editor block (font family, unified size,
// weight, style, line-height, letter-spacing, transform, decoration).
// Font size is a single value applied identically on desktop / tablet / mobile.
import type { Device, WidgetTypography } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { PropField } from "../atoms/PropField";
import { FontPicker } from "@/components/admin/settings/FontPicker";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-builder";

interface Props {
  value: WidgetTypography | undefined;
  device: Device;
  onChange: (next: WidgetTypography) => void;
}

export function TypographyControl({ value, onChange }: Props) {
  const { t } = useTranslation();
  const v = value ?? {};
  const set = (patch: Partial<WidgetTypography>) => {
    const next = { ...v, ...patch } as WidgetTypography;
    for (const key of Object.keys(next) as Array<keyof WidgetTypography>) {
      if (next[key] === undefined || next[key] === "") delete next[key];
    }
    onChange(next);
  };

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

  const rawDesc =
    v.descriptionFontSize?.desktop ??
    v.descriptionFontSize?.tablet ??
    v.descriptionFontSize?.mobile ??
    "";
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
    placeholder = "16",
    unitLabel = "px",
    step = 1,
  ) => (
    <div className="relative">
      <Input
        value={current}
        inputMode="numeric"
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => setter(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setter(String((parseInt(current || "0", 10) || 0) + step));
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            const next = (parseInt(current || "0", 10) || 0) - step;
            setter(next >= 0 ? String(next) : "");
          }
        }}
        className="h-8 text-xs pr-12"
      />
      <span className="pointer-events-none absolute right-7 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
        {unitLabel}
      </span>
      <div className="absolute right-0 top-0 h-8 w-6 flex flex-col border-l border-border">
        <button
          type="button"
          tabIndex={-1}
          aria-label={t("builder.stepper.increase")}
          onClick={() => setter(String((parseInt(current || "0", 10) || 0) + step))}
          className="flex-1 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition"
        >
          <ChevronUp className="w-3 h-3" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label={t("builder.stepper.decrease")}
          onClick={() => {
            const next = (parseInt(current || "0", 10) || 0) - step;
            setter(next >= 0 ? String(next) : "");
          }}
          className="flex-1 flex items-center justify-center border-t border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition"
        >
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>
    </div>
  );

  const lineHeightPx = String(v.lineHeight ?? "").replace(/[^0-9]/g, "");
  const setLineHeightPx = (raw: string) => {
    const digits = raw.replace(/[^0-9]/g, "");
    set({ lineHeight: digits ? `${digits}px` : undefined });
  };
  const letterSpacingPx = String(v.letterSpacing ?? "").replace(/[^0-9-]/g, "");
  const setLetterSpacingPx = (raw: string) => {
    const digits = raw.replace(/[^0-9-]/g, "");
    set({ letterSpacing: digits ? `${digits}px` : undefined });
  };

  return (
    <div className="space-y-2">
      <PropField label={t("builder.typographyControl.fontFamily")}>
        <FontPicker value={v.fontFamily} onChange={(stack) => set({ fontFamily: stack })} />
      </PropField>

      <div className="grid grid-cols-2 gap-2">
        <PropField label={t("builder.typographyControl.titleSize")}>
          {renderSizeInput(unifiedPx, setUnifiedSize, t("builder.typographyControl.titleSizeAria"))}
        </PropField>
        <PropField label={t("builder.typographyControl.descSize")}>
          {renderSizeInput(descPx, setDescSize, t("builder.typographyControl.descSizeAria"))}
        </PropField>
      </div>

      <PropField label={t("builder.typographyControl.gap")}>
        {renderSizeInput(
          typeof v.titleDescriptionGapPx === "number" ? String(v.titleDescriptionGapPx) : "",
          (raw) => {
            const digits = raw.replace(/[^0-9]/g, "");
            if (!digits) {
              set({ titleDescriptionGapPx: undefined });
              return;
            }
            set({ titleDescriptionGapPx: Math.max(0, Math.min(200, Number(digits) || 0)) });
          },
          t("builder.typographyControl.gapAria"),
          "16",
          "px",
          4,
        )}
      </PropField>

      <PropField label={t("builder.spacing.align")}>
        <div className="inline-flex rounded border border-border bg-muted/30 p-0.5 w-full">
          {(
            [
              { v: "left", Icon: AlignLeft, label: t("builder.common.left") },
              { v: "center", Icon: AlignCenter, label: t("builder.common.center") },
              { v: "right", Icon: AlignRight, label: t("builder.common.right") },
              { v: "justify", Icon: AlignJustify, label: t("builder.typographyControl.justify") },
            ] as const
          ).map(({ v: val, Icon, label }) => {
            const active = v.textAlign === val;
            return (
              <button
                key={val}
                type="button"
                title={label}
                onClick={() => set({ textAlign: active ? undefined : val })}
                className={`flex-1 inline-flex items-center justify-center h-7 text-[11px] rounded transition ${
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
              </button>
            );
          })}
        </div>
      </PropField>

      <div className="grid grid-cols-2 gap-2">
        <PropField label={t("builder.typographyControl.weight")}>
          <Select
            value={v.fontWeight ?? "__unset"}
            onValueChange={(w) => set({ fontWeight: w === "__unset" ? undefined : w })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="-" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__unset">-</SelectItem>
              {["300", "400", "500", "600", "700", "800", "900"].map((w) => (
                <SelectItem key={w} value={w}>
                  {w}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PropField>
        <PropField label={t("builder.shape.style")}>
          <Select
            value={v.fontStyle ?? "normal"}
            onValueChange={(s) => set({ fontStyle: s as "normal" | "italic" })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="normal">{t("builder.typographyControl.styleNormal")}</SelectItem>
              <SelectItem value="italic">{t("builder.typographyControl.styleItalic")}</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <PropField label={t("builder.typographyControl.lineHeight")}>
          {renderSizeInput(
            lineHeightPx,
            setLineHeightPx,
            t("builder.typographyControl.lineHeightAria"),
            "24",
            "px",
          )}
        </PropField>
        <PropField label={t("builder.typographyControl.letterSpacing")}>
          {renderSizeInput(
            letterSpacingPx,
            setLetterSpacingPx,
            t("builder.typographyControl.letterSpacingAria"),
            "0",
            "px",
          )}
        </PropField>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <PropField label={t("builder.typographyControl.textTransform")}>
          <Select
            value={v.textTransform ?? "none"}
            onValueChange={(t) =>
              set({
                textTransform: t as "none" | "uppercase" | "lowercase" | "capitalize",
              })
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("builder.typographyControl.ttNone")}</SelectItem>
              <SelectItem value="uppercase">{t("builder.typographyControl.ttUpper")}</SelectItem>
              <SelectItem value="lowercase">{t("builder.typographyControl.ttLower")}</SelectItem>
              <SelectItem value="capitalize">
                {t("builder.typographyControl.ttCapitalize")}
              </SelectItem>
            </SelectContent>
          </Select>
        </PropField>
        <PropField label={t("builder.typographyControl.decoration")}>
          <Select
            value={v.textDecoration ?? "none"}
            onValueChange={(t) =>
              set({
                textDecoration: t as "none" | "underline" | "line-through",
              })
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("builder.common.none")}</SelectItem>
              <SelectItem value="underline">
                {t("builder.typographyControl.decUnderline")}
              </SelectItem>
              <SelectItem value="line-through">
                {t("builder.typographyControl.decLineThrough")}
              </SelectItem>
            </SelectContent>
          </Select>
        </PropField>
      </div>
    </div>
  );
}
