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

import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Upload, Image as ImageIcon, Sun, Moon, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { PropField } from "./ui/atoms/PropField";
import { ColorField } from "./ui/atoms/ColorField";
import { SpacingControl } from "./ui/molecules/SpacingControl";
import { TypographyControl } from "./ui/molecules/TypographyControl";
import { MotionControl } from "./ui/molecules/MotionControl";
import { VisibilityControl } from "./ui/molecules/VisibilityControl";
import { HoverControl } from "./ui/molecules/HoverControl";
import { SchemaFieldControl } from "./ui/molecules/SchemaFieldControl";
import { WIDGET_SCHEMAS } from "@/lib/builder/schemas";

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


// ---------- List editors for the new widgets ----------

type Item = Record<string, unknown>;

function itemsOf(c: WidgetNode["content"], k: string): Item[] {
  const v = c[k];
  if (!Array.isArray(v)) return [];
  return (v as unknown[]).filter(
    (x): x is Item => typeof x === "object" && x !== null && !Array.isArray(x),
  );
}

function ListShell({
  title, items, onAdd, children,
}: {
  title: string; items: Item[]; onAdd: () => void; children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{title}</span>
        <button type="button" onClick={onAdd} className="text-[11px] text-brand hover:underline">+ Dodaj</button>
      </div>
      {items.length === 0
        ? <p className="text-[11px] text-muted-foreground italic">Lista jest pusta.</p>
        : children}
    </div>
  );
}

function ItemFrame({ title, onRemove, children }: { title: string; onRemove: () => void; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-md p-2 space-y-1.5 bg-background">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{title}</span>
        <button type="button" onClick={onRemove} className="text-[10px] text-muted-foreground hover:text-destructive">Usuń</button>
      </div>
      {children}
    </div>
  );
}

function AccordionEditor({ c, lang, setContent }: { c: WidgetNode["content"]; lang: "pl"|"en"; setContent: (k: string, v: Json) => void }) {
  const items = itemsOf(c, "items");
  const update = (next: Item[]) => setContent("items", next as unknown as Json);
  return (
    <ListShell
      title="Pytania (FAQ)"
      items={items}
      onAdd={() => update([...items, { q_pl: "Nowe pytanie", a_pl: "Odpowiedź…" }])}
    >
      <div className="space-y-2">
        {items.map((it, i) => (
          <ItemFrame key={i} title={`Pozycja #${i + 1}`} onRemove={() => update(items.filter((_, j) => j !== i))}>
            <PropField label={`Pytanie (${lang.toUpperCase()})`}>
              <Input
                value={typeof it[`q_${lang}`] === "string" ? it[`q_${lang}`] as string : ""}
                onChange={(e) => update(items.map((x, j) => j === i ? { ...x, [`q_${lang}`]: e.target.value } : x))}
                className="h-8 text-xs"
              />
            </PropField>
            <PropField label={`Odpowiedź HTML (${lang.toUpperCase()})`}>
              <Textarea rows={3}
                value={typeof it[`a_${lang}`] === "string" ? it[`a_${lang}`] as string : ""}
                onChange={(e) => update(items.map((x, j) => j === i ? { ...x, [`a_${lang}`]: e.target.value } : x))}
                className="text-xs font-mono"
              />
            </PropField>
          </ItemFrame>
        ))}
      </div>
    </ListShell>
  );
}

function TabsEditor({ c, lang, setContent }: { c: WidgetNode["content"]; lang: "pl"|"en"; setContent: (k: string, v: Json) => void }) {
  const tabs = itemsOf(c, "tabs");
  const update = (next: Item[]) => setContent("tabs", next as unknown as Json);
  return (
    <ListShell
      title="Zakładki"
      items={tabs}
      onAdd={() => update([...tabs, { label_pl: "Nowa", html_pl: "<p>Treść…</p>" }])}
    >
      <div className="space-y-2">
        {tabs.map((it, i) => (
          <ItemFrame key={i} title={`Zakładka #${i + 1}`} onRemove={() => update(tabs.filter((_, j) => j !== i))}>
            <PropField label={`Etykieta (${lang.toUpperCase()})`}>
              <Input
                value={typeof it[`label_${lang}`] === "string" ? it[`label_${lang}`] as string : ""}
                onChange={(e) => update(tabs.map((x, j) => j === i ? { ...x, [`label_${lang}`]: e.target.value } : x))}
                className="h-8 text-xs"
              />
            </PropField>
            <PropField label={`Treść HTML (${lang.toUpperCase()})`}>
              <Textarea rows={4}
                value={typeof it[`html_${lang}`] === "string" ? it[`html_${lang}`] as string : ""}
                onChange={(e) => update(tabs.map((x, j) => j === i ? { ...x, [`html_${lang}`]: e.target.value } : x))}
                className="text-xs font-mono"
              />
            </PropField>
          </ItemFrame>
        ))}
      </div>
    </ListShell>
  );
}

function PricingEditor({ c, lang, setContent }: { c: WidgetNode["content"]; lang: "pl"|"en"; setContent: (k: string, v: Json) => void }) {
  const plans = itemsOf(c, "plans");
  const update = (next: Item[]) => setContent("plans", next as unknown as Json);
  const upd = (i: number, patch: Item) => update(plans.map((x, j) => j === i ? { ...x, ...patch } : x));
  return (
    <ListShell
      title="Plany cenowe"
      items={plans}
      onAdd={() => update([...plans, {
        name_pl: "Plan", price: "0", currency: "zł", period_pl: "/mies.",
        features_pl: ["Funkcja 1"], cta_pl: "Wybierz", href: "#", featured: false,
      }])}
    >
      <div className="space-y-2">
        {plans.map((p, i) => {
          const featuresRaw = p[`features_${lang}`];
          const features = Array.isArray(featuresRaw)
            ? (featuresRaw as unknown[]).filter((x): x is string => typeof x === "string")
            : [];
          return (
            <ItemFrame key={i} title={`Plan #${i + 1}`} onRemove={() => update(plans.filter((_, j) => j !== i))}>
              <PropField label={`Nazwa (${lang.toUpperCase()})`}>
                <Input value={(p[`name_${lang}`] as string) ?? ""} onChange={(e) => upd(i, { [`name_${lang}`]: e.target.value })} className="h-8 text-xs" />
              </PropField>
              <div className="grid grid-cols-2 gap-2">
                <PropField label="Cena">
                  <Input value={(p.price as string) ?? ""} onChange={(e) => upd(i, { price: e.target.value })} className="h-8 text-xs" />
                </PropField>
                <PropField label="Waluta">
                  <Input value={(p.currency as string) ?? ""} onChange={(e) => upd(i, { currency: e.target.value })} placeholder="zł / €" className="h-8 text-xs" />
                </PropField>
              </div>
              <PropField label={`Okres (${lang.toUpperCase()})`}>
                <Input value={(p[`period_${lang}`] as string) ?? ""} onChange={(e) => upd(i, { [`period_${lang}`]: e.target.value })} placeholder="/mies." className="h-8 text-xs" />
              </PropField>
              <PropField label={`Funkcje (${lang.toUpperCase()}) — po jednej na linię`}>
                <Textarea rows={4}
                  value={features.join("\n")}
                  onChange={(e) => upd(i, { [`features_${lang}`]: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
                  className="text-xs"
                />
              </PropField>
              <div className="grid grid-cols-2 gap-2">
                <PropField label={`CTA (${lang.toUpperCase()})`}>
                  <Input value={(p[`cta_${lang}`] as string) ?? ""} onChange={(e) => upd(i, { [`cta_${lang}`]: e.target.value })} className="h-8 text-xs" />
                </PropField>
                <PropField label="Link CTA">
                  <Input value={(p.href as string) ?? ""} onChange={(e) => upd(i, { href: e.target.value })} className="h-8 text-xs" />
                </PropField>
              </div>
              <label className="inline-flex items-center gap-2 text-[11px] mt-1">
                <input
                  type="checkbox"
                  checked={!!p.featured}
                  onChange={(e) => upd(i, { featured: e.target.checked })}
                  className="rounded border-border"
                />
                Wyróżniony plan
              </label>
            </ItemFrame>
          );
        })}
      </div>
    </ListShell>
  );
}

function RatedListEditor({ c, lang, setContent }: { c: WidgetNode["content"]; lang: "pl"|"en"; setContent: (k: string, v: Json) => void }) {
  const items = itemsOf(c, "items");
  const update = (next: Item[]) => setContent("items", next as unknown as Json);
  const upd = (i: number, patch: Partial<Item>) =>
    update(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const source = typeof c.source === "string" ? c.source : "manual";
  const showRating = c.showRating !== false;

  const numFont = typeof c.numberFont === "string" ? c.numberFont : "display";
  const numWeight = typeof c.numberWeight === "string" ? c.numberWeight : "700";
  const numSize = typeof c.numberSizePx === "number" ? c.numberSizePx : 48;
  const numColor = typeof c.numberColor === "string" ? c.numberColor : "#000000";
  const numColorDark = typeof c.numberColorDark === "string" ? c.numberColorDark : "#ffffff";
  const numOpacity = typeof c.numberOpacity === "number" ? c.numberOpacity : 0.05;
  const numPos = typeof c.numberPosition === "string" ? c.numberPosition : "behind";

  const txt = (k: string) => typeof c[k] === "string" ? (c[k] as string) : "";
  const num = (k: string, d: number) => typeof c[k] === "number" ? (c[k] as number) : d;

  return (
    <div className="space-y-4">
      {/* Źródło danych */}
      <div className="space-y-2 border border-border rounded-md p-2 bg-background">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Źródło danych</div>
        <PropField label="Skąd brać materiały">
          <Select value={source} onValueChange={(v) => setContent("source", v as Json)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Ręczna lista pozycji</SelectItem>
              <SelectItem value="dynamic">Dynamicznie z wpisów</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={showRating} onChange={(e) => setContent("showRating", e.target.checked as Json)} />
          Pokazuj ocenę (paski + liczba)
        </label>
      </div>

      {source === "dynamic" && (
        <div className="space-y-2 border border-border rounded-md p-2 bg-background">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Query Settings</div>
          <PropField label="Categories Filter (slugi, np. raporty,analizy)">
            <Input value={txt("categoriesFilter")} onChange={(e) => setContent("categoriesFilter", e.target.value as Json)} className="h-8 text-xs" placeholder="slug1,slug2" />
          </PropField>
          <PropField label="Exclude Categories (slugi)">
            <Input value={txt("excludeCategories")} onChange={(e) => setContent("excludeCategories", e.target.value as Json)} className="h-8 text-xs" placeholder="slug1,slug2" />
          </PropField>
          <PropField label="Tags Filter (slugi)">
            <Input value={txt("tagsFilter")} onChange={(e) => setContent("tagsFilter", e.target.value as Json)} className="h-8 text-xs" placeholder="tag1,tag2" />
          </PropField>
          <PropField label="Exclude Tags (slugi)">
            <Input value={txt("excludeTags")} onChange={(e) => setContent("excludeTags", e.target.value as Json)} className="h-8 text-xs" placeholder="tag1,tag2" />
          </PropField>
          <PropField label="Post Format">
            <Select value={txt("postFormatFilter") || "all"} onValueChange={(v) => setContent("postFormatFilter", v as Json)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Wszystkie</SelectItem>
                <SelectItem value="standard">Standard</SelectItem>
                <SelectItem value="video">Wideo</SelectItem>
                <SelectItem value="gallery">Galeria</SelectItem>
                <SelectItem value="quote">Cytat</SelectItem>
                <SelectItem value="audio">Audio</SelectItem>
                <SelectItem value="link">Link</SelectItem>
              </SelectContent>
            </Select>
          </PropField>
          <PropField label="Author Filter (nazwy autorów, csv)">
            <Input value={txt("authorFilter")} onChange={(e) => setContent("authorFilter", e.target.value as Json)} className="h-8 text-xs" placeholder="Imię Nazwisko, Inna Osoba" />
          </PropField>
          <PropField label="Post IDs Filter (UUID, csv)">
            <Input value={txt("postIdsFilter")} onChange={(e) => setContent("postIdsFilter", e.target.value as Json)} className="h-8 text-xs" placeholder="uuid1,uuid2" />
          </PropField>
          <PropField label="Exclude Post IDs (UUID, csv)">
            <Input value={txt("excludePostIds")} onChange={(e) => setContent("excludePostIds", e.target.value as Json)} className="h-8 text-xs" placeholder="uuid1,uuid2" />
          </PropField>
          <div className="grid grid-cols-2 gap-2">
            <PropField label="Order By">
              <Select value={txt("orderBy") || "last_published"} onValueChange={(v) => setContent("orderBy", v as Json)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="last_published">Ostatnio publikowane</SelectItem>
                  <SelectItem value="title_asc">Tytuł A→Z</SelectItem>
                  <SelectItem value="title_desc">Tytuł Z→A</SelectItem>
                  <SelectItem value="random">Losowo</SelectItem>
                </SelectContent>
              </Select>
            </PropField>
            <PropField label="Number of Posts">
              <Input type="number" min={1} max={50} value={num("numberOfPosts", 4)}
                onChange={(e) => setContent("numberOfPosts", (Number(e.target.value) || 1) as Json)} className="h-8 text-xs" />
            </PropField>
            <PropField label="Post Offset">
              <Input type="number" min={0} value={num("postOffset", 0)}
                onChange={(e) => setContent("postOffset", (Number(e.target.value) || 0) as Json)} className="h-8 text-xs" />
            </PropField>
          </div>
        </div>
      )}

      {/* Numeracja */}
      <div className="space-y-2 border border-border rounded-md p-2 bg-background">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Numeracja</div>
        <div className="grid grid-cols-2 gap-2">
          <PropField label="Font">
            <Select value={numFont} onValueChange={(v) => setContent("numberFont", v as Json)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="display">Display</SelectItem>
                <SelectItem value="sans">Sans</SelectItem>
                <SelectItem value="serif">Serif</SelectItem>
                <SelectItem value="mono">Mono</SelectItem>
              </SelectContent>
            </Select>
          </PropField>
          <PropField label="Grubość">
            <Select value={numWeight} onValueChange={(v) => setContent("numberWeight", v as Json)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["300","400","500","600","700","800","900"].map((w) => (
                  <SelectItem key={w} value={w}>{w}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </PropField>
          <PropField label="Rozmiar (px)">
            <Input type="number" min={12} max={240} step={1} value={numSize}
              onChange={(e) => setContent("numberSizePx", (Number(e.target.value) || 0) as Json)}
              className="h-8 text-xs" />
          </PropField>
          <PropField label="Pozycja">
            <Select value={numPos} onValueChange={(v) => setContent("numberPosition", v as Json)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="behind">Za treścią (prawy róg)</SelectItem>
                <SelectItem value="left">Z lewej obok</SelectItem>
                <SelectItem value="top">Nad tytułem</SelectItem>
              </SelectContent>
            </Select>
          </PropField>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <PropField label="Kolor (light)">
            <ColorField value={numColor} onChange={(v) => setContent("numberColor", (v ?? "") as Json)} />
          </PropField>
          <PropField label="Kolor (dark)">
            <ColorField value={numColorDark} onChange={(v) => setContent("numberColorDark", (v ?? "") as Json)} />
          </PropField>
        </div>
        <PropField label={`Przezroczystość (${Math.round(numOpacity * 100)}%)`}>
          <Input type="range" min={0} max={1} step={0.01} value={numOpacity}
            onChange={(e) => setContent("numberOpacity", (Number(e.target.value) || 0) as Json)}
            className="h-6" />
        </PropField>
      </div>

      {source === "manual" && (
        <ListShell
          title="Pozycje listy"
          items={items}
          onAdd={() => update([...items, { title_pl: "Nowa pozycja", title_en: "New item", excerpt_pl: "", excerpt_en: "", author: "", rating: 0 }])}
        >
          <div className="space-y-2">
            {items.map((it, i) => (
              <ItemFrame key={i} title={`Pozycja #${i + 1}`} onRemove={() => update(items.filter((_, j) => j !== i))}>
                <PropField label={`Tytuł (${lang.toUpperCase()})`}>
                  <Input
                    value={typeof it[`title_${lang}`] === "string" ? (it[`title_${lang}`] as string) : ""}
                    onChange={(e) => upd(i, { [`title_${lang}`]: e.target.value })}
                    className="h-8 text-xs"
                  />
                </PropField>
                <PropField label={`Zajawka (${lang.toUpperCase()})`}>
                  <Textarea
                    rows={2}
                    value={typeof it[`excerpt_${lang}`] === "string" ? (it[`excerpt_${lang}`] as string) : ""}
                    onChange={(e) => upd(i, { [`excerpt_${lang}`]: e.target.value })}
                    className="text-xs"
                  />
                </PropField>
                <div className="grid grid-cols-2 gap-2">
                  <PropField label="Autor">
                    <Input
                      value={typeof it.author === "string" ? it.author : ""}
                      onChange={(e) => upd(i, { author: e.target.value })}
                      className="h-8 text-xs"
                    />
                  </PropField>
                  <PropField label="Ocena (0–10)">
                    <Input
                      type="number" min={0} max={10} step={0.1}
                      value={typeof it.rating === "number" ? it.rating : 0}
                      onChange={(e) => upd(i, { rating: Number(e.target.value) || 0 })}
                      className="h-8 text-xs"
                    />
                  </PropField>
                </div>
              </ItemFrame>
            ))}
          </div>
        </ListShell>
      )}
    </div>
  );
}




// ---------- Image editor (upload + light/dark variant + preview) ----------

function ImageEditor({ c, lang, setContent }: { c: WidgetNode["content"]; lang: "pl"|"en"; setContent: (k: string, v: Json) => void }) {
  const src = typeof c.src === "string" ? c.src : "";
  const srcDark = typeof c.srcDark === "string" ? c.srcDark : "";
  const altPl = typeof c.alt_pl === "string" ? c.alt_pl : "";
  const altEn = typeof c.alt_en === "string" ? c.alt_en : "";
  const href = typeof c.href === "string" ? c.href : "";
  const [previewMode, setPreviewMode] = useState<"light" | "dark">("light");

  return (
    <div className="space-y-4">
      {/* Preview on prepared backgrounds */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Podgląd</span>
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setPreviewMode("light")}
              className={`flex items-center gap-1 px-2 py-1 text-[11px] ${previewMode === "light" ? "bg-brand text-brand-foreground" : "bg-background hover:bg-muted"}`}
            >
              <Sun className="w-3 h-3" /> Light
            </button>
            <button
              type="button"
              onClick={() => setPreviewMode("dark")}
              className={`flex items-center gap-1 px-2 py-1 text-[11px] ${previewMode === "dark" ? "bg-brand text-brand-foreground" : "bg-background hover:bg-muted"}`}
            >
              <Moon className="w-3 h-3" /> Dark
            </button>
          </div>
        </div>
        <div
          className="rounded-md border border-border flex items-center justify-center p-4 min-h-[120px]"
          style={{ background: previewMode === "dark" ? "#0b0b0e" : "#ffffff" }}
        >
          {(() => {
            const shown = previewMode === "dark" ? (srcDark || src) : (src || srcDark);
            if (!shown) {
              return (
                <div className="flex flex-col items-center gap-1 text-[11px] text-muted-foreground">
                  <ImageIcon className="w-5 h-5 opacity-50" />
                  Brak obrazka
                </div>
              );
            }
            return <img src={shown} alt="" className="max-h-32 max-w-full object-contain" />;
          })()}
        </div>
      </div>

      {/* Light variant */}
      <ImageSlot
        label="Obrazek – Light mode"
        icon={<Sun className="w-3.5 h-3.5" />}
        value={src}
        onChange={(v) => setContent("src", v)}
      />

      {/* Dark variant */}
      <ImageSlot
        label="Obrazek – Dark mode (opcjonalnie)"
        icon={<Moon className="w-3.5 h-3.5" />}
        value={srcDark}
        onChange={(v) => setContent("srcDark", v)}
        hint="Jeśli puste – używany jest wariant Light."
      />

      <div className="pt-2 border-t border-border space-y-2">
        <PropField label="Alt (PL)">
          <Input value={altPl} onChange={(e) => setContent("alt_pl", e.target.value)} className="h-8 text-xs" />
        </PropField>
        <PropField label="Alt (EN)">
          <Input value={altEn} onChange={(e) => setContent("alt_en", e.target.value)} className="h-8 text-xs" />
        </PropField>
        <PropField label="Link (opcjonalnie)">
          <Input value={href} placeholder="https://..." onChange={(e) => setContent("href", e.target.value)} className="h-8 text-xs" />
        </PropField>
      </div>
      <div className="text-[10px] text-muted-foreground">Aktywny język edycji: {lang.toUpperCase()}</div>
    </div>
  );
}

function ImageSlot({ label, icon, value, onChange, hint }: {
  label: string;
  icon: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `widgets/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage.from("media").upload(path, file, {
        cacheControl: "3600", upsert: false, contentType: file.type,
      });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("media").getPublicUrl(path);
      onChange(data.publicUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd uploadu");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon}{label}
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={value}
          placeholder="https://... lub wgraj plik"
          onChange={(e) => onChange(e.target.value)}
          className="h-8 text-xs flex-1"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-border hover:bg-muted text-muted-foreground"
            title="Usuń"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
      />
      <button
        type="button"
        disabled={uploading}
        onClick={() => fileRef.current?.click()}
        className="w-full inline-flex items-center justify-center gap-1.5 h-8 rounded-md border border-dashed border-border hover:border-brand hover:bg-muted/30 text-xs disabled:opacity-50"
      >
        <Upload className="w-3.5 h-3.5" />
        {uploading ? "Wgrywam…" : "Wgraj obrazek"}
      </button>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
      {error && <div className="text-[10px] text-destructive">{error}</div>}
    </div>
  );
}
