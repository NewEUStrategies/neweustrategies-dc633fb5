// Read-only renderer for public pages. Applies all Section settings
// (layout, background layers, overlay, border, shape dividers, typography).
import type { CSSProperties, ElementType } from "react";
import type { BuilderDocument, SectionNode, ColumnNode, InnerSectionNode, Device } from "@/lib/builder/types";
import { WidgetView, getWidgetFrameStyle, hiddenOnDevice } from "@/components/admin/builder/WidgetView";
import { sanitizeHtmlId, sanitizeCssClass, safeImageUrl } from "@/lib/sanitize";
import {
  sectionWrapperStyle, sectionContainerStyle, columnsRowStyle,
  backgroundLayerStyle, overlayLayerStyle, borderStyle,
  ShapeDivider, typographyCss, typographyAlign,
} from "@/lib/builder/sectionStyles";

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
  const colsSum = section.children.reduce((a, c) => a + (c.kind === "column" ? (c.span.desktop ?? 12) : 12), 0) || 12;
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
      className={sanitizeCssClass(section.advanced?.cssClass) ?? ""}
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
        <div style={columnsRowStyle(section, colsSum)}>
          {section.children.map((c) => {
            const span = c.kind === "column" ? (c.span.desktop ?? 12) : 12;
            return (
              <div key={c.id} style={{ gridColumn: `span ${span}` }}>
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
  const colsSum = inner.columns.reduce((a, c) => a + (c.span.desktop ?? 6), 0) || 12;
  return (
    <div className={sanitizeCssClass(inner.advanced?.cssClass) ?? ""} style={{ ...sectionWrapperStyle(inner), ...backgroundLayerStyle(inner.background), ...borderStyle(inner.border) }}>
      <div style={columnsRowStyle(inner, colsSum)}>
        {inner.columns.map((c) => (
          <div key={c.id} className="min-w-0" style={{ gridColumn: `span ${c.span.desktop ?? 6}` }}>
            <RenderColumn column={c} lang={lang} device={device} />
          </div>
        ))}
      </div>
    </div>
  );
}

function RenderColumn({ column, lang, device }: { column: ColumnNode; lang: "pl"|"en"; device: Device }) {
  return (
    <div data-col-id={column.id} className={`flex flex-wrap items-start content-start gap-2 min-w-0 ${column.contentAlign === "center" ? "justify-center" : column.contentAlign === "end" ? "justify-end" : "justify-start"} ${sanitizeCssClass(column.advanced?.cssClass) ?? ""}`.trim()}>
      {column.children.map((w) => {
        if (hiddenOnDevice(w.advanced, device)) return null;
        return (
          <div key={w.id} data-widget-id={w.id} className="flex flex-col items-stretch justify-start shrink min-w-0 self-start max-w-full overflow-hidden" style={getWidgetFrameStyle(w, device)}>
            <WidgetView node={w} lang={lang} device={device} />
          </div>
        );
      })}
    </div>
  );
}
