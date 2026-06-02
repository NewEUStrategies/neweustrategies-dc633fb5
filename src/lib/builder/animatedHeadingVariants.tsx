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

const shapeStroke: Record<AnimatedHeadingShape, number> = {
  none: 0,
  underline: 3,
  "double-underline": 4,
  curly: 1.75,
  zigzag: 1.75,
  circle: 3,
  diagonal: 3,
  strike: 3,
  "double-strike": 2.5,
  x: 3,
  framed: 3,
};

// Rough path lengths (user-units) used to drive stroke-dashoffset animation.
// Must be >= actual rendered path length so the line starts hidden.
const shapePathLen: Record<AnimatedHeadingShape, number> = {
  none: 0,
  underline: 220,
  "double-underline": 460,
  curly: 440,
  zigzag: 320,
  circle: 520,
  diagonal: 220,
  strike: 220,
  "double-strike": 440,
  x: 440,
  framed: 460,
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
  const stroke = shapeStroke[shape];
  const len = shapePathLen[shape];
  const dur = `${durationMs}ms`;
  const delay = `${delayMs}ms`;
  const iter = loop ? "infinite" : "1";
  const animName = `aHead-draw-${animKey}`;

  const css = `
    @keyframes ${animName} {
      from { stroke-dashoffset: ${len}; }
      to   { stroke-dashoffset: 0; }
    }
    .ahead-path-${animKey} {
      stroke-dasharray: ${len};
      stroke-dashoffset: ${len};
      animation: ${animName} ${dur} ${delay} ${iter} forwards ease-in-out;
    }
  `;

  // Underline-family viewBox is taller and paths sit lower so they read well
  // even when squeezed into a short overlay band.
  let viewBox = "0 0 200 22";
  let body: React.ReactNode = null;
  switch (shape) {
    case "underline":
      viewBox = "0 0 200 10";
      body = <path d="M2 6 Q 100 2 198 6" />;
      break;
    case "double-underline":
      viewBox = "0 0 200 14";
      body = (
        <>
          <path d="M2 4 Q 100 1 198 4" />
          <path d="M2 11 Q 100 8 198 11" />
        </>
      );
      break;
    case "curly":
      viewBox = "0 0 200 14";
      body = <path d="M2 7 q 12.5 -7 25 0 t 25 0 t 25 0 t 25 0 t 25 0 t 25 0 t 25 0 t 23 0" />;
      break;
    case "zigzag":
      viewBox = "0 0 200 14";
      body = <path d="M2 11 L 22 3 L 42 11 L 62 3 L 82 11 L 102 3 L 122 11 L 142 3 L 162 11 L 182 3 L 198 11" />;
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

  const isUnderlineLike =
    shape === "underline" || shape === "double-underline" || shape === "curly" || shape === "zigzag";

  const position: CSSProperties =
    shape === "circle" || shape === "framed" || shape === "x"
      ? { position: "absolute", inset: "-6% -4%", width: "108%", height: "112%", pointerEvents: "none", zIndex: 0, overflow: "visible" }
      : shape === "strike" || shape === "double-strike" || shape === "diagonal"
      ? { position: "absolute", left: 0, right: 0, top: "45%", width: "100%", height: "0.5em", pointerEvents: "none", zIndex: 0, overflow: "visible" }
      : { position: "absolute", left: 0, right: 0, top: "100%", width: "100%", height: isUnderlineLike ? "0.55em" : "0.4em", marginTop: isUnderlineLike ? "-0.1em" : "-0.05em", pointerEvents: "none", zIndex: 0, overflow: "visible" };

  return (
    <>
      <style>{css}</style>
      <svg viewBox={viewBox} preserveAspectRatio="none" style={position}>
        <g
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
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
