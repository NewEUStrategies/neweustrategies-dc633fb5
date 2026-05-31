// Section properties panel — Elementor-style Layout / Style / Advanced tabs.
// Edits live inside an immer-style mutation callback supplied by Builder.
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import type {
  SectionNode, Device, BackgroundSettings, OverlaySettings, BorderSettings,
  ShapeDividerSettings, TypographySettings, SectionLayout, BoxSides, Align,
  ContentWidth, SectionHeight, VerticalAlign, ColumnsGap, OverflowMode, HtmlTag,
  BackgroundType, BackgroundPosition, BackgroundRepeat, BackgroundSize,
  BackgroundAttachment, GradientType, BorderStyle, ShapeDividerType,
} from "@/lib/builder/types";

type Mut = (mut: (s: SectionNode) => void) => void;

interface Props {
  section: SectionNode;
  device: Device;
  onChange: Mut;
}

// -------- small typed helpers --------

const ensure = <T extends object>(v: T | undefined): T => (v ?? ({} as T));

function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ColorInput({ value, onChange, placeholder }: { value?: string; onChange: (v: string | undefined) => void; placeholder?: string }) {
  return (
    <div className="flex gap-2">
      <input
        type="color"
        value={value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-10 rounded border border-border bg-background cursor-pointer"
      />
      <Input
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        placeholder={placeholder ?? "#000 / rgba(...) / var(--brand)"}
        className="h-8 text-xs flex-1"
      />
    </div>
  );
}

function NumberInput({ value, onChange, min, max, step = 1, suffix }: { value?: number; onChange: (v: number | undefined) => void; min?: number; max?: number; step?: number; suffix?: string }) {
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        value={value ?? ""}
        min={min} max={max} step={step}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        className="h-8 text-xs"
      />
      {suffix && <span className="text-[10px] text-muted-foreground">{suffix}</span>}
    </div>
  );
}

function SidesInput({ value, onChange, suffix = "px" }: { value?: BoxSides; onChange: (v: BoxSides) => void; suffix?: string }) {
  const v = value ?? {};
  const upd = (k: keyof BoxSides, n: number | undefined) => onChange({ ...v, [k]: n });
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {(["top","right","bottom","left"] as const).map((k) => (
        <div key={k}>
          <Input type="number" value={v[k] ?? ""} placeholder={k[0].toUpperCase()}
            onChange={(e) => upd(k, e.target.value === "" ? undefined : Number(e.target.value))}
            className="h-8 text-xs" />
          <div className="text-[9px] text-muted-foreground text-center mt-0.5">{k} ({suffix})</div>
        </div>
      ))}
    </div>
  );
}

// -------- main component --------

export function SectionProperties({ section, device, onChange }: Props) {
  return (
    <Tabs defaultValue="layout">
      <TabsList className="grid grid-cols-3 w-full h-8">
        <TabsTrigger value="layout" className="text-xs">Układ</TabsTrigger>
        <TabsTrigger value="style" className="text-xs">Styl</TabsTrigger>
        <TabsTrigger value="advanced" className="text-xs">Zaawans.</TabsTrigger>
      </TabsList>

      <TabsContent value="layout" className="space-y-3 mt-3">
        <LayoutPane section={section} onChange={onChange} />
      </TabsContent>

      <TabsContent value="style" className="space-y-4 mt-3">
        <div className="text-[10px] text-muted-foreground uppercase">Edytujesz: {device}</div>
        <StylePane section={section} device={device} onChange={onChange} />
      </TabsContent>

      <TabsContent value="advanced" className="space-y-3 mt-3">
        <AdvancedPane section={section} onChange={onChange} />
      </TabsContent>
    </Tabs>
  );
}

// ================= LAYOUT =================

function LayoutPane({ section, onChange }: { section: SectionNode; onChange: Mut }) {
  const L = section.layout ?? {};
  const setL = (mut: (l: SectionLayout) => void) => onChange((s) => { s.layout = ensure(s.layout); mut(s.layout!); });

  return (
    <>
      <Row label="Szerokość treści">
        <Select value={L.contentWidth ?? "boxed"} onValueChange={(v) => setL((l) => { l.contentWidth = v as ContentWidth; })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="boxed">Opakowane</SelectItem>
            <SelectItem value="full">Pełna szerokość</SelectItem>
          </SelectContent>
        </Select>
      </Row>

      {(L.contentWidth ?? "boxed") === "boxed" && (
        <Row label="Szerokość (px)" hint="Domyślnie 1140">
          <NumberInput value={L.width} onChange={(n) => setL((l) => { l.width = n; })} min={300} max={1920} suffix="px" />
        </Row>
      )}

      <Row label="Odstęp kolumn">
        <Select value={L.columnsGap ?? "default"} onValueChange={(v) => setL((l) => { l.columnsGap = v as ColumnsGap; })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Domyślnie (20)</SelectItem>
            <SelectItem value="no">Bez odstępów (0)</SelectItem>
            <SelectItem value="narrow">Wąsko (10)</SelectItem>
            <SelectItem value="extended">Rozszerzony (15)</SelectItem>
            <SelectItem value="wide">Szeroki (30)</SelectItem>
            <SelectItem value="wider">Szerzej (40)</SelectItem>
            <SelectItem value="custom">Własne…</SelectItem>
          </SelectContent>
        </Select>
      </Row>
      {L.columnsGap === "custom" && (
        <Row label="Własny odstęp (px)">
          <NumberInput value={L.columnsGapCustom} onChange={(n) => setL((l) => { l.columnsGapCustom = n; })} min={0} max={200} suffix="px" />
        </Row>
      )}

      <Row label="Wysokość">
        <Select value={L.height ?? "default"} onValueChange={(v) => setL((l) => { l.height = v as SectionHeight; })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Domyślnie</SelectItem>
            <SelectItem value="fit-screen">Dopasuj do ekranu</SelectItem>
            <SelectItem value="min-height">Minimalna wysokość</SelectItem>
          </SelectContent>
        </Select>
      </Row>
      {L.height === "fit-screen" && (
        <Row label="Wysokość (vh)"><NumberInput value={L.heightValue} onChange={(n) => setL((l) => { l.heightValue = n; })} min={10} max={100} suffix="vh" /></Row>
      )}
      {L.height === "min-height" && (
        <Row label="Wysokość (px)"><NumberInput value={L.heightValue} onChange={(n) => setL((l) => { l.heightValue = n; })} min={50} max={2000} suffix="px" /></Row>
      )}

      <Row label="Wyrównanie pionowe">
        <Select value={L.verticalAlign ?? "default"} onValueChange={(v) => setL((l) => { l.verticalAlign = v as VerticalAlign; })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Domyślnie</SelectItem>
            <SelectItem value="top">Góra</SelectItem>
            <SelectItem value="middle">Środek</SelectItem>
            <SelectItem value="bottom">Dół</SelectItem>
            <SelectItem value="space-between">Odstęp pomiędzy</SelectItem>
            <SelectItem value="space-around">Odstęp wokół</SelectItem>
            <SelectItem value="space-evenly">Równomiernie</SelectItem>
          </SelectContent>
        </Select>
      </Row>

      <Row label="Przepływ">
        <Select value={L.overflow ?? "default"} onValueChange={(v) => setL((l) => { l.overflow = v as OverflowMode; })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Domyślnie</SelectItem>
            <SelectItem value="hidden">Ukryty</SelectItem>
          </SelectContent>
        </Select>
      </Row>

      <Row label="Sekcja rozciągania" hint="Rozciąga sekcję na pełną szerokość okna (100vw).">
        <Switch checked={!!L.stretch} onCheckedChange={(v) => setL((l) => { l.stretch = v; })} />
      </Row>

      <Row label="Znacznik HTML">
        <Select value={L.htmlTag ?? "section"} onValueChange={(v) => setL((l) => { l.htmlTag = v as HtmlTag; })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(["div","section","header","footer","main","article","aside","nav"] as const).map((t) =>
              <SelectItem key={t} value={t}>{t}</SelectItem>
            )}
          </SelectContent>
        </Select>
      </Row>
    </>
  );
}

// ================= STYLE =================

function StylePane({ section, device, onChange }: { section: SectionNode; device: Device; onChange: Mut }) {
  return (
    <div className="space-y-5">
      <Collapsible title="Tło">
        <Tabs defaultValue="normal">
          <TabsList className="grid grid-cols-2 w-full h-7">
            <TabsTrigger value="normal" className="text-xs">Normalne</TabsTrigger>
            <TabsTrigger value="hover" className="text-xs">Najechanie</TabsTrigger>
          </TabsList>
          <TabsContent value="normal" className="mt-2 space-y-3">
            <BackgroundEditor
              value={section.background}
              onChange={(mut) => onChange((s) => { s.background = ensure(s.background); mut(s.background!); })}
            />
          </TabsContent>
          <TabsContent value="hover" className="mt-2 space-y-3">
            <BackgroundEditor
              value={section.backgroundHover}
              onChange={(mut) => onChange((s) => { s.backgroundHover = ensure(s.backgroundHover); mut(s.backgroundHover!); })}
            />
          </TabsContent>
        </Tabs>
      </Collapsible>

      <Collapsible title="Nakładka tła">
        <OverlayEditor
          value={section.overlay}
          onChange={(mut) => onChange((s) => { s.overlay = ensure(s.overlay); mut(s.overlay!); })}
        />
      </Collapsible>

      <Collapsible title="Obramowanie">
        <BorderEditor
          value={section.border}
          onChange={(mut) => onChange((s) => { s.border = ensure(s.border); mut(s.border!); })}
        />
      </Collapsible>

      <Collapsible title="Kształt rozdzielacza · góra">
        <ShapeEditor
          value={section.shapeDividerTop}
          onChange={(mut) => onChange((s) => { s.shapeDividerTop = ensure(s.shapeDividerTop); mut(s.shapeDividerTop!); })}
        />
      </Collapsible>
      <Collapsible title="Kształt rozdzielacza · dół">
        <ShapeEditor
          value={section.shapeDividerBottom}
          onChange={(mut) => onChange((s) => { s.shapeDividerBottom = ensure(s.shapeDividerBottom); mut(s.shapeDividerBottom!); })}
        />
      </Collapsible>

      <Collapsible title="Typografia">
        <TypographyEditor
          value={section.typography}
          device={device}
          onChange={(mut) => onChange((s) => { s.typography = ensure(s.typography); mut(s.typography!); })}
        />
      </Collapsible>
    </div>
  );
}

function Collapsible({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="border border-border rounded bg-muted/20 open:bg-card transition" open>
      <summary className="cursor-pointer text-xs font-medium px-3 py-2 select-none">{title}</summary>
      <div className="px-3 py-3 space-y-3 border-t border-border">{children}</div>
    </details>
  );
}

// ---- background editor ----

function BackgroundEditor({ value, onChange }: { value?: BackgroundSettings; onChange: (mut: (b: BackgroundSettings) => void) => void }) {
  const b = value ?? {};
  return (
    <>
      <Row label="Typ tła">
        <Select value={b.type ?? "none"} onValueChange={(v) => onChange((x) => { x.type = v as BackgroundType; })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Brak</SelectItem>
            <SelectItem value="classic">Klasyczne</SelectItem>
            <SelectItem value="gradient">Gradient</SelectItem>
            <SelectItem value="video">Wideo</SelectItem>
            <SelectItem value="slideshow">Pokaz slajdów</SelectItem>
          </SelectContent>
        </Select>
      </Row>

      {(b.type === "classic" || b.type === "video" || b.type === "slideshow") && (
        <Row label="Kolor"><ColorInput value={b.color} onChange={(v) => onChange((x) => { x.color = v; })} /></Row>
      )}

      {b.type === "classic" && (
        <>
          <Row label="Obraz (URL)">
            <Input value={b.imageUrl ?? ""} onChange={(e) => onChange((x) => { x.imageUrl = e.target.value || undefined; })} placeholder="https://…" className="h-8 text-xs" />
          </Row>
          <Row label="Pozycja">
            <Select value={b.position ?? "center center"} onValueChange={(v) => onChange((x) => { x.position = v as BackgroundPosition; })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(["center center","top center","top left","top right","center left","center right","bottom center","bottom left","bottom right"] as const).map((p) =>
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </Row>
          <Row label="Powtarzanie">
            <Select value={b.repeat ?? "no-repeat"} onValueChange={(v) => onChange((x) => { x.repeat = v as BackgroundRepeat; })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(["no-repeat","repeat","repeat-x","repeat-y"] as const).map((p) =>
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </Row>
          <Row label="Rozmiar">
            <Select value={b.size ?? "cover"} onValueChange={(v) => onChange((x) => { x.size = v as BackgroundSize; })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(["auto","cover","contain"] as const).map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </Row>
          <Row label="Przyczepność">
            <Select value={b.attachment ?? "scroll"} onValueChange={(v) => onChange((x) => { x.attachment = v as BackgroundAttachment; })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="scroll">Scroll</SelectItem>
                <SelectItem value="fixed">Fixed (parallax)</SelectItem>
              </SelectContent>
            </Select>
          </Row>
        </>
      )}

      {b.type === "gradient" && (
        <>
          <Row label="Typ gradientu">
            <Select value={b.gradientType ?? "linear"} onValueChange={(v) => onChange((x) => { x.gradientType = v as GradientType; })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="linear">Liniowy</SelectItem>
                <SelectItem value="radial">Promienisty</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row label="Kolor 1"><ColorInput value={b.gradientColor} onChange={(v) => onChange((x) => { x.gradientColor = v; })} /></Row>
          <Row label="Pozycja 1 (%)"><NumberInput value={b.gradientLocation} onChange={(n) => onChange((x) => { x.gradientLocation = n; })} min={0} max={100} suffix="%" /></Row>
          <Row label="Kolor 2"><ColorInput value={b.gradientColor2} onChange={(v) => onChange((x) => { x.gradientColor2 = v; })} /></Row>
          <Row label="Pozycja 2 (%)"><NumberInput value={b.gradientLocation2} onChange={(n) => onChange((x) => { x.gradientLocation2 = n; })} min={0} max={100} suffix="%" /></Row>
          {(b.gradientType ?? "linear") === "linear" && (
            <Row label="Kąt (°)"><NumberInput value={b.gradientAngle} onChange={(n) => onChange((x) => { x.gradientAngle = n; })} min={0} max={360} suffix="°" /></Row>
          )}
        </>
      )}

      {b.type === "video" && (
        <Row label="URL wideo (mp4/YouTube)">
          <Input value={b.videoUrl ?? ""} onChange={(e) => onChange((x) => { x.videoUrl = e.target.value || undefined; })} className="h-8 text-xs" />
        </Row>
      )}

      {b.type === "slideshow" && (
        <Row label="Obrazy (URL na linię)">
          <Textarea rows={4} value={(b.slideshowImages ?? []).join("\n")}
            onChange={(e) => onChange((x) => { x.slideshowImages = e.target.value.split("\n").map((s) => s.trim()).filter(Boolean); })}
            className="text-xs font-mono" />
        </Row>
      )}
    </>
  );
}

// ---- overlay ----

function OverlayEditor({ value, onChange }: { value?: OverlaySettings; onChange: (mut: (o: OverlaySettings) => void) => void }) {
  const o = value ?? {};
  return (
    <>
      <BackgroundEditor value={value} onChange={onChange} />
      {o.type && o.type !== "none" && (
        <>
          <Row label="Przezroczystość (0–1)">
            <NumberInput value={o.opacity} step={0.05} min={0} max={1} onChange={(n) => onChange((x) => { x.opacity = n; })} />
          </Row>
          <Row label="Tryb mieszania">
            <Select value={o.blendMode ?? "normal"} onValueChange={(v) => onChange((x) => { x.blendMode = v as OverlaySettings["blendMode"]; })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(["normal","multiply","screen","overlay","darken","lighten","color-dodge","saturation","color","difference","exclusion","hue","luminosity"] as const).map((m) =>
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </Row>
        </>
      )}
    </>
  );
}

// ---- border ----

function BorderEditor({ value, onChange }: { value?: BorderSettings; onChange: (mut: (b: BorderSettings) => void) => void }) {
  const b = value ?? {};
  return (
    <>
      <Row label="Typ obramowania">
        <Select value={b.style ?? "none"} onValueChange={(v) => onChange((x) => { x.style = v as BorderStyle; })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(["none","solid","dashed","dotted","double","groove"] as const).map((s) =>
              <SelectItem key={s} value={s}>{s}</SelectItem>
            )}
          </SelectContent>
        </Select>
      </Row>
      {b.style && b.style !== "none" && (
        <>
          <Row label="Szerokość (px)"><SidesInput value={b.width} onChange={(w) => onChange((x) => { x.width = w; })} /></Row>
          <Row label="Kolor"><ColorInput value={b.color} onChange={(v) => onChange((x) => { x.color = v; })} /></Row>
        </>
      )}
      <Row label="Zaokrąglenie narożników (px)"><SidesInput value={b.radius} onChange={(r) => onChange((x) => { x.radius = r; })} /></Row>
      <Row label="Cień (CSS box-shadow)" hint="Np. 0 10px 30px rgba(0,0,0,.2)">
        <Input value={b.boxShadow ?? ""} onChange={(e) => onChange((x) => { x.boxShadow = e.target.value || undefined; })} className="h-8 text-xs font-mono" />
      </Row>
    </>
  );
}

// ---- shape divider ----

function ShapeEditor({ value, onChange }: { value?: ShapeDividerSettings; onChange: (mut: (s: ShapeDividerSettings) => void) => void }) {
  const s = value ?? {};
  return (
    <>
      <Row label="Styl">
        <Select value={s.type ?? "none"} onValueChange={(v) => onChange((x) => { x.type = v as ShapeDividerType; })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(["none","mountains","drops","clouds","zigzag","pyramids","triangle","tilt","waves","curve","split","arrow","book"] as const).map((t) =>
              <SelectItem key={t} value={t}>{t}</SelectItem>
            )}
          </SelectContent>
        </Select>
      </Row>
      {s.type && s.type !== "none" && (
        <>
          <Row label="Kolor"><ColorInput value={s.color} onChange={(v) => onChange((x) => { x.color = v; })} /></Row>
          <Row label="Wysokość (px)"><NumberInput value={s.height} onChange={(n) => onChange((x) => { x.height = n; })} min={1} max={500} suffix="px" /></Row>
          <Row label="Szerokość (%)"><NumberInput value={s.width} onChange={(n) => onChange((x) => { x.width = n; })} min={100} max={300} suffix="%" /></Row>
          <div className="grid grid-cols-3 gap-2">
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={!!s.flipH} onChange={(e) => onChange((x) => { x.flipH = e.target.checked; })} /> Flip H</label>
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={!!s.flipV} onChange={(e) => onChange((x) => { x.flipV = e.target.checked; })} /> Invert</label>
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={!!s.bringToFront} onChange={(e) => onChange((x) => { x.bringToFront = e.target.checked; })} /> Na wierzch</label>
          </div>
        </>
      )}
    </>
  );
}

// ---- typography ----

function TypographyEditor({ value, device, onChange }: { value?: TypographySettings; device: Device; onChange: (mut: (t: TypographySettings) => void) => void }) {
  const t = value ?? {};
  const setResp = (val: Align | undefined) => onChange((x) => { x.align = { ...(x.align ?? {}), [device]: val }; });
  return (
    <>
      <Row label="Kolor nagłówków"><ColorInput value={t.headingColor} onChange={(v) => onChange((x) => { x.headingColor = v; })} /></Row>
      <Row label="Kolor tekstu"><ColorInput value={t.textColor} onChange={(v) => onChange((x) => { x.textColor = v; })} /></Row>
      <Row label="Kolor linków"><ColorInput value={t.linkColor} onChange={(v) => onChange((x) => { x.linkColor = v; })} /></Row>
      <Row label="Kolor linków (hover)"><ColorInput value={t.linkHoverColor} onChange={(v) => onChange((x) => { x.linkHoverColor = v; })} /></Row>
      <Row label={`Wyrównanie (${device})`}>
        <Select value={t.align?.[device] ?? "left"} onValueChange={(v) => setResp(v as Align)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="left">Lewo</SelectItem>
            <SelectItem value="center">Środek</SelectItem>
            <SelectItem value="right">Prawo</SelectItem>
          </SelectContent>
        </Select>
      </Row>
    </>
  );
}

// ================= ADVANCED =================

function AdvancedPane({ section, onChange }: { section: SectionNode; onChange: Mut }) {
  const setA = (mut: (a: NonNullable<SectionNode["advanced"]>) => void) =>
    onChange((s) => { s.advanced = ensure(s.advanced); mut(s.advanced!); });
  const a = section.advanced ?? {};
  return (
    <>
      <Row label="HTML ID"><Input value={a.htmlId ?? ""} onChange={(e) => setA((x) => { x.htmlId = e.target.value || undefined; })} className="h-8 text-xs" /></Row>
      <Row label="CSS class"><Input value={a.cssClass ?? ""} onChange={(e) => setA((x) => { x.cssClass = e.target.value || undefined; })} className="h-8 text-xs" /></Row>
      <Row label="Animacja">
        <Select value={a.animation ?? "none"} onValueChange={(v) => setA((x) => { x.animation = v as "none"|"fade"|"slide-up"|"zoom"; })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Brak</SelectItem>
            <SelectItem value="fade">Fade</SelectItem>
            <SelectItem value="slide-up">Slide up</SelectItem>
            <SelectItem value="zoom">Zoom</SelectItem>
          </SelectContent>
        </Select>
      </Row>
      <div className="space-y-1.5">
        <Label className="text-xs">Ukryj na</Label>
        {(["desktop","tablet","mobile"] as const).map((d) => (
          <label key={d} className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={a.hideOn?.[d] ?? false}
              onChange={(e) => setA((x) => { x.hideOn = { ...(x.hideOn ?? {}), [d]: e.target.checked }; })} />
            {d}
          </label>
        ))}
      </div>
      <Row label="Custom CSS">
        <Textarea rows={4} value={a.customCss ?? ""} onChange={(e) => setA((x) => { x.customCss = e.target.value || undefined; })} className="text-xs font-mono" placeholder=".my-class { color: red; }" />
      </Row>
    </>
  );
}
