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
    <div>
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
        <div className="min-w-0 max-w-full overflow-hidden" style={columnsRowStyle(section, colsSum)}>
          {section.children.map((c) => {
            const span = c.kind === "column" ? resolveSpan(c.span, device, 12) : 12;
            const gridColumn = device === "mobile" ? "1 / -1" : `span ${span}`;
            return (
              <div key={c.id} className="min-w-0 max-w-full overflow-hidden" style={{ gridColumn }}>
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
          <div key={c.id} className="min-w-0 max-w-full overflow-hidden" style={{ gridColumn: device === "mobile" ? "1 / -1" : `span ${resolveSpan(c.span, device, 6)}` }}>

            <RenderColumn column={c} lang={lang} device={device} />
          </div>
        ))}
      </div>
    </div>
  );
}

function RenderColumn({ column, lang, device }: { column: ColumnNode; lang: "pl"|"en"; device: Device }) {
  const va = column.verticalAlign ?? "start";
  const axisClass = (column.contentAlign === "center" ? "items-center" : column.contentAlign === "end" ? "items-end" : column.contentAlign === "start" ? "items-start" : "items-stretch");
  const vClass = (va === "center" ? "justify-center" : va === "end" ? "justify-end" : va === "stretch" ? "justify-stretch" : "justify-start");
  const layoutClass = "flex-col";
  return (
    <div data-col-id={column.id} className={`flex ${layoutClass} gap-2 h-full min-w-0 max-w-full overflow-hidden ${axisClass} ${vClass} ${sanitizeCssClass(column.advanced?.cssClass) ?? ""}`.trim()} style={{ padding: `${COLUMN_SAFE_AREA_PX}px`, boxSizing: "border-box", minHeight: column.style?.minHeight, background: column.style?.bgColor, color: column.style?.textColor, borderRadius: column.style?.borderRadius }}>
      {column.children.map((w) => {
        if (hiddenOnDevice(w.advanced, device)) return null;
        const itemClass = "flex flex-col items-stretch justify-start w-full min-w-0 max-w-full overflow-hidden";
        return (
          <div key={w.id} data-widget-id={w.id} className={itemClass} style={{ ...getWidgetFrameStyle(w, device), boxSizing: "border-box" }}>
            <WidgetView node={w} lang={lang} device={device} />
          </div>
        );
      })}
    </div>
  );
}

