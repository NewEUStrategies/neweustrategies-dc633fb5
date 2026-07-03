// Render a string with characters at `indexes` wrapped in <mark>. Used to
// highlight fuzzy-match hits inside CommandPalette rows. Safe for arbitrary
// text - escapes by using text nodes (React handles escaping).
import { Fragment, type ReactNode } from "react";
import { fuzzyMatch } from "@/lib/search/fuzzy";

interface Props {
  text: string;
  query: string;
  className?: string;
}

export function HighlightedText({ text, query, className }: Props): ReactNode {
  const q = query.trim();
  if (!q || !text) return <span className={className}>{text}</span>;
  const m = fuzzyMatch(q, text);
  if (!m || m.indexes.length === 0) return <span className={className}>{text}</span>;

  const set = new Set(m.indexes);
  const out: ReactNode[] = [];
  let buf = "";
  let inMark = false;

  const flush = (key: number): void => {
    if (!buf) return;
    out.push(
      inMark ? (
        <mark key={key} className="bg-brand/20 text-brand rounded-sm px-0.5 font-semibold">
          {buf}
        </mark>
      ) : (
        <Fragment key={key}>{buf}</Fragment>
      ),
    );
    buf = "";
  };

  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    if (hit !== inMark) {
      flush(i);
      inMark = hit;
    }
    buf += text[i];
  }
  flush(text.length);

  return <span className={className}>{out}</span>;
}
