// Animated heading widget - separate from the regular "heading" widget.
// Two modes:
//  • highlight: a single emphasized phrase with an SVG shape drawn over/under
//    it (underline, circle, curly, zigzag, diagonal, strike, x, double, …).
//  • rotate: cycles through a list of words in the highlighted spot.
// Colors are split into two: `color` (static text - non-animated) and
// `accentColor` (animated text + the shape stroke - duo tone).
import { useEffect, useState, type CSSProperties } from "react";

export type AnimatedHeadingMode = "highlight" | "rotate" | "hover-underline";

export type AnimatedHeadingShape =
  | "none"
  | "underline"
  | "double-underline"
  | "scribble"
  | "curly"
  | "zigzag"
  | "circle"
  | "diagonal"
  | "strike"
  | "x"
  | "double-strike"
  | "framed"
  | "hover-line-1"
  | "hover-line-2"
  | "hover-line-3"
  | "hover-line-4"
  | "hover-line-5"
  | "hover-line-6"
  | "hover-line-7"
  | "hover-line-8";

export const ANIMATED_SHAPES: { value: AnimatedHeadingShape; label: string }[] = [
  { value: "none",              label: "Brak" },
  { value: "underline",         label: "Podkreślenie" },
  { value: "double-underline",  label: "Podwójne podkreślenie" },
  { value: "scribble",          label: "Odręczne podkreślenie" },
  { value: "curly",             label: "Falisty" },
  { value: "zigzag",            label: "Zygzak" },
  { value: "circle",            label: "Okrąg" },
  { value: "diagonal",          label: "Ukośny" },
  { value: "strike",            label: "Przekreślenie" },
  { value: "double-strike",     label: "Podwójne przekreślenie" },
  { value: "x",                 label: "X" },
  { value: "framed",            label: "Ramka" },
  { value: "hover-line-1",      label: "Hover: rozwijana ze środka" },
  { value: "hover-line-2",      label: "Hover: ze środka w 2 strony" },
  { value: "hover-line-3",      label: "Hover: od krawędzi do środka" },
  { value: "hover-line-4",      label: "Hover: skok w bok" },
  { value: "hover-line-5",      label: "Hover: punkt + linia" },
  { value: "hover-line-6",      label: "Hover: dwa segmenty" },
  { value: "hover-line-7",      label: "Hover: sprężyna" },
  { value: "hover-line-8",      label: "Hover: snap środek" },
];

export const HOVER_LINE_CSS = `
.ah-hu { display: inline-block; padding-bottom: 5px; cursor: pointer; }
.ah-hu-1 { background: linear-gradient(currentColor 0 0) var(--p,50%) 100%/var(--d,10%) 3px no-repeat; transition: .3s, background-position .3s .3s; }
.ah-hu-1:hover { --d:100%; --p:0%; transition: .3s, background-size .3s .3s; }
.ah-hu-2 { background: linear-gradient(currentColor 0 0) left var(--p,50%) bottom 0/var(--d,10%) 3px no-repeat, linear-gradient(currentColor 0 0) right var(--p,50%) bottom 0/var(--d,10%) 3px no-repeat; transition: .3s, background-position .3s .3s; }
.ah-hu-2:hover { --d:50%; --p:50.1%; transition: cubic-bezier(0,500,1,500) .3s, background-size .3s .3s; }
.ah-hu-3 { background: linear-gradient(currentColor 0 0) left var(--p,50%) bottom 0/var(--d,10%) 3px no-repeat, linear-gradient(currentColor 0 0) right var(--p,50%) bottom 0/var(--d,10%) 3px no-repeat; transition: .3s, background-position .3s .3s; }
.ah-hu-3:hover { --d:100%; --p:100%; transition: .3s, background-size .3s .3s; }
.ah-hu-4 { background: linear-gradient(currentColor 0 0) var(--p,50%) 100%/var(--d,10%) 3px no-repeat; transition: .3s, background-position 0s; }
.ah-hu-4:hover { --d:100%; --p:0%; transition: .3s, background-size .3s .3s; }
.ah-hu-5 { background: linear-gradient(currentColor 0 0) calc(50% + 10px) 100%/20px 3px no-repeat, linear-gradient(90deg, transparent calc(100% - 20px), currentColor 0) 0 100%/var(--d,50%) 3px no-repeat; transition: .3s; }
.ah-hu-5:hover { --d:0%; background-position: calc(50% + 0px) 100%, 0 100%; transition: .3s cubic-bezier(0,-5,1,-5), background-size .3s .3s; }
.ah-hu-6 { background: linear-gradient(currentColor 0 0) left var(--p,50%) bottom 0/var(--d,20px) 3px no-repeat, linear-gradient(currentColor 0 0) right var(--p,50%) bottom 0/var(--d,20px) 3px no-repeat; transition: .3s, background-position 0s; }
.ah-hu-6:hover { --d:100%; --p:100%; transition: .3s, background-size .3s .3s; }
.ah-hu-7 { background: linear-gradient(currentColor 0 0) -20% 100%/var(--p,10%) 3px no-repeat; transition: .5s .3s cubic-bezier(0,1.25,1,1.8), background-size .3s; }
.ah-hu-7:hover { background-position: 50% 100%; --p:50%; transition: .5s cubic-bezier(0,1.25,1,1.8), background-size .2s .7s; }
.ah-hu-8 { background: linear-gradient(currentColor 0 0) bottom/var(--p,10%) 3px no-repeat; transition: 0s; }
.ah-hu-8:hover { --p:10.1%; transition: .5s cubic-bezier(0,800,1,800); }
`;

export const ANIMATED_MODES: { value: AnimatedHeadingMode; label: string }[] = [
  { value: "highlight",       label: "Wyróżnione słowo" },
  { value: "rotate",          label: "Rotujące słowa" },
  { value: "hover-underline", label: "Hover - podkreślenie" },
];

export interface AnimatedHeadingConfig {
  mode?: AnimatedHeadingMode;
  shape?: AnimatedHeadingShape;
  // STATIC (non-animated) text
  textBefore?: string;
  textAfter?: string;
  // ANIMATED text - used when mode = "highlight"
  highlight?: string;
  // ANIMATED text - used when mode = "rotate" (one word per line)
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
  scribble: 4,
  curly: 1.75,
  zigzag: 1.75,
  circle: 3,
  diagonal: 3,
  strike: 3,
  "double-strike": 2.5,
  x: 3,
  framed: 3,
  "hover-line-1": 0, "hover-line-2": 0, "hover-line-3": 0, "hover-line-4": 0,
  "hover-line-5": 0, "hover-line-6": 0, "hover-line-7": 0, "hover-line-8": 0,
};

// Rough path lengths (user-units) used to drive stroke-dashoffset animation.
// Must be >= actual rendered path length so the line starts hidden.
const shapePathLen: Record<AnimatedHeadingShape, number> = {
  none: 0,
  underline: 220,
  "double-underline": 460,
  scribble: 240,
  curly: 440,
  zigzag: 320,
  circle: 520,
  diagonal: 220,
  strike: 220,
  "double-strike": 440,
  x: 440,
  framed: 460,
  "hover-line-1": 0, "hover-line-2": 0, "hover-line-3": 0, "hover-line-4": 0,
  "hover-line-5": 0, "hover-line-6": 0, "hover-line-7": 0, "hover-line-8": 0,
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
  if (shape.startsWith("hover-line-")) return null;

  // Special case: hand-drawn scribble - two slightly curvy underlines drawn
  // sequentially (second shorter, slightly offset), mimicking a marker.
  if (shape === "scribble") {
    const halfDur = Math.max(200, Math.round(durationMs * 0.55));
    const drawDur = halfDur * 2;
    const holdMs = 1400;
    const fadeMs = 600;
    const pauseMs = 800;
    const totalDur = loop ? drawDur + holdMs + fadeMs + pauseMs : drawDur;
    const len1 = 210;
    const len2 = 150;
    const animA = `aHead-scribbleA-${animKey}`;
    const animB = `aHead-scribbleB-${animKey}`;
    const aHalf = (halfDur / totalDur) * 100;
    const aDrawEnd = (drawDur / totalDur) * 100;
    const aHoldEnd = ((drawDur + holdMs) / totalDur) * 100;
    const aFadeEnd = ((drawDur + holdMs + fadeMs) / totalDur) * 100;
    const css2 = loop
      ? `
      @keyframes ${animA} {
        0%   { stroke-dashoffset: ${len1}; opacity: 1; }
        ${aHalf.toFixed(2)}% { stroke-dashoffset: 0; opacity: 1; }
        ${aHoldEnd.toFixed(2)}% { stroke-dashoffset: 0; opacity: 1; }
        ${aFadeEnd.toFixed(2)}% { stroke-dashoffset: 0; opacity: 0; }
        100% { stroke-dashoffset: ${len1}; opacity: 0; }
      }
      @keyframes ${animB} {
        0%   { stroke-dashoffset: ${len2}; opacity: 1; }
        ${aHalf.toFixed(2)}% { stroke-dashoffset: ${len2}; opacity: 1; }
        ${aDrawEnd.toFixed(2)}% { stroke-dashoffset: 0; opacity: 1; }
        ${aHoldEnd.toFixed(2)}% { stroke-dashoffset: 0; opacity: 1; }
        ${aFadeEnd.toFixed(2)}% { stroke-dashoffset: 0; opacity: 0; }
        100% { stroke-dashoffset: ${len2}; opacity: 0; }
      }
      .ahead-scribbleA-${animKey} {
        stroke-dasharray: ${len1};
        stroke-dashoffset: ${len1};
        animation: ${animA} ${totalDur}ms ${delayMs}ms infinite ease-out;
      }
      .ahead-scribbleB-${animKey} {
        stroke-dasharray: ${len2};
        stroke-dashoffset: ${len2};
        animation: ${animB} ${totalDur}ms ${delayMs}ms infinite ease-out;
      }
    `
      : `
      @keyframes ${animA} {
        0%   { stroke-dashoffset: ${len1}; }
        ${aHalf.toFixed(2)}% { stroke-dashoffset: 0; }
        100% { stroke-dashoffset: 0; }
      }
      @keyframes ${animB} {
        0%   { stroke-dashoffset: ${len2}; }
        ${aHalf.toFixed(2)}% { stroke-dashoffset: ${len2}; }
        100% { stroke-dashoffset: 0; }
      }
      .ahead-scribbleA-${animKey} {
        stroke-dasharray: ${len1};
        stroke-dashoffset: ${len1};
        animation: ${animA} ${totalDur}ms ${delayMs}ms 1 forwards ease-out;
      }
      .ahead-scribbleB-${animKey} {
        stroke-dasharray: ${len2};
        stroke-dashoffset: ${len2};
        animation: ${animB} ${totalDur}ms ${delayMs}ms 1 forwards ease-out;
      }
    `;
    const positionScribble: CSSProperties = {
      position: "absolute", left: 0, right: 0, top: "100%",
      width: "100%", height: "0.65em", marginTop: "-0.12em",
      pointerEvents: "none", zIndex: 0, overflow: "visible",
    };
    return (
      <>
        <style>{css2}</style>
        <svg viewBox="0 0 200 20" preserveAspectRatio="none" style={positionScribble}>
          <g fill="none" stroke={color} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke">
            <path className={`ahead-scribbleA-${animKey}`} d="M3 8 Q 60 4 110 7 T 197 9" />
            <path className={`ahead-scribbleB-${animKey}`} d="M18 15 Q 70 12 120 14 T 175 15" />
          </g>
        </svg>
      </>
    );
  }

  const stroke = shapeStroke[shape];
  const len = shapePathLen[shape];
  const delay = `${delayMs}ms`;
  const animName = `aHead-draw-${animKey}`;

  // Cycle: draw → hold → fade-out → pause → repeat (when loop is true).
  // Single-shot: draw and stay (forwards).
  const holdMs = 1400;
  const fadeMs = 600;
  const pauseMs = 800;
  const cycleMs = durationMs + holdMs + fadeMs + pauseMs;
  const drawEnd = (durationMs / cycleMs) * 100;
  const holdEnd = ((durationMs + holdMs) / cycleMs) * 100;
  const fadeEnd = ((durationMs + holdMs + fadeMs) / cycleMs) * 100;

  const css = loop
    ? `
    @keyframes ${animName} {
      0%                       { stroke-dashoffset: ${len}; opacity: 1; }
      ${drawEnd.toFixed(2)}%   { stroke-dashoffset: 0;     opacity: 1; }
      ${holdEnd.toFixed(2)}%   { stroke-dashoffset: 0;     opacity: 1; }
      ${fadeEnd.toFixed(2)}%   { stroke-dashoffset: 0;     opacity: 0; }
      100%                     { stroke-dashoffset: ${len}; opacity: 0; }
    }
    .ahead-path-${animKey} {
      stroke-dasharray: ${len};
      stroke-dashoffset: ${len};
      animation: ${animName} ${cycleMs}ms ${delay} infinite ease-in-out;
    }
  `
    : `
    @keyframes ${animName} {
      from { stroke-dashoffset: ${len}; }
      to   { stroke-dashoffset: 0; }
    }
    .ahead-path-${animKey} {
      stroke-dasharray: ${len};
      stroke-dashoffset: ${len};
      animation: ${animName} ${durationMs}ms ${delay} 1 forwards ease-in-out;
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
      viewBox = "0 0 200 16";
      body = (
        <>
          <path d="M2 5 Q 100 1 198 5" />
          <path d="M3 12 Q 100 9 197 12" />
        </>
      );
      break;
    case "curly":
      viewBox = "0 0 200 10";
      body = <path d="M2 5 q 12.5 -3 25 0 t 25 0 t 25 0 t 25 0 t 25 0 t 25 0 t 25 0 t 23 0" />;
      break;
    case "zigzag":
      viewBox = "0 0 200 10";
      body = <path d="M2 8 L 22 4 L 42 8 L 62 4 L 82 8 L 102 4 L 122 8 L 142 4 L 162 8 L 182 4 L 198 8" />;
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

  const isUnderlineLike =
    shape === "underline" || shape === "double-underline" || shape === "curly" || shape === "zigzag";
  const needsFrame = shape === "circle" || shape === "framed" || shape === "x";
  const isHoverLine = shape.startsWith("hover-line-");
  const hoverClass = isHoverLine ? `ah-hu ah-hu-${shape.slice("hover-line-".length)}` : "";

  return (
    <Tag
      className="font-display text-3xl md:text-4xl leading-tight"
      style={{
        color,
        textAlign: align,
        margin: 0,
        paddingBottom: isUnderlineLike ? "0.45em" : needsFrame ? "0.25em" : undefined,
        paddingTop: needsFrame ? "0.15em" : undefined,
      }}
    >
      {isHoverLine ? <style>{HOVER_LINE_CSS}</style> : null}
      {config.textBefore ? <span>{config.textBefore}{config.textBefore.endsWith(" ") ? "" : " "}</span> : null}
      <span
        key={animKey}
        className={hoverClass}
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
