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
import { PropField, ColorField, StepperInput, NumberInput } from "./ui/atoms";
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
  PostListEditor,
} from "./ui/organisms/widget-properties";
import { ShadowEditor } from "./ui/molecules/ShadowEditor";

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
  const setFlatStr = (key: StringStyleKey, v: string | undefined) => setStyle((s) => {
    (s as Record<string, unknown>)[key] = v && v.length ? v : undefined;
  });
  const getFlatBorderStyle = (): string => {
    const v = widget.style?.borderStyle as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = v as { light?: string; dark?: string };
      return (o.light ?? o.dark ?? "none") as string;
    }
    return (typeof v === "string" ? v : "none");
  };
  const setFlatBorderStyle = (v: CommonStyle["borderStyle"] | undefined) => setStyle((s) => {
    (s as Record<string, unknown>).borderStyle = v ?? undefined;
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
      <div className="mb-2 px-0.5">
        <div className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1">Pozycja</div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setAdvanced((a) => { a.layout = undefined; })}
            className={`flex-1 h-7 px-2 text-[11px] rounded border ${(widget.advanced?.layout ?? "block") === "block" ? "border-brand bg-brand/10 text-brand" : "border-border bg-background"}`}
            title="Widget zajmuje cały wiersz (pod poprzednim)"
          >
            Pod
          </button>
          <button
            type="button"
            onClick={() => setAdvanced((a) => { a.layout = "inline"; })}
            className={`flex-1 h-7 px-2 text-[11px] rounded border ${widget.advanced?.layout === "inline" ? "border-brand bg-brand/10 text-brand" : "border-border bg-background"}`}
            title="Widget ustawia się obok poprzedniego inline-widgetu"
          >
            Obok
          </button>
        </div>
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
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Typografia ({mode === "dark" ? "ciemny" : "jasny"})</h4>

          <TypographyControl
            value={getThemedTypography()}
            device={device}
            onChange={(typography: WidgetTypography) => setThemedTypography(typography)}
          />
        </section>

        <section className="space-y-2 pt-2 border-t border-border">
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

        {widget.type === "dark-featured-card" && (
          <section className="space-y-2 pt-2 border-t border-border">
            <h4 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Etykieta (badge)</h4>
            <div className="grid grid-cols-2 gap-2">
              <PropField label="Wariant">
                <Select
                  value={(widget.content?.badgeVariant as string) || "solid-red"}
                  onValueChange={(v) => setContent("badgeVariant", v)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[
                      { v: "solid-red", l: "Pełny — czerwony" },
                      { v: "solid-brand", l: "Pełny — brand" },
                      { v: "solid-dark", l: "Pełny — ciemny" },
                      { v: "outline", l: "Obrysowany" },
                      { v: "ghost", l: "Przezroczysty" },
                      { v: "gradient", l: "Gradient" },
                    ].map((o) => (
                      <SelectItem key={o.v} value={o.v} className="text-xs">{o.l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </PropField>
              <PropField label="Zaokrąglenie">
                <Select
                  value={(widget.content?.badgeRadius as string) || "none"}
                  onValueChange={(v) => setContent("badgeRadius", v)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[
                      { v: "none", l: "Brak" },
                      { v: "sm", l: "Małe" },
                      { v: "md", l: "Średnie" },
                      { v: "lg", l: "Duże" },
                      { v: "full", l: "Pill" },
                    ].map((o) => (
                      <SelectItem key={o.v} value={o.v} className="text-xs">{o.l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </PropField>
              <PropField label="Rozmiar">
                <Select
                  value={(widget.content?.badgeSize as string) || "xs"}
                  onValueChange={(v) => setContent("badgeSize", v)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[
                      { v: "xs", l: "XS" },
                      { v: "sm", l: "S" },
                      { v: "md", l: "M" },
                    ].map((o) => (
                      <SelectItem key={o.v} value={o.v} className="text-xs">{o.l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </PropField>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <PropField label="Kolor tła etykiety">
                <ColorField
                  value={(widget.content?.badgeBg as string) || ""}
                  onChange={(v) => setContent("badgeBg", v || "")}
                />
              </PropField>
              <PropField label="Kolor tekstu etykiety">
                <ColorField
                  value={(widget.content?.badgeText as string) || ""}
                  onChange={(v) => setContent("badgeText", v || "")}
                />
              </PropField>
            </div>
            <div className="text-[10px] text-muted-foreground">Własne kolory nadpisują wybrany wariant.</div>
          </section>
        )}

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
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Zaokrąglenie rogów</h4>
          <PropField label="Promień (px)">
            <StepperInput
              value={getFlatStr("borderRadius")}
              placeholder="8px"
              min={0}
              onChange={(v) => setFlatStr("borderRadius", v ?? "")}
            />
          </PropField>
        </section>

        <section className="space-y-2 pt-2 border-t border-border">
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Obramowanie</h4>
          <div className="grid grid-cols-2 gap-2">
            <PropField label="Styl">
              <Select
                value={getFlatBorderStyle()}
                onValueChange={(v) => setFlatBorderStyle(v === "none" ? undefined : (v as CommonStyle["borderStyle"]))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[
                    { v: "none", l: "Brak" },
                    { v: "solid", l: "Ciągła" },
                    { v: "dashed", l: "Kreskowana" },
                    { v: "dotted", l: "Kropkowana" },
                    { v: "double", l: "Podwójna" },
                  ].map((o) => (
                    <SelectItem key={o.v} value={o.v} className="text-xs">{o.l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PropField>
            <PropField label="Grubość (px)">
              <StepperInput
                value={getFlatStr("borderWidth")}
                placeholder="1px"
                min={0}
                onChange={(v) => setFlatStr("borderWidth", v ?? "")}
              />
            </PropField>
          </div>
          <ThemedColorField
            label={`Kolor (${mode === "dark" ? "ciemny" : "jasny"})`}
            value={getColor("borderColor")}
            onChange={(v) => setColor("borderColor", v)}
            overridden={isOverridden("borderColor")}
            onReset={() => resetColor("borderColor")}
            placeholderHint="dziedziczy z global colors"
            inheritedValue={inherited.borderColor}
          />
        </section>

        <section className="space-y-2 pt-2 border-t border-border">
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Typografia ({mode === "dark" ? "ciemny" : "jasny"})</h4>

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
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Pozycja względem innych widgetów</h4>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setAdvanced((a) => { a.layout = undefined; })}
              className={`flex-1 h-8 px-2 text-xs rounded border ${(widget.advanced?.layout ?? "block") === "block" ? "border-brand bg-brand/10 text-brand" : "border-border bg-background"}`}
              title="Widget zajmuje cały wiersz (pod poprzednim)"
            >
              Pod (pełna szerokość)
            </button>
            <button
              type="button"
              onClick={() => setAdvanced((a) => { a.layout = "inline"; })}
              className={`flex-1 h-8 px-2 text-xs rounded border ${widget.advanced?.layout === "inline" ? "border-brand bg-brand/10 text-brand" : "border-border bg-background"}`}
              title="Widget ustawia się obok poprzedniego inline-widgetu"
            >
              Obok (w wierszu)
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground">Sąsiadujące widgety z opcją „Obok” łączą się w jeden wiersz.</p>
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
    case "post-list":
    case "carousel":
      return <PostListEditor c={c} lang={lang} setContent={setContent} />;
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

