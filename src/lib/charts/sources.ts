// ŹRÓDŁA WYKRESU - przypisy w stylu chicagowskim, wiarygodność i oznaczenie
// pochodzenia liczb.
//
// KAŻDA LICZBA MA POCHODZENIE. Wykres, który miesza dane użytkownika,
// wyliczenia i benchmarki z literatury, a nie mówi, która liczba jest którą,
// pozwala czytelnikowi uznać szacunek za pomiar. Litera przy podtytule
// rozstrzyga to jednym znakiem:
//   D - Twoje dane, W - wyliczenie, B - benchmark ze źródła,
//   E - szacunek lub heurystyka, ? - brak danych.
//
// PRZYPIS, NIE LINK. Pasmo optimum i punkty odniesienia niosą numer przypisu;
// pełny opis bibliograficzny (Chicago, wariant bibliografii), wiarygodność
// i daty siedzą w oknie przypisu i w bibliografii na dole strony. Sam link
// nie mówi, KTO twierdzi i KIEDY - a to rozstrzyga, ile twierdzenie jest warte.

export const PROVENANCES = ["D", "W", "B", "E", "?"] as const;
export type Provenance = (typeof PROVENANCES)[number];

export function isProvenance(raw: unknown): raw is Provenance {
  return typeof raw === "string" && (PROVENANCES as readonly string[]).includes(raw);
}

/** A: źródło pierwotne, B: wtórne rzetelne, C: omówienie. */
export const RELIABILITIES = ["A", "B", "C"] as const;
export type Reliability = (typeof RELIABILITIES)[number];

export function isReliability(raw: unknown): raw is Reliability {
  return typeof raw === "string" && (RELIABILITIES as readonly string[]).includes(raw);
}

export interface ChartSource {
  /** Stały identyfikator - po nim pasmo wskazuje swój przypis. */
  id: string;
  /** Autor albo instytucja („Eurostat", „Kowalski, Jan"). */
  author: string;
  title: string;
  /**
   * Całość, w której tekst się ukazał (czasopismo, serwis, seria raportów).
   * Pusta = dzieło samodzielne (raport, książka) - tytuł idzie kursywą,
   * a nie w cudzysłowie.
   */
  container: string;
  publisher: string;
  /** Data publikacji - tak, jak ją podaje źródło. */
  published: string;
  /** Data dostępu - kiedy autor wykresu ostatnio sprawdził źródło. */
  accessed: string;
  url: string;
  reliability: Reliability | null;
}

/** Ile źródeł może mieć jeden wykres - edytor CMS, nie bibliografia rozprawy. */
export const MAX_CHART_SOURCES = 12;

export type CitationLang = "pl" | "en";

/**
 * Jeden kawałek opisu bibliograficznego; `italic` dla tytułu dzieła
 * samodzielnego, `quoted` dla tytułu tekstu w całości (czasopiśmie, serwisie).
 * Cudzysłów NIE jest wpisany w tekst: HTML stawia go elementem `<q>`, który
 * dobiera znaki do języka strony („…" po polsku, “…" po angielsku).
 */
export interface CitationPart {
  text: string;
  italic?: boolean;
  quoted?: boolean;
}

const QUOTES: Record<CitationLang, [string, string]> = {
  pl: ["„", "”"],
  en: ["“", "”"],
};

const ACCESSED: Record<CitationLang, string> = { pl: "Dostęp", en: "Accessed" };

/** Domknięcie elementu kropką - bez podwajania, gdy kropka już jest. */
function withPeriod(text: string): string {
  const t = text.trim();
  if (t === "") return "";
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/**
 * Opis bibliograficzny w stylu chicagowskim (Chicago Manual of Style, 17th
 * ed., wariant bibliografii), złożony z dostępnych pól. Brakujące pola
 * znikają razem ze swoim separatorem - opis z dziurami („Eurostat. . 2026.")
 * jest gorszy niż opis krótszy.
 *
 *   Autor. „Tytuł”. Całość. Wydawca, data. Dostęp data. URL.
 *   Autor. *Tytuł*. Wydawca, data. Dostęp data. URL.
 */
export function chicagoBibliography(source: ChartSource, lang: CitationLang): CitationPart[] {
  const parts: CitationPart[] = [];
  const push = (text: string, italic = false): void => {
    if (text === "") return;
    if (parts.length > 0) parts.push({ text: " " });
    parts.push(italic ? { text, italic } : { text });
  };
  push(withPeriod(source.author));
  const title = source.title.trim();
  if (title !== "") {
    if (parts.length > 0) parts.push({ text: " " });
    if (source.container.trim() !== "") {
      parts.push({ text: title.replace(/[.]$/, ""), quoted: true });
    } else {
      parts.push({ text: title.replace(/[.]$/, ""), italic: true });
    }
    parts.push({ text: "." });
  }
  push(withPeriod(source.container));
  const imprint = [source.publisher.trim(), source.published.trim()].filter(Boolean).join(", ");
  push(withPeriod(imprint));
  if (source.accessed.trim() !== "") push(`${ACCESSED[lang]} ${withPeriod(source.accessed)}`);
  push(withPeriod(source.url.trim()));
  return parts;
}

/** Ten sam opis jako zwykły napis - do schowka i do testów. */
export function chicagoBibliographyText(source: ChartSource, lang: CitationLang): string {
  const [open, close] = QUOTES[lang];
  return chicagoBibliography(source, lang)
    .map((p) => (p.quoted ? `${open}${p.text}${close}` : p.text))
    .join("");
}

/**
 * Adres, który wolno otworzyć: wyłącznie http(s). Źródło jest treścią
 * redakcyjną i bywa wklejone z czymkolwiek - `javascript:` w atrybucie
 * `href` byłby wykonaniem kodu na kliknięcie.
 */
export function safeSourceUrl(raw: string): string | null {
  const value = raw.trim();
  if (value === "") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Ten sam opis jako HTML - do sekcji przypisów artykułu. Tytuł dzieła
 * samodzielnego kursywą, tytuł tekstu w `<q>` (znaki cudzysłowu dobiera język
 * artykułu, więc pre-pass przypisów nie zależy od języka), adres jako
 * odsyłacz wyłącznie dla http(s); reszta
 * jest tekstem, nie znacznikami, więc pole wklejone z czymkolwiek nie wstawi
 * do strony ani jednego elementu.
 */
export function chicagoBibliographyHtml(source: ChartSource, lang: CitationLang = "pl"): string {
  const url = safeSourceUrl(source.url);
  return chicagoBibliography(source, lang)
    .map((part) => {
      const text = escapeHtml(part.text);
      if (part.italic) return `<em>${text}</em>`;
      if (part.quoted) return `<q>${text}</q>`;
      if (url !== null && part.text === withPeriod(source.url.trim())) {
        const href = escapeHtml(url);
        return `<a href="${href}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.url.trim())}</a>.`;
      }
      return text;
    })
    .join("");
}
