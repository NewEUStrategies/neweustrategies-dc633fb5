// Snippet trafienia z ts_headline: serwer odsyła CZYSTY tekst z delimiterami
// [[[ ]]] wokół trafionych słów; tu zamieniamy je na <mark> przez split -
// żadnego dangerouslySetInnerHTML, więc treść nie może przemycić HTML.
const OPEN = "[[[";
const CLOSE = "]]]";

export function SearchSnippet({ text, className }: { text: string; className?: string }) {
  if (!text.includes(OPEN)) {
    return <span className={className}>{text}</span>;
  }
  const parts: React.ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest.length > 0) {
    const start = rest.indexOf(OPEN);
    if (start < 0) {
      parts.push(rest);
      break;
    }
    const end = rest.indexOf(CLOSE, start + OPEN.length);
    if (end < 0) {
      parts.push(rest);
      break;
    }
    if (start > 0) parts.push(rest.slice(0, start));
    parts.push(
      <mark key={key++} className="rounded-sm bg-brand/20 px-0.5 text-inherit">
        {rest.slice(start + OPEN.length, end)}
      </mark>,
    );
    rest = rest.slice(end + CLOSE.length);
  }
  return <span className={className}>{parts}</span>;
}
