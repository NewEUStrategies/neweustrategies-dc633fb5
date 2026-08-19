// Widget properties panel: Content / Style / Advanced tabs.
// Composed from atomic-design molecules:
//   - SpacingControl     -> padding / margin / align
//   - TypographyControl  -> font family/size/weight/style/decoration
//   - MotionControl      -> enter animation preset + duration/delay
//   - VisibilityControl  -> per-device hide
//   - ColorField         -> bg / text colors with native picker
import { useEffect, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-builder";
import type {
  WidgetNode,
  WidgetType,
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
import {
  Sun,
  Moon,
  Undo as RotateCcw,
  Globe,
  Link2Off,
  Minus,
  Plus,
  MoveVertical,
  FileText,
  Palette,
  SlidersHorizontal,
} from "@/lib/lucide-shim";
import { useGlobalWidgetMeta } from "@/lib/builder/globalWidgets";
import { needsSharedAuthorControl, widgetAuthorDisplayDefaults } from "@/lib/builder/authorDisplay";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import { AuthorDisplayControl } from "./ui/molecules/AuthorDisplayControl";
import { WidgetLivePreview } from "./ui/organisms/WidgetLivePreview";
import { LinkPicker } from "./ui/molecules/LinkPicker";

import { WIDGET_SCHEMAS, type SchemaField } from "@/lib/builder/schemas";
import {
  readDesktopHeight,
  writeDesktopHeight,
  clampWidgetHeight,
  readActiveWidgetWidth,
  widgetWidthMode as widgetWidthModeOf,
  widgetWidthValue as widgetWidthValueOf,
  seedWidthForMode,
  writeWidgetWidth,
  commitSizeInput,
  bumpSize,
  type WidgetWidthMode,
  type DesktopHeight,
} from "@/lib/builder/widgetPanelValues";
import { useAdminLang, useBuilderLabel } from "@/lib/builder/labelsEn";
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
  LogoCloudEditor,
  ProgressCarouselEditor,
  CircularCarouselEditor,
  PricingEditor,
  RatedListEditor,
  ImageEditor,
  SectionLabelEditor,
  SliderEditor,
  AnimatedHeadingEditor,
  TextRotateEditor,
  PostListEditor,
  MegaMenuEditor,
  RichTextEditor,
  AccountLinkEditor,
  HeadingFallbackPreview,
  TeamMemberEditor,
  AuthorProfileCardEditor,
  InteractiveCircleEditor,
  SpeakersEditor,
  EventScheduleEditor,
  EventCountdownEditor,
  EventCountdownCardEditor,
  MeetingBookingEditor,
  SponsorsEditor,
  WorldMapEditor,
  IMAGE_EDITOR_HANDLED_KEYS,
  PROGRESS_CAROUSEL_EDITOR_HANDLED_KEYS,
  CIRCULAR_CAROUSEL_EDITOR_HANDLED_KEYS,
  WORLD_MAP_EDITOR_HANDLED_KEYS,
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
  const bl = useBuilderLabel();
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

  // Reguły odczytu/zapisu szerokości żyją w `lib/builder/widgetPanelValues` -
  // czystym module, który da się przetestować bez renderu całego panelu.
  const activeWidgetWidth = readActiveWidgetWidth(widget.advanced?.width, device);
  const widgetWidthMode = widgetWidthModeOf(activeWidgetWidth);
  const widgetWidthValue = widgetWidthValueOf(activeWidgetWidth, widgetWidthMode);
  const setWidgetWidth = (value: number | "auto" | `${number}%` | undefined) =>
    setAdvanced((a) => {
      a.width = writeWidgetWidth(a.width, device, value);
    });
  const setWidgetWidthMode = (nextMode: WidgetWidthMode) =>
    setWidgetWidth(seedWidthForMode(nextMode));

  // ---- Themed (light/dark) helpers for color-style fields ----
  type ColorKey =
    "bgColor" | "textColor" | "borderColor" | "iconColor" | "iconHoverColor" | "iconActiveColor";
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

  // ---- Per-mode (Themed) read/write for dimension / border / shadow fields.
  // The renderer (frame.ts styleToCSS) already handles Themed<string> via
  // pickMode, so per-mode overrides stay backwards compatible with legacy flat
  // values. Editing in dark mode preserves the light value and vice versa.
  type StringStyleKey = "borderRadius" | "borderWidth" | "boxShadow";
  const getFlatStr = (key: StringStyleKey): string => {
    const v = widget.style?.[key] as Themed<string> | string | undefined;
    return pickMode<string>(v as Themed<string> | undefined, mode) ?? "";
  };
  const setFlatStr = (key: StringStyleKey, v: string | undefined) =>
    setStyle((s) => {
      const prev = s[key] as Themed<string> | string | undefined;
      const next = setThemedMode<string>(
        prev as Themed<string> | undefined,
        mode,
        v && v.length ? v : undefined,
      );
      (s[key] as Themed<string> | undefined) = next;
    });
  const getFlatBorderStyle = (): string => {
    const v = widget.style?.borderStyle as Themed<string> | string | undefined;
    return pickMode<string>(v as Themed<string> | undefined, mode) ?? "none";
  };
  const setFlatBorderStyle = (v: CommonStyle["borderStyle"] | undefined) =>
    setStyle((s) => {
      const prev = s.borderStyle as Themed<string> | string | undefined;
      const next = setThemedMode<string>(prev as Themed<string> | undefined, mode, v ?? undefined);
      (s as Record<string, unknown>).borderStyle = next;
    });

  // Typography is per-mode: editing in dark mode preserves the light values
  // and vice versa. The renderer (resolveWidgetTypography) already handles
  // Themed<WidgetTypography> and falls back to the opposite mode on miss.
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
      const prev = s.typography as unknown as Themed<WidgetTypography> | undefined;
      s.typography = setThemedMode<WidgetTypography>(prev, mode, next) as unknown as
        WidgetTypography | undefined;
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

  const widgetLabel = bl(WIDGETS.find((w) => w.type === widget.type)?.label) ?? widget.type;

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
    <div className="wp-compact min-w-0">
      <style>{`.cms-preview-field-focus{outline:2px solid var(--brand) !important;outline-offset:3px;border-radius:4px;box-shadow:0 0 0 4px color-mix(in oklab, var(--brand) 25%, transparent);transition:outline-color .15s, box-shadow .15s;}
.cms-panel-field-focus{outline:2px solid var(--brand);outline-offset:2px;border-radius:6px;transition:outline-color .2s;}
.wp-seg{display:inline-flex;width:100%;border:1px solid hsl(var(--border));border-radius:6px;overflow:hidden;background:hsl(var(--background));}
.wp-seg > button{flex:1;min-width:0;height:26px;padding:0 8px;font-size:11px;line-height:1;font-weight:500;color:hsl(var(--muted-foreground));background:transparent;border:0;border-left:1px solid hsl(var(--border));transition:background-color .15s,color .15s;display:inline-flex;align-items:center;justify-content:center;gap:4px;cursor:pointer;}
.wp-seg > button:first-child{border-left:0;}
.wp-seg > button:hover{background:hsl(var(--muted));color:hsl(var(--foreground));}
.wp-seg > button[data-active="true"]{background:color-mix(in oklab, var(--brand) 12%, transparent);color:var(--brand);font-weight:600;}
.wp-seg.wp-seg-grid{display:grid;grid-template-columns:1fr 1fr;}
.wp-seg.wp-seg-grid > button:nth-child(2n+1){border-left:0;}
.wp-seg.wp-seg-grid > button:nth-child(n+3){border-top:1px solid hsl(var(--border));}
.wp-panel-content>section{border-radius:6px;border:1px solid hsl(var(--border));background:hsl(var(--card));padding:10px;box-shadow:0 1px 2px hsl(var(--foreground)/.025);}
.wp-panel-content>section>h4{display:flex;align-items:center;min-height:22px;margin:-2px -2px 8px;padding:0 2px;border-bottom:1px solid hsl(var(--border)/.7);font-size:10px;font-weight:700;letter-spacing:.04em;color:hsl(var(--foreground));}
.wp-compact label{letter-spacing:0;}
.wp-compact input,.wp-compact textarea,.wp-compact [role="combobox"]{border-radius:6px;}`}</style>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="mb-2 overflow-hidden rounded-md border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between gap-2 border-l-[3px] border-l-brand px-2.5 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <div className="text-[9px] font-semibold uppercase text-muted-foreground">
                  {lang === "en" ? "Widget settings" : "Ustawienia widgetu"}
                </div>
                <div className="truncate text-[12px] font-semibold text-foreground">
                  {widgetLabel}
                </div>
              </div>
            </div>
            <div
              className="wp-seg !w-auto shrink-0"
              role="group"
              aria-label={t("builder.widgetProps.block") + " / " + t("builder.widgetProps.inline")}
            >
              <button
                type="button"
                onClick={() =>
                  setAdvanced((a) => {
                    a.layout = undefined;
                  })
                }
                data-active={(widget.advanced?.layout ?? "block") === "block"}
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
                data-active={widget.advanced?.layout === "inline"}
                title={t("builder.widgetProps.inlineLayoutTitle")}
              >
                {t("builder.widgetProps.inline")}
              </button>
            </div>
          </div>
          {widget.globalId && (
            <div className="px-2.5 pb-2">
              <GlobalWidgetBanner
                globalId={widget.globalId}
                onUnlink={() =>
                  onChange((w) => {
                    delete w.globalId;
                  })
                }
              />
            </div>
          )}
          <TabsList className="grid h-9 w-full grid-cols-3 rounded-none border-t border-border bg-muted/30 p-1">
            <TabsTrigger
              value="content"
              className="h-7 gap-1.5 rounded-[4px] text-[10.5px] font-semibold"
            >
              <FileText className="h-3 w-3" />
              {t("builder.widgetProps.tabContent")}
            </TabsTrigger>
            <TabsTrigger
              value="style"
              className="h-7 gap-1.5 rounded-[4px] text-[10.5px] font-semibold"
            >
              <Palette className="h-3 w-3" />
              {t("builder.widgetProps.tabStyle")}
            </TabsTrigger>
            <TabsTrigger
              value="advanced"
              className="h-7 gap-1.5 rounded-[4px] text-[10.5px] font-semibold"
            >
              <SlidersHorizontal className="h-3 w-3" />
              {t("builder.widgetProps.tabAdvanced")}
            </TabsTrigger>
          </TabsList>
        </div>

        <WidgetLivePreview widget={widget} lang={lang} device={device} mode={mode} />

        <TabsContent value="content" className="wp-panel-content mt-2 space-y-2">
          <WidgetContentFields widget={widget} lang={lang} setContent={setContent} />
        </TabsContent>

        <TabsContent value="style" className="wp-panel-content mt-2 space-y-2">
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

          <section className="space-y-2 rounded-md border border-border p-2 bg-muted/20">
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
            <section className="space-y-2 rounded-md border border-border p-2 bg-muted/20">
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
                        label={bl(meta.label)}
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

          <section className="space-y-2 rounded-md border border-border p-2 bg-muted/20">
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

          <section className="space-y-2 rounded-md border border-border p-2 bg-muted/20">
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
            <section className="space-y-2 rounded-md border border-border p-2 bg-muted/20">
              <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
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

          <section className="space-y-2 rounded-md border border-border p-2 bg-muted/20">
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("builder.widgetProps.cornerRounding")} ({md()})
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

          <section className="space-y-2 rounded-md border border-border p-2 bg-muted/20">
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("builder.widgetProps.border")} ({md()})
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

          <section className="space-y-2 rounded-md border border-border p-2 bg-muted/20">
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Hover ({md()})
            </h4>

            <HoverControl value={hoverValue} onChange={onHoverChange} />
          </section>

          <section className="space-y-2 rounded-md border border-border p-2 bg-muted/20">
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

        <TabsContent value="advanced" className="wp-panel-content mt-2 space-y-2">
          <section className="space-y-2 rounded-md border border-border p-2 bg-muted/20">
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

          <section className="space-y-2 rounded-md border border-border p-2 bg-muted/20">
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("builder.widgetProps.widgetWidth")}
            </h4>
            <div
              className="wp-seg wp-seg-grid"
              role="group"
              aria-label={t("builder.widgetProps.widgetWidth")}
            >
              {(
                [
                  ["full", t("builder.widgetProps.widthFull")],
                  ["percent", t("builder.widgetProps.widthPercent")],
                  ["px", t("builder.widgetProps.widthPixels")],
                  ["wrapped", t("builder.widgetProps.widthWrapped")],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  data-active={widgetWidthMode === value}
                  onClick={() => setWidgetWidthMode(value)}
                  aria-pressed={widgetWidthMode === value}
                >
                  {label}
                </button>
              ))}
            </div>
            {(widgetWidthMode === "percent" || widgetWidthMode === "px") && (
              <PropField
                label={
                  widgetWidthMode === "percent"
                    ? t("builder.widgetProps.widthPercentValue")
                    : t("builder.widgetProps.widthPixelValue")
                }
              >
                <StepperInput
                  value={String(widgetWidthValue)}
                  min={widgetWidthMode === "percent" ? 1 : 8}
                  max={widgetWidthMode === "percent" ? 100 : 4000}
                  onChange={(value) => {
                    const numeric = typeof value === "number" ? value : Number(value);
                    if (!Number.isFinite(numeric)) return;
                    if (widgetWidthMode === "percent") {
                      const percent = Math.max(1, Math.min(100, numeric));
                      setWidgetWidth(`${percent}%`);
                    } else {
                      setWidgetWidth(Math.max(8, Math.min(4000, numeric)));
                    }
                  }}
                />
              </PropField>
            )}
            <p className="text-[10px] text-muted-foreground">
              {t("builder.widgetProps.widthDeviceHint", { device })}
            </p>
          </section>

          <section className="space-y-2 rounded-md border border-border p-2 bg-muted/20">
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("builder.widgetProps.positionRelative")}
            </h4>
            <div className="wp-seg" role="group">
              <button
                type="button"
                data-active={(widget.advanced?.layout ?? "block") === "block"}
                onClick={() =>
                  setAdvanced((a) => {
                    a.layout = undefined;
                  })
                }
                title={t("builder.widgetProps.blockLayoutTitle")}
              >
                {t("builder.widgetProps.blockFull")}
              </button>
              <button
                type="button"
                data-active={widget.advanced?.layout === "inline"}
                onClick={() =>
                  setAdvanced((a) => {
                    a.layout = "inline";
                  })
                }
                title={t("builder.widgetProps.inlineLayoutTitle")}
              >
                {t("builder.widgetProps.inlineRow")}
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {t("builder.widgetProps.adjacentHint")}
            </p>
          </section>

          <section className="space-y-2 rounded-md border border-border p-2 bg-muted/20">
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
              <div className="wp-seg" role="group">
                {(["start", "center", "end"] as const).map((v) => {
                  const active = (widget.advanced?.contentAlign ?? "start") === v;
                  return (
                    <button
                      key={v}
                      type="button"
                      data-active={active}
                      onClick={() =>
                        setAdvanced((a) => {
                          a.contentAlign = v === "start" ? undefined : v;
                        })
                      }
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

          <section className="space-y-2 rounded-md border border-border p-2 bg-muted/20">
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("builder.widgetProps.dimensions")}
            </h4>
            <p className="text-[10px] text-muted-foreground -mt-1">
              {t("builder.widgetProps.dimensionsHint")}
            </p>
            <WidgetHeightControl
              value={readDesktopHeight(widget.advanced?.height)}
              onChange={(next) =>
                setAdvanced((a) => {
                  a.height = writeDesktopHeight(a.height, next);
                })
              }
              disabledReason={(() => {
                if (widget.type !== "image") return undefined;
                const r = typeof widget.content?.ratio === "string" ? widget.content.ratio : "";
                if (!r || r === "auto") return undefined;
                return t("builder.widgetProps.dimensionsRatioLock", {
                  ratio: r,
                });
              })()}
            />
          </section>

          <section className="space-y-2 rounded-md border border-border p-2 bg-muted/20">
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Motion
            </h4>
            <MotionControl value={widget.advanced} onChange={setAdvanced} />
          </section>

          <section className="space-y-2 rounded-md border border-border p-2 bg-muted/20">
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("builder.widgetProps.visibility")}
            </h4>
            <VisibilityControl value={widget.advanced} onChange={setAdvanced} />
          </section>

          <section className="space-y-2 rounded-md border border-border p-2 bg-muted/20">
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("builder.widgetProps.access")}
            </h4>
            <AccessControl value={widget.advanced} onChange={setAdvanced} />
          </section>

          <section className="space-y-2 rounded-md border border-border p-2 bg-muted/20">
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

          <section className="space-y-2 rounded-md border border-border p-2 bg-muted/20">
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

// Helpery wysokości desktopowej mieszkają w `lib/builder/widgetPanelValues`
// (czysty modul, testowany bez renderu panelu).

function WidgetHeightControl({
  value,
  onChange,
  disabledReason,
}: {
  value: DesktopHeight;
  onChange: (next: DesktopHeight) => void;
  disabledReason?: string;
}) {
  const { t } = useTranslation();
  const isAuto = value === "auto";
  const numeric = typeof value === "number" ? value : "";
  const setFixedHeight = (next: number) => onChange(clampWidgetHeight(next));
  const disabled = !!disabledReason;
  return (
    <>
      <div
        className={`space-y-2 ${disabled ? "opacity-60 pointer-events-none select-none" : ""}`}
        aria-disabled={disabled || undefined}
      >
        <div
          className="relative h-20 overflow-hidden rounded-md border border-border bg-muted/30 p-2"
          aria-label={t("builder.widgetProps.dimensionsPreview")}
        >
          <div className="absolute inset-x-2 top-2 flex items-center justify-between text-[9px] text-muted-foreground">
            <span>{t("builder.widgetProps.preview")}</span>
            <span className="inline-flex items-center gap-1 font-medium text-foreground">
              <MoveVertical className="size-3" />
              {typeof value === "number"
                ? `${value}px`
                : value === "auto"
                  ? t("builder.widgetProps.dimensionsHug")
                  : t("builder.widgetProps.dimensionsAuto")}
            </span>
          </div>
          <div className="absolute inset-x-2 bottom-2 top-7 flex items-center justify-center border-x border-dashed border-brand/50">
            <div
              className="w-full rounded-[5px] border border-brand bg-brand/10 transition-[height] duration-200"
              style={{
                height:
                  typeof value === "number"
                    ? `${Math.max(12, Math.min(34, value / 24))}px`
                    : value === "auto"
                      ? "18px"
                      : "26px",
              }}
            />
          </div>
        </div>
        <div className="wp-seg" role="group">
          {(
            [
              ["auto", t("builder.widgetProps.dimensionsAuto"), undefined as DesktopHeight],
              [
                "fixed",
                t("builder.widgetProps.dimensionsFixed"),
                typeof value === "number" ? value : 480,
              ],
              ["hug", t("builder.widgetProps.dimensionsHug"), "auto" as DesktopHeight],
            ] as const
          ).map(([key, label, target]) => {
            const active =
              (key === "auto" && value === undefined) ||
              (key === "fixed" && typeof value === "number") ||
              (key === "hug" && isAuto);
            return (
              <button key={key} type="button" data-active={active} onClick={() => onChange(target)}>
                {label}
              </button>
            );
          })}
        </div>
        {typeof value === "number" && (
          <PropField label={t("builder.widgetProps.dimensionsDesktopPx")}>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8 shrink-0 rounded-md"
                onClick={() => setFixedHeight(Number(numeric) - 10)}
                aria-label={t("builder.widgetProps.decreaseHeight")}
                title={t("builder.widgetProps.decreaseHeight")}
              >
                <Minus className="size-3.5" />
              </Button>
              <div className="relative min-w-0 flex-1">
                <Input
                  type="number"
                  min={40}
                  max={2400}
                  step={10}
                  value={numeric}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === "") return;
                    const n = Number(raw);
                    if (Number.isFinite(n) && n > 0) setFixedHeight(Math.round(n));
                  }}
                  className="h-8 pr-7 text-xs"
                />
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                  px
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8 shrink-0 rounded-md"
                onClick={() => setFixedHeight(Number(numeric) + 10)}
                aria-label={t("builder.widgetProps.increaseHeight")}
                title={t("builder.widgetProps.increaseHeight")}
              >
                <Plus className="size-3.5" />
              </Button>
            </div>
          </PropField>
        )}
      </div>
      {disabledReason ? (
        <p className="mt-2 rounded-md border border-brand/30 bg-brand/5 px-2 py-1.5 text-[10.5px] leading-snug text-foreground/80">
          {disabledReason}
        </p>
      ) : null}
    </>
  );
}

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
  /** Computed size measured from the canvas - the visible "auto" value. */
  effectivePx: number;
  onChange: (next: number | null) => void;
  onPreview: () => void;
}) {
  const { t } = useTranslation();
  const numericValue = typeof value === "number" ? value : null;
  const isAuto = numericValue === null;
  const commit = (raw: string) => {
    const outcome = commitSizeInput(raw, min, max);
    if (outcome.kind === "ignore") return;
    onChange(outcome.kind === "clear" ? null : outcome.value);
  };
  const bump = (delta: number) => onChange(bumpSize(numericValue, effectivePx, delta, min, max));

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

/**
 * Zakładka "Treść" panelu właściwości - JEDYNA powierzchnia, na której redakcja
 * edytuje `widget.content` w sposób zależny od typu widgetu (schemat + edytory
 * niestandardowe). Wyjątki, czyli kontrolki treści narysowane poza tą zakładką,
 * są wymienione w `PANEL_EXTRA_CONTENT_KEYS`.
 *
 * Eksportowana, bo to właśnie ten komponent mierzy bramka wierności ustawień
 * (`settingsFidelity.gate.test.tsx`): zbiór kluczy, o które ON odpytuje treść,
 * jest definicją "co panel oferuje". Całego `WidgetProperties` mierzyć nie
 * można - renderuje `WidgetLivePreview`, czyli renderer, więc oba końce
 * inwariantu zlałyby się w jeden.
 */
export function WidgetContentFields({
  widget,
  lang,
  setContent,
}: {
  widget: WidgetNode;
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}) {
  const { t } = useTranslation();
  const bl = useBuilderLabel();
  const adminLang = useAdminLang();
  const c = widget.content;

  // Prezentacja autora: JEDNA kontrolka dla wszystkich widgetów z bylinem,
  // które nie mają własnego edytora (post-lista, slider i lista z oceną wpinają
  // ją same w swojej sekcji „Wyświetlanie"). Dzięki temu rozmiar nazwiska i
  // zdjęcia oraz niezależne chowanie obu osi są edytowalne w KAŻDYM takim
  // widgecie, a nie tylko w sliderze.
  const authorSection = needsSharedAuthorControl(widget.type) ? (
    <section className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-2">
      <h4 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {t("builder.authorDisplay.section")}
      </h4>
      <AuthorDisplayControl
        c={c}
        lang={lang}
        setContent={setContent}
        defaults={widgetAuthorDisplayDefaults(widget.type, c)}
      />
    </section>
  ) : null;

  // Custom (list-style) editors for complex widgets. Fields of the widget's
  // schema that the custom editor does NOT claim are rendered below it, so a
  // schema entry can never be silently swallowed by the custom branch.
  const custom = customContentEditor(widget, lang, setContent);
  if (custom) {
    const leftover = unhandledSchemaFields(widget.type);
    if (leftover.length === 0)
      return (
        <>
          {custom}
          {authorSection}
        </>
      );
    return (
      <>
        {custom}
        {authorSection}
        <section className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-2">
          <h4 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {adminLang === "en" ? "Other settings" : "Pozostałe ustawienia"}
          </h4>
          <div className="space-y-2">
            {leftover.map((f) => (
              <SchemaFieldControl
                key={f.key}
                field={f}
                lang={lang}
                content={c}
                setContent={setContent}
              />
            ))}
          </div>
        </section>
      </>
    );
  }

  // Schema-driven render for simple widgets.
  const schema = WIDGET_SCHEMAS[widget.type];
  if (!schema || schema.length === 0) {
    return (
      authorSection ?? (
        <div className="text-xs text-muted-foreground">
          {t("builder.widgetProps.noEditableFields")}
        </div>
      )
    );
  }
  // Group fields by their `group` label, preserving declaration order.
  const groups: Array<{ name: string | null; fields: typeof schema }> = [];
  for (const f of schema) {
    const gname = f.group ?? null;
    const last = groups[groups.length - 1];
    if (last && last.name === gname) last.fields = [...last.fields, f];
    else groups.push({ name: gname, fields: [f] });
  }
  return (
    <>
      {authorSection}
      {groups.map((g, gi) => {
        const body = (
          <div className="space-y-2">
            {g.fields.map((f) => (
              <SchemaFieldControl
                key={f.key}
                field={f}
                lang={lang}
                content={c}
                setContent={setContent}
              />
            ))}
          </div>
        );
        if (!g.name) return <div key={`g-${gi}`}>{body}</div>;
        return (
          <section
            key={`g-${gi}`}
            className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-2"
          >
            <h4 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {bl(g.name)}
            </h4>
            {body}
          </section>
        );
      })}

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

/**
 * Kontrolki TREŚCI narysowane POZA zakładką "Treść" (`WidgetContentFields`).
 *
 * Dziś jest jedna taka sekcja: plakietka `dark-featured-card` żyje w zakładce
 * "Styl", bo to w praktyce zestaw kolorów. Bramka wierności ustawień mierzy
 * tylko zakładkę treści, więc bez tej deklaracji te pięć kluczy wyglądałoby na
 * "czytane przez renderer, nieedytowalne w panelu".
 *
 * Deklaracja NIE MOŻE się rozjechać z kodem: test bramki wyciąga z tego pliku
 * wszystkie literały `setContent("…")` i wymaga, żeby każdy był albo polem
 * schematu, albo wymieniony tutaj.
 */
export const PANEL_EXTRA_CONTENT_KEYS: Partial<Record<WidgetType, ReadonlySet<string>>> = {
  "dark-featured-card": new Set([
    "badgeVariant",
    "badgeRadius",
    "badgeSize",
    "badgeBg",
    "badgeText",
  ]),
};

/**
 * OPT-IN: custom editors that agreed to CO-OPERATE with the declarative schema.
 *
 * A custom editor short-circuits the schema branch, so every schema field the
 * editor does not draw itself used to disappear from the panel without a trace
 * (the image widget lost `caption` / `variant` / `objectFit` / `ratio` that way,
 * although the renderer honoured all four). Editors listed here publish the set
 * of content keys they own; `unhandledSchemaFields` returns the rest and the
 * panel renders it under the editor with the generic `SchemaFieldControl`.
 *
 * Deliberately opt-in: an editor that is NOT listed keeps today's behaviour, so
 * adding the mechanism cannot spring surprise controls on editors whose custom
 * UI intentionally supersedes the schema (for example the slider or the auth
 * forms, whose schemas carry fields their editors reshape).
 *
 * How to opt in: export a `<EDITOR>_HANDLED_KEYS` set next to the editor
 * (base keys, without the `_pl` / `_en` suffix) and register it below.
 */
const CUSTOM_EDITOR_HANDLED_KEYS: Partial<Record<WidgetType, ReadonlySet<string>>> = {
  image: IMAGE_EDITOR_HANDLED_KEYS,
  "progress-carousel": PROGRESS_CAROUSEL_EDITOR_HANDLED_KEYS,
  "circular-carousel": CIRCULAR_CAROUSEL_EDITOR_HANDLED_KEYS,
  "world-map": WORLD_MAP_EDITOR_HANDLED_KEYS,
};

/**
 * Schema fields of an opted-in custom editor that the editor itself does not
 * render. Empty for every widget outside `CUSTOM_EDITOR_HANDLED_KEYS`.
 * `schema` is injectable so the guarantee stays testable without a live schema.
 */
export function unhandledSchemaFields(
  type: WidgetType,
  schema: ReadonlyArray<SchemaField> = WIDGET_SCHEMAS[type] ?? [],
): ReadonlyArray<SchemaField> {
  const handled = CUSTOM_EDITOR_HANDLED_KEYS[type];
  if (!handled) return [];
  return schema.filter((f) => !handled.has(f.key));
}

/** The custom (non-schema) editor for a widget type, or `null` when there is none. */
function customContentEditor(
  widget: WidgetNode,
  lang: "pl" | "en",
  setContent: (k: string, v: Json) => void,
): ReactElement | null {
  const c = widget.content;
  switch (widget.type) {
    case "accordion":
      return <AccordionEditor c={c} lang={lang} setContent={setContent} />;
    case "tabs":
      return <TabsEditor c={c} lang={lang} setContent={setContent} />;
    case "timeline":
      return <TimelineEditor c={c} lang={lang} setContent={setContent} />;
    case "logo-cloud":
      return <LogoCloudEditor c={c} lang={lang} setContent={setContent} />;
    case "progress-carousel":
      return <ProgressCarouselEditor c={c} lang={lang} setContent={setContent} />;
    case "circular-carousel":
      return <CircularCarouselEditor c={c} lang={lang} setContent={setContent} />;
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
    case "text-rotate":
      return <TextRotateEditor c={c} lang={lang} setContent={setContent} />;
    case "post-list":
    case "carousel":
      // `widgetType` MUSI tu trafić: edytor pokazuje sekcję karuzeli (autoplay,
      // czas slajdu) tylko dla typu "carousel", a bez tego propsu domyślał się
      // "post-list" - kontrolki autoodtwarzania nie dawały się pokazać w ogóle,
      // choć renderer je honorował.
      return <PostListEditor c={c} lang={lang} setContent={setContent} widgetType={widget.type} />;
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
    case "author-profile-card":
      return <AuthorProfileCardEditor c={c} lang={lang} setContent={setContent} />;
    case "interactive-circle":
      return <InteractiveCircleEditor c={c} lang={lang} setContent={setContent} />;
    case "speakers":
      return <SpeakersEditor c={c} lang={lang} setContent={setContent} />;
    case "event-schedule":
      return <EventScheduleEditor c={c} lang={lang} setContent={setContent} />;
    case "event-countdown":
      return <EventCountdownEditor c={c} lang={lang} setContent={setContent} />;
    case "event-countdown-card":
      return <EventCountdownCardEditor c={c} lang={lang} setContent={setContent} />;
    case "meeting-booking":
      return <MeetingBookingEditor c={c} lang={lang} setContent={setContent} />;
    case "event-sponsors":
      return <SponsorsEditor c={c} lang={lang} setContent={setContent} />;
    case "world-map":
      return <WorldMapEditor c={c} lang={lang} setContent={setContent} />;
  }
  return null;
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
