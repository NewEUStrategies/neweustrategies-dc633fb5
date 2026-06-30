// Organism: animated heading editor (mode/shape + duo-tone color + rotation words).
import { toJson } from "@/lib/builder/types";
import type { WidgetNode, Json } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { PropField, ColorField } from "../../atoms";
import {
  ANIMATED_MODES,
  ANIMATED_SHAPES,
  AnimatedHeadingRender,
  type AnimatedHeadingConfig,
  type AnimatedHeadingMode,
  type AnimatedHeadingShape,
} from "@/lib/builder/animatedHeadingVariants";

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}

export function AnimatedHeadingEditor({ c, lang, setContent }: Props) {
  const mode = (typeof c.mode === "string" ? c.mode : "highlight") as AnimatedHeadingMode;
  const shape = (typeof c.shape === "string" ? c.shape : "underline") as AnimatedHeadingShape;
  const tag = (typeof c.tag === "string" ? c.tag : "h2") as "h1"|"h2"|"h3"|"h4"|"h5"|"h6";

  const isHoverMode = mode === "hover-underline";
  const visibleShapes = isHoverMode
    ? ANIMATED_SHAPES.filter((s) => s.value.startsWith("hover-line-"))
    : ANIMATED_SHAPES.filter((s) => !s.value.startsWith("hover-line-"));

  const handleModeChange = (v: string) => {
    setContent("mode", v);
    if (v === "hover-underline" && !shape.startsWith("hover-line-")) {
      setContent("shape", "hover-line-1");
    } else if (v !== "hover-underline" && shape.startsWith("hover-line-")) {
      setContent("shape", "underline");
    }
  };
  const align = (typeof c.align === "string" ? c.align : "left") as "left" | "center" | "right";

  const textBefore = (c[`textBefore_${lang}`] as string) || "";
  const textAfter  = (c[`textAfter_${lang}`]  as string) || "";
  const highlight  = (c[`highlight_${lang}`]  as string) || "";
  const rotateRaw  = c[`rotateWords_${lang}`];
  const rotateWords: string[] = Array.isArray(rotateRaw)
    ? rotateRaw.filter((x): x is string => typeof x === "string")
    : [];

  const color = (typeof c.color === "string" ? c.color : "") || "";
  const accentColor = (typeof c.accentColor === "string" ? c.accentColor : "") || "#f97316";
  const durationMs = typeof c.durationMs === "number" ? c.durationMs : 1600;
  const delayMs    = typeof c.delayMs    === "number" ? c.delayMs    : 200;
  const loop = c.loop !== false;

  const setWords = (txt: string) => {
    const arr = txt.split("\n").map((s) => s.trim()).filter(Boolean);
    setContent(`rotateWords_${lang}`, toJson(arr));
  };

  const previewCfg: AnimatedHeadingConfig = {
    mode, shape, tag, align, textBefore, textAfter, highlight,
    rotateWords, color: color || undefined, accentColor,
    durationMs, delayMs, loop,
  };

  const accentPresets = ["#f97316", "#ef4444", "#eab308", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#0ea5e9"];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <PropField label="Tryb animacji">
          <Select value={mode} onValueChange={handleModeChange}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ANIMATED_MODES.map((m) => (
                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PropField>
        <PropField label="Tag HTML">
          <Select value={tag} onValueChange={(v) => setContent("tag", v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["h1","h2","h3","h4","h5","h6"].map((t) => (
                <SelectItem key={t} value={t}>{t.toUpperCase()}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PropField>
      </div>

      <div className="space-y-1.5">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Kształt animacji
        </div>
        <div className="grid grid-cols-3 gap-2">
          {visibleShapes.map((s) => {
            const isActive = shape === s.value;
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => setContent("shape", s.value)}
                className={`relative rounded-md border p-2 transition text-center overflow-hidden ${
                  isActive
                    ? "ring-2 ring-brand border-brand bg-brand/5"
                    : "border-border hover:border-brand/50 bg-background"
                }`}
                title={s.label}
              >
                <div className="pointer-events-none flex items-center justify-center h-[44px]">
                  <div style={{ transform: "scale(0.42)", transformOrigin: "center", lineHeight: 1 }}>
                    <AnimatedHeadingRender
                      config={{
                        mode: "highlight",
                        shape: s.value,
                        tag: "h6",
                        highlight: "Abc",
                        accentColor: accentColor || "hsl(var(--foreground))",
                        durationMs: 1200,
                        loop: false,
                      }}
                      preview
                    />
                  </div>
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground truncate">{s.label}</div>
                {isActive && (
                  <span className="absolute top-1 right-1 text-brand text-xs">✓</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <section className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="inline-block h-4 w-1 rounded bg-muted-foreground/50" />
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Tekst statyczny (bez animacji)
          </h4>
        </div>
        <PropField label={`Przed tekstem (${lang.toUpperCase()})`}>
          <Input
            value={textBefore}
            onChange={(e) => setContent(`textBefore_${lang}`, e.target.value)}
            placeholder="np. Dołącz"
            className="h-8 text-xs"
          />
        </PropField>
        <PropField label={`Za tekstem (${lang.toUpperCase()})`}>
          <Input
            value={textAfter}
            onChange={(e) => setContent(`textAfter_${lang}`, e.target.value)}
            placeholder="np. już dziś"
            className="h-8 text-xs"
          />
        </PropField>
        <PropField label="Kolor tekstu statycznego">
          <ColorField
            value={color}
            onChange={(v) => setContent("color", v ?? "")}
            placeholder="domyślny"
          />
        </PropField>
      </section>

      <section className="rounded-md border border-brand/40 bg-brand/5 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="inline-block h-4 w-1 rounded bg-brand" />
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-brand">
            Tekst animowany (duo-tone)
          </h4>
        </div>

        {mode === "highlight" ? (
          <PropField label={`Tekst wyróżniony (${lang.toUpperCase()})`}>
            <Input
              value={highlight}
              onChange={(e) => setContent(`highlight_${lang}`, e.target.value)}
              placeholder="np. do nas"
              className="h-8 text-xs"
            />
          </PropField>
        ) : (
          <PropField label={`Słowa do rotacji (${lang.toUpperCase()}) - jedno na linię`}>
            <Textarea
              rows={4}
              value={rotateWords.join("\n")}
              onChange={(e) => setWords(e.target.value)}
              placeholder={"szybko\nłatwo\nskutecznie"}
              className="text-xs font-mono"
            />
          </PropField>
        )}

        <PropField label="Kolor tekstu animowanego + kształtu">
          <ColorField
            value={accentColor}
            onChange={(v) => setContent("accentColor", v ?? "")}
            placeholder="#f97316"
          />
        </PropField>
        <div className="flex flex-wrap gap-1.5">
          {accentPresets.map((hex) => (
            <button
              key={hex}
              type="button"
              onClick={() => setContent("accentColor", hex)}
              className={`h-6 w-6 rounded-full border ${accentColor.toLowerCase() === hex ? "ring-2 ring-brand border-brand" : "border-border"}`}
              style={{ background: hex }}
              title={hex}
            />
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <PropField label="Czas animacji (ms)">
            <Input
              type="number" min={300} max={10000} step={100}
              value={durationMs}
              onChange={(e) => setContent("durationMs", Number(e.target.value) || 1600)}
              className="h-8 text-xs"
            />
          </PropField>
          <PropField label="Opóźnienie startu (ms)">
            <Input
              type="number" min={0} max={10000} step={100}
              value={delayMs}
              onChange={(e) => setContent("delayMs", Number(e.target.value) || 0)}
              className="h-8 text-xs"
            />
          </PropField>
          <PropField label="Pętla">
            <Select value={loop ? "on" : "off"} onValueChange={(v) => setContent("loop", v === "on")}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="on">tak</SelectItem>
                <SelectItem value="off">nie</SelectItem>
              </SelectContent>
            </Select>
          </PropField>
          <PropField label="Wyrównanie">
            <Select value={align} onValueChange={(v) => setContent("align", v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="left">do lewej</SelectItem>
                <SelectItem value="center">do środka</SelectItem>
                <SelectItem value="right">do prawej</SelectItem>
              </SelectContent>
            </Select>
          </PropField>
        </div>
      </section>

      <div className="space-y-1.5">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Podgląd na żywo
        </div>
        <div className="rounded-md border border-border p-4 bg-background">
          <AnimatedHeadingRender config={previewCfg} />
        </div>
      </div>
    </div>
  );
}
