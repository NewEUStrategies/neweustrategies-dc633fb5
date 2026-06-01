// Read-only renderer for public pages. Applies all Section settings
// (layout, background layers, overlay, border, shape dividers, typography).
import type { CSSProperties, ElementType } from "react";
import type { BuilderDocument, SectionNode, ColumnNode, InnerSectionNode, Device, ResponsiveValue } from "@/lib/builder/types";
import { WidgetView, getWidgetFrameStyle, hiddenOnDevice } from "@/components/admin/builder/WidgetView";
import { sanitizeHtmlId, sanitizeCssClass, safeImageUrl } from "@/lib/sanitize";
import {
  sectionWrapperStyle, sectionContainerStyle, columnsRowStyle,
  backgroundLayerStyle, overlayLayerStyle, borderStyle,
  ShapeDivider, typographyCss, typographyAlign,
  INNER_SECTION_SAFE_AREA_PX, COLUMN_SAFE_AREA_PX,
} from "@/lib/builder/sectionStyles";

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

export function BuilderRenderer({ doc, lang, device = "desktop" }: Props) {
  return (
    <div className="space-y-6">
      {doc.sections.map((s) => <RenderSection key={s.id} section={s} lang={lang} device={device} />)}
    </div>
  );
}

function RenderSection({ section, lang, device }: { section: SectionNode; lang: "pl"|"en"; device: Device }) {
  const colsSum = section.children.reduce((a, c) => a + (c.kind === "column" ? resolveSpan(c.span, device, 12) : 12), 0) || 12;
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

  return (
    <Tag
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
        <div className="min-w-0 max-w-full overflow-hidden" style={{ ...columnsRowStyle(section, colsSum), paddingTop: `${INNER_SECTION_SAFE_AREA_PX}px`, paddingBottom: `${INNER_SECTION_SAFE_AREA_PX}px` }}>
          {section.children.map((c) => {
            const span = c.kind === "column" ? resolveSpan(c.span, device, 12) : 12;
            return (
              <div key={c.id} className="min-w-0 max-w-full overflow-hidden" style={{ gridColumn: `span ${span}` }}>
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
}

function RenderInner({ inner, lang, device }: { inner: InnerSectionNode; lang: "pl"|"en"; device: Device }) {
  const colsSum = inner.columns.reduce((a, c) => a + resolveSpan(c.span, device, 6), 0) || 12;
  return (
    <div className={`min-w-0 max-w-full overflow-hidden ${sanitizeCssClass(inner.advanced?.cssClass) ?? ""}`.trim()} style={{ ...sectionWrapperStyle(inner), ...backgroundLayerStyle(inner.background), ...borderStyle(inner.border), padding: `${INNER_SECTION_SAFE_AREA_PX}px` }}>
      <div className="min-w-0 max-w-full overflow-hidden" style={columnsRowStyle(inner, colsSum)}>
        {inner.columns.map((c) => (
          <div key={c.id} className="min-w-0 max-w-full overflow-hidden" style={{ gridColumn: `span ${resolveSpan(c.span, device, 6)}` }}>

            <RenderColumn column={c} lang={lang} device={device} />
          </div>
        ))}
      </div>
    </div>
  );
}

function RenderColumn({ column, lang, device }: { column: ColumnNode; lang: "pl"|"en"; device: Device }) {
  const singleWidget = column.children.length <= 1;
  const va = column.verticalAlign ?? "start";
  const axisClass = singleWidget
    ? (column.contentAlign === "center" ? "items-center" : column.contentAlign === "end" ? "items-end" : column.verticalAlign === "stretch" ? "items-stretch" : "items-start")
    : (column.contentAlign === "center" ? "justify-center" : column.contentAlign === "end" ? "justify-end" : "justify-start");
  // Vertical alignment: in flex-col (single) we use justify-content;
  // in flex-row wrap (multi) we use align-content + items.
  const vClass = singleWidget
    ? (va === "center" ? "justify-center" : va === "end" ? "justify-end" : va === "stretch" ? "justify-stretch" : "justify-start")
    : (va === "center" ? "content-center items-center" : va === "end" ? "content-end items-end" : va === "stretch" ? "content-stretch items-stretch" : "content-start items-start");
  const layoutClass = singleWidget ? "flex-col" : "flex-row flex-wrap";
  return (
    <div data-col-id={column.id} className={`flex ${layoutClass} gap-2 h-full min-w-0 max-w-full overflow-hidden ${axisClass} ${vClass} ${sanitizeCssClass(column.advanced?.cssClass) ?? ""}`.trim()} style={{ padding: `${COLUMN_SAFE_AREA_PX}px`, boxSizing: "border-box", minHeight: 40 }}>
      {column.children.map((w) => {
        if (hiddenOnDevice(w.advanced, device)) return null;
        return (
          <div key={w.id} data-widget-id={w.id} className="flex flex-col items-stretch justify-start shrink min-w-0 max-w-full overflow-hidden" style={{ ...getWidgetFrameStyle(w, device), boxSizing: "border-box" }}>
            <WidgetView node={w} lang={lang} device={device} />
          </div>
        );
      })}
    </div>
  );
}

