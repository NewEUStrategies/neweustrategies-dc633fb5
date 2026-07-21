// Atomy renderera bloków: liściowe, czysto prezentacyjne bloki renderujące
// pojedynczy element semantyczny z (sanitizowanym) tekstem/HTML, bez
// wewnętrznej kompozycji, pobierania danych ani stanu klienta.
//
// Każdy renderer to `BlockRenderer` (ctx -> ReactNode). Nie woła hooków - dane
// (t, lang, fnHtml, cls) dostaje z kontekstu wyliczonego przez dyspozytora.

import { safeUrl } from "@/lib/sanitize";
import type { BlockRenderer } from "./context";
import { bool, num, slugify, str, strList } from "./data";

/** Akapit z formatowaniem inline (HTML sanitizowany, z rozwiniętymi przypisami). */
export const renderParagraph: BlockRenderer = ({ block, fnHtml, cls }) => {
  const safe = fnHtml.get(block.id) ?? str(block.data, "html");
  return <div className={cls} dangerouslySetInnerHTML={{ __html: safe }} />;
};

/** Nagłówek H2-H4 z opcjonalną kotwicą (jawną lub slugifikowaną z treści). */
export const renderHeading: BlockRenderer = ({ block, fnHtml, cls }) => {
  const level = Math.min(Math.max(num(block.data, "level", 2), 2), 4);
  const text = str(block.data, "text");
  const explicit = str(block.data, "anchor");
  const id = explicit || (text ? slugify(text) : undefined);
  const Tag = `h${level}` as "h2" | "h3" | "h4";
  const withFn = fnHtml.get(`${block.id}:text`);
  if (withFn !== undefined) {
    return <Tag id={id} className={cls} dangerouslySetInnerHTML={{ __html: withFn }} />;
  }
  return (
    <Tag id={id} className={cls}>
      {text}
    </Tag>
  );
};

/** Lista numerowana lub punktowana (elementy mogą nieść przypisy). */
export const renderList: BlockRenderer = ({ block, fnHtml, cls }) => {
  const items = strList(block.data, "items");
  const ordered = bool(block.data, "ordered", false);
  const Tag = ordered ? "ol" : "ul";
  const kept = items.map((it, i) => ({ it, i })).filter(({ it }) => Boolean(it));
  return (
    <Tag
      className={`my-0 pl-6 ${ordered ? "list-decimal" : "list-disc"} marker:text-foreground ${cls}`}
    >
      {kept.map(({ it, i }) => {
        const withFn = fnHtml.get(`${block.id}:item:${i}`);
        return withFn !== undefined ? (
          <li key={i} className="my-0 pl-1" dangerouslySetInnerHTML={{ __html: withFn }} />
        ) : (
          <li key={i} className="my-0 pl-1">
            {it}
          </li>
        );
      })}
    </Tag>
  );
};

/** Cytat blokowy z opcjonalnym autorem (oba pola mogą nieść przypisy). */
export const renderQuote: BlockRenderer = ({ block, fnHtml, cls }) => {
  const text = str(block.data, "text");
  const cite = str(block.data, "cite");
  const textFn = fnHtml.get(`${block.id}:text`);
  const citeFn = fnHtml.get(`${block.id}:cite`);
  return (
    <blockquote className={cls}>
      {textFn !== undefined ? <p dangerouslySetInnerHTML={{ __html: textFn }} /> : <p>{text}</p>}
      {cite &&
        (citeFn !== undefined ? (
          <cite
            className="text-sm text-muted-foreground"
            dangerouslySetInnerHTML={{ __html: `- ${citeFn}` }}
          />
        ) : (
          <cite className="text-sm text-muted-foreground">- {cite}</cite>
        ))}
    </blockquote>
  );
};

/** Surowy HTML (sanitizowany, z rozwiniętymi przypisami). */
export const renderHtml: BlockRenderer = ({ block, fnHtml, cls }) => {
  const safe = fnHtml.get(block.id) ?? str(block.data, "html");
  return <div className={cls} dangerouslySetInnerHTML={{ __html: safe }} />;
};

/** Separator: linia, kropki lub gradientowa linia. */
export const renderSeparator: BlockRenderer = ({ block }) => {
  const variant = str(block.data, "variant", "line");
  if (variant === "dots")
    return (
      <div className="text-center text-2xl tracking-[0.5em] text-muted-foreground py-3 select-none">
        ···
      </div>
    );
  if (variant === "wide")
    return (
      <hr className="border-0 h-px bg-gradient-to-r from-transparent via-border to-transparent my-6" />
    );
  return <hr className="border-border my-6" />;
};

/** Callout: info / warning / success / danger. */
export const renderCallout: BlockRenderer = ({ block, cls }) => {
  const variant = str(block.data, "variant", "info");
  const text = str(block.data, "text");
  const map: Record<string, string> = {
    info: "bg-muted border-border text-foreground",
    warning: "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300",
    success: "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300",
    danger: "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300",
  };
  const stl = map[variant] ?? map.info;
  return (
    <div className={`not-prose rounded-md border px-4 py-3 my-4 whitespace-pre-line ${stl} ${cls}`}>
      {text}
    </div>
  );
};

/** Pojedynczy przycisk (etykieta + link, warianty default/outline/ghost). */
export const renderButton: BlockRenderer = ({ block, cls }) => {
  const label = str(block.data, "label");
  const href = safeUrl(str(block.data, "href", "#"));
  const variant = str(block.data, "variant", "default");
  const stl =
    variant === "outline"
      ? "border border-primary text-primary hover:bg-primary/10"
      : variant === "ghost"
        ? "text-primary hover:bg-primary/10"
        : "bg-primary text-primary-foreground hover:bg-primary/90";
  if (!label) return null;
  return (
    <p className={`not-prose ${cls}`}>
      <a
        href={href}
        className={`inline-flex items-center px-4 py-2 rounded-md text-sm font-medium ${stl}`}
      >
        {label}
      </a>
    </p>
  );
};

/** Odstęp pionowy (4-400 px). */
export const renderSpacer: BlockRenderer = ({ block }) => {
  const height = Math.min(400, Math.max(4, num(block.data, "height", 40)));
  return <div aria-hidden style={{ height }} />;
};

/** Podział strony - semantyczny marker paginacji wpisu. */
export const renderPageBreak: BlockRenderer = () => (
  <div className="page-break" aria-hidden data-page-break />
);

/** Granica zajawki (Read More) - na liście skraca treść, w pełnym widoku ukryta. */
export const renderReadMore: BlockRenderer = () => (
  <div className="read-more" aria-hidden data-read-more />
);

/** Cytat wyróżniony (duży, ozdobny). */
export const renderPullquote: BlockRenderer = ({ block, cls }) => {
  const text = str(block.data, "text");
  const cite = str(block.data, "cite");
  if (!text) return null;
  return (
    <blockquote className={`not-prose border-y-4 border-primary py-6 my-6 text-center ${cls}`}>
      <p className="text-2xl md:text-3xl font-serif italic m-0">{text}</p>
      {cite && (
        <cite className="block mt-3 text-sm text-muted-foreground not-italic">- {cite}</cite>
      )}
    </blockquote>
  );
};

/** Tekst wstępnie sformatowany (zachowuje spacje i nowe linie). */
export const renderPreformatted: BlockRenderer = ({ block, cls }) => {
  const text = str(block.data, "text");
  return <pre className={`whitespace-pre-wrap ${cls}`}>{text}</pre>;
};

/** Poezja - tekst z zachowanym łamaniem linii (serif, italic). */
export const renderVerse: BlockRenderer = ({ block, cls }) => {
  const text = str(block.data, "text");
  return (
    <pre
      className={`font-serif italic text-lg leading-relaxed whitespace-pre-wrap bg-transparent border-none p-0 ${cls}`}
    >
      {text}
    </pre>
  );
};
