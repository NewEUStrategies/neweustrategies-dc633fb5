// Widget properties panel: Content / Style / Advanced tabs.
// Composed from atomic-design molecules:
//   - SpacingControl     -> padding / margin / align
//   - TypographyControl  -> font family/size/weight/style/decoration
//   - MotionControl      -> enter animation preset + duration/delay
//   - VisibilityControl  -> per-device hide
//   - ColorField         -> bg / text colors with native picker
import type {
  WidgetNode, CommonStyle, AdvancedSettings, Device, Json, WidgetTypography,
} from "@/lib/builder/types";
import { WIDGETS } from "@/lib/builder/registry";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { PropField, ColorField } from "./ui/atoms";
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
  onChange: (mut: (w: WidgetNode) => void) => void;
}

export function WidgetProperties({ widget, lang, device, onChange }: Props) {
  const setContent = (k: string, v: Json) => onChange((w) => { w.content[k] = v; });
  const setStyle = (mut: (s: CommonStyle) => void) => onChange((w) => {
    w.style = w.style ?? {}; mut(w.style);
  });
  const setAdvanced = (mut: (a: AdvancedSettings) => void) => onChange((w) => {
    w.advanced = w.advanced ?? {}; mut(w.advanced);
  });

  const widgetLabel = WIDGETS.find((w) => w.type === widget.type)?.label ?? widget.type;

  return (
    <Tabs defaultValue="content">
      <div className="mb-2 px-0.5">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Widget</div>
        <div className="text-sm font-medium truncate">{widgetLabel}</div>
      </div>
      <TabsList className="grid grid-cols-3 w-full h-8">
        <TabsTrigger value="content" className="text-xs">Treść</TabsTrigger>
        <TabsTrigger value="style" className="text-xs">Styl</TabsTrigger>
        <TabsTrigger value="advanced" className="text-xs">Zaawans.</TabsTrigger>
      </TabsList>


      <TabsContent value="content" className="space-y-3 mt-3">
        <ContentFields widget={widget} lang={lang} setContent={setContent} />
      </TabsContent>

      <TabsContent value="style" className="space-y-4 mt-3">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
          Edytujesz: {device}
        </div>

        <section className="space-y-2">
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Kolory</h4>
          <PropField label="Tło">
            <ColorField
              value={widget.style?.bgColor}
              onChange={(v) => setStyle((s) => { s.bgColor = v; })}
            />
          </PropField>
          <PropField label="Tekst">
            <ColorField
              value={widget.style?.textColor}
              onChange={(v) => setStyle((s) => { s.textColor = v; })}
            />
          </PropField>
        </section>

        <section className="space-y-2 pt-2 border-t border-border">
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Odstępy</h4>
          <SpacingControl style={widget.style} device={device} onChange={setStyle} />
          <PropField label="Wyrównanie pionowe (w kolumnie)">
            <Select
              value={widget.style?.selfAlign ?? "auto"}
              onValueChange={(v) => setStyle((s) => { s.selfAlign = v === "auto" ? undefined : (v as NonNullable<CommonStyle["selfAlign"]>); })}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Domyślnie</SelectItem>
                <SelectItem value="start">Góra</SelectItem>
                <SelectItem value="center">Środek</SelectItem>
                <SelectItem value="end">Dół</SelectItem>
                <SelectItem value="stretch">Rozciągnij</SelectItem>
              </SelectContent>
            </Select>
          </PropField>
        </section>

        <section className="space-y-2 pt-2 border-t border-border">
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Wymiary</h4>
          <div className="grid grid-cols-2 gap-2">
            <PropField label="Border radius">
              <Input
                value={widget.style?.borderRadius ?? ""}
                placeholder="8px"
                onChange={(e) => setStyle((s) => { s.borderRadius = e.target.value || undefined; })}
                className="h-8 text-xs"
              />
            </PropField>
            <PropField label="Max width">
              <Input
                value={widget.style?.maxWidth ?? ""}
                placeholder="600px"
                onChange={(e) => setStyle((s) => { s.maxWidth = e.target.value || undefined; })}
                className="h-8 text-xs"
              />
            </PropField>
            <PropField label="Min height">
              <Input
                value={widget.style?.minHeight ?? ""}
                placeholder="120px"
                onChange={(e) => setStyle((s) => { s.minHeight = e.target.value || undefined; })}
                className="h-8 text-xs"
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
                className="h-8 text-xs"
              />
            </PropField>
          </div>
        </section>

        <section className="space-y-2 pt-2 border-t border-border">
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Obramowanie</h4>
          <div className="grid grid-cols-2 gap-2">
            <PropField label="Styl">
              <Select
                value={widget.style?.borderStyle ?? "none"}
                onValueChange={(v) => setStyle((s) => { s.borderStyle = v === "none" ? undefined : (v as CommonStyle["borderStyle"]); })}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["none","solid","dashed","dotted","double"].map((v) => (
                    <SelectItem key={v} value={v} className="text-xs">{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PropField>
            <PropField label="Grubość">
              <Input
                value={widget.style?.borderWidth ?? ""}
                placeholder="1px"
                onChange={(e) => setStyle((s) => { s.borderWidth = e.target.value || undefined; })}
                className="h-8 text-xs"
              />
            </PropField>
          </div>
          <PropField label="Kolor obramowania">
            <ColorField
              value={widget.style?.borderColor}
              onChange={(v) => setStyle((s) => { s.borderColor = v; })}
            />
          </PropField>
        </section>

        <section className="space-y-2 pt-2 border-t border-border">
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Cień</h4>
          <PropField label="Box shadow (CSS)">
            <Input
              value={widget.style?.boxShadow ?? ""}
              placeholder="0 10px 30px rgba(0,0,0,.15)"
              onChange={(e) => setStyle((s) => { s.boxShadow = e.target.value || undefined; })}
              className="h-8 text-xs"
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
                onClick={() => setStyle((s) => { s.boxShadow = p.v || undefined; })}
                className="px-2 py-0.5 text-[10px] rounded border border-border hover:bg-muted"
              >{p.label}</button>
            ))}
          </div>
        </section>

        <section className="space-y-2 pt-2 border-t border-border">
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Typografia</h4>
          <TypographyControl
            value={widget.style?.typography}
            device={device}
            onChange={(typography: WidgetTypography) => setStyle((s) => { s.typography = typography; })}
          />
        </section>

        <section className="space-y-2 pt-2 border-t border-border">
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Hover</h4>
          <HoverControl
            value={widget.style?.hover}
            onChange={(hover) => setStyle((s) => { s.hover = hover; })}
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
  );
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

