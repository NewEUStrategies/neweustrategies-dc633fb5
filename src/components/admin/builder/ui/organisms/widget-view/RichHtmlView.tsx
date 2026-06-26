// Public renderer for the builder `text` widget's HTML body.
//
// Beyond sanitizing + injecting the stored HTML, it re-attaches interactive
// footnote tooltips. Legacy article content migrated into a `text` widget bakes
// its footnote references (`<a data-fn="N">`) and the footnotes list directly
// into the HTML (see lib/builder/migrate/htmlToBuilder). The render-time
// `[fn]` pipeline never sees that baked markup, so without this the migrated
// content showed static refs + a bottom list but no hover/focus bubbles - the
// "footnote bubbles not mounted" gap from the migration audit. Here we recover
// the notes from the baked list and mount the SAME tooltip overlay used by the
// HTML article path, scoped to this widget. Tooltips are a progressive
// enhancement: the static refs + list render server-side with zero JS.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { sanitizeHtml } from "@/lib/sanitize";
import { parseBakedFootnotes, type Footnote } from "@/lib/footnotes";
import { FootnoteTooltips } from "@/components/Footnotes";

interface Props {
  html: string;
  className?: string;
  style?: CSSProperties;
}

export function RichHtmlView({ html, className, style }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const safe = useMemo(() => sanitizeHtml(html), [html]);
  const [notes, setNotes] = useState<Footnote[]>([]);

  useEffect(() => {
    const root = ref.current;
    if (!root) {
      setNotes([]);
      return;
    }
    setNotes(parseBakedFootnotes(root));
  }, [safe]);

  return (
    <>
      <div ref={ref} className={className} style={style} dangerouslySetInnerHTML={{ __html: safe }} />
      {notes.length > 0 && <FootnoteTooltips notes={notes} containerRef={ref} />}
    </>
  );
}
