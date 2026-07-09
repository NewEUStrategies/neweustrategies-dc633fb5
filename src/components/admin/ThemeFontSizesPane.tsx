// Global font-size settings pane. Left: form with body/small/lead/blockquote/code
// + H1-H6 (desktop + mobile + line-height + letter-spacing + weight + transform).
// Right: live preview reflecting the draft values before save.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Save, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NumberInput } from "@/components/admin/builder/ui/atoms";
import {
  useFontSizes,
  useSaveFontSizes,
  FONT_SIZES_DEFAULTS,
  HEADING_LEVELS,
  fontSizesToCss,
  type FontSizesSettings,
  type HeadingLevel,
} from "@/lib/theme/fontSizes";

type TextTransform = FontSizesSettings["headings"]["h1"]["transform"];

const TRANSFORM_OPTIONS: readonly TextTransform[] = [
  "none",
  "uppercase",
  "lowercase",
  "capitalize",
] as const;

export function ThemeFontSizesPane() {
  const { t, i18n } = useTranslation();
  const isPL = (i18n.language ?? "pl").startsWith("pl");
  const { data } = useFontSizes();
  const save = useSaveFontSizes();
  const [draft, setDraft] = useState<FontSizesSettings>(data ?? FONT_SIZES_DEFAULTS);

  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  // Live preview: emit the draft tokens at :root scope so the whole app
  // (this pane's preview card, block editor canvas, any open article) reflects
  // typography changes instantly, without saving or reloading. This <style>
  // renders after <ThemeFontSizesStyle /> in the DOM, so same-specificity
  // cascade wins and takes precedence until the pane unmounts or the draft
  // is saved.
  const previewCss = useMemo(() => fontSizesToCss(draft), [draft]);

  const setHeading = <K extends keyof FontSizesSettings["headings"]["h1"]>(
    level: HeadingLevel,
    key: K,
    value: FontSizesSettings["headings"]["h1"][K],
  ) => {
    setDraft((d) => ({
      ...d,
      headings: { ...d.headings, [level]: { ...d.headings[level], [key]: value } },
    }));
  };

  const setBase = <
    S extends "body" | "small" | "lead" | "blockquote" | "code",
    K extends keyof FontSizesSettings[S],
  >(
    section: S,
    key: K,
    value: FontSizesSettings[S][K],
  ) => {
    setDraft((d) => ({ ...d, [section]: { ...d[section], [key]: value } }));
  };

  return (
    <div className="space-y-6">
      <style dangerouslySetInnerHTML={{ __html: previewCss }} />

      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:flex-wrap sm:justify-between">
        <div className="min-w-0">
          <h3 className="font-display text-lg truncate">
            {t("themeOptions.sections.fontSizes", { defaultValue: isPL ? "Rozmiary czcionek" : "Font sizes" })}
          </h3>
          <p className="text-xs text-muted-foreground">
            {isPL
              ? "Globalne rozmiary typografii dla H1-H6, body, small, lead, blockquote, code."
              : "Global typography sizes for H1-H6, body, small, lead, blockquote, code."}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDraft(FONT_SIZES_DEFAULTS)}
            disabled={save.isPending}
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            {isPL ? "Reset" : "Reset"}
          </Button>
          <Button size="sm" onClick={() => save.mutate(draft)} disabled={save.isPending}>
            <Save className="w-4 h-4 mr-2" />
            {save.isPending ? (isPL ? "Zapisywanie..." : "Saving...") : isPL ? "Zapisz" : "Save"}
          </Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* FORM */}
        <div className="space-y-6">
          <section className="rounded-lg border border-border p-4 space-y-4">
            <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {isPL ? "Nagłówki H1-H6" : "Headings H1-H6"}
            </h4>
            <div className="space-y-4">
              {HEADING_LEVELS.map((level) => (
                <div key={level} className="rounded-md border border-border/60 bg-muted/20 p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-semibold uppercase">{level}</span>
                    <span
                      className="text-muted-foreground truncate max-w-[65%]"
                      style={{
                        fontSize: `${draft.headings[level].desktop}px`,
                        lineHeight: draft.headings[level].lineHeight,
                        letterSpacing: `${draft.headings[level].letterSpacing}px`,
                        fontWeight: draft.headings[level].weight,
                        textTransform: draft.headings[level].transform,
                      }}
                    >
                      Aa
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <NumField
                      label={isPL ? "Desktop" : "Desktop"}
                      value={draft.headings[level].desktop}
                      min={10}
                      max={120}
                      suffix="px"
                      onChange={(v) => setHeading(level, "desktop", v)}
                    />
                    <NumField
                      label={isPL ? "Mobile" : "Mobile"}
                      value={draft.headings[level].mobile}
                      min={10}
                      max={96}
                      suffix="px"
                      onChange={(v) => setHeading(level, "mobile", v)}
                    />
                    <NumField
                      label={isPL ? "Interlinia" : "Line-height"}
                      value={draft.headings[level].lineHeight}
                      min={0.8}
                      max={2.5}
                      step={0.05}
                      onChange={(v) => setHeading(level, "lineHeight", v)}
                    />
                    <NumField
                      label={isPL ? "Odst. znaków" : "Letter-spacing"}
                      value={draft.headings[level].letterSpacing}
                      min={-4}
                      max={20}
                      step={0.25}
                      suffix="px"
                      onChange={(v) => setHeading(level, "letterSpacing", v)}
                    />
                    <NumField
                      label={isPL ? "Grubość" : "Weight"}
                      value={draft.headings[level].weight}
                      min={100}
                      max={900}
                      step={100}
                      onChange={(v) => setHeading(level, "weight", v)}
                    />
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">
                        {isPL ? "Wielkość liter" : "Text transform"}
                      </Label>
                      <Select
                        value={draft.headings[level].transform}
                        onValueChange={(v) =>
                          setHeading(level, "transform", v as TextTransform)
                        }
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TRANSFORM_OPTIONS.map((opt) => (
                            <SelectItem key={opt} value={opt}>
                              {opt}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-border p-4 space-y-4">
            <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {isPL ? "Typografia bazowa" : "Base typography"}
            </h4>
            <div className="grid gap-3 sm:grid-cols-2">
              <BasePair
                label="Body"
                size={draft.body.size}
                lh={draft.body.lineHeight}
                onSize={(v) => setBase("body", "size", v)}
                onLh={(v) => setBase("body", "lineHeight", v)}
              />
              <BasePair
                label={isPL ? "Small / caption" : "Small / caption"}
                size={draft.small.size}
                lh={draft.small.lineHeight}
                onSize={(v) => setBase("small", "size", v)}
                onLh={(v) => setBase("small", "lineHeight", v)}
              />
              <BasePair
                label={isPL ? "Lead (wstęp)" : "Lead (intro)"}
                size={draft.lead.size}
                lh={draft.lead.lineHeight}
                onSize={(v) => setBase("lead", "size", v)}
                onLh={(v) => setBase("lead", "lineHeight", v)}
              />
              <BasePair
                label="Blockquote"
                size={draft.blockquote.size}
                lh={draft.blockquote.lineHeight}
                onSize={(v) => setBase("blockquote", "size", v)}
                onLh={(v) => setBase("blockquote", "lineHeight", v)}
              />
              <NumField
                label={isPL ? "Code (inline)" : "Code (inline)"}
                value={draft.code.size}
                min={10}
                max={22}
                suffix="px"
                onChange={(v) => setBase("code", "size", v)}
              />
              <NumField
                label={isPL ? "Breakpoint mobilny" : "Mobile breakpoint"}
                value={draft.mobileBreakpoint}
                min={360}
                max={1024}
                suffix="px"
                onChange={(v) => setDraft((d) => ({ ...d, mobileBreakpoint: v }))}
              />
            </div>
          </section>
        </div>

        {/* PREVIEW */}
        <div className="lg:sticky lg:top-4 h-fit">
          <div className="rounded-lg border border-border p-6 bg-background">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3">
              {isPL ? "Podgląd" : "Preview"}
            </div>
            <PreviewSample />
          </div>
        </div>
      </div>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <div className="space-y-1 min-w-0">
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <NumberInput
        value={value}
        min={min}
        max={max}
        step={step}
        suffix={suffix}
        onChange={(v) => onChange(typeof v === "number" ? v : (min ?? 0))}
      />
    </div>
  );
}

function BasePair({
  label,
  size,
  lh,
  onSize,
  onLh,
}: {
  label: string;
  size: number;
  lh: number;
  onSize: (v: number) => void;
  onLh: (v: number) => void;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-2">
      <div className="text-xs font-semibold">{label}</div>
      <div className="grid grid-cols-2 gap-2">
        <NumField label="Size" value={size} min={8} max={40} suffix="px" onChange={onSize} />
        <NumField label="Line-height" value={lh} min={1} max={2.4} step={0.05} onChange={onLh} />
      </div>
    </div>
  );
}

function PreviewSample() {
  return (
    <div className="space-y-3">
      <h1 style={{ fontSize: "var(--fs-h1)", lineHeight: "var(--lh-h1)", letterSpacing: "var(--ls-h1)", fontWeight: "var(--fw-h1)", textTransform: "var(--tt-h1)" as never }}>Nagłówek H1</h1>
      <h2 style={{ fontSize: "var(--fs-h2)", lineHeight: "var(--lh-h2)", letterSpacing: "var(--ls-h2)", fontWeight: "var(--fw-h2)", textTransform: "var(--tt-h2)" as never }}>Nagłówek H2</h2>
      <h3 style={{ fontSize: "var(--fs-h3)", lineHeight: "var(--lh-h3)", letterSpacing: "var(--ls-h3)", fontWeight: "var(--fw-h3)", textTransform: "var(--tt-h3)" as never }}>Nagłówek H3</h3>
      <h4 style={{ fontSize: "var(--fs-h4)", lineHeight: "var(--lh-h4)", letterSpacing: "var(--ls-h4)", fontWeight: "var(--fw-h4)", textTransform: "var(--tt-h4)" as never }}>Nagłówek H4</h4>
      <h5 style={{ fontSize: "var(--fs-h5)", lineHeight: "var(--lh-h5)", letterSpacing: "var(--ls-h5)", fontWeight: "var(--fw-h5)", textTransform: "var(--tt-h5)" as never }}>Nagłówek H5</h5>
      <h6 style={{ fontSize: "var(--fs-h6)", lineHeight: "var(--lh-h6)", letterSpacing: "var(--ls-h6)", fontWeight: "var(--fw-h6)", textTransform: "var(--tt-h6)" as never }}>Nagłówek H6</h6>
      <p style={{ fontSize: "var(--fs-body)", lineHeight: "var(--lh-body)" }}>
        Lorem ipsum dolor sit amet, consectetur adipiscing elit. Fusce faucibus est nec justo tincidunt, ac aliquam
        risus tincidunt.
      </p>
      <p style={{ fontSize: "var(--fs-lead)", lineHeight: "var(--lh-lead)" }} className="text-muted-foreground">
        Wprowadzenie / lead - większa czcionka, świetna do pierwszego akapitu artykułu.
      </p>
      <blockquote
        className="border-l-4 border-primary/60 pl-4 italic text-muted-foreground"
        style={{ fontSize: "var(--fs-blockquote)", lineHeight: "var(--lh-blockquote)" }}
      >
        Blockquote - cytat wyróżniony z tekstu.
      </blockquote>
      <p style={{ fontSize: "var(--fs-small)", lineHeight: "var(--lh-small)" }} className="text-muted-foreground">
        Small / caption - drobny tekst pomocniczy. <code style={{ fontSize: "var(--fs-code)" }}>inline code</code>
      </p>
    </div>
  );
}

/** Extract properties inside `:root{...}` (before any @media block). */
function extractRootBody(css: string): string {
  const match = css.match(/:root\{([^}]*)\}/);
  return match?.[1] ?? "";
}
