// Global font-size settings pane. Left: form with body/small/lead/blockquote/code
// + H1-H6 (desktop + mobile + line-height + letter-spacing + weight + transform).
// Right: live preview reflecting the draft values before save.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Save, RotateCcw, SearchCheck, Wand2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  applyTypographyToPublished,
  type ApplyTypographyResult,
} from "@/lib/theme/typographyApply.functions";
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
import { usePostLayoutSettings, useSavePostLayoutSettings } from "@/hooks/usePostLayoutSettings";

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

  // Odstęp między akapitami żyje w post_layout_settings (jedno źródło prawdy
  // współdzielone z /admin/content-area), więc edytujemy tę samą kolumnę
  // zamiast duplikować wartość w font_sizes.
  const layout = usePostLayoutSettings();
  const saveLayout = useSavePostLayoutSettings();
  const [paragraphSpacing, setParagraphSpacing] = useState<number>(1.5);
  useEffect(() => {
    if (layout.data) setParagraphSpacing(layout.data.paragraph_spacing_rem || 1.5);
  }, [layout.data]);

  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  // Live preview: emit the draft tokens at :root scope so the whole app
  // (this pane's preview card, block editor canvas, any open article) reflects
  // typography changes instantly, without saving or reloading. This <style>
  // renders after <ThemeFontSizesStyle /> in the DOM, so same-specificity
  // cascade wins and takes precedence until the pane unmounts or the draft
  // is saved.
  const previewCss = useMemo(
    () =>
      `${fontSizesToCss(draft)}\n.post-content.post-content p,.blocks-content.blocks-content p,.single-post-content.single-post-content p{margin-bottom:${paragraphSpacing}rem;}[data-builder-renderer]{--cms-paragraph-spacing:${paragraphSpacing}rem;}`,
    [draft, paragraphSpacing],
  );

  const persist = () => {
    save.mutate(draft);
    if (paragraphSpacing !== (layout.data?.paragraph_spacing_rem ?? 1.5)) {
      saveLayout.mutate({ paragraph_spacing_rem: paragraphSpacing });
    }
  };

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

  const setSpacing = (key: keyof FontSizesSettings["spacing"], value: number) => {
    setDraft((d) => ({ ...d, spacing: { ...d.spacing, [key]: value } }));
  };

  return (
    <div className="space-y-6">
      <style dangerouslySetInnerHTML={{ __html: previewCss }} />

      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:flex-wrap sm:justify-between">
        <div className="min-w-0">
          <h3 className="font-display text-lg truncate">{t("themeOptions.sections.fontSizes")}</h3>
          <p className="text-xs text-muted-foreground">
            {isPL
              ? "Globalne rozmiary typografii (H1-H6, body, small, lead, blockquote, code) oraz odstępy treści - wspólne dla frontu i CMS buildera."
              : "Global typography sizes (H1-H6, body, small, lead, blockquote, code) and content spacing - shared by the front end and the CMS builder."}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setDraft(FONT_SIZES_DEFAULTS);
              setParagraphSpacing(1.5);
            }}
            disabled={save.isPending}
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            {isPL ? "Reset" : "Reset"}
          </Button>
          <Button size="sm" onClick={persist} disabled={save.isPending || saveLayout.isPending}>
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
                        onValueChange={(v) => setHeading(level, "transform", v as TextTransform)}
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

          <section className="rounded-lg border border-border p-4 space-y-4">
            <div>
              <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {isPL ? "Odstępy treści" : "Content spacing"}
              </h4>
              <p className="mt-1 text-xs text-muted-foreground">
                {isPL
                  ? "Rytm pionowy wpisu. Te same wartości obowiązują w Gutenberg builderze - Enter tworzy nowy akapit z identycznym odstępem jak na froncie."
                  : "Vertical rhythm of an article. The same values apply in the Gutenberg builder - Enter creates a paragraph with the exact front-end spacing."}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <NumField
                label={isPL ? "Między akapitami" : "Between paragraphs"}
                value={paragraphSpacing}
                min={0.5}
                max={3}
                step={0.05}
                suffix="rem"
                onChange={setParagraphSpacing}
              />
              <NumField
                label={isPL ? "Nad nagłówkiem" : "Above heading"}
                value={draft.spacing.headingTopRem}
                min={0}
                max={6}
                step={0.05}
                suffix="rem"
                onChange={(v) => setSpacing("headingTopRem", v)}
              />
              <NumField
                label={isPL ? "Pod nagłówkiem" : "Below heading"}
                value={draft.spacing.headingBottomRem}
                min={0}
                max={6}
                step={0.05}
                suffix="rem"
                onChange={(v) => setSpacing("headingBottomRem", v)}
              />
              <NumField
                label={isPL ? "Listy" : "Lists"}
                value={draft.spacing.listRem}
                min={0}
                max={6}
                step={0.05}
                suffix="rem"
                onChange={(v) => setSpacing("listRem", v)}
              />
              <NumField
                label={isPL ? "Cytaty" : "Blockquotes"}
                value={draft.spacing.blockquoteRem}
                min={0}
                max={6}
                step={0.05}
                suffix="rem"
                onChange={(v) => setSpacing("blockquoteRem", v)}
              />
            </div>
          </section>

          <ApplyToPublishedSection isPL={isPL} />
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
      <h1
        style={{
          fontSize: "var(--fs-h1)",
          lineHeight: "var(--lh-h1)",
          letterSpacing: "var(--ls-h1)",
          fontWeight: "var(--fw-h1)",
          textTransform: "var(--tt-h1)" as never,
        }}
      >
        Nagłówek H1
      </h1>
      <h2
        style={{
          fontSize: "var(--fs-h2)",
          lineHeight: "var(--lh-h2)",
          letterSpacing: "var(--ls-h2)",
          fontWeight: "var(--fw-h2)",
          textTransform: "var(--tt-h2)" as never,
        }}
      >
        Nagłówek H2
      </h2>
      <h3
        style={{
          fontSize: "var(--fs-h3)",
          lineHeight: "var(--lh-h3)",
          letterSpacing: "var(--ls-h3)",
          fontWeight: "var(--fw-h3)",
          textTransform: "var(--tt-h3)" as never,
        }}
      >
        Nagłówek H3
      </h3>
      <h4
        style={{
          fontSize: "var(--fs-h4)",
          lineHeight: "var(--lh-h4)",
          letterSpacing: "var(--ls-h4)",
          fontWeight: "var(--fw-h4)",
          textTransform: "var(--tt-h4)" as never,
        }}
      >
        Nagłówek H4
      </h4>
      <h5
        style={{
          fontSize: "var(--fs-h5)",
          lineHeight: "var(--lh-h5)",
          letterSpacing: "var(--ls-h5)",
          fontWeight: "var(--fw-h5)",
          textTransform: "var(--tt-h5)" as never,
        }}
      >
        Nagłówek H5
      </h5>
      <h6
        style={{
          fontSize: "var(--fs-h6)",
          lineHeight: "var(--lh-h6)",
          letterSpacing: "var(--ls-h6)",
          fontWeight: "var(--fw-h6)",
          textTransform: "var(--tt-h6)" as never,
        }}
      >
        Nagłówek H6
      </h6>
      <p style={{ fontSize: "var(--fs-body)", lineHeight: "var(--lh-body)" }}>
        Lorem ipsum dolor sit amet, consectetur adipiscing elit. Fusce faucibus est nec justo
        tincidunt, ac aliquam risus tincidunt.
      </p>
      <p
        style={{ fontSize: "var(--fs-lead)", lineHeight: "var(--lh-lead)" }}
        className="text-muted-foreground"
      >
        Wprowadzenie / lead - większa czcionka, świetna do pierwszego akapitu artykułu.
      </p>
      <blockquote
        className="border-l-4 border-primary/60 pl-4 italic text-muted-foreground"
        style={{ fontSize: "var(--fs-blockquote)", lineHeight: "var(--lh-blockquote)" }}
      >
        Blockquote - cytat wyróżniony z tekstu.
      </blockquote>
      <p
        style={{ fontSize: "var(--fs-small)", lineHeight: "var(--lh-small)" }}
        className="text-muted-foreground"
      >
        Small / caption - drobny tekst pomocniczy.{" "}
        <code style={{ fontSize: "var(--fs-code)" }}>inline code</code>
      </p>
    </div>
  );
}

/**
 * Migracja opublikowanych wpisów na globalną typografię. Skan (dry-run) liczy
 * wpisy z zaszytą inline typografią; „Zastosuj” usuwa te nadpisania, żeby
 * front i canvas Gutenberga renderowały ten sam układ.
 */
function ApplyToPublishedSection({ isPL }: { isPL: boolean }) {
  const scan = useServerFn(applyTypographyToPublished);
  const [result, setResult] = useState<ApplyTypographyResult | null>(null);
  const run = useMutation({
    mutationFn: (dryRun: boolean) => scan({ data: { dryRun } }),
    onSuccess: (res) => {
      setResult(res);
      if (res.dryRun) {
        toast.success(
          isPL
            ? `Przeskanowano ${res.scanned} wpisów - do migracji: ${res.affected}`
            : `Scanned ${res.scanned} posts - to migrate: ${res.affected}`,
        );
      } else {
        toast.success(
          isPL ? `Zaktualizowano ${res.updated} wpisów` : `Updated ${res.updated} posts`,
        );
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="rounded-lg border border-border p-4 space-y-4">
      <div>
        <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {isPL ? "Opublikowane wpisy" : "Published posts"}
        </h4>
        <p className="mt-1 text-xs text-muted-foreground">
          {isPL
            ? "Nowe ustawienia działają na wszystkich wpisach automatycznie. Wyjątkiem są treści zaimportowane z zaszytą typografią (inline font-size / line-height) - ta operacja je usuwa, nie zmieniając treści."
            : "New settings apply to every article automatically. The exception is imported content with hard-coded typography (inline font-size / line-height) - this action removes it without touching the copy."}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => run.mutate(true)}
          disabled={run.isPending}
        >
          <SearchCheck className="w-4 h-4 mr-2" />
          {isPL ? "Skanuj wpisy" : "Scan posts"}
        </Button>
        <Button
          size="sm"
          onClick={() => run.mutate(false)}
          disabled={run.isPending || !result || result.affected === 0}
        >
          <Wand2 className="w-4 h-4 mr-2" />
          {isPL ? "Zastosuj typografię" : "Apply typography"}
        </Button>
      </div>
      {result ? (
        <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs">
          <p>
            {isPL
              ? `Przeskanowano: ${result.scanned} · wymaga migracji: ${result.affected} · zaktualizowano: ${result.updated}`
              : `Scanned: ${result.scanned} · needs migration: ${result.affected} · updated: ${result.updated}`}
          </p>
          {result.affected === 0 ? (
            <p className="mt-1 text-muted-foreground">
              {isPL
                ? "Wszystkie opublikowane wpisy dziedziczą już typografię motywu - front i Gutenberg są zsynchronizowane."
                : "Every published article already inherits the theme typography - front end and Gutenberg are in sync."}
            </p>
          ) : (
            <ul className="mt-2 space-y-1 text-muted-foreground">
              {result.posts.map((p) => (
                <li key={p.id} className="truncate">
                  {p.title} <span className="opacity-60">/{p.slug}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
