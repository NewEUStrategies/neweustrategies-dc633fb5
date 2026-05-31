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

  return (
    <Tabs defaultValue="content">
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
  const str = (k: string): string => typeof c[k] === "string" ? c[k] as string : "";
  const num = (k: string, d: number): number => typeof c[k] === "number" ? c[k] as number : d;
  const arr = (k: string): string[] => {
    const v = c[k];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  };

  switch (widget.type) {
    case "heading":
      return <>
        <PropField label={`Tekst (${lang.toUpperCase()})`}>
          <Input value={str(`text_${lang}`)} onChange={(e) => setContent(`text_${lang}`, e.target.value)} className="h-8 text-xs" />
        </PropField>
        <PropField label="Tag">
          <Select value={str("tag") || "h2"} onValueChange={(v) => setContent("tag", v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{["h1","h2","h3","h4","h5","h6"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </PropField>
      </>;
    case "text":
      return <PropField label={`HTML (${lang.toUpperCase()})`}>
        <Textarea rows={6} value={str(`html_${lang}`)} onChange={(e) => setContent(`html_${lang}`, e.target.value)} className="text-xs font-mono" />
      </PropField>;
    case "image":
      return <>
        <PropField label="URL obrazka">
          <Input value={str("src")} onChange={(e) => setContent("src", e.target.value)} placeholder="https://..." className="h-8 text-xs" />
        </PropField>
        <PropField label={`Alt (${lang.toUpperCase()})`}>
          <Input value={str(`alt_${lang}`)} onChange={(e) => setContent(`alt_${lang}`, e.target.value)} className="h-8 text-xs" />
        </PropField>
      </>;
    case "button":
      return <>
        <PropField label={`Etykieta (${lang.toUpperCase()})`}>
          <Input value={str(`label_${lang}`)} onChange={(e) => setContent(`label_${lang}`, e.target.value)} className="h-8 text-xs" />
        </PropField>
        <PropField label="Link"><Input value={str("href")} onChange={(e) => setContent("href", e.target.value)} className="h-8 text-xs" /></PropField>
        <PropField label="Wariant">
          <Select value={str("variant") || "primary"} onValueChange={(v) => setContent("variant", v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{["primary","outline","ghost"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </PropField>
      </>;
    case "spacer":
      return <PropField label="Wysokość (px)">
        <Input type="number" value={num("height", 32)} onChange={(e) => setContent("height", Number(e.target.value))} className="h-8 text-xs" />
      </PropField>;
    case "video":
      return <PropField label="URL (YouTube lub MP4)">
        <Input value={str("url")} onChange={(e) => setContent("url", e.target.value)} className="h-8 text-xs" />
      </PropField>;
    case "gallery":
      return <>
        <PropField label="Obrazki (po jednym URL na linię)">
          <Textarea rows={5} value={arr("images").join("\n")}
            onChange={(e) => setContent("images", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
            className="text-xs font-mono" />
        </PropField>
        <PropField label="Kolumny">
          <Input type="number" min={1} max={6} value={num("columns", 3)} onChange={(e) => setContent("columns", Number(e.target.value))} className="h-8 text-xs" />
        </PropField>
      </>;
    case "icon":
      return <>
        <PropField label="Nazwa ikony">
          <Input value={str("name") || "Star"} onChange={(e) => setContent("name", e.target.value)} placeholder="Star, Heart, Mail..." className="h-8 text-xs" />
        </PropField>
        <PropField label="Rozmiar (px)">
          <Input type="number" value={num("size", 32)} onChange={(e) => setContent("size", Number(e.target.value))} className="h-8 text-xs" />
        </PropField>
      </>;
    case "map":
      return <PropField label="Adres / zapytanie">
        <Input value={str("query")} onChange={(e) => setContent("query", e.target.value)} className="h-8 text-xs" />
      </PropField>;
    case "post-list":
    case "carousel":
      return <>
        <PropField label="Limit">
          <Input type="number" value={num("limit", 6)} onChange={(e) => setContent("limit", Number(e.target.value))} className="h-8 text-xs" />
        </PropField>
        {widget.type === "post-list" && (
          <PropField label="Kolumny">
            <Input type="number" min={1} max={6} value={num("columns", 3)} onChange={(e) => setContent("columns", Number(e.target.value))} className="h-8 text-xs" />
          </PropField>
        )}
      </>;
    case "newsletter":
    case "cta":
      return <>
        <PropField label={`Tytuł (${lang.toUpperCase()})`}>
          <Input value={str(`title_${lang}`)} onChange={(e) => setContent(`title_${lang}`, e.target.value)} className="h-8 text-xs" />
        </PropField>
        {widget.type === "cta" && (
          <>
            <PropField label={`CTA (${lang.toUpperCase()})`}>
              <Input value={str(`cta_${lang}`)} onChange={(e) => setContent(`cta_${lang}`, e.target.value)} className="h-8 text-xs" />
            </PropField>
            <PropField label="Link"><Input value={str("href")} onChange={(e) => setContent("href", e.target.value)} className="h-8 text-xs" /></PropField>
          </>
        )}
      </>;
    case "contact":
      return <PropField label="Email odbiorcy">
        <Input value={str("to")} onChange={(e) => setContent("to", e.target.value)} className="h-8 text-xs" />
      </PropField>;
    case "accordion":
      return <AccordionEditor c={c} lang={lang} setContent={setContent} />;
    case "tabs":
      return <TabsEditor c={c} lang={lang} setContent={setContent} />;
    case "testimonial":
      return <>
        <PropField label={`Cytat (${lang.toUpperCase()})`}>
          <Textarea rows={3} value={str(`quote_${lang}`)} onChange={(e) => setContent(`quote_${lang}`, e.target.value)} className="text-xs" />
        </PropField>
        <PropField label="Autor">
          <Input value={str("author")} onChange={(e) => setContent("author", e.target.value)} className="h-8 text-xs" />
        </PropField>
        <PropField label={`Rola (${lang.toUpperCase()})`}>
          <Input value={str(`role_${lang}`)} onChange={(e) => setContent(`role_${lang}`, e.target.value)} className="h-8 text-xs" />
        </PropField>
        <PropField label="Avatar (URL)">
          <Input value={str("avatar")} onChange={(e) => setContent("avatar", e.target.value)} placeholder="https://..." className="h-8 text-xs" />
        </PropField>
      </>;
    case "pricing":
      return <PricingEditor c={c} lang={lang} setContent={setContent} />;
    default:
      return <div className="text-xs text-muted-foreground">Brak edytowalnych pól dla tego widgetu.</div>;
  }
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
