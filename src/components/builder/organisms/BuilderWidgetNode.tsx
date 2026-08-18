// Single-widget render node, extracted from BuilderRenderer's RenderColumn so
// each widget can be memoized independently. This is a pure presentational
// wrapper: it owns no state and changes behavior for nothing - it exists only
// to shrink the render surface of a single widget content/settings edit so a
// column with N widgets doesn't re-render all N whenever one changes.
import { memo, useCallback, useMemo, type CSSProperties } from "react";
import type { Device, WidgetNode } from "@/lib/builder/types";
import { WidgetView, getWidgetFrameStyle } from "@/components/builder/organisms/WidgetView";
import {
  AUTO_SIZE_WIDGETS,
  COMPACT_WIDGET_TYPES,
} from "@/components/builder/organisms/widget-view/frame";
import { RenderErrorBoundary } from "@/components/error/RenderErrorBoundary";
import { safeUrl } from "@/lib/sanitizePure";

interface BuilderWidgetNodeProps {
  widget: WidgetNode;
  lang: "pl" | "en";
  device: Device;
  /** True when this widget sits inline in a wrap-row with siblings. */
  inRow: boolean;
  /** True when this widget is the column's only content block. */
  onlyOneBlock: boolean;
  /** Present only when the surrounding canvas supports inline editing. */
  onContentChange?: (widgetId: string, key: string, value: string | number) => void;
}

/** Shallow key/value equality - good enough for the flat `content`/`settings`
 * records builder widgets use; nested objects fall back to reference equality,
 * which is fine here because widget authors always replace nested objects
 * wholesale on edit (immutable update pattern used across the builder). */
function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  const aRec = a as Record<string, unknown>;
  const bRec = b as Record<string, unknown>;
  const aKeys = Object.keys(aRec);
  const bKeys = Object.keys(bRec);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (aRec[key] !== bRec[key]) return false;
  }
  return true;
}

function widgetsEqual(prev: WidgetNode, next: WidgetNode): boolean {
  if (prev === next) return true;
  if (prev.id !== next.id || prev.type !== next.type) return false;
  // `updatedAt` identifies the persisted revision, not every local builder
  // mutation. Property controls update `content` optimistically before save,
  // so treating an unchanged timestamp as equality freezes the canvas until a
  // reload. Always compare the editable records as the source of truth.
  return (
    shallowEqual(prev.content, next.content) &&
    shallowEqual(prev.style, next.style) &&
    shallowEqual(prev.advanced, next.advanced) &&
    prev.globalId === next.globalId
  );
}

export const BuilderWidgetNode = memo(
  function BuilderWidgetNode({
    widget: w,
    lang,
    device,
    inRow,
    onlyOneBlock,
    onContentChange,
  }: BuilderWidgetNodeProps) {
    const { itemClass, style } = useMemo(() => {
      const adv = w.advanced as
        | {
            height?: number | "auto" | { desktop?: unknown; tablet?: unknown; mobile?: unknown };
          }
        | undefined;
      const responsiveHeight =
        adv?.height && typeof adv.height === "object"
          ? (adv.height[device] ?? adv.height.desktop ?? adv.height.tablet ?? adv.height.mobile)
          : adv?.height;
      const hasExplicitHeight = typeof responsiveHeight === "number";
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
      const computedItemClass = inRow
        ? `flex flex-col items-stretch justify-center min-w-0 max-w-full overflow-visible${stackCls}`
        : `flex flex-col items-stretch justify-start w-full min-w-0 max-w-full overflow-visible${shouldFillHeight ? " flex-1" : ""}${stackCls}`;
      const computedStyle: CSSProperties = {
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
        // When user picks a fixed pixel height, it must win over any
        // flex-basis/flex-grow inherited from frameStyle (parent column
        // is display:flex → flex-basis becomes the main-axis size and
        // otherwise silently overrides `height`).
        ...(hasExplicitHeight
          ? {
              height: responsiveHeight as number,
              minHeight: responsiveHeight as number,
              maxHeight: responsiveHeight as number,
              flexBasis: "auto",
              flexGrow: 0,
              flexShrink: 0,
            }
          : null),
        boxSizing: "border-box",
      };
      return { itemClass: computedItemClass, style: computedStyle };
    }, [w, device, inRow, onlyOneBlock]);

    const adv = w.advanced as
      | { height?: number | "auto" | { desktop?: unknown; tablet?: unknown; mobile?: unknown } }
      | undefined;
    const responsiveHeightForData =
      adv?.height && typeof adv.height === "object"
        ? (adv.height[device] ?? adv.height.desktop ?? adv.height.tablet ?? adv.height.mobile)
        : adv?.height;
    const hasExplicitHeight = typeof responsiveHeightForData === "number";

    const handleContentChange = useCallback(
      (key: string, value: string | number) => onContentChange?.(w.id, key, value),
      [onContentChange, w.id],
    );

    return (
      <div
        data-widget-id={w.id}
        data-widget-explicit-height={hasExplicitHeight ? "true" : undefined}
        data-widget-layout={inRow ? "inline" : "block"}
        data-widget-global={w.globalId ? "1" : undefined}
        data-debug-type={w.type}
        className={itemClass}
        style={style}
      >
        <RenderErrorBoundary label={`widget:${w.type}:${w.id}`}>
          <div className="relative w-full h-full">
            {w.advanced?.link?.url && (
              <a
                href={safeUrl(w.advanced.link.url)}
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
                  {w.advanced.link.ariaLabel ?? w.advanced.link.refLabel ?? w.advanced.link.url}
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
              <WidgetView
                node={w}
                lang={lang}
                device={device}
                editable={!!onContentChange}
                onContentChange={onContentChange ? handleContentChange : undefined}
              />
            </div>
          </div>
        </RenderErrorBoundary>
      </div>
    );
  },
  function areEqual(prev, next) {
    return (
      prev.lang === next.lang &&
      prev.device === next.device &&
      prev.inRow === next.inRow &&
      prev.onlyOneBlock === next.onlyOneBlock &&
      prev.onContentChange === next.onContentChange &&
      widgetsEqual(prev.widget, next.widget)
    );
  },
);

BuilderWidgetNode.displayName = "BuilderWidgetNode";
