// Animated heading widget — separate from the regular "heading" widget.
// Two modes:
//  • highlight: a single emphasized phrase with an SVG shape drawn over/under
//    it (underline, circle, curly, zigzag, diagonal, strike, x, double, …).
//  • rotate: cycles through a list of words in the highlighted spot.
// Colors are split into two: `color` (static text — non-animated) and
// `accentColor` (animated text + the shape stroke — duo tone).
import { useEffect, useState, type CSSProperties } from "react";

export type AnimatedHeadingMode = "highlight" | "rotate";

export type AnimatedHeadingShape =
  | "none"
  | "underline"
  | "double-underline"
  | "curly"
  | "zigzag"
  | "circle"
  | "diagonal"
  | "strike"
  | "x"
  | "double-strike"
  | "framed";

export const ANIMATED_SHAPES: { value: AnimatedHeadingShape; label: string }[] = [
  { value: "none",              label: "Brak" },
  { value: "underline",         label: "Podkreślenie" },
  { value: "double-underline",  label: "Podwójne podkreślenie" },
  { value: "curly",             label: "Falisty" },
  { value: "zigzag",            label: "Zygzak" },
  { value: "circle",            label: "Okrąg" },
  { value: "diagonal",          label: "Ukośny" },
  { value: "strike",            label: "Przekreślenie" },
  { value: "double-strike",     label: "Podwójne przekreślenie" },
  { value: "x",                 label: "X" },
  { value: "framed",            label: "Ramka" },
];

export const ANIMATED_MODES: { value: AnimatedHeadingMode; label: string }[] = [
  { value: "highlight", label: "Wyróżnione słowo" },
  { value: "rotate",    label: "Rotujące słowa" },
];

export interface AnimatedHeadingConfig {
  mode?: AnimatedHeadingMode;
  shape?: AnimatedHeadingShape;
  // STATIC (non-animated) text
  textBefore?: string;
  textAfter?: string;
  // ANIMATED text — used when mode = "highlight"
  highlight?: string;
  // ANIMATED text — used when mode = "rotate" (one word per line)
  rotateWords?: string[];
  // Duo-tone colors
  color?: string;        // static text color (textBefore + textAfter)
  accentColor?: string;  // animated text color + shape stroke
  // Animation timing
  durationMs?: number;   // shape draw duration / per-word rotate duration
  delayMs?: number;      // initial delay
  loop?: boolean;        // for shape: replay; for rotate: cycle infinitely
  tag?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  align?: "left" | "center" | "right";
}

const shapeStroke: Record<AnimatedHeadingShape, string> = {
  none: "0",
  underline: "3",
  "double-underline": "2.5",
  curly: "3",
  zigzag: "3",
  circle: "3",
  diagonal: "3",
  strike: "3",
  "double-strike": "2.5",
  x: "3",
  framed: "3",
};

function ShapeSvg({
  shape, color, durationMs, delayMs, loop, animKey,
}: {
  shape: AnimatedHeadingShape;
  color: string;
  durationMs: number;
  delayMs: number;
  loop: boolean;
  animKey: string | number;
}) {
  if (shape === "none") return null;
  // viewBox kept generic — preserveAspectRatio=none makes the stroke stretch to
  // the highlighted text box.
  const stroke = shapeStroke[shape];
  const dur = `${durationMs}ms`;
  const delay = `${delayMs}ms`;
  const iter = loop ? "infinite" : "1";
  const animName = `aHead-draw-${animKey}`;

  const css = `
    @keyframes ${animName} {
      from { stroke-dashoffset: 1000; }
      to   { stroke-dashoffset: 0; }
    }
    .ahead-path-${animKey} {
      stroke-dasharray: 1000;
      stroke-dashoffset: 1000;
      animation: ${animName} ${dur} ${delay} ${iter} forwards ease-in-out;
    }
  `;

  let body: React.ReactNode = null;
  switch (shape) {
    case "underline":
      body = <path d="M2 18 Q 100 14 198 18" />;
      break;
    case "double-underline":
      body = (
        <>
          <path d="M2 15 Q 100 11 198 15" />
          <path d="M2 19 Q 100 17 198 19" />
        </>
      );
      break;
    case "curly":
      body = <path d="M2 16 q 12 -10 24 0 t 24 0 t 24 0 t 24 0 t 24 0 t 24 0 t 24 0 t 24 0" />;
      break;
    case "zigzag":
      body = <path d="M2 18 L 22 12 L 42 18 L 62 12 L 82 18 L 102 12 L 122 18 L 142 12 L 162 18 L 182 12 L 198 18" />;
      break;
    case "circle":
      body = <path d="M100 4 C 30 4, 4 12, 4 11.5 C 4 19, 30 19.5, 100 19.5 C 170 19.5, 196 19, 196 11.5 C 196 4, 170 4, 100 4 Z" />;
      break;
    case "diagonal":
      body = <path d="M2 19 L 198 4" />;
      break;
    case "strike":
      body = <path d="M2 11 L 198 11" />;
      break;
    case "double-strike":
      body = (
        <>
          <path d="M2 8 L 198 8" />
          <path d="M2 14 L 198 14" />
        </>
      );
      break;
    case "x":
      body = (
        <>
          <path d="M2 2 L 198 20" />
          <path d="M198 2 L 2 20" />
        </>
      );
      break;
    case "framed":
      body = <rect x="2" y="2" width="196" height="18" fill="none" />;
      break;
    default:
      return null;
  }

  const position: CSSProperties =
    shape === "circle" || shape === "framed" || shape === "x"
      ? { position: "absolute", inset: "-6% -4%", width: "108%", height: "112%", pointerEvents: "none", zIndex: 0 }
      : shape === "strike" || shape === "double-strike" || shape === "diagonal"
      ? { position: "absolute", left: 0, right: 0, top: "45%", width: "100%", height: "0.5em", pointerEvents: "none", zIndex: 0 }
      : { position: "absolute", left: 0, right: 0, top: "100%", width: "100%", height: "0.4em", marginTop: "-0.05em", pointerEvents: "none", zIndex: 0 };

  return (
    <>
      <style>{css}</style>
      <svg viewBox="0 0 200 22" preserveAspectRatio="none" style={position}>
        <g
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`ahead-path-${animKey}`}
        >
          {body}
        </g>
      </svg>
    </>
  );
}

export function AnimatedHeadingRender({
  config,
  preview = false,
}: {
  config: AnimatedHeadingConfig;
  preview?: boolean;
}) {
  const mode = config.mode ?? "highlight";
  const shape = config.shape ?? "underline";
  const Tag = (config.tag ?? "h2") as React.ElementType;
  const align = config.align ?? "left";

  const color = config.color || "currentColor";
  const accent = config.accentColor || "hsl(var(--primary, 220 90% 56%))";

  const durationMs = Math.max(300, config.durationMs ?? 1600);
  const delayMs = Math.max(0, config.delayMs ?? 200);
  const loop = config.loop !== false;

  const words = (config.rotateWords ?? []).filter((w) => w && w.trim().length > 0);
  const [wIdx, setWIdx] = useState(0);
  useEffect(() => { setWIdx(0); }, [words.length, mode]);
  useEffect(() => {
    if (mode !== "rotate" || preview || words.length < 2) return;
    const t = window.setInterval(
      () => setWIdx((i) => (i + 1) % words.length),
      durationMs + 600,
    );
    return () => window.clearInterval(t);
  }, [mode, preview, words.length, durationMs]);

  // Re-key the shape animation when the rotating word changes so the SVG
  // re-draws for each new word.
  const animKey = mode === "rotate" ? `r-${wIdx}` : "h-0";

  const animatedText =
    mode === "rotate"
      ? (words[wIdx] ?? "")
      : (config.highlight ?? "");

  return (
    <Tag
      className="font-display text-3xl md:text-4xl leading-tight"
      style={{ color, textAlign: align, margin: 0 }}
    >
      {config.textBefore ? <span>{config.textBefore}{config.textBefore.endsWith(" ") ? "" : " "}</span> : null}
      <span
        key={animKey}
        style={{
          position: "relative",
          display: "inline-block",
          color: accent,
          padding: shape === "circle" || shape === "framed" ? "0 .2em" : undefined,
        }}
      >
        <span style={{ position: "relative", zIndex: 1 }}>{animatedText || (preview ? "wyróżnione" : "")}</span>
        <ShapeSvg
          shape={shape}
          color={accent}
          durationMs={durationMs}
          delayMs={delayMs}
          loop={mode === "rotate" ? false : loop}
          animKey={animKey}
        />
      </span>
      {config.textAfter ? <span>{config.textAfter.startsWith(" ") ? "" : " "}{config.textAfter}</span> : null}
    </Tag>
  );
}
