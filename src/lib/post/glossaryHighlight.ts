// Reguła auto-podlinkowania słowniczka (A7) - CHODZI PO WĘZŁACH TEKSTOWYCH
// opublikowanego artykułu i je podmienia.
//
// DLACZEGO OSOBNY MODUŁ: dotychczas obie funkcje siedziały prywatnie w
// `components/post/GlossaryHighlighter.tsx` i nie miały ani jednego testu, choć
// ich błąd nie psuje panelu - psuje TREŚĆ, którą czyta użytkownik: duplikuje
// fragment, gubi spację, wchodzi w środek słowa albo zagnieżdża `<a>` w `<a>`.
// Sprawdzenie takiej reguły przez wyrenderowanie organizmu wymaga providera
// react-query, routera i klienta Supabase; jako czysty moduł operujący na
// przekazanym korzeniu DOM jest sprawdzalna bezpośrednio - także na PRAWDZIWYM
// wyjściu sanitizera.
//
// Zasady oznaczania (bez zmian względem wersji w komponencie):
//   - tylko pierwsze wystąpienie terminu w artykule (bez "choinki"),
//   - dopasowanie bez rozróżniania wielkości liter, na granicach słów
//     (litery/cyfry po obu stronach dyskwalifikują - "TSI" nie łapie "eTSI"),
//   - pomijamy linki, kod, nagłówki H1-H4 i istniejące oznaczenia,
//   - terminy dłuższe najpierw (zachłannie - "akt delegowany" przed "akt").

/**
 * Selektor przodków, w których NIE oznaczamy terminów.
 *
 * UWAGA - wymienia H1-H4, więc termin w `<h5>`/`<h6>` JEST oznaczany. To
 * zachowanie odziedziczone; test `glossaryHighlight` je przypina, żeby zmiana
 * była decyzją, a nie przypadkiem.
 */
export const GLOSSARY_SKIP_CLOSEST =
  "a, code, pre, h1, h2, h3, h4, [data-glossary-term], [data-fn]";

/** Minimalna długość etykiety terminu - krótsze są ignorowane. */
export const GLOSSARY_MIN_LABEL_LENGTH = 2;

/** Znak "słowotwórczy" - litera/cyfra Unicode (granice dopasowania). */
const WORDish = /[\p{L}\p{N}]/u;

/** Deskryptor terminu gotowy do oznaczania: slug (tożsamość) + etykieta (co szukamy). */
export interface GlossaryLabel {
  slug: string;
  label: string;
}

/** Minimalny kształt terminu, jakiego potrzebuje reguła (podzbiór `GlossaryTerm`). */
export interface GlossaryTermLike {
  slug: string;
  term_pl: string;
  term_en: string | null;
}

/**
 * Etykiety do oznaczania w danym języku - DESKRYPTORY, nie tekst dla użytkownika.
 *
 * Wariant angielski degraduje do polskiego terminu (`term_en || term_pl`);
 * wariant polski NIE degraduje do angielskiego - taki był kontrakt w
 * komponencie i zostaje bez zmian.
 */
export function glossaryLabels(
  terms: readonly GlossaryTermLike[],
  lang: "pl" | "en",
): GlossaryLabel[] {
  const out: GlossaryLabel[] = [];
  for (const term of terms) {
    const label = (lang === "en" ? term.term_en || term.term_pl : term.term_pl).trim();
    if (label.length >= GLOSSARY_MIN_LABEL_LENGTH) out.push({ slug: term.slug, label });
  }
  return out;
}

/**
 * Oznacza PIERWSZE wystąpienie każdej etykiety w poddrzewie `root`.
 *
 * Zwraca slugi w kolejności oznaczania (deskryptor) - dzięki temu test reguły
 * asertuje na danych, a nie na kształcie DOM-u. Etykiety powtórzone (ta sama
 * etykieta dla dwóch slugów) rozstrzyga OSTATNIA - jak Map w wersji źródłowej.
 */
export function markFirstOccurrences(
  root: HTMLElement,
  labels: readonly GlossaryLabel[],
): string[] {
  const remaining = new Map<string, string>();
  for (const { slug, label } of labels) {
    if (label.trim().length >= GLOSSARY_MIN_LABEL_LENGTH) {
      remaining.set(label.trim().toLowerCase(), slug);
    }
  }
  const marked: string[] = [];
  if (remaining.size === 0) return marked;
  // Dłuższe terminy mają pierwszeństwo w obrębie jednego węzła tekstowego.
  const ordered = () => [...remaining.keys()].sort((a, b) => b.length - a.length);

  // `root.ownerDocument`, nie globalny `document`: ta sama ścieżka w
  // przeglądarce, a moduł działa też na fragmencie odłączonym od dokumentu.
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (!node.textContent || node.textContent.trim().length < GLOSSARY_MIN_LABEL_LENGTH) {
        return NodeFilter.FILTER_REJECT;
      }
      const parent = node.parentElement;
      if (!parent || parent.closest(GLOSSARY_SKIP_CLOSEST)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) textNodes.push(n as Text);

  for (const textNode of textNodes) {
    if (remaining.size === 0) break;
    let node: Text | null = textNode;
    // Po każdym oznaczeniu kontynuujemy w "ogonie" podzielonego węzła.
    while (node && remaining.size > 0) {
      const text = node.textContent ?? "";
      const lower = text.toLowerCase();
      let hit: { key: string; index: number } | null = null;
      for (const key of ordered()) {
        let from = 0;
        while (from <= lower.length - key.length) {
          const idx = lower.indexOf(key, from);
          if (idx === -1) break;
          const before = idx > 0 ? text[idx - 1] : "";
          const after = idx + key.length < text.length ? text[idx + key.length] : "";
          if (!WORDish.test(before) && !WORDish.test(after)) {
            if (!hit || idx < hit.index) hit = { key, index: idx };
            break;
          }
          from = idx + 1;
        }
      }
      if (!hit) break;
      const slug = remaining.get(hit.key);
      remaining.delete(hit.key);
      if (slug === undefined) break;
      const range = node.splitText(hit.index);
      const tail = range.splitText(hit.key.length);
      const span = doc.createElement("span");
      span.dataset.glossaryTerm = slug;
      span.className = "glossary-term";
      span.tabIndex = 0;
      range.parentNode?.replaceChild(span, range);
      span.appendChild(range);
      marked.push(slug);
      node = tail;
    }
  }
  return marked;
}

/**
 * Zdejmuje oznaczenia (cleanup przy zmianie języka/artykułu) i zwraca ich liczbę.
 *
 * `parent.normalize()` po każdym zdjęciu jest tym, co czyni rundę
 * mark -> unmark ODWRACALNĄ bajt w bajt: bez scalenia rodzeństwa tekstowego
 * zostałyby trzy węzły tam, gdzie był jeden.
 */
export function unmarkAll(root: HTMLElement): number {
  const spans = [...root.querySelectorAll("span[data-glossary-term]")];
  let removed = 0;
  for (const span of spans) {
    const parent = span.parentNode;
    if (!parent) continue;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
    parent.normalize();
    removed += 1;
  }
  return removed;
}
