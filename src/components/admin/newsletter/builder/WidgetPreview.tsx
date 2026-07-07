// WidgetPreview - wizualny render pojedynczego widgetu na kanwie buildera.
// Uzywane rowniez w DragOverlay. HTML uzytkownika sanityzowany przez
// `sanitizeHtml`; input fieldy renderowane jako read-only.
import type { NlWidget, NlLang } from "@/lib/newsletter-builder/types";
import { sanitizeHtml } from "@/lib/sanitize";

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
        <div className="w-full aspect-video rounded-lg border border-dashed border-border/60 flex items-center justify-center text-xs text-muted-foreground">
          {lang === "pl" ? "Brak obrazu" : "No image"}
        </div>
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
    default:
      return null;
  }
}
