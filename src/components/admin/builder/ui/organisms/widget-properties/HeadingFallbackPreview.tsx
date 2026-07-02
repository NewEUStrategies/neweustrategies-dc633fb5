// Live preview of the "heading" widget typography in light + dark themes.
//
// Renders exactly the same fallback cascade as WidgetView.tsx for the heading
// widget: an empty weight / size / line-height field falls through to the
// Theme Design tokens (`--td-pt-*` for the title, `--td-pe-*` for the
// subtitle), NEVER to a hardcoded Tailwind class. The preview mirrors that
// so the author sees the real inherited value BEFORE hitting Save.
//
// Contract with WidgetView.tsx (keep in sync):
//   title   → --td-pt-size (15px)  / --td-pt-lh (1.3) / --td-pt-weight (600)
//   subtitle→ --td-pe-size (13px)  / --td-pe-lh (1.5) / --td-pe-weight (400)
import type { CSSProperties } from "react";

interface Props {
  /** Empty → inherit --td-pt-weight. */
  titleWeight: string;
  /** Empty → inherit --td-pe-weight. */
  subtitleWeight: string;
  /** 0 → inherit --td-pt-size / --td-pt-lh. */
  sizePx: number;
  /** 0 → inherit --td-pe-size / --td-pe-lh. */
  subtitleSizePx: number;
  /** Non-empty preset overrides sizePx=0 fallback with a Tailwind class. */
  sizePreset: string;
  /** Sample copy (uses the currently selected editor language). */
  titleSample: string;
  subtitleSample: string;
}

interface RowProps {
  mode: "light" | "dark";
  label: string;
  titleWeight: string;
  subtitleWeight: string;
  titleFontSize: string;
  titleLineHeight: string | number;
  subtitleFontSize: string;
  subtitleLineHeight: string | number;
  titleSample: string;
  subtitleSample: string;
  weightFallbackNote: string;
  lhFallbackNote: string;
}

const Row = ({
  mode,
  label,
  titleWeight,
  subtitleWeight,
  titleFontSize,
  titleLineHeight,
  subtitleFontSize,
  subtitleLineHeight,
  titleSample,
  subtitleSample,
  weightFallbackNote,
  lhFallbackNote,
}: RowProps) => {
  const wrapper: CSSProperties =
    mode === "dark"
      ? { background: "#0f0f11", color: "#f8f6f4", borderColor: "rgba(255,255,255,0.08)" }
      : { background: "#ffffff", color: "#231f20", borderColor: "rgba(0,0,0,0.08)" };
  const titleStyle: CSSProperties = {
    fontSize: titleFontSize,
    lineHeight: titleLineHeight,
    fontWeight: titleWeight as CSSProperties["fontWeight"],
  };
  const subtitleStyle: CSSProperties = {
    fontSize: subtitleFontSize,
    lineHeight: subtitleLineHeight,
    fontWeight: subtitleWeight as CSSProperties["fontWeight"],
    opacity: 0.7,
    marginTop: 4,
  };
  return (
    <div
      className="rounded border p-3 space-y-1"
      style={wrapper}
      aria-label={`Podgląd nagłówka - tryb ${label}`}
    >
      <div className="text-[10px] uppercase tracking-wider opacity-60">{label}</div>
      <div className="font-display" style={titleStyle}>{titleSample}</div>
      <div style={subtitleStyle}>{subtitleSample}</div>
      <div className="text-[10px] opacity-60 pt-1 border-t border-current/10 leading-snug">
        {weightFallbackNote}
        {lhFallbackNote ? <><br />{lhFallbackNote}</> : null}
      </div>
    </div>
  );
};

export function HeadingFallbackPreview({
  titleWeight,
  subtitleWeight,
  sizePx,
  subtitleSizePx,
  sizePreset,
  titleSample,
  subtitleSample,
}: Props) {
  // Mirror WidgetView.tsx exactly:
  //  - sizePx > 0                → px + lh 1.1 (hardcoded to match preset)
  //  - sizePx = 0 and no preset  → var(--td-pt-size, 15px) + var(--td-pt-lh, 1.3)
  //  - preset selected           → Tailwind class governs size; we still show
  //                                 the TD line-height fallback because the
  //                                 heading widget does not overwrite it.
  const usePxTitle = sizePx > 0;
  const useGlobalTitle = !usePxTitle && !sizePreset;

  const titleFontSize = usePxTitle
    ? `${sizePx}px`
    : useGlobalTitle
      ? "var(--td-pt-size, 15px)"
      : "inherit";
  const titleLineHeight: string | number = usePxTitle
    ? 1.1
    : useGlobalTitle
      ? "var(--td-pt-lh, 1.3)"
      : "var(--td-pt-lh, 1.3)";

  const usePxSub = subtitleSizePx > 0;
  const subtitleFontSize = usePxSub ? `${subtitleSizePx}px` : "var(--td-pe-size, 13px)";
  const subtitleLineHeight: string | number = usePxSub ? 1.35 : "var(--td-pe-lh, 1.5)";

  const resolvedTitleWeight = titleWeight || "var(--td-pt-weight, 600)";
  const resolvedSubtitleWeight = subtitleWeight || "var(--td-pe-weight, 400)";

  const weightFallbackNote =
    !titleWeight && !subtitleWeight
      ? "Wagi (tytuł + podtytuł) dziedziczą z Theme Design → Typografia."
      : !titleWeight
        ? "Waga tytułu dziedziczy z Theme Design (--td-pt-weight)."
        : !subtitleWeight
          ? "Waga podtytułu dziedziczy z Theme Design (--td-pe-weight)."
          : "Wagi ustawione lokalnie na widgecie.";
  const lhFallbackNote =
    !usePxTitle || !usePxSub
      ? "Line-height dziedziczy z Theme Design (--td-pt-lh / --td-pe-lh)."
      : "";

  return (
    <div className="mt-3 space-y-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Podgląd fallbacków (light / dark)
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Row
          mode="light"
          label="Jasny"
          titleWeight={resolvedTitleWeight}
          subtitleWeight={resolvedSubtitleWeight}
          titleFontSize={titleFontSize}
          titleLineHeight={titleLineHeight}
          subtitleFontSize={subtitleFontSize}
          subtitleLineHeight={subtitleLineHeight}
          titleSample={titleSample}
          subtitleSample={subtitleSample}
          weightFallbackNote={weightFallbackNote}
          lhFallbackNote={lhFallbackNote}
        />
        <Row
          mode="dark"
          label="Ciemny"
          titleWeight={resolvedTitleWeight}
          subtitleWeight={resolvedSubtitleWeight}
          titleFontSize={titleFontSize}
          titleLineHeight={titleLineHeight}
          subtitleFontSize={subtitleFontSize}
          subtitleLineHeight={subtitleLineHeight}
          titleSample={titleSample}
          subtitleSample={subtitleSample}
          weightFallbackNote={weightFallbackNote}
          lhFallbackNote={lhFallbackNote}
        />
      </div>
      <p className="text-[10px] text-muted-foreground">
        Puste pole „Grubość" / brak „Rozmiar px" = wartość z Theme Design → „Typografia postów".
      </p>
    </div>
  );
}
