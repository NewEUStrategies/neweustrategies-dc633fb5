// Czy dokument buildera NA PEWNO renderuje nagłówek poziomu 1?
//
// PO CO: strony redagowane w builderze są samowystarczalne (własny hero, własne
// nagłówki), więc trasa `$.tsx` nie dorysowuje im widocznego `<h1>` z tytułu.
// Do 2026-08-06 dorysowywała `<h1 className="sr-only">`, co dawało DWA `h1` na
// stronach z własnym nagłówkiem - i commit naprawczy usunął ten `h1` bez
// warunku, zamieniając defekt SEO na defekt a11y: strona buildera BEZ nagłówka
// poziomu 1 w kanwie została zupełnie bez `h1` (audyt 2026-08-06, korekta 2).
//
// Ten moduł rozstrzyga to inwariantem, a nie zgadywaniem: `h1` z tytułu strony
// wstawiamy DOKŁADNIE wtedy, gdy dokument sam żadnego nie renderuje. Efekt:
// każda strona buildera ma dokładnie jeden `h1` - widoczny, gdy redakcja go
// zaprojektowała, `sr-only`, gdy nie.
//
// ZASADA OSTROŻNOŚCI: liczymy tylko nagłówki, które renderer wypisze BEZ
// kontekstu wpisu. Widgety dynamiczne (`post-title`, `archive-title`) na
// stronie (nie wpisie/archiwum) nie mają kontekstu i zwracają `null`, więc
// zaliczenie ich jako `h1` zostawiłoby stronę bez nagłówka - czyli dokładnie
// z tym defektem, który zamykamy.
//
// Moduł jest CELOWO bez zależności (własny, dziesięciolinijkowy obchód drzewa
// zamiast importu `collectBuilderWidgets` z `prefetch.ts`): trafia do bundla
// trasy publicznej, a `prefetch.ts` ciągnie za sobą wszystkie moduły zapytań
// widgetów.
import type { BuilderDocument, Json, WidgetNode } from "./types";
import { toJson } from "@/lib/builder/types";

/**
 * Widgety, których nagłówek zależy od kontekstu wpisu/archiwum. Na stronie
 * buildera renderują się do `null`, więc NIE są dowodem na istnienie `h1`.
 */
const CONTEXT_DEPENDENT_HEADINGS: ReadonlySet<string> = new Set(["post-title", "archive-title"]);

/** `<h1>`, `<h1 class=...>`, `<H1>` - ale nie `<h10>` (takiego tagu nie ma, a i tak byłby fałszywką). */
const H1_MARKUP_RE = /<h1(?=[\s/>])/i;

/** Czy w dowolnym stringu treści (także zagnieżdżonym) siedzi znacznik `<h1`. */
function containsH1Markup(value: Json | undefined): boolean {
  if (typeof value === "string") return H1_MARKUP_RE.test(value);
  if (Array.isArray(value)) return value.some((item) => containsH1Markup(item as Json));
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, Json>).some((item) => containsH1Markup(item));
  }
  return false;
}

/** Czy TEN widget wypisze `h1` bez kontekstu wpisu. */
export function widgetRendersTopHeading(widget: WidgetNode | null | undefined): boolean {
  if (!widget || widget.kind !== "widget") return false;
  const content = widget.content ?? {};

  // 1. Jawny wybór redakcji w polu "Tag (SEO)" - `heading`, `animated-heading`,
  //    `text-rotate` i każdy przyszły widget z tym samym kluczem.
  const tag = content.tag;
  if (
    typeof tag === "string" &&
    tag.trim().toLowerCase() === "h1" &&
    !CONTEXT_DEPENDENT_HEADINGS.has(widget.type)
  ) {
    return true;
  }

  // 2. Nagłówek wpisany wprost w HTML widgetu tekstowego (`html_pl` / `html_en`
  //    i wszystko, co redakcja wkleiła w treść bogatą).
  return containsH1Markup(toJson(content));
}

/** Wszystkie widgety dokumentu - jeden obchód, bez alokacji tablic pośrednich. */
function someWidget(
  doc: BuilderDocument | null | undefined,
  predicate: (widget: WidgetNode) => boolean,
): boolean {
  const sections = Array.isArray(doc?.sections) ? doc.sections : [];
  for (const section of sections) {
    for (const child of Array.isArray(section?.children) ? section.children : []) {
      if (!child) continue;
      const columns = child.kind === "column" ? [child] : (child.columns ?? []);
      for (const column of columns) {
        for (const widget of Array.isArray(column?.children) ? column.children : []) {
          if (widget && predicate(widget)) return true;
        }
      }
    }
  }
  return false;
}

/**
 * Czy dokument buildera renderuje własny nagłówek poziomu 1.
 *
 * `false` (także dla dokumentu pustego / uszkodzonego) znaczy: trasa MUSI dodać
 * własny `h1` z tytułu strony.
 */
export function builderDocHasTopHeading(doc: BuilderDocument | null | undefined): boolean {
  return someWidget(doc, widgetRendersTopHeading);
}
