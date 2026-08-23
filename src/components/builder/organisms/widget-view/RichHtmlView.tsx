// Publiczny renderer HTML dla widgetu `text` w builderze.
//
// Dwa źródła przypisów, jedno wyjście:
//   1) BAKED - starsze wpisy zaimportowane z WP mają już statyczne <sup> i listę
//      w HTML (patrz lib/builder/migrate/htmlToBuilder). Odzyskujemy je z DOM,
//      by zamontować interaktywne bąbelki (tooltips).
//   2) LIVE - świeżo wpisane `[fn]tekst[/fn]` w polu widgetu. Redaktor musi to
//      widzieć od razu w kanwie - bez tego autor widział surowy shortcode,
//      a po publikacji ten sam wpis pokazywał [N] (desync z audytu przypisów).
//
// Silnik `expandFootnotes` jest ten sam, którego używa `/$slug` i `/preview`
// - dzięki temu kanwa == podgląd == produkcja.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { sanitizeHtml } from "@/lib/sanitize";
import {
  createCounter,
  expandFootnotes,
  parseBakedFootnotes,
  type Footnote,
} from "@/lib/footnotes";
import { FootnoteTooltips } from "@/components/Footnotes";
import { normalizeBuilderRichHtml } from "@/lib/builder/normalizeRichHtml";
import { decorateCmsStatusIcons } from "@/lib/content/cmsInlineIcons";

interface Props {
  html: string;
  className?: string;
  style?: CSSProperties;
}

export function RichHtmlView({ html, className, style }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [bakedNotes, setBakedNotes] = useState<Footnote[]>([]);

  // Live [fn] → markery + kolektor przypisów. Jeśli w HTML nie ma shortcode'ów,
  // wynik jest identyczny z sanitizeHtml(html), a `liveNotes` puste.
  const { safe, liveNotes } = useMemo(() => {
    const col = createCounter(1);
    const expanded = expandFootnotes(normalizeBuilderRichHtml(html), col);
    return { safe: decorateCmsStatusIcons(sanitizeHtml(expanded)), liveNotes: col.notes };
  }, [html]);

  useEffect(() => {
    const root = ref.current;
    if (!root) {
      setBakedNotes([]);
      return;
    }
    setBakedNotes(parseBakedFootnotes(root));
  }, [safe]);

  // Live wygrywa nad baked: gdy autor sam wpisał [fn], to jego stan jest źródłem
  // prawdy; baked pochodzi tylko z migracji WP i nie współistnieje z live.
  const notes = liveNotes.length > 0 ? liveNotes : bakedNotes;

  return (
    <>
      <div
        ref={ref}
        className={className}
        style={style}
        dangerouslySetInnerHTML={{ __html: safe }}
      />
      {notes.length > 0 && <FootnoteTooltips notes={notes} containerRef={ref} />}
    </>
  );
}
