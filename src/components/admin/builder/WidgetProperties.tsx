// Widget properties panel: Content / Style / Advanced tabs. Style covers
// typography (color, padding, margin, align, border radius) per device.
// Advanced covers HTML id / classes, animation, responsive visibility,
// custom CSS.
import type {
  WidgetNode, CommonStyle, AdvancedSettings, ResponsiveValue, Device, Json, Align,
} from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

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
  const setResp = <T,>(rv: ResponsiveValue<T> | undefined, val: T | undefined): ResponsiveValue<T> =>
    ({ ...(rv ?? {}), [device]: val });

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

      <TabsContent value="style" className="space-y-3 mt-3">
        <div className="text-[10px] text-muted-foreground uppercase">Edytujesz: {device}</div>
        <Field label="Tło">
          <Input type="text" value={widget.style?.bgColor ?? ""}
            onChange={(e) => setStyle((s) => { s.bgColor = e.target.value || undefined; })}
            placeholder="#fff lub var(--brand)" className="h-8 text-xs" />
        </Field>
        <Field label="Kolor tekstu">
          <Input type="text" value={widget.style?.textColor ?? ""}
            onChange={(e) => setStyle((s) => { s.textColor = e.target.value || undefined; })}
            placeholder="#000" className="h-8 text-xs" />
        </Field>
        <Field label={`Padding (${device})`}>
          <Input value={widget.style?.padding?.[device] ?? ""}
            onChange={(e) => setStyle((s) => { s.padding = setResp(s.padding, e.target.value || undefined); })}
            placeholder="16px 24px" className="h-8 text-xs" />
        </Field>
        <Field label={`Margin (${device})`}>
          <Input value={widget.style?.margin?.[device] ?? ""}
            onChange={(e) => setStyle((s) => { s.margin = setResp(s.margin, e.target.value || undefined); })}
            placeholder="0 0 16px" className="h-8 text-xs" />
        </Field>
        <Field label={`Wyrównanie (${device})`}>
          <Select value={widget.style?.align?.[device] ?? "left"}
            onValueChange={(v) => setStyle((s) => { s.align = setResp(s.align, v as Align); })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="left">Lewo</SelectItem>
              <SelectItem value="center">Środek</SelectItem>
              <SelectItem value="right">Prawo</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Border radius">
          <Input value={widget.style?.borderRadius ?? ""}
            onChange={(e) => setStyle((s) => { s.borderRadius = e.target.value || undefined; })}
            placeholder="8px" className="h-8 text-xs" />
        </Field>
        <Field label="Max width">
          <Input value={widget.style?.maxWidth ?? ""}
            onChange={(e) => setStyle((s) => { s.maxWidth = e.target.value || undefined; })}
            placeholder="600px" className="h-8 text-xs" />
        </Field>
      </TabsContent>

      <TabsContent value="advanced" className="space-y-3 mt-3">
        <Field label="HTML ID">
          <Input value={widget.advanced?.htmlId ?? ""}
            onChange={(e) => setAdvanced((a) => { a.htmlId = e.target.value || undefined; })}
            className="h-8 text-xs" />
        </Field>
        <Field label="CSS class">
          <Input value={widget.advanced?.cssClass ?? ""}
            onChange={(e) => setAdvanced((a) => { a.cssClass = e.target.value || undefined; })}
            className="h-8 text-xs" />
        </Field>
        <Field label="Animacja wejścia">
          <Select value={widget.advanced?.animation ?? "none"}
            onValueChange={(v) => setAdvanced((a) => { a.animation = v as AdvancedSettings["animation"]; })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Brak</SelectItem>
              <SelectItem value="fade">Fade</SelectItem>
              <SelectItem value="slide-up">Slide up</SelectItem>
              <SelectItem value="zoom">Zoom</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <div className="space-y-1.5">
          <Label className="text-xs">Ukryj na</Label>
          {(["desktop","tablet","mobile"] as const).map((d) => (
            <label key={d} className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={widget.advanced?.hideOn?.[d] ?? false}
                onChange={(e) => setAdvanced((a) => { a.hideOn = { ...(a.hideOn ?? {}), [d]: e.target.checked }; })} />
              {d}
            </label>
          ))}
        </div>
        <Field label="Custom CSS">
          <Textarea rows={3} value={widget.advanced?.customCss ?? ""}
            onChange={(e) => setAdvanced((a) => { a.customCss = e.target.value || undefined; })}
            className="text-xs font-mono" placeholder=".my-class { color: red; }" />
        </Field>
      </TabsContent>
    </Tabs>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
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
        <Field label={`Tekst (${lang.toUpperCase()})`}>
          <Input value={str(`text_${lang}`)} onChange={(e) => setContent(`text_${lang}`, e.target.value)} className="h-8 text-xs" />
        </Field>
        <Field label="Tag">
          <Select value={str("tag") || "h2"} onValueChange={(v) => setContent("tag", v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{["h1","h2","h3","h4","h5","h6"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      </>;
    case "text":
      return <Field label={`HTML (${lang.toUpperCase()})`}>
        <Textarea rows={6} value={str(`html_${lang}`)} onChange={(e) => setContent(`html_${lang}`, e.target.value)} className="text-xs font-mono" />
      </Field>;
    case "image":
      return <>
        <Field label="URL obrazka">
          <Input value={str("src")} onChange={(e) => setContent("src", e.target.value)} placeholder="https://..." className="h-8 text-xs" />
        </Field>
        <Field label={`Alt (${lang.toUpperCase()})`}>
          <Input value={str(`alt_${lang}`)} onChange={(e) => setContent(`alt_${lang}`, e.target.value)} className="h-8 text-xs" />
        </Field>
      </>;
    case "button":
      return <>
        <Field label={`Etykieta (${lang.toUpperCase()})`}>
          <Input value={str(`label_${lang}`)} onChange={(e) => setContent(`label_${lang}`, e.target.value)} className="h-8 text-xs" />
        </Field>
        <Field label="Link"><Input value={str("href")} onChange={(e) => setContent("href", e.target.value)} className="h-8 text-xs" /></Field>
        <Field label="Wariant">
          <Select value={str("variant") || "primary"} onValueChange={(v) => setContent("variant", v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{["primary","outline","ghost"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      </>;
    case "spacer":
      return <Field label="Wysokość (px)">
        <Input type="number" value={num("height", 32)} onChange={(e) => setContent("height", Number(e.target.value))} className="h-8 text-xs" />
      </Field>;
    case "video":
      return <Field label="URL (YouTube lub MP4)">
        <Input value={str("url")} onChange={(e) => setContent("url", e.target.value)} className="h-8 text-xs" />
      </Field>;
    case "gallery":
      return <>
        <Field label="Obrazki (po jednym URL na linię)">
          <Textarea rows={5} value={arr("images").join("\n")}
            onChange={(e) => setContent("images", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
            className="text-xs font-mono" />
        </Field>
        <Field label="Kolumny">
          <Input type="number" min={1} max={6} value={num("columns", 3)} onChange={(e) => setContent("columns", Number(e.target.value))} className="h-8 text-xs" />
        </Field>
      </>;
    case "icon":
      return <>
        <Field label="Nazwa ikony">
          <Input value={str("name") || "Star"} onChange={(e) => setContent("name", e.target.value)} placeholder="Star, Heart, Mail..." className="h-8 text-xs" />
        </Field>
        <Field label="Rozmiar (px)">
          <Input type="number" value={num("size", 32)} onChange={(e) => setContent("size", Number(e.target.value))} className="h-8 text-xs" />
        </Field>
      </>;
    case "map":
      return <Field label="Adres / zapytanie">
        <Input value={str("query")} onChange={(e) => setContent("query", e.target.value)} className="h-8 text-xs" />
      </Field>;
    case "post-list":
    case "carousel":
      return <>
        <Field label="Limit">
          <Input type="number" value={num("limit", 6)} onChange={(e) => setContent("limit", Number(e.target.value))} className="h-8 text-xs" />
        </Field>
        {widget.type === "post-list" && (
          <Field label="Kolumny">
            <Input type="number" min={1} max={6} value={num("columns", 3)} onChange={(e) => setContent("columns", Number(e.target.value))} className="h-8 text-xs" />
          </Field>
        )}
      </>;
    case "newsletter":
    case "cta":
      return <>
        <Field label={`Tytuł (${lang.toUpperCase()})`}>
          <Input value={str(`title_${lang}`)} onChange={(e) => setContent(`title_${lang}`, e.target.value)} className="h-8 text-xs" />
        </Field>
        {widget.type === "cta" && (
          <>
            <Field label={`CTA (${lang.toUpperCase()})`}>
              <Input value={str(`cta_${lang}`)} onChange={(e) => setContent(`cta_${lang}`, e.target.value)} className="h-8 text-xs" />
            </Field>
            <Field label="Link"><Input value={str("href")} onChange={(e) => setContent("href", e.target.value)} className="h-8 text-xs" /></Field>
          </>
        )}
      </>;
    case "contact":
      return <Field label="Email odbiorcy">
        <Input value={str("to")} onChange={(e) => setContent("to", e.target.value)} className="h-8 text-xs" />
      </Field>;
    default:
      return <div className="text-xs text-muted-foreground">Brak edytowalnych pól dla tego widgetu.</div>;
  }
}
