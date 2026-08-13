// Organism: animated heading editor (mode/shape + duo-tone color + rotation words).
import { toJson } from "@/lib/builder/types";
import type { WidgetNode, Json } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { PropField, ColorField } from "../../atoms";
import { DynamicTagInserter } from "../../molecules/DynamicTagInserter";
import {
  ANIMATED_MODES,
  ANIMATED_SHAPES,
  AnimatedHeadingRender,
  type AnimatedHeadingConfig,
  type AnimatedHeadingMode,
  type AnimatedHeadingShape,
} from "@/lib/builder/animatedHeadingVariants";
import { LinkPicker } from "../../molecules/LinkPicker";
import {
  toAnimatedHeadingLink,
  toWidgetLink,
  type AnimatedHeadingLinkKey,
} from "@/lib/builder/animatedHeadingLinks";
import { resolveDynamicText, resolveDynamicList } from "@/lib/builder/dynamicText";
import { useBuilderLabel } from "@/lib/builder/labelsEn";
import { PLACEHOLDER_POST_CTX } from "@/lib/builder/currentPostContext";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-builder";

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}

export function AnimatedHeadingEditor({ c, lang, setContent }: Props) {
  const { t } = useTranslation();
  const bl = useBuilderLabel();
  const mode = (typeof c.mode === "string" ? c.mode : "highlight") as AnimatedHeadingMode;
  const shape = (typeof c.shape === "string" ? c.shape : "underline") as AnimatedHeadingShape;
  const tag = (typeof c.tag === "string" ? c.tag : "h2") as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

  const visibleShapes =
    mode === "hover-underline"
      ? ANIMATED_SHAPES.filter((s) => s.value.startsWith("hover-line-"))
      : mode === "hover-allsides"
        ? ANIMATED_SHAPES.filter((s) => s.value.startsWith("hover-allsides-"))
        : ANIMATED_SHAPES.filter(
            (s) => !s.value.startsWith("hover-line-") && !s.value.startsWith("hover-allsides-"),
          );

  const handleModeChange = (v: string) => {
    setContent("mode", v);
    if (v === "hover-underline" && !shape.startsWith("hover-line-")) {
      setContent("shape", "hover-line-1");
    } else if (v === "hover-allsides" && !shape.startsWith("hover-allsides-")) {
      setContent("shape", "hover-allsides-1");
    } else if (
      v !== "hover-underline" &&
      v !== "hover-allsides" &&
      (shape.startsWith("hover-line-") || shape.startsWith("hover-allsides-"))
    ) {
      setContent("shape", "underline");
    }
  };
  const align = (typeof c.align === "string" ? c.align : "left") as "left" | "center" | "right";

  const textBefore = (c[`textBefore_${lang}`] as string) || "";
  const textAfter = (c[`textAfter_${lang}`] as string) || "";
  const highlight = (c[`highlight_${lang}`] as string) || "";
  const rotateRaw = c[`rotateWords_${lang}`];
  const rotateWords: string[] = Array.isArray(rotateRaw)
    ? rotateRaw.filter((x): x is string => typeof x === "string")
    : [];

  const color = (typeof c.color === "string" ? c.color : "") || "";
  const accentColor = (typeof c.accentColor === "string" ? c.accentColor : "") || "#f97316";
  const durationMs = typeof c.durationMs === "number" ? c.durationMs : 1600;
  const delayMs = typeof c.delayMs === "number" ? c.delayMs : 200;
  const loop = c.loop !== false;

  const setWords = (txt: string) => {
    const arr = txt
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    setContent(`rotateWords_${lang}`, toJson(arr));
  };

  const appendToken = (field: string, current: string, token: string) => {
    const sep = current.length === 0 || current.endsWith(" ") ? "" : " ";
    setContent(field, `${current}${sep}${token}`);
  };
  const appendRotateToken = (token: string) => {
    setContent(`rotateWords_${lang}`, toJson([...rotateWords, token]));
  };

  // Live preview resolves dynamic tokens against the placeholder post ctx so
  // the author sees realistic values (title, author name, date, …) instead
  // of the raw `{post.title}` string.
  const previewCfg: AnimatedHeadingConfig = {
    mode,
    shape,
    tag,
    align,
    textBefore: resolveDynamicText(textBefore, PLACEHOLDER_POST_CTX, lang),
    textAfter: resolveDynamicText(textAfter, PLACEHOLDER_POST_CTX, lang),
    highlight: resolveDynamicText(highlight, PLACEHOLDER_POST_CTX, lang),
    rotateWords: resolveDynamicList(rotateWords, PLACEHOLDER_POST_CTX, lang),
    linkBefore: toAnimatedHeadingLink(c.linkBefore),
    linkHighlight: toAnimatedHeadingLink(c.linkHighlight),
    linkAfter: toAnimatedHeadingLink(c.linkAfter),
    color: color || undefined,
    accentColor,
    durationMs,
    delayMs,
    loop,
  };

  const accentPresets = [
    "#f97316",
    "#ef4444",
    "#eab308",
    "#22c55e",
    "#3b82f6",
    "#a855f7",
    "#ec4899",
    "#0ea5e9",
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <PropField label={t("builder.animatedHeadingEditor.mode")}>
          <Select value={mode} onValueChange={handleModeChange}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ANIMATED_MODES.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {bl(m.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PropField>
        <PropField label={t("builder.animatedHeadingEditor.htmlTag")}>
          <Select value={tag} onValueChange={(v) => setContent("tag", v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["h1", "h2", "h3", "h4", "h5", "h6"].map((t) => (
                <SelectItem key={t} value={t}>
                  {t.toUpperCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PropField>
      </div>

      <div className="space-y-1.5">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {t("builder.animatedHeadingEditor.shape")}
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
                title={bl(s.label)}
              >
                <div className="pointer-events-none flex items-center justify-center h-[44px]">
                  <div
                    style={{ transform: "scale(0.42)", transformOrigin: "center", lineHeight: 1 }}
                  >
                    <AnimatedHeadingRender
                      config={{
                        mode: "highlight",
                        shape: s.value,
                        tag: "h6",
                        highlight: "Abc",
                        accentColor: accentColor || "var(--foreground)",
                        durationMs: 1200,
                        loop: false,
                      }}
                      preview
                    />
                  </div>
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground truncate">{bl(s.label)}</div>
                {isActive && <span className="absolute top-1 right-1 text-brand text-xs">✓</span>}
              </button>
            );
          })}
        </div>
      </div>

      <section className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="inline-block h-4 w-1 rounded bg-muted-foreground/50" />
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("builder.animatedHeadingEditor.staticText")}
          </h4>
        </div>
        <PropField label={t("builder.animatedHeadingEditor.before", { lang: lang.toUpperCase() })}>
          <div className="flex items-center gap-1.5">
            <Input
              value={textBefore}
              onChange={(e) => setContent(`textBefore_${lang}`, e.target.value)}
              placeholder={t("builder.animatedHeadingEditor.beforePh")}
              className="h-8 text-xs"
            />
            <DynamicTagInserter
              onInsert={(tok) => appendToken(`textBefore_${lang}`, textBefore, tok)}
            />
          </div>
        </PropField>
        <PropField label={t("builder.animatedHeadingEditor.after", { lang: lang.toUpperCase() })}>
          <div className="flex items-center gap-1.5">
            <Input
              value={textAfter}
              onChange={(e) => setContent(`textAfter_${lang}`, e.target.value)}
              placeholder={t("builder.animatedHeadingEditor.afterPh")}
              className="h-8 text-xs"
            />
            <DynamicTagInserter
              onInsert={(tok) => appendToken(`textAfter_${lang}`, textAfter, tok)}
            />
          </div>
        </PropField>
        <PropField label={t("builder.animatedHeadingEditor.staticColor")}>
          <ColorField
            value={color}
            onChange={(v) => setContent("color", v ?? "")}
            placeholder={t("builder.animatedHeadingEditor.defaultPh")}
          />
        </PropField>
      </section>

      <section className="rounded-md border border-border bg-muted/20 p-3 space-y-3">
        <div className="flex items-center gap-2">
          <span className="inline-block h-4 w-1 rounded bg-muted-foreground/50" />
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("builder.animatedHeadingEditor.links")}
          </h4>
        </div>
        <p className="text-[10px] text-muted-foreground">
          {t("builder.animatedHeadingEditor.linksHint")}
        </p>
        {(
          [
            ["linkBefore", t("builder.animatedHeadingEditor.linkBefore")],
            ["linkHighlight", t("builder.animatedHeadingEditor.linkHighlight")],
            ["linkAfter", t("builder.animatedHeadingEditor.linkAfter")],
          ] as ReadonlyArray<[AnimatedHeadingLinkKey, string]>
        ).map(([key, label]) => (
          <div key={key} className="space-y-1.5">
            <div className="text-[11px] font-medium text-foreground">{label}</div>
            <LinkPicker
              value={toWidgetLink(c[key])}
              lang={lang}
              onChange={(link) => setContent(key, link ? toJson(link) : null)}
            />
          </div>
        ))}
      </section>

      <section className="rounded-md border border-brand/40 bg-brand/5 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="inline-block h-4 w-1 rounded bg-brand" />
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-brand">
            {mode === "rotate"
              ? t("builder.animatedHeadingEditor.rotateWords", { lang: lang.toUpperCase() })
              : t("builder.animatedHeadingEditor.animatedText")}
          </h4>
        </div>

        {mode === "rotate" ? (
          <PropField
            label={t("builder.animatedHeadingEditor.rotateWords", { lang: lang.toUpperCase() })}
          >
            <div className="flex items-start gap-1.5">
              <Textarea
                rows={4}
                value={rotateWords.join("\n")}
                onChange={(e) => setWords(e.target.value)}
                placeholder={t("builder.animatedHeadingEditor.rotatePh")}
                className="text-xs font-mono"
              />
              <DynamicTagInserter onInsert={appendRotateToken} />
            </div>
          </PropField>
        ) : (
          <PropField
            label={t("builder.animatedHeadingEditor.highlight", { lang: lang.toUpperCase() })}
          >
            <div className="flex items-center gap-1.5">
              <Input
                value={highlight}
                onChange={(e) => setContent(`highlight_${lang}`, e.target.value)}
                placeholder={t("builder.animatedHeadingEditor.highlightPh")}
                className="h-8 text-xs"
              />
              <DynamicTagInserter
                onInsert={(tok) => appendToken(`highlight_${lang}`, highlight, tok)}
              />
            </div>
          </PropField>
        )}

        <PropField label={t("builder.animatedHeadingEditor.animatedColor")}>
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
          {(mode === "hover-underline" || mode === "hover-allsides") && (
            <PropField label={t("builder.animatedHeadingEditor.duration")}>
              <Input
                type="number"
                min={100}
                max={3000}
                step={50}
                value={durationMs}
                onChange={(e) => setContent("durationMs", Number(e.target.value) || 300)}
                className="h-8 text-xs"
              />
            </PropField>
          )}
          {(mode === "highlight" || mode === "rotate") && (
            <>
              <PropField label={t("builder.animatedHeadingEditor.duration")}>
                <Input
                  type="number"
                  min={300}
                  max={10000}
                  step={100}
                  value={durationMs}
                  onChange={(e) => setContent("durationMs", Number(e.target.value) || 1600)}
                  className="h-8 text-xs"
                />
              </PropField>
              <PropField label={t("builder.animatedHeadingEditor.delay")}>
                <Input
                  type="number"
                  min={0}
                  max={10000}
                  step={100}
                  value={delayMs}
                  onChange={(e) => setContent("delayMs", Number(e.target.value) || 0)}
                  className="h-8 text-xs"
                />
              </PropField>
              <PropField label={t("builder.animatedHeadingEditor.loopLabel")}>
                <Select
                  value={loop ? "on" : "off"}
                  onValueChange={(v) => setContent("loop", v === "on")}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="on">{t("builder.animatedHeadingEditor.yes")}</SelectItem>
                    <SelectItem value="off">{t("builder.animatedHeadingEditor.no")}</SelectItem>
                  </SelectContent>
                </Select>
              </PropField>
            </>
          )}
          <PropField label={t("builder.animatedHeadingEditor.align")}>
            <Select value={align} onValueChange={(v) => setContent("align", v)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="left">{t("builder.animatedHeadingEditor.alignLeft")}</SelectItem>
                <SelectItem value="center">
                  {t("builder.animatedHeadingEditor.alignCenter")}
                </SelectItem>
                <SelectItem value="right">
                  {t("builder.animatedHeadingEditor.alignRight")}
                </SelectItem>
              </SelectContent>
            </Select>
          </PropField>
        </div>
      </section>

      <div className="space-y-1.5">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {t("builder.animatedHeadingEditor.livePreview")}
        </div>
        <div className="rounded-md border border-border p-4 bg-background">
          <AnimatedHeadingRender config={previewCfg} />
        </div>
      </div>
    </div>
  );
}
