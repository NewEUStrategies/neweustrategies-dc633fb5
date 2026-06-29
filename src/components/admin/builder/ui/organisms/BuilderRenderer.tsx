// Read-only renderer for public pages. Applies all Section settings
// (layout, background layers, overlay, border, shape dividers, typography).
import { Fragment, memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ElementType } from "react";
import type { BuilderDocument, SectionNode, ColumnNode, InnerSectionNode, Device, ResponsiveValue } from "@/lib/builder/types";
import { WidgetView, getWidgetFrameStyle, hiddenOnDevice } from "@/components/admin/builder/WidgetView";
import { AUTO_SIZE_WIDGETS, COMPACT_WIDGET_TYPES } from "@/components/admin/builder/ui/organisms/widget-view/frame";
import { RenderErrorBoundary } from "@/components/admin/builder/ui/organisms/widget-view/RenderErrorBoundary";
import { sanitizeHtmlId, sanitizeCssClass, safeImageUrl } from "@/lib/sanitize";
import {
  sectionWrapperStyle, sectionContainerStyle, columnsRowStyle,
  backgroundLayerStyle, overlayLayerStyle, borderStyle,
  ShapeDivider, typographyCss, typographyAlign,
  INNER_SECTION_SAFE_AREA_PX, COLUMN_SAFE_AREA_PX,
} from "@/lib/builder/sectionStyles";
import { UsedPostIdsProvider } from "@/lib/builder/usedPostIds";
import { evaluateAccess, useAccessContext } from "@/lib/builder/accessControl";
import { useSectionPreload } from "@/lib/builder/useSectionPreload";
import { useBuilderDebug, toggleBuilderDebug } from "@/lib/builder/builderDebug";

// SSR has no viewport, so the first render is "desktop". On a phone the client
// must correct to "mobile" - running that correction in a *layout* effect lands
// it synchronously before the browser paints, so the user never sees a
// desktop->mobile flash and the (mobile-only) re-render is imperceptible.
// useLayoutEffect warns under SSR, so fall back to useEffect there (it never
// runs on the server anyway).
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

function resolveSpan(span: ResponsiveValue<number>, device: Device, deskDefault: number): number {
  if (device === "mobile") return span.mobile ?? 12;
  if (device === "tablet") return span.tablet ?? span.desktop ?? deskDefault;
  return span.desktop ?? deskDefault;
}


interface Props {
  doc: BuilderDocument;
  lang: "pl" | "en";
  device?: Device;
}

const MOBILE_BREAKPOINT = 768;
const TABLET_BREAKPOINT = 1024;

function deviceForWidth(width: number): Device {
  if (width < MOBILE_BREAKPOINT) return "mobile";
  if (width < TABLET_BREAKPOINT) return "tablet";
  return "desktop";
}

function detectViewportDevice(): Device {
  if (typeof window === "undefined") return "desktop";
  return deviceForWidth(window.innerWidth);
}

// Debug-only overlay rules. Injected ONCE per page (by the primary renderer) and
// ONLY while debug is active - everything functional/responsive now lives in the
// global stylesheet (see styles.css → "Builder public renderer"). Kept inline
// because it is a dev affordance that should add zero bytes to a normal page.
const DEBUG_OVERLAY_CSS = `
[data-builder-renderer][data-debug="1"] [data-sec-id]{outline:2px solid rgba(239,68,68,.9) !important;outline-offset:-2px;position:relative;}
[data-builder-renderer][data-debug="1"] [data-sec-id]::before{content:"SECTION " attr(data-sec-id) " · " attr(data-debug-h) "px";position:absolute;top:0;left:0;background:rgba(239,68,68,.95);color:#fff;font:600 10px/1.4 ui-monospace,monospace;padding:2px 6px;z-index:9999;pointer-events:none;}
[data-builder-renderer][data-debug="1"] [data-column-slot]{outline:1px dashed rgba(59,130,246,.9) !important;outline-offset:-1px;position:relative;}
[data-builder-renderer][data-debug="1"] [data-col-id]{outline:1px dashed rgba(16,185,129,.9) !important;outline-offset:-1px;position:relative;}
[data-builder-renderer][data-debug="1"] [data-col-id]::before{content:"COL " attr(data-col-id) " · " attr(data-debug-h) "px";position:absolute;top:0;right:0;background:rgba(16,185,129,.95);color:#fff;font:600 10px/1.4 ui-monospace,monospace;padding:1px 5px;z-index:9999;pointer-events:none;}
[data-builder-renderer][data-debug="1"] [data-widget-id]{outline:1px solid rgba(234,179,8,.95) !important;outline-offset:-1px;position:relative;}
[data-builder-renderer][data-debug="1"] [data-widget-id]::after{content:attr(data-debug-type) " · " attr(data-debug-h) "px";position:absolute;bottom:0;left:0;background:rgba(234,179,8,.95);color:#111;font:600 10px/1.4 ui-monospace,monospace;padding:1px 5px;z-index:9999;pointer-events:none;}
`;

export function BuilderRenderer({ doc, lang, device }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [viewportDevice, setViewportDevice] = useState<Device>(() => device ?? detectViewportDevice());
  // Debug state is shared across every BuilderRenderer on the page; only the
  // "primary" instance renders the overlay (toggle + debug CSS) - see builderDebug.
  const { debug, isPrimary } = useBuilderDebug();

  useIsomorphicLayoutEffect(() => {
    if (device) {
      setViewportDevice(device);
      return;
    }
    const el = rootRef.current;
    // Prefer container width (handles being rendered inside a 390px canvas
    // preview frame in the admin). Fall back to window width.
    const measure = () => {
      const w = el?.clientWidth && el.clientWidth > 0 ? el.clientWidth : window.innerWidth;
      setViewportDevice(deviceForWidth(w));
    };
    measure();
    let ro: ResizeObserver | null = null;
    if (el && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    }
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [device]);

  const effectiveDevice = device ?? viewportDevice;

  return (
    <UsedPostIdsProvider>
      <div ref={rootRef} data-builder-renderer data-debug={debug ? "1" : "0"} data-device={effectiveDevice}>
        <SectionsList sections={doc.sections} lang={lang} device={effectiveDevice} />
      </div>
      {isPrimary && <BuilderDebugOverlay debug={debug} doc={doc} />}
    </UsedPostIdsProvider>
  );
}

// Single, page-wide debug overlay owned by the primary renderer. The toggle is a
// dev affordance: it only appears in dev or when debug was explicitly enabled
// (e.g. `?debug=1`), so production visitors never see it. The height-annotation
// loop runs once and labels every renderer on the page.
function BuilderDebugOverlay({ debug, doc }: { debug: boolean; doc: BuilderDocument }) {
  useEffect(() => {
    if (!import.meta.env.DEV || !debug || typeof window === "undefined") return;
    const annotate = () => {
      document.querySelectorAll<HTMLElement>(
        "[data-builder-renderer] [data-sec-id], [data-builder-renderer] [data-col-id], [data-builder-renderer] [data-widget-id]",
      ).forEach((el) => {
        el.setAttribute("data-debug-h", String(Math.round(el.getBoundingClientRect().height)));
      });
    };
    annotate();
    const id = window.setInterval(annotate, 500);
    window.addEventListener("resize", annotate);
    return () => { window.clearInterval(id); window.removeEventListener("resize", annotate); };
  }, [debug, doc]);

  // The debug overlay (CSS + toggle) is a DEV-only affordance. Gating the whole
  // output behind import.meta.env.DEV means the CSS string and the button
  // tree-shake out of production builds entirely - they can never reach a
  // visitor, even via ?debug=1. (The functional/responsive CSS lives in the
  // global stylesheet, so production layout is unaffected.)
  if (!import.meta.env.DEV) return null;
  return (
    <>
      {debug && <style dangerouslySetInnerHTML={{ __html: DEBUG_OVERLAY_CSS }} />}
      <button
        type="button"
        className="builder-debug-toggle"
        data-on={debug ? "1" : "0"}
        onClick={toggleBuilderDebug}
      >
        {debug ? "Debug: ON" : "Debug: OFF"}
      </button>
    </>
  );
}

const SectionsList = memo(function SectionsList({ sections, lang, device }: { sections: SectionNode[]; lang: "pl"|"en"; device: Device }) {
  const accessCtx = useAccessContext();
  return (
    <>
      {sections
        .filter((s) => evaluateAccess(s.advanced?.access, accessCtx))
        .map((s) => (
          <RenderErrorBoundary key={s.id} label={`section:${s.id}`}>
            <RenderSection section={s} lang={lang} device={device} />
          </RenderErrorBoundary>
        ))}
    </>
  );
});

SectionsList.displayName = "SectionsList";

const RenderSection = memo(function RenderSection({ section, lang, device }: { section: SectionNode; lang: "pl"|"en"; device: Device }) {
  const accessCtx = useAccessContext();
  const visibleCols = (section.children ?? []).filter((c): c is NonNullable<typeof c> => !!c && evaluateAccess(c.advanced?.access, accessCtx));
  const colsSum = visibleCols.reduce((a, c) => a + (c.kind === "column" ? resolveSpan(c.span, device, 12) : 12), 0) || 12;
  const Tag = (section.layout?.htmlTag ?? "section") as ElementType;
  const bgStyle = backgroundLayerStyle(section.background);
  const wrapStyle: CSSProperties = {
    ...sectionWrapperStyle(section),
    ...bgStyle,
    ...borderStyle(section.border),
    ...typographyAlign(section.typography, device),
  };
  const typoCss = typographyCss(section.id, section.typography);
  const videoUrl = section.background?.type === "video" ? safeImageUrl(section.background.videoUrl) || section.background.videoUrl : "";
  const preloadRef = useSectionPreload(section, lang);

  return (
    <Tag
      ref={preloadRef as React.Ref<HTMLElement>}
      id={sanitizeHtmlId(section.advanced?.htmlId)}
      data-sec-id={section.id}
      className={`min-w-0 max-w-full overflow-hidden ${sanitizeCssClass(section.advanced?.cssClass) ?? ""}`.trim()}
      style={wrapStyle}
    >
      {section.background?.type === "video" && videoUrl && (
        <video
          src={videoUrl} autoPlay muted loop playsInline
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", zIndex: 0 }}
        />
      )}
      <div style={overlayLayerStyle(section.overlay)} aria-hidden />
      <ShapeDivider s={section.shapeDividerTop} position="top" />
      <ShapeDivider s={section.shapeDividerBottom} position="bottom" />
      <div style={sectionContainerStyle(section)}>
        <div data-columns-row className="min-w-0 max-w-full overflow-hidden" style={{ ...columnsRowStyle(section, colsSum), gridTemplateColumns: device === "mobile" ? "minmax(0, 1fr)" : columnsRowStyle(section, colsSum).gridTemplateColumns }}>
          {visibleCols.map((c) => {
            const span = c.kind === "column" ? resolveSpan(c.span, device, 12) : 12;
            const gridColumn = device === "mobile" ? "1 / -1" : `span ${span}`;
            return (
              <div key={c.id} data-column-slot className="min-w-0 max-w-full overflow-hidden" style={{ gridColumn }}>
                {c.kind === "inner-section"
                  ? <RenderInner inner={c} lang={lang} device={device} />
                  : <RenderColumn column={c} lang={lang} device={device} />}
              </div>
            );
          })}

        </div>
      </div>
      {typoCss && <style dangerouslySetInnerHTML={{ __html: typoCss }} />}
    </Tag>
  );
});

RenderSection.displayName = "RenderSection";

const RenderInner = memo(function RenderInner({ inner, lang, device }: { inner: InnerSectionNode; lang: "pl"|"en"; device: Device }) {
  const colsSum = inner.columns.reduce((a, c) => a + resolveSpan(c.span, device, 6), 0) || 12;
  return (
    <div className={`min-w-0 max-w-full overflow-hidden ${sanitizeCssClass(inner.advanced?.cssClass) ?? ""}`.trim()} style={{ ...sectionWrapperStyle(inner), ...backgroundLayerStyle(inner.background), ...borderStyle(inner.border), padding: `${INNER_SECTION_SAFE_AREA_PX}px` }}>
      <div data-columns-row className="min-w-0 max-w-full overflow-hidden" style={{ ...columnsRowStyle(inner, colsSum), gridTemplateColumns: device === "mobile" ? "minmax(0, 1fr)" : columnsRowStyle(inner, colsSum).gridTemplateColumns }}>
        {inner.columns.map((c) => (
          <div key={c.id} data-column-slot className="min-w-0 max-w-full overflow-hidden" style={{ gridColumn: device === "mobile" ? "1 / -1" : `span ${resolveSpan(c.span, device, 6)}` }}>

            <RenderColumn column={c} lang={lang} device={device} />
          </div>
        ))}
      </div>
    </div>
  );
});

RenderInner.displayName = "RenderInner";

const RenderColumn = memo(function RenderColumn({ column, lang, device }: { column: ColumnNode; lang: "pl"|"en"; device: Device }) {
  const va = column.verticalAlign ?? "start";
  const accessCtx = useAccessContext();
  const visibleChildren = column.children.filter(
    (w) => !hiddenOnDevice(w.advanced, device) && evaluateAccess(w.advanced?.access, accessCtx),
  );
  const isToolbar =
    visibleChildren.length > 1 &&
    visibleChildren.every((w) => COMPACT_WIDGET_TYPES.has(w.type) || AUTO_SIZE_WIDGETS.has(w.type));
  const axisClass = isToolbar
    ? (column.contentAlign === "center" ? "justify-center" : column.contentAlign === "end" ? "justify-end" : column.contentAlign === "start" ? "justify-start" : "justify-between")
    : (column.contentAlign === "center" ? "items-center" : column.contentAlign === "end" ? "items-end" : column.contentAlign === "start" ? "items-start" : "items-stretch");
  const vClass = isToolbar
    ? (va === "center" ? "content-center items-center" : va === "end" ? "content-end items-end" : va === "stretch" ? "content-stretch items-stretch" : "content-start items-center")
    : (va === "center" ? "justify-center" : va === "end" ? "justify-end" : va === "stretch" ? "justify-stretch" : "justify-start");

  // Group consecutive widgets sharing inline flow into one row.
  const groups: Array<{ inline: boolean; items: typeof visibleChildren }> = [];
  if (isToolbar) {
    groups.push({ inline: true, items: visibleChildren });
  } else {
    for (const w of visibleChildren) {
      const inline = w.advanced?.layout === "inline";
      const last = groups[groups.length - 1];
      if (inline && last && last.inline) last.items.push(w);
      else groups.push({ inline, items: [w] });
    }
  }
  const onlyOneBlock = !isToolbar && groups.length === 1 && !groups[0].inline && groups[0].items.length === 1;

  return (
    <div data-col-id={column.id} className={`flex flex-col gap-2 min-w-0 max-w-full overflow-visible ${axisClass} ${vClass} ${sanitizeCssClass(column.advanced?.cssClass) ?? ""}`.trim()} style={{ padding: `${COLUMN_SAFE_AREA_PX}px`, boxSizing: "border-box", minHeight: column.style?.minHeight, background: column.style?.bgColor, color: column.style?.textColor, borderRadius: column.style?.borderRadius }}>
      {groups.map((g, gi) => {
        const renderItem = (w: typeof visibleChildren[number], inRow: boolean) => {
          const adv = w.advanced as { height?: { desktop?: unknown; tablet?: unknown; mobile?: unknown } } | undefined;
          const hasExplicitHeight = !!(adv?.height && (adv.height.desktop ?? adv.height.tablet ?? adv.height.mobile));
          const shouldFillHeight =
            onlyOneBlock && !hasExplicitHeight && !AUTO_SIZE_WIDGETS.has(w.type) && !COMPACT_WIDGET_TYPES.has(w.type);
          const frameStyle = getWidgetFrameStyle(w, device);
          // Section labels must visually sit ABOVE neighbouring widgets so their
          // accent lines / ribbons are never covered by adjacent backgrounds.
          const isSectionLabel = w.type === "section-label";
          const stackCls = isSectionLabel ? " relative z-20" : "";
          const itemClass = inRow
            ? `flex flex-col items-stretch justify-center min-w-0 max-w-full overflow-visible${stackCls}`
            : `flex flex-col items-stretch justify-start w-full min-w-0 max-w-full overflow-visible${shouldFillHeight ? " flex-1" : ""}${stackCls}`;
          return (
            <div
              key={w.id}
              data-widget-id={w.id}
              data-widget-layout={inRow ? "inline" : "block"}
              data-debug-type={w.type}
              className={itemClass}
              style={{
                ...frameStyle,
                ...(inRow
                  ? null
                  : {
                      width: frameStyle.width === "auto" ? "100%" : frameStyle.width,
                      maxWidth: "100%",
                      alignSelf: "stretch",
                      justifySelf: "stretch",
                      // Unified vertical rhythm: column gap is the only source of vertical spacing
                      // between widgets. Preserve "auto" margins (used by selfAlign center/start/end),
                      // but always strip numeric per-widget top/bottom margins.
                      marginTop: frameStyle.marginTop === "auto" ? "auto" : 0,
                      marginBottom: frameStyle.marginBottom === "auto" ? "auto" : 0,
                    }),
                boxSizing: "border-box",
              }}
            >
              <RenderErrorBoundary label={`widget:${w.type}:${w.id}`}>
                <WidgetView node={w} lang={lang} device={device} />
              </RenderErrorBoundary>
            </div>
          );
        };
        if (g.inline) {
          return (
            <div key={gi} className={`flex flex-row flex-wrap items-center gap-2 min-w-0 max-w-full ${axisClass}`}>
              {g.items.map((w) => renderItem(w, true))}
            </div>
          );
        }
        return <Fragment key={gi}>{g.items.map((w) => renderItem(w, false))}</Fragment>;
      })}
    </div>
  );
});

RenderColumn.displayName = "RenderColumn";


