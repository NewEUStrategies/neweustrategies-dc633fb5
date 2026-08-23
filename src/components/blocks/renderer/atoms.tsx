// Atomy renderera bloków: liściowe, czysto prezentacyjne bloki renderujące
// pojedynczy element semantyczny z (sanitizowanym) tekstem/HTML, bez
// wewnętrznej kompozycji, pobierania danych ani stanu klienta.
//
// Każdy renderer to `BlockRenderer` (ctx -> ReactNode). Nie woła hooków - dane
// (t, lang, fnHtml, cls) dostaje z kontekstu wyliczonego przez dyspozytora.

import type { ReactElement } from "react";
import { safeUrl } from "@/lib/sanitize";
import { blockAnchor } from "@/lib/blocks/anchors";
import { looksLikeInlineHtml, safeCssColor } from "@/lib/blocks/inlineHtml";
import { decorateCmsStatusIcons } from "@/lib/content/cmsInlineIcons";
import type { BlockRenderer } from "./context";
import { bool, num, sanitize, str, strList } from "./data";

/** Akapit z formatowaniem inline (HTML sanitizowany, z rozwiniętymi przypisami). */
export const renderParagraph: BlockRenderer = ({ block, fnHtml, cls }) => {
  const safe = decorateCmsStatusIcons(fnHtml.get(block.id) ?? str(block.data, "html"));
  return <div className={cls} dangerouslySetInnerHTML={{ __html: safe }} />;
};

/**
 * Nagłówek H2-H4 z kotwicą (jawną albo wyliczoną z treści).
 *
 * Kotwica pochodzi z JEDNEJ derywacji dokumentu (lib/blocks/anchors), tej samej,
 * którą czyta spis treści - więc `#kotwica` w ToC zawsze trafia w to `id`, także
 * przy dwóch nagłówkach o identycznej treści.
 *
 * `LegacyAnchors` dokłada puste kotwice dla identyfikatorów, jakie ten nagłówek
 * dostawał przed unifikacją slugifikatora (bez transliteracji `ł`). Bez nich
 * migracja treści bloki↔richtext zerwałaby już opublikowane linki `#`.
 */
export const renderHeading: BlockRenderer = ({ block, fnHtml, cls, allBlocks }) => {
  const level = Math.min(Math.max(num(block.data, "level", 2), 2), 5);
  const text = str(block.data, "text");
  const anchor = blockAnchor(block, allBlocks);
  const id = anchor.id || undefined;
  const Tag = `h${level}` as "h2" | "h3" | "h4" | "h5";
  // Kolor nagłówka ustawiony z toolbara widgetu (tylko hex / token var(--…)).
  const color = safeCssColor(block.data.color);
  const style = color ? { color } : undefined;

  const withFn = fnHtml.get(`${block.id}:text`);
  if (withFn !== undefined) {
    // Aliasy doklejamy do stringa HTML, żeby przy braku aliasów (przypadek
    // dominujący) DOM nagłówka pozostał BAJT W BAJT taki jak dotąd.
    const html =
      legacyAnchorsHtml(anchor.legacyIds, anchor.id) + decorateCmsStatusIcons(withFn);
    return <Tag id={id} className={cls} style={style} dangerouslySetInnerHTML={{ __html: html }} />;
  }
  // Nagłówek edytowany w CMS builderze przechowuje INLINE HTML (bold / italic /
  // kolor zaznaczenia). Rozpoznajemy to i sanityzujemy - inaczej czytelnik
  // zobaczyłby dosłowne znaczniki.
  if (looksLikeInlineHtml(text)) {
    const html =
      legacyAnchorsHtml(anchor.legacyIds, anchor.id) + decorateCmsStatusIcons(sanitize(text));
    return <Tag id={id} className={cls} style={style} dangerouslySetInnerHTML={{ __html: html }} />;
  }
  if (/✅|❌|⚠️/.test(text)) {
    const html =
      legacyAnchorsHtml(anchor.legacyIds, anchor.id) + decorateCmsStatusIcons(sanitize(text));
    return <Tag id={id} className={cls} style={style} dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return (
    <Tag id={id} className={cls} style={style}>
      {anchor.legacyIds.map((legacyId) => (
        <span key={legacyId} id={legacyId} data-anchor-alias={anchor.id} aria-hidden="true" />
      ))}
      {text}
    </Tag>
  );
};

/** Kotwica aliasowa MUSI być czystym slugiem - twardy warunek przed wejściem do HTML. */
const SAFE_ANCHOR_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Puste kotwice zgodności wstecznej jako HTML (dla ścieżki z rozwiniętymi
 * przypisami, gdzie treść nagłówka jest wstrzykiwana jako string). Identyfikatory
 * pochodzą wyłącznie z `slugifyAnchor`/`legacyAnchorVariants`, więc są ASCII-only;
 * regex jest tu ostatnią linią obrony, a nie jedyną.
 */
function legacyAnchorsHtml(ids: readonly string[], canonicalId: string): string {
  if (ids.length === 0 || !SAFE_ANCHOR_RE.test(canonicalId)) return "";
  return ids
    .filter((id) => SAFE_ANCHOR_RE.test(id))
    .map((id) => `<span id="${id}" data-anchor-alias="${canonicalId}" aria-hidden="true"></span>`)
    .join("");
}

/**
 * Lista numerowana lub punktowana (elementy mogą nieść przypisy).
 * Obsługuje listy wielopoziomowe: opcjonalne `levels` (1-based poziom
 * zagnieżdżenia per pozycja) i `itemsOrdered` (typ listy per pozycja) pochodzą
 * z importu Worda; `start` zachowuje numerację startową.
 */
export const renderList: BlockRenderer = ({ block, fnHtml, cls }) => {
  const items = strList(block.data, "items");
  const ordered = bool(block.data, "ordered", false);
  const start = num(block.data, "start", 1);
  const levelsRaw = Array.isArray(block.data.levels) ? block.data.levels : [];
  const orderedRaw = Array.isArray(block.data.itemsOrdered) ? block.data.itemsOrdered : [];
  const kept = items
    .map((it, i) => ({
      it,
      i,
      level: typeof levelsRaw[i] === "number" ? Math.max(1, Math.min(6, levelsRaw[i])) : 1,
      ordered: typeof orderedRaw[i] === "boolean" ? orderedRaw[i] : ordered,
    }))
    .filter(({ it }) => Boolean(it));

  const renderItem = (entry: (typeof kept)[number]) => {
    const withFn = fnHtml.get(`${block.id}:item:${entry.i}`);
    if (withFn !== undefined)
      return <span dangerouslySetInnerHTML={{ __html: decorateCmsStatusIcons(withFn) }} />;
    // Pozycje mogą nieść formatowanie inline (<strong>, <em>) z edytora/Worda -
    // renderujemy je jako HTML, żeby znaczniki nie były widoczne jako tekst.
    if (looksLikeInlineHtml(entry.it) || /✅|❌|⚠️/.test(entry.it))
      return (
        <span
          dangerouslySetInnerHTML={{ __html: decorateCmsStatusIcons(sanitize(entry.it)) }}
        />
      );
    return <>{entry.it}</>;
  };

  /** Renderuje jeden poziom listy, rekurencyjnie schodząc do zagnieżdżeń. */
  const renderLevel = (
    entries: (typeof kept)[number][],
    level: number,
    isOrdered: boolean,
    top: boolean,
  ): ReactElement => {
    const Tag = isOrdered ? "ol" : "ul";
    const nodes: ReactElement[] = [];
    let ordinal = top && isOrdered ? start : 1;
    for (let k = 0; k < entries.length; k++) {
      const entry = entries[k];
      if (entry.level !== level) continue;
      const childEntries: (typeof kept)[number][] = [];
      let j = k + 1;
      while (j < entries.length && entries[j].level > level) {
        childEntries.push(entries[j]);
        j++;
      }
      const childLevel = childEntries.find((c) => c.level === level + 1) ?? childEntries[0];
      nodes.push(
        <li key={entry.i} className="cms-list-item" data-list-level={level}>
          <span className={isOrdered ? "cms-list-number" : "cms-list-bullet"} aria-hidden="true">
            {isOrdered ? ordinal : ""}
          </span>
          <span className="cms-list-content">{renderItem(entry)}</span>
          {childEntries.length > 0 &&
            renderLevel(childEntries, level + 1, childLevel?.ordered ?? isOrdered, false)}
        </li>,
      );
      ordinal += 1;
      k = j - 1;
    }
    return (
      <Tag
        className={`cms-content-list ${isOrdered ? "cms-content-list--ordered" : "cms-content-list--unordered"} ${top ? cls : ""}`}
        start={top && isOrdered && start > 1 ? start : undefined}
      >
        {nodes}
      </Tag>
    );
  };

  if (!kept.length) return renderLevel([], 1, ordered, true);
  return renderLevel(kept, 1, kept[0].ordered, true);
};

/** Cytat blokowy z opcjonalnym autorem (oba pola mogą nieść przypisy).
 *  Warianty: `default` (border-left), `plain` (ikona cudzysłowu w rogu),
 *  `card` (karta z tłem), `minimal` (wyśrodkowany kursywą, bez obramowań).
 *  Paleta koloru mapowana na tokeny motywu -> działa w dark/light. */
export const renderQuote: BlockRenderer = ({ block, fnHtml, cls }) => {
  const text = str(block.data, "text");
  const cite = str(block.data, "cite");
  const textFn = fnHtml.get(`${block.id}:text`);
  const citeFn = fnHtml.get(`${block.id}:cite`);
  const variant = str(block.data, "variant") || "default";
  const palette = str(block.data, "colorPalette") || "neutral";

  const paletteVar: Record<string, string> = {
    neutral: "var(--foreground)",
    brand: "var(--brand, var(--primary))",
    accent: "var(--accent-foreground, var(--primary))",
    primary: "var(--primary)",
    success: "var(--success, #16a34a)",
    warning: "var(--warning, #d97706)",
    danger: "var(--destructive)",
  };
  const accent = paletteVar[palette] ?? paletteVar.neutral;
  const tint = `color-mix(in oklab, ${accent} 8%, transparent)`;

  const TextEl =
    textFn !== undefined ? (
      <p className="cms-quote-text" dangerouslySetInnerHTML={{ __html: textFn }} />
    ) : (
      <p className="cms-quote-text">{text}</p>
    );
  const CiteEl = cite ? (
    citeFn !== undefined ? (
      <cite
        className="cms-quote-cite text-sm text-muted-foreground not-italic"
        dangerouslySetInnerHTML={{ __html: `- ${citeFn}` }}
      />
    ) : (
      <cite className="cms-quote-cite text-sm text-muted-foreground not-italic">- {cite}</cite>
    )
  ) : null;

  if (variant === "plain") {
    return (
      <blockquote
        className={`relative pl-10 pr-2 py-2 space-y-2 ${cls}`}
        style={{ color: accent }}
        data-quote-variant="plain"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="absolute left-0 top-1 h-6 w-6 opacity-70"
          fill="currentColor"
        >
          <path d="M7.17 6C4.87 6 3 7.87 3 10.17V18h7.5v-7.83H6.6c0-1.42 1.16-2.58 2.58-2.58V6H7.17zm10 0c-2.3 0-4.17 1.87-4.17 4.17V18H20.5v-7.83h-3.9c0-1.42 1.16-2.58 2.58-2.58V6h-1.01z" />
        </svg>
        <div className="text-foreground text-lg leading-relaxed italic">{TextEl}</div>
        {CiteEl}
      </blockquote>
    );
  }

  if (variant === "card") {
    return (
      <blockquote
        className={`rounded-[6px] border p-5 space-y-2 ${cls}`}
        style={{ borderColor: accent, background: tint }}
        data-quote-variant="card"
      >
        <div className="text-foreground text-lg leading-relaxed">{TextEl}</div>
        {CiteEl}
      </blockquote>
    );
  }

  if (variant === "minimal") {
    return (
      <blockquote
        className={`text-center italic space-y-2 py-4 ${cls}`}
        data-quote-variant="minimal"
      >
        <div className="text-xl leading-relaxed" style={{ color: accent }}>
          {TextEl}
        </div>
        {CiteEl}
      </blockquote>
    );
  }

  // default: border-left
  return (
    <blockquote
      className={`border-l-4 pl-4 space-y-2 ${cls}`}
      style={{ borderColor: accent }}
      data-quote-variant="default"
    >
      {TextEl}
      {CiteEl}
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
