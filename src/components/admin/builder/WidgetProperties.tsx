// Widget properties panel: Content / Style / Advanced tabs.
// Composed from atomic-design molecules:
//   - SpacingControl     -> padding / margin / align
//   - TypographyControl  -> font family/size/weight/style/decoration
//   - MotionControl      -> enter animation preset + duration/delay
//   - VisibilityControl  -> per-device hide
//   - ColorField         -> bg / text colors with native picker
import { useEffect, useState } from "react";
import type {
  WidgetNode, CommonStyle, AdvancedSettings, Device, Json, WidgetTypography,
  Mode, Themed, HoverStyle,
} from "@/lib/builder/types";
import { WIDGETS } from "@/lib/builder/registry";
import { pickMode, setMode as setThemedMode, isModeOverridden, isThemedValue } from "@/lib/builder/themed";
import { Sun, Moon, Undo as RotateCcw } from "@/lib/lucide-shim";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { PropField, ColorField } from "./ui/atoms";
import { PositionAnchor } from "./ui/atoms/PositionAnchor";
import { SpacingControl } from "./ui/molecules/SpacingControl";
import { TypographyControl } from "./ui/molecules/TypographyControl";
import { MotionControl } from "./ui/molecules/MotionControl";
import { VisibilityControl } from "./ui/molecules/VisibilityControl";
import { HoverControl } from "./ui/molecules/HoverControl";
import { SchemaFieldControl } from "./ui/molecules/SchemaFieldControl";
import { WIDGET_SCHEMAS } from "@/lib/builder/schemas";
import {
  AccordionEditor,
  TabsEditor,
  PricingEditor,
  RatedListEditor,
  ImageEditor,
  SectionLabelEditor,
  SliderEditor,
  AnimatedHeadingEditor,
} from "./ui/organisms/widget-properties";

interface Props {
  widget: WidgetNode;
  lang: "pl" | "en";
  device: Device;
  mode?: Mode;
  onModeChange?: (m: Mode) => void;
  onChange: (mut: (w: WidgetNode) => void) => void;
}

export function WidgetProperties({ widget, lang, device, mode = "light", onModeChange, onChange }: Props) {
  const setContent = (k: string, v: Json) => onChange((w) => { w.content[k] = v; });
  const setStyle = (mut: (s: CommonStyle) => void) => onChange((w) => {
    w.style = w.style ?? {}; mut(w.style);
  });
  const setAdvanced = (mut: (a: AdvancedSettings) => void) => onChange((w) => {
    w.advanced = w.advanced ?? {}; mut(w.advanced);
  });

  // ---- Themed (light/dark) helpers for color-style fields ----
  type ColorKey = "bgColor" | "textColor" | "borderColor";
  const getColor = (key: ColorKey): string | undefined =>
    pickMode<string>(widget.style?.[key] as Themed<string> | undefined, mode);
  const setColor = (key: ColorKey, v: string | undefined) => setStyle((s) => {
    const prev = s[key] as Themed<string> | undefined;
    const next = setThemedMode<string>(prev, mode, v);
    (s[key] as Themed<string> | undefined) = next;
  });
  const isOverridden = (key: ColorKey): boolean =>
    isModeOverridden(widget.style?.[key] as Themed<string> | undefined, mode);
  const resetColor = (key: ColorKey) => setStyle((s) => {
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
      // Flat value applies to both modes — reset removes it entirely.
      delete (s as Record<string, unknown>)[key];
    }
  });

  // ---- Themed read/write for generic string-valued style fields. The widget
  // frame already reads these per-mode via pickMode, so editing them per mode
  // gives the user a live, theme-correct preview without losing the other
  // mode's value. ----
  type StringStyleKey = "borderRadius" | "borderWidth" | "boxShadow";
  const getThemedStr = (key: StringStyleKey): string => {
    const v = pickMode<string>(widget.style?.[key] as Themed<string> | undefined, mode);
    return typeof v === "string" ? v : "";
  };
  const setThemedStr = (key: StringStyleKey, v: string | undefined) => setStyle((s) => {
    const prev = s[key] as Themed<string> | undefined;
    (s[key] as Themed<string> | undefined) = setThemedMode<string>(prev, mode, v && v.length ? v : undefined);
  });
  const getThemedBorderStyle = (): string => {
    const v = pickMode<CommonStyle["borderStyle"]>(
      widget.style?.borderStyle as Themed<CommonStyle["borderStyle"]> | undefined,
      mode,
    );
    return (typeof v === "string" ? v : "none");
  };
  const setThemedBorderStyle = (v: CommonStyle["borderStyle"] | undefined) => setStyle((s) => {
    const prev = s.borderStyle as Themed<CommonStyle["borderStyle"]> | undefined;
    (s.borderStyle as Themed<CommonStyle["borderStyle"]> | undefined) =
      setThemedMode<CommonStyle["borderStyle"]>(prev, mode, v);
  });
  // Typography is themed at the whole-object level (one block per mode).
  const getThemedTypography = (): WidgetTypography | undefined =>
    pickMode<WidgetTypography>(widget.style?.typography as Themed<WidgetTypography> | undefined, mode);
  const setThemedTypography = (t: WidgetTypography | undefined) => setStyle((s) => {
    const prev = s.typography as Themed<WidgetTypography> | undefined;
    (s.typography as Themed<WidgetTypography> | undefined) =
      setThemedMode<WidgetTypography>(prev, mode, t && Object.keys(t).length ? t : undefined);
  });

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
  const onHoverChange = (next: HoverStyle | undefined) => setStyle((s) => {
    if (!next) { s.hover = undefined; return; }
    const prev = s.hover ?? {};
    const merged: HoverStyle = { ...prev, ...next };
    // Re-wrap themed color fields so they preserve the other mode's value.
    if ("bgColor" in next) {
      const v = setThemedMode<string>(prev.bgColor as Themed<string> | undefined, mode, next.bgColor);
      (merged.bgColor as Themed<string> | undefined) = v;
    }
    if ("textColor" in next) {
      const v = setThemedMode<string>(prev.textColor as Themed<string> | undefined, mode, next.textColor);
      (merged.textColor as Themed<string> | undefined) = v;
    }
    s.hover = merged;
  });

  // Resolve inherited colors from the actually rendered widget DOM (global colors cascade).
  const inherited = useInheritedColors(widget.id, mode, widget.style);

  const widgetLabel = WIDGETS.find((w) => w.type === widget.type)?.label ?? widget.type;

  return (
    <div className="wp-compact">
    <Tabs defaultValue="content">
      <div className="mb-1.5 px-0.5">
        <div className="text-[9px] uppercase tracking-wide text-muted-foreground">Widget</div>
        <div className="text-[12px] font-medium truncate">{widgetLabel}</div>
      </div>
      <TabsList className="grid grid-cols-3 w-full h-6">
        <TabsTrigger value="content" className="text-[11px]">Treść</TabsTrigger>
        <TabsTrigger value="style" className="text-[11px]">Styl</TabsTrigger>
        <TabsTrigger value="advanced" className="text-[11px]">Zaawans.</TabsTrigger>
      </TabsList>


      <TabsContent value="content" className="space-y-2 mt-2">
        <ContentFields widget={widget} lang={lang} setContent={setContent} />
      </TabsContent>

      <TabsContent value="style" className="space-y-4 mt-3">
        {/* Light / Dark mode tabs — synced with global preview switcher */}
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Edytujesz: {device}
          </div>
          <div className="inline-flex items-center rounded border border-border bg-muted p-0.5" role="group" aria-label="Tryb">
            {([["light", Sun, "Jasny"], ["dark", Moon, "Ciemny"]] as const).map(([m, Icon, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => onModeChange?.(m)}
                className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-sm transition ${
                  mode === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-3 h-3" />
                {label}
              </button>
            ))}
          </div>
        </div>

        <section className="space-y-2">
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Kolory ({mode === "dark" ? "ciemny" : "jasny"})</h4>
          <ThemedColorField
            label="Tło"
            value={getColor("bgColor")}
            onChange={(v) => setColor("bgColor", v)}
            overridden={isOverridden("bgColor")}
            onReset={() => resetColor("bgColor")}
            placeholderHint="dziedziczy z global colors"
            inheritedValue={inherited.bgColor}
          />
          <ThemedColorField
            label="Tekst"
            value={getColor("textColor")}
            onChange={(v) => setColor("textColor", v)}
            overridden={isOverridden("textColor")}
            onReset={() => resetColor("textColor")}
            placeholderHint="dziedziczy z global colors"
            inheritedValue={inherited.textColor}
          />
        </section>

        <section className="space-y-2 pt-2 border-t border-border">
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Odstępy</h4>
          <SpacingControl style={widget.style} device={device} onChange={setStyle} />
          <PropField label="Pozycja w komórce">
            <PositionAnchor
              justify={widget.style?.selfJustify}
              align={widget.style?.selfAlign}
              onChange={({ justify, align }) => setStyle((s) => {
                s.selfJustify = justify;
                s.selfAlign = align;
              })}
            />
          </PropField>
        </section>

        <section className="space-y-2 pt-2 border-t border-border">
          <h4 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Wymiary ({mode === "dark" ? "ciemny" : "jasny"})</h4>
          <div className="grid grid-cols-2 gap-2">
            <PropField label="Zaokrąglenie rogów">
              <Input
                value={getThemedStr("borderRadius")}
                placeholder="8px"
                onChange={(e) => setThemedStr("borderRadius", e.target.value)}
              />
            </PropField>
            <PropField label="Maks. szerokość">
              <Input
                value={widget.style?.maxWidth ?? ""}
                placeholder="600px"
                onChange={(e) => setStyle((s) => { s.maxWidth = e.target.value || undefined; })}
              />
            </PropField>
            <PropField label="Min. wysokość">
              <Input
                value={widget.style?.minHeight ?? ""}
                placeholder="120px"
                onChange={(e) => setStyle((s) => { s.minHeight = e.target.value || undefined; })}
              />
            </PropField>
            <PropField label="Krycie (opacity)">
              <Input
                type="number" min={0} max={1} step={0.05}
                value={typeof widget.style?.opacity === "number" ? widget.style.opacity : ""}
                placeholder="1"
                onChange={(e) => {
                  const v = e.target.value;
                  setStyle((s) => { s.opacity = v === "" ? undefined : Math.max(0, Math.min(1, Number(v))); });
                }}
              />
            </PropField>
          </div>
        </section>

        <section className="space-y-2 pt-2 border-t border-border">
          <h4 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Obramowanie ({mode === "dark" ? "ciemny" : "jasny"})</h4>
          <div className="grid grid-cols-2 gap-2">
            <PropField label="Styl">
              <Select
                value={getThemedBorderStyle()}
                onValueChange={(v) => setThemedBorderStyle(v === "none" ? undefined : (v as CommonStyle["borderStyle"]))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[
                    { v: "none", label: "Brak" },
                    { v: "solid", label: "Ciągła" },
                    { v: "dashed", label: "Kreskowana" },
                    { v: "dotted", label: "Kropkowana" },
                    { v: "double", label: "Podwójna" },
                  ].map((o) => (
                    <SelectItem key={o.v} value={o.v} className="text-xs">{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PropField>
            <PropField label="Grubość">
              <Input
                value={getThemedStr("borderWidth")}
                placeholder="1px"
                onChange={(e) => setThemedStr("borderWidth", e.target.value)}
              />
            </PropField>
          </div>
          <ThemedColorField
            label="Kolor obramowania"
            value={getColor("borderColor")}
            onChange={(v) => setColor("borderColor", v)}
            overridden={isOverridden("borderColor")}
            onReset={() => resetColor("borderColor")}
            placeholderHint="dziedziczy z global colors"
            inheritedValue={inherited.borderColor}
          />
        </section>

        <section className="space-y-2 pt-2 border-t border-border">
          <h4 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Cień ({mode === "dark" ? "ciemny" : "jasny"})</h4>
          <PropField label="Cień (CSS box-shadow)">
            <Input
              value={getThemedStr("boxShadow")}
              placeholder="0 10px 30px rgba(0,0,0,.15)"
              onChange={(e) => setThemedStr("boxShadow", e.target.value)}
            />
          </PropField>
          <div className="flex flex-wrap gap-1">
            {[
              { label: "brak", v: "" },
              { label: "sm", v: "0 1px 2px rgba(0,0,0,.08)" },
              { label: "md", v: "0 4px 12px rgba(0,0,0,.12)" },
              { label: "lg", v: "0 10px 30px rgba(0,0,0,.18)" },
              { label: "xl", v: "0 24px 60px rgba(0,0,0,.25)" },
            ].map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setThemedStr("boxShadow", p.v || undefined)}
                className="px-2 py-0.5 text-[10px] rounded border border-border hover:bg-muted"
              >{p.label}</button>
            ))}
          </div>
        </section>

        <section className="space-y-2 pt-2 border-t border-border">
          <h4 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Typografia ({mode === "dark" ? "ciemny" : "jasny"})</h4>
          <TypographyControl
            value={getThemedTypography()}
            device={device}
            onChange={(typography: WidgetTypography) => setThemedTypography(typography)}
          />
        </section>

        <section className="space-y-2 pt-2 border-t border-border">
          <h4 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Hover ({mode === "dark" ? "ciemny" : "jasny"})</h4>
          <HoverControl
            value={hoverValue}
            onChange={onHoverChange}
          />
        </section>
      </TabsContent>



      <TabsContent value="advanced" className="space-y-4 mt-3">
        <section className="space-y-2">
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Identyfikatory</h4>
          <PropField label="HTML ID">
            <Input
              value={widget.advanced?.htmlId ?? ""}
              onChange={(e) => setAdvanced((a) => { a.htmlId = e.target.value || undefined; })}
              className="h-8 text-xs"
            />
          </PropField>
          <PropField label="CSS class">
            <Input
              value={widget.advanced?.cssClass ?? ""}
              onChange={(e) => setAdvanced((a) => { a.cssClass = e.target.value || undefined; })}
              className="h-8 text-xs"
            />
          </PropField>
        </section>

        <section className="space-y-2 pt-2 border-t border-border">
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Motion</h4>
          <MotionControl value={widget.advanced} onChange={setAdvanced} />
        </section>

        <section className="space-y-2 pt-2 border-t border-border">
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Widoczność</h4>
          <VisibilityControl value={widget.advanced} onChange={setAdvanced} />
        </section>

        <section className="space-y-2 pt-2 border-t border-border">
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Custom CSS</h4>
          <Textarea
            rows={4}
            value={widget.advanced?.customCss ?? ""}
            onChange={(e) => setAdvanced((a) => { a.customCss = e.target.value || undefined; })}
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
  label, value, onChange, overridden, onReset, placeholderHint, inheritedValue,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  overridden: boolean;
  onReset: () => void;
  placeholderHint?: string;
  inheritedValue?: string;
}) {
  return (
    <PropField
      label={
        <span className="inline-flex items-center gap-1.5">
          {label}
          {overridden && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand" aria-label="Nadpisane" title="Nadpisane w tym trybie" />
          )}
          {overridden && (
            <button
              type="button"
              onClick={onReset}
              title="Przywróć z global colors"
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
      const textTarget = el.querySelector<HTMLElement>("h1,h2,h3,h4,h5,h6,p,span,a,button,li,blockquote,figcaption,[contenteditable='true']") ?? el;
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


function ContentFields({ widget, lang, setContent }: {
  widget: WidgetNode; lang: "pl" | "en"; setContent: (k: string, v: Json) => void;
}) {
  const c = widget.content;

  // Custom (list-style) editors for complex widgets.
  switch (widget.type) {
    case "accordion":
      return <AccordionEditor c={c} lang={lang} setContent={setContent} />;
    case "tabs":
      return <TabsEditor c={c} lang={lang} setContent={setContent} />;
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
  }

  // Schema-driven render for simple widgets.
  const schema = WIDGET_SCHEMAS[widget.type];
  if (!schema || schema.length === 0) {
    return <div className="text-xs text-muted-foreground">Brak edytowalnych pól dla tego widgetu.</div>;
  }
  return (
    <>
      {schema.map((f) => (
        <SchemaFieldControl key={f.key} field={f} lang={lang} content={c} setContent={setContent} />
      ))}
    </>
  );
}

