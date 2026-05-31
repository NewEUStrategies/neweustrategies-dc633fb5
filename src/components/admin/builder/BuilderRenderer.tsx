// Read-only renderer for public pages. Renders a BuilderDocument as HTML.
// All user-authored ids/classes are passed through sanitizers; widget-level
// custom CSS is scoped per widget inside WidgetView.
import type { BuilderDocument, SectionNode, ColumnNode, InnerSectionNode, Device } from "@/lib/builder/types";
import { WidgetView, styleToCSS, hiddenOnDevice } from "@/components/admin/builder/WidgetView";
import { sanitizeHtmlId, sanitizeCssClass } from "@/lib/sanitize";

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
  return (
    <section
      id={sanitizeHtmlId(section.advanced?.htmlId)}
      className={sanitizeCssClass(section.advanced?.cssClass) ?? ""}
      style={styleToCSS(section.style, device)}
    >
      <div className="grid gap-4 md:gap-6" style={{ gridTemplateColumns: `repeat(${colsSum}, minmax(0, 1fr))` }}>
        {section.children.map((c) => {
          const span = c.kind === "column" ? (c.span.desktop ?? 12) : 12;
          return (
            <div key={c.id} className="col-span-full md:col-auto" style={{ gridColumn: `span ${span}` }}>
              {c.kind === "inner-section"
                ? <RenderInner inner={c} lang={lang} device={device} />
                : <RenderColumn column={c} lang={lang} device={device} />}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RenderInner({ inner, lang, device }: { inner: InnerSectionNode; lang: "pl"|"en"; device: Device }) {
  const colsSum = inner.columns.reduce((a, c) => a + (c.span.desktop ?? 6), 0) || 12;
  return (
    <div className={sanitizeCssClass(inner.advanced?.cssClass) ?? ""} style={styleToCSS(inner.style, device)}>
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${colsSum}, minmax(0, 1fr))` }}>
        {inner.columns.map((c) => (
          <div key={c.id} style={{ gridColumn: `span ${c.span.desktop ?? 6}` }}>
            <RenderColumn column={c} lang={lang} device={device} />
          </div>
        ))}
      </div>
    </div>
  );
}

function RenderColumn({ column, lang, device }: { column: ColumnNode; lang: "pl"|"en"; device: Device }) {
  return (
    <div className={sanitizeCssClass(column.advanced?.cssClass) ?? ""} style={styleToCSS(column.style, device)}>
      {column.children.map((w) => {
        if (hiddenOnDevice(w.advanced, device)) return null;
        return <WidgetView key={w.id} node={w} lang={lang} device={device} />;
      })}
    </div>
  );
}
