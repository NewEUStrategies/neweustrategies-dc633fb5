import { sliderUsesPostsSource } from "@/lib/builder/sliderPostsQuery";
import type { BuilderDocument, SectionNode, WidgetNode } from "@/lib/builder/types";

// Replaced only in the server build, after browser chunk names are known.
// HTTP Link hints avoid introducing server-only nodes into the hydrated head.
export const WIDGET_CHUNK_URLS: Readonly<Record<string, readonly string[]>> = {};

type VisitedNode = SectionNode | SectionNode["children"][number] | WidgetNode;

/** Tablica albo nic - dokument z bazy (jsonb) nie zawsze trzyma się typu. */
const list = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

/**
 * Nagłówki `Link: rel=modulepreload` dla leniwych widgetów z `sectionCount`
 * pierwszych sekcji dokumentu.
 *
 * FUNKCJA TOTALNA - nigdy nie rzuca. Hint jest dekoracją odpowiedzi, a woła ją
 * m.in. loader korzenia na SUROWYM `header.builder_data` (bez
 * `parseBuilderDoc`), w tym samym `try` co rozgrzewanie paska „Na czasie".
 * Wyjątek z jednego krzywego węzła zabierałby więc nie tylko hinty, ale
 * i rozgrzanie tickera (czyli wracałby najgorszy CLS serwisu). Dlatego każdy
 * poziom drzewa jest czytany przez `list()`, a węzeł niebędący obiektem jest
 * pomijany.
 */
export function widgetPreloadHeaders(
  doc: BuilderDocument,
  sectionCount: number,
  chunks = WIDGET_CHUNK_URLS,
): string[] {
  // `slice(0, -1)` to „wszystko poza ostatnią", nie „nic" - ujemna albo
  // niebędąca liczbą wartość oznaczałaby hinty dla prawie całej strony.
  if (!(sectionCount > 0)) return [];
  const urls = new Set<string>();
  const visit = (node: VisitedNode | null | undefined) => {
    if (!node || typeof node !== "object") return;
    if (node.kind === "widget") {
      // Image-only sliders do not need the posts query module.
      const type =
        node.type === "slider" && !sliderUsesPostsSource(node.content ?? {})
          ? "image-slider"
          : node.type;
      // `hasOwn`, nie `chunks[type]`: typ pochodzi z danych, a `toString`,
      // `constructor` czy `__proto__` trafiłyby w prototyp obiektu i `for...of`
      // po funkcji rzuciłby TypeError.
      if (!Object.hasOwn(chunks, type)) return;
      for (const url of list<string>(chunks[type])) urls.add(url);
    } else if (node.kind === "inner-section") {
      for (const column of list<VisitedNode>(node.columns)) visit(column);
    } else if ("children" in node) {
      for (const child of list<VisitedNode>(node.children)) visit(child);
    }
  };
  for (const section of list<SectionNode>(doc?.sections).slice(0, sectionCount)) visit(section);
  return [...urls].map((url) => `<${url}>; rel="modulepreload"; crossorigin`);
}
