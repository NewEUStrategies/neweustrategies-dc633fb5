// Widget properties panel: Content / Style / Advanced tabs.
// Composed from atomic-design molecules:
//   - SpacingControl     -> padding / margin / align
//   - TypographyControl  -> font family/size/weight/style/decoration
//   - MotionControl      -> enter animation preset + duration/delay
//   - VisibilityControl  -> per-device hide
//   - ColorField         -> bg / text colors with native picker
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-builder";
import type {
  WidgetNode,
  CommonStyle,
  AdvancedSettings,
  Device,
  Json,
  WidgetTypography,
  Mode,
  Themed,
  HoverStyle,
} from "@/lib/builder/types";
import { WIDGETS } from "@/lib/builder/registry";
import {
  pickMode,
  setMode as setThemedMode,
  isModeOverridden,
  isThemedValue,
} from "@/lib/builder/themed";
import { broadcastWidgetTypography } from "@/lib/builder/liveTypography";
import { Sun, Moon, Undo as RotateCcw, Globe, Link2Off, Minus, Plus } from "@/lib/lucide-shim";
import { useGlobalWidgetMeta } from "@/lib/builder/globalWidgets";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { PropField, ColorField, StepperInput } from "./ui/atoms";
import { PositionAnchor } from "./ui/atoms/PositionAnchor";
import { SpacingControl } from "./ui/molecules/SpacingControl";
import { TypographyControl } from "./ui/molecules/TypographyControl";
import { MotionControl } from "./ui/molecules/MotionControl";
import { VisibilityControl } from "./ui/molecules/VisibilityControl";
import { AccessControl } from "./ui/molecules/AccessControl";
import { HoverControl } from "./ui/molecules/HoverControl";
import { SchemaFieldControl } from "./ui/molecules/SchemaFieldControl";
import { LinkPicker } from "./ui/molecules/LinkPicker";

import { WIDGET_SCHEMAS } from "@/lib/builder/schemas";
import {
  EDIT_TARGET_META,
  FOCUS_SIZE_FIELD_EVENT,
  FORM_SIZE_FIELDS,
  escapeAttrSelector,
  measureEditTargetPx,
} from "@/lib/builder/editTargets";
import {
  AccordionEditor,
  TabsEditor,
  TimelineEditor,
  PricingEditor,
  RatedListEditor,
  ImageEditor,
  SectionLabelEditor,
  SliderEditor,
  AnimatedHeadingEditor,
  PostListEditor,
  MegaMenuEditor,
  RichTextEditor,
  AccountLinkEditor,
  HeadingFallbackPreview,
  TeamMemberEditor,
  InteractiveCircleEditor,
} from "./ui/organisms/widget-properties";

interface Props {
  widget: WidgetNode;
  lang: "pl" | "en";
  device: Device;
  mode?: Mode;
  onModeChange?: (m: Mode) => void;
  onChange: (mut: (w: WidgetNode) => void) => void;
}

export function WidgetProperties({
  widget,
  lang,
  device,
  mode = "light",
  onModeChange,
  onChange,
}: Props) {
  const { t } = useTranslation();
  const md = () =>
    mode === "dark" ? t("builder.widgetProps.modeDark") : t("builder.widgetProps.modeLight");
  const setContent = (k: string, v: Json) =>
    onChange((w) => {
      w.content = w.content ?? {};
      w.content[k] = v;
    });
  const setOptionalNumberContent = (k: string, v: number | null) =>
    onChange((w) => {
      const content = { ...(w.content ?? {}) } as Record<string, Json>;
      if (v === null) delete content[k];
      else content[k] = v;
      w.content = content;
    });
  const setStyle = (mut: (s: CommonStyle) => void) =>
    onChange((w) => {
      w.style = w.style ?? {};
      mut(w.style);
    });
  const setAdvanced = (mut: (a: AdvancedSettings) => void) =>
    onChange((w) => {
      w.advanced = w.advanced ?? {};
      mut(w.advanced);
    });

  // ---- Themed (light/dark) helpers for color-style fields ----
  type ColorKey =
    | "bgColor"
    | "textColor"
    | "borderColor"
    | "iconColor"
    | "iconHoverColor"
    | "iconActiveColor";
  const getColor = (key: ColorKey): string | undefined =>
    pickMode<string>(widget.style?.[key] as Themed<string> | undefined, mode);
  const setColor = (key: ColorKey, v: string | undefined) =>
    setStyle((s) => {
      const prev = s[key] as Themed<string> | undefined;
      const next = setThemedMode<string>(prev, mode, v);
      (s[key] as Themed<string> | undefined) = next;
    });
  const isOverridden = (key: ColorKey): boolean =>
    isModeOverridden(widget.style?.[key] as Themed<string> | undefined, mode);
  const resetColor = (key: ColorKey) =>
    setStyle((s) => {
      const prev = s[key] as Themed<string> | undefined;
      if (prev == null) return;
      if (isThemedValue<string>(prev)) {
        const next = { ...prev };
        delete next[mode];
        if (next.light == null && next.dark == null) {
          delete (s as Record<string, unknown>)[key];
        } else {
          (s[key] as Themed<string> | undefined) = next;
        }
      } else {
        // Flat value applies to both modes - reset removes it entirely.
        delete (s as Record<string, unknown>)[key];
      }
    });

  // ---- Shared (non-themed) read/write for dimension / border / shadow fields.
  // These are intentionally NOT per-mode: only colors differ between light
  // and dark. Border radius, width, shadow strength etc. stay identical.
  type StringStyleKey = "borderRadius" | "borderWidth" | "boxShadow";
  const getFlatStr = (key: StringStyleKey): string => {
    const v = widget.style?.[key];
    // Back-compat: if a legacy themed value exists, surface whichever side is set.
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = v as { light?: string; dark?: string };
      return (o.light ?? o.dark ?? "") as string;
    }
    return typeof v === "string" ? v : "";
  };
  const setFlatStr = (key: StringStyleKey, v: string | undefined) =>
    setStyle((s) => {
      (s as Record<string, unknown>)[key] = v && v.length ? v : undefined;
    });
  const getFlatBorderStyle = (): string => {
    const v = widget.style?.borderStyle as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = v as { light?: string; dark?: string };
      return (o.light ?? o.dark ?? "none") as string;
    }
    return typeof v === "string" ? v : "none";
  };
  const setFlatBorderStyle = (v: CommonStyle["borderStyle"] | undefined) =>
    setStyle((s) => {
      (s as Record<string, unknown>).borderStyle = v ?? undefined;
    });

  // Typography metrics are shared between light/dark modes. Only colors are
  // mode-specific. Store typography as a flat object so editing in dark mode
  // immediately changes the same source of truth used by the renderer.
  const getThemedTypography = (): WidgetTypography | undefined =>
    pickMode<WidgetTypography>(
      widget.style?.typography as Themed<WidgetTypography> | undefined,
      mode,
    ) ??
    pickMode<WidgetTypography>(
      widget.style?.typography as Themed<WidgetTypography> | undefined,
      mode === "dark" ? "light" : "dark",
    );
  const setThemedTypography = (t: WidgetTypography | undefined) => {
    const next = t && Object.keys(t).length ? t : undefined;
    broadcastWidgetTypography(widget.id, next);
    setStyle((s) => {
      s.typography = next;
    });
  };

  // ---- Themed hover colors ----
  const hoverValue: HoverStyle | undefined = (() => {
    const h = widget.style?.hover;
    if (!h) return undefined;
    return {
      ...h,
      bgColor: pickMode<string>(h.bgColor as Themed<string> | undefined, mode),
      textColor: pickMode<string>(h.textColor as Themed<string> | undefined, mode),
    };
  })();
  const onHoverChange = (next: HoverStyle | undefined) =>
    setStyle((s) => {
      if (!next) {
        s.hover = undefined;
        return;
      }
      const prev = s.hover ?? {};
      const merged: HoverStyle = { ...prev, ...next };
      // Re-wrap themed color fields so they preserve the other mode's value.
      if ("bgColor" in next) {
        const v = setThemedMode<string>(
          prev.bgColor as Themed<string> | undefined,
          mode,
          next.bgColor,
        );
        (merged.bgColor as Themed<string> | undefined) = v;
      }
      if ("textColor" in next) {
        const v = setThemedMode<string>(
          prev.textColor as Themed<string> | undefined,
          mode,
          next.textColor,
        );
        (merged.textColor as Themed<string> | undefined) = v;
      }
      s.hover = merged;
    });

  // Resolve inherited colors from the actually rendered widget DOM (global colors cascade).
  const inherited = useInheritedColors(widget.id, mode, widget.style);

  const widgetLabel = WIDGETS.find((w) => w.type === widget.type)?.label ?? widget.type;

  const highlightPreviewTarget = (key: string) => {
    if (typeof document === "undefined") return;
    const root = document.querySelector<HTMLElement>(
      `[data-widget-id="${escapeAttrSelector(widget.id)}"]`,
    );
    const targets = root?.querySelectorAll<HTMLElement>(
      `[data-edit-target="${escapeAttrSelector(key)}"]`,
    );
    if (!targets?.length) return;
    targets.forEach((el) => {
      el.classList.add("cms-preview-field-focus");
      window.setTimeout(() => el.classList.remove("cms-preview-field-focus"), 900);
    });
  };

  const [activeTab, setActiveTab] = useState<string>("content");

  // Effective (computed) px per size key, measured from the live canvas DOM.
  // Shown as the stepper placeholder so the CURRENT font size is always
  // visible even when no override is stored ("auto").
  const sizeFields = FORM_SIZE_FIELDS[widget.type];
  const effectiveSizes = useEffectiveSizes(widget.id, sizeFields, widget.content);

  // Bridge from the canvas InlineSizeToolbar's "Panel" button: reveal the
  // Style tab and flash the matching stepper.
  useEffect(() => {
    const onFocusField = (e: Event) => {
      const key = (e as CustomEvent<{ key?: string }>).detail?.key;
      if (!key) return;
      setActiveTab("style");
      window.requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(
          `[data-field-key="${escapeAttrSelector(key)}"]`,
        );
        if (!el) return;
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        el.classList.add("cms-panel-field-focus");
        window.setTimeout(() => el.classList.remove("cms-panel-field-focus"), 1600);
      });
    };
    window.addEventListener(FOCUS_SIZE_FIELD_EVENT, onFocusField);
    return () => window.removeEventListener(FOCUS_SIZE_FIELD_EVENT, onFocusField);
  }, []);

  return (
    <div className="wp-compact">
      <style>{`.cms-preview-field-focus{outline:2px solid var(--brand) !important;outline-offset:3px;border-radius:4px;box-shadow:0 0 0 4px color-mix(in oklab, var(--brand) 25%, transparent);transition:outline-color .15s, box-shadow .15s;}
.cms-panel-field-focus{outline:2px solid var(--brand);outline-offset:2px;border-radius:6px;transition:outline-color .2s;}`}</style>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="mb-1.5 px-0.5">
          <div className="text-[9px] uppercase tracking-wide text-muted-foreground">Widget</div>
          <div className="text-[12px] font-medium truncate">{widgetLabel}</div>
        </div>
        {widget.globalId && (
          <GlobalWidgetBanner
            globalId={widget.globalId}
            onUnlink={() =>
              onChange((w) => {
                delete w.globalId;
              })
            }
          />
        )}
        <div className="mb-2 px-0.5">
          <div className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1">
            Pozycja
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() =>
                setAdvanced((a) => {
                  a.layout = undefined;
                })
              }
              className={`flex-1 h-7 px-2 text-[11px] rounded border ${(widget.advanced?.layout ?? "block") === "block" ? "border-brand bg-brand/10 text-brand" : "border-border bg-background"}`}
              title={t("builder.widgetProps.blockLayoutTitle")}
            >
              {t("builder.widgetProps.block")}
            </button>
            <button
              type="button"
              onClick={() =>
                setAdvanced((a) => {
                  a.layout = "inline";
                })
              }
              className={`flex-1 h-7 px-2 text-[11px] rounded border ${widget.advanced?.layout === "inline" ? "border-brand bg-brand/10 text-brand" : "border-border bg-background"}`}
              title={t("builder.widgetProps.inlineLayoutTitle")}
            >
              {t("builder.widgetProps.inline")}
            </button>
          </div>
        </div>
        <TabsList className="grid grid-cols-3 w-full h-6">
          <TabsTrigger value="content" className="text-[11px]">
            {t("builder.widgetProps.tabContent")}
          </TabsTrigger>
          <TabsTrigger value="style" className="text-[11px]">
            {t("builder.widgetProps.tabStyle")}
          </TabsTrigger>
          <TabsTrigger value="advanced" className="text-[11px]">
            {t("builder.widgetProps.tabAdvanced")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="content" className="space-y-2 mt-2">
          <ContentFields widget={widget} lang={lang} setContent={setContent} />
        </TabsContent>

        <TabsContent value="style" className="space-y-4 mt-3">
          {/* Light / Dark mode tabs - synced with global preview switcher */}
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
              {t("builder.widgetProps.editingDevice", { device })}
            </div>
            <div
              className="inline-flex items-center rounded border border-border bg-muted p-0.5"
              role="group"
              aria-label={t("builder.widgetProps.mode")}
            >
              {(
                [
                  ["light", Sun, t("builder.chrome.light")],
                  ["dark", Moon, t("builder.chrome.dark")],
                ] as const
              ).map(([m, Icon, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onModeChange?.(m)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-sm transition ${
                    mode === m
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* ═══════════════ GROUP: Appearance ═══════════════ */}
          <div className="rounded-md border border-border bg-muted/20 px-2 py-1.5 -mx-1">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/80 flex items-center gap-2">
              <span className="h-1 w-1 rounded-full bg-brand" />
              {t("builder.widgetProps.appearance")}
              <span className="text-muted-foreground/60 font-normal normal-case tracking-normal text-[9px]">
                {t("builder.widgetProps.appearanceSub")}
              </span>
            </div>
          </div>

          <section className="space-y-2">
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("builder.widgetProps.typography")} ({md()})
            </h4>

            <TypographyControl
              value={getThemedTypography()}
              device={device}
              onChange={(typography: WidgetTypography) => setThemedTypography(typography)}
            />
          </section>

          {sizeFields && (
            <section className="space-y-2 pt-2 border-t border-border">
              <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {t("builder.widgetProps.formSizes")}
              </h4>
              <p className="text-[10px] text-muted-foreground -mt-1">
                {t("builder.widgetProps.formSizesHint")}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {sizeFields.map((f) => {
                  const meta = EDIT_TARGET_META[f.key];
                  const raw = (widget.content as Record<string, Json> | undefined)?.[f.key];
                  const v = typeof raw === "number" ? raw : "";
                  return (
                    <div key={f.key} data-field-key={f.key}>
                      <FormElementSizeField
                        label={meta.label}
                        value={v}
                        min={meta.min}
                        max={meta.max}
                        effectivePx={effectiveSizes[f.key] ?? meta.fallbackPx}
                        onPreview={() => highlightPreviewTarget(f.key)}
                        onChange={(next) => {
                          setOptionalNumberContent(f.key, next);
                          highlightPreviewTarget(f.key);
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="space-y-2 pt-2 border-t border-border">
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("builder.widgetProps.colors")} ({md()})
            </h4>
            <ThemedColorField
              label={t("builder.widgetProps.bg")}
              value={getColor("bgColor")}
              onChange={(v) => setColor("bgColor", v)}
              overridden={isOverridden("bgColor")}
              onReset={() => resetColor("bgColor")}
              placeholderHint={t("builder.widgetProps.inheritGlobal")}
              inheritedValue={inherited.bgColor}
            />
            <ThemedColorField
              label={t("builder.widgetProps.text")}
              value={getColor("textColor")}
              onChange={(v) => setColor("textColor", v)}
              overridden={isOverridden("textColor")}
              onReset={() => resetColor("textColor")}
              placeholderHint={t("builder.widgetProps.inheritGlobal")}
              inheritedValue={inherited.textColor}
            />
          </section>

          <section className="space-y-2 pt-2 border-t border-border">
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {lang === "en" ? "Icons" : "Ikony"} ({md()})
            </h4>
            <p className="text-[10px] text-muted-foreground -mt-1">
              {lang === "en"
                ? "Colors for SVG icons: default, hover, and active (current page)."
                : "Kolory ikon SVG: domyślny, po najechaniu i aktywny (bieżąca strona)."}
            </p>
            <ThemedColorField
              label={lang === "en" ? "Default" : "Domyślny"}
              value={getColor("iconColor")}
              onChange={(v) => setColor("iconColor", v)}
              overridden={isOverridden("iconColor")}
              onReset={() => resetColor("iconColor")}
              placeholderHint={
                lang === "en" ? "inherits from text color" : "dziedziczy z koloru tekstu"
              }
            />
            <ThemedColorField
              label={lang === "en" ? "Hover" : "Po najechaniu"}
              value={getColor("iconHoverColor")}
              onChange={(v) => setColor("iconHoverColor", v)}
              overridden={isOverridden("iconHoverColor")}
              onReset={() => resetColor("iconHoverColor")}
              placeholderHint={lang === "en" ? "inherits from default" : "dziedziczy z domyślnego"}
            />
            <ThemedColorField
              label={lang === "en" ? "Active (current page)" : "Aktywny (bieżąca strona)"}
              value={getColor("iconActiveColor")}
              onChange={(v) => setColor("iconActiveColor", v)}
              overridden={isOverridden("iconActiveColor")}
              onReset={() => resetColor("iconActiveColor")}
              placeholderHint={lang === "en" ? "inherits from hover" : "dziedziczy z hover"}
            />
          </section>

          {widget.type === "dark-featured-card" && (
            <section className="space-y-2 pt-2 border-t border-border">
              <h4 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {t("builder.widgetProps.badgeLabel")}
              </h4>
              <div className="grid grid-cols-2 gap-2">
                <PropField label={t("builder.widgetProps.variant")}>
                  <Select
                    value={(widget.content?.badgeVariant as string) || "solid-red"}
                    onValueChange={(v) => setContent("badgeVariant", v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[
                        { v: "solid-red", l: t("builder.widgetProps.badgeSolidRed") },
                        { v: "solid-brand", l: t("builder.widgetProps.badgeSolidBrand") },
                        { v: "solid-dark", l: t("builder.widgetProps.badgeSolidDark") },
                        { v: "outline", l: t("builder.widgetProps.badgeOutline") },
                        { v: "ghost", l: t("builder.widgetProps.badgeGhost") },
                        { v: "gradient", l: "Gradient" },
                      ].map((o) => (
                        <SelectItem key={o.v} value={o.v} className="text-xs">
                          {o.l}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </PropField>
                <PropField label={t("builder.widgetProps.rounding")}>
                  <Select
                    value={(widget.content?.badgeRadius as string) || "none"}
                    onValueChange={(v) => setContent("badgeRadius", v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[
                        { v: "none", l: t("builder.widgetProps.radiusNone") },
                        { v: "sm", l: t("builder.widgetProps.radiusSm") },
                        { v: "md", l: t("builder.widgetProps.radiusMd") },
                        { v: "lg", l: t("builder.widgetProps.radiusLg") },
                        { v: "full", l: "Pill" },
                      ].map((o) => (
                        <SelectItem key={o.v} value={o.v} className="text-xs">
                          {o.l}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </PropField>
                <PropField label={t("builder.widgetProps.size")}>
                  <Select
                    value={(widget.content?.badgeSize as string) || "xs"}
                    onValueChange={(v) => setContent("badgeSize", v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[
                        { v: "xs", l: "XS" },
                        { v: "sm", l: "S" },
                        { v: "md", l: "M" },
                      ].map((o) => (
                        <SelectItem key={o.v} value={o.v} className="text-xs">
                          {o.l}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </PropField>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <PropField label={t("builder.widgetProps.badgeBg")}>
                  <ColorField
                    value={(widget.content?.badgeBg as string) || ""}
                    onChange={(v) => setContent("badgeBg", v || "")}
                  />
                </PropField>
                <PropField label={t("builder.widgetProps.badgeText")}>
                  <ColorField
                    value={(widget.content?.badgeText as string) || ""}
                    onChange={(v) => setContent("badgeText", v || "")}
                  />
                </PropField>
              </div>
              <div className="text-[10px] text-muted-foreground">
                {t("builder.widgetProps.badgeHint")}
              </div>
            </section>
          )}

          <section className="space-y-2 pt-2 border-t border-border">
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("builder.widgetProps.cornerRounding")}
            </h4>
            <PropField label={t("builder.widgetProps.radiusPx")}>
              <StepperInput
                value={getFlatStr("borderRadius")}
                placeholder="8px"
                min={0}
                onChange={(v) => setFlatStr("borderRadius", v ?? "")}
              />
            </PropField>
          </section>

          <section className="space-y-2 pt-2 border-t border-border">
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("builder.widgetProps.border")}
            </h4>
            <div className="grid grid-cols-2 gap-2">
              <PropField label={t("builder.widgetProps.style")}>
                <Select
                  value={getFlatBorderStyle()}
                  onValueChange={(v) =>
                    setFlatBorderStyle(v === "none" ? undefined : (v as CommonStyle["borderStyle"]))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[
                      { v: "none", l: t("builder.widgetProps.radiusNone") },
                      { v: "solid", l: t("builder.widgetProps.borderSolid") },
                      { v: "dashed", l: t("builder.widgetProps.borderDashed") },
                      { v: "dotted", l: t("builder.widgetProps.borderDotted") },
                      { v: "double", l: t("builder.widgetProps.borderDouble") },
                    ].map((o) => (
                      <SelectItem key={o.v} value={o.v} className="text-xs">
                        {o.l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </PropField>
              <PropField label={t("builder.widgetProps.thickness")}>
                <StepperInput
                  value={getFlatStr("borderWidth")}
                  placeholder="1px"
                  min={0}
                  onChange={(v) => setFlatStr("borderWidth", v ?? "")}
                />
              </PropField>
            </div>
            <ThemedColorField
              label={`${t("builder.widgetProps.color")} (${md()})`}
              value={getColor("borderColor")}
              onChange={(v) => setColor("borderColor", v)}
              overridden={isOverridden("borderColor")}
              onReset={() => resetColor("borderColor")}
              placeholderHint={t("builder.widgetProps.inheritGlobal")}
              inheritedValue={inherited.borderColor}
            />
          </section>

          <section className="space-y-2 pt-2 border-t border-border">
            <h4 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Hover ({md()})
            </h4>

            <HoverControl value={hoverValue} onChange={onHoverChange} />
          </section>

          {/* ═══════════════ GROUP: Layout ═══════════════ */}
          <div className="rounded-md border border-border bg-muted/20 px-2 py-1.5 -mx-1 mt-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/80 flex items-center gap-2">
              <span className="h-1 w-1 rounded-full bg-brand" />
              {t("builder.widgetProps.layout")}
              <span className="text-muted-foreground/60 font-normal normal-case tracking-normal text-[9px]">
                {t("builder.widgetProps.layoutSub")}
              </span>
            </div>
          </div>

          <section className="space-y-2">
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("builder.widgetProps.spacing")}
            </h4>
            <SpacingControl style={widget.style} device={device} onChange={setStyle} />
            <PropField label={t("builder.widgetProps.cellPosition")}>
              <PositionAnchor
                justify={widget.style?.selfJustify}
                align={widget.style?.selfAlign}
                onChange={({ justify, align }) =>
                  setStyle((s) => {
                    s.selfJustify = justify;
                    s.selfAlign = align;
                  })
                }
              />
            </PropField>
          </section>
        </TabsContent>

        <TabsContent value="advanced" className="space-y-4 mt-3">
          <section className="space-y-2">
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("builder.widgetProps.identifiers")}
            </h4>
            <PropField label="HTML ID">
              <Input
                value={widget.advanced?.htmlId ?? ""}
                onChange={(e) =>
                  setAdvanced((a) => {
                    a.htmlId = e.target.value || undefined;
                  })
                }
                className="h-8 text-xs"
              />
            </PropField>
            <PropField label="CSS class">
              <Input
                value={widget.advanced?.cssClass ?? ""}
                onChange={(e) =>
                  setAdvanced((a) => {
                    a.cssClass = e.target.value || undefined;
                  })
                }
                className="h-8 text-xs"
              />
            </PropField>
          </section>

          <section className="space-y-2 pt-2 border-t border-border">
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("builder.widgetProps.positionRelative")}
            </h4>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() =>
                  setAdvanced((a) => {
                    a.layout = undefined;
                  })
                }
                className={`flex-1 h-8 px-2 text-xs rounded border ${(widget.advanced?.layout ?? "block") === "block" ? "border-brand bg-brand/10 text-brand" : "border-border bg-background"}`}
                title={t("builder.widgetProps.blockLayoutTitle")}
              >
                {t("builder.widgetProps.blockFull")}
              </button>
              <button
                type="button"
                onClick={() =>
                  setAdvanced((a) => {
                    a.layout = "inline";
                  })
                }
                className={`flex-1 h-8 px-2 text-xs rounded border ${widget.advanced?.layout === "inline" ? "border-brand bg-brand/10 text-brand" : "border-border bg-background"}`}
                title={t("builder.widgetProps.inlineLayoutTitle")}
              >
                {t("builder.widgetProps.inlineRow")}
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {t("builder.widgetProps.adjacentHint")}
            </p>
          </section>

          <section className="space-y-2 pt-2 border-t border-border">
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("builder.widgetProps.contentInside")}
            </h4>
            <PropField label={t("builder.widgetProps.maxContentWidth")}>
              <Input
                type="number"
                min={0}
                placeholder={t("builder.widgetProps.fullWidth")}
                value={
                  typeof widget.advanced?.contentMaxWidth === "number"
                    ? widget.advanced.contentMaxWidth
                    : ""
                }
                onChange={(e) =>
                  setAdvanced((a) => {
                    const n = e.target.value === "" ? undefined : Number(e.target.value);
                    a.contentMaxWidth = n && n > 0 ? n : undefined;
                  })
                }
                className="h-8 text-xs"
              />
            </PropField>
            <PropField label={t("builder.widgetProps.contentAlign")}>
              <div className="flex gap-1">
                {(["start", "center", "end"] as const).map((v) => {
                  const active = (widget.advanced?.contentAlign ?? "start") === v;
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() =>
                        setAdvanced((a) => {
                          a.contentAlign = v === "start" ? undefined : v;
                        })
                      }
                      className={`flex-1 h-8 px-2 text-xs rounded border ${active ? "border-brand bg-brand/10 text-brand" : "border-border bg-background"}`}
                    >
                      {v === "start"
                        ? t("builder.common.left")
                        : v === "center"
                          ? t("builder.common.center")
                          : t("builder.common.right")}
                    </button>
                  );
                })}
              </div>
            </PropField>
            <PropField label={t("builder.widgetProps.itemGap")}>
              <Input
                type="number"
                min={0}
                placeholder={t("builder.widgetProps.defaultPh")}
                value={
                  typeof widget.advanced?.contentGap === "number" ? widget.advanced.contentGap : ""
                }
                onChange={(e) =>
                  setAdvanced((a) => {
                    const n = e.target.value === "" ? undefined : Number(e.target.value);
                    a.contentGap = typeof n === "number" && n >= 0 ? n : undefined;
                  })
                }
                className="h-8 text-xs"
              />
            </PropField>
            <p className="text-[10px] text-muted-foreground">
              {t("builder.widgetProps.contentInsideHint")}
            </p>
          </section>

          <section className="space-y-2 pt-2 border-t border-border">
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Motion
            </h4>
            <MotionControl value={widget.advanced} onChange={setAdvanced} />
          </section>

          <section className="space-y-2 pt-2 border-t border-border">
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("builder.widgetProps.visibility")}
            </h4>
            <VisibilityControl value={widget.advanced} onChange={setAdvanced} />
          </section>

          <section className="space-y-2 pt-2 border-t border-border">
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("builder.widgetProps.access")}
            </h4>
            <AccessControl value={widget.advanced} onChange={setAdvanced} />
          </section>

          <section className="space-y-2 pt-2 border-t border-border">
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("builder.widgetProps.widgetLink")}
            </h4>
            <p className="text-[10px] text-muted-foreground -mt-1">
              {t("builder.widgetProps.widgetLinkHint")}
            </p>
            <LinkPicker
              value={widget.advanced?.link}
              lang={lang}
              onChange={(link) =>
                setAdvanced((a) => {
                  a.link = link;
                })
              }
            />
          </section>

          <section className="space-y-2 pt-2 border-t border-border">
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Custom CSS
            </h4>
            <Textarea
              rows={4}
              value={widget.advanced?.customCss ?? ""}
              onChange={(e) =>
                setAdvanced((a) => {
                  a.customCss = e.target.value || undefined;
                })
              }
              className="text-xs font-mono"
              placeholder=".my-class { color: red; }"
            />
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---- Themed color field: shows reset button + override dot when overridden ----
function ThemedColorField({
  label,
  value,
  onChange,
  overridden,
  onReset,
  placeholderHint,
  inheritedValue,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  overridden: boolean;
  onReset: () => void;
  placeholderHint?: string;
  inheritedValue?: string;
}) {
  const { t } = useTranslation();
  return (
    <PropField
      label={
        <span className="inline-flex items-center gap-1.5">
          {label}
          {overridden && (
            <span
              className="inline-block w-1.5 h-1.5 rounded-full bg-brand"
              aria-label={t("builder.widgetProps.overridden")}
              title={t("builder.widgetProps.overriddenTitle")}
            />
          )}
          {overridden && (
            <button
              type="button"
              onClick={onReset}
              title={t("builder.widgetProps.restoreGlobal")}
              className="inline-flex items-center text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          )}
        </span>
      }
    >
      <ColorField
        value={value}
        onChange={onChange}
        placeholder={placeholderHint ?? "#000 / var(--brand) / transparent"}
        inheritedValue={inheritedValue}
      />
    </PropField>
  );
}

function FormElementSizeField({
  label,
  value,
  min,
  max,
  effectivePx,
  onChange,
  onPreview,
}: {
  label: string;
  value: number | "";
  min: number;
  max: number;
  /** Computed size measured from the canvas — the visible "auto" value. */
  effectivePx: number;
  onChange: (next: number | null) => void;
  onPreview: () => void;
}) {
  const { t } = useTranslation();
  const clamp = (next: number) => Math.max(min, Math.min(max, Math.round(next)));
  const numericValue = typeof value === "number" ? value : null;
  const isAuto = numericValue === null;
  const commit = (raw: string) => {
    if (raw.trim() === "") {
      onChange(null);
      return;
    }
    const next = Number(raw);
    if (Number.isNaN(next)) return;
    onChange(clamp(next));
  };
  // Stepping from "auto" starts at the CURRENT rendered size, not at `min` —
  // otherwise the first click visibly snapped tiny text sizes onto the form.
  const bump = (delta: number) => onChange(clamp((numericValue ?? effectivePx) + delta));

  return (
    <PropField
      label={
        <span className="inline-flex items-center gap-1">
          {label}
          {isAuto && (
            <span
              className="rounded bg-muted px-1 py-px text-[8px] font-bold uppercase tracking-wider text-muted-foreground"
              title={t("builder.widgetProps.noOverridePx", { px: effectivePx })}
            >
              auto
            </span>
          )}
        </span>
      }
    >
      <div className="flex items-center gap-1" onFocus={onPreview} onMouseEnter={onPreview}>
        <button
          type="button"
          onClick={() => bump(-1)}
          className="inline-flex h-8 w-7 shrink-0 items-center justify-center rounded border border-input text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={t("builder.widgetProps.decreaseLabel", { label })}
        >
          <Minus className="h-3 w-3" />
        </button>
        <Input
          type="number"
          min={min}
          max={max}
          value={value}
          placeholder={String(effectivePx)}
          onChange={(e) => commit(e.target.value)}
          className="h-8 text-center text-xs tabular-nums"
        />
        <button
          type="button"
          onClick={() => bump(1)}
          className="inline-flex h-8 w-7 shrink-0 items-center justify-center rounded border border-input text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={t("builder.widgetProps.increaseLabel", { label })}
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </PropField>
  );
}

// Measures the computed font-size of each edit-target inside the rendered
// canvas widget. Re-measures after content changes (next frame, so the DOM
// already reflects the edit).
function useEffectiveSizes(
  widgetId: string,
  fields: Array<{ key: string }> | undefined,
  content: unknown,
): Record<string, number | null> {
  const [sizes, setSizes] = useState<Record<string, number | null>>({});
  const keys = (fields ?? []).map((f) => f.key).join("|");
  useEffect(() => {
    if (!keys || typeof window === "undefined") return;
    let raf = 0;
    raf = window.requestAnimationFrame(() => {
      const next: Record<string, number | null> = {};
      for (const key of keys.split("|")) next[key] = measureEditTargetPx(widgetId, key);
      setSizes(next);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [widgetId, keys, content]);
  return sizes;
}

// Reads the actually-rendered widget element (data-widget-id="...") and returns
// the inherited bg / text / border colors via getComputedStyle. Recomputes when
// the widget id, mode or style changes (next animation frame, to let DOM update).
function useInheritedColors(
  widgetId: string,
  mode: Mode,
  style: CommonStyle | undefined,
): { bgColor?: string; textColor?: string; borderColor?: string } {
  const [v, setV] = useState<{ bgColor?: string; textColor?: string; borderColor?: string }>({});
  useEffect(() => {
    if (typeof window === "undefined") return;
    let raf = 0;
    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-widget-id="${CSS.escape(widgetId)}"]`);
      if (!el) {
        setV({});
        return;
      }
      const textTarget =
        el.querySelector<HTMLElement>(
          "h1,h2,h3,h4,h5,h6,p,span,a,button,li,blockquote,figcaption,[contenteditable='true']",
        ) ?? el;
      const cs = window.getComputedStyle(el);
      const tcs = window.getComputedStyle(textTarget);
      setV({
        bgColor: cs.backgroundColor || undefined,
        textColor: tcs.color || cs.color || undefined,
        borderColor: cs.borderColor || cs.borderTopColor || undefined,
      });
    };
    raf = window.requestAnimationFrame(measure);
    return () => window.cancelAnimationFrame(raf);
    // Re-run whenever style or mode changes so the preview reflects fresh cascade.
  }, [widgetId, mode, style]);
  return v;
}

function ContentFields({
  widget,
  lang,
  setContent,
}: {
  widget: WidgetNode;
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}) {
  const { t } = useTranslation();
  const c = widget.content;

  // Custom (list-style) editors for complex widgets.
  switch (widget.type) {
    case "accordion":
      return <AccordionEditor c={c} lang={lang} setContent={setContent} />;
    case "tabs":
      return <TabsEditor c={c} lang={lang} setContent={setContent} />;
    case "timeline":
      return <TimelineEditor c={c} lang={lang} setContent={setContent} />;
    case "pricing":
      return <PricingEditor c={c} lang={lang} setContent={setContent} />;
    case "image":
      return <ImageEditor c={c} lang={lang} setContent={setContent} />;
    case "rated-list":
      return <RatedListEditor c={c} lang={lang} setContent={setContent} />;
    case "section-label":
      return <SectionLabelEditor c={c} lang={lang} setContent={setContent} />;
    case "slider":
      return <SliderEditor c={c} lang={lang} setContent={setContent} />;
    case "animated-heading":
      return <AnimatedHeadingEditor c={c} lang={lang} setContent={setContent} />;
    case "post-list":
    case "carousel":
      return <PostListEditor c={c} lang={lang} setContent={setContent} />;
    case "mega-menu":
      return <MegaMenuEditor c={c} lang={lang} setContent={setContent} />;
    case "rich-text":
      return <RichTextEditor c={c} lang={lang} setContent={setContent} />;
    case "account-link":
      return <AccountLinkEditor c={c} lang={lang} setContent={setContent} />;
    case "ad-slot":
      return <AdSlotEditor c={c} setContent={setContent} />;
    case "team-member":
      return <TeamMemberEditor c={c} lang={lang} setContent={setContent} />;
    case "interactive-circle":
      return <InteractiveCircleEditor c={c} lang={lang} setContent={setContent} />;
  }

  // Schema-driven render for simple widgets.
  const schema = WIDGET_SCHEMAS[widget.type];
  if (!schema || schema.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        {t("builder.widgetProps.noEditableFields")}
      </div>
    );
  }
  return (
    <>
      {schema.map((f) => (
        <SchemaFieldControl key={f.key} field={f} lang={lang} content={c} setContent={setContent} />
      ))}
      {widget.type === "heading" ? (
        <HeadingFallbackPreview
          titleWeight={typeof c.titleWeight === "string" ? c.titleWeight : ""}
          subtitleWeight={typeof c.subtitleWeight === "string" ? c.subtitleWeight : ""}
          sizePx={typeof c.sizePx === "number" ? c.sizePx : 0}
          subtitleSizePx={typeof c.subtitleSizePx === "number" ? c.subtitleSizePx : 0}
          sizePreset={typeof c.sizePreset === "string" ? c.sizePreset : ""}
          titleSample={
            ((typeof c[`text_${lang}`] === "string" && c[`text_${lang}`]) as string) ||
            (typeof c.text_pl === "string" ? (c.text_pl as string) : "") ||
            t("builder.widgetProps.sampleHeading")
          }
          subtitleSample={
            ((typeof c[`subtitle_${lang}`] === "string" && c[`subtitle_${lang}`]) as string) ||
            (typeof c.subtitle_pl === "string" ? (c.subtitle_pl as string) : "") ||
            t("builder.widgetProps.sampleSubtitle")
          }
        />
      ) : null}
    </>
  );
}

function AdSlotEditor({
  c,
  setContent,
}: {
  c: Record<string, Json>;
  setContent: (k: string, v: Json) => void;
}) {
  const { t } = useTranslation();
  const [slots, setSlots] = useState<
    Array<{ id: string; name: string; kind: string; status: string }>
  >([]);
  useEffect(() => {
    let cancelled = false;
    void import("@/integrations/supabase/client").then(async ({ supabase }) => {
      const { data } = await supabase
        .from("ad_slots")
        .select("id, name, kind, status")
        .order("name");
      if (!cancelled) setSlots(data ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const value = typeof c.slotId === "string" ? c.slotId : "";
  return (
    <PropField label={t("builder.widgetProps.adSlot")}>
      <Select value={value} onValueChange={(v) => setContent("slotId", v)}>
        <SelectTrigger>
          <SelectValue placeholder={t("builder.widgetProps.pickSlot")} />
        </SelectTrigger>
        <SelectContent>
          {slots.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              {t("builder.widgetProps.noSlots")}
            </div>
          )}
          {slots.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name} {s.status !== "active" ? t("builder.widgetProps.paused") : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </PropField>
  );
}

/**
 * Banner shown for global-widget instances: every edit below synchronizes to
 * all pages referencing the global; "Odłącz" turns the instance into a local
 * copy (the snapshot stays, the reference is removed).
 */
function GlobalWidgetBanner({ globalId, onUnlink }: { globalId: string; onUnlink: () => void }) {
  const { t } = useTranslation();
  const meta = useGlobalWidgetMeta(globalId);
  return (
    <div className="mb-2 px-2 py-1.5 rounded border border-amber-500/50 bg-amber-500/10 space-y-1">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
        <Globe className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">{meta?.name ?? t("builder.widgetProps.globalWidget")}</span>
      </div>
      <p className="text-[10px] leading-snug text-muted-foreground">
        {t("builder.widgetProps.globalWidgetHint")}
      </p>
      <button
        type="button"
        onClick={onUnlink}
        className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 dark:text-amber-400 hover:underline"
      >
        <Link2Off className="w-3 h-3" /> {t("builder.widgetProps.unlink")}
      </button>
    </div>
  );
}
