// WidgetPreview - wizualny render pojedynczego widgetu na kanwie buildera.
// Uzywane rowniez w DragOverlay. HTML uzytkownika sanityzowany przez
// `sanitizeHtml`; input fieldy renderowane jako read-only.
import { useEffect, useRef, useState } from "react";
import type { NlWidget, NlLang, NlImageWidget } from "@/lib/newsletter-builder/types";
import { sanitizeHtml } from "@/lib/sanitize";

const ASPECT_RATIO: Record<NonNullable<NlImageWidget["aspect"]>, number | null> = {
  "16/7": 16 / 7,
  "16/9": 16 / 9,
  "1/1": 1,
  "4/3": 4 / 3,
  auto: null,
};

/**
 * Placeholder obrazka - mierzy realna szerokosc kolumny w buildera przez
 * ResizeObserver i pokazuje rekomendowany rozmiar zrodlowy (1x i 2x retina)
 * dopasowany do proporcji `aspect` widgetu. Dzieki temu redaktor wie od razu
 * jaka grafike wgrac, niezaleznie od layoutu sekcji (single/1-1/1-2/2-1) i
 * biezacego viewportu (desktop/tablet/mobile).
 */
function ImagePlaceholder({ widget, lang }: { widget: NlImageWidget; lang: NlLang }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const ratio = ASPECT_RATIO[widget.aspect ?? "16/9"] ?? 16 / 9;
  const w1x = Math.max(1, Math.round(width));
  const h1x = Math.max(1, Math.round(width / ratio));
  const w2x = w1x * 2;
  const h2x = h1x * 2;
  return (
    <div
      ref={ref}
      className={
        "w-full flex flex-col items-center justify-center gap-1 border border-dashed border-border/60 text-xs text-muted-foreground " +
        (widget.rounded ? "rounded-lg " : "") +
        (widget.aspect && widget.aspect !== "auto" ? "" : "aspect-video")
      }
      style={{
        aspectRatio:
          widget.aspect && widget.aspect !== "auto" ? widget.aspect.replace("/", " / ") : undefined,
      }}
    >
      <span className="font-medium">{lang === "pl" ? "Brak obrazu" : "No image"}</span>
      {width > 0 && (
        <span className="text-[10px] tracking-wide opacity-80 text-center leading-tight px-2">
          {lang === "pl" ? "Rekomendowany rozmiar" : "Recommended size"}
          <br />
          <span className="font-mono">
            {w1x}x{h1x}px
          </span>
          <span className="opacity-60"> - </span>
          <span className="font-mono">
            {w2x}x{h2x}px
          </span>
          <span className="opacity-60"> (2x)</span>
        </span>
      )}
    </div>
  );
}

export function WidgetPreview({ widget, lang }: { widget: NlWidget | null; lang: NlLang }) {
  if (!widget) return null;
  const pick = (v: { pl: string; en: string }) => (lang === "pl" ? v.pl : v.en);

  switch (widget.type) {
    case "heading": {
      const H = (`h${widget.level}` as unknown) as keyof React.JSX.IntrinsicElements;
      return (
        <H
          className={
            "font-display leading-tight " +
            (widget.level === 1
              ? "text-3xl"
              : widget.level === 2
                ? "text-2xl"
                : widget.level === 3
                  ? "text-xl"
                  : "text-lg")
          }
          style={{ textAlign: widget.align ?? "left", color: widget.color ?? undefined }}
        >
          {pick(widget.text) || "-"}
        </H>
      );
    }
    case "paragraph":
      return (
        <p
          className={
            "leading-relaxed [&_a]:underline " +
            (widget.size === "sm" ? "text-xs" : widget.size === "lg" ? "text-base" : "text-sm")
          }
          style={{ color: widget.color ?? undefined }}
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(pick(widget.html)) }}
        />
      );
    case "image":
      return widget.url ? (
        <img
          src={widget.url}
          alt={widget.alt ?? ""}
          className={"w-full object-cover " + (widget.rounded ? "rounded-lg" : "")}
          style={{ aspectRatio: widget.aspect === "auto" ? undefined : widget.aspect?.replace("/", " / ") }}
        />
      ) : (
        <ImagePlaceholder widget={widget} lang={lang} />
      );
    case "divider":
      return (
        <hr
          style={{
            borderTopWidth: `${widget.thickness ?? 1}px`,
            borderColor: widget.color ?? "currentColor",
            opacity: 0.4,
          }}
        />
      );
    case "spacer":
      return <div aria-hidden="true" style={{ height: `${widget.size}px` }} />;
    case "field.email":
      return (
        <label className="block space-y-1">
          <span className="text-xs font-semibold">
            {pick(widget.label)}
            <span className="text-destructive ml-0.5">*</span>
          </span>
          <input
            type="email"
            readOnly
            placeholder={pick(widget.placeholder)}
            className="w-full px-3 py-2 rounded border border-input bg-background/60 text-sm"
          />
        </label>
      );
    case "field.text":
      return (
        <label className="block space-y-1">
          <span className="text-xs font-semibold">
            {pick(widget.label)}
            {widget.required && <span className="text-destructive ml-0.5">*</span>}
          </span>
          <input
            type="text"
            readOnly
            placeholder={pick(widget.placeholder)}
            className="w-full px-3 py-2 rounded border border-input bg-background/60 text-sm"
          />
        </label>
      );
    case "field.checkbox":
      return (
        <label className="flex items-start gap-2 text-xs opacity-95">
          <input type="checkbox" className="mt-0.5" readOnly />
          <span
            className="[&_a]:underline"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(pick(widget.html)) }}
          />
        </label>
      );
    case "submit":
      return (
        <button
          type="button"
          className={
            "px-4 py-2 rounded text-sm font-medium " + (widget.fullWidth ? "w-full" : "")
          }
          style={{
            backgroundColor: widget.bg ?? "var(--primary)",
            color: widget.fg ?? "var(--primary-foreground)",
          }}
        >
          {pick(widget.label)}
        </button>
      );
    case "success-message":
      return (
        <div className="text-xs font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded p-2 border border-emerald-500/20">
          {pick(widget.text)}
        </div>
      );
    case "field.select":
      return (
        <label className="block space-y-1">
          <span className="text-xs font-semibold">
            {pick(widget.label)}
            {widget.required && <span className="text-destructive ml-0.5">*</span>}
          </span>
          <select disabled className="w-full px-3 py-2 rounded border border-input bg-background/60 text-sm">
            <option>{pick(widget.placeholder)}</option>
            {widget.options.map((o) => (
              <option key={o.value}>{lang === "pl" ? o.labelPl : o.labelEn}</option>
            ))}
          </select>
        </label>
      );
    case "field.mailing-lists":
      return (
        <div className="space-y-1">
          <div className="text-xs font-semibold">
            {pick(widget.label)}
            {widget.required && <span className="text-destructive ml-0.5">*</span>}
          </div>
          <div className="text-[11px] text-muted-foreground border border-dashed border-border/60 rounded p-2">
            {lang === "pl" ? "Listy z ustawien newslettera" : "Lists from newsletter settings"}
            {widget.display === "select" ? " (dropdown)" : " (checkboxes)"}
          </div>
        </div>
      );
    case "social-proof":
      return (
        <div
          className="text-xs font-medium text-muted-foreground"
          style={{ textAlign: widget.align ?? "center" }}
        >
          {pick(widget.text).replace("{count}", String(widget.fallbackCount ?? 0))}
        </div>
      );
    case "countdown": {
      const diff = Math.max(0, new Date(widget.deadline).getTime() - Date.now());
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      const cell = (n: number, l: string) => (
        <div className="text-center px-2 py-1 rounded" style={{ backgroundColor: widget.accent ?? "var(--muted)" }}>
          <div className="text-lg font-bold leading-none">{String(n).padStart(2, "0")}</div>
          <div className="text-[9px] uppercase tracking-wider opacity-80">{l}</div>
        </div>
      );
      return (
        <div className="grid grid-cols-4 gap-2">
          {cell(d, pick(widget.labelDays))}
          {cell(h, pick(widget.labelHours))}
          {cell(m, pick(widget.labelMinutes))}
          {cell(s, pick(widget.labelSeconds))}
        </div>
      );
    }
    case "cta-button": {
      const wrapAlign =
        widget.align === "left" ? "justify-start" : widget.align === "right" ? "justify-end" : "justify-center";
      return (
        <div className={"flex " + wrapAlign}>
          <span
            className={"inline-flex items-center justify-center px-4 py-2 rounded text-sm font-medium " + (widget.fullWidth ? "w-full" : "")}
            style={{
              backgroundColor: widget.bg ?? "var(--primary)",
              color: widget.fg ?? "var(--primary-foreground)",
            }}
          >
            {pick(widget.label) || "-"}
          </span>
        </div>
      );
    }
    case "coupon":
      return (
        <div
          className={
            "flex items-center justify-between gap-3 px-4 py-3 rounded-lg " +
            (widget.style === "boxed" ? "border-2" : "border-2 border-dashed")
          }
          style={{ borderColor: widget.accent ?? "var(--primary)" }}
        >
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">
              {pick(widget.label)}
            </span>
            <span className="font-mono font-bold text-base tracking-wider truncate">
              {widget.code}
            </span>
          </div>
          <span
            className="text-[10px] px-2 py-1 rounded font-medium shrink-0"
            style={{ backgroundColor: widget.accent ?? "var(--primary)", color: "var(--primary-foreground)" }}
          >
            {lang === "pl" ? "Kopiuj" : "Copy"}
          </span>
        </div>
      );
    case "close-button": {
      const size = widget.size ?? 32;
      const text = widget.variant === "text" ? pick(widget.label ?? { pl: "Zamknij", en: "Close" }) : null;
      const glyph = widget.variant === "icon-chevron" ? "‹" : widget.variant === "icon-x" ? "✕" : text;
      const isCorner = widget.position === "top-right";
      return (
        <div className={isCorner ? "flex justify-end" : "flex justify-center"}>
          <span
            className="inline-flex items-center justify-center rounded-full text-sm font-medium"
            style={{
              width: widget.variant === "text" ? undefined : size,
              height: size,
              paddingInline: widget.variant === "text" ? 12 : 0,
              backgroundColor: widget.bg ?? "rgba(0,0,0,0.06)",
              color: widget.fg ?? "currentColor",
              fontSize: Math.round(size * 0.5),
              lineHeight: 1,
            }}
            aria-label={lang === "pl" ? "Zamknij popup" : "Close popup"}
          >
            {glyph}
          </span>
        </div>
      );
    }
    default:
      return null;
  }
}
