// Read-only renderer for public pages. Applies all Section settings
// (layout, background layers, overlay, border, shape dividers, typography).
import {
  Fragment,
  createContext,
  memo,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from "react";
import type {
  BuilderDocument,
  SectionNode,
  ColumnNode,
  InnerSectionNode,
  Device,
  ResponsiveValue,
} from "@/lib/builder/types";
import {
  WidgetView,
  getWidgetFrameStyle,
  hiddenOnDevice,
} from "@/components/admin/builder/WidgetView";
import {
  AUTO_SIZE_WIDGETS,
  COMPACT_WIDGET_TYPES,
} from "@/components/admin/builder/ui/organisms/widget-view/frame";
import { RenderErrorBoundary } from "@/components/admin/builder/ui/organisms/widget-view/RenderErrorBoundary";
import { sanitizeHtmlId, sanitizeCssClass, safeImageUrl, hardenStyleCss } from "@/lib/sanitize";
import {
  sectionWrapperStyle,
  sectionContainerStyle,
  columnsRowStyle,
  backgroundLayerStyle,
  overlayLayerStyle,
  borderStyle,
  ShapeDivider,
  typographyCss,
  typographyAlign,
  INNER_SECTION_SAFE_AREA_PX,
  COLUMN_SAFE_AREA_PX,
} from "@/lib/builder/sectionStyles";
import { UsedPostIdsProvider } from "@/lib/builder/usedPostIds";
import { SectionTabsBar } from "@/components/admin/builder/ui/molecules/SectionTabsBar";
import { evaluateAccess, useAccessContext } from "@/lib/builder/accessControl";
import { useSectionPreload } from "@/lib/builder/useSectionPreload";
import { useBuilderDebug, toggleBuilderDebug } from "@/lib/builder/builderDebug";
import { safeParseBuilderDoc, isKnownWidgetType } from "@/lib/builder/schema";
import { ABOVE_FOLD_SECTION_COUNT } from "@/lib/builder/prefetch";
import { StreamingSection } from "@/lib/builder/sectionStreaming";
import {
  isSectionVisibleForAssignments,
  recordExperimentEvent,
  useExperimentAssignments,
  type AbVariant,
} from "@/lib/builder/experiments";

// SSR has no viewport, so the first render is "desktop". On a phone the client
// must correct to "mobile" - running that correction in a *layout* effect lands
// it synchronously before the browser paints, so the user never sees a
// desktop->mobile flash and the (mobile-only) re-render is imperceptible.
// useLayoutEffect warns under SSR, so fall back to useEffect there (it never
// runs on the server anyway).
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

function resolveSpan(
  span: ResponsiveValue<number> | undefined,
  device: Device,
  deskDefault: number,
): number {
  if (device === "mobile") return span?.mobile ?? 12;
  if (device === "tablet") return span?.tablet ?? span?.desktop ?? deskDefault;
  return span?.desktop ?? deskDefault;
}

function resolveOrder(
  order: ResponsiveValue<number> | undefined,
  device: Device,
): number | undefined {
  if (!order) return undefined;
  if (device === "mobile") return order.mobile ?? undefined;
  if (device === "tablet") return order.tablet ?? order.desktop ?? undefined;
  return order.desktop ?? undefined;
}

interface Props {
  doc: BuilderDocument;
  lang: "pl" | "en";
  device?: Device;
  /**
   * Suspense-stream below-the-fold sections instead of rendering the whole
   * document into the SSR shell. Off by default (chrome / admin previews render
   * eagerly); the public content + homepage routes opt in to keep cold-render
   * TTFB flat as documents grow. See lib/builder/sectionStreaming.
   */
  stream?: boolean;
  /** Leading sections rendered eagerly above the fold when `stream` is on. */
  aboveFoldCount?: number;
  /**
   * Builder-canvas mode: show every A/B variant side by side (with badges)
   * instead of bucketing the viewer, and never record experiment events.
   */
  editorPreview?: boolean;
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

export function BuilderRenderer({
  doc,
  lang,
  device,
  stream = false,
  aboveFoldCount = ABOVE_FOLD_SECTION_COUNT,
  editorPreview = false,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [viewportDevice, setViewportDevice] = useState<Device>(
    () => device ?? detectViewportDevice(),
  );
  const safeDoc = safeParseBuilderDoc(doc);
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
      <div
        ref={rootRef}
        data-builder-renderer
        data-debug={debug ? "1" : "0"}
        data-device={effectiveDevice}
      >
        <SectionsList
          sections={safeDoc.sections}
          lang={lang}
          device={effectiveDevice}
          stream={stream}
          aboveFoldCount={aboveFoldCount}
          editorPreview={editorPreview}
        />
      </div>
      {isPrimary && <BuilderDebugOverlay debug={debug} doc={safeDoc} />}
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
      document
        .querySelectorAll<HTMLElement>(
          "[data-builder-renderer] [data-sec-id], [data-builder-renderer] [data-col-id], [data-builder-renderer] [data-widget-id]",
        )
        .forEach((el) => {
          el.setAttribute("data-debug-h", String(Math.round(el.getBoundingClientRect().height)));
        });
    };
    annotate();
    const id = window.setInterval(annotate, 500);
    window.addEventListener("resize", annotate);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("resize", annotate);
    };
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

const SectionsList = memo(function SectionsList({
  sections,
  lang,
  device,
  stream,
  aboveFoldCount,
  editorPreview,
}: {
  sections: SectionNode[];
  lang: "pl" | "en";
  device: Device;
  stream: boolean;
  aboveFoldCount: number;
  editorPreview: boolean;
}) {
  const accessCtx = useAccessContext();
  const safeSections = Array.isArray(sections) ? sections : [];
  // A/B: bucket the visitor deterministically per experiment (client-side, so
  // SSR + first client render always show variant A - no hydration mismatch).
  // The builder canvas keeps every variant visible instead.
  const assignments = useExperimentAssignments(safeSections, !editorPreview);
  const visible = safeSections.filter(
    (s): s is SectionNode =>
      !!s &&
      evaluateAccess(s.advanced?.access, accessCtx) &&
      (editorPreview || isSectionVisibleForAssignments(s, assignments)),
  );
  return (
    <>
      {visible.map((s, index) => {
        const abTag = s.advanced?.abTest;
        const rendered = (
          <RenderErrorBoundary label={`section:${s.id}`}>
            <RenderSection section={s} lang={lang} device={device} />
          </RenderErrorBoundary>
        );
        return (
          <StreamingSection
            key={s.id}
            section={s}
            lang={lang}
            index={index}
            aboveFoldCount={aboveFoldCount}
            enabled={stream}
          >
            {abTag && !editorPreview && assignments ? (
              <ExperimentSection experimentId={abTag.experimentId} variant={abTag.variant}>
                {rendered}
              </ExperimentSection>
            ) : (
              rendered
            )}
          </StreamingSection>
        );
      })}
    </>
  );
});

SectionsList.displayName = "SectionsList";

/**
 * Tracking envelope for the A/B variant actually shown to this visitor:
 * exposure once per session on mount, conversion once per session on any
 * click inside the variant. `display: contents` keeps it out of layout.
 */
function ExperimentSection({
  experimentId,
  variant,
  children,
}: {
  experimentId: string;
  variant: AbVariant;
  children: React.ReactNode;
}) {
  useEffect(() => {
    recordExperimentEvent(experimentId, variant, "exposure");
  }, [experimentId, variant]);
  return (
    <div
      style={{ display: "contents" }}
      onClickCapture={() => recordExperimentEvent(experimentId, variant, "conversion")}
    >
      {children}
    </div>
  );
}

/**
 * Decorative section background video. Keeps autoplay semantics (no visual
 * change), but preloads only metadata and pauses playback whenever the section
 * leaves the viewport - offscreen background videos were silently burning
 * bandwidth, decode time and battery on long builder pages.
 */
function SectionBackgroundVideo({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            void el.play().catch(() => undefined);
          } else {
            el.pause();
          }
        }
      },
      { rootMargin: "200px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <video
      ref={ref}
      src={src}
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        zIndex: 0,
      }}
    />
  );
}

const RenderSection = memo(function RenderSection({
  section,
  lang,
  device,
}: {
  section: SectionNode;
  lang: "pl" | "en";
  device: Device;
}) {
  const accessCtx = useAccessContext();
  const tabsCfg = section.tabs;
  const tabsEnabled = !!(tabsCfg?.enabled && tabsCfg.items && tabsCfg.items.length > 0);
  const firstTabId = tabsEnabled ? tabsCfg!.items[0].id : "";
  const initialTabId =
    tabsEnabled && tabsCfg!.defaultTabId && tabsCfg!.items.some((t) => t.id === tabsCfg!.defaultTabId)
      ? tabsCfg!.defaultTabId
      : firstTabId;
  const [activeTabId, setActiveTabId] = useState<string>(initialTabId);
  // If tab list changes (add/remove/rename), keep active id valid.
  useEffect(() => {
    if (!tabsEnabled) return;
    const ids = tabsCfg!.items.map((t) => t.id);
    if (!ids.includes(activeTabId)) {
      setActiveTabId(ids[0] ?? "");
    }
  }, [tabsEnabled, tabsCfg, activeTabId]);

  const allChildren = (Array.isArray(section.children) ? section.children : []).filter(
    (c): c is ColumnNode | InnerSectionNode => !!c && evaluateAccess(c.advanced?.access, accessCtx),
  );
  const visibleCols = tabsEnabled
    ? allChildren.filter((c) => !c.tabId || c.tabId === activeTabId)
    : allChildren;
  const colsSum =
    visibleCols.reduce(
      (a, c) => a + (c.kind === "column" ? resolveSpan(c.span, device, 12) : 12),
      0,
    ) || 12;
  const Tag = (section.layout?.htmlTag ?? "section") as ElementType;
  const bgStyle = backgroundLayerStyle(section.background);
  const wrapStyle: CSSProperties = {
    ...sectionWrapperStyle(section),
    ...bgStyle,
    ...borderStyle(section.border),
    ...typographyAlign(section.typography, device),
  };
  const typoCss = typographyCss(section.id, section.typography);
  const videoUrl =
    section.background?.type === "video"
      ? safeImageUrl(section.background.videoUrl) || section.background.videoUrl
      : "";
  const preloadRef = useSectionPreload(section, lang);

  return (
    <Tag
      ref={preloadRef as React.Ref<HTMLElement>}
      id={sanitizeHtmlId(section.advanced?.htmlId)}
      data-sec-id={section.id}
      data-ab-experiment={section.advanced?.abTest?.experimentId}
      data-ab-variant={section.advanced?.abTest?.variant}
      className={`min-w-0 max-w-full overflow-hidden ${sanitizeCssClass(section.advanced?.cssClass) ?? ""}`.trim()}
      style={wrapStyle}
    >
      {section.background?.type === "video" && videoUrl && (
        <SectionBackgroundVideo src={videoUrl} />
      )}
      <div style={overlayLayerStyle(section.overlay)} aria-hidden />
      <ShapeDivider s={section.shapeDividerTop} position="top" />
      <ShapeDivider s={section.shapeDividerBottom} position="bottom" />
      <div style={sectionContainerStyle(section)}>
        {tabsEnabled && (tabsCfg!.orientation ?? "horizontal") === "horizontal" && (
          <div style={{ marginBottom: 16 }}>
            <SectionTabsBar
              sectionId={section.id}
              tabs={tabsCfg!}
              lang={lang}
              activeId={activeTabId}
              onSelect={setActiveTabId}
            />
          </div>
        )}
        <div
          style={
            tabsEnabled && (tabsCfg!.orientation ?? "horizontal") === "vertical"
              ? { display: "flex", gap: 20, alignItems: "flex-start" }
              : undefined
          }
        >
          {tabsEnabled && (tabsCfg!.orientation ?? "horizontal") === "vertical" && (
            <SectionTabsBar
              sectionId={section.id}
              tabs={tabsCfg!}
              lang={lang}
              activeId={activeTabId}
              onSelect={setActiveTabId}
            />
          )}
          <div
            data-columns-row
            data-section-tab-panel={tabsEnabled ? activeTabId : undefined}
            role={tabsEnabled ? "tabpanel" : undefined}
            id={tabsEnabled ? `sec-${section.id}-panel-${activeTabId}` : undefined}
            aria-labelledby={tabsEnabled ? `sec-${section.id}-tab-${activeTabId}` : undefined}
            className="min-w-0 max-w-full overflow-hidden"
            style={{
              ...columnsRowStyle(section, colsSum),
              gridTemplateColumns:
                device === "mobile"
                  ? "minmax(0, 1fr)"
                  : columnsRowStyle(section, colsSum).gridTemplateColumns,
              flex: tabsEnabled && (tabsCfg!.orientation ?? "horizontal") === "vertical" ? 1 : undefined,
            }}
          >
            {visibleCols.map((c) => {
              const span = c.kind === "column" ? resolveSpan(c.span, device, 12) : 12;
              const gridColumn = device === "mobile" ? "1 / -1" : `span ${span}`;
              const order = c.kind === "column" ? resolveOrder(c.order, device) : undefined;
              return (
                <div
                  key={c.id}
                  data-column-slot
                  data-col-id={c.id}
                  className="min-w-0 max-w-full overflow-hidden"
                  style={{ gridColumn, ...(order !== undefined ? { order } : {}) }}
                >
                  {c.kind === "inner-section" ? (
                    <RenderInner inner={c} lang={lang} device={device} />
                  ) : (
                    <RenderColumn column={c} lang={lang} device={device} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {(() => {
        const mobileOrderCss = visibleCols
          .filter(
            (c): c is ColumnNode => c.kind === "column" && typeof c.order?.mobile === "number",
          )
          .map(
            (c) =>
              `[data-sec-id="${section.id}"] [data-col-id="${c.id}"]{order:${c.order!.mobile};}`,
          )
          .join("");
        return mobileOrderCss ? (
          <style
            dangerouslySetInnerHTML={{
              __html: hardenStyleCss(`@media (max-width: 767px){${mobileOrderCss}}`),
            }}
          />
        ) : null;
      })()}
      {typoCss && <style dangerouslySetInnerHTML={{ __html: hardenStyleCss(typoCss) }} />}
    </Tag>
  );
});

RenderSection.displayName = "RenderSection";

const RenderInner = memo(function RenderInner({
  inner,
  lang,
  device,
}: {
  inner: InnerSectionNode;
  lang: "pl" | "en";
  device: Device;
}) {
  const columns = (Array.isArray(inner.columns) ? inner.columns : []).filter(
    (c): c is ColumnNode => !!c,
  );
  const colsSum = columns.reduce((a, c) => a + resolveSpan(c.span, device, 6), 0) || 12;
  return (
    <div
      className={`min-w-0 max-w-full overflow-hidden ${sanitizeCssClass(inner.advanced?.cssClass) ?? ""}`.trim()}
      style={{
        ...sectionWrapperStyle(inner),
        ...backgroundLayerStyle(inner.background),
        ...borderStyle(inner.border),
        padding: `${INNER_SECTION_SAFE_AREA_PX}px`,
      }}
    >
      <div
        data-columns-row
        className="min-w-0 max-w-full overflow-hidden"
        style={{
          ...columnsRowStyle(inner, colsSum),
          gridTemplateColumns:
            device === "mobile"
              ? "minmax(0, 1fr)"
              : columnsRowStyle(inner, colsSum).gridTemplateColumns,
        }}
      >
        {columns.map((c) => (
          <div
            key={c.id}
            data-column-slot
            className="min-w-0 max-w-full overflow-hidden"
            style={{
              gridColumn: device === "mobile" ? "1 / -1" : `span ${resolveSpan(c.span, device, 6)}`,
            }}
          >
            <RenderColumn column={c} lang={lang} device={device} />
          </div>
        ))}
      </div>
    </div>
  );
});

RenderInner.displayName = "RenderInner";

const RenderColumn = memo(function RenderColumn({
  column,
  lang,
  device,
}: {
  column: ColumnNode;
  lang: "pl" | "en";
  device: Device;
}) {
  const va = column.verticalAlign ?? "start";
  const accessCtx = useAccessContext();
  const visibleChildren = (Array.isArray(column.children) ? column.children : []).filter(
    (w): w is NonNullable<typeof w> =>
      !!w &&
      isKnownWidgetType(w.type) &&
      !hiddenOnDevice(w.advanced, device) &&
      evaluateAccess(w.advanced?.access, accessCtx),
  );
  const isToolbar =
    visibleChildren.length > 1 &&
    visibleChildren.every((w) => COMPACT_WIDGET_TYPES.has(w.type) || AUTO_SIZE_WIDGETS.has(w.type));
  const axisClass = isToolbar
    ? column.contentAlign === "center"
      ? "justify-center"
      : column.contentAlign === "end"
        ? "justify-end"
        : column.contentAlign === "start"
          ? "justify-start"
          : "justify-between"
    : column.contentAlign === "center"
      ? "items-center"
      : column.contentAlign === "end"
        ? "items-end"
        : column.contentAlign === "start"
          ? "items-start"
          : "items-stretch";
  const vClass = isToolbar
    ? va === "center"
      ? "content-center items-center"
      : va === "end"
        ? "content-end items-end"
        : va === "stretch"
          ? "content-stretch items-stretch"
          : "content-start items-center"
    : va === "center"
      ? "justify-center"
      : va === "end"
        ? "justify-end"
        : va === "stretch"
          ? "justify-stretch"
          : "justify-start";

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
  const onlyOneBlock =
    !isToolbar && groups.length === 1 && !groups[0].inline && groups[0].items.length === 1;

  return (
    <div
      data-col-id={column.id}
      className={`flex flex-col gap-2 min-w-0 max-w-full overflow-visible ${axisClass} ${vClass} ${sanitizeCssClass(column.advanced?.cssClass) ?? ""}`.trim()}
      style={{
        padding: `${COLUMN_SAFE_AREA_PX}px`,
        boxSizing: "border-box",
        minHeight: column.style?.minHeight,
        background: column.style?.bgColor,
        color: column.style?.textColor,
        borderRadius: column.style?.borderRadius,
      }}
    >
      {groups.map((g, gi) => {
        const renderItem = (w: (typeof visibleChildren)[number], inRow: boolean) => {
          const adv = w.advanced as
            | { height?: { desktop?: unknown; tablet?: unknown; mobile?: unknown } }
            | undefined;
          const hasExplicitHeight = !!(
            adv?.height &&
            (adv.height.desktop ?? adv.height.tablet ?? adv.height.mobile)
          );
          const shouldFillHeight =
            onlyOneBlock &&
            !hasExplicitHeight &&
            !AUTO_SIZE_WIDGETS.has(w.type) &&
            !COMPACT_WIDGET_TYPES.has(w.type);
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
              data-widget-global={w.globalId ? "1" : undefined}
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
                <div className="relative w-full h-full">
                  {w.advanced?.link?.url && (
                    <a
                      href={w.advanced.link.url}
                      target={w.advanced.link.target ?? "_self"}
                      rel={
                        [
                          w.advanced.link.target === "_blank" ? "noopener noreferrer" : "",
                          w.advanced.link.nofollow ? "nofollow" : "",
                          w.advanced.link.rel ?? "",
                        ]
                          .filter(Boolean)
                          .join(" ") || undefined
                      }
                      aria-label={w.advanced.link.ariaLabel ?? undefined}
                      className="absolute inset-0 z-0"
                      data-widget-link="1"
                    >
                      <span className="sr-only">
                        {w.advanced.link.ariaLabel ??
                          w.advanced.link.refLabel ??
                          w.advanced.link.url}
                      </span>
                    </a>
                  )}
                  <div
                    className={
                      w.advanced?.link?.url
                        ? "relative z-10 pointer-events-none [&_a,&_button,&_input,&_select,&_textarea,&_video,&_audio,&_iframe,&_[role=button],&_[tabindex]]:pointer-events-auto"
                        : "contents"
                    }
                  >
                    <WidgetView node={w} lang={lang} device={device} />
                  </div>
                </div>
              </RenderErrorBoundary>
            </div>
          );
        };

        if (g.inline) {
          return (
            <div
              key={gi}
              className={`flex flex-row flex-wrap items-center gap-2 min-w-0 max-w-full ${axisClass}`}
            >
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
