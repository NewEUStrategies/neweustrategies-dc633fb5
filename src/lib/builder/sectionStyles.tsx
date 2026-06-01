// Computes inline styles + auxiliary DOM (background layers, overlay, dividers,
// scoped typography CSS) for a Section / InnerSection. Shared between the
// builder canvas (live preview) and the public BuilderRenderer so the editor
// always matches the published output.
import type { CSSProperties, ReactElement } from "react";
import type {
  SectionNode, InnerSectionNode, Device, BackgroundSettings, OverlaySettings,
  BorderSettings, ShapeDividerSettings, TypographySettings, SectionLayout,
  BoxSides, ColumnsGap, VerticalAlign,
} from "./types";
import { safeImageUrl } from "@/lib/sanitize";

// ---------- responsive helper ----------

const pick = <T,>(rv: { desktop?: T; tablet?: T; mobile?: T } | undefined, device: Device): T | undefined => {
  if (!rv) return undefined;
  return rv[device] ?? rv.desktop ?? rv.tablet ?? rv.mobile;
};

// ---------- layout ----------

export const GAP_PX: Record<ColumnsGap, number> = {
  default: 20, no: 0, narrow: 10, extended: 15, wide: 30, wider: 40, custom: 20,
};

export const SECTION_SAFE_AREA_PX = 16;
export const INNER_SECTION_SAFE_AREA_PX = 12;
export const COLUMN_SAFE_AREA_PX = 12;
/** Domyślna i minimalna wysokość każdej sekcji (zgodna z wysokością kompaktowych widgetów). */
export const SECTION_DEFAULT_MIN_HEIGHT_PX = 40;

export function columnsGapPx(layout?: SectionLayout): number {
  const g = layout?.columnsGap ?? "default";
  if (g === "custom") return layout?.columnsGapCustom ?? 20;
  return GAP_PX[g];
}

const VALIGN_FLEX: Partial<Record<VerticalAlign, CSSProperties>> = {
  top: { alignItems: "flex-start" },
  middle: { alignItems: "center" },
  bottom: { alignItems: "flex-end" },
  "space-between": { alignItems: "stretch", justifyContent: "space-between" },
  "space-around": { alignItems: "stretch", justifyContent: "space-around" },
  "space-evenly": { alignItems: "stretch", justifyContent: "space-evenly" },
};

/** CSS for the wrapper <section>. Stretch, min-height, overflow, vertical align. */
export function sectionWrapperStyle(node: SectionNode | InnerSectionNode): CSSProperties {
  const L = node.layout;
  const css: CSSProperties = {
    position: "relative",
    width: "100%",
    maxWidth: "100%",
    boxSizing: "border-box",
  };
  if (L?.stretch) {
    css.width = "100vw";
    css.maxWidth = undefined;
    css.marginLeft = "calc(50% - 50vw)";
    css.marginRight = "calc(50% - 50vw)";
  }
  if (L?.overflow === "hidden") css.overflow = "hidden";
  if (L?.height === "fit-screen") {
    css.minHeight = `${L.heightValue ?? 100}vh`;
  } else if (L?.height === "min-height") {
    css.minHeight = `${L.heightValue ?? 40}px`;
  } else if (L?.height === "fixed") {
    const px = L.heightValue ?? 400;
    css.height = `${px}px`;
    css.minHeight = `${px}px`;
  }
  // "default" → no min-height: section is exactly as tall as its content.
  css.marginTop = `${typeof L?.marginTop === "number" ? L.marginTop : 0}px`;
  css.marginBottom = `${typeof L?.marginBottom === "number" ? L.marginBottom : 0}px`;

  return css;
}

/** Style for the inner container (boxed width vs. full). */
export function sectionContainerStyle(node: SectionNode | InnerSectionNode): CSSProperties {
  const L = node.layout;
  const css: CSSProperties = {
    position: "relative",
    zIndex: 1,
    width: "100%",
    maxWidth: "100%",
    boxSizing: "border-box",
    overflow: "hidden",
    paddingLeft: `${SECTION_SAFE_AREA_PX}px`,
    paddingRight: `${SECTION_SAFE_AREA_PX}px`,
  };
  const contentWidth = L?.contentWidth ?? "boxed";
  if (contentWidth === "boxed") {
    css.maxWidth = `${L?.width ?? 1140}px`;
    css.marginLeft = "auto";
    css.marginRight = "auto";
  }
  return css;
}

/** Style for the columns grid container (gap + vertical alignment). */
export function columnsRowStyle(node: SectionNode | InnerSectionNode, totalSpan: number): CSSProperties {
  const gap = columnsGapPx(node.layout);
  const valign = node.layout?.verticalAlign ?? "default";
  const css: CSSProperties = {
    display: "grid",
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    boxSizing: "border-box",
    gridTemplateColumns: `repeat(${totalSpan}, minmax(0, 1fr))`,
    gap: `${gap}px`,
  };
  if (valign !== "default") Object.assign(css, VALIGN_FLEX[valign] ?? {});
  return css;
}

// ---------- background ----------

function gradientCss(bg: BackgroundSettings): string | undefined {
  if (bg.type !== "gradient") return undefined;
  const c1 = bg.gradientColor ?? "#3a8bff";
  const c2 = bg.gradientColor2 ?? "transparent";
  const l1 = `${bg.gradientLocation ?? 0}%`;
  const l2 = `${bg.gradientLocation2 ?? 100}%`;
  if (bg.gradientType === "radial") {
    return `radial-gradient(circle, ${c1} ${l1}, ${c2} ${l2})`;
  }
  const angle = bg.gradientAngle ?? 180;
  return `linear-gradient(${angle}deg, ${c1} ${l1}, ${c2} ${l2})`;
}

/** Inline style for an element acting as a single background layer. */
export function backgroundLayerStyle(bg: BackgroundSettings | undefined): CSSProperties {
  if (!bg) return {};
  const css: CSSProperties = {};
  switch (bg.type) {
    case "classic": {
      if (bg.color) css.backgroundColor = bg.color;
      const url = safeImageUrl(bg.imageUrl);
      if (url) {
        css.backgroundImage = `url(${JSON.stringify(url)})`;
        css.backgroundPosition = bg.position ?? "center center";
        css.backgroundRepeat = bg.repeat ?? "no-repeat";
        css.backgroundSize = bg.size ?? "cover";
        css.backgroundAttachment = bg.attachment ?? "scroll";
      }
      break;
    }
    case "gradient": {
      const g = gradientCss(bg);
      if (g) css.backgroundImage = g;
      break;
    }
    case "video":
    case "slideshow":
      if (bg.color) css.backgroundColor = bg.color;
      break;
    default:
      if (bg.color) css.backgroundColor = bg.color;
  }
  return css;
}

/** Style for the dedicated overlay element placed above background, below content. */
export function overlayLayerStyle(ov: OverlaySettings | undefined): CSSProperties {
  if (!ov || ov.type === "none" || !ov.type) return { display: "none" };
  const css: CSSProperties = {
    position: "absolute", inset: 0, pointerEvents: "none",
    opacity: ov.opacity ?? 0.5,
    mixBlendMode: (ov.blendMode ?? "normal") as CSSProperties["mixBlendMode"],
    ...backgroundLayerStyle(ov),
  };
  return css;
}

// ---------- border ----------

function sides(v: BoxSides | undefined, unit = "px"): string | undefined {
  if (!v) return undefined;
  const t = v.top ?? 0, r = v.right ?? 0, b = v.bottom ?? 0, l = v.left ?? 0;
  if (!t && !r && !b && !l) return undefined;
  return `${t}${unit} ${r}${unit} ${b}${unit} ${l}${unit}`;
}

export function borderStyle(b: BorderSettings | undefined): CSSProperties {
  if (!b || !b.style || b.style === "none") return {};
  const css: CSSProperties = { borderStyle: b.style };
  const w = sides(b.width);
  if (w) css.borderWidth = w;
  if (b.color) css.borderColor = b.color;
  const r = sides(b.radius);
  if (r) css.borderRadius = r;
  if (b.boxShadow) css.boxShadow = b.boxShadow;
  return css;
}

// ---------- shape dividers ----------

/** Raw <path d="..."> for each preset. Authored for a 1000x100 viewBox. */
const SHAPE_PATHS: Record<string, string> = {
  mountains:
    "M0,100 L0,40 L150,70 L300,20 L500,80 L700,10 L850,60 L1000,30 L1000,100 Z",
  drops:
    "M0,100 Q125,0 250,100 T500,100 T750,100 T1000,100 Z",
  clouds:
    "M0,100 C150,0 350,0 500,80 C650,160 850,40 1000,100 L1000,100 L0,100 Z",
  zigzag:
    "M0,100 L100,20 L200,100 L300,20 L400,100 L500,20 L600,100 L700,20 L800,100 L900,20 L1000,100 Z",
  pyramids:
    "M0,100 L150,30 L300,100 L450,30 L600,100 L750,30 L900,100 L1000,40 L1000,100 Z",
  triangle:
    "M0,100 L500,0 L1000,100 Z",
  tilt:
    "M0,100 L1000,0 L1000,100 Z",
  waves:
    "M0,50 C150,150 350,-50 500,50 C650,150 850,-50 1000,50 L1000,100 L0,100 Z",
  curve:
    "M0,100 Q500,-50 1000,100 Z",
  split:
    "M0,100 L450,0 L500,40 L550,0 L1000,100 Z",
  arrow:
    "M0,100 L450,100 L500,0 L550,100 L1000,100 Z",
  book:
    "M0,100 C250,0 500,0 500,100 C500,0 750,0 1000,100 Z",
};

interface DividerProps {
  s: ShapeDividerSettings | undefined;
  position: "top" | "bottom";
}

export function ShapeDivider({ s, position }: DividerProps): ReactElement | null {
  if (!s || !s.type || s.type === "none") return null;
  const path = SHAPE_PATHS[s.type];
  if (!path) return null;
  const h = s.height ?? 60;
  const w = Math.max(100, s.width ?? 100);
  const fill = s.color ?? "currentColor";
  const transform: string[] = [];
  if (s.flipH) transform.push("scaleX(-1)");
  if (s.flipV) transform.push("scaleY(-1)");
  const baseStyle: CSSProperties = {
    position: "absolute",
    left: "50%",
    width: `${w}%`,
    height: `${h}px`,
    transform: `translateX(-50%) ${transform.join(" ")}`.trim(),
    pointerEvents: "none",
    zIndex: s.bringToFront ? 2 : 0,
    color: fill,
    lineHeight: 0,
  };
  if (position === "top") baseStyle.top = 0;
  else baseStyle.bottom = 0;
  return (
    <div style={baseStyle} aria-hidden>
      <svg
        viewBox="0 0 1000 100"
        preserveAspectRatio="none"
        style={{ width: "100%", height: "100%", display: "block" }}
      >
        <path d={path} fill={fill} />
      </svg>
    </div>
  );
}

// ---------- typography ----------

/** Scoped CSS string applied via <style> tag. Targets descendants of the wrapper. */
export function typographyCss(scopeAttr: string, t: TypographySettings | undefined): string {
  if (!t) return "";
  const sel = `[data-sec-id="${scopeAttr}"]`;
  const lines: string[] = [];
  if (t.headingColor) lines.push(`${sel} :is(h1,h2,h3,h4,h5,h6){color:${t.headingColor};}`);
  if (t.textColor) lines.push(`${sel}{color:${t.textColor};}`);
  if (t.linkColor) lines.push(`${sel} a{color:${t.linkColor};}`);
  if (t.linkHoverColor) lines.push(`${sel} a:hover{color:${t.linkHoverColor};}`);
  return lines.join("\n");
}

export function typographyAlign(t: TypographySettings | undefined, device: Device): CSSProperties {
  const a = pick(t?.align, device);
  return a ? { textAlign: a } : {};
}

// ---------- combined helpers ----------

/** All "skin" styles applied to the main wrapper (size/overflow + border + bg). */
export function sectionSkinStyle(
  node: SectionNode | InnerSectionNode,
  device: Device,
): CSSProperties {
  return {
    ...sectionWrapperStyle(node),
    ...backgroundLayerStyle((node as SectionNode).background),
    ...borderStyle((node as SectionNode).border),
    ...typographyAlign((node as SectionNode).typography, device),
  };
}
